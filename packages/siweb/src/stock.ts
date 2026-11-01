import type { LoteStock } from '@mmx/domain';
import type { SiwebClient } from './client';
import { leerNivel } from './schemas';

/** Resultado de la lectura de stock de un CN (todas sus variantes en el almacén Farmacia). */
export interface StockCn {
  estado: 'OK' | 'NO_DISPONIBLE';
  lotes: LoteStock[];
  /** Variantes con stock ilimitado: no participan en FEFO (aviso de configuración). */
  ilimitadas: { variantId: number; sku: string | null }[];
  /** Variantes cuyo desglose por lote no se pudo interpretar. */
  ilegibles: number[];
  leidoAt: number;
}

/**
 * Lectura de stock en vivo (SPEC §5.2.3): nunca se cachea más de 60 s. Si Siweb360 no responde o
 * el desglose no es interpretable, el estado es NO_DISPONIBLE y el motor devuelve PENDIENTE_STOCK.
 */
export class StockService {
  private readonly cache = new Map<string, StockCn>();

  constructor(
    private readonly client: SiwebClient,
    private readonly almacenId: () => Promise<number>,
    private readonly opts: {
      ttlMs?: number;
      now?: () => number;
      log?: (m: string, d?: Record<string, unknown>) => void;
    } = {},
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  invalidar(clave?: string) {
    if (clave) this.cache.delete(clave);
    else this.cache.clear();
  }

  async lotesDeVariantes(clave: string, variantIds: number[]): Promise<StockCn> {
    const ttl = Math.min(this.opts.ttlMs ?? 60_000, 60_000);
    const hit = this.cache.get(clave);
    if (hit && this.now() - hit.leidoAt < ttl) return hit;
    const almacen = await this.almacenId();
    const out: StockCn = { estado: 'OK', lotes: [], ilimitadas: [], ilegibles: [], leidoAt: this.now() };
    try {
      for (const id of variantIds) {
        const [v, lots] = await Promise.all([this.client.variant(id), this.client.lots(id)]);
        if (v.is_infinite_stock) {
          out.ilimitadas.push({ variantId: id, sku: v.sku ?? null });
          continue;
        }
        // `stock_levels[]` trae lote, caducidad y disponible; `/lots` aporta la fecha de creación (desempate FEFO).
        const porLote = new Map(lots.map((l) => [l.lot_code, l]));
        for (const nivel of v.stock_levels ?? []) {
          if (nivel.warehouse_id !== almacen) continue;
          const { lote, disponible, caducidad } = leerNivel(nivel);
          if (lote === null || disponible === null) {
            out.ilegibles.push(id);
            continue;
          }
          if (disponible <= 0) continue;
          const l = porLote.get(lote);
          out.lotes.push({
            lote,
            caducidad: caducidad ?? (l?.expiry_date ? l.expiry_date.slice(0, 10) : null),
            disponible,
            creadoAt: l?.created_at ?? null,
            variantId: id,
            ubicacion: nivel.location_id !== null ? String(nivel.location_id) : null,
          });
        }
      }
    } catch (e) {
      this.opts.log?.('Siweb360 no responde al leer stock', { clave, error: (e as Error).message });
      return { ...out, estado: 'NO_DISPONIBLE' };
    }
    // Si alguna variante no se pudo interpretar, no se confirma stock (conservador).
    if (out.ilegibles.length) out.estado = 'NO_DISPONIBLE';
    this.cache.set(clave, out);
    return out;
  }
}
