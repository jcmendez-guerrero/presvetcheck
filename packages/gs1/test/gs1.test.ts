import { describe, expect, it } from 'vitest';
import { GS, bytesLegibles, cnDesdeGtin, esRafagaLector, gtinValido, parseGs1, type Gs1Ok } from '../src';

/** Añade el dígito de control GS1 a una base. */
function conControl(base: string): string {
  const sum = base
    .split('')
    .reverse()
    .reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return base + String((10 - (sum % 10)) % 10);
}

const EAN13 = conControl('847000570016'); // GTIN-13 español: 847000 + CN 570016
const GTIN14 = `0${EAN13}`;

const ok = (r: ReturnType<typeof parseGs1>): Gs1Ok => {
  if (!r.ok) throw new Error(`${r.error}: ${r.detalle}`);
  return r;
};

describe('parseGs1 (SPEC §4.6, §12.1 punto 4)', () => {
  it('GTIN-14 + caducidad + lote al final, sin separador GS', () => {
    const r = ok(parseGs1(`01${GTIN14}17271231` + '10LOTE123'));
    expect(r).toMatchObject({
      gtin: GTIN14,
      caducidad: '2027-12-31',
      lote: 'LOTE123',
      serie: null,
      cn: '570016',
      cnOrigen: 'heuristica_gtin',
    });
  });

  it('GTIN-14 con GS (FNC1 inicial) y lote en medio terminado en GS', () => {
    const r = ok(parseGs1(`${GS}01${GTIN14}10AB-12${GS}17270600` + '21SERIE9'));
    expect(r).toMatchObject({ lote: 'AB-12', caducidad: '2027-06-30', serie: 'SERIE9' });
  });

  it('caducidad con día 00 = último día del mes (incluido febrero bisiesto)', () => {
    expect(ok(parseGs1(`01${GTIN14}17280200` + '10L')).caducidad).toBe('2028-02-29');
    expect(ok(parseGs1(`01${GTIN14}17270200` + '10L')).caducidad).toBe('2027-02-28');
    expect(ok(parseGs1(`01${GTIN14}17271100` + '10L')).caducidad).toBe('2027-11-30');
  });

  it.each`
    prefijo  | simbologia
    ${']d2'} | ${'datamatrix'}
    ${']C1'} | ${'gs1-128'}
    ${']Q3'} | ${'qr'}
  `('acepta el prefijo de simbología $prefijo', ({ prefijo, simbologia }) => {
    const r = ok(parseGs1(`${prefijo}01${GTIN14}17271231` + '10L1'));
    expect(r.simbologia).toBe(simbologia);
    expect(r.lote).toBe('L1');
  });

  it.each(['~', '|'])('sustituto de GS configurable (%s)', (sub) => {
    const r = ok(parseGs1(`01${GTIN14}10L-77${sub}17270131` + `21S1`, { gsSubstitute: sub }));
    expect(r).toMatchObject({ lote: 'L-77', caducidad: '2027-01-31', serie: 'S1' });
  });

  it('sin sustituto configurado, un lote en medio sin GS se detecta como GS ausente', () => {
    const r = parseGs1(`01${GTIN14}10L-77~17270131` + `21S1`.padEnd(20, 'X'));
    expect(r).toMatchObject({ ok: false, error: 'GS_AUSENTE' });
  });

  it('EAN-13 sin identificadores de aplicación: solo GTIN (lote y caducidad a mano)', () => {
    const r = ok(parseGs1(EAN13));
    expect(r).toMatchObject({
      simbologia: 'ean13',
      gtin: GTIN14,
      lote: null,
      caducidad: null,
      cn: '570016',
      avisos: ['SOLO_GTIN'],
    });
    expect(ok(parseGs1(`]E0${EAN13}`)).simbologia).toBe('ean13');
  });

  it('EAN-13 con dígito de control erróneo', () => {
    const malo = EAN13.slice(0, 12) + String((Number(EAN13[12]) + 1) % 10);
    expect(parseGs1(malo)).toMatchObject({ ok: false, error: 'GTIN_CONTROL' });
  });

  it('EAN-13 no español → sin CN', () => {
    expect(ok(parseGs1(conControl('400638133393'))).cn).toBeNull();
  });

  it('formato legible con paréntesis', () => {
    const r = ok(parseGs1(`(01)${GTIN14}(17)270430(10)ABC(21)XYZ`));
    expect(r).toMatchObject({ caducidad: '2027-04-30', lote: 'ABC', serie: 'XYZ' });
  });

  it('(240), (710) y NHRN España (712) si aparecen', () => {
    const r = ok(parseGs1(`01${GTIN14}240REF-1${GS}710PZN123${GS}7125700163${GS}17271231` + '10L'));
    expect(r.ais['240']).toBe('REF-1');
    expect(r.ais['710']).toBe('PZN123');
    expect(r.cn).toBe('570016');
    expect(r.cnOrigen).toBe('nhrn_712');
  });

  it('avisa si el NHRN España no coincide con el CN del GTIN', () => {
    expect(ok(parseGs1(`01${GTIN14}712999999${GS}10L`)).avisos).toContain('CN_NHRN_DISTINTO_DE_GTIN');
  });

  it('avisa de lote o caducidad ausentes', () => {
    expect(ok(parseGs1(`01${GTIN14}`)).avisos).toEqual(['SIN_LOTE', 'SIN_CADUCIDAD']);
  });

  it('acepta CR/LF final del lector', () => {
    expect(ok(parseGs1(`01${GTIN14}10L1\r\n`)).lote).toBe('L1');
  });

  it.each`
    entrada                        | error
    ${''}                          | ${'VACIO'}
    ${'   '}                       | ${'VACIO'}
    ${'HOLA'}                      | ${'FORMATO_DESCONOCIDO'}
    ${'(HOLA)'}                    | ${'FORMATO_DESCONOCIDO'}
    ${`99${'1'.repeat(10)}`}       | ${'AI_DESCONOCIDO'}
    ${'0112345'}                   | ${'LONGITUD'}
    ${`01${GTIN14.slice(0, 13)}9`} | ${'GTIN_CONTROL'}
    ${`01${GTIN14}17271332`}       | ${'FECHA_INVALIDA'}
    ${`01${GTIN14}17270231`}       | ${'FECHA_INVALIDA'}
    ${`01${GTIN14}17ABCDEF`}       | ${'LONGITUD'}
  `('error $error para "$entrada"', ({ entrada, error }) => {
    expect(parseGs1(entrada)).toMatchObject({ ok: false, error });
  });

  it('siglo de la fecha con año de referencia (regla GS1 ±50 años)', () => {
    expect(ok(parseGs1(`01${GTIN14}17991231`, { anioReferencia: 2026 })).caducidad).toBe('1999-12-31');
    expect(ok(parseGs1(`01${GTIN14}17751231`, { anioReferencia: 2026 })).caducidad).toBe('2075-12-31');
    expect(ok(parseGs1(`01${GTIN14}17301231`, { anioReferencia: 2080 })).caducidad).toBe('2130-12-31');
  });
});

