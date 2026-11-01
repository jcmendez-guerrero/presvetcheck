import { describe, expect, it } from 'vitest';
import { camposDesdeLayout, prescriptorDesdeTexto, titularDesdeTexto, destinoDeEtiqueta, limpiarValor, separarEtiqueta } from '../src/azure/reglas-layout';

const region = [{ pageNumber: 1, polygon: [0, 0, 1, 0, 1, 1, 0, 1] }];
const kv = (key: string, value: string | null, confidence = 0.99) => ({ key: { content: key }, ...(value === null ? {} : { value: { content: value, boundingRegions: region } }), confidence });

describe('reglas de prebuilt-layout (sin modelo entrenado)', () => {
  it.each([
    ['Número de receta:', 'numero'],
    ['Nº Colegiado:', 'veterinarioNumColegiado'],
    ['Número de colegiado:', 'veterinarioNumColegiado'],
    ['Fecha prescripción', 'fechaEmision'],
    ['Diagnóstico:', 'indicacion'],
    ['Afección a tratar', 'indicacion'],
    ['Especie clase animal cánidos', 'especie'],
    ['Fármaco:', 'medicamento'],
    ['Denominación y presentación del medicamento', 'medicamento'],
    ['Cód.nac.:', 'cn'],
    ['Nº Envases:', 'cantidadEnvases'],
    ['Vía administración', 'via'],
    ['Duración (días):', 'duracionDias'],
  ])('«%s» → %s', (etiqueta, campo) => expect(destinoDeEtiqueta(etiqueta)?.campo).toBe(campo));

  it.each(['Nombre:', 'NIF:', 'Teléfono:', 'Dirección:', 'Email:', 'DNI:', 'Cantidad :'])('nunca toma datos ambiguos o del propietario: «%s»', (e) => {
    expect(destinoDeEtiqueta(e)).toBeNull();
  });

  it.each([
    ['21 Vía admin .: VÍA ORAL C.', '21'],
    ['AMODIP 1,25 MG', 'AMODIP 1,25 MG'],
    ['- Tipo', null],
    ['admin .:', null],
    ['CANINA,', 'CANINA'],
    [null, null],
  ])('limpia «%s» → %s', (v, esperado) => expect(limpiarValor(v)).toBe(esperado));

  it('separa etiqueta y valor pegados y descarta claves de varias líneas', () => {
    expect(separarEtiqueta('Especie:CANINA,', null)).toEqual({ etiqueta: 'especie', valor: 'CANINA,' });
    expect(separarEtiqueta('Via TOPICA', undefined)).toEqual({ etiqueta: 'via', valor: 'TOPICA' });
    expect(separarEtiqueta('Fecha:\nResponsable:', 'x')).toBeNull();
    expect(separarEtiqueta('Fármaco:', 'X 5 MG')).toEqual({ etiqueta: 'Fármaco:', valor: 'X 5 MG' });
    expect(separarEtiqueta('Otra', null)).toEqual({ etiqueta: 'Otra', valor: null });
  });

  it('campos de receta y líneas (una línea por medicamento), con confianza rebajada y respaldo por texto', () => {
    const r = {
      content: 'Receta 12345 Fármaco: PRUEBAVET 5 MG Cód.nac.: 999901 Nº Colegiado: 2801234',
      keyValuePairs: [
        kv('Número de receta:', '12345'),
        kv('Fecha:', '14/10/2026'),
        kv('Nombre:', 'Persona Ficticia'),
        kv('Especie:', 'CANINA'),
        kv('Fármaco:', 'PRUEBAVET 5 MG'),
        kv('Dosis:', '1 comprimido cada 12 h'),
        kv('Duración (días):', '6 Meses'),
        kv('Nº Envases:', '1,00'),
        kv('Fármaco:', 'OTROVET 10 MG'),
        kv('Nº Envases:', '2'),
        kv('Nº Envases:', '3'),
        kv('Vigencia:', null),
      ],
    };
    const m = camposDesdeLayout(r, 1, []);
    expect(Object.keys(m.receta).sort()).toEqual(['especie', 'fechaEmision', 'numero', 'veterinarioNumColegiado']);
    expect(m.receta.numero).toMatchObject({ valor: '12345', fuente: 'ocr', evidencia: { pagina: 1 } });
    expect(m.receta.numero?.confianza).toBeCloseTo(0.99 * 0.9);
    // Colegiado sacado del texto (sin región: máximo 0,5).
    expect(m.receta.veterinarioNumColegiado).toMatchObject({ valor: '2801234', confianza: 0.5 });
    expect(m.lineas.map((l) => [l.medicamento?.valor, l.cantidadEnvases?.valor, l.duracionDias?.valor])).toEqual([
      ['PRUEBAVET 5 MG', 1, 180],
      ['OTROVET 10 MG', 2, undefined],
      [undefined, 3, undefined],
    ]);
    expect(m.lineas[0]?.cn).toBeUndefined(); // varias líneas: el código del texto no se asigna a ciegas
  });

  it('una sola línea sin código en los pares: el código nacional del texto se le asigna', () => {
    const m = camposDesdeLayout({ content: 'Cód. nac.: 584159', keyValuePairs: [kv('Fármaco:', 'PRUEBAVET')] }, 1, []);
    expect(m.lineas[0]?.cn).toMatchObject({ valor: '584159', confianza: 0.5 });
    expect(camposDesdeLayout({ content: 'C.N. 584159' }, 1, []).lineas).toEqual([]);
  });

  it('formato en una sola línea: dosis (dosis + unidades + frecuencia) y duración desde el texto', () => {
    const content = 'Cantidad: 30,00 Fármaco: PRUEBAVET 1,25 MG 30 COMP. Dosis: 1 Unidades: COMPRIMIDOS Frecuencia: 24\nho Duración (días): 30 Vía admin.: VÍA ORAL';
    const m = camposDesdeLayout({ content, keyValuePairs: [kv('Fármaco:', 'PRUEBAVET 1,25 MG')] }, 1, []);
    expect(m.lineas[0]?.duracionDias?.valor).toBe(30);
    expect(m.lineas[0]?.dosis?.valor).toBe('1 comprimidos cada 24 h');
  });

  it('formato en una sola línea: cada valor acaba en la etiqueta siguiente; nombre completo, vía y tipo de dispensación', () => {
    const content =
      'Cantidad: 30,00 Fármaco: PRUEBAVET 1,25 MG 30 COMP. Dosis: 1 Unidades: COMPRIMIDOS Frecuencia: 24 ho Duración (días): 30 Vía admin .: VÍA ORAL C. Tratamiento: Terapéutico Principio activo: - Tipo dispensación: Dispensación %Env.total: 100,0 Cód.nac .: 584159 Nº Envases: 1';
    const m = camposDesdeLayout({ content, keyValuePairs: [kv('Fármaco:', 'PRUEBAVET 1,25 MG 30')] }, 1, []);
    const l = m.lineas[0]!;
    expect(l.medicamento?.valor).toBe('PRUEBAVET 1,25 MG 30 COMP');
    expect(l.dosis?.valor).toBe('1 comprimidos cada 24 h');
    expect(l.duracionDias?.valor).toBe(30);
    expect(l.via?.valor).toBe('ORAL');
    expect(l.cn?.valor).toBe('584159');
    expect(m.receta.tipoDispensacion?.valor).toBe('Dispensación');
  });
});

