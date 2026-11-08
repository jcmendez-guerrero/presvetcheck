import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { appendAudit, conciliacion, dispensacion, dispensacionVigente, receta, ticketReceta } from '@mmx/db';
import {
  conciliarTicketMultiReceta,
  hoy,
  validarDesvinculacionTicket,
  validarVinculacionTicket,
  type DispensacionMultiRx,
  type LineaTicketItem,
} from '@mmx/domain';
import { DemoSalesMovementsSource, conciliarDia, estadoConciliacion } from '@mmx/siweb';
import {
  DomainError,
  type AsociarTicketBody,
  type ConfirmarTicketResponse,
  type DesvincularTicketBody,
  type DetalleTicketMultiReceta,
  type VincularTicketBody,
} from '@mmx/shared';
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
      .where(and(eq(dispensacion.recetaId, recetaId), dispensacionVigente));
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
          dispensacionVigente,
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

  /** Asocia una receta a un ticket (specs/004-multi-rx-ticket-training-mode, D-11). */
  async vincularTicketReceta(body: VincularTicketBody, c: ContextoPeticion) {
    const existentes = await this.d.db
      .select({
        ticketId: ticketReceta.ticketId,
        ticketNumero: ticketReceta.ticketNumero,
        recetaId: ticketReceta.recetaId,
        estado: ticketReceta.estado,
      })
      .from(ticketReceta);

    const val = validarVinculacionTicket({
      ticketId: body.ticketId,
      recetaId: body.recetaId,
      existentes: existentes as {
        ticketId: string;
        ticketNumero: string;
        recetaId: string;
        estado: 'vinculado' | 'confirmado';
      }[],
    });

    if (!val.valido) {
      throw new DomainError(val.error!);
    }

    const ahora = ahoraDe(this.d);
    await this.d.db.insert(ticketReceta).values({
      ticketId: body.ticketId,
      ticketNumero: body.ticketNumero,
      recetaId: body.recetaId,
      fechaVinculacion: ahora,
      usuarioId: c.usuario.id,
      estado: 'vinculado',
    });

    const vinculadas = await this.d.db
      .select({ recetaId: ticketReceta.recetaId })
      .from(ticketReceta)
      .where(eq(ticketReceta.ticketId, body.ticketId));

    await appendAudit(this.d.db, {
      actor: c.usuario.id,
      accion: 'ticket_vincular_receta',
      entidad: 'ticket_receta',
      entidadId: body.recetaId,
      despues: {
        ticketId: body.ticketId,
        ticketNumero: body.ticketNumero,
        recetaId: body.recetaId,
      },
      ip: c.ip,
      userAgent: c.userAgent,
    });

    return {
      ok: true as const,
      ticketId: body.ticketId,
      ticketNumero: body.ticketNumero,
      recetasVinculadas: vinculadas.map((x) => x.recetaId),
    };
  }

  /** Desvincula una receta de un ticket pendiente de confirmación. */
  async desvincularTicketReceta(body: DesvincularTicketBody, c: ContextoPeticion) {
    const existentes = await this.d.db
      .select({
        ticketId: ticketReceta.ticketId,
        ticketNumero: ticketReceta.ticketNumero,
        recetaId: ticketReceta.recetaId,
        estado: ticketReceta.estado,
      })
      .from(ticketReceta);

    const val = validarDesvinculacionTicket({
      ticketId: body.ticketId,
      recetaId: body.recetaId,
      existentes: existentes as {
        ticketId: string;
        ticketNumero: string;
        recetaId: string;
        estado: 'vinculado' | 'confirmado';
      }[],
    });

    if (!val.valido) {
      throw new DomainError(val.error!);
    }

    await this.d.db
      .delete(ticketReceta)
      .where(and(eq(ticketReceta.ticketId, body.ticketId), eq(ticketReceta.recetaId, body.recetaId)));

    await appendAudit(this.d.db, {
      actor: c.usuario.id,
      accion: 'ticket_desvincular_receta',
      entidad: 'ticket_receta',
      entidadId: body.recetaId,
      despues: {
        ticketId: body.ticketId,
        recetaId: body.recetaId,
      },
      ip: c.ip,
      userAgent: c.userAgent,
    });

    return { ok: true as const };
  }

  /**
   * Obtiene el estado consolidado de conciliación de un ticket frente a todas sus recetas asociadas (D-11, US3).
   */
  async obtenerDetalleTicketMultiReceta(
    ticketId: string,
    _c: ContextoPeticion,
  ): Promise<DetalleTicketMultiReceta> {
    const vinculos = await this.d.db
      .select({
        ticketId: ticketReceta.ticketId,
        ticketNumero: ticketReceta.ticketNumero,
        recetaId: ticketReceta.recetaId,
        estado: ticketReceta.estado,
      })
      .from(ticketReceta)
      .where(eq(ticketReceta.ticketId, ticketId));

    if (vinculos.length === 0) {
      throw new DomainError('NO_ENCONTRADO', 'Ticket no vinculado a ninguna receta');
    }

    const ticketNumero = vinculos[0]!.ticketNumero;
    const estado = vinculos[0]!.estado as 'vinculado' | 'confirmado';
    const recetaIds = vinculos.map((v) => v.recetaId);

    const recRows = await this.d.db
      .select({
        id: receta.id,
        confirmacion: receta.confirmacion,
        fechaEmision: receta.fechaEmision,
        createdAt: receta.createdAt,
      })
      .from(receta)
      .where(inArray(receta.id, recetaIds));

    const dispRows = await this.d.db
      .select({
        id: dispensacion.id,
        recetaId: dispensacion.recetaId,
        cn: dispensacion.cn,
        nombreFarmaco: dispensacion.nombreFarmaco,
        unidades: dispensacion.unidades,
      })
      .from(dispensacion)
      .where(and(inArray(dispensacion.recetaId, recetaIds), dispensacionVigente));

    // Obtener líneas del ticket desde Siweb360 o Demo
    const ticketItems: LineaTicketItem[] = [];
    if (this.d.ventas.buscarTickets) {
      try {
        const foundTickets = await this.d.ventas.buscarTickets(ticketNumero);
        const match = foundTickets.find((t) => String(t.id) === ticketId || t.numero === ticketNumero);
        if (match?.items) {
          for (const it of match.items) {
            const nombre = it.nombre ?? '';
            const m = /CN\s*(\d{6,7})/i.exec(nombre) || /\b(\d{6,7})\b/.exec(nombre);
            const cn = m ? m[1]! : '';
            if (cn) {
              ticketItems.push({
                ...(it.id !== null && it.id !== undefined ? { lineaId: it.id } : {}),
                cn,
                nombre,
                unidades: it.cantidad ?? 1,
              });
            }
          }
        }
      } catch {
        // En caso de error consultando el ticket, continúa con lo que haya
      }
    }

    if (ticketItems.length === 0 && this.d.siweb?.client) {
      const numId = Number.parseInt(ticketId, 10);
      if (!Number.isNaN(numId)) {
        try {
          const t = await this.d.siweb.client.ticket(numId);
          if (t?.items) {
            for (const it of t.items) {
              const nombre = it.nombre ?? '';
              const m = /CN\s*(\d{6,7})/i.exec(nombre) || /\b(\d{6,7})\b/.exec(nombre);
              const cn = m ? m[1]! : '';
              if (cn) {
                ticketItems.push({
                  ...(it.id !== null && it.id !== undefined ? { lineaId: it.id } : {}),
                  cn,
                  nombre,
                  unidades: it.cantidad ?? 1,
                });
              }
            }
          }
        } catch {
          // Siweb client error
        }
      }
    }

    const dispensacionesMulti: DispensacionMultiRx[] = dispRows.map((d) => ({
      id: d.id,
      recetaId: d.recetaId ?? '',
      cn: d.cn,
      nombreFarmaco: d.nombreFarmaco,
      unidades: d.unidades,
    }));

    const conciliacion = conciliarTicketMultiReceta({
      ticketItems,
      dispensaciones: dispensacionesMulti,
    });

    return {
      ticketId,
      ticketNumero,
      estado,
      recetas: recRows.map((r) => ({
        recetaId: r.id,
        numeroReceta: (r.confirmacion as { numero?: string | null })?.numero ?? null,
        fecha: r.fechaEmision ?? dia(r.createdAt),
      })),
      conciliacionLineas: conciliacion.lineas,
      puedeConfirmar: conciliacion.puedeConfirmar && estado === 'vinculado',
      bloqueos: conciliacion.bloqueos,
    };
  }

  /**
   * Confirma la conciliación del ticket multi-receta comprobando que no haya exceso dispensado.
   */
  async confirmarTicketMultiReceta(ticketId: string, c: ContextoPeticion): Promise<ConfirmarTicketResponse> {
    const detalle = await this.obtenerDetalleTicketMultiReceta(ticketId, c);

    if (detalle.estado === 'confirmado') {
      throw new DomainError('TICKET_YA_FINALIZADO');
    }

    if (!detalle.puedeConfirmar) {
      throw new DomainError(
        'TICKET_CANTIDAD_INSUFICIENTE',
        detalle.bloqueos.join('; ') || 'La conciliación del ticket presenta discrepancias bloqueantes',
      );
    }

    const ahora = ahoraDe(this.d);
    const recetaIds = detalle.recetas.map((r) => r.recetaId);

    const dispRows = await this.d.db
      .select({
        id: dispensacion.id,
        cn: dispensacion.cn,
      })
      .from(dispensacion)
      .where(and(inArray(dispensacion.recetaId, recetaIds), dispensacionVigente));

    await this.d.db.transaction(async (tx) => {
      // 1. Marcar ticket_receta como confirmado
      await tx.update(ticketReceta).set({ estado: 'confirmado' }).where(eq(ticketReceta.ticketId, ticketId));

      // 2. Insertar registros de conciliación para cada dispensación vinculada
      for (const d of dispRows) {
        const [ya] = await tx
          .select({ id: conciliacion.id })
          .from(conciliacion)
          .where(eq(conciliacion.dispensacionId, d.id))
          .limit(1);

        if (!ya) {
          await tx.insert(conciliacion).values({
            dispensacionId: d.id,
            movimientoId: `ticket:${ticketId}:${d.cn}`,
            ticket: detalle.ticketNumero,
            loteVerificado: false,
            origen: 'manual',
            at: ahora,
          });
        }
      }

      // 3. Auditoría
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'ticket_confirmado_multi_receta',
        entidad: 'ticket_receta',
        entidadId: ticketId,
        despues: {
          ticketId,
          ticketNumero: detalle.ticketNumero,
          recetas: recetaIds,
          salidasConciliadas: dispRows.length,
        },
        ip: c.ip,
        userAgent: c.userAgent,
      });
    });

    return {
      ok: true,
      ticketId,
      ticketNumero: detalle.ticketNumero,
      salidasConciliadas: dispRows.length,
    };
  }
}
