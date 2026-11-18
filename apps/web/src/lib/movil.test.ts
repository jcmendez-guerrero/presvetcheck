import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { emparejamientoTerminado } from './movil';

const error = (status: number) => new ApiError(status, 'X', null);

describe('emparejamientoTerminado: cuándo el PC da por terminado el emparejamiento con el móvil (spec 016)', () => {
  it('la API dice que ya no está activa', () => {
    expect(emparejamientoTerminado({ activa: false, movilConectado: true, eventos: [] })).toBe(true);
  });

  it('una sesión activa sigue en marcha', () => {
    expect(emparejamientoTerminado({ activa: true, movilConectado: false, eventos: [] })).toBe(false);
  });

  it.each([401, 403, 404])('el %i de la API (caducada, cerrada o desconocida) lo termina', (s) => {
    expect(emparejamientoTerminado(error(s))).toBe(true);
  });

  it.each([500, 502, 503, 429])('el %i es temporal: se vuelve a consultar', (s) => {
    expect(emparejamientoTerminado(error(s))).toBe(false);
  });

  it('un fallo de red no termina el emparejamiento', () => {
    expect(emparejamientoTerminado(new TypeError('Failed to fetch'))).toBe(false);
    expect(emparejamientoTerminado(undefined)).toBe(false);
    expect(emparejamientoTerminado(null)).toBe(false);
  });
});
