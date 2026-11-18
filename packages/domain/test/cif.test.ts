import { describe, expect, it } from 'vitest';
import { normalizarCif } from '../src/precio';

describe('normalizarCif (specs/016)', () => {
  it.each([
    ['B12345678', 'B12345678'],
    ['b-12.345.678', 'B12345678'],
    [' B 1234 5678 ', 'B12345678'],
    ['ESB12345678', 'B12345678'],
    ['es b12345678', 'B12345678'],
    ['12345678Z', '12345678Z'],
    ['ESTRELLA1', 'ESTRELLA1'],
    ['', null],
    ['  - ', null],
    [null, null],
    [undefined, null],
  ])('%j → %j', (entrada, esperado) => {
    expect(normalizarCif(entrada)).toBe(esperado);
  });
});