describe('titular: solo dentro de su bloque', () => {
  it('formato Medivet: nombre, DNI, teléfonos y dirección del bloque CLIENTE (no el de la mascota)', () => {
    const t = titularDesdeTexto(
      'CLIENTE: Nombre: PRUEBA GARCÍA, ANA\nNIF: 12345678Z Teléfono: 912000000600000000 Dirección: C/ FALSA 1 - 28100 Provincia: Madrid - Alcobendas\nMASCOTA:\nNombre: ROCKY\nEspecie: CANINA',
    );
    expect(t).toEqual({ titularNombre: 'PRUEBA GARCÍA, ANA', titularDni: '12345678Z', titularTelefono: '912000000 / 600000000', titularDireccion: 'C/ FALSA 1 - 28100, Madrid - Alcobendas' });
  });

  it('sin bloque de titular no se toma ningún «Nombre:»', () => {
    expect(titularDesdeTexto('Nombre: ROCKY\nResponsable: Dra. Pérez\nTeléfono: 912000000')).toEqual({});
  });

  it('los campos del titular quedan con confianza baja (se revisan)', () => {
    const m = camposDesdeLayout({ content: 'PROPIETARIO: Nombre: ANA PRUEBA Teléfono: 600000000\nPACIENTE: Nombre: TOBY' }, 1, []);
    expect(m.receta.titularNombre).toMatchObject({ valor: 'ANA PRUEBA' });
    expect(m.receta.titularNombre!.confianza).toBeLessThan(0.85);
    expect(m.receta.titularTelefono?.valor).toBe('600000000');
  });

  it('datos del veterinario de su bloque («DATOS DEL PRESCRIPTOR»), incluida la dirección', () => {
    const texto =
      'Receta nº 99 Fecha: 13/10/2026\nDATOS DEL PRESCRIPTOR\nNombre: VETERINARIA DE PRUEBA Nº Col: 2800000\nDirección: CALLE FALSA, 1 LOCAL 2\nCP: 28000 Población: MADRID Provincia: MADRID\nTeléfono: 910000000 / 600 00 00 00 Email: CONSULTA@CLINICA-PRUEBA.ES\nDATOS DEL CLIENTE\nNombre: TITULAR DE PRUEBA\nDirección: OTRA CALLE 5';
    expect(prescriptorDesdeTexto(texto)).toEqual({
      veterinarioNombre: 'VETERINARIA DE PRUEBA',
      veterinarioDireccion: 'CALLE FALSA, 1 LOCAL 2, 28000 MADRID, MADRID',
      veterinarioTelefono: '910000000 / 600 00 00 00',
      veterinarioEmail: 'consulta@clinica-prueba.es',
    });
    const m = camposDesdeLayout({ content: texto }, 1, []);
    expect(m.receta.veterinarioDireccion?.valor).toBe('CALLE FALSA, 1 LOCAL 2, 28000 MADRID, MADRID');
    expect(m.receta.veterinarioDireccion!.confianza).toBeLessThan(0.85);
  });

  it('sin bloque del prescriptor no se toma ninguna dirección como del veterinario', () => {
    expect(prescriptorDesdeTexto('CLIENTE: Nombre: ANA\nDirección: C/ FALSA 1')).toEqual({});
  });
});

