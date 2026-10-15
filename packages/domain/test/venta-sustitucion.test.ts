import { describe, expect, it } from 'vitest';
import type { DomainError, Rol } from '@mmx/shared';
import { dniNieValido, normalizarDni } from '../src/dni';
import { especieVentaSinReceta, validarPropietario, validarVentaSinReceta } from '../src/venta';
import {
  modoEfectivo,
  nuevaSustitucion,
  plantillaAvisoVeterinario,
  puedeDispensarSustitucion,
  sustitucionPermitida,
  textoAnotacionDorso,
  transicionSustitucion,
  type EstadoSustitucionCompleto,
  type EventoSustitucion,
} from '../src/sustitucion';
import { med, politica } from './builders';

const err = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return (e as DomainError).code;
  }
};

describe('DNI / NIE (D-07)', () => {
  it.each`
    valor           | valido
    ${'12345678Z'}  | ${true}
    ${'12345678-z'} | ${true}
    ${'12345678A'}  | ${false}
    ${'X1234567L'}  | ${true}
    ${'Y1234567X'}  | ${true}
    ${'Z1234567R'}  | ${true}
    ${'X1234567A'}  | ${false}
    ${'1234567Z'}   | ${false}
    ${''}           | ${false}
    ${null}         | ${false}
  `('$valor → $valido', ({ valor, valido }) => {
    expect(dniNieValido(valor)).toBe(valido);
  });
  it('normaliza', () => expect(normalizarDni(' 12.345.678-z ')).toBe('12345678Z'));
});

describe('venta sin receta y online (SPEC §4.7)', () => {
  const POL = politica();
  it('pedido online con medicamento sujeto a receta → bloqueo no forzable', () => {
    expect(validarVentaSinReceta('online', med({ receta: true }), POL)).toEqual([
      expect.objectContaining({ code: 'ONLINE_CON_RECETA', severidad: 'BLOQUEANTE_DURO' }),
    ]);
  });
  it('presencial con medicamento sujeto a receta → redirección al flujo de receta', () => {
    expect(validarVentaSinReceta('presencial', med({ receta: true }), POL).map((i) => i.code)).toEqual(['RECETA_REQUERIDA']);
  });
  it('no sujeto a receta → sin incidencias; estupefaciente siempre bloqueado', () => {
    expect(validarVentaSinReceta('online', med({ receta: false }), POL)).toEqual([]);
    expect(validarVentaSinReceta('presencial', med({ receta: false, estupefaciente: true }), POL).map((i) => i.code)).toEqual(['ESTUPEFACIENTE_NO_DISPENSABLE']);
  });
  const ok = { nombre: 'Cliente', movil: '600000000', direccion: 'Calle 1', dni: '12345678Z' };
  it.each`
    descripcion            | canal           | p                              | error
    ${'online completo'}   | ${'online'}     | ${ok}                          | ${'OK'}
    ${'online sin DNI'}    | ${'online'}     | ${{ ...ok, dni: null }}        | ${'DATOS_PROPIETARIO_ONLINE'}
    ${'online letra mala'} | ${'online'}     | ${{ ...ok, dni: '12345678A' }} | ${'DNI_INVALIDO'}
    ${'online sin datos'}  | ${'online'}     | ${null}                        | ${'DATOS_PROPIETARIO_ONLINE'}
    ${'online sin móvil'}  | ${'online'}     | ${{ ...ok, movil: ' ' }}       | ${'DATOS_PROPIETARIO_ONLINE'}
    ${'presencial vacío'}  | ${'presencial'} | ${null}                        | ${'OK'}
    ${'presencial DNI mal'} | ${'presencial'} | ${{ ...ok, dni: '1' }}        | ${'DNI_INVALIDO'}
  `('$descripcion → $error', ({ canal, p, error }) => {
    expect(err(() => validarPropietario(canal, p))).toBe(error);
  });
  it('especie en venta sin receta', () => {
    expect(especieVentaSinReceta('Gato', ['Perros'])).toBe('Gato');
    expect(especieVentaSinReceta(null, ['Perros', 'Gatos'])).toBe('Perros, Gatos');
  });
});

describe('sustitución: supuestos y modo', () => {
  it('permitida en ordinaria', () => {
    expect(sustitucionPermitida(med(), 'ordinaria', [])).toEqual({ permitida: true, motivos: [] });
  });
  it('modo efectivo: POST salvo aprobación previa necesaria', () => {
    expect(modoEfectivo('POST', { requiereAprobacionPrevia: false })).toBe('POST');
    expect(modoEfectivo('POST', { requiereAprobacionPrevia: true })).toBe('PRE');
    expect(modoEfectivo('PRE', { requiereAprobacionPrevia: false })).toBe('PRE');
  });
});

