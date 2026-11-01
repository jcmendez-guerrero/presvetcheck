import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { calcularPrecioCoste, precioConDescuento, totalesCompra, variacionCoste } from '../src/precio';
import { conciliar } from '../src/conciliacion';
import {
  extraerCn,
  maxCorrelativo,
  nombreCumpleConvencion,
  normalizarCn,
  proponerNombre,
  proponerSku,
  siguienteCorrelativo,
  skuCumpleConvencion,
  sugerirPrefijo,
  varianteCoincideCn,
} from '../src/sku';
import { acumularEscaneo, avisosEntrada, camposFaltantes, entradaCaducada, type LineaEntrada } from '../src/recepcion';
import { planificarDispensacion, textoResguardo } from '../src/parcial';
import { HOY, RULES, politica } from './builders';

const PATRON = 'CN(\\d{6,7})$';

describe('precio de coste con recargo de equivalencia (SPEC §4.10)', () => {
  it.each`
    neto       | iva     | coste      | almacen
    ${'10.00'} | ${10}   | ${'10.14'} | ${'10.1400'}
    ${'10.00'} | ${21}   | ${'10.52'} | ${'10.5200'}
    ${'10.00'} | ${4}    | ${'10.05'} | ${'10.0500'}
    ${'10.00'} | ${null} | ${'10.14'} | ${'10.1400'}
    ${'3.333'} | ${10}   | ${'3.38'}  | ${'3.3797'}
  `('$neto € neto, IVA $iva % → $coste €', ({ neto, iva, coste, almacen }) => {
    const r = calcularPrecioCoste(neto, iva, RULES.precios);
    expect(r.costePantalla).toBe(coste);
    expect(r.costeAlmacen).toBe(almacen);
  });
  it('rechaza IVA sin RE configurado y precios negativos', () => {
    expect(() => calcularPrecioCoste('10', 7, RULES.precios)).toThrow(/Sin recargo/);
    expect(() => calcularPrecioCoste('-1', 10, RULES.precios)).toThrow(/negativo/);
  });
  it('variación respecto al coste anterior', () => {
    expect(variacionCoste('10.00', '10.50')).toBe('5.00');
    expect(variacionCoste(null, '1')).toBeNull();
    expect(variacionCoste('0', '1')).toBeNull();
    expect(new Decimal(calcularPrecioCoste('10', 10, RULES.precios).rePct).toNumber()).toBe(1.4);
  });
});

describe('conciliación ticket ↔ dispensación (SPEC §5.2.4)', () => {
  it('detecta coincidencias, unidades y lote distintos, dispensaciones sin ticket y tickets sin dispensación', () => {
    const r = conciliar(
      [
        { id: 'd1', cn: '570016', lote: 'A', unidades: 1, fecha: HOY },
        { id: 'd2', cn: '570016', lote: 'B', unidades: 2, fecha: HOY },
        { id: 'd3', cn: '580001', lote: 'C', unidades: 1, fecha: HOY },
        { id: 'd4', cn: '590000', lote: 'D', unidades: 1, fecha: HOY },
      ],
      [
        { id: 'm1', variantId: 1, cn: '570016', lote: 'A', unidades: 1, fecha: HOY },
        { id: 'm2', variantId: 1, cn: '570016', lote: 'B', unidades: 1, fecha: HOY },
        { id: 'm3', variantId: 2, cn: '580001', lote: 'Z', unidades: 1, fecha: HOY },
        { id: 'm4', variantId: 3, cn: '600000', lote: 'E', unidades: 1, fecha: HOY },
        { id: 'm5', variantId: 9, cn: null, lote: null, unidades: 1, fecha: HOY },
      ],
    );
    expect(r.conciliadas).toEqual([{ dispensacionId: 'd1', movimientoId: 'm1', loteVerificado: true }]);
    expect(r.discrepancias.map((d) => [d.tipo, d.dispensacionId, d.movimientoId])).toEqual([
      ['UNIDADES_DISTINTAS', 'd2', 'm2'],
      ['LOTE_DISTINTO', 'd3', 'm3'],
      ['DISPENSACION_SIN_TICKET', 'd4', null],
      ['TICKET_SIN_DISPENSACION', null, 'm4'],
    ]);
    expect(r.discrepancias[1]).toMatchObject({ loteDispensacion: 'C', loteTicket: 'Z', cn: '580001' });
  });

  it('tickets sin lote (Siweb360): concilia por CN + unidades con el lote sin verificar', () => {
    const r = conciliar(
      [
        { id: 'd1', cn: '570016', lote: 'A', unidades: 1, fecha: HOY },
        { id: 'd2', cn: '570004', lote: 'B', unidades: 1, fecha: HOY },
      ],
      [
        { id: 't1', variantId: null, cn: '570016', lote: null, unidades: 1, fecha: HOY, ticket: 'T-1' },
        { id: 't2', variantId: null, cn: '570004', lote: null, unidades: 2, fecha: HOY, ticket: 'T-2' },
      ],
    );
    expect(r.conciliadas).toEqual([{ dispensacionId: 'd1', movimientoId: 't1', loteVerificado: false }]);
    expect(r.discrepancias).toEqual([
      expect.objectContaining({ tipo: 'UNIDADES_DISTINTAS', dispensacionId: 'd2', movimientoId: 't2', loteTicket: null, ticket: 'T-2', unidadesTicket: 2 }),
    ]);
  });
});

