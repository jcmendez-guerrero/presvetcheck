import { describe, expect, it } from 'vitest';
import { diaMadrid, horaMadridAUtc } from '../src/madrid';

describe('horas de Madrid', () => {
  it.each([
    ['invierno (CET)', '2026-11-03T10:15:00.000', '2026-11-03T09:15:00.000Z'],
    ['verano (CEST)', '2026-07-01T10:15:00.000', '2026-07-01T08:15:00.000Z'],
    ['medianoche de fin de mes', '2026-10-31T00:00:00.000', '2026-10-30T23:00:00.000Z'],
    ['tras el cambio de hora de octubre', '2026-10-25T04:00:00', '2026-10-25T03:00:00.000Z'],
    ['antes del cambio de hora de marzo', '2026-03-29T01:30:00', '2026-03-29T00:30:00.000Z'],
    ['tras el cambio de hora de marzo', '2026-03-29T04:00:00', '2026-03-29T02:00:00.000Z'],
    ['solo fecha', '2026-11-01', '2026-10-31T23:00:00.000Z'],
    ['ya con zona Z', '2026-11-05T10:00:00Z', '2026-11-05T10:00:00.000Z'],
    ['ya con desfase', '2026-11-05T10:00:00+01:00', '2026-11-05T09:00:00.000Z'],
  ])('horaMadridAUtc: %s', (_n, local, utc) => {
    expect(horaMadridAUtc(local).toISOString()).toBe(utc);
  });

  it.each([
    ['2026-11-03T22:59:59Z', '2026-11-03'],
    ['2026-11-03T23:00:00Z', '2026-11-04'],
    ['2026-07-01T21:59:59Z', '2026-07-01'],
    ['2026-07-01T22:00:00Z', '2026-07-02'],
  ])('diaMadrid(%s) = %s', (instante, dia) => {
    expect(diaMadrid(new Date(instante))).toBe(dia);
  });
});
