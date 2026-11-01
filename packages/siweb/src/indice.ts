import { extraerCn } from '@mmx/domain';
import type { SiwebClient } from './client';
import type { Variant } from './schemas';

/**
 * Índice en memoria del catálogo de Siweb360 por código nacional (CN extraído del SKU o del nombre).
 *
 * Una evaluación comprueba el stock de todas las presentaciones equivalentes (decenas con algunos principios
 * activos). Buscarlas una a una en Siweb360 tardaba minutos; con el índice, las que no están en el catálogo se
 * descartan sin llamadas y solo se lee el stock (en vivo, SPEC §5.2.3) de las que existen.
 *
 * El índice contiene solo la ficha de las variantes (SKU y nombre), nunca stock. Se recarga cada `ttlMs`:
 * mientras se recarga se sigue usando la versión anterior. Si no se ha podido cargar nunca, `porCn` devuelve
 * `null` y quien lo usa vuelve a la búsqueda directa en Siweb360.
 */
export class IndiceCatalogo {
  private porCnMap: Map<string, Variant[]> | null = null;
  private cargadoAt = 0;
  private cargando: Promise<void> | null = null;

  constructor(
    private readonly client: Pick<SiwebClient, 'variants'>,
    private readonly patron: string,
    private readonly opts: {
      ttlMs?: number;
      now?: () => number;
      log?: (m: string, d?: Record<string, unknown>) => void;
    } = {},
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private get ttl() {
    return this.opts.ttlMs ?? 15 * 60_000;
  }

  /** Lanza la carga sin esperarla (al arrancar la API). */
  precargar(): void {
    void this.cargar().catch(() => {});
  }

  private cargar(): Promise<void> {
    this.cargando ??= (async () => {
      const inicio = this.now();
      try {
        const variantes = await this.client.variants({});
        const mapa = new Map<string, Variant[]>();
        for (const v of variantes) {
          const cns = new Set(
            [
              extraerCn(v.sku ?? null, this.patron, true),
              extraerCn(v.name ?? null, this.patron, false),
              extraerCn(v.product_name ?? null, this.patron, false),
            ].filter((c): c is string => c !== null),
          );
          for (const cn of cns) mapa.set(cn, [...(mapa.get(cn) ?? []), v]);
        }
        this.porCnMap = mapa;
        this.cargadoAt = this.now();
        this.opts.log?.('Catálogo de Siweb360 indexado', {
          variantes: variantes.length,
          conCn: mapa.size,
          ms: this.now() - inicio,
        });
      } catch (e) {
        this.opts.log?.('No se pudo indexar el catálogo de Siweb360', { error: (e as Error).message });
        throw e;
      } finally {
        this.cargando = null;
      }
    })();
    return this.cargando;
  }

  /**
   * Variantes del catálogo con ese CN. `null` si el índice no está disponible (nunca se pudo cargar).
   * Si está caducado, se devuelve el actual y se recarga en segundo plano.
   */
  async porCn(cn: string): Promise<Variant[] | null> {
    if (!this.porCnMap) {
      try {
        await this.cargar();
      } catch {
        return null;
      }
    } else if (this.now() - this.cargadoAt > this.ttl) {
      this.precargar();
    }
    return this.porCnMap?.get(cn) ?? [];
  }

  /** Tras crear o renombrar productos: la siguiente consulta recarga el catálogo. */
  invalidar(): void {
    this.cargadoAt = 0;
  }
}
