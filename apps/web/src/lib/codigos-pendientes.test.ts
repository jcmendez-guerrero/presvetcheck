import { describe, expect, it } from 'vitest';
import {
  CADUCIDAD_PENDIENTE_MS,
  CodigosPendientes,
  MAX_PENDIENTES,
  segundosRestantes,
} from './codigos-pendientes';

const reloj = (t0 = 1_000_000) => {
  const r = { t: t0, ahora: () => r.t };
  return r;
};

describe('CodigosPendientes: códigos del móvil sin campo de escaneo abierto (spec 016)', () => {
  it('un código recibido queda pendiente; usarlo lo entrega una sola vez', () => {
    const c = new CodigosPendientes(reloj().ahora);
    c.recibir('A');
    expect(c.instantanea().pendientes.map((p) => p.raw)).toEqual(['A']);
    expect(c.usar()).toBe('A');
    expect(c.usar()).toBeNull();
    expect(c.instantanea().pendientes).toEqual([]);
  });

  it('varios códigos se conservan y se usan en orden de llegada (FR-009)', () => {
    const c = new CodigosPendientes(reloj().ahora);
    ['A', 'B', 'C'].forEach((x) => c.recibir(x));
    expect([c.usar(), c.usar(), c.usar()]).toEqual(['A', 'B', 'C']);
  });

  it('un sexto código descarta el más antiguo y lo avisa', () => {
    const c = new CodigosPendientes(reloj().ahora);
    ['1', '2', '3', '4', '5', '6'].forEach((x) => c.recibir(x));
    const i = c.instantanea();
    expect(i.pendientes).toHaveLength(MAX_PENDIENTES);
    expect(i.pendientes.map((p) => p.raw)).toEqual(['2', '3', '4', '5', '6']);
    expect(i.aviso).toBe('exceso');
  });

  it('caduca a los 5 minutos: se descarta con aviso de caducado', () => {
    const r = reloj();
    const c = new CodigosPendientes(r.ahora);
    c.recibir('A');
    r.t += CADUCIDAD_PENDIENTE_MS - 1;
    expect(c.instantanea().pendientes).toHaveLength(1);
    r.t += 1;
    const i = c.instantanea();
    expect(i.pendientes).toEqual([]);
    expect(i.aviso).toBe('caducado');
    expect(c.usar()).toBeNull();
  });

  it('caduca cada uno por su cuenta: queda el más reciente', () => {
    const r = reloj();
    const c = new CodigosPendientes(r.ahora);
    c.recibir('viejo');
    r.t += 200_000;
    c.recibir('nuevo');
    r.t += 150_000; // viejo: 350 s; nuevo: 150 s
    expect(c.usar()).toBe('nuevo');
    expect(c.instantanea().aviso).toBe('caducado');
  });

  it('el aviso dura hasta que llega un código nuevo o se cierra', () => {
    const r = reloj();
    const c = new CodigosPendientes(r.ahora);
    c.recibir('A');
    r.t += CADUCIDAD_PENDIENTE_MS;
    expect(c.instantanea().aviso).toBe('caducado');
    expect(c.instantanea().aviso).toBe('caducado');
    c.descartarAviso();
    expect(c.instantanea().aviso).toBeNull();
    c.recibir('B');
    r.t += CADUCIDAD_PENDIENTE_MS;
    c.instantanea();
    c.recibir('C');
    expect(c.instantanea().aviso).toBeNull();
  });

  it('cuenta atrás: segundos que le quedan al código', () => {
    const r = reloj();
    const c = new CodigosPendientes(r.ahora);
    c.recibir('A');
    const p = c.instantanea().pendientes[0]!;
    expect(segundosRestantes(p, r.t)).toBe(300);
    expect(segundosRestantes(p, r.t + 299_001)).toBe(1);
    expect(segundosRestantes(p, r.t + 400_000)).toBe(0);
  });
});
