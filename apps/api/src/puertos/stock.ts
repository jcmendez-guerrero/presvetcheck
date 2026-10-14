import { readFileSync } from 'node:fs';
import type { LoteStock } from '@mmx/domain';
import { incidencia, type Incidencia, type PoliticaSeveridad } from '@mmx/domain';
import type { StockService, VariantResolver } from '@mmx/siweb';

/** Stock de un CN en el almacén Farmacia (SPEC §5.2.3). */
export interface StockCnResultado {
  /** SIN_MAPEO: el CN no tiene variante en Siweb360 (hay que mapearlo o darlo de alta). */
  estado: 'OK' | 'NO_DISPONIBLE' | 'SIN_MAPEO';
  lotes: LoteStock[];
  avisos: Incidencia[];
}

export interface StockPort {
  readonly tipo: 'siweb' | 'demo';
  lotes(cn: string, medicamento: { nombre: string; labtitular: string | null } | null): Promise<StockCnResultado>;
}

/** Adaptador real: resolución CN → variante(s) + lectura de lotes. */
export class SiwebStockPort implements StockPort {
  readonly tipo = 'siweb' as const;
  constructor(
    private readonly resolver: VariantResolver,
    private readonly stock: StockService,
    private readonly politica: () => PoliticaSeveridad,
  ) {}

  async lotes(cn: string, medicamento: { nombre: string; labtitular: string | null } | null): Promise<StockCnResultado> {
    let r;
    try {
      r = await this.resolver.resolver(cn, medicamento);
    } catch {
      return { estado: 'NO_DISPONIBLE', lotes: [], avisos: [] };
    }
    if (r.estado !== 'MAPEADO') return { estado: 'SIN_MAPEO', lotes: [], avisos: [] };
    const s = await this.stock.lotesDeVariantes(cn, r.variantes.map((v) => v.variantId));
    const avisos = s.ilimitadas.map((v) => incidencia('STOCK_ILIMITADO_CONFIGURACION', this.politica(), { params: { sku: v.sku ?? String(v.variantId) } }));
    return { estado: s.estado, lotes: s.lotes, avisos };
  }
}

/**
 * Stock SINTÉTICO para desarrollo y demos sin token de Siweb360 (fixtures/siweb/demo-stock.json).
 * Imposible en producción (lo impide la creación de dependencias).
 */
export class DemoStockPort implements StockPort {
  readonly tipo = 'demo' as const;
  private readonly datos: Record<string, Omit<LoteStock, 'variantId'>[]>;
  constructor(path: string) {
    this.datos = JSON.parse(readFileSync(path, 'utf8'));
  }
  async lotes(cn: string): Promise<StockCnResultado> {
    const l = this.datos[cn];
    if (!Array.isArray(l)) return { estado: 'OK', lotes: [], avisos: [] };
    return { estado: 'OK', lotes: l.map((x, i) => ({ ...x, variantId: 900000 + i })), avisos: [] };
  }
}
