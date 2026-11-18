import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { auditEvent, distribuidor, outbox } from '@mmx/db';
import { OPERACION_ACTUALIZAR_COSTE_PROVEEDOR, OutboxService, SiwebClient } from '@mmx/siweb';
import { api, entorno, type Entorno } from './entorno';

/** Vincular a mano el proveedor de Siweb360 de un distribuidor y reactivar sus costes pendientes (specs/016). */
const BASE = 'https://siweb.test/api/public/';
const fx = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/siweb', f), 'utf8'));
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

async function conSiweb(): Promise<Entorno> {
  const e = await entorno();
  e.deps.siweb = {
    client,
    resolver: null as never,
    bandeja: null as never,
    catalogo: null as never,
    outbox: new OutboxService(e.h.db, client, {
      modo: 'entries_only',
      almacenId: async () => 21,
      pruebaVigente: async () => new Date(),
    }),
    stockActual: async () => ({}),
    proveedores: async () => [],
  };
  return e;
}
const ruta = (id: string) => `/api/admin/distribuidores/${id}/proveedor-siweb`;

async function nuevoDistribuidor(e: Entorno, cif: string | null = 'B12345678') {
  const r = await api(e.app, 'dev-admin', 'POST', '/api/admin/distribuidores', {
    nombre: `Distribuidora ${Math.random().toString(36).slice(2, 8)}`,
    cif,
  });
  expect(r.status).toBe(201);
  return (r.json as { id: string }).id;
}
const contacto = (id: number, cif: string | null) =>
  server.use(
    http.get(`${BASE}contacts/${id}`, () =>
      HttpResponse.json({ success: true, data: { ...fx('doc-contact-detail.json').data, id, cif } }),
    ),
  );

describe('POST /api/admin/distribuidores/:id/proveedor-siweb (specs/016)', () => {
  it('solo administración', async () => {
    const e = await conSiweb();
    const id = await nuevoDistribuidor(e);
    const r = await api(e.app, 'dev-empleado', 'POST', ruta(id), { contactId: 41 });
    expect(r.status).toBe(403);
  });

  it('vincula, guarda el contacto, reactiva los costes pendientes y audita', async () => {
    const e = await conSiweb();
    const id = await nuevoDistribuidor(e);
    contacto(41, 'b-12.345.678');
    await e.h.db.insert(outbox).values({
      operation: OPERACION_ACTUALIZAR_COSTE_PROVEEDOR,
      payload: { variant_id: 9001, distribuidor_id: id, cost_cents: 1014 } as never,
      idempotencyKey: `MMX-PRV-test-${id}`,
      status: 'needs_supplier',
      lastError: 'SIN_COINCIDENCIA',
    });
    const r = await api(e.app, 'dev-admin', 'POST', ruta(id), { contactId: 41 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ reactivadas: 1 });
    const [d] = await e.h.db.select().from(distribuidor).where(eq(distribuidor.id, id));
    expect(d!.siwebContactId).toBe(41);
    const [f] = await e.h.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `MMX-PRV-test-${id}`));
    expect(f!.status).toBe('pending');
    const audit = await e.h.db.select().from(auditEvent).where(eq(auditEvent.entidadId, id));
    expect(audit.map((a) => a.accion)).toContain('distribuidor_vincular_siweb');
  });

  it('contacto inexistente → SIWEB_PROVEEDOR_NO_EXISTE y no se guarda nada', async () => {
    const e = await conSiweb();
    const id = await nuevoDistribuidor(e);
    server.use(http.get(`${BASE}contacts/999`, () => HttpResponse.json({ success: false }, { status: 404 })));
    const r = await api(e.app, 'dev-admin', 'POST', ruta(id), { contactId: 999 });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('SIWEB_PROVEEDOR_NO_EXISTE');
    const [d] = await e.h.db.select().from(distribuidor).where(eq(distribuidor.id, id));
    expect(d!.siwebContactId).toBeNull();
  });

  it('CIF distinto: pide confirmación; con confirmarCifDistinto vincula', async () => {
    const e = await conSiweb();
    const id = await nuevoDistribuidor(e, 'B12345678');
    contacto(42, 'F87654321');
    const sin = await api(e.app, 'dev-admin', 'POST', ruta(id), { contactId: 42 });
    expect(sin.status).toBe(409);
    expect(sin.json.error.code).toBe('SIWEB_PROVEEDOR_CIF_DISTINTO');
    const con = await api(e.app, 'dev-admin', 'POST', ruta(id), {
      contactId: 42,
      confirmarCifDistinto: true,
    });
    expect(con.status).toBe(200);
    const [d] = await e.h.db.select().from(distribuidor).where(eq(distribuidor.id, id));
    expect(d!.siwebContactId).toBe(42);
  });

  it('un contacto ya vinculado a otro distribuidor se rechaza', async () => {
    const e = await conSiweb();
    const a = await nuevoDistribuidor(e);
    const b = await nuevoDistribuidor(e);
    contacto(51, 'B12345678');
    expect((await api(e.app, 'dev-admin', 'POST', ruta(a), { contactId: 51 })).status).toBe(200);
    const r = await api(e.app, 'dev-admin', 'POST', ruta(b), { contactId: 51 });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('SIWEB_PROVEEDOR_YA_VINCULADO');
  });

  it('distribuidor inexistente → 404', async () => {
    const e = await conSiweb();
    const r = await api(e.app, 'dev-admin', 'POST', ruta('00000000-0000-4000-8000-000000000000'), {
      contactId: 41,
    });
    expect(r.status).toBe(404);
  });

  it('el listado del outbox indica el distribuidor de cada coste pendiente', async () => {
    const e = await conSiweb();
    const id = await nuevoDistribuidor(e, 'B12345678');
    await e.h.db.insert(outbox).values({
      operation: OPERACION_ACTUALIZAR_COSTE_PROVEEDOR,
      payload: { variant_id: 9001, distribuidor_id: id, cost_cents: 1014 } as never,
      idempotencyKey: `MMX-PRV-lista-${id}`,
      status: 'needs_supplier',
      lastError: 'SIN_CIF',
    });
    const r = await api(e.app, 'dev-admin', 'GET', '/api/admin/outbox?estado=needs_supplier');
    expect(r.status).toBe(200);
    const fila = (
      r.json as Array<{ idempotencyKey: string; distribuidor: { id: string; cif: string } | null }>
    ).find((f) => f.idempotencyKey === `MMX-PRV-lista-${id}`);
    expect(fila?.distribuidor).toMatchObject({ id, cif: 'B12345678' });
  });
});
