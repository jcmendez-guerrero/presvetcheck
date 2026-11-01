import { describe, expect, it } from 'vitest';
import {
  aCsv,
  aXlsx,
  analizarEntradas,
  analizarSalidas,
  fechaDe,
  importeDe,
  leerHoja,
  tablaEntradas,
  tablaTodasSalidas,
  tablasSalidas,
  type Entrada,
  type Salida,
} from '../src';

const entrada: Entrada = {
  recepcionId: 'r1',
  distribuidor: 'Distribuidora de Prueba',
  albaran: 'ALB-1',
  fechaCompra: '2025-03-14',
  fechaRecepcion: '2025-03-15',
  nombreFarmaco: 'CLAVUBAY 400 mg/100 mg',
  principioActivo: 'amoxicilina',
  forma: 'COMPRIMIDO',
  cn: '570016',
  lote: 'L1',
  caducidad: '2027-05-31',
  unidades: 3,
  precioNetoCompra: '6.8500',
  ivaPct: '10',
  rePct: '1.4',
  precioCoste: '6.9459',
  seriales: [],
  origenDatos: 'cimavet',
  empleado: 'x',
};
const salida = (o: Partial<Salida> = {}): Salida => ({
  id: 'd1',
  canal: 'presencial',
  conReceta: true,
  nombreFarmaco: 'CLAVUBAY 400 mg/100 mg',
  principioActivo: 'amoxicilina',
  forma: 'COMPRIMIDO',
  especie: 'Perros',
  fechaVenta: '2025-04-02',
  caducidad: '2027-05-31',
  lote: 'L1',
  cn: '570016',
  unidades: 1,
  unidadesTexto: '1 caja 10 comprimidos',
  fechaReceta: '2025-04-01',
  numeroReceta: 'R-1',
  veterinario: 'Vet Prueba',
  numColegiado: '28/1',
  clinica: 'Clínica',
  direccionVeterinario: 'Calle 1',
  propietario: null,
  tipoReceta: 'papel',
  plataforma: null,
  esSustitucion: false,
  forzado: false,
  defectosForzados: [],
  medicamentoPrescrito: null,
  autorizadoPor: null,
  empleado: 'x',
  metodoCaptura: 'camara',
  anulada: false,
  ...o,
});

describe('importar registros anteriores: lo que exporta la app se puede volver a importar', () => {
  it.each(['csv', 'xlsx'])('entradas en %s', async (formato) => {
    const t = tablaEntradas([entrada]);
    const bytes = formato === 'csv' ? new TextEncoder().encode(aCsv(t)) : new Uint8Array(await aXlsx([t]));
    const h = await leerHoja(bytes, `entradas.${formato}`);
    const a = analizarEntradas(h.cabecera, h.filas);
    expect(a.errores).toEqual([]);
    expect(a.filas).toEqual([
      {
        fila: 2,
        fecha: '2025-03-14',
        fechaRecepcion: '2025-03-15',
        distribuidor: 'Distribuidora de Prueba',
        albaran: 'ALB-1',
        nombreFarmaco: 'CLAVUBAY 400 mg/100 mg',
        principioActivo: 'amoxicilina',
        forma: 'COMPRIMIDO',
        cn: '570016',
        lote: 'L1',
        caducidad: '2027-05-31',
        unidades: 3,
        precioNetoCompra: '6.8500',
        ivaPct: '10',
        rePct: '1.4',
        precioCoste: '6.9459',
      },
    ]);
    // Columnas de trazabilidad de la app (empleado, origen…) se ignoran.
    expect(a.ignoradas).toEqual(expect.arrayContaining(['empleado', 'origen datos']));
  });

  it('salidas: «Todas las salidas» trae el tipo por fila; la plantilla A se importa eligiendo A', async () => {
    const todas = tablaTodasSalidas([
      salida(),
      salida({
        conReceta: false,
        numeroReceta: null,
        fechaReceta: null,
        veterinario: null,
        numColegiado: null,
      }),
    ]);
    const h1 = await leerHoja(new TextEncoder().encode(aCsv(todas)), 'todas.csv');
    const a1 = analizarSalidas(h1.cabecera, h1.filas, null);
    expect(a1.errores).toEqual([]);
    expect(a1.filas.map((f) => f.plantilla)).toEqual(['A', 'B']);
    expect(a1.filas[0]).toMatchObject({
      fecha: '2025-04-02',
      cn: '570016',
      unidades: 1,
      unidadesTexto: '1 caja 10 comprimidos',
      numeroReceta: 'R-1',
      veterinario: 'Vet Prueba',
    });
    const [tA] = tablasSalidas([salida()], 'A', { incluirPropietario: false, internas: 'ninguna' });
    const h2 = await leerHoja(new Uint8Array(await aXlsx([tA!])), 'a.xlsx');
    expect(analizarSalidas(h2.cabecera, h2.filas, null).errores[0]?.mensajes[0]).toMatch(
      /Indica la plantilla/,
    );
    expect(analizarSalidas(h2.cabecera, h2.filas, 'A').filas[0]).toMatchObject({
      plantilla: 'A',
      numColegiado: '28/1',
      clinica: 'Clínica',
    });
  });

  it('errores por fila y columnas obligatorias', () => {
    const cab = [
      'FECHA COMPRA',
      'NOMBRE DEL FÁRMACO',
      'UNIDADES',
      'DISTRIBUIDOR',
      'CÓDIGO NACIONAL',
      'CADUCIDAD',
      'PRECIO NETO COMPRA (sin IVA)',
    ];
    const a = analizarEntradas(cab, [
      ['31/02/2025', 'X', '0', '', '12AB', 'mañana', '1,2,3'],
      ['01/03/2025', 'Y', '2', 'Dist', '570016', '31/12/2026', '12,50'],
      [null, null, null, null, null, null, null],
    ]);
    expect(a.errores).toEqual([
      {
        fila: 2,
        mensajes: [
          'Fecha de compra no válida (usa dd/mm/aaaa)',
          'Caducidad no válida (usa dd/mm/aaaa)',
          'Falta el distribuidor',
          'Unidades no válidas (número entero de 1 o más)',
          'Código nacional no válido (6 o 7 cifras)',
          'Importe no válido en precio neto',
        ],
      },
    ]);
    expect(a.filas).toEqual([
      expect.objectContaining({
        fila: 3,
        nombreFarmaco: 'Y',
        precioNetoCompra: '12.50',
        caducidad: '2026-12-31',
      }),
    ]);
    expect(analizarEntradas(['LOTE'], []).errores[0]?.mensajes[0]).toMatch(
      /Faltan columnas obligatorias: NOMBRE DEL FÁRMACO, FECHA COMPRA, UNIDADES, DISTRIBUIDOR/,
    );
  });

  it.each([
    ['14/03/2025', '2025-03-14'],
    ['14-03-25', '2025-03-14'],
    ['2025-03-14', '2025-03-14'],
    ['29/02/2025', null],
    ['', null],
  ])('fecha %s → %s', (t, v) => expect(fechaDe(t)).toBe(v));

  it.each([
    ['12,50', '12.50'],
    ['1.234,5', '1234.5'],
    [12.5, '12.5'],
    ['12 €', '12'],
    ['doce', undefined],
    [null, null],
  ])('importe %s → %s', (t, v) => expect(importeDe(t as never)).toBe(v));
});
