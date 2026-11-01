import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { conciliacion, discrepancia, dispensacion, siwebVariantMap, ticketDemo, type Db } from '@mmx/db';
import { conciliar, type Discrepancia, type MovimientoVenta } from '@mmx/domain';
import { rangoMadrid } from '@mmx/shared';
import type { SalesMovementsSource } from './ventas';

export interface ResultadoConciliacionDia {
  conciliadas: number;
  loteSinVerificar: number;
  discrepancias: number;
  /** Salidas del día que siguen sin ticket (se reintentan; al cierre se registran como discrepancia). */
  pendientes: number;
  fraccionadasSinConciliar: number;
}

/**
 * Conciliación ticket ↔ salida de un día (SPEC §5.2.4), compartida por la API (al completar el registro y
 * bajo demanda) y por el job diario. Solo trata salidas y líneas de ticket aún no conciliadas, así que se
 * puede repetir sin duplicar. Durante el día (`cierre=false`) una salida sin ticket o un ticket sin salida
 * NO es discrepancia todavía (puede cobrarse más tarde); al cierre (job diario) sí. Las discrepancias no se
 * duplican entre ejecuciones.
 */
export async function conciliarDia(
  db: Db,
  ventas: SalesMovementsSource,
  dia: string,
  o: { ahora: Date; origen: string; cierre: boolean },
): Promise<ResultadoConciliacionDia> {
  const [ini, fin] = rangoMadrid(dia, dia);
  const disp = await db
    .select()
    .from(dispensacion)
    .where(
      and(
        gte(dispensacion.fechaVenta, ini),
        lt(dispensacion.fechaVenta, fin),
        isNull(dispensacion.anulaDispensacionId),
        sql`not exists (select 1 from dispensacion a where a.anula_dispensacion_id = ${dispensacion.id})`,
        sql`not exists (select 1 from conciliacion c where c.dispensacion_id = ${dispensacion.id})`,
      ),
    );
  const mapa = new Map((await db.select().from(siwebVariantMap)).map((m) => [m.variantId, m.cn]));
  const usados = new Set(
    (await db.select({ m: conciliacion.movimientoId }).from(conciliacion)).map((x) => x.m),
  );
  const movs: MovimientoVenta[] = (await ventas.movimientos(dia, dia))
    .filter((m) => !usados.has(m.id))
    .map((m) => ({ ...m, cn: m.cn ?? (m.variantId !== null ? mapa.get(m.variantId) : undefined) ?? null }));
  // Las fracciones no se venden como envase en el TPV: no se concilian automáticamente (se informan).
  const fraccionadas = disp.filter((d) => d.unidadesForma !== null);
  const r = conciliar(
    disp
      .filter((d) => d.unidadesForma === null)
      .map((d) => ({ id: d.id, cn: d.cn, lote: d.lote, unidades: d.unidades, fecha: dia })),
    movs,
  );
  const ticketDe = new Map(movs.map((m) => [m.id, m.ticket ?? null]));
  for (const c of r.conciliadas) {
    await db
      .insert(conciliacion)
      .values({
        dispensacionId: c.dispensacionId,
        movimientoId: c.movimientoId,
        ticket: ticketDe.get(c.movimientoId) ?? null,
        loteVerificado: c.loteVerificado,
        origen: o.origen,
        at: o.ahora,
      })
      .onConflictDoNothing();
  }
  const sinPareja = (x: Discrepancia) =>
    x.tipo === 'DISPENSACION_SIN_TICKET' || x.tipo === 'TICKET_SIN_DISPENSACION';
  const aRegistrar = r.discrepancias.filter((x) => o.cierre || !sinPareja(x));
  let nuevas = 0;
  for (const x of aRegistrar) {
    // Una discrepancia por (tipo, salida, línea de ticket), aunque la conciliación se repita.
    const [ya] = await db
      .select({ id: discrepancia.id })
      .from(discrepancia)
      .where(
        and(
          eq(discrepancia.tipo, x.tipo),
          sql`coalesce(${discrepancia.datos}->>'dispensacionId', '') = ${x.dispensacionId ?? ''}`,
          sql`coalesce(${discrepancia.datos}->>'movimientoId', '') = ${x.movimientoId ?? ''}`,
        ),
      )
      .limit(1);
    if (ya) continue;
    await db
      .insert(discrepancia)
      .values({ tipo: x.tipo, origen: o.origen, fecha: o.ahora, datos: x as never });
    nuevas++;
  }
  return {
    conciliadas: r.conciliadas.length,
    loteSinVerificar: r.conciliadas.filter((c) => !c.loteVerificado).length,
    discrepancias: nuevas,
    pendientes: r.discrepancias.filter((x) => x.tipo === 'DISPENSACION_SIN_TICKET').length,
    fraccionadasSinConciliar: fraccionadas.length,
  };
}

/** Estado de conciliación de unas salidas: conciliada, con discrepancia abierta o pendiente. */
export async function estadoConciliacion(
  db: Db,
  ids: string[],
): Promise<Map<string, 'conciliada' | 'discrepancia' | 'pendiente'>> {
  const out = new Map<string, 'conciliada' | 'discrepancia' | 'pendiente'>(ids.map((i) => [i, 'pendiente']));
  if (!ids.length) return out;
  for (const c of await db
    .select({ id: conciliacion.dispensacionId })
    .from(conciliacion)
    .where(inArray(conciliacion.dispensacionId, ids)))
    out.set(c.id, 'conciliada');
  const abiertas = await db
    .select({ datos: discrepancia.datos })
    .from(discrepancia)
    .where(
      and(
        eq(discrepancia.estado, 'abierta'),
        sql`${discrepancia.datos}->>'dispensacionId' in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`,
      ),
    );
  for (const d of abiertas) {
    const id = (d.datos as { dispensacionId?: string }).dispensacionId;
    if (id && out.get(id) === 'pendiente') out.set(id, 'discrepancia');
  }
  return out;
}

/**
 * Tickets SIMULADOS para la demo (tabla `ticket_demo`): misma forma que los de Siweb360 (sin lote). Solo
 * se crea con el stock de demostración, que es imposible en producción.
 */
export class DemoSalesMovementsSource implements SalesMovementsSource {
  readonly configurado = true;
  readonly demo = true;
  constructor(private readonly db: Db) {}

  async movimientos(desde: string, hasta: string): Promise<MovimientoVenta[]> {
    const [ini, fin] = rangoMadrid(desde, hasta);
    const filas = await this.db
      .select()
      .from(ticketDemo)
      .where(and(gte(ticketDemo.fecha, ini), lt(ticketDemo.fecha, fin)));
    return filas.map((t) => ({
      id: `demo:${t.id}`,
      variantId: null,
      cn: t.cn,
      lote: null,
      unidades: t.unidades,
      fecha: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(t.fecha),
      ticket: t.numero,
    }));
  }

  async cobrar(cn: string, unidades: number, ahora: Date, usuario: string): Promise<{ numero: string }> {
    const numero = `DEMO-${ahora.getTime().toString(36).toUpperCase()}`;
    await this.db.insert(ticketDemo).values({ numero, cn, unidades, fecha: ahora, creadoPor: usuario });
    return { numero };
  }
}
