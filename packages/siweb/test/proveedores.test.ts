import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { HttpError } from '@mmx/shared/node';
import { SiwebClient, SiwebValidationError } from '../src/client';

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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('proveedores del producto en Siweb360 (specs/016, API 1.3.0)', () => {
  it('proveedoresDeProducto lee contact_id, CIF y coste de cada proveedor', async () => {
    server.use(
      http.get(`${BASE}inventory/products/3120/suppliers`, () =>
        HttpResponse.json(fx('doc-product-suppliers.json')),
      ),
    );
    const r = await client().proveedoresDeProducto(3120);
    expect(r.map((p) => [p.contact_id, p.supplier_cif, p.purchase_cost_cents])).toEqual([
      [41, 'B12345678', 650.25],
      [42, 'F87654321', 700],
    ]);
  });

  it('tolera campos nuevos y números como texto', async () => {
    server.use(
      http.get(`${BASE}inventory/products/1/suppliers`, () =>
        HttpResponse.json({
          success: true,
          data: [{ contact_id: '41', purchase_cost_cents: '650.25', campo_nuevo: { a: 1 } }],
        }),
      ),
    );
    const [p] = await client().proveedoresDeProducto(1);
    expect(p).toMatchObject({ contact_id: 41, purchase_cost_cents: 650.25 });
  });

  it('una respuesta sin contact_id no es válida', async () => {
    server.use(
      http.get(`${BASE}inventory/products/1/suppliers`, () =>
        HttpResponse.json({ success: true, data: [{ id: 1 }] }),
      ),
    );
    await expect(client().proveedoresDeProducto(1)).rejects.toBeInstanceOf(SiwebValidationError);
  });

  it('actualizarCosteProveedor envía PUT con SOLO purchase_cost_cents', async () => {
    let cuerpo: unknown = null;
    server.use(
      http.put(`${BASE}inventory/products/:id/suppliers/:contact`, async ({ request, params }) => {
        expect(params).toEqual({ id: '3120', contact: '41' });
        expect(request.headers.get('authorization')).toBe('Bearer tok-test');
        cuerpo = await request.json();
        return HttpResponse.json(fx('doc-supplier-update.json'));
      }),
    );
    const r = await client().actualizarCosteProveedor(3120, 41, 1014);
    expect(cuerpo).toEqual({ purchase_cost_cents: 1014 });
    expect(r).toMatchObject({ contact_id: 41, purchase_cost_cents: 1014 });
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])('rechaza enviar el coste %s', async (v) => {
    await expect(client().actualizarCosteProveedor(1, 2, v)).rejects.toThrow();
  });

  it.each([[400], [401], [404]])('un %s de Siweb360 sube como HttpError sin reintentar', async (status) => {
    let llamadas = 0;
    server.use(
      http.put(`${BASE}inventory/products/:id/suppliers/:contact`, () => {
        llamadas++;
        return HttpResponse.json({ success: false, error: 'x' }, { status });
      }),
    );
    await expect(client().actualizarCosteProveedor(1, 2, 100)).rejects.toMatchObject({ status });
    expect(llamadas).toBe(1);
  });

  it('un 5xx no se reintenta (la escritura puede haberse aplicado)', async () => {
    let llamadas = 0;
    server.use(
      http.put(`${BASE}inventory/products/:id/suppliers/:contact`, () => {
        llamadas++;
        return new HttpResponse('boom', { status: 503 });
      }),
    );
    await expect(client().actualizarCosteProveedor(1, 2, 100)).rejects.toBeInstanceOf(HttpError);
    expect(llamadas).toBe(1);
  });

  it('un timeout sube como error de red sin reintentar', async () => {
    let llamadas = 0;
    server.use(
      http.put(`${BASE}inventory/products/:id/suppliers/:contact`, async () => {
        llamadas++;
        await delay(200);
        return HttpResponse.json(fx('doc-supplier-update.json'));
      }),
    );
    await expect(client({ timeoutMs: 30 }).actualizarCosteProveedor(1, 2, 100)).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(llamadas).toBe(1);
  });

  it('contacto devuelve el CIF del detalle', async () => {
    server.use(http.get(`${BASE}contacts/41`, () => HttpResponse.json(fx('doc-contact-detail.json'))));
    expect(await client().contacto(41)).toMatchObject({
      id: 41,
      cif: 'B12345678',
      tipo_relacion: 'Proveedor',
    });
  });

  it('buscarProveedoresPorNombre filtra por tipo, activo, texto y límite', async () => {
    let url: URL | null = null;
    server.use(
      http.get(`${BASE}contacts`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(fx('doc-contacts-proveedores.json'));
      }),
    );
    const r = await client().buscarProveedoresPorNombre('Distribuidora', 10);
    expect(r.length).toBeGreaterThan(0);
    expect(Object.fromEntries(url!.searchParams)).toEqual({
      tipo: 'Proveedor',
      activo: 'true',
      search: 'Distribuidora',
      limit: '10',
    });
  });
});
