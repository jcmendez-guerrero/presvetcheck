import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { appendAudit, conciliacion, dispensacion } from '@mmx/db';
import { hoy } from '@mmx/domain';
import { DemoSalesMovementsSource, conciliarDia, estadoConciliacion } from '@mmx/siweb';
import { DomainError, type AsociarTicketBody } from '@mmx/shared';
import { ahoraDe, type AppDeps } from '../deps';
import type { ContextoPeticion } from './recetas';

const dia = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(d);

/**
 * Conciliación de las salidas con los tickets del TPV desde la API (SPEC §5.2.4): al completar el registro de
 * una receta, bajo demanda («Conciliar ahora») y, en la demo, con tickets simulados. El cierre del día (salidas
 * sin ticket → discrepancia) lo hace el job diario o «Cerrar el día» de forma explícita.
 */
export class ConciliacionService {
  constructor(private readonly d: AppDeps) {}

  get configurado() {
    return this.d.ventas.configurado;
  }

  async conciliarDias(dias: string[], c: ContextoPeticion, o: { origen: string; cierre?: boolean }) {
    if (!this.d.ventas.configurado) return { configurado: false as const };
    const ahora = ahoraDe(this.d);
    const total = {
      conciliadas: 0,
      loteSinVerificar: 0,
      discrepancias: 0,
      pendientes: 0,
      fraccionadasSinConciliar: 0,
    };
    for (const x of [...new Set(dias)]) {
      const r = await conciliarDia(this.d.db, this.d.ventas, x, {
        ahora,
        origen: o.origen,
        cierre: o.cierre ?? false,
      });
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += r[k];
    }
    await appendAudit(this.d.db, {
      actor: c.usuario.id,
      accion: 'conciliar',
      entidad: 'conciliacion',
      entidadId: null,
      despues: { dias, origen: o.origen, ...total },
      ip: c.ip,
      userAgent: c.userAgent,
    });
    return { configurado: true as const, ...total };
  }

  /** Concilia los días en que se dispensó la receta y devuelve el estado de cada salida. */
  async conciliarReceta(recetaId: string, c: ContextoPeticion) {
    const salidas = await this.salidasDeReceta(recetaId);
    const r = await this.conciliarDias(
      salidas.map((s) => dia(s.fechaVenta)),
      c,
      { origen: 'registro' },
    );
    return { ...r, salidas: await this.estado(salidas.map((s) => s.id)) };
  }

  private salidasDeReceta(recetaId: string) {
    return this.d.db
      .select({ id: dispensacion.id, fechaVenta: dispensacion.fechaVenta })
      .from(dispensacion)
      .where(and(eq(dispensacion.recetaId, recetaId), isNull(dispensacion.anulaDispensacionId)));
  }

  async estadoReceta(recetaId: string) {
    return this.estado((await this.salidasDeReceta(recetaId)).map((s) => s.id));
  }

  async estado(ids: string[]) {
    const m = await estadoConciliacion(this.d.db, ids);
    return ids.map((id) => ({ dispensacionId: id, estado: m.get(id) ?? 'pendiente' }));
  }

  /** Salidas de los últimos 30 días aún sin conciliar ni discrepancia abierta (para Pendientes). */
  async pendientes() {
    const desde = new Date(ahoraDe(this.d).getTime() - 30 * 86_400_000);
    const filas = await this.d.db
      .select({
        id: dispensacion.id,
        cn: dispensacion.cn,
        nombre: dispensacion.nombreFarmaco,
        lote: dispensacion.lote,
        unidades: dispensacion.unidades,
        unidadesForma: dispensacion.unidadesForma,
        fecha: dispensacion.fechaVenta,
        recetaId: dispensacion.recetaId,
      })
      .from(dispensacion)
      .where(
        and(
          gte(dispensacion.fechaVenta, desde),
          isNull(dispensacion.anulaDispensacionId),
          sql`not exists (select 1 from dispensacion a where a.anula_dispensacion_id = ${dispensacion.id})`,
          sql`not exists (select 1 from conciliacion c where c.dispensacion_id = ${dispensacion.id})`,
        ),
      )
      .orderBy(desc(dispensacion.fechaVenta))
      .limit(200);
    const est = await estadoConciliacion(
      this.d.db,
      filas.map((f) => f.id),
    );
    return {
      configurado: this.d.ventas.configurado,
      salidas: filas
        .filter((f) => est.get(f.id) === 'pendiente')
        .map(({ unidadesForma, ...f }) => ({
          ...f,
          fecha: f.fecha.toISOString(),
          fraccion: unidadesForma !== null,
        })),
    };
  }

  /** Demo: registra un cobro simulado en el TPV (ticket sin lote, como los de Siweb360). */
  async cobrarDemo(cn: string, unidades: number, c: ContextoPeticion) {
    const v = this.d.ventas;
    if (!(v instanceof DemoSalesMovementsSource) || this.d.config.NODE_ENV === 'production')
      throw new DomainError('NO_ENCONTRADO');
    return v.cobrar(cn, unidades, ahoraDe(this.d), c.usuario.id);
  }

  hoy() {
    return hoy(this.d.clock);
  }

  /** Busca tickets del TPV (en Siweb360 o tickets simulados de demo). */
  async buscarTickets(search: string, estado?: 'Pagado' | 'Pendiente' | 'Cancelado') {
    if (this.d.ventas.buscarTickets) {
      const tickets = await this.d.ventas.buscarTickets(search);
      const filtrados = estado ? tickets.filter((t) => t.estado === estado) : tickets;
      return { tickets: filtrados };
    }
    return { tickets: [] };
  }

  /** Asocia manualmente una dispensación pendiente a una línea de un ticket del TPV. */
  async asociarManual(body: AsociarTicketBody, c: ContextoPeticion) {
    const [disp] = await this.d.db
      .select()
      .from(dispensacion)
      .where(eq(dispensacion.id, body.dispensacionId))
      .limit(1);
    if (!disp) throw new DomainError('NO_ENCONTRADO');
    if (disp.anulaDispensacionId) throw new DomainError('TRANSICION_NO_PERMITIDA');

    const [ya] = await this.d.db
      .select({ id: conciliacion.id })
      .from(conciliacion)
      .where(eq(conciliacion.dispensacionId, body.dispensacionId))
      .limit(1);
    if (ya) throw new DomainError('CONFLICTO');

    const ahora = ahoraDe(this.d);
    const movimientoId = `ticket:${body.ticketId}:${body.lineaId ?? 0}`;
    await this.d.db.insert(conciliacion).values({
      dispensacionId: body.dispensacionId,
      movimientoId,
      ticket: body.ticketNumero,
      loteVerificado: false,
      origen: 'manual',
      at: ahora,
    });

    await appendAudit(this.d.db, {
      actor: c.usuario.id,
      accion: 'conciliar',
      entidad: 'conciliacion',
      entidadId: body.dispensacionId,
      despues: {
        dispensacionId: body.dispensacionId,
        ticketId: body.ticketId,
        ticketNumero: body.ticketNumero,
        lineaId: body.lineaId,
        origen: 'manual',
        nota: body.nota ?? null,
      },
      ip: c.ip,
      userAgent: c.userAgent,
    });

    return {
      ok: true as const,
      conciliacion: {
        dispensacionId: body.dispensacionId,
        ticket: body.ticketNumero,
        movimientoId,
        loteVerificado: false,
        origen: 'manual' as const,
      },
    };
  }
}