/** Milisegundos que tarda `f` (para comprobar que las expresiones tienen coste lineal con textos patológicos). */
const ms = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe('respaldo por texto del OCR con contenidos patológicos: coste lineal (CodeQL js/polynomial-redos)', () => {
  const n = 100_000;
  it.each([
    ['«código nacional» y espacios', 'código nacional' + ' '.repeat(n) + 'x'],
    ['«cód. nac.» con separadores y espacios', 'cód. nac' + ' '.repeat(n / 2) + '.' + ' '.repeat(n / 2) + 'x'],
    ['«nº colegiado» y espacios', 'nº colegiado' + ' '.repeat(n) + 'x'],
    ['«colegiado :» y espacios', 'colegiado' + ' '.repeat(n / 2) + ':' + ' '.repeat(n / 2) + 'x'],
  ])('%s: < 1 s con 100 000 caracteres', (_n, content) => expect(ms(() => camposDesdeLayout({ content }, 1, []))).toBeLessThan(1000));

  it('sigue leyendo el CN y el nº de colegiado con separadores', () => {
    const m = camposDesdeLayout({ content: 'Código nacional . : 584159 Nº de colegiado : 2801234', keyValuePairs: [kv('Fármaco:', 'PRUEBAVET')] }, 1, []);
    expect(m.lineas[0]?.cn).toMatchObject({ valor: '584159' });
    expect(m.receta.veterinarioNumColegiado).toMatchObject({ valor: '2801234' });
  });
});
