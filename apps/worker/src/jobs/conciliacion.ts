import { conciliarDia, conciliarMovimientosDia } from '@mmx/siweb';
import { hoy } from '@mmx/domain';
import type { Contexto } from '../contexto';

/**
 * Conciliación ticket ↔ dispensación (job diario 21:00, SPEC §5.2.4) con los tickets Pagado del día
 * de Siweb360. Es el cierre del día: las salidas aún sin ticket y los tickets sin salida pasan a
 * discrepancia. Durante el día la API ya concilia al completar el registro y bajo demanda (mismo servicio,
 * `conciliarDia`). Los tickets no traen lote: se concilia por CN + unidades y se informa cuántas quedaron
 * con el lote sin verificar. Sin token o con SIWEB_SALES_SOURCE=off queda inactivo con un aviso. Al final
 * concilia todos los movimientos de medicamentos de Siweb360 desde ENTRY_CUTOVER_DATE (specs/011).
 */
export async function salesReconciliation(ctx: Contexto, args: Record<string, string>) {
  if (!ctx.ventas.configurado) {
    ctx.log('sales-reconciliation inactivo: fuente de ventas de Siweb360 no configurada');
    return { inactivo: true };
  }
  const dia = args.fecha ?? hoy(ctx.clock);
  const r = await conciliarDia(ctx.db, ctx.ventas, dia, { ahora: new Date(ctx.clock.now().epochMilliseconds), origen: 'sales-reconciliation', cierre: true });
  const { pendientes, fraccionadasSinConciliar, ...resto } = r;
  void pendientes;
  // Después, todos los movimientos de medicamentos de Siweb360 desde la fecha de corte (specs/011).
  const movimientos = ctx.siweb
    ? await conciliarMovimientosDia(ctx.db, ctx.siweb.client, {
        corte: ctx.config.ENTRY_CUTOVER_DATE,
        almacenId: await ctx.siweb.almacenId(),
        ahora: new Date(ctx.clock.now().epochMilliseconds),
      })
    : { inactivo: 'Siweb360 no configurado' };
  return { ...resto, ...(fraccionadasSinConciliar ? { fraccionadasSinConciliar } : {}), movimientos };
}
