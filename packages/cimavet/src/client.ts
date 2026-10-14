import type { z } from 'zod';
import { HttpClient, HttpError, type HttpOptions } from './http';
import {
  ItemSchema,
  MedicamentoSchema,
  NotaSchema,
  PresentacionSchema,
  RegistroCambioSchema,
  extraerLista,
  tamanioPagina,
  lowerKeys,
  type ItemApi,
  type MedicamentoApi,
  type NotaApi,
  type PresentacionApi,
  type RegistroCambioApi,
} from './schemas';

/** Resultado validado + JSON crudo (se guarda en `raw`). */
export interface ConCrudo<T> {
  data: T;
  raw: unknown;
}

export class CimavetValidationError extends Error {
  constructor(public readonly endpoint: string, public readonly issues: string[]) {
    super(`Respuesta de CIMAVet no válida en ${endpoint}: ${issues.join('; ')}`);
    this.name = 'CimavetValidationError';
  }
}

export interface CimavetClientOptions extends Partial<HttpOptions> {
  baseUrl: string;
  /** Máximo de páginas a recorrer en una búsqueda paginada (salvaguarda). */
  maxPaginas?: number;
}

/** Parámetros de `GET medicamentos` (SPEC §5.1.1). */
export type FiltrosMedicamentos = Partial<
  Record<
    | 'nombre'
    | 'practiv1'
    | 'idpractiv1'
    | 'cn'
    | 'nregistro'
    | 'especie'
    | 'idEspecie'
    | 'comerc'
    | 'sitadm'
    | 'IdForma'
    | 'idVia'
    | 'tipoMed'
    | 'dispensacion'
    | 'laboratorio'
    | 'atc',
    string | number
  >
>;

/** Maestras de `GET maestras?maestra=` (SPEC §5.1.1). */
export const MAESTRAS_API = { 1: 'principios activos', 2: 'formas', 3: 'vías', 4: 'laboratorios', 5: 'ATC', 6: 'excipientes', 7: 'especies', 8: 'medicamentos', 9: 'interacciones', 10: 'contraindicaciones', 11: 'indicaciones', 12: 'reacciones adversas' } as const;

/**
 * Cliente REST de CIMAVet (SPEC §5.1.1): rate limit (CIMAVET_RPS), reintentos con backoff y jitter
 * en 5xx y timeouts, timeout de 10 s, User-Agent identificable, paginación transparente con
 * `pagina`, validación tolerante y normalización de mayúsculas de los campos.
 */
export class CimavetClient {
  private readonly http: HttpClient;
  private readonly base: string;
  private readonly maxPaginas: number;

  constructor(opts: CimavetClientOptions) {
    this.base = opts.baseUrl.endsWith('/') ? opts.baseUrl : `${opts.baseUrl}/`;
    this.maxPaginas = opts.maxPaginas ?? 500;
    this.http = new HttpClient({
      rps: opts.rps ?? 3,
      timeoutMs: opts.timeoutMs ?? 10_000,
      maxRetries: opts.maxRetries ?? 3,
      baseDelayMs: opts.baseDelayMs ?? 500,
      userAgent: opts.userAgent ?? 'MundoMascotix-Recetas/0.1 (+verificacion de recetas veterinarias)',
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
      ...(opts.random ? { random: opts.random } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
  }

  private url(path: string, params: Record<string, string | number | Array<string | number> | undefined> = {}): string {
    const u = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(x));
    }
    return u.toString();
  }

  private parse<S extends z.ZodTypeAny>(schema: S, json: unknown, endpoint: string): z.output<S> {
    const r = schema.safeParse(lowerKeys(json));
    if (!r.success) throw new CimavetValidationError(endpoint, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    return r.data;
  }

  private async lista<S extends z.ZodTypeAny>(schema: S, url: string, endpoint: string): Promise<ConCrudo<z.output<S>>[] & { tamanio?: number }> {
    const { json } = await this.http.request(url);
    const items: ConCrudo<z.output<S>>[] & { tamanio?: number } = extraerLista(json).map((raw) => ({ data: this.parse(schema, raw, endpoint), raw }));
    const tam = tamanioPagina(json);
    if (tam !== null) items.tamanio = tam;
    return items;
  }

  /** Recorre todas las páginas (`pagina=1..n`) hasta una página incompleta, vacía o repetida. */
  private async paginado<S extends z.ZodTypeAny>(
    schema: S,
    path: string,
    params: Record<string, string | number | Array<string | number> | undefined>,
  ): Promise<ConCrudo<z.output<S>>[]> {
    const out: ConCrudo<z.output<S>>[] = [];
    let anterior = '';
    for (let pagina = 1; pagina <= this.maxPaginas; pagina++) {
      const items = await this.lista(schema, this.url(path, { ...params, pagina }), path);
      const firma = JSON.stringify(items.map((i) => i.raw));
      if (items.length === 0 || firma === anterior) break;
      anterior = firma;
      out.push(...items);
      if (items.tamanio !== undefined && items.length < items.tamanio) break;
    }
    return out;
  }

  medicamentos(filtros: FiltrosMedicamentos): Promise<ConCrudo<MedicamentoApi>[]> {
    return this.paginado(MedicamentoSchema, 'medicamentos', filtros);
  }

  /** `GET medicamento?nregistro=` o `?cn=`. null si no existe. */
  async medicamento(q: { nregistro: string } | { cn: string }): Promise<ConCrudo<MedicamentoApi> | null> {
    try {
      const { json } = await this.http.request(this.url('medicamento', q));
      if (json === null || json === '' || (Array.isArray(json) && json.length === 0)) return null;
      const raw = Array.isArray(json) ? json[0] : json;
      return { data: this.parse(MedicamentoSchema, raw, 'medicamento'), raw };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  presentaciones(q: { nregistro?: string; cn?: string; comerc?: 'S' }): Promise<ConCrudo<PresentacionApi>[]> {
    return this.paginado(PresentacionSchema, 'presentaciones', q);
  }

  async presentacion(cn: string): Promise<ConCrudo<PresentacionApi> | null> {
    try {
      const { json } = await this.http.request(this.url(`presentacion/${encodeURIComponent(cn)}`));
      const raw = Array.isArray(json) ? json[0] : json;
      if (!raw) return null;
      return { data: this.parse(PresentacionSchema, raw, 'presentacion'), raw };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  /** La API real responde 404 (HTML) cuando el medicamento no tiene notas: se trata como lista vacía. */
  async notas(nregistro: string): Promise<ConCrudo<NotaApi>[]> {
    try {
      return await this.lista(NotaSchema, this.url(`notas/${encodeURIComponent(nregistro)}`), 'notas');
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return [];
      throw e;
    }
  }

  maestras(maestra: keyof typeof MAESTRAS_API, filtros: { nombre?: string; id?: number; codigo?: string } = {}): Promise<ConCrudo<ItemApi>[]> {
    return this.paginado(ItemSchema, 'maestras', { maestra, ...filtros });
  }

  /** `registroCambios?fecha=dd/mm/yyyy[&nregistro=…]` (SPEC §5.1.2). */
  registroCambios(fecha: string, nregistros: string[] = []): Promise<ConCrudo<RegistroCambioApi>[]> {
    const [y, m, d] = fecha.split('-');
    return this.paginado(RegistroCambioSchema, 'registroCambios', {
      fecha: `${d}/${m}/${y}`,
      ...(nregistros.length ? { nregistro: nregistros } : {}),
    });
  }
}
