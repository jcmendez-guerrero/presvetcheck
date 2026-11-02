import { describe, expect, it } from 'vitest';
import type { FuenteCitada, SimulacionGuardada } from '@mmx/shared';
import { validarSalida, type EstadoTurno } from '../src/citas';

const fuente = (id: string): FuenteCitada => ({
  fuenteId: id,
  tipo: 'regla',
  titulo: id,
  version: 'v1@abcd',
});
const sim = (id: string): SimulacionGuardada => ({
  simulacionId: id,
  herramienta: 'simular_validez',
  decision: 'VALIDA_HASTA',
  motivos: [],
  evidencias: {},
  supuestos: {},
  reglaVersion: 'validez.v1@abcd',
});
const turno = (over: Partial<EstadoTurno> = {}): EstadoTurno => ({
  fuentes: new Map([['regla:validez', fuente('regla:validez')]]),
  simulaciones: new Map(),
  llamoContextoLinea: false,
  ...over,
});
const salida = (o: Record<string, unknown> = {}) => ({
  tipo: 'respondida',
  texto: 'Cinco días desde la emisión.',
  fuentes: ['regla:validez'],
  simulaciones: [],
  usaContextoLinea: false,
  ...o,
});

describe('validarSalida', () => {
  it('acepta una salida correcta', () => {
    const r = validarSalida(JSON.stringify(salida()), turno());
    expect(r.ok).toBe(true);
    expect(r.errores).toEqual([]);
  });

  it.each([
    ['V1 JSON no válido', 'esto no es json', turno(), 'V1'],
    ['V1 tipo desconocido', JSON.stringify(salida({ tipo: 'otra' })), turno(), 'V1'],
    [
      'V2 fuente no devuelta en el turno',
      JSON.stringify(salida({ fuentes: ['regla:inventada'] })),
      turno(),
      'V2',
    ],
    ['V3 respondida sin fuentes', JSON.stringify(salida({ fuentes: [] })), turno(), 'V3'],
    ['V4 simulación inexistente', JSON.stringify(salida({ simulaciones: ['s9'] })), turno(), 'V4'],
  ])('%s', (_n, entrada, t, codigo) => {
    const r = validarSalida(entrada, t);
    expect(r.ok).toBe(false);
    expect(r.errores.map((e) => e.codigo)).toContain(codigo);
  });

  it('sin_informacion no necesita fuentes', () => {
    expect(validarSalida(salida({ tipo: 'sin_informacion', fuentes: [] }), turno()).ok).toBe(true);
  });

  it('V5 añade las simulaciones del turno que el modelo omitió', () => {
    const r = validarSalida(salida(), turno({ simulaciones: new Map([['s1', sim('s1')]]) }));
    expect(r.salida?.simulaciones).toEqual(['s1']);
  });

  it('V6 fuerza usaContextoLinea a false si no se llamó a contexto_linea', () => {
    expect(validarSalida(salida({ usaContextoLinea: true }), turno()).salida?.usaContextoLinea).toBe(false);
    expect(
      validarSalida(salida({ usaContextoLinea: true }), turno({ llamoContextoLinea: true })).salida
        ?.usaContextoLinea,
    ).toBe(true);
  });

  it('V7 elimina datos personales del texto', () => {
    const r = validarSalida(salida({ texto: 'Llama al 612345678 o al DNI 12345678Z.' }), turno());
    expect(r.salida?.texto).not.toMatch(/612345678|12345678Z/);
    expect(r.salida?.texto).toContain('[dato eliminado]');
  });
});
