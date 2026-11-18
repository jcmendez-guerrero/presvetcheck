import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { eq, like } from 'drizzle-orm';
import {
  auditEvent,
  distribuidor,
  outbox,
  recepcion,
  recepcionLinea,
  siwebVariantMap,
  type DbHandle,
} from '@mmx/db';
import { createTestDb } from '@mmx/db/testing';
import { SiwebClient } from '../src/client';
import {
  OPERACION_ACTUALIZAR_COSTE_PROVEEDOR,
  OutboxService,
  claveCosteProveedor,
  type PayloadCosteProveedor,
} from '../src/outbox';

/** specs/016: el coste del proveedor se envía siempre, sin depender de la casilla «actualizar precio». */
const BASE = 'https://siweb.test/api/public/';
const fx = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/siweb', f), 'utf8'));
const server = setupServer();
const client = (o: Partial<ConstructorParameters<typeof SiwebClient>[0]> = {}) =>
  new SiwebClient({
    baseUrl: BASE,
    token: 'tok-test',
    rps: 1000,
    sleep: async () => {},
    random: () => 0,
    baseDelayMs: 1,
    ...o,
  });

let h: DbHandle;
beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  h = await createTestDb();
}, 60_000);
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await h.close();
});

const CIF = 'B12345678';
let dist: string;
let contador = 0;
beforeEach(async () => {
  await h.db.delete(outbox);
  const [d] = await h.db
    .insert(distribuidor)
    .values({ nombre: 'Distribuidora Veterinaria de Prueba S.L.', cif: CIF })
    .returning();
  dist = d!.id;
});

interface L {
  variant: number | null;
  actualizarPrecio?: boolean;
  actualizarStock?: boolean;
  neto?: string | null;
  coste?: string | null;
}
async function recepcionFinalizada(lineas: L[], distribuidorId = dist) {
  const [r] = await h.db
    .insert(recepcion)
    .values({ distribuidorId, fechaCompra: '2026-10-14', empleado: 'dev-empleado' })
    .returning();
  let n = 0;
  for (const l of lineas) {
    n++;
    contador++;
    await h.db.insert(recepcionLinea).values({
      recepcionId: r!.id,
      numero: n,
      cn: `58${String(contador).padStart(4, '0')}`,
      nombreFarmaco: 'X',
      lote: `L${n}`,
      caducidad: '2027-12-31',
      unidades: 3,
      origenDatos: 'cimavet',
      siwebVariantId: l.variant,
      actualizarPrecio: l.actualizarPrecio ?? true,
      // Por defecto sin entrada de stock: estos tests solo miran el coste del proveedor.
      actualizarStock: l.actualizarStock ?? false,
      precioNetoCompra: l.neto === undefined ? '10.0000' : l.neto,
      precioCoste: l.coste === undefined ? '10.1400' : l.coste,
      empleado: 'dev-empleado',
    });
  }
  await h.db.update(recepcion).set({ estado: 'FINALIZADA' }).where(eq(recepcion.id, r!.id));
  return r!.id;
}
const svc = (
  modo: 'off' | 'entries_only' = 'entries_only',
  o: {
    prueba?: Date | null;
    now?: () => Date;
    base?: 'precio_coste' | 'precio_neto';
    timeoutMs?: number;
  } = {},
) =>
  new OutboxService(
    h.db,
    client({ timeoutMs: o.timeoutMs ?? 5000 }),
    {
      modo,
      almacenId: async () => 21,
      pruebaVigente: async () => (o.prueba === undefined ? new Date() : o.prueba),
      ...(o.base ? { costeProveedorBase: o.base } : {}),
    },
    { log: () => {}, ...(o.now ? { now: o.now } : {}) },
  );
const encolar = (id: string, o: { sinPrecios?: boolean } = {}, s = svc()) =>
  h.db.transaction((tx) => s.encolarRecepcion(tx, id, o));
const filas = (id: string, prefijo = 'MMX-PRV') =>
  h.db
    .select()
    .from(outbox)
    .where(like(outbox.idempotencyKey, `${prefijo}-${id}-%`));
