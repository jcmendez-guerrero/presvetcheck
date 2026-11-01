import { describe, expect, it } from 'vitest';
import {
  parseFraccion,
  textoUnidadesDispensadas,
  tipoEnvase,
  unidadesEnvase,
  validarUnidadesFraccion,
} from '../src/fraccion';

describe('dispensación fraccionada (guía §5.9, DUDA-10)', () => {
  // Textos reales de `fracciones_autorizadas` del Nomenclátor.
  it.each([
    ['fracción: 1 blister de 10 comprimidos', 10, 'comprimido', null],
    ['6 fracciones de 3 comprimidos', 3, 'comprimido', 6],
    ['fracciones de 4 jeringas', 4, 'jeringa', null],
    ['10 fracciones de 1 blister de 10 comprimidos', 10, 'comprimido', 10],
    ['fracción: una pipeta', 1, 'pipeta', null],
    ['21 fracciones de 1 pipeta', 1, 'pipeta', 21],
    ['Blister de 10 comprimidos', 10, 'comprimido', null],
    ['9 fracciones de 16 comprimidos (2 blísteres)', 16, 'comprimido', 9],
    ['2 blister de 7 comprimidos', 14, 'comprimido', null],
    ['fracción: 1 frasco', 1, 'frasco', null],
    ['1 fracción de 1 vial de 50 dosis y 1 vial de PP de 100 ml de disolvente', 1, 'vial', null],
    ['10 fracciones de 1 blister con 1 aplicador', 1, 'aplicador', 10],
    ['Sobres con 4 Jeringas ', 4, 'jeringa', null],
    ['10 fracciones de 10 tubos', 10, 'tubo', 10],
    ['fracción: 1 blister de  6 comprimidos', 6, 'comprimido', null],
    ['100 fracciones de 1 comprimido', 1, 'comprimido', 100],
  ])('%s → %i %s', (texto, unidades, unidad, n) => {
    expect(parseFraccion(texto)).toEqual({ unidades, unidad, fraccionesEnvase: n, texto });
  });

  it.each([null, '', 'según ficha técnica', 'fracción: la mitad'])(
    'texto no interpretable (%s) → null (solo envases completos)',
    (t) => {
      expect(parseFraccion(t)).toBeNull();
    },
  );

  const benazecare = {
    fraccionable: true,
    fracciones: 'fracción: 1 blister de 14 comprimidos',
    contenido: '28',
    unidadContenido: 'Comprimido',
  };
  it.each([
    [14, null, true, null],
    [14, 14, true, null],
    [7, null, false, 'NO_MULTIPLO'],
    [21, null, false, 'NO_MULTIPLO'],
    [28, null, false, 'SUPERA_ENVASE'],
    [14, 10, false, 'SUPERA_PRESCRITAS'],
    [0, null, false, 'NO_MULTIPLO'],
    [14.5, null, false, 'NO_MULTIPLO'],
  ])(
    'BENAZECARE 28 comp. (fracción 14): %s unidades, prescritas %s → %s',
    (u, prescritas, valida, motivo) => {
      expect(validarUnidadesFraccion(benazecare, u, prescritas)).toEqual({ valida, motivo });
    },
  );

  it('presentación no fraccionable o fracción desconocida → solo envases completos', () => {
    expect(validarUnidadesFraccion({ ...benazecare, fraccionable: false }, 14, null).motivo).toBe(
      'NO_FRACCIONABLE',
    );
    expect(
      validarUnidadesFraccion(
        { fracciones: benazecare.fracciones, contenido: '28', unidadContenido: 'Comprimido' },
        14,
        null,
      ).motivo,
    ).toBe('NO_FRACCIONABLE');
    expect(validarUnidadesFraccion({ ...benazecare, fracciones: 'según ficha' }, 14, null).motivo).toBe(
      'FRACCION_DESCONOCIDA',
    );
  });

  it('envase en ml con fracciones en pipetas (ADVOCATE 8,4 ml, 21 fracciones de 1 pipeta)', () => {
    const advocate = {
      fraccionable: true,
      fracciones: '21 fracciones de 1 pipeta',
      contenido: '8.4',
      unidadContenido: 'ml',
    };
    expect(unidadesEnvase(advocate, parseFraccion(advocate.fracciones)!)).toBe(21);
    expect(validarUnidadesFraccion(advocate, 3, null)).toEqual({ valida: true, motivo: null });
    expect(validarUnidadesFraccion(advocate, 21, null).motivo).toBe('SUPERA_ENVASE');
    expect(
      unidadesEnvase({ contenido: null, unidadContenido: null }, parseFraccion('fracción: una pipeta')!),
    ).toBeNull();
  });

  it.each([
    [
      'CLAVUBAY 400 mg / 100 mg COMPRIMIDOS, Caja de cartón con 2 Blisters con 5 Comprimidos (10 comprimidos)',
      'caja',
    ],
    ['OTIMAX, Frasco de 10 ml', 'frasco'],
    ['VACUNA X, 10 viales de 1 dosis', 'vial'],
    ['PRODUCTO, Bidón de 5 l', 'bidón'],
    ['PRODUCTO, 1 Blister de 10', 'blíster'],
    ['SIN COMA', 'envase'],
  ])('tipoEnvase(%s) = %s', (n, t) => expect(tipoEnvase(n)).toBe(t));

  it('texto de UNIDADES DISPENSADAS del registro de salidas', () => {
    const caja = {
      nombre: 'X 5 mg, Caja con 2 blisters de 10 comprimidos',
      contenido: '20',
      unidadContenido: 'Comprimido',
    };
    const frasco = { nombre: 'Y 1 mg/ml, Frasco de 10 ml', contenido: '10', unidadContenido: 'ml' };
    expect(textoUnidadesDispensadas(caja, { envases: 1 })).toBe('1 caja 20 comprimidos');
    expect(textoUnidadesDispensadas(caja, { envases: 2 })).toBe('2 cajas 20 comprimidos');
    expect(textoUnidadesDispensadas(frasco, { envases: 1 })).toBe('1 frasco 10 ml');
    expect(textoUnidadesDispensadas({ ...frasco, contenido: '8.4' }, { envases: 1 })).toBe('1 frasco 8,4 ml');
    expect(textoUnidadesDispensadas({ ...caja, contenido: '1' }, { envases: 1 })).toBe('1 caja 1 comprimido');
    expect(textoUnidadesDispensadas({ ...caja, contenido: null }, { envases: 3 })).toBe('3 cajas');
    expect(textoUnidadesDispensadas(caja, { unidadesForma: 10 })).toBe(
      '10 comprimidos (fracción de caja 20 comprimidos)',
    );
    expect(textoUnidadesDispensadas(frasco, { unidadesForma: 3, unidad: 'pipeta' })).toBe(
      '3 pipetas (fracción de frasco 10 ml)',
    );
    expect(textoUnidadesDispensadas({ ...caja, unidadContenido: null }, { unidadesForma: 1 })).toBe(
      '1 unidad (fracción de caja)',
    );
    expect(
      textoUnidadesDispensadas(
        { nombre: 'Z, 2 Collar', contenido: '2', unidadContenido: 'Collar' },
        { envases: 1 },
      ),
    ).toBe('1 envase 2 collares');
  });
});
