import { and, eq, isNotNull } from 'drizzle-orm';
import { siwebVariantMap, type Db } from '@mmx/db';
import {
  normalizarCn,
  nombreCumpleConvencion,
  skuCumpleConvencion,
  varianteCoincideCn,
  extraerCn,
} from '@mmx/domain';
import { DomainError, normalizeText } from '@mmx/shared';
import type { SiwebClient } from './client';
import type { IndiceCatalogo } from './indice';
import type { Variant } from './schemas';

export type ResultadoResolucion =
  | { estado: 'MAPEADO'; variantes: { variantId: number; sku: string | null; metodo: string }[] }
  | { estado: 'ELEGIR'; candidatos: Variant[]; motivo: 'VARIAS_POR_CN' }
  | { estado: 'NO_ENCONTRADO'; candidatos: (Variant & { similitud: number })[] };

/** Similitud simple por términos (para ordenar candidatos por nombre). */
export function similitudNombre(a: string, b: string): number {
  const ta = new Set(
    normalizeText(a)
      .split(' ')
      .filter((w) => w.length > 2),
  );
  const tb = new Set(
    normalizeText(b)
      .split(' ')
      .filter((w) => w.length > 2),
  );
  if (!ta.size || !tb.size) return 0;
  let c = 0;
  for (const w of ta) if (tb.has(w)) c++;
  return c / Math.max(ta.size, tb.size);
}

/**
 * Resolución CN → variante(s) de Siweb360 (SPEC §5.2.2):
 *  1. mapeo verificado en `siweb_variant_map`;
 *  2. índice del catálogo (o búsqueda `CN{cn}` y `{cn}`) filtrando por SKU o nombre (patrón o «CN 584187.8»): una → mapeo automático; varias → elegir;
 *  3. sin coincidencia: hasta 5 candidatos por nombre del medicamento y laboratorio.
 */
export class VariantResolver {
  constructor(
    private readonly db: Db,
    private readonly client: SiwebClient,
    private readonly patron: string,
    private readonly indice: IndiceCatalogo | null = null,
  ) {}

  async mapeos(cn: string) {
    return this.db
      .select()
      .from(siwebVariantMap)
      .where(eq(siwebVariantMap.cn, normalizarCn(cn)));
  }

  async resolver(
    cn: string,
    medicamento: { nombre: string; labtitular: string | null } | null,
  ): Promise<ResultadoResolucion> {
    const c = normalizarCn(cn);
    const existentes = await this.db
      .select()
      .from(siwebVariantMap)
      .where(and(eq(siwebVariantMap.cn, c), isNotNull(siwebVariantMap.verificadoAt)));
    if (existentes.length) {
      return {
        estado: 'MAPEADO',
        variantes: existentes.map((m) => ({ variantId: m.variantId, sku: m.sku, metodo: m.metodo })),
      };
    }
    // Primero el índice del catálogo (sin llamadas). Si no está disponible, o no encuentra el CN del medicamento
    // prescrito (puede ser un producto recién creado), búsqueda directa: `CN{cn}` (convención) y el CN solo, para
    // encontrar también nombres como «… CN 584187.8». Los equivalentes (sin `medicamento`) solo usan el índice.
    let porCn = (await this.indice?.porCn(c)) ?? null;
    if (porCn === null || (!porCn.length && medicamento)) {
      const vistas = new Map<number, Variant>();
      for (const search of [`CN${c}`, c])
        for (const v of await this.client.variants({ search })) vistas.set(v.id, v);
      porCn = [...vistas.values()];
    }
    porCn = porCn.filter((v) =>
      varianteCoincideCn(
        { sku: v.sku ?? null, name: v.name ?? null, productName: v.product_name ?? null },
        c,
        this.patron,
      ),
    );
    if (porCn.length === 1) {
      const v = porCn[0]!;
      const metodo = extraerCn(v.sku ?? null, this.patron, true) === c ? 'auto_sku' : 'auto_nombre';
      await this.guardar(c, v, metodo, 'sistema');
      return { estado: 'MAPEADO', variantes: [{ variantId: v.id, sku: v.sku ?? null, metodo }] };
    }
    if (porCn.length > 1) return { estado: 'ELEGIR', candidatos: porCn, motivo: 'VARIAS_POR_CN' };
    if (!medicamento) return { estado: 'NO_ENCONTRADO', candidatos: [] };
    const termino = medicamento.nombre.split(/\s+/).slice(0, 2).join(' ');
    const porNombre = await this.client.variants({ search: termino });
    const objetivo = `${medicamento.nombre} ${medicamento.labtitular ?? ''}`;
    const candidatos = porNombre
      .map((v) => ({
        ...v,
        similitud: similitudNombre(objetivo, `${v.product_name ?? ''} ${v.name ?? ''} ${v.sku ?? ''}`),
      }))
      .filter((v) => v.similitud > 0)
      .sort((a, b) => b.similitud - a.similitud)
      .slice(0, 5);
    return { estado: 'NO_ENCONTRADO', candidatos };
  }

  /** Guarda un mapeo (automático o manual). Un CN puede tener varias variantes. */
  async guardar(
    cn: string,
    v: Pick<Variant, 'id' | 'product_id' | 'sku'>,
    metodo: 'auto_sku' | 'auto_nombre' | 'manual',
    actor: string,
  ) {
    await this.db
      .insert(siwebVariantMap)
      .values({
        cn: normalizarCn(cn),
        variantId: v.id,
        productId: v.product_id ?? null,
        sku: v.sku ?? null,
        metodo,
        verificadoPor: actor,
        verificadoAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [siwebVariantMap.cn, siwebVariantMap.variantId],
        set: { sku: v.sku ?? null, metodo, verificadoPor: actor, verificadoAt: new Date() },
      });
  }

  /** Mapeo manual por SKU: se valida que existe en Siweb360 con ese valor exacto. */
  async mapearPorSku(
    cn: string,
    sku: string,
    actor: string,
  ): Promise<{ variante: Variant; cumpleConvencion: boolean }> {
    const v = (await this.client.variants({ search: sku })).find(
      (x) => (x.sku ?? '').toUpperCase() === sku.trim().toUpperCase(),
    );
    if (!v)
      throw new DomainError(
        'NO_ENCONTRADO',
        `No existe ningún producto con el SKU «${sku.trim()}» en Siweb360. Revisa que esté bien escrito.`,
      );
    await this.guardar(cn, v, 'manual', actor);
    return { variante: v, cumpleConvencion: this.cumpleConvencion(cn, v) };
  }

  async mapearVariante(
    cn: string,
    variantId: number,
    actor: string,
  ): Promise<{ variante: Variant; cumpleConvencion: boolean }> {
    const v = await this.client.variant(variantId);
    await this.guardar(cn, v, 'manual', actor);
    return { variante: v, cumpleConvencion: this.cumpleConvencion(cn, v) };
  }

  /** ¿SKU y nombre siguen la convención? Si no, la UI pregunta si actualizar (tarea "renombrar"). */
  cumpleConvencion(cn: string, v: Pick<Variant, 'sku' | 'name' | 'product_name'>): boolean {
    return (
      skuCumpleConvencion(v.sku ?? '', cn, this.patron) &&
      (nombreCumpleConvencion(v.product_name ?? '', cn, this.patron) ||
        nombreCumpleConvencion(v.name ?? '', cn, this.patron))
    );
  }
}