async function mapa(variantId: number, productId: number | null) {
  await h.db.delete(siwebVariantMap).where(eq(siwebVariantMap.variantId, variantId));
  await h.db
    .insert(siwebVariantMap)
    .values({ cn: `MAP${variantId}`, variantId, productId, metodo: 'manual' });
}
/** Servidor falso: `PUT …/suppliers/:contact` guarda lo recibido y responde con la fixture. */
function putProveedor(recibidos: Array<{ product: string; contact: string; body: unknown }>) {
  server.use(
    http.put(`${BASE}inventory/products/:id/suppliers/:contact`, async ({ request, params }) => {
      recibidos.push({
        product: String(params.id),
        contact: String(params.contact),
        body: await request.json(),
      });
      return HttpResponse.json(fx('doc-supplier-update.json'));
    }),
  );
}
async function recordar(contactId: number | null) {
  await h.db.update(distribuidor).set({ siwebContactId: contactId }).where(eq(distribuidor.id, dist));
}

describe('encolado: el coste del proveedor no depende de la casilla (US1, FR-001..FR-004, FR-009..FR-011)', () => {
  it('casilla desmarcada → operación de proveedor y ninguna de coste de variante', async () => {
    const id = await recepcionFinalizada([{ variant: 9001, actualizarPrecio: false }]);
    await encolar(id);
    const prv = await filas(id);
    expect(prv).toHaveLength(1);
    expect(prv[0]).toMatchObject({
      operation: OPERACION_ACTUALIZAR_COSTE_PROVEEDOR,
      idempotencyKey: claveCosteProveedor(id, 1),
      status: 'pending',
      entidad: 'recepcion_linea',
    });
    expect(prv[0]!.payload).toEqual({ variant_id: 9001, distribuidor_id: dist, cost_cents: 1014 });
    expect(await filas(id, 'MMX-PRC')).toHaveLength(0);
  });

  it('casilla marcada → ambas operaciones (la de variante como siempre)', async () => {
    const id = await recepcionFinalizada([{ variant: 9001, actualizarPrecio: true }]);
    await encolar(id);
    expect(await filas(id)).toHaveLength(1);
    expect(await filas(id, 'MMX-PRC')).toHaveLength(1);
  });

  it('«actualizar stock» desmarcado: el coste del proveedor se encola igualmente', async () => {
    const id = await recepcionFinalizada([
      { variant: 9001, actualizarStock: false, actualizarPrecio: false },
    ]);
    await encolar(id);
    expect(await filas(id)).toHaveLength(1);
    expect(await filas(id, 'MMX-REC')).toHaveLength(0);
  });

  it.each([
    ['sin ningún precio', { neto: null, coste: null }],
    ['precios a cero', { neto: '0', coste: '0.0000' }],
  ])('línea %s: ninguna operación (no se borra el coste existente)', async (_n, p) => {
    const id = await recepcionFinalizada([{ variant: 9001, ...p }]);
    await encolar(id);
    expect(await filas(id)).toHaveLength(0);
  });

  it('con coste_proveedor_base=precio_neto se envía el neto', async () => {
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    await encolar(id, {}, svc('entries_only', { base: 'precio_neto' }));
    expect((await filas(id))[0]!.payload).toMatchObject({ cost_cents: 1000 });
  });

  it('finalización «sin precios» (envío manual con la escritura apagada): ninguna operación', async () => {
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    await encolar(id, { sinPrecios: true });
    expect(await filas(id)).toHaveLength(0);
  });

  it('SIWEB_STOCK_WRITE_MODE=off: no se encola nada', async () => {
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    await encolar(id, {}, svc('off'));
    expect(await h.db.select().from(outbox)).toEqual([]);
  });

  it('repetir la finalización no duplica la operación (clave idempotente)', async () => {
    const id = await recepcionFinalizada([{ variant: 9001, actualizarPrecio: false }]);
    await encolar(id);
    await encolar(id);
    expect(await filas(id)).toHaveLength(1);
  });

  it('línea sin variante: no se encola hasta que se enlaza (US3)', async () => {
    const id = await recepcionFinalizada([{ variant: null, actualizarPrecio: false }]);
    await encolar(id);
    expect(await filas(id)).toHaveLength(0);
  });

  it('una recepción ya finalizada antes del cambio no se reencola sola (FR-014)', async () => {
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    await svc().reintentarProveedoresPendientes();
    await svc().reencolarPendientesAlta('000000', 1);
    expect(await filas(id)).toHaveLength(0);
  });
});

