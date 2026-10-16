import type { CimavetRepository } from '@mmx/cimavet';
import type { ColumnCipher, Db } from '@mmx/db';
import type { Clock, PoliticaSeveridad, RecipeExtractor } from '@mmx/domain';
import { hoy } from '@mmx/domain';
import type { AppConfig, RulesBundle } from '@mmx/shared';
import type { LoadedRuleFile } from '@mmx/shared/node';
import type { BandejaSiweb, OutboxService, SalesMovementsSource, SiwebCatalogWriter, VariantResolver } from '@mmx/siweb';
import type { BlobStore } from '@mmx/reports';
import type { StockPort } from './puertos/stock';

/** Dependencias de la API (inyectadas: los tests usan PGlite, stock de demo y extractor falso). */
export interface AppDeps {
  config: AppConfig;
  db: Db;
  clock: Clock;
  rules: { bundle: RulesBundle; files: LoadedRuleFile[] };
  cimavet: CimavetRepository;
  /** Verificación en vivo contra CIMAVet (null si no hay cliente: se usa la caché). */
  verificarEnVivo: ((nregistro: string) => Promise<{ cacheDesde: Date | null }>) | null;
  stock: StockPort;
  /** Integración con Siweb360 (null si no hay token: modo demo). */
  siweb: {
    resolver: VariantResolver;
    bandeja: BandejaSiweb;
    catalogo: SiwebCatalogWriter;
    outbox: OutboxService;
    stockActual: (variantId: number) => Promise<unknown>;
  } | null;
  /**
   * Movimientos de venta (tickets del TPV) para conciliar las salidas: Siweb360, tickets simulados en la demo
   * (`DemoSalesMovementsSource`, nunca en producción) o sin configurar.
   */
  ventas: SalesMovementsSource;
  extractor: RecipeExtractor;
  blob: BlobStore;
  cipher: ColumnCipher;
  /** Teléfono que figura en el resguardo para el tutor. */
  telefonoFarmacia: string;
  nombreFarmacia: string;
}

export function politica(d: Pick<AppDeps, 'config' | 'rules'>): PoliticaSeveridad {
  return {
    rules: d.rules.bundle.recetaCampos,
    productValidityHardBlock: d.config.PRODUCT_VALIDITY_HARD_BLOCK,
    psychotropicAllowForce: d.config.PSYCHOTROPIC_ALLOW_FORCE,
  };
}

export const hoyDe = (d: Pick<AppDeps, 'clock'>) => hoy(d.clock);
export const ahoraDe = (d: Pick<AppDeps, 'clock'>) => new Date(d.clock.now().epochMilliseconds);
