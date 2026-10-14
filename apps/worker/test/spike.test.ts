import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SiwebClient } from '@mmx/siweb';
import { ejecutarSpike } from '../src/spikes/spike-siweb';

const BASE = 'https://siweb.test/api/public/';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = new SiwebClient({ baseUrl: BASE, token: 't', rps: 1000, sleep: async () => {} });
const HOY = new Date('2026-10-14T10:00:00Z');
let ajustes: Array<Record<string, unknown>> = [];

function stockHandlers(conLote: boolean) {
  return [
    http.get(`${BASE}inventory/warehouses`, () => HttpResponse.json({ success: true, data: [{ id: 21, name: 'Farmacia' }] })),
    http.get(`${BASE}inventory/variants`, () => HttpResponse.json({ success: true, data: [{ id: 5, sku: 'TEST-0000-CN000000' }] })),
    http.get(`${BASE}inventory/variants/:id/lots`, () =>
      HttpResponse.json({ success: true, data: conLote ? [{ id: 1, lot_code: 'TEST-20261014', expiry_date: '2027-10-14', created_at: '2026-10-14' }] : [] }),
    ),
    http.get(`${BASE}inventory/variants/:id`, () =>
      HttpResponse.json({
        success: true,
        data: { id: 5, sku: 'TEST-0000-CN000000', is_infinite_stock: false, levels: conLote ? [{ warehouse_id: 21, lot_code: 'TEST-20261014', available: 1 }] : [] },
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
    const r = await ejecutarSpike({ client, sku: 'ZOETIS-0001-CN570016', almacen: { nombre: 'Farmacia' }, preguntar: async () => 'SI', log: () => {}, hoy: HOY });
    expect(r).toEqual({ ok: false, motivo: 'SKU_NO_TEST' });
  });

  it('no escribe nada sin confirmación explícita', async () => {
    ajustes = [];
    server.use(...stockHandlers(false));
    const r = await ejecutarSpike({ client, sku: 'TEST-0000-CN000000', almacen: { nombre: 'Farmacia' }, preguntar: async () => 'si', log: () => {}, hoy: HOY });
    expect(r).toEqual({ ok: false, motivo: 'CANCELADO' });
    expect(ajustes).toEqual([]);
  });

  it('con confirmación aplica +1 y revierte −1 sobre el lote TEST-AAAAMMDD', async () => {
    ajustes = [];
    server.use(...stockHandlers(true));
    const r = await ejecutarSpike({ client, sku: 'TEST-0000-CN000000', almacen: { nombre: 'Farmacia' }, preguntar: async () => 'SI', log: () => {}, hoy: HOY });
    expect(r).toMatchObject({ ok: true, lote: 'TEST-20261014', coherente: true, movimientos: [{ id: 1 }, { id: 2 }] });
    expect(ajustes.map((a) => [a.quantity, a.reason, a.batch_number])).toEqual([
      [1, 'purchase_receipt', 'TEST-20261014'],
      [-1, 'adjustment_negative', 'TEST-20261014'],
    ]);
  });

  it('variante inexistente o con stock ilimitado → no escribe', async () => {
    server.use(http.get(`${BASE}inventory/variants`, () => HttpResponse.json({ success: true, data: [] })));
    expect(await ejecutarSpike({ client, sku: 'TEST-X', almacen: { nombre: 'Farmacia' }, preguntar: async () => 'SI', log: () => {}, hoy: HOY })).toEqual({ ok: false, motivo: 'VARIANTE_NO_ENCONTRADA' });
    server.resetHandlers();
    server.use(
      http.get(`${BASE}inventory/variants/:id`, () => HttpResponse.json({ success: true, data: { id: 5, sku: 'TEST-0000-CN000000', is_infinite_stock: true } })),
      ...stockHandlers(false),
    );
    expect(await ejecutarSpike({ client, sku: 'TEST-0000-CN000000', almacen: { nombre: 'Farmacia' }, preguntar: async () => 'SI', log: () => {}, hoy: HOY })).toEqual({ ok: false, motivo: 'STOCK_ILIMITADO' });
  });
});