describe('utilidades', () => {
  it('dígito de control', () => {
    expect(gtinValido(GTIN14)).toBe(true);
    expect(gtinValido('123')).toBe(false);
  });
  it('heurística CN', () => {
    expect(cnDesdeGtin(EAN13)).toBe('570016');
    expect(cnDesdeGtin(null)).toBeNull();
    expect(cnDesdeGtin('1234')).toBeNull();
  });
  it('ráfaga de lector HID (< 50 ms entre caracteres)', () => {
    expect(esRafagaLector([0, 10, 20, 30, 40, 50])).toBe(true);
    expect(esRafagaLector([0, 10, 20, 120, 130, 140])).toBe(false);
    expect(esRafagaLector([0, 10])).toBe(false);
  });
  it('bytes legibles para "Probar lector"', () => {
    expect(bytesLegibles(`01${GS}10\r\n\u0004`)).toBe('01<GS>10<CR><LF><4>');
  });
});

/** Milisegundos que tarda `f` (para comprobar que las expresiones tienen coste lineal con textos patológicos). */
const ms = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe('parseGs1 con lecturas patológicas: coste lineal (CodeQL js/polynomial-redos)', () => {
  const n = 100_000;
  it.each([
    ['saltos de línea seguidos de un carácter', () => parseGs1('\r\n'.repeat(n / 2) + 'x')],
    ['solo saltos de línea', () => parseGs1('\n'.repeat(n))],
  ])('%s: < 1 s con 100 000 caracteres', (_n, f) => expect(ms(f)).toBeLessThan(1000));

  it('sigue quitando los saltos de línea finales del lector', () => {
    expect(parseGs1('0108712345678906\r\n\n')).toEqual(parseGs1('0108712345678906'));
  });
});