describe('envío con el proveedor ya recordado (US1)', () => {
  it('PUT al producto del mapa con SOLO purchase_cost_cents; sin llamar a la variante', async () => {
    const recibidos: Array<{ product: string; contact: string; body: unknown }> = [];
    putProveedor(recibidos);
    await mapa(9001, 3120);
    await recordar(41);
    const id = await recepcionFinalizada([{ variant: 9001, actualizarPrecio: false }]);
    await encolar(id);
    expect(await svc().despachar()).toEqual({ sent: 1, failed: 0, needs_reconciliation: 0 });
    expect(recibidos).toEqual([{ product: '3120', contact: '41', body: { purchase_cost_cents: 1014 } }]);
    const [f] = await filas(id);
    expect(f).toMatchObject({ status: 'sent' });
    expect(f!.payload).toMatchObject({ product_id: 3120, contact_id: 41 });
    const audit = await h.db.select().from(auditEvent).where(eq(auditEvent.entidadId, f!.id));
    expect(audit.map((a) => a.accion)).toContain('outbox_sent');
  });

  it('sin product_id en el mapa lo pide a Siweb360 y lo guarda', async () => {
    const recibidos: Array<{ product: string; contact: string; body: unknown }> = [];
    putProveedor(recibidos);
    server.use(http.get(`${BASE}inventory/variants/9001`, () => HttpResponse.json(fx('doc-variant.json'))));
    await mapa(9001, null);
    await recordar(41);
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    await encolar(id);
    await svc().despachar();
    expect(recibidos[0]).toMatchObject({ product: '3120' });
    const [m] = await h.db.select().from(siwebVariantMap).where(eq(siwebVariantMap.variantId, 9001));
    expect(m!.productId).toBe(3120);
  });

  it('dos variantes del mismo producto: dos operaciones y gana la última por orden de línea', async () => {
    const recibidos: Array<{ product: string; contact: string; body: unknown }> = [];
    putProveedor(recibidos);
    await mapa(9001, 3120);
    await mapa(9002, 3120);
    await recordar(41);
    const id = await recepcionFinalizada([
      { variant: 9001, neto: '1.00', coste: '1.00' },
      { variant: 9002, neto: '2.00', coste: '2.00' },
    ]);
    await encolar(id);
    expect(await filas(id)).toHaveLength(2);
    await svc().despachar();
    expect(recibidos.map((r) => r.body)).toEqual([
      { purchase_cost_cents: 100 },
      { purchase_cost_cents: 200 },
    ]);
  });

  it('un 4xx → failed, sin reintento', async () => {
    let n = 0;
    server.use(
      http.put(`${BASE}inventory/products/:id/suppliers/:contact`, () => {
        n++;
        return HttpResponse.json({ success: false, error: 'datos' }, { status: 400 });
      }),
    );
    await mapa(9001, 3120);
    await recordar(41);
    const id = await recepcionFinalizada([{ variant: 9001, actualizarPrecio: false }]);
    await encolar(id);
    expect(await svc().despachar()).toEqual({ sent: 0, failed: 1, needs_reconciliation: 0 });
    expect(await svc().despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
    expect(n).toBe(1);
    expect((await filas(id))[0]!.lastError).toMatch(/HTTP 400/);
  });

  it.each([
    ['5xx', () => new HttpResponse('boom', { status: 503 })],
    [
      'timeout',
      async () => {
        await delay(200);
        return HttpResponse.json(fx('doc-supplier-update.json'));
      },
    ],
  ])('%s → needs_reconciliation y NUNCA se reenvía solo', async (_n, respuesta) => {
    let n = 0;
    server.use(
      http.put(`${BASE}inventory/products/:id/suppliers/:contact`, async () => {
        n++;
        return respuesta();
      }),
    );
    await mapa(9001, 3120);
    await recordar(41);
    const id = await recepcionFinalizada([{ variant: 9001, actualizarPrecio: false }]);
    await encolar(id);
    const s = svc('entries_only', { timeoutMs: 30 });
    expect(await s.despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 1 });
    expect(await s.despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
    expect(n).toBe(1);
  });

  it('sin prueba de escritura vigente no se envía nada', async () => {
    await mapa(9001, 3120);
    await recordar(41);
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    await encolar(id);
    expect(await svc('entries_only', { prueba: null }).despachar()).toEqual({
      sent: 0,
      failed: 0,
      needs_reconciliation: 0,
    });
    expect((await filas(id))[0]!.status).toBe('pending');
  });

  it('la operación de proveedor no altera el estado de la recepción ni de la línea', async () => {
    putProveedor([]);
    await mapa(9001, 3120);
    await recordar(41);
    const id = await recepcionFinalizada([
      { variant: 9001, actualizarStock: false, actualizarPrecio: false },
    ]);
    await encolar(id);
    await svc().despachar();
    const [r] = await h.db.select().from(recepcion).where(eq(recepcion.id, id));
    expect(r!.estado).toBe('FINALIZADA');
  });
});

describe('identificación del proveedor y recuerdo (US2)', () => {
  const prep = async (v = 9001) => {
    await mapa(v, 3120);
    const id = await recepcionFinalizada([{ variant: v, actualizarPrecio: false }]);
    await encolar(id);
    return id;
  };
  const contactoDe = async () =>
    (await h.db.select().from(distribuidor).where(eq(distribuidor.id, dist)))[0]!.siwebContactId;
  const suppliers = (lista: Parameters<typeof HttpResponse.json>[0]) =>
    server.use(http.get(`${BASE}inventory/products/3120/suppliers`, () => HttpResponse.json(lista)));

  it('por el CIF de los proveedores ya vinculados al producto: se usa y se recuerda', async () => {
    const recibidos: Array<{ product: string; contact: string; body: unknown }> = [];
    putProveedor(recibidos);
    suppliers(fx('doc-product-suppliers.json'));
    const id = await prep();
    expect(await svc().despachar()).toMatchObject({ sent: 1 });
    expect(recibidos[0]).toMatchObject({ contact: '41' });
    expect(await contactoDe()).toBe(41);
    expect((await filas(id))[0]!.status).toBe('sent');
  });

  it('con el CIF escrito de otra forma (ES, guiones, minúsculas) también coincide', async () => {
    putProveedor([]);
    await h.db.update(distribuidor).set({ cif: 'es b-12.345.678' }).where(eq(distribuidor.id, dist));
    suppliers(fx('doc-product-suppliers.json'));
    await prep();
    expect(await svc().despachar()).toMatchObject({ sent: 1 });
    expect(await contactoDe()).toBe(41);
  });

  it('por búsqueda de nombre + CIF del detalle cuando el producto no tiene proveedores', async () => {
    const recibidos: Array<{ product: string; contact: string; body: unknown }> = [];
    putProveedor(recibidos);
    suppliers({ success: true, data: [] });
    const busquedas: string[] = [];
    server.use(
      http.get(`${BASE}contacts`, ({ request }) => {
        busquedas.push(new URL(request.url).searchParams.get('search') ?? '');
        return HttpResponse.json(fx('doc-contacts-proveedores.json'));
      }),
      http.get(`${BASE}contacts/41`, () => HttpResponse.json(fx('doc-contact-detail.json'))),
      http.get(`${BASE}contacts/42`, () =>
        HttpResponse.json({ success: true, data: { id: 42, cif: 'F87654321', tipo_relacion: 'Proveedor' } }),
      ),
    );
    await prep();
    expect(await svc().despachar()).toMatchObject({ sent: 1 });
    expect(busquedas).toEqual(['Distribuidora Veterinaria de Prueba S.L.']);
    expect(recibidos[0]).toMatchObject({ contact: '41' });
    expect(await contactoDe()).toBe(41);
  });

  it('con el proveedor recordado no hay ninguna consulta de búsqueda en la recepción siguiente', async () => {
    putProveedor([]);
    await recordar(41);
    const id = await prep(); // si consultara, MSW fallaría por petición sin manejador
    expect(await svc().despachar()).toMatchObject({ sent: 1 });
    expect((await filas(id))[0]!.status).toBe('sent');
  });

  it.each([
    ['sin CIF', null, 'SIN_CIF'],
    ['CIF sin coincidencia', 'A00000000', 'SIN_COINCIDENCIA'],
  ])('%s → needs_supplier, no se envía nada', async (_n, cif, motivo) => {
    let puts = 0;
    server.use(
      http.put(`${BASE}inventory/products/:id/suppliers/:contact`, () => {
        puts++;
        return HttpResponse.json(fx('doc-supplier-update.json'));
      }),
    );
    suppliers({ success: true, data: [] });
    server.use(http.get(`${BASE}contacts`, () => HttpResponse.json({ success: true, data: [] })));
    await h.db.update(distribuidor).set({ cif }).where(eq(distribuidor.id, dist));
    const id = await prep();
    const antes = Date.now();
    expect(await svc().despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
    expect(puts).toBe(0);
    const [f] = await filas(id);
    expect(f).toMatchObject({ status: 'needs_supplier', lastError: motivo, lockedAt: null });
    expect(f!.nextAttemptAt!.getTime()).toBeGreaterThan(antes + 23 * 3_600_000);
    expect(await contactoDe()).toBeNull();
    const audit = await h.db.select().from(auditEvent).where(eq(auditEvent.entidadId, f!.id));
    expect(audit.map((a) => a.accion)).toContain('outbox_needs_supplier');
  });

  it('varias coincidencias → needs_supplier VARIAS_COINCIDENCIAS (nunca se elige una)', async () => {
    suppliers({
      success: true,
      data: [
        { contact_id: 41, supplier_cif: CIF },
        { contact_id: 99, supplier_cif: 'b12345678' },
      ],
    });
    const id = await prep();
    await svc().despachar();
    expect((await filas(id))[0]).toMatchObject({
      status: 'needs_supplier',
      lastError: 'VARIAS_COINCIDENCIAS',
    });
    expect(await contactoDe()).toBeNull();
  });

  it('más de 10 candidatos: solo se consultan 10 detalles', async () => {
    suppliers({ success: true, data: [] });
    const consultados: string[] = [];
    server.use(
      http.get(`${BASE}contacts`, () =>
        HttpResponse.json({
          success: true,
          data: Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, nombre_empresa: `P${i}` })),
        }),
      ),
      http.get(`${BASE}contacts/:id`, ({ params }) => {
        consultados.push(String(params.id));
        return HttpResponse.json({ success: true, data: { id: Number(params.id), cif: 'X1111111X' } });
      }),
    );
    const id = await prep();
    await svc().despachar();
    expect(consultados).toHaveLength(10);
    expect((await filas(id))[0]).toMatchObject({ status: 'needs_supplier', lastError: 'SIN_COINCIDENCIA' });
  });

  it('Siweb360 no responde al buscar: needs_supplier SIWEB_NO_DISPONIBLE con reintento en media hora', async () => {
    server.use(
      http.get(`${BASE}inventory/products/3120/suppliers`, () => new HttpResponse('x', { status: 503 })),
    );
    const id = await prep();
    const ahora = new Date('2026-11-18T10:00:00Z');
    await svc('entries_only', { now: () => ahora }).despachar();
    const [f] = await filas(id);
    expect(f).toMatchObject({ status: 'needs_supplier', lastError: 'SIWEB_NO_DISPONIBLE' });
    expect(f!.nextAttemptAt!.toISOString()).toBe('2026-11-18T10:30:00.000Z');
  });

  it('un 404 del PUT con el contacto recordado: se olvida el contacto y queda needs_supplier', async () => {
    server.use(
      http.put(`${BASE}inventory/products/:id/suppliers/:contact`, () =>
        HttpResponse.json({ success: false, error: 'no existe' }, { status: 404 }),
      ),
    );
    await recordar(77);
    const id = await prep();
    await svc().despachar();
    expect((await filas(id))[0]).toMatchObject({
      status: 'needs_supplier',
      lastError: 'PROVEEDOR_INEXISTENTE',
    });
    expect(await contactoDe()).toBeNull();
  });
});

