import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { auditEvent, outbox, siwebMovimiento } from '@mmx/db';
import { OutboxService, SiwebClient } from '@mmx/siweb';
import { api, entorno, type Entorno } from './entorno';

/** Escritura de stock en Siweb360 y conciliación de movimientos (specs/011): rutas, roles y errores. */
const BASE = 'https://siweb.test/api/public/';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = new SiwebClient({
  baseUrl: BASE,
  token: 't',
  rps: 1000,
  sleep: async () => {},
  maxRetries: 0,
});

async function conSiweb(config: Record<string, string> = {}): Promise<Entorno> {
  const e = await entorno({ config: { ENTRY_CUTOVER_DATE: '2026-10-01', ...config } });
  e.deps.siweb = {
    client,
    resolver: null as never,
    bandeja: null as never,
    catalogo: null as never,
    outbox: new OutboxService(e.h.db, client, {
      modo: 'entries_only',
      almacenId: async () => 21,
      pruebaVigente: async () => null,
    }),
    stockActual: async () => ({ total_on_hand: 3 }),
    proveedores: async () => [],
  };
  return e;
}

describe('prueba de escritura y estado del stock (US4)', () => {
  it('solo administración; SKU sin TEST- → 400 y queda auditado', async () => {
    const { app, h } = await conSiweb();
    const body = { sku: 'TEST-0000-CN000000', confirmacion: 'SI' };
    expect((await api(app, 'dev-empleado', 'POST', '/api/admin/siweb/prueba-escritura', body)).status).toBe(
      403,
    );
    expect(
      (
        await api(app, 'dev-admin', 'POST', '/api/admin/siweb/prueba-escritura', {
          ...body,
          confirmacion: 'si',
        })
      ).status,
    ).toBe(400);
    const r = await api(app, 'dev-admin', 'POST', '/api/admin/siweb/prueba-escritura', {
      sku: 'ZOETIS-0001-CN570016',
      confirmacion: 'SI',
    });
    expect(r.status).toBe(400);
    expect((r.json as { error: { code: string } }).error.code).toBe('SKU_NO_TEST');
    const audit = await h.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.entidadId, 'ZOETIS-0001-CN570016'));
    expect(audit[0]?.despues).toMatchObject({ ok: false, motivo: 'SKU_NO_TEST' });
  });

  it('una prueba superada queda auditada y el estado del stock la muestra vigente', async () => {
    const { app } = await conSiweb();
    const ajustes: Array<{ notes?: string; quantity: number }> = [];
    server.use(
      http.get(`${BASE}inventory/warehouses`, () =>
        HttpResponse.json({ success: true, data: [{ id: 21, name: 'Farmacia' }] }),
      ),
      http.get(`${BASE}inventory/variants`, () =>
        HttpResponse.json({ success: true, data: [{ id: 5, sku: 'TEST-0000-CN000000' }] }),
      ),
      http.get(`${BASE}inventory/variants/:id/lots`, () =>
        HttpResponse.json({
          success: true,
          data: [{ id: 1, lot_code: 'TEST-20261014', expiry_date: '2027-10-14' }],
        }),
      ),
      http.get(`${BASE}inventory/variants/:id`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: 5,
            sku: 'TEST-0000-CN000000',
            is_infinite_stock: false,
            stock_levels: [
              { warehouse_id: 21, batch_number: 'TEST-20261014', expiry_date: '2027-10-14', available: 1 },
            ],
          },
        }),
      ),
      http.post(`${BASE}inventory/stock/adjustments`, async ({ request }) => {
        ajustes.push((await request.json()) as { notes?: string; quantity: number });
        return HttpResponse.json({
          success: true,
          data: { variant_id: 5, movement: { id: ajustes.length } },
        });
      }),
      http.get(`${BASE}inventory/movements`, () =>
        HttpResponse.json({
          success: true,
          data: ajustes.map((a, i) => ({
            id: i + 1,
            variant_id: 5,
            quantity: a.quantity,
            reason: 'x',
            notes: a.notes,
          })),
        }),
      ),
    );
    const antes = await api(app, 'dev-admin', 'GET', '/api/admin/estado-stock');
    expect(antes.json).toMatchObject({
      escrituraStock: 'off',
      fechaCorte: '2026-10-01',
      almacenStock: 'Farmacia',
    });
    const r = await api(app, 'dev-admin', 'POST', '/api/admin/siweb/prueba-escritura', {
      sku: 'TEST-0000-CN000000',
      confirmacion: 'SI',
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, coherente: true, historialOk: true, variantId: 5 });
    const estado = await api(app, 'dev-admin', 'GET', '/api/admin/estado-stock');
    expect(estado.json).toMatchObject({ pruebaEscrituraVigente: true });
    expect((await api(app, 'dev-empleado', 'GET', '/api/admin/estado-stock')).status).toBe(403);
  });
});

