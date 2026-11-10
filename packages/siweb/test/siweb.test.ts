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
  siwebTarea,
  siwebVariantMap,
  type DbHandle,
} from '@mmx/db';
import { createTestDb } from '@mmx/db/testing';
import { proponerLotes } from '@mmx/domain';
import { SiwebClient, SiwebValidationError } from '../src/client';
import { AlmacenError, resolverAlmacen } from '../src/warehouse';
import { StockService } from '../src/stock';
import { VariantResolver, similitudNombre } from '../src/mapeo';
import { IndiceCatalogo } from '../src/indice';
import { BandejaSiweb, ManualTaskCatalogWriter, SkuReservas, crearCatalogWriter } from '../src/tareas';
import { MAX_VERIFICACIONES, OutboxService, claveEntrada, exigirEntrada } from '../src/outbox';
import {
  LecturaTicketsIncompleta,
  NotConfiguredSalesMovementsSource,
  TicketsSalesMovementsSource,
} from '../src/ventas';
import { leerNivel } from '../src/schemas';

const BASE = 'https://siweb.test/api/public/';
const fx = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/siweb', f), 'utf8'));
const PATRON = 'CN(\\d{6,7})$';
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
  h = await createTestDb({ seed: true });
}, 60_000);
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await h.close();
});