describe('reanudación de los pendientes de proveedor (US2.4)', () => {
  async function pendiente() {
    await mapa(9001, 3120);
    server.use(
      http.get(`${BASE}inventory/products/3120/suppliers`, () =>
        HttpResponse.json({ success: true, data: [] }),
      ),
      http.get(`${BASE}contacts`, () => HttpResponse.json({ success: true, data: [] })),
    );
    const id = await recepcionFinalizada([{ variant: 9001, actualizarPrecio: false }]);
    await encolar(id);
    const t0 = new Date('2026-11-18T10:00:00Z');
    await svc('entries_only', { now: () => t0 }).despachar();
    expect((await filas(id))[0]!.status).toBe('needs_supplier');
    return { id, t0 };
  }

  it('needs_supplier no lo toma el dispatcher', async () => {
    const { id } = await pendiente();
    expect(await svc().despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
    expect((await filas(id))[0]!.status).toBe('needs_supplier');
  });

  it('al vincular el proveedor se reactiva y se envía una vez con el coste de su recepción', async () => {
    const { id } = await pendiente();
    const recibidos: Array<{ product: string; contact: string; body: unknown }> = [];
    putProveedor(recibidos);
    await recordar(41);
    expect(await svc().reactivarCosteProveedor(dist, 'admin')).toBe(1);
    expect(await svc().reactivarCosteProveedor(dist, 'admin')).toBe(0);
    expect(await svc().despachar()).toMatchObject({ sent: 1 });
    expect(await svc().despachar()).toMatchObject({ sent: 0 });
    expect(recibidos).toEqual([{ product: '3120', contact: '41', body: { purchase_cost_cents: 1014 } }]);
    expect((await filas(id))[0]!.status).toBe('sent');
  });

  it('el barrido solo reactiva los vencidos y la nueva resolución no duplica', async () => {
    const { id, t0 } = await pendiente();
    const s = (d: Date) => svc('entries_only', { now: () => d });
    expect(await s(new Date(t0.getTime() + 3_600_000)).reintentarProveedoresPendientes()).toBe(0);
    expect(await s(new Date(t0.getTime() + 25 * 3_600_000)).reintentarProveedoresPendientes()).toBe(1);
    // Sigue sin proveedor: vuelve a needs_supplier, una sola fila.
    await s(new Date(t0.getTime() + 25 * 3_600_000)).despachar();
    expect(await filas(id)).toHaveLength(1);
    expect((await filas(id))[0]!.status).toBe('needs_supplier');
    // Ahora el proveedor aparece (otra persona lo vinculó en Siweb360) y el siguiente barrido lo envía.
    const recibidos: Array<{ product: string; contact: string; body: unknown }> = [];
    putProveedor(recibidos);
    server.use(
      http.get(`${BASE}inventory/products/3120/suppliers`, () =>
        HttpResponse.json(fx('doc-product-suppliers.json')),
      ),
    );
    const manana = new Date(t0.getTime() + 60 * 3_600_000);
    expect(await s(manana).reintentarProveedoresPendientes()).toBe(1);
    expect(await s(manana).despachar()).toMatchObject({ sent: 1 });
    expect(recibidos).toHaveLength(1);
  });

  it('solo reactiva las del distribuidor indicado', async () => {
    await pendiente();
    const [otro] = await h.db.insert(distribuidor).values({ nombre: 'Otro', cif: 'F87654321' }).returning();
    expect(await svc().reactivarCosteProveedor(otro!.id, 'admin')).toBe(0);
  });
});

describe('alta posterior del producto (US3)', () => {
  it('encola el coste del proveedor con la casilla desmarcada y sin duplicar al repetirse', async () => {
    const id = await recepcionFinalizada([{ variant: null, actualizarPrecio: false, actualizarStock: true }]);
    await encolar(id);
    const [linea] = await h.db.select().from(recepcionLinea).where(eq(recepcionLinea.recepcionId, id));
    expect(linea!.estado).toBe('PENDIENTE_ALTA_SIWEB');
    expect(await svc().reencolarPendientesAlta(linea!.cn!, 9100)).toBe(1);
    expect(await svc().reencolarPendientesAlta(linea!.cn!, 9100)).toBe(0);
    const prv = await filas(id);
    expect(prv).toHaveLength(1);
    expect(prv[0]!.payload as PayloadCosteProveedor).toMatchObject({ variant_id: 9100, cost_cents: 1014 });
    expect(await filas(id, 'MMX-PRC')).toHaveLength(0);
  });

  it('con la escritura apagada no encola nada', async () => {
    const id = await recepcionFinalizada([{ variant: null, actualizarPrecio: false, actualizarStock: true }]);
    await encolar(id);
    const [linea] = await h.db.select().from(recepcionLinea).where(eq(recepcionLinea.recepcionId, id));
    expect(await svc('off').reencolarPendientesAlta(linea!.cn!, 9100)).toBe(0);
  });

  it('sin coste en la línea no encola coste de proveedor', async () => {
    const id = await recepcionFinalizada([{ variant: null, neto: null, coste: null, actualizarStock: true }]);
    await encolar(id);
    const [linea] = await h.db.select().from(recepcionLinea).where(eq(recepcionLinea.recepcionId, id));
    await svc().reencolarPendientesAlta(linea!.cn!, 9100);
    expect(await filas(id)).toHaveLength(0);
  });
});