describe('envíos a Siweb360 en revisión (US2)', () => {
  it('cualquier usuario cierra; reenviar sigue siendo de administración', async () => {
    const { app, h } = await conSiweb();
    const [f] = await h.db
      .insert(outbox)
      .values({
        operation: 'stock_adjustment_entry',
        payload: { variant_id: 9001, warehouse_id: 21, quantity: 1, reason: 'purchase_receipt' },
        idempotencyKey: 'MMX-REC-api-test-L1',
        status: 'needs_reconciliation',
        lastError: 'No consta en Siweb360 a 2026-10-14T10:00:00.000Z',
      })
      .returning();
    const id = f!.id;
    const lista = await api(app, 'dev-empleado', 'GET', '/api/outbox/revision');
    expect(lista.status).toBe(200);
    expect(lista.json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, evidencia: expect.stringMatching(/No consta/) }),
      ]),
    );
    const reenviar = await api(app, 'dev-empleado', 'POST', `/api/admin/outbox/${id}/resolver`, {
      accion: 'reenviar',
      nota: 'No aplicado',
    });
    expect(reenviar.status).toBe(403);
    const corta = await api(app, 'dev-empleado', 'POST', `/api/outbox/${id}/cerrar`, {
      accion: 'revisado',
      nota: 'x',
    });
    expect(corta.status).toBe(400);
    const ok = await api(app, 'dev-empleado', 'POST', `/api/outbox/${id}/cerrar`, {
      accion: 'resuelto_a_mano',
      nota: 'Dado de alta a mano',
    });
    expect(ok.status).toBe(200);
    const [g] = await h.db.select().from(outbox).where(eq(outbox.id, id));
    expect(g).toMatchObject({ status: 'resolved_manually', resolvedBy: 'dev-empleado' });
    const otra = await api(app, 'dev-empleado', 'POST', `/api/outbox/${id}/cerrar`, {
      accion: 'revisado',
      nota: 'Otra vez',
    });
    expect(otra.status).toBe(409);
  });
});

describe('movimientos de Siweb360 sin justificar (US3)', () => {
  it('lista, justifica, sustituye y valida', async () => {
    const { app, h } = await conSiweb();
    const base = {
      variantId: 9001,
      cn: '570016',
      warehouseId: 21,
      reason: 'damage',
      createdAtSiweb: new Date('2026-10-12T09:00:00Z'),
      leidoAt: new Date('2026-10-13T19:00:00Z'),
    };
    await h.db.insert(siwebMovimiento).values([
      { ...base, id: 910001, quantity: -1, batchNumber: 'A2026' },
      { ...base, id: 910002, quantity: 2, reason: 'purchase_receipt' },
      { ...base, id: 910003, quantity: -1, createdAtSiweb: new Date('2026-09-20T09:00:00Z') },
    ]);
    const l = await api(app, 'dev-empleado', 'GET', '/api/movimientos-siweb?estado=sin_justificar');
    expect(l.status).toBe(200);
    const ids = (l.json as { movimientos: Array<{ id: number }> }).movimientos.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([910001, 910002]));
    expect(ids).not.toContain(910003); // anterior al corte

    const justificar = (id: number, b: unknown) =>
      api(app, 'dev-empleado', 'POST', `/api/movimientos-siweb/${id}/justificar`, b);
    const mal = await justificar(910001, { tipo: 'MOTIVO', motivo: 'DEVOLUCION_CLIENTE', nota: 'No encaja' });
    expect(mal.status).toBe(422);
    expect((mal.json as { error: { code: string } }).error.code).toBe('MOTIVO_INCOMPATIBLE');
    expect((await justificar(910001, { tipo: 'MOTIVO', motivo: 'OTRO', nota: '' })).status).toBe(400);
    const ok = await justificar(910001, {
      tipo: 'MOTIVO',
      motivo: 'ROTURA',
      nota: 'Caja rota en el almacén',
    });
    expect(ok.status).toBe(200);
    const sust = await justificar(910001, {
      tipo: 'MOTIVO',
      motivo: 'CADUCADO',
      nota: 'Era un envase caducado',
    });
    expect((sust.json as { sustituyeA: string }).sustituyeA).toBe((ok.json as { id: string }).id);
    const despues = await api(app, 'dev-empleado', 'GET', '/api/movimientos-siweb?estado=sin_justificar');
    expect(
      (despues.json as { movimientos: Array<{ id: number }> }).movimientos.map((m) => m.id),
    ).not.toContain(910001);
    expect((await justificar(1, { tipo: 'MOTIVO', motivo: 'OTRO', nota: 'No existe' })).status).toBe(404);

    // Registro de bajas (FR-009d): la rotura sustituida queda como baja y anulación, y la vigente como baja.
    const reg = await api(
      app,
      'dev-empleado',
      'GET',
      '/api/registros/bajas?desde=2026-10-01&hasta=2026-10-31',
    );
    expect(reg.status).toBe(200);
    const filas = (reg.json as { tablas: Array<{ filas: unknown[][] }> }).tablas[0]!.filas;
    expect(filas.map((f) => [f[1], f[2], f[4], f[5], f[6]])).toEqual([
      ['BAJA', '570016', 'A2026', 1, 'Rotura'],
      ['ANULACIÓN BAJA', '570016', 'A2026', 1, 'Rotura'],
      ['BAJA', '570016', 'A2026', 1, 'Caducado'],
    ]);
  });

  it('sin fecha de corte la bandeja está vacía', async () => {
    const { app } = await conSiweb({ ENTRY_CUTOVER_DATE: '' });
    const r = await api(app, 'dev-empleado', 'GET', '/api/movimientos-siweb');
    expect(r.json).toEqual({ corte: null, movimientos: [] });
  });
});
