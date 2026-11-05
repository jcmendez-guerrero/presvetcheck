import type { z } from 'zod';
import { HttpClient, HttpError, type HttpOptions } from '@mmx/shared/node';
import {
  AdjustmentResultSchema,
  Envelope,
  LotSchema,
  ProductSchema,
  StockSchema,
  TicketSchema,
  VariantSchema,
  WarehouseSchema,
  type AdjustmentRequest,
  type AdjustmentResult,
  type Lot,
  type Product,
  type Stock,
  type Ticket,
  type TransferRequest,
  type Variant,
  type Warehouse,
  ContactSchema,
  type Contact,
  VariantPricingResponseSchema,
  type VariantPricingRequest,
  type VariantPricingResponse,
  StockMovementSchema,
  type StockMovement,
} from './schemas';

export class SiwebValidationError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly issues: string[],
  ) {
    super(`Respuesta de Siweb360 no válida en ${endpoint}: ${issues.join('; ')}`);
    this.name = 'SiwebValidationError';
  }
}

export interface SiwebClientOptions extends Partial<HttpOptions> {
  baseUrl: string;
  /** Token Bearer (Key Vault en Azure; SIWEB_TOKEN solo en local). */
  token: string | (() => Promise<string>);
  pageLimit?: number;
  maxPaginas?: number;
}

export type FiltrosVariantes = {
  search?: string;
  product_id?: number;
  warehouse_id?: number;
  with_stock?: boolean;
  out_of_stock?: boolean;
  low_stock?: boolean;
  status?: string;
};

/**
 * Cliente de la API de Inventario de Siweb360 (SPEC §5.2.1). Las lecturas se reintentan; las
 * escrituras (`adjustments`, `transfers`) NUNCA se reintentan automáticamente (no hay claves de
 * idempotencia: ADR-08, outbox).
 */
export class SiwebClient {
  private readonly http: HttpClient;
  private readonly base: string;
  private readonly limit: number;
  private readonly maxPaginas: number;

