import { describe, expect, it } from 'vitest';
import { horaMadridAUtc, type MotivoJustificacion } from '@mmx/shared';
import {
  conciliarMovimientos,
  exigirMotivoCompatible,
  type ContextoConciliacionMovimientos,
  type MovimientoSiweb,
} from '../src/conciliacion-movimientos';

const CLAVE = 'MMX-REC-00000000-0000-4000-8000-000000000001-L1';
const ctx: ContextoConciliacionMovimientos = {
  corte: horaMadridAUtc('2026-11-01'),
  almacenId: 21,
  lineasRecepcion: new Map([[CLAVE, 'linea-1']]),
  ventas: [{ ticketId: '7001', cn: '570016', dispensacionId: 'disp-1' }],
  yaJustificados: new Set([99]),
};
const mov = (o: Partial<MovimientoSiweb>): MovimientoSiweb => ({
  id: 1,
  variantId: 9001,
  cn: '570016',
  warehouseId: 21,
  quantity: 1,
  reason: 'purchase_receipt',
  referenceId: null,
  notes: null,
  fecha: horaMadridAUtc('2026-11-03T10:00:00'),
  ...o,
});

describe('conciliarMovimientos', () => {
  it.each<[string, Partial<MovimientoSiweb>, string]>([
    [
      'entrada con la clave de una línea → vinculada a la recepción',
      { notes: CLAVE, quantity: 5 },
      'AUTO_RECEPCION',
    ],
    [
      'entrada con la clave y un espacio → sin justificar (igualdad exacta)',
      { notes: `${CLAVE} `, quantity: 5 },
      'SIN',
    ],
    ['clave en minúsculas → sin justificar', { notes: CLAVE.toLowerCase(), quantity: 5 }, 'SIN'],
    ['clave de una línea que no existe → sin justificar', { notes: `${CLAVE}0`, quantity: 5 }, 'SIN'],
    ['salida con la clave de recepción → sin justificar', { notes: CLAVE, quantity: -1 }, 'SIN'],
    ['entrada manual sin nota → sin justificar', { quantity: 3 }, 'SIN'],
    [
      'venta de un ticket conciliado con el mismo CN → vinculada a la dispensación',
      { quantity: -1, reason: 'sale_shipment', referenceId: '7001' },
      'AUTO_VENTA',
    ],
    [
      'venta de un ticket conciliado pero de otro CN → sin justificar',
      { quantity: -1, cn: '590948', referenceId: '7001' },
      'SIN',
    ],
    ['venta de un ticket no conciliado → sin justificar', { quantity: -1, referenceId: '7999' }, 'SIN'],
    ['rotura → sin justificar', { quantity: -1, reason: 'damage', notes: 'Caja rota' }, 'SIN'],
    ['variante no mapeada a un CN → ignorado', { cn: null }, 'NO_MEDICAMENTO'],
    ['otro almacén → ignorado', { warehouseId: 22 }, 'OTRO_ALMACEN'],
    ['ya justificado → ignorado', { id: 99 }, 'YA_JUSTIFICADO'],
    [
      'un segundo antes de la medianoche de Madrid del corte → ignorado',
      { fecha: horaMadridAUtc('2026-10-31T23:59:59') },
      'ANTERIOR_AL_CORTE',
    ],
    ['la medianoche de Madrid del corte → cuenta', { fecha: horaMadridAUtc('2026-11-01T00:00:00') }, 'SIN'],
  ])('%s', (_n, o, esperado) => {
    const r = conciliarMovimientos([mov(o)], ctx);
    const id = o.id ?? 1;
    if (esperado === 'SIN') expect(r.sinJustificar).toEqual([id]);
    else if (esperado.startsWith('AUTO_'))
      expect(r.vinculados).toEqual([expect.objectContaining({ movimientoId: id, tipo: esperado })]);
    else expect(r.ignorados).toEqual([{ movimientoId: id, motivo: esperado }]);
  });

  it('corte en verano: la medianoche de Madrid es a las 22:00 UTC del día anterior', () => {
    const c = { ...ctx, corte: horaMadridAUtc('2026-07-01') };
    const r = conciliarMovimientos(
      [
        mov({ id: 1, fecha: new Date('2026-06-30T21:59:59Z') }),
        mov({ id: 2, fecha: new Date('2026-06-30T22:00:00Z') }),
      ],
      c,
    );
    expect(r.ignorados).toEqual([{ movimientoId: 1, motivo: 'ANTERIOR_AL_CORTE' }]);
    expect(r.sinJustificar).toEqual([2]);
  });

  it('una venta repartida en varios movimientos se vincula entera a la misma dispensación', () => {
    const r = conciliarMovimientos(
      [mov({ id: 1, quantity: -1, referenceId: '7001' }), mov({ id: 2, quantity: -2, referenceId: '7001' })],
      ctx,
    );
    expect(r.vinculados.map((v) => [v.movimientoId, v.tipo === 'AUTO_VENTA' && v.dispensacionId])).toEqual([
      [1, 'disp-1'],
      [2, 'disp-1'],
    ]);
  });

  it.todo(
    'falta fixtures/siweb/movements-ticket.json real: confirmar qué reference_type y reference_id lleva una venta del TPV',
  );
});

describe('exigirMotivoCompatible', () => {
  it.each<[MotivoJustificacion, number, boolean]>([
    ['ROTURA', -1, true],
    ['ROTURA', 1, false],
    ['CADUCADO', -2, true],
    ['CADUCADO', 2, false],
    ['ROBO_PERDIDA', 1, false],
    ['DEVOLUCION_PROVEEDOR', -1, true],
    ['DEVOLUCION_CLIENTE', 1, true],
    ['DEVOLUCION_CLIENTE', -1, false],
    ['REVISION_INVENTARIO', 1, true],
    ['REVISION_INVENTARIO', -1, true],
    ['REVISION_LOTE', -1, true],
    ['REVISION_CADUCIDAD', 1, true],
    ['OTRO', -1, true],
  ])('%s con %i unidades → válido: %s', (motivo, unidades, valido) => {
    const f = () => exigirMotivoCompatible(motivo, unidades);
    if (valido) expect(f).not.toThrow();
    else expect(f).toThrow(expect.objectContaining({ code: 'MOTIVO_INCOMPATIBLE' }));
  });
});
