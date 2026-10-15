import { describe, expect, it } from 'vitest';
import { camposDesdeLayout, destinoDeEtiqueta, limpiarValor, separarEtiqueta } from '../src/azure/reglas-layout';

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
});
