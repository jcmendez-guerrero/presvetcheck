import { describe, expect, it } from 'vitest';
import { evaluarMovimientosRetrospectivos, type MovimientoStockSimple } from '../src/conciliacion';

describe('evaluarMovimientosRetrospectivos', () => {
  const movsValidos: MovimientoStockSimple[] = [
    {
      id: 101,
      variantId: 8812,
      quantity: -2,
      reason: 'sale_shipment',
      date: '2026-10-30',
    },
    {
      id: 102,
      variantId: 8812,
      quantity: -1,
      reason: 'sale_shipment',
      date: '2026-10-30',
    },
    {
      id: 103,
      variantId: 8812,
      quantity: 5,
      reason: 'purchase_receipt', // positive entry, not a sale
      date: '2026-10-30',
    },
    {
      id: 104,
      variantId: 8812,
      quantity: -1,
      reason: 'damage', // not a sale
      date: '2026-10-30',
    },
  ];

  it('determina OK si los movimientos de venta (sale_shipment) cubren las unidades requeridas', () => {
    const res = evaluarMovimientosRetrospectivos({
      cn: '570016',
      fechaOriginal: '2026-10-30',
      hoy: '2026-11-06',
      unidadesRequeridas: 3,
      movimientos: movsValidos,
    });

    expect(res.estado).toBe('OK');
    expect(res.unidadesEncontradas).toBe(3);
    expect(res.incidencias.length).toBe(0);
  });

  it('determina MOVIMIENTO_PARCIAL si hay ventas pero menos de las pedidas', () => {
    const res = evaluarMovimientosRetrospectivos({
      cn: '570016',
      fechaOriginal: '2026-10-30',
      hoy: '2026-11-06',
      unidadesRequeridas: 5,
      movimientos: movsValidos,
    });

    expect(res.estado).toBe('MOVIMIENTO_PARCIAL');
    expect(res.unidadesEncontradas).toBe(3);
    expect(res.incidencias.some((i) => i.code === 'SIN_MOVIMIENTO_STOCK_RETROSPECTIVO')).toBe(true);
    expect(res.incidencias.find((i) => i.code === 'SIN_MOVIMIENTO_STOCK_RETROSPECTIVO')?.severidad).toBe(
      'BLOQUEANTE_FORMA',
    );
  });

  it('determina SIN_MOVIMIENTO si no hay ventas en esa fecha', () => {
    const res = evaluarMovimientosRetrospectivos({
      cn: '570016',
      fechaOriginal: '2026-10-30',
      hoy: '2026-11-06',
      unidadesRequeridas: 2,
      movimientos: [],
    });

    expect(res.estado).toBe('SIN_MOVIMIENTO');
    expect(res.unidadesEncontradas).toBe(0);
    expect(res.incidencias.some((i) => i.code === 'SIN_MOVIMIENTO_STOCK_RETROSPECTIVO')).toBe(true);
  });

  it('emite AVISO si la fecha original tiene más de maxAgeDays de antigüedad', () => {
    const res = evaluarMovimientosRetrospectivos({
      cn: '570016',
      fechaOriginal: '2026-06-01',
      hoy: '2026-11-06',
      maxAgeDays: 90,
      unidadesRequeridas: 2,
      movimientos: [{ id: 1, variantId: 1, quantity: -2, reason: 'sale_shipment', date: '2026-06-01' }],
    });

    expect(res.estado).toBe('OK');
    expect(res.incidencias.some((i) => i.code === 'AVISO_FECHA_RETROSPECTIVA_ANTIGUA')).toBe(true);
  });
});
