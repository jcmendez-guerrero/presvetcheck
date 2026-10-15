import { and, gte, isNull, lt, sql } from 'drizzle-orm';
import { discrepancia, dispensacion, siwebVariantMap } from '@mmx/db';
import { conciliar, hoy } from '@mmx/domain';
import { rangoMadrid } from '@mmx/reports';
import type { Contexto } from '../contexto';

/**
 * Conciliación ticket ↔ dispensación (job diario 21:00, SPEC §5.2.4) con los tickets Pagado del día
 * de Siweb360. Los tickets no traen lote: se concilia por CN + unidades y se informa cuántas quedaron
 * con el lote sin verificar. Sin token o con SIWEB_SALES_SOURCE=off queda inactivo con un aviso.
 */
export async function salesReconciliation(ctx: Contexto, args: Record<string, string>) {
  if (!ctx.ventas.configurado) {
    ctx.log('sales-reconciliation inactivo: fuente de ventas de Siweb360 no configurada');
    return { inactivo: true };
  }
  const dia = args.fecha ?? hoy(ctx.clock);
  const [ini, fin] = rangoMadrid(dia, dia);
  const disp = await ctx.db
    .select()
    .from(dispensacion)
    .where(and(gte(dispensacion.fechaVenta, ini), lt(dispensacion.fechaVenta, fin), isNull(dispensacion.anulaDispensacionId), sql`not exists (select 1 from dispensacion a where a.anula_dispensacion_id = ${dispensacion.id})`));
  const mapa = new Map((await ctx.db.select().from(siwebVariantMap)).map((m) => [m.variantId, m.cn]));
  const movs = (await ctx.ventas.movimientos(dia, dia)).map((m) => ({ ...m, cn: m.cn ?? (m.variantId !== null ? mapa.get(m.variantId) : undefined) ?? null }));
  // Las fracciones no se venden como envase en el TPV: no se concilian automáticamente (se informan).
  const fraccionadas = disp.filter((d) => d.unidadesForma !== null);
  const r = conciliar(
    disp.filter((d) => d.unidadesForma === null).map((d) => ({ id: d.id, cn: d.cn, lote: d.lote, unidades: d.unidades, fecha: dia })),
    movs,
  );
  for (const x of r.discrepancias) {
    await ctx.db.insert(discrepancia).values({ tipo: x.tipo, origen: 'sales-reconciliation', fecha: new Date(ctx.clock.now().epochMilliseconds), datos: x as never });
  }
  return {
    conciliadas: r.conciliadas.length,
    loteSinVerificar: r.conciliadas.filter((c) => !c.loteVerificado).length,
    discrepancias: r.discrepancias.length,
    ...(fraccionadas.length ? { fraccionadasSinConciliar: fraccionadas.length } : {}),
  };
}