  constructor(private readonly opts: SiwebClientOptions) {
    this.base = opts.baseUrl.endsWith('/') ? opts.baseUrl : `${opts.baseUrl}/`;
    this.limit = Math.min(opts.pageLimit ?? 200, 200);
    this.maxPaginas = opts.maxPaginas ?? 100;
    this.http = new HttpClient({
      rps: opts.rps ?? 5,
      timeoutMs: opts.timeoutMs ?? 10_000,
      maxRetries: opts.maxRetries ?? 2,
      baseDelayMs: opts.baseDelayMs ?? 300,
      userAgent: opts.userAgent ?? 'MundoMascotix-Recetas/0.1',
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
      ...(opts.random ? { random: opts.random } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
  }

  private async headers(): Promise<Record<string, string>> {
    const token = typeof this.opts.token === 'string' ? this.opts.token : await this.opts.token();
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  private url(path: string, params: Record<string, string | number | boolean | undefined> = {}): string {
    const u = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private parse<S extends z.ZodTypeAny>(schema: S, json: unknown, endpoint: string): z.output<S> {
    const r = Envelope(schema).safeParse(json);
    if (!r.success)
      throw new SiwebValidationError(
        endpoint,
        r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    return (r.data as { data: z.output<S> }).data;
  }

  private async getConMeta<S extends z.ZodTypeAny>(
    schema: S,
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ) {
    const { json } = await this.http.request(this.url(path, params), { headers: await this.headers() });
    const r = Envelope(schema).safeParse(json);
    if (!r.success)
      throw new SiwebValidationError(
        path,
        r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    const d = r.data as { data: z.output<S>; pagination?: { pages?: number | null } | null };
    return { data: d.data, paginas: d.pagination?.pages ?? null };
  }

  private async get<S extends z.ZodTypeAny>(
    schema: S,
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ) {
    return (await this.getConMeta(schema, path, params)).data;
  }

  /** Recorre páginas (`page`, `limit ≤ 200`) según `pagination.pages`; sin metadatos, hasta una página incompleta. */
  private async paginado<S extends z.ZodTypeAny>(
    schema: S,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<z.output<S>[]> {
    const out: z.output<S>[] = [];
    for (let page = 1; page <= this.maxPaginas; page++) {
      const { data, paginas } = await this.getConMeta(schema.array(), path, {
        ...params,
        page,
        limit: this.limit,
      });
      const items = data as z.output<S>[];
      out.push(...items);
      if (paginas !== null ? page >= paginas : items.length < this.limit) break;
    }
    return out;
  }

  products(
    f: { search?: string; brand?: string; product_type?: string; category_id?: number } = {},
  ): Promise<Product[]> {
    return this.paginado(ProductSchema, 'inventory/products', f);
  }
  product(id: number) {
    return this.get(ProductSchema, `inventory/products/${id}`);
  }
  variants(f: FiltrosVariantes = {}): Promise<Variant[]> {
    return this.paginado(VariantSchema, 'inventory/variants', f);
  }
  /** Variante con desglose de stock por almacén/ubicación/lote (`stock_levels[]`). */
  variant(id: number): Promise<Variant> {
    return this.get(VariantSchema, `inventory/variants/${id}`);
  }
  stock(id: number): Promise<Stock> {
    return this.get(StockSchema, `inventory/variants/${id}/stock`);
  }
  /** Lotes y caducidades; la API los ordena por fecha de creación (no por caducidad). */
  lots(id: number, limit = 200): Promise<Lot[]> {
    return this.get(LotSchema.array(), `inventory/variants/${id}/lots`, { limit });
  }
  lowStock(warehouseId?: number) {
    return this.get(VariantSchema.partial().array(), 'inventory/stock/low', { warehouse_id: warehouseId });
  }
  /** Proveedores dados de alta en Siweb360 (`GET contacts?tipo=Proveedor`), para proponer el distribuidor. */
  proveedores(search?: string): Promise<Contact[]> {
    return this.get(ContactSchema.array(), 'contacts', {
      tipo: 'Proveedor',
      activo: true,
      search,
      limit: 200,
    });
  }

  warehouses(search?: string): Promise<Warehouse[]> {
    return this.get(WarehouseSchema.array(), 'inventory/warehouses', { search });
  }

  /**
   * `GET tickets` (solo lectura: la app nunca crea, cambia ni borra tickets). Sin paginación: `limit`
   * (por defecto 100 en la API). Si se devuelven `limit` tickets puede haber más: el llamante lo trata
   * como lectura incompleta.
   */
  async tickets(f: {
    fecha_desde?: string;
    fecha_hasta?: string;
    estado?: 'Pagado' | 'Pendiente' | 'Cancelado';
    search?: string;
    limit?: number;
  } = {}): Promise<{ tickets: Ticket[]; posiblementeIncompleto: boolean }> {
    const limit = f.limit ?? 1000;
    const tickets = await this.get(TicketSchema.array(), 'tickets', { ...f, limit });
    return { tickets, posiblementeIncompleto: tickets.length >= limit };
  }
  /** Ticket con sus líneas (`items[]`: nombre, cantidad…; sin variante ni lote). */
  ticket(id: number): Promise<Ticket> {
    return this.get(TicketSchema, `tickets/${id}`);
  }

  /** Busca un ticket por su número exacto o busca en observaciones y devuelve el ticket con sus líneas. */
  async ticketPorNumero(numero: string): Promise<Ticket | null> {
    const { tickets } = await this.tickets({ search: numero, limit: 20 });
    const match = tickets.find((t) => t.numero?.toLowerCase() === numero.toLowerCase()) ?? tickets[0];
    if (!match) return null;
    return match.items && match.items.length > 0 ? match : this.ticket(match.id);
  }

  /**
   * `PUT inventory/variants/{id}/pricing`. Actualiza coste y precio de venta de una variante.
   */
  async actualizarPrecios(variantId: number, body: VariantPricingRequest): Promise<VariantPricingResponse> {
    const { json } = await this.http.request(
      this.url(`inventory/variants/${variantId}/pricing`),
      { method: 'PUT', headers: await this.headers(), body: JSON.stringify(body) },
      false,
    );
    return this.parse(VariantPricingResponseSchema, json, `inventory/variants/${variantId}/pricing`);
  }

  /**
   * `GET inventory/movements`. Consulta el historial de movimientos de inventario de la empresa.
   */
  async movements(
    f: {
      variant_id?: number;
      warehouse_id?: number;
      reason?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<StockMovement[]> {
    return this.paginado(StockMovementSchema, 'inventory/movements', f);
  }

  /**
   * `POST inventory/stock/adjustments`. Sin reintentos. Devuelve 409 si la variante tiene stock
   * ilimitado. Uso permitido: outbox de ENTRADAS y el spike de §12.3; nunca salidas.
   */
  async ajustarStock(
    body: AdjustmentRequest,
  ): Promise<{ result: AdjustmentResult; message: string | null; raw: unknown }> {
    const { json } = await this.http.request(
      this.url('inventory/stock/adjustments'),
      { method: 'POST', headers: await this.headers(), body: JSON.stringify(body) },
      false,
    );
    return {
      result: this.parse(AdjustmentResultSchema, json, 'stock/adjustments'),
      message: (json as { message?: string })?.message ?? null,
      raw: json,
    };
  }

  async transferir(body: TransferRequest): Promise<unknown> {
    const { json } = await this.http.request(
      this.url('inventory/stock/transfers'),
      { method: 'POST', headers: await this.headers(), body: JSON.stringify(body) },
      false,
    );
    return json;
  }
}

export { HttpError };