describe('máquina de estados de la sustitución (SPEC §4.4.3)', () => {
  const T = '2026-10-14T10:00:00Z';
  const consentir: EventoSustitucion = { tipo: 'CONSENTIMIENTO', consiente: true, medio: 'presencial', fechaHora: T, empleado: 'e1' };
  const avisar: EventoSustitucion = { tipo: 'AVISO_VETERINARIO', medio: 'teléfono', fechaHora: T, resultado: 'conforme', empleado: 'e1' };
  const run = (s: EstadoSustitucionCompleto, evs: [EventoSustitucion, Rol][]) => evs.reduce((acc, [e, rol]) => transicionSustitucion(acc, e, rol), s);

  const firma: EventoSustitucion = { tipo: 'FIRMAR', garante: 'Ana Garante', fechaHora: T, empleado: 'e1' };
  const autorizar = (o: Partial<{ garante: string; medio: string; confirmaIndicacionProbable: boolean }> = {}): EventoSustitucion => ({
    tipo: 'AUTORIZAR_PREVIA',
    garante: 'Ana Garante',
    medio: 'teléfono',
    fechaHora: T,
    empleado: 'e1',
    confirmaIndicacionProbable: true,
    ...o,
  });

  it('flujo POST completo: el empleado registra la firma del garante en la receta en papel', () => {
    const s = run(nuevaSustitucion('POST', false), [
      [consentir, 'empleado'],
      [avisar, 'empleado'],
      [{ tipo: 'DISPENSAR' }, 'empleado'],
      [{ tipo: 'APARTAR_RECETA' }, 'empleado'],
      [firma, 'empleado'],
    ]);
    expect(s.estado).toBe('FIRMADA_GARANTE');
    expect(s.firma).toEqual({ garante: 'Ana Garante', fechaHora: T, empleado: 'e1' });
  });

  it('sin consentimiento o sin aviso no se habilita dispensar', () => {
    const s0 = nuevaSustitucion('POST', false);
    expect(puedeDispensarSustitucion(s0)).toBe(false);
    expect(err(() => transicionSustitucion(s0, { tipo: 'DISPENSAR' }, 'empleado'))).toBe('SUSTITUCION_REQUISITOS');
    const s1 = transicionSustitucion(s0, consentir, 'empleado');
    expect(err(() => transicionSustitucion(s1, { tipo: 'DISPENSAR' }, 'empleado'))).toBe('SUSTITUCION_REQUISITOS');
  });

  it('urgencia justificada sustituye al aviso al veterinario', () => {
    const s = run(nuevaSustitucion('POST', false), [
      [consentir, 'empleado'],
      [{ tipo: 'URGENCIA', justificacion: 'Animal con dolor agudo, veterinario ilocalizable', fechaHora: T, empleado: 'e1' }, 'empleado'],
    ]);
    expect(s.urgencia?.justificacion).toMatch(/dolor/);
    expect(puedeDispensarSustitucion(s)).toBe(true);
    const corta: EventoSustitucion = { tipo: 'URGENCIA', justificacion: 'urgente', fechaHora: T, empleado: 'e1' };
    expect(err(() => run(nuevaSustitucion('POST', false), [[consentir, 'empleado'], [corta, 'empleado']]))).toBe('SUSTITUCION_REQUISITOS');
  });

  it('el tutor no consiente → RECHAZADA', () => {
    const s = transicionSustitucion(nuevaSustitucion('POST', false), { ...consentir, consiente: false } as EventoSustitucion, 'empleado');
    expect(s.estado).toBe('RECHAZADA');
  });

  it('modo PRE: el empleado registra la autorización del garante obtenida fuera (nombre, medio) y confirma la indicación PROBABLE', () => {
    const s0 = nuevaSustitucion('PRE', true);
    expect(s0.estado).toBe('PENDIENTE_AUTORIZACION_PREVIA');
    expect(err(() => transicionSustitucion(s0, consentir, 'empleado'))).toBe('TRANSICION_NO_PERMITIDA');
    expect(err(() => transicionSustitucion(s0, autorizar(), 'admin'))).toBe('PROHIBIDO');
    expect(err(() => transicionSustitucion(s0, autorizar({ confirmaIndicacionProbable: false }), 'empleado'))).toBe('SUSTITUCION_REQUISITOS');
    expect(err(() => transicionSustitucion(s0, autorizar({ garante: ' ' }), 'empleado'))).toBe('SUSTITUCION_REQUISITOS');
    expect(err(() => transicionSustitucion(s0, autorizar({ medio: '' }), 'empleado'))).toBe('SUSTITUCION_REQUISITOS');
    const s = run(s0, [
      [autorizar(), 'empleado'],
      [consentir, 'empleado'],
      [avisar, 'empleado'],
      [{ tipo: 'DISPENSAR' }, 'empleado'],
    ]);
    expect(s.estado).toBe('DISPENSADA');
    expect(s.autorizacionPrevia).toMatchObject({ garante: 'Ana Garante', medio: 'teléfono', empleado: 'e1' });
    expect(err(() => transicionSustitucion(s, autorizar(), 'empleado'))).toBe('TRANSICION_NO_PERMITIDA');
  });

  it('firma registrada: exige el nombre del garante y la receta apartada; admin no interviene', () => {
    const s = run(nuevaSustitucion('POST', false), [[consentir, 'empleado'], [avisar, 'empleado'], [{ tipo: 'DISPENSAR' }, 'empleado']]);
    expect(err(() => transicionSustitucion(s, firma, 'empleado'))).toBe('TRANSICION_NO_PERMITIDA');
    const ap = transicionSustitucion(s, { tipo: 'APARTAR_RECETA' }, 'empleado');
    expect(err(() => transicionSustitucion(ap, { ...firma, garante: '' } as EventoSustitucion, 'empleado'))).toBe('SUSTITUCION_REQUISITOS');
    expect(err(() => transicionSustitucion(ap, firma, 'admin'))).toBe('PROHIBIDO');
  });

  it('rechazos: antes de dispensar → RECHAZADA; después, no conforme según el garante (lo registra el empleado)', () => {
    const rech: EventoSustitucion = { tipo: 'RECHAZAR', actor: 'x', motivo: 'm', fechaHora: T };
    expect(transicionSustitucion(nuevaSustitucion('POST', false), rech, 'empleado').estado).toBe('RECHAZADA');
    const disp = run(nuevaSustitucion('POST', false), [[consentir, 'empleado'], [avisar, 'empleado'], [{ tipo: 'DISPENSAR' }, 'empleado']]);
    expect(err(() => transicionSustitucion(disp, rech, 'admin'))).toBe('PROHIBIDO');
    const nc = transicionSustitucion(disp, rech, 'empleado');
    expect(nc.estado).toBe('NO_CONFORME_GARANTE');
    expect(err(() => transicionSustitucion(nc, rech, 'empleado'))).toBe('TRANSICION_NO_PERMITIDA');
  });

  it('transiciones fuera de orden', () => {
    const s0 = nuevaSustitucion('POST', false);
    expect(err(() => transicionSustitucion(s0, avisar, 'empleado'))).toBe('TRANSICION_NO_PERMITIDA');
    expect(err(() => transicionSustitucion(s0, { tipo: 'APARTAR_RECETA' }, 'empleado'))).toBe('TRANSICION_NO_PERMITIDA');
    expect(err(() => transicionSustitucion(s0, firma, 'empleado'))).toBe('TRANSICION_NO_PERMITIDA');
    expect(err(() => transicionSustitucion(s0, autorizar({ confirmaIndicacionProbable: false }), 'empleado'))).toBe(
      'TRANSICION_NO_PERMITIDA',
    );
    expect(err(() => transicionSustitucion(s0, consentir, 'admin'))).toBe('PROHIBIDO');
  });

  it('plantillas de aviso y de anotación al dorso', () => {
    const t = plantillaAvisoVeterinario({
      prescrito: { nombre: 'A', cn: '1' },
      sustituto: { nombre: 'B', cn: '2', laboratorio: 'Lab' },
      lote: 'L1',
      motivo: 'sin stock',
      numeroReceta: 'R1',
      farmacia: 'Mundo Mascotix',
    });
    expect(t).toContain('CN 2, Lab), lote L1');
    expect(t).toContain('receta nº R1');
    const t2 = plantillaAvisoVeterinario({ prescrito: { nombre: 'A', cn: '1' }, sustituto: { nombre: 'B', cn: '2', laboratorio: null }, lote: null, motivo: 'm', numeroReceta: null, farmacia: 'F' });
    expect(t2).toContain('(CN 2).');
    expect(textoAnotacionDorso({ nombre: 'B', cn: '2', lote: 'L1', fecha: '14/10/2026' })).toContain('CN: 2   Lote: L1');
  });
});
