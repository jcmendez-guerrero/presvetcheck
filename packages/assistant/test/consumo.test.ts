import { describe, expect, it } from 'vitest';
import { costeEstimado, estadoConsumo, mesMadrid } from '../src/consumo';

const base = { tokensEntrada: 0, tokensSalida: 0, limiteTokens: 1000 };

describe('estadoConsumo', () => {
  it.each([
    ['79 % → normal', 790, 0, null, 'normal'],
    ['80 % → aviso', 500, 300, null, 'aviso'],
    ['99 % → aviso', 0, 990, null, 'aviso'],
    ['100 % → en pausa', 600, 400, null, 'en_pausa'],
    ['por encima → en pausa', 2000, 0, null, 'en_pausa'],
    ['ampliado por encima de lo usado → normal', 1000, 0, 5000, 'normal'],
    ['ampliado, aviso', 1000, 3000, 5000, 'aviso'],
  ] as const)('%s', (_n, ent, sal, amp, esperado) => {
    expect(
      estadoConsumo({ ...base, tokensEntrada: ent, tokensSalida: sal, limiteAmpliado: amp }).estado,
    ).toBe(esperado);
  });

  it('calcula el porcentaje sobre el límite efectivo', () => {
    expect(estadoConsumo({ ...base, tokensEntrada: 250, limiteAmpliado: 500 })).toMatchObject({
      porcentaje: 50,
      limiteEfectivo: 500,
    });
  });
});

describe('mesMadrid', () => {
  it.each([
    ['2026-10-31T22:30:00Z', '2026-10'], // 23:30 en Madrid (CET)
    ['2026-10-31T23:30:00Z', '2026-11'], // 00:30 del 1/11 en Madrid, aún octubre en UTC
    ['2026-06-30T21:59:00Z', '2026-06'], // 23:59 en Madrid (CEST)
    ['2026-06-30T22:00:00Z', '2026-07'], // 00:00 del 1/7 en Madrid
  ])('%s → %s', (iso, mes) => {
    expect(mesMadrid(new Date(iso))).toBe(mes);
  });
});

describe('costeEstimado', () => {
  it('suma entrada y salida con decimal.js', () => {
    expect(costeEstimado(1_000_000, 500_000, { entradaPor1k: '0.0025', salidaPor1k: '0.01' })).toBe('7.50');
  });
  it('sin precios → null', () => {
    expect(costeEstimado(10, 10, {})).toBeNull();
  });
});
