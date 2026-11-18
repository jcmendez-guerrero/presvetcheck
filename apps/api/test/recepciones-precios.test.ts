import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { outbox, recepcionLinea } from '@mmx/db';
import { OutboxService, SiwebClient } from '@mmx/siweb';
import { api, entorno } from './entorno';

describe('Encolado de actualización de precios en el outbox tras finalizar recepción (SPEC §5.2, API 1.2.0)', () => {
  it('encola siweb_actualizar_precio cuando la línea tiene actualizarPrecio = true y coste calculado', async () => {
    const { app, deps, h } = await entorno();

    const client = new SiwebClient({
      baseUrl: 'https://siweb.test/api/public/',
      token: 'tok-test',
      rps: 1000,
      sleep: async () => {},
      random: () => 0,
      baseDelayMs: 1,
    });

    const outboxSvc = new OutboxService(
      h.db,
      client,
      {
        modo: 'entries_only',
        almacenId: async () => 1,
        pruebaVigente: async () => new Date('2026-10-14T09:00:00Z'),
      },
      { now: () => new Date('2026-10-14T10:00:00Z') },
    );

    deps.siweb = {
      resolver: null as never,
      bandeja: null as never,
      catalogo: null as never,
      outbox: outboxSvc,
      stockActual: async () => ({}),
      proveedores: async () => ['Distribuidora Test'],
    };

    // 1. Crear una recepción
    const r = await api(app, 'dev-empleado', 'POST', '/api/recepciones', {
      distribuidor: 'Distribuidora Test',
      albaran: 'ALB-PRC-001',
    });
    expect(r.status).toBe(201);
    const recepcionId = (r.json as { id: string }).id;

    // 2. Añadir línea con precio y actualizarPrecio: true
    const l = await api(app, 'dev-empleado', 'POST', `/api/recepciones/${recepcionId}/lineas`, {
      cn: '570016',
      lote: 'L-2026-01',
      caducidad: '2027-12-31',
      unidades: 5,
      precioNetoCompra: '18.5000',
      precioCoste: '18.5000',
      actualizarStock: true,
      actualizarPrecio: true,
    });
    expect(l.status).toBe(201);
    const lineaId = (l.json as { linea: { id: string } }).linea.id;

    // Asignar siwebVariantId a la línea
    await h.db.update(recepcionLinea).set({ siwebVariantId: 9001 }).where(eq(recepcionLinea.id, lineaId));

    // 3. Finalizar la recepción
    const fin = await api(app, 'dev-empleado', 'POST', `/api/recepciones/${recepcionId}/finalizar`);
    expect(fin.status).toBe(200);

    // 4. Verificar filas en el outbox
    const filasOutbox = await h.db.select().from(outbox).where(eq(outbox.entidadId, lineaId));

    // Entrada de stock, coste de la variante (casilla marcada) y coste del proveedor (siempre; specs/016).
    expect(filasOutbox.length).toBe(3);

    const entrada = filasOutbox.find((f) => f.operation === 'stock_adjustment_entry');
    expect(entrada).toBeDefined();
    expect(entrada?.idempotencyKey).toBe(`MMX-REC-${recepcionId}-L1`);

    const precio = filasOutbox.find((f) => f.operation === 'siweb_actualizar_precio');
    expect(precio).toBeDefined();
    expect(precio?.idempotencyKey).toBe(`MMX-PRC-${recepcionId}-L1`);
    expect(precio?.payload).toEqual({
      variant_id: 9001,
      cost_cents: 1875.9,
    });

    const proveedor = filasOutbox.find((f) => f.operation === 'siweb_actualizar_coste_proveedor');
    expect(proveedor?.idempotencyKey).toBe(`MMX-PRV-${recepcionId}-L1`);
    expect(proveedor?.payload).toMatchObject({ variant_id: 9001, cost_cents: 1875.9 });
  });

  it('con «actualizar precio» desmarcado se encola el coste del proveedor y no el de la variante (specs/016)', async () => {
    const { app, deps, h } = await entorno();
    const client = new SiwebClient({
      baseUrl: 'https://siweb.test/api/public/',
      token: 'tok-test',
      rps: 1000,
      sleep: async () => {},
      random: () => 0,
      baseDelayMs: 1,
    });
    deps.siweb = {
      resolver: null as never,
      bandeja: null as never,
      catalogo: null as never,
      outbox: new OutboxService(
        h.db,
        client,
        {
          modo: 'entries_only',
          almacenId: async () => 1,
          pruebaVigente: async () => new Date('2026-10-14T09:00:00Z'),
        },
        { now: () => new Date('2026-10-14T10:00:00Z') },
      ),
      stockActual: async () => ({}),
      proveedores: async () => ['Distribuidora Test'],
    };
    const r = await api(app, 'dev-empleado', 'POST', '/api/recepciones', {
      distribuidor: 'Distribuidora Test',
      albaran: 'ALB-PRV-002',
    });
    const recepcionId = (r.json as { id: string }).id;
    const l = await api(app, 'dev-empleado', 'POST', `/api/recepciones/${recepcionId}/lineas`, {
      cn: '570016',
      lote: 'L-2026-02',
      caducidad: '2027-12-31',
      unidades: 5,
      precioNetoCompra: '18.5000',
      precioCoste: '18.5000',
      actualizarStock: true,
      actualizarPrecio: false,
    });
    expect(l.status).toBe(201);
    const lineaId = (l.json as { linea: { id: string } }).linea.id;
    await h.db.update(recepcionLinea).set({ siwebVariantId: 9001 }).where(eq(recepcionLinea.id, lineaId));
    expect((await api(app, 'dev-empleado', 'POST', `/api/recepciones/${recepcionId}/finalizar`)).status).toBe(
      200,
    );
    const ops = (await h.db.select().from(outbox).where(eq(outbox.entidadId, lineaId))).map(
      (f) => f.operation,
    );
    expect(ops.sort()).toEqual(['siweb_actualizar_coste_proveedor', 'stock_adjustment_entry']);

    // Mientras el proveedor de Siweb360 no esté vinculado, el detalle avisa a quien ve la recepción.
    expect(
      (
        (await api(app, 'dev-empleado', 'GET', `/api/recepciones/${recepcionId}`)).json as {
          costeProveedorPendiente: number;
        }
      ).costeProveedorPendiente,
    ).toBe(0);
    await h.db
      .update(outbox)
      .set({ status: 'needs_supplier', lastError: 'SIN_COINCIDENCIA' })
      .where(and(eq(outbox.entidadId, lineaId), eq(outbox.operation, 'siweb_actualizar_coste_proveedor')));
    const detalle = await api(app, 'dev-empleado', 'GET', `/api/recepciones/${recepcionId}`);
    expect(detalle.status).toBe(200);
    expect((detalle.json as { costeProveedorPendiente: number }).costeProveedorPendiente).toBe(1);
  });
});