describe('SiwebClient (SPEC §5.2.1) con los ejemplos de la documentación', () => {
  it('lee productos, variante, stock, lotes, almacenes y bajo mínimo; envía el Bearer', async () => {
    let auth: string | null = null;
    server.use(
      http.get(`${BASE}inventory/products`, ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json(fx('doc-products.json'));
      }),
      http.get(`${BASE}inventory/products/:id`, () =>
        HttpResponse.json({ success: true, data: fx('doc-products.json').data[0] }),
      ),
      http.get(`${BASE}inventory/variants/:id/stock`, () => HttpResponse.json(fx('doc-stock.json'))),
      http.get(`${BASE}inventory/variants/:id/lots`, () => HttpResponse.json(fx('doc-lots.json'))),
      http.get(`${BASE}inventory/variants/:id`, () => HttpResponse.json(fx('doc-variant.json'))),
      http.get(`${BASE}inventory/warehouses`, () => HttpResponse.json(fx('doc-warehouses.json'))),
      http.get(`${BASE}inventory/stock/low`, () => HttpResponse.json(fx('doc-low-stock.json'))),
      http.get(`${BASE}contacts`, ({ request }) => {
        // Solo proveedores (los clientes no son distribuidores).
        expect(new URL(request.url).searchParams.get('tipo')).toBe('Proveedor');
        return HttpResponse.json(fx('doc-contacts-proveedores.json'));
      }),
    );
    const c = client();
    expect((await c.products())[0]).toMatchObject({ id: 3120, code: 'CAM-001', variants_count: 6 });
    expect(auth).toBe('Bearer tok-test');
    expect((await c.product(3120)).name).toBe('Camiseta básica');
    expect(await c.variant(8812)).toMatchObject({
      sku: 'CAM-AZ-M',
      product_code: 'CAM-001',
      stock_levels: [{ batch_number: 'L-2026-09', available: 40 }],
    });
    expect(await c.stock(8812)).toMatchObject({ total_available: 40, is_infinite_stock: false });
    expect((await c.lots(8812))[0]).toMatchObject({ lot_code: 'L-2026-09', expiry_date: '2027-03-31' });
    expect((await c.warehouses()).map((w) => w.name)).toEqual(['Almacén central', 'Tienda Centro']);
    expect((await c.lowStock(14))[0]).toMatchObject({ sku: 'CAM-AZ-L' });
    expect((await c.proveedores()).map((p) => p.nombre_empresa)).toEqual([
      'Distribuidora Veterinaria de Prueba S.L.',
      'Cooperativa de Prueba',
    ]);
  });

  it('actualizarPrecios (API 1.2.0) envía PUT /inventory/variants/:id/pricing con cost_cents y price_cents', async () => {
    let capturedBody: unknown = null;
    server.use(
      http.put(`${BASE}inventory/variants/:id/pricing`, async ({ request, params }) => {
        expect(params.id).toBe('9001');
        capturedBody = await request.json();
        return HttpResponse.json(fx('doc-variant-pricing.json'));
      }),
    );
    const c = client();
    const res = await c.actualizarPrecios(9001, { cost_cents: 1850.5, price_cents: 3250 });
    expect(capturedBody).toEqual({ cost_cents: 1850.5, price_cents: 3250 });
    expect(res).toMatchObject({
      variant_id: 9001,
      sku: 'BONQAT-0001-CN590948',
      price_cents: 3250,
      cost_cents: 1850.5,
    });
  });

  it('movements (API 1.2.0) consulta historial de movimientos de inventario', async () => {
    server.use(
      http.get(`${BASE}inventory/movements`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('variant_id')).toBe('9001');
        return HttpResponse.json({
          success: true,
          data: [
            {
              id: 101,
              variant_id: 9001,
              sku: 'BONQAT-0001-CN590948',
              product_name: 'BONQAT',
              warehouse_id: 1,
              warehouse_name: 'Farmacia',
              type: 'IN',
              quantity: 10,
              reason: 'Recepción albarán 2026/01',
              reference: 'ALB-2026-01',
              created_at: '2026-11-05T10:00:00Z',
            },
          ],
        });
      }),
    );
    const c = client();
    const movs = await c.movements({ variant_id: 9001 });
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({
      id: 101,
      variant_id: 9001,
      quantity: 10,
      type: 'IN',
    });
  });

  it('movements (API 1.3.0): reference_id cadena o número, campos nuevos y desconocidos', async () => {
    const doc = fx('doc-movements.json');
    const fila = doc.data[0];
    server.use(
      http.get(`${BASE}inventory/movements`, () =>
        HttpResponse.json({
          ...doc,
          data: [
            { ...fila, campo_nuevo: { x: 1 } },
            { ...fila, id: 2, reference_id: 45121, NOTES: 'mayúsculas' },
            { ...fila, id: 3, reference_id: null },
          ],
        }),
      ),
    );
    const movs = await client().movements({ variant_id: 8812 });
    expect(movs.map((m) => m.reference_id)).toEqual(['45120', '45121', null]);
    expect(movs[0]).toMatchObject({
      batch_number: 'L-2026-09',
      expiry_date: '2027-03-31',
      reference_number: 'FAC-0231',
    });
  });

  it.each([
    ['5xx', () => HttpResponse.json({ success: false }, { status: 503 })],
    [
      'timeout',
      async () => {
        await delay(200);
        return HttpResponse.json(fx('doc-movements.json'));
      },
    ],
  ])('movements lanza error con %s', async (_n, h) => {
    server.use(http.get(`${BASE}inventory/movements`, h));
    await expect(client({ timeoutMs: 30, maxRetries: 0 }).movements({})).rejects.toBeTruthy();
  });

  it('pagina según pagination.pages (documentado)', async () => {
    const paginas: string[] = [];
    server.use(
      http.get(`${BASE}inventory/products`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        paginas.push(String(page));
        return HttpResponse.json({
          success: true,
          data: [{ id: page }],
          pagination: { page, limit: 200, total: 3, pages: 3 },
        });
      }),
    );
    expect((await client().products()).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(paginas).toEqual(['1', '2', '3']);
  });

  it('sin metadatos de paginación, pagina con page/limit hasta una página incompleta', async () => {
    const paginas: string[] = [];
    server.use(
      http.get(`${BASE}inventory/variants`, ({ request }) => {
        const u = new URL(request.url);
        paginas.push(`${u.searchParams.get('page')}/${u.searchParams.get('limit')}`);
        const page = Number(u.searchParams.get('page'));
        const items = page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }];
        return HttpResponse.json({ success: true, data: items });
      }),
    );
    expect((await client({ pageLimit: 2 }).variants({ search: 'x' })).map((v) => v.id)).toEqual([1, 2, 3]);
    expect(paginas).toEqual(['1/2', '2/2']);
  });

  it('ajuste de stock: respuesta de la doc y SIN reintentos ante 5xx', async () => {
    let n = 0;
    server.use(
      http.post(`${BASE}inventory/stock/adjustments`, async ({ request }) => {
        n++;
        const body = (await request.json()) as Record<string, unknown>;
        if (body.quantity === 99) return new HttpResponse(null, { status: 502 });
        return HttpResponse.json(fx('doc-adjustment.json'));
      }),
    );
    const c = client();
    const r = await c.ajustarStock({
      variant_id: 8812,
      warehouse_id: 14,
      quantity: 8,
      reason: 'purchase_receipt',
    });
    expect(r.result.movement?.id).toBe(77120);
    expect(r.message).toBe('Stock increased by 8 units');
    await expect(c.ajustarStock({ variant_id: 1, warehouse_id: 1, quantity: 99 })).rejects.toMatchObject({
      status: 502,
    });
    expect(n).toBe(2);
  });

  it('409 por stock ilimitado y respuesta no válida', async () => {
    server.use(
      http.post(`${BASE}inventory/stock/adjustments`, () =>
        HttpResponse.json({ success: false, message: 'infinite' }, { status: 409 }),
      ),
      http.get(`${BASE}inventory/variants/:id`, () =>
        HttpResponse.json({ success: true, data: { sku: 'sin id' } }),
      ),
    );
    await expect(
      client().ajustarStock({ variant_id: 1, warehouse_id: 1, quantity: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(client().variant(1)).rejects.toBeInstanceOf(SiwebValidationError);
  });

  it('token desde Key Vault (función) y campos desconocidos tolerados', async () => {
    server.use(
      http.get(`${BASE}inventory/warehouses`, () =>
        HttpResponse.json({ success: true, data: [{ id: 1, name: 'Farmacia', nuevo: 1 }] }),
      ),
    );
    expect((await client({ token: async () => 'kv' }).warehouses())[0]?.name).toBe('Farmacia');
  });

  it('leerNivel usa batch_number/available/expiry_date y devuelve null si faltan', () => {
    expect(
      leerNivel({
        warehouse_id: 1,
        location_id: null,
        batch_number: ' X ',
        available: 3,
        expiry_date: '2027-01-31T00:00:00Z',
      } as never),
    ).toEqual({ lote: 'X', disponible: 3, caducidad: '2027-01-31' });
    expect(leerNivel({ warehouse_id: 1, location_id: null } as never)).toEqual({
      lote: null,
      disponible: null,
      caducidad: null,
    });
  });
});

describe('almacén Farmacia (D-12)', () => {
  it('lo resuelve por nombre, por id fijado, y falla si no existe o está duplicado', async () => {
    server.use(
      http.get(`${BASE}inventory/warehouses`, () => HttpResponse.json(fx('farmacia-warehouses.json'))),
    );
    expect(await resolverAlmacen(client(), { nombre: 'farmacia ' })).toEqual({ id: 21, nombre: 'Farmacia' });
    expect(await resolverAlmacen(client(), { nombre: 'X', id: 22 })).toEqual({ id: 22, nombre: 'Tienda' });
    await expect(resolverAlmacen(client(), { nombre: 'X', id: 99 })).rejects.toBeInstanceOf(AlmacenError);
    await expect(resolverAlmacen(client(), { nombre: 'Almacén' })).rejects.toThrow(/No se encuentra/);
    server.use(
      http.get(`${BASE}inventory/warehouses`, () =>
        HttpResponse.json({
          success: true,
          data: [
            { id: 1, name: 'Farmacia' },
            { id: 2, name: 'FARMACIA' },
          ],
        }),
      ),
    );
    await expect(resolverAlmacen(client(), { nombre: 'Farmacia' })).rejects.toThrow(/Hay 2 almacenes/);
  });
});

describe('stock por lote (SPEC §5.2.3) y FEFO', () => {
  const handlers = () => [
    http.get(`${BASE}inventory/variants/:id/lots`, () => HttpResponse.json(fx('farmacia-lots-9001.json'))),
    http.get(`${BASE}inventory/variants/:id`, () => HttpResponse.json(fx('farmacia-variant-9001.json'))),
  ];

  it('solo cuenta el almacén Farmacia, une caducidades y permite ordenar FEFO', async () => {
    let lecturas = 0;
    server.use(
      http.get(`${BASE}inventory/variants/:id/lots`, () => HttpResponse.json(fx('farmacia-lots-9001.json'))),
      http.get(`${BASE}inventory/variants/:id`, () => {
        lecturas++;
        return HttpResponse.json(fx('farmacia-variant-9001.json'));
      }),
    );
    let t = 0;
    const svc = new StockService(client(), async () => 21, { now: () => t });
    const r = await svc.lotesDeVariantes('570016', [9001]);
    expect(r.estado).toBe('OK');
    expect(r.lotes.map((l) => [l.lote, l.caducidad, l.disponible, l.ubicacion])).toEqual([
      ['A2026', '2026-12-31', 3, null],
      ['B2027', '2027-05-31', 4, '5'],
    ]);
    expect(
      proponerLotes({ lotes: r.lotes, unidades: 1, hoy: '2026-10-14', duracionDias: null }).recomendado?.lote,
    ).toBe('A2026');
    // Caché ≤ 60 s
    t = 59_000;
    await svc.lotesDeVariantes('570016', [9001]);
    expect(lecturas).toBe(1);
    t = 61_000;
    await svc.lotesDeVariantes('570016', [9001]);
    expect(lecturas).toBe(2);
    svc.invalidar('570016');
    svc.invalidar();
  });

  it('variante con stock ilimitado → no participa y se avisa', async () => {
    const v = fx('farmacia-variant-9001.json');
    v.data.is_infinite_stock = true;
    // En MSW el primer handler registrado tiene prioridad.
    server.use(
      http.get(`${BASE}inventory/variants/:id`, () => HttpResponse.json(v)),
      ...handlers(),
    );
    const r = await new StockService(client(), async () => 21).lotesDeVariantes('x', [9001]);
    expect(r).toMatchObject({
      estado: 'OK',
      lotes: [],
      ilimitadas: [{ variantId: 9001, sku: 'NORBROOK-0001-CN570016' }],
    });
  });

  it('Siweb360 caído o desglose ilegible → NO_DISPONIBLE (nunca se confirma stock)', async () => {
    server.use(
      http.get(`${BASE}inventory/variants/:id`, () => new HttpResponse(null, { status: 503 })),
      http.get(`${BASE}inventory/variants/:id/lots`, () => HttpResponse.json(fx('doc-lots.json'))),
    );
    expect(
      (
        await new StockService(client({ maxRetries: 0 }), async () => 21, { log: () => {} }).lotesDeVariantes(
          'y',
          [1],
        )
      ).estado,
    ).toBe('NO_DISPONIBLE');
    const sinLote = fx('farmacia-variant-9001.json');
    sinLote.data.stock_levels = [{ warehouse_id: 21, location_id: null, available: 2 }];
    server.use(http.get(`${BASE}inventory/variants/:id`, () => HttpResponse.json(sinLote)));
    expect((await new StockService(client(), async () => 21).lotesDeVariantes('z', [1])).estado).toBe(
      'NO_DISPONIBLE',
    );
  });
});

describe('resolución CN → variante (SPEC §5.2.2)', () => {
  it('busca CN{cn}, filtra por patrón y guarda el mapeo automático sin confirmación', async () => {
    const busquedas: (string | null)[] = [];
    server.use(
      http.get(`${BASE}inventory/variants`, ({ request }) => {
        busquedas.push(new URL(request.url).searchParams.get('search'));
        return HttpResponse.json(fx('farmacia-variants-cn570016.json'));
      }),
    );
    const res = new VariantResolver(h.db, client(), PATRON);
    const r = await res.resolver('570016', null);
    expect(busquedas).toEqual(['CN570016', '570016']);
    expect(r).toEqual({
      estado: 'MAPEADO',
      variantes: [{ variantId: 9001, sku: 'NORBROOK-0001-CN570016', metodo: 'auto_sku' }],
    });
    // Segunda vez: desde la tabla, sin llamar a Siweb360.
    server.resetHandlers();
    expect((await res.resolver('5700163', null)).estado).toBe('MAPEADO');
  });

  it('CN escrito a mano en el nombre («CN 584187.8») con un SKU sin convención → mapeo automático por nombre', async () => {
    server.use(
      http.get(`${BASE}inventory/variants`, ({ request }) => {
        const s = new URL(request.url).searchParams.get('search');
        // Siweb360 busca por texto: «CN584187» no aparece en el nombre, «584187» sí.
        return HttpResponse.json({
          success: true,
          data:
            s === '584187'
              ? [
                  {
                    id: 31,
                    sku: 'DECHRA-00002',
                    name: 'AMOXIBACTIN 250 10 COMPRIMIDOS- CN 584187.8',
                    product_name: 'AMOXIBACTIN 250 10 COMPRIMIDOS- CN 584187.8',
                  },
                ]
              : [],
        });
      }),
    );
    const res = new VariantResolver(h.db, client(), PATRON);
    expect(await res.resolver('584187', null)).toEqual({
      estado: 'MAPEADO',
      variantes: [{ variantId: 31, sku: 'DECHRA-00002', metodo: 'auto_nombre' }],
    });
  });

  it('índice del catálogo: los equivalentes se resuelven sin buscar en Siweb360; el prescrito no indexado sí busca', async () => {
    const busquedas: (string | null)[] = [];
    server.use(
      http.get(`${BASE}inventory/variants`, ({ request }) => {
        const s = new URL(request.url).searchParams.get('search');
        busquedas.push(s);
        if (s === null)
          return HttpResponse.json({
            success: true,
            pagination: { page: 1, limit: 200, total: 2, pages: 1 },
            data: [
              { id: 41, sku: 'DECHRA-00003-CN-584177.4', name: 'OTRO 10 COMPRIMIDOS- CN 584177.4' },
              { id: 42, sku: 'PIENSO-0001', name: 'Pienso gato' },
            ],
          });
        return HttpResponse.json({
          success: true,
          data: s === '599999' ? [{ id: 43, sku: 'NUEVO-0001-CN599999' }] : [],
        });
      }),
    );
    const res = new VariantResolver(h.db, client(), PATRON, new IndiceCatalogo(client(), PATRON));
    expect(await res.resolver('584177', null)).toMatchObject({
      estado: 'MAPEADO',
      variantes: [{ variantId: 41 }],
    });
    // Equivalente que no está en el catálogo: sin búsquedas.
    expect(await res.resolver('570099', null)).toEqual({ estado: 'NO_ENCONTRADO', candidatos: [] });
    expect(busquedas).toEqual([null]);
    // Prescrito recién creado en Siweb360 (aún no indexado): búsqueda directa.
    expect(await res.resolver('599999', { nombre: 'NUEVO', labtitular: null })).toMatchObject({
      estado: 'MAPEADO',
      variantes: [{ variantId: 43 }],
    });
  });

  it('índice no disponible (Siweb360 falla al cargarlo) → búsqueda directa', async () => {
    server.use(
      http.get(`${BASE}inventory/variants`, ({ request }) => {
        const s = new URL(request.url).searchParams.get('search');
        if (s === null) return HttpResponse.json({ error: 'caído' }, { status: 503 });
        return HttpResponse.json({
          success: true,
          data: s === '584188' ? [{ id: 44, sku: 'X', name: 'Producto CN 584188.5' }] : [],
        });
      }),
    );
    const indice = new IndiceCatalogo(client(), PATRON);
    expect(await indice.porCn('584188')).toBeNull();
    const res = new VariantResolver(h.db, client(), PATRON, indice);
    expect(await res.resolver('584188', null)).toMatchObject({
      estado: 'MAPEADO',
      variantes: [{ variantId: 44 }],
    });
  });

  it('varias variantes con el CN → la persona elige; ninguna → candidatos por nombre', async () => {
    server.use(
      http.get(`${BASE}inventory/variants`, ({ request }) => {
        const s = new URL(request.url).searchParams.get('search');
        if (s === 'CN580001') {
          return HttpResponse.json({
            success: true,
            data: [
              { id: 1, sku: 'A-0001-CN580001' },
              { id: 2, sku: 'X', name: 'Lote CN580001' },
            ],
          });
        }
        if (s === 'CN590000') return HttpResponse.json({ success: true, data: [] });
        return HttpResponse.json({
          success: true,
          data: [
            { id: 7, sku: 'AMX-VIEJO', product_name: 'Amoxivet 500 comprimidos Lab A' },
            { id: 8, sku: 'OTRA', product_name: 'Pienso gato' },
          ],
        });
      }),
    );
    const res = new VariantResolver(h.db, client(), PATRON);
    expect(await res.resolver('580001', null)).toMatchObject({ estado: 'ELEGIR', motivo: 'VARIAS_POR_CN' });
    const r = await res.resolver('590000', { nombre: 'AMOXIVET 500 mg COMPRIMIDOS', labtitular: 'Lab A' });
    expect(r.estado).toBe('NO_ENCONTRADO');
    expect(r.estado === 'NO_ENCONTRADO' && r.candidatos.map((c) => c.id)).toEqual([7]);
    expect(await res.resolver('590000', null)).toEqual({ estado: 'NO_ENCONTRADO', candidatos: [] });
  });

  it('mapeo manual por SKU (validado) o por variante, y comprobación de la convención', async () => {
    server.use(
      http.get(`${BASE}inventory/variants`, () =>
        HttpResponse.json({ success: true, data: [{ id: 7, sku: 'AMX-VIEJO', product_name: 'Amoxivet' }] }),
      ),
      http.get(`${BASE}inventory/variants/:id`, () =>
        HttpResponse.json({
          success: true,
          data: { id: 8, sku: 'ZOETIS-0001-CN590000', product_name: 'Amoxivet CN590000' },
        }),
      ),
    );
    const res = new VariantResolver(h.db, client(), PATRON);
    const m = await res.mapearPorSku('590000', 'amx-viejo', 'dev-empleado');
    expect(m).toMatchObject({ variante: { id: 7 }, cumpleConvencion: false });
    // Error de dominio (404 con mensaje legible en la pantalla de dispensación), no un error interno.
    await expect(res.mapearPorSku('590000', 'NO-EXISTE', 'dev-empleado')).rejects.toMatchObject({
      code: 'NO_ENCONTRADO',
      message: expect.stringMatching(/SKU «NO-EXISTE»/),
    });
    expect((await res.mapearVariante('590000', 8, 'dev-empleado')).cumpleConvencion).toBe(true);
    const filas = await h.db.select().from(siwebVariantMap).where(eq(siwebVariantMap.cn, '590000'));
    expect(filas.map((f) => [f.variantId, f.metodo])).toEqual([
      [7, 'manual'],
      [8, 'manual'],
    ]);
    expect((await res.mapeos('590000')).length).toBe(2);
    expect(similitudNombre('', 'x')).toBe(0);
  });
});

describe('propuesta de SKU con correlativo reservado y bandeja (D-04, D-04c)', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}inventory/variants`, ({ request }) => {
        const s = new URL(request.url).searchParams.get('search') ?? '';
        if (s === 'ZOETIS-')
          return HttpResponse.json({
            success: true,
            data: [
              { id: 1, sku: 'ZOETIS-0007-CN111111' },
              { id: 2, sku: 'ZOETIS-0003-CN222222' },
            ],
          });
        if (s === 'ZOETIS-0009-CN570016')
          return HttpResponse.json({ success: true, data: [{ id: 55, sku: 'ZOETIS-0009-CN570016' }] });
        if (s === 'CN333333')
          return HttpResponse.json({ success: true, data: [{ id: 66, sku: 'ZOETIS-0042-CN333333' }] });
        return HttpResponse.json({ success: true, data: [] });
      }),
      http.get(`${BASE}inventory/variants/:id`, () =>
        HttpResponse.json({ success: true, data: { id: 66, sku: 'ZOETIS-0042-CN333333' } }),
      ),
    );
  });

  it('pide el prefijo la primera vez, reserva correlativos sin repetir y respeta Siweb360 + reservas', async () => {
    const reservas = new SkuReservas(h.db, client());
    const writer = new ManualTaskCatalogWriter(h.db, reservas);
    const base = {
      cn: '570016',
      nregistro: '1868 ESP',
      nombre: 'CLAVUBAY 400/100',
      labtitular: 'Zoetis Spain, S.L.U.',
      origen: 'recepcion_linea' as const,
      actor: 'dev-empleado',
    };
    expect(await writer.solicitarAlta(base)).toEqual({ requierePrefijo: true, sugerido: 'ZOETIS' });
    await expect(reservas.reservar('Zoetis Spain, S.L.U.', 'x y')).rejects.toThrow(/prefijo/);
    const a = await writer.solicitarAlta({ ...base, prefijoConfirmado: 'zoetis' });
    expect('propuesta' in a && a.propuesta).toMatchObject({
      sku: 'ZOETIS-0008-CN570016',
      nombre: 'CLAVUBAY 400/100 CN570016',
      correlativo: 8,
    });
    // Dos peticiones simultáneas no proponen el mismo SKU.
    const [b, c] = await Promise.all([
      writer.solicitarAlta(base),
      writer.solicitarAlta({ ...base, cn: '570017' }),
    ]);
    const nums = [b, c].map((x) => ('propuesta' in x ? x.propuesta.correlativo : 0)).sort((x, y) => x - y);
    expect(nums).toEqual([9, 10]);
    const ren = await writer.solicitarRenombrado({
      cn: '333333',
      nregistro: null,
      variante: { id: 66, sku: 'VIEJO', name: 'x', product_name: 'Producto' },
      labtitular: 'Zoetis Spain, S.L.U.',
      actor: 'dev-admin',
    });
    expect('propuesta' in ren && ren.propuesta).toMatchObject({
      skuActual: 'VIEJO',
      skuNuevo: 'ZOETIS-0011-CN333333',
      nombreNuevo: 'Producto CN333333',
    });
    expect(() => crearCatalogWriter({ catalogWrite: true }, h.db, reservas)).toThrow(/D-04b/);
    expect(crearCatalogWriter({ catalogWrite: false }, h.db, reservas).tipo).toBe('manual');
  });

  it('marcar hecha revalida en Siweb360; si se usó otro SKU se guarda el real y se avisa', async () => {
    const bandeja = new BandejaSiweb(h.db, client(), new VariantResolver(h.db, client(), PATRON));
    const pend = await bandeja.pendientes();
    const alta = pend.find(
      (t) => t.cn === '570016' && (t.propuesta as { sku: string }).sku === 'ZOETIS-0009-CN570016',
    )!;
    expect(await bandeja.marcarHecha(alta.id, 'dev-empleado')).toEqual({
      variantId: 55,
      skuReal: 'ZOETIS-0009-CN570016',
      skuDistinto: false,
    });
    const ren = pend.find((t) => t.tipo === 'renombrar')!;
    expect(await bandeja.marcarHecha(ren.id, 'dev-admin')).toMatchObject({
      variantId: 66,
      skuReal: 'ZOETIS-0042-CN333333',
      skuDistinto: true,
    });
    await expect(bandeja.marcarHecha(ren.id, 'dev-admin')).rejects.toThrow(/ya resuelta/);
    const otra = pend.find((t) => t.cn === '570017')!;
    await expect(bandeja.marcarHecha(otra.id, 'x')).rejects.toThrow(/No se encuentra/);
    await bandeja.descartar(otra.id, 'dev-admin', 'duplicado');
    const [t] = await h.db.select().from(siwebTarea).where(eq(siwebTarea.id, otra.id));
    expect(t?.estado).toBe('descartada');
  });
});

describe('outbox de entradas (SPEC §5.2.4–5.2.5)', () => {
  async function recepcionFinalizada(lineas: Array<{ variant: number | null; unidades?: number }>) {
    const [d] = await h.db.select().from(distribuidor).limit(1);
    const [r] = await h.db
      .insert(recepcion)
      .values({ distribuidorId: d!.id, fechaCompra: '2026-10-14', empleado: 'dev-empleado' })
      .returning();
    let n = 0;
    for (const l of lineas) {
      n++;
      await h.db.insert(recepcionLinea).values({
        recepcionId: r!.id,
        numero: n,
        cn: `57${String(n).padStart(4, '0')}`,
        nombreFarmaco: 'X',
        lote: `L${n}`,
        caducidad: '2027-12-31',
        unidades: l.unidades ?? 3,
        origenDatos: 'cimavet',
        siwebVariantId: l.variant,
        empleado: 'dev-empleado',
      });
    }
    await h.db.update(recepcion).set({ estado: 'FINALIZADA' }).where(eq(recepcion.id, r!.id));
    return r!.id;
  }
  const svc = (modo: 'off' | 'entries_only', o: { prueba?: Date | null; now?: () => Date } = {}) =>
    new OutboxService(
      h.db,
      client({ timeoutMs: 30 }),
      {
        modo,
        almacenId: async () => 21,
        pruebaVigente: async () => (o.prueba === undefined ? new Date() : o.prueba),
      },
      { log: () => {}, ...(o.now ? { now: o.now } : {}) },
    );
  const filasDe = (recepcionId: string) =>
    h.db
      .select()
      .from(outbox)
      .where(like(outbox.idempotencyKey, `MMX-REC-${recepcionId}-%`));

  it('con SIWEB_STOCK_WRITE_MODE=off no se encola ni se envía nada', async () => {
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    const r = await h.db.transaction((tx) => svc('off').encolarRecepcion(tx, id));
    expect(r).toEqual({ encoladas: 0, pendientesAlta: 0, escrituraDesactivada: true });
    expect(await svc('off').despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
    expect(await h.db.select().from(outbox)).toEqual([]);
  });

  it('entries_only: encola ajustes purchase_receipt con lote, caducidad y clave en notes; sin variante → PENDIENTE_ALTA_SIWEB', async () => {
    const enviados: unknown[] = [];
    server.use(
      http.post(`${BASE}inventory/stock/adjustments`, async ({ request }) => {
        enviados.push(await request.json());
        return HttpResponse.json(fx('doc-adjustment.json'));
      }),
    );
    const id = await recepcionFinalizada([{ variant: 9001 }, { variant: null }]);
    const r = await h.db.transaction((tx) => svc('entries_only').encolarRecepcion(tx, id));
    expect(r).toEqual({ encoladas: 1, pendientesAlta: 1, escrituraDesactivada: false });
    expect(await svc('entries_only').despachar()).toEqual({ sent: 1, failed: 0, needs_reconciliation: 0 });
    expect(enviados).toEqual([
      {
        variant_id: 9001,
        warehouse_id: 21,
        quantity: 3,
        mode: 'delta',
        reason: 'purchase_receipt',
        notes: claveEntrada(id, 1),
        batch_number: 'L1',
        expiry_date: '2027-12-31',
      },
    ]);
    // La línea pendiente de alta se encola al completarse el alta en Siweb360.
    expect(await svc('entries_only').reencolarPendientesAlta('570002', 9100)).toBe(1);
    expect(await svc('entries_only').despachar()).toMatchObject({ sent: 1 });
    const [rec] = await h.db.select().from(recepcion).where(eq(recepcion.id, id));
    expect(rec?.estado).toBe('SINCRONIZADA');
    expect(await svc('off').reencolarPendientesAlta('570002', 1)).toBe(0);
  });

  it('timeout tras enviar → needs_reconciliation y NUNCA se reenvía solo', async () => {
    let llamadas = 0;
    server.use(
      http.post(`${BASE}inventory/stock/adjustments`, async () => {
        llamadas++;
        await delay(200);
        return HttpResponse.json(fx('doc-adjustment.json'));
      }),
    );
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    await h.db.transaction((tx) => svc('entries_only').encolarRecepcion(tx, id));
    expect(await svc('entries_only').despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 1 });
    expect(await svc('entries_only').despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
    expect(llamadas).toBe(1);
    const [row] = await svc('entries_only').listar(['needs_reconciliation']);
    expect(row?.lastError).toMatch(/Timeout/);
    const [rec] = await h.db.select().from(recepcion).where(eq(recepcion.id, id));
    expect(rec?.estado).toBe('ERROR_SINCRONIZACION');

    // Una persona comprueba que NO se aplicó y decide reenviar.
    server.use(
      http.post(`${BASE}inventory/stock/adjustments`, () => HttpResponse.json(fx('doc-adjustment.json'))),
    );
    await svc('entries_only').resolver(
      row!.id,
      'reenviar',
      'dev-admin',
      'Comprobado en Siweb360: no aplicado',
    );
    expect(await svc('entries_only').despachar()).toMatchObject({ sent: 1 });
    await expect(svc('entries_only').resolver(row!.id, 'reenviar', 'dev-admin', 'x')).rejects.toThrow();
  });

  it('envío interrumpido (bloqueo caducado) → needs_reconciliation y NO se reenvía solo', async () => {
    let llamadas = 0;
    server.use(
      http.post(`${BASE}inventory/stock/adjustments`, () => {
        llamadas++;
        return HttpResponse.json(fx('doc-adjustment.json'));
      }),
    );
    const id = await recepcionFinalizada([{ variant: 9001 }]);
    await h.db.transaction((tx) => svc('entries_only').encolarRecepcion(tx, id));
    // El proceso tomó la fila hace 11 minutos y se paró sin guardar el resultado.
    await h.db
      .update(outbox)
      .set({ lockedAt: new Date(Date.now() - 11 * 60_000), attempts: 1 })
      .where(eq(outbox.status, 'pending'));
    expect(await svc('entries_only').despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 1 });
    expect(llamadas).toBe(0);
    const [row] = await svc('entries_only').listar(['needs_reconciliation']);
    expect(row?.lockedAt).toBeNull();
    const [rec] = await h.db.select().from(recepcion).where(eq(recepcion.id, id));
    expect(rec?.estado).toBe('ERROR_SINCRONIZACION');
    // Un bloqueo reciente (otro dispatcher enviando ahora) no se toca.
    const id2 = await recepcionFinalizada([{ variant: 9002 }]);
    await h.db.transaction((tx) => svc('entries_only').encolarRecepcion(tx, id2));
    await h.db.update(outbox).set({ lockedAt: new Date() }).where(eq(outbox.status, 'pending'));
    expect(await svc('entries_only').despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
    expect(llamadas).toBe(0);
  });

  it('5xx → needs_reconciliation; 409 (stock ilimitado) y 4xx → failed; confirmar aplicada', async () => {
    const id = await recepcionFinalizada([{ variant: 1 }, { variant: 2 }, { variant: 3 }]);
    server.use(
      http.post(`${BASE}inventory/stock/adjustments`, async ({ request }) => {
        const b = (await request.json()) as { variant_id: number };
        if (b.variant_id === 1) return new HttpResponse(null, { status: 500 });
        if (b.variant_id === 2) return HttpResponse.json({ success: false }, { status: 409 });
        return HttpResponse.json({ success: false, message: 'variant not found' }, { status: 404 });
      }),
    );
    await h.db.transaction((tx) => svc('entries_only').encolarRecepcion(tx, id));
    expect(await svc('entries_only').despachar()).toEqual({ sent: 0, failed: 2, needs_reconciliation: 1 });
    const fallidas = await svc('entries_only').listar(['failed']);
    expect(fallidas.map((f) => f.lastError)).toEqual(
      expect.arrayContaining(['SIWEB_STOCK_ILIMITADO', expect.stringMatching(/HTTP 404/)]),
    );
    const [rec] = await svc('entries_only').listar(['needs_reconciliation']);
    await svc('entries_only').resolver(rec!.id, 'confirmar_aplicada', 'dev-admin', 'Visto en Siweb360');
    await svc('entries_only').resolver(fallidas[0]!.id, 'descartar', 'dev-admin', 'Se da de alta a mano');
  });

  it('el outbox rechaza cualquier salida o ajuste negativo', async () => {
    expect(() =>
      exigirEntrada({ variant_id: 1, warehouse_id: 1, quantity: -1, reason: 'purchase_receipt' }),
    ).toThrow();
    expect(() =>
      exigirEntrada({ variant_id: 1, warehouse_id: 1, quantity: 1, reason: 'sale_shipment' }),
    ).toThrow();
    expect(() =>
      exigirEntrada({ variant_id: 1, warehouse_id: 1, quantity: 1, mode: 'set', reason: 'purchase_receipt' }),
    ).toThrow();
    await h.db
      .insert(outbox)
      .values({ operation: 'stock_adjustment_sale', payload: { quantity: -1 }, idempotencyKey: 'MMX-X-1-1' });
    expect(await svc('entries_only').despachar()).toMatchObject({ failed: 1 });
  });

  describe('prueba de escritura vigente (specs/011, FR-010b)', () => {
    const DIA = 24 * 3600_000;
    it.each([
      ['sin prueba', null, false],
      ['prueba de hace 31 días', new Date(Date.now() - 31 * DIA), false],
      ['prueba de hace 29 días', new Date(Date.now() - 29 * DIA), true],
    ])('%s → se envía: %s', async (_n, prueba, enviadas) => {
      server.use(
        http.post(`${BASE}inventory/stock/adjustments`, () => HttpResponse.json(fx('doc-adjustment.json'))),
      );
      const id = await recepcionFinalizada([{ variant: 9001 }]);
      await h.db.transaction((tx) => svc('entries_only').encolarRecepcion(tx, id));
      const r = await svc('entries_only', { prueba }).despachar();
      if (!enviadas) expect(r).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
      const [f] = await filasDe(id);
      expect(f?.status).toBe(enviadas ? 'sent' : 'pending');
    });

    it('apagar la escritura conserva los pendientes y al volver a encenderla se envían (FR-012)', async () => {
      server.use(
        http.post(`${BASE}inventory/stock/adjustments`, () => HttpResponse.json(fx('doc-adjustment.json'))),
      );
      const id = await recepcionFinalizada([{ variant: 9001 }]);
      await h.db.transaction((tx) => svc('entries_only').encolarRecepcion(tx, id));
      expect(await svc('off').despachar()).toEqual({ sent: 0, failed: 0, needs_reconciliation: 0 });
      expect((await filasDe(id))[0]?.status).toBe('pending');
      expect(await svc('entries_only').despachar()).toMatchObject({ sent: 1 });
    });
  });

  describe('verificación de envíos dudosos contra el historial (specs/011, US2)', () => {
    let ajustes = 0;
    /** Recepción con un envío que acabó en 5xx (dudoso), creado en el instante `t0`. */
    async function envioDudoso(t0: Date) {
      ajustes = 0;
      server.use(
        http.post(`${BASE}inventory/stock/adjustments`, () => {
          ajustes++;
          return new HttpResponse(null, { status: 502 });
        }),
      );
      const id = await recepcionFinalizada([{ variant: 9001 }]);
      await h.db.transaction((tx) => svc('entries_only').encolarRecepcion(tx, id));
      expect(await svc('entries_only', { now: () => t0 }).despachar()).toMatchObject({
        needs_reconciliation: 1,
      });
      const [f] = await filasDe(id);
      return { id, fila: f! };
    }
    const historial = (notas: Array<string | null>) =>
      http.get(`${BASE}inventory/movements`, ({ request }) => {
        const u = new URL(request.url);
        expect(u.searchParams.get('variant_id')).toBe('9001');
        expect(u.searchParams.get('reason')).toBe('purchase_receipt');
        return HttpResponse.json({
          success: true,
          data: notas.map((n, i) => ({
            id: 70000 + i,
            variant_id: 9001,
            quantity: 3,
            reason: 'purchase_receipt',
            notes: n,
          })),
        });
      });
    const despues = (t0: Date, min: number) => () => new Date(t0.getTime() + min * 60_000);

    it('aparece una vez → enviado, línea sincronizada y auditado; no se comprueba antes de 10 min', async () => {
      const t0 = new Date();
      const { id, fila } = await envioDudoso(t0);
      expect(fila.nextAttemptAt?.getTime()).toBe(t0.getTime() + 10 * 60_000);
      server.use(historial(['otra cosa', fila.idempotencyKey]));
      expect(await svc('entries_only', { now: despues(t0, 5) }).verificarDudosos()).toEqual({
        verificadas: 0,
        noConsta: 0,
        duplicadas: 0,
      });
      expect(await svc('entries_only', { now: despues(t0, 11) }).verificarDudosos()).toMatchObject({
        verificadas: 1,
      });
      const [f] = await filasDe(id);
      expect(f).toMatchObject({ status: 'sent', resolvedBy: 'outbox-verificador', nextAttemptAt: null });
      expect((f?.response as { movimiento: { id: number } }).movimiento.id).toBe(70001);
      const [rec] = await h.db.select().from(recepcion).where(eq(recepcion.id, id));
      expect(rec?.estado).toBe('SINCRONIZADA');
      const audit = await h.db.select().from(auditEvent).where(eq(auditEvent.entidadId, fila.id));
      expect(audit.map((a) => a.accion)).toContain('outbox_verificado_auto');
      expect(ajustes).toBe(1);
    });

    it('no aparece (o la nota no es exacta) → sigue en revisión, cada 15 min, y deja de comprobar a las 96', async () => {
      const t0 = new Date();
      const { id, fila } = await envioDudoso(t0);
      server.use(historial([`${fila.idempotencyKey} `, null]));
      expect(await svc('entries_only', { now: despues(t0, 11) }).verificarDudosos()).toMatchObject({
        noConsta: 1,
      });
      let [f] = await filasDe(id);
      expect(f).toMatchObject({ status: 'needs_reconciliation', verificaciones: 1 });
      expect(f?.lastError).toMatch(/^No consta en Siweb360/);
      expect(f?.nextAttemptAt?.getTime()).toBe(t0.getTime() + 26 * 60_000);
      await h.db
        .update(outbox)
        .set({ verificaciones: MAX_VERIFICACIONES - 1 })
        .where(eq(outbox.id, fila.id));
      await svc('entries_only', { now: despues(t0, 30) }).verificarDudosos();
      [f] = await filasDe(id);
      expect(f?.nextAttemptAt).toBeNull();
      expect(f?.status).toBe('needs_reconciliation');
      expect(ajustes).toBe(1);
    });

    it('aparece dos veces → posible duplicado, sin más comprobaciones', async () => {
      const t0 = new Date();
      const { id, fila } = await envioDudoso(t0);
      server.use(historial([fila.idempotencyKey, fila.idempotencyKey]));
      expect(await svc('entries_only', { now: despues(t0, 11) }).verificarDudosos()).toMatchObject({
        duplicadas: 1,
      });
      const [f] = await filasDe(id);
      expect(f).toMatchObject({ status: 'needs_reconciliation', nextAttemptAt: null });
      expect(f?.lastError).toMatch(/Posible duplicado en Siweb360 \(2 movimientos\)/);
    });

    it('el historial no responde → no cambia nada', async () => {
      const t0 = new Date();
      const { id, fila } = await envioDudoso(t0);
      server.use(http.get(`${BASE}inventory/movements`, () => new HttpResponse(null, { status: 503 })));
      expect(await svc('entries_only', { now: despues(t0, 11) }).verificarDudosos()).toEqual({
        verificadas: 0,
        noConsta: 0,
        duplicadas: 0,
      });
      const [f] = await filasDe(id);
      expect(f).toMatchObject({
        status: 'needs_reconciliation',
        verificaciones: 0,
        lastError: fila.lastError,
      });
    });

    it('cualquier usuario cierra: revisado → sent, resuelto a mano → resolved_manually; no se cierra dos veces', async () => {
      const t0 = new Date();
      const a = await envioDudoso(t0);
      const b = await envioDudoso(t0);
      await svc('entries_only').cerrar(a.fila.id, 'revisado', 'dev-empleado', 'Visto en Siweb360');
      await svc('entries_only').cerrar(b.fila.id, 'resuelto_a_mano', 'dev-empleado', 'Dado de alta a mano');
      expect((await filasDe(a.id))[0]).toMatchObject({ status: 'sent', resolvedBy: 'dev-empleado' });
      expect((await filasDe(b.id))[0]).toMatchObject({ status: 'resolved_manually' });
      const [rec] = await h.db.select().from(recepcion).where(eq(recepcion.id, b.id));
      expect(rec?.estado).toBe('SINCRONIZADA');
      await expect(
        svc('entries_only').cerrar(a.fila.id, 'revisado', 'dev-empleado', 'Otra vez'),
      ).rejects.toThrow(/Solo se cierran/);
    });
  });
});

describe('conciliación de ventas: tickets de Siweb360 (D-02b)', () => {
  it('desactivada → el adaptador queda inactivo', async () => {
    const s = new NotConfiguredSalesMovementsSource();
    expect(s.configurado).toBe(false);
    await expect(s.movimientos()).rejects.toThrow(/desactivada/);
  });

  it('lee los tickets Pagado del día y saca el CN del nombre de cada línea (sin lote); ignora líneas sin CN', async () => {
    let query = '';
    server.use(
      http.get(`${BASE}tickets/:id`, ({ params }) =>
        HttpResponse.json(fx(`doc-ticket-${String(params.id)}.json`)),
      ),
      http.get(`${BASE}tickets`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json(fx('doc-tickets.json'));
      }),
    );
    const s = new TicketsSalesMovementsSource(client(), 'CN\\s?(\\d{6,7})');
    const m = await s.movimientos('2026-10-14', '2026-10-14');
    expect(query).toContain('fecha_desde=2026-10-14');
    expect(query).toContain('estado=Pagado');
    expect(m).toEqual([
      {
        id: '7001:1',
        variantId: null,
        cn: '570016',
        lote: null,
        unidades: 1,
        fecha: '2026-10-14',
        ticket: 'T-2026-000101',
      },
      {
        id: '7002:3',
        variantId: null,
        cn: '570004',
        lote: null,
        unidades: 2,
        fecha: '2026-10-14',
        ticket: 'T-2026-000102',
      },
    ]);
  });

  it('si la API devuelve tantos tickets como el límite, la lectura se considera incompleta', async () => {
    server.use(
      http.get(`${BASE}tickets`, () =>
        HttpResponse.json({ success: true, data: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 })) }),
      ),
    );
    await expect(
      new TicketsSalesMovementsSource(client(), 'CN(\\d{6})').movimientos('2026-10-14', '2026-10-14'),
    ).rejects.toBeInstanceOf(LecturaTicketsIncompleta);
  });
});