describe('convención de SKU y CN (SPEC §5.2.2)', () => {
  it.each`
    texto                          | anclado  | cn
    ${'ZOETIS-0007-CN123456'}      | ${true}  | ${'123456'}
    ${'ZOETIS-0007-CN1234567'}     | ${true}  | ${'123456'}
    ${'CN123456-OTRO'}             | ${true}  | ${null}
    ${'Amoxivet 500 CN570016 caja'} | ${false} | ${'570016'}
    ${'AMOXIBACTIN 250 10 COMPRIMIDOS- CN 584187.8'} | ${false} | ${'584187'}
    ${'Producto C.N.: 5841878'}    | ${false} | ${'584187'}
    ${'Producto CN584187-8 caja'}  | ${false} | ${'584187'}
    ${'Lote 12345678 sin código'}  | ${false} | ${null}
    ${'CN 58418'}                  | ${false} | ${null}
    ${'DECHRA-00002'}              | ${true}  | ${null}
    ${'DECHRA-00002-CN-584187.8'}  | ${true}  | ${'584187'}
    ${'DECHRA-00002-CN584187.8'}   | ${true}  | ${'584187'}
    ${'SKU-ANTIGUO-77'}            | ${true}  | ${null}
    ${null}                        | ${true}  | ${null}
  `('extraerCn($texto) = $cn', ({ texto, anclado, cn }) => {
    expect(extraerCn(texto, PATRON, anclado)).toBe(cn);
  });
  it('coincidencia de variante por SKU o nombre', () => {
    expect(varianteCoincideCn({ sku: 'X', name: 'Amoxivet CN570016' }, '5700163', PATRON)).toBe(true);
    expect(varianteCoincideCn({ sku: 'ZOE-0001-CN570016', name: null }, '570016', PATRON)).toBe(true);
    expect(varianteCoincideCn({ sku: 'X', name: 'Y', productName: 'Z CN570016' }, '570016', PATRON)).toBe(true);
    expect(varianteCoincideCn({ sku: 'X', name: 'Y' }, '570016', PATRON)).toBe(false);
  });
  it('correlativo por laboratorio con reservas', () => {
    const skus = ['ZOETIS-0007-CN123456', 'ZOETIS-0003-CN111111', 'OTRO-0099-CN1', 'zoetis-0008-CN222222'];
    expect(maxCorrelativo(skus, 'ZOETIS')).toBe(8);
    expect(siguienteCorrelativo(skus, 'ZOETIS', [10, 2])).toBe(11);
    expect(siguienteCorrelativo([], 'NUEVO', [])).toBe(1);
    expect(() => siguienteCorrelativo(['P-9999-CN1'], 'P', [])).toThrow(/agotado/);
    expect(proponerSku('zoetis', 7, '1234567')).toBe('ZOETIS-0007-CN123456');
    expect(skuCumpleConvencion('ZOETIS-0007-CN123456', '123456', PATRON)).toBe(true);
    expect(skuCumpleConvencion('ANTIGUO-77', '123456', PATRON)).toBe(false);
    expect(nombreCumpleConvencion('Amoxivet CN123456', '123456', PATRON)).toBe(true);
    expect(proponerNombre('Amoxivet 500', '123456')).toBe('Amoxivet 500 CN123456');
    expect(proponerNombre('Amoxivet CN999999', '123456')).toBe('Amoxivet CN123456');
    expect(normalizarCn('570.016')).toBe('570016');
  });
  it('sugiere un prefijo a partir del laboratorio titular', () => {
    expect(sugerirPrefijo('Zoetis Spain, S.L.U.')).toBe('ZOETIS');
    expect(sugerirPrefijo('Laboratorios Calier S.A.')).toBe('CALIER');
    expect(sugerirPrefijo('S.A.')).toBe('LAB');
  });
});

