import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SiwebClient } from '../src/client';
import { ejecutarSpike, esPruebaVigente } from '../src/prueba-escritura';

const BASE = 'https://siweb.test/api/public/';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = new SiwebClient({ baseUrl: BASE, token: 't', rps: 1000, sleep: async () => {} });
const HOY = new Date('2026-10-14T10:00:00Z');
let ajustes: Array<Record<string, unknown>> = [];

function stockHandlers(conLote: boolean, notasEnHistorial = true) {
  return [
    http.get(`${BASE}inventory/movements`, () =>
      HttpResponse.json({
        success: true,
        data: notasEnHistorial
          ? ajustes.map((a, i) => ({
              id: i + 1,
              variant_id: 5,
              quantity: a.quantity,
              reason: a.reason,
              notes: a.notes,
            }))
          : ajustes.map((a, i) => ({
              id: i + 1,
              variant_id: 5,
              quantity: a.quantity,
              reason: a.reason,
              notes: null,
            })),
      }),
    ),
    http.get(`${BASE}inventory/warehouses`, () =>
      HttpResponse.json({ success: true, data: [{ id: 21, name: 'Farmacia' }] }),
    ),
    http.get(`${BASE}inventory/variants`, () =>
      HttpResponse.json({ success: true, data: [{ id: 5, sku: 'TEST-0000-CN000000' }] }),
    ),
    http.get(`${BASE}inventory/variants/:id/lots`, () =>
      HttpResponse.json({
        success: true,
        data: conLote
          ? [{ id: 1, lot_code: 'TEST-20261014', expiry_date: '2027-10-14', created_at: '2026-10-14' }]
          : [],
      }),
    ),
    http.get(`${BASE}inventory/variants/:id`, () =>
      HttpResponse.json({
        success: true,
        data: {
          id: 5,
          sku: 'TEST-0000-CN000000',
          is_infinite_stock: false,
          stock_levels: conLote
            ? [{ warehouse_id: 21, batch_number: 'TEST-20261014', expiry_date: '2027-10-14', available: 1 }]
            : [],
        },
      }),
    ),
    http.post(`${BASE}inventory/stock/adjustments`, async ({ request }) => {
      ajustes.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ success: true, data: { variant_id: 5, movement: { id: ajustes.length } } });
    }),
  ];
}

describe('spike de escritura en Siweb360 (SPEC §12.3)', () => {
  it('se niega si el SKU no empieza por TEST-', async () => {
    const r = await ejecutarSpike({
      client,
      sku: 'ZOETIS-0001-CN570016',
      almacen: { nombre: 'Farmacia' },
      preguntar: async () => 'SI',
      log: () => {},
      hoy: HOY,
    });
    expect(r).toEqual({ ok: false, motivo: 'SKU_NO_TEST' });
  });

  it('no escribe nada sin confirmación explícita', async () => {
    ajustes = [];
    server.use(...stockHandlers(false));
    const r = await ejecutarSpike({
      client,
      sku: 'TEST-0000-CN000000',
      almacen: { nombre: 'Farmacia' },
      preguntar: async () => 'si',
      log: () => {},
      hoy: HOY,
    });
    expect(r).toEqual({ ok: false, motivo: 'CANCELADO' });
    expect(ajustes).toEqual([]);
  });

  it('con confirmación aplica +1 y revierte −1 sobre el lote TEST-AAAAMMDD', async () => {
    ajustes = [];
    server.use(...stockHandlers(true));
    const r = await ejecutarSpike({
      client,
      sku: 'TEST-0000-CN000000',
      almacen: { nombre: 'Farmacia' },
      preguntar: async () => 'SI',
      log: () => {},
      hoy: HOY,
    });
    expect(r).toMatchObject({
      ok: true,
      lote: 'TEST-20261014',
      variantId: 5,
      coherente: true,
      historialOk: true,
      movimientos: [{ id: 1 }, { id: 2 }],
    });
    expect(ajustes.map((a) => a.notes)).toEqual([
      'MMX-SPIKE-20261014-ENTRADA',
      'MMX-SPIKE-20261014-REVERSION',
    ]);
    expect(ajustes.map((a) => [a.quantity, a.reason, a.batch_number])).toEqual([
      [1, 'purchase_receipt', 'TEST-20261014'],
      [-1, 'adjustment_negative', 'TEST-20261014'],
    ]);
  });

  it('si el historial no devuelve las notas, historialOk es falso (la prueba no vale)', async () => {
    ajustes = [];
    server.use(...stockHandlers(true, false));
    const r = await ejecutarSpike({
      client,
      sku: 'TEST-0000-CN000000',
      almacen: { nombre: 'Farmacia' },
      preguntar: async () => 'SI',
      log: () => {},
      hoy: HOY,
    });
    expect(r).toMatchObject({ ok: true, coherente: true, historialOk: false });
  });

  it('si el historial falla, historialOk es falso y no se lanza', async () => {
    ajustes = [];
    server.use(
      http.get(`${BASE}inventory/movements`, () => HttpResponse.json({ success: false }, { status: 400 })),
      ...stockHandlers(true),
    );
    const r = await ejecutarSpike({
      client,
      sku: 'TEST-0000-CN000000',
      almacen: { nombre: 'Farmacia' },
      preguntar: async () => 'SI',
      log: () => {},
      hoy: HOY,
    });
    expect(r).toMatchObject({ ok: true, historialOk: false });
  });

  it.each([
    ['sin prueba', null, false],
    ['hace 29 días', new Date('2026-09-15T10:00:00Z'), true],
    ['hace 30 días justos', new Date('2026-09-14T10:00:00Z'), true],
    ['hace 31 días', new Date('2026-09-13T10:00:00Z'), false],
  ])('vigencia de la prueba: %s', (_n, fecha, esperado) => {
    expect(esPruebaVigente(fecha, HOY)).toBe(esperado);
  });

  it('variante inexistente o con stock ilimitado → no escribe', async () => {
    server.use(http.get(`${BASE}inventory/variants`, () => HttpResponse.json({ success: true, data: [] })));
    expect(
      await ejecutarSpike({
        client,
        sku: 'TEST-X',
        almacen: { nombre: 'Farmacia' },
        preguntar: async () => 'SI',
        log: () => {},
        hoy: HOY,
      }),
    ).toEqual({ ok: false, motivo: 'VARIANTE_NO_ENCONTRADA' });
    server.resetHandlers();
    server.use(
      http.get(`${BASE}inventory/variants/:id`, () =>
        HttpResponse.json({
          success: true,
          data: { id: 5, sku: 'TEST-0000-CN000000', is_infinite_stock: true },
        }),
      ),
      ...stockHandlers(false),
    );
    expect(
      await ejecutarSpike({
        client,
        sku: 'TEST-0000-CN000000',
        almacen: { nombre: 'Farmacia' },
        preguntar: async () => 'SI',
        log: () => {},
        hoy: HOY,
      }),
    ).toEqual({ ok: false, motivo: 'STOCK_ILIMITADO' });
  });
});
