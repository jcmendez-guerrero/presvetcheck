import { describe, expect, it } from 'vitest';
import { ahoraIso, fixedClock, hoy } from '../src/clock';
import { comparar, diasEntre, fechaEs, minFecha, sumarDias, sumarPlazo, ultimoDiaMes } from '../src/fechas';

describe('reloj y fechas en Europe/Madrid', () => {
  it.each`
    instante                  | esperado
    ${'2026-10-14T21:59:00Z'} | ${'2026-10-14'}
    ${'2026-10-14T22:00:00Z'} | ${'2026-10-15'}
    ${'2026-03-28T23:30:00Z'} | ${'2026-03-29'}
    ${'2026-10-24T22:30:00Z'} | ${'2026-10-25'}
    ${'2026-10-25T00:30:00Z'} | ${'2026-10-25'}
    ${'2026-12-31T23:00:00Z'} | ${'2027-01-01'}
  `('hoy($instante) = $esperado (cambio de hora y medianoche local)', ({ instante, esperado }) => {
    expect(hoy(fixedClock(instante))).toBe(esperado);
  });

  it('ahoraIso devuelve el instante UTC', () => {
    expect(ahoraIso(fixedClock('2026-10-14T10:00:00Z'))).toBe('2026-10-14T10:00:00Z');
  });

  it('aritmética de plazos', () => {
    expect(sumarPlazo('2026-03-31', { meses: 1 })).toBe('2026-04-30');
    expect(sumarPlazo('2026-10-25', { dias: 5 })).toBe('2026-10-30');
    expect(sumarDias('2026-12-30', 3)).toBe('2027-01-02');
    expect(comparar('2026-01-01', '2026-01-02')).toBe(-1);
    expect(minFecha('2026-05-01', '2026-04-01')).toBe('2026-04-01');
    expect(minFecha('2026-04-01', '2026-05-01')).toBe('2026-04-01');
    expect(diasEntre('2026-10-08', '2026-10-14')).toBe(6);
    expect(fechaEs('2026-02-03')).toBe('03/02/2026');
    expect(ultimoDiaMes(2028, 2)).toBe('2028-02-29');
    expect(ultimoDiaMes(2026, 12)).toBe('2026-12-31');
  });
});