describe('recepción de mercancía (SPEC §4.9)', () => {
  it.each`
    caducidad       | hoy             | caducada
    ${'2026-10-18'} | ${'2026-10-19'} | ${true}
    ${'2026-10-19'} | ${'2026-10-19'} | ${false}
    ${'2026-10-31'} | ${'2026-11-01'} | ${true}
    ${'2027-02-28'} | ${'2026-10-19'} | ${false}
    ${null}         | ${'2026-10-19'} | ${false}
  `('entrada con caducidad $caducidad el $hoy → caducada=$caducada', ({ caducidad, hoy, caducada }) => {
    expect(entradaCaducada(caducidad, hoy)).toBe(caducada);
  });

  const linea = (o: Partial<LineaEntrada> = {}): LineaEntrada => ({
    tipo: 'medicamento',
    unidades: 1,
    nombreFarmaco: 'AMOXIVET',
    principioActivo: 'amoxicilina',
    forma: 'comprimido',
    caducidad: '2027-12-31',
    lote: 'L1',
    cn: '570016',
    seriales: [],
    ...o,
  });
  it('campos obligatorios', () => {
    expect(camposFaltantes(linea())).toEqual([]);
    expect(camposFaltantes(linea({ lote: null, caducidad: null, unidades: 0 }))).toEqual(['unidades', 'caducidad', 'lote']);
    expect(camposFaltantes(linea({ tipo: 'producto', cn: null, lote: null }))).toEqual([]);
    expect(camposFaltantes(linea({ tipo: 'producto', unidades: null, nombreFarmaco: null }))).toEqual(['unidades', 'nombreFarmaco']);
  });
  it('caducidad próxima (< hoy + 90 días) → aviso', () => {
    expect(avisosEntrada(linea({ caducidad: '2026-12-01' }), HOY, 90, politica()).map((i) => i.code)).toEqual(['CADUCIDAD_PROXIMA_ENTRADA']);
    expect(avisosEntrada(linea(), HOY, 90, politica())).toEqual([]);
    expect(avisosEntrada(linea({ caducidad: null }), HOY, 90, politica())).toEqual([]);
  });
  it('escanear el mismo lote suma unidades salvo nº de serie repetido', () => {
    const a = acumularEscaneo(linea({ seriales: ['S1'] }), 'S2');
    expect(a.linea.unidades).toBe(2);
    expect(a.linea.seriales).toEqual(['S1', 'S2']);
    expect(acumularEscaneo(a.linea, 'S1').duplicado).toBe(true);
    expect(acumularEscaneo(linea({ unidades: null }), null).linea.unidades).toBe(1);
  });
});

describe('dispensación parcial (D-10)', () => {
  it('líneas disponibles se dispensan, las demás quedan pendientes de entrega y la receta en papel se retiene', () => {
    const plan = planificarDispensacion(
      [
        { orden: 1, decision: 'DISPENSAR', dispensarAhora: true },
        { orden: 2, decision: 'PEDIR', dispensarAhora: false },
        { orden: 3, decision: 'NO_CONFORME', dispensarAhora: false },
      ],
      true,
      'papel',
    );
    expect(plan).toEqual({ dispensables: [1], pendientesEntrega: [2], bloqueadas: [3], esParcial: true, permitido: true, retenerReceta: true });
  });
  it('ALLOW_PARTIAL_DISPENSATION=false impide la dispensación parcial', () => {
    const plan = planificarDispensacion(
      [
        { orden: 1, decision: 'DISPENSAR', dispensarAhora: true },
        { orden: 2, decision: 'PEDIR', dispensarAhora: false },
      ],
      false,
      'electronica',
    );
    expect(plan.permitido).toBe(false);
    expect(plan.retenerReceta).toBe(false);
  });
  it('resguardo para el tutor', () => {
    const t = textoResguardo({ numeroReceta: 'R1', fecha: '14/10/2026', telefonoFarmacia: '900 000 000', pendientes: [{ nombre: 'AMOXIVET', unidades: 1 }] });
    expect(t).toContain('Receta nº: R1');
    expect(t).toContain('AMOXIVET — 1 envase(s)');
    expect(textoResguardo({ numeroReceta: null, fecha: 'x', telefonoFarmacia: 'y', pendientes: [] })).toContain('(sin número)');
  });
});

describe('compra con descuento, IVA y recargo de equivalencia (factura de proveedor)', () => {
  // Importes de una factura real de distribuidor (4 líneas, descuento 12,88 %, IVA 10 % y RE 1,4 %).
  const lineas = [
    ['67.67', 1],
    ['23.08', 1],
    ['44.03', 1],
    ['23.46', 1],
  ].map(([p, u]) => ({ neto: precioConDescuento(p as string, '12.88'), unidades: u as number, ivaPct: '10', rePct: '1.4' }));

  it('neto = precio − descuento, y totales iguales a los de la factura', () => {
    expect(lineas.map((l) => l.neto)).toEqual(['58.9541', '20.1073', '38.3589', '20.4384']);
    expect(totalesCompra(lineas)).toEqual({ base: '137.86', iva: '13.79', recargo: '1.93', total: '153.58' });
  });

  it('régimen solo IVA: sin recargo en el coste', () => {
    expect(calcularPrecioCoste('10', 10, RULES.precios, { conRecargo: false }).costeAlmacen).toBe('10.0000');
    expect(calcularPrecioCoste('10', 10, RULES.precios).rePct.toString()).toBe('1.4');
  });

  it('descuento fuera de rango', () => {
    expect(() => precioConDescuento('10', '120')).toThrow(/entre 0 y 100/);
    expect(precioConDescuento('10', null)).toBe('10.0000');
  });
});

