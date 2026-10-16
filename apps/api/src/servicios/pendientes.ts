import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { appendAudit, discrepancia, outbox, pedidoPendiente, receta, sustitucion } from '@mmx/db';
import { DomainError } from '@mmx/shared';
import { ahoraDe, type AppDeps } from '../deps';
import type { ContextoPeticion } from './recetas';
import { ConciliacionService } from './conciliacion';

const DIA = 24 * 3600 * 1000;

/**
 * Pendientes de la operativa (SPEC §8.1, §8.9). El farmacéutico garante no usa la app: lo que hace
 * fuera (autorizar, firmar la receta en papel, revisar) lo registra el empleado. Las dispensaciones
 * forzadas y las recetas no conformes le llegan en el reporte semanal.
 */
export class PendientesService {
  constructor(private readonly d: AppDeps) {}

  async listado() {
    const ahora = ahoraDe(this.d).getTime();
    const sust = await this.d.db
      .select()
      .from(sustitucion)
      .where(inArray(sustitucion.estado, ['PENDIENTE_AUTORIZACION_PREVIA', 'DISPENSADA', 'RECETA_APARTADA']))
      .orderBy(sustitucion.createdAt);
    const discrepancias = await this.d.db.select().from(discrepancia).where(eq(discrepancia.estado, 'abierta')).orderBy(desc(discrepancia.fecha)).limit(100);
    return {
      registros: await this.registrosPendientes(),
      sinConciliar: await new ConciliacionService(this.d).pendientes(),
      sustituciones: sust.map((s) => {
        const dias = Math.floor((ahora - s.createdAt.getTime()) / DIA);
        return {
          id: s.id,
          estado: s.estado,
          modo: s.modo,
          cnPrescrito: s.cnPrescrito,
          cnPropuesto: s.cnPropuesto,
          indicacion: (s.equivalencia as { equivalencia?: { indicacion?: string } }).equivalencia?.indicacion ?? null,
          antiguedadDias: dias,
          // Firma del garante en papel fuera de plazo (SUBSTITUTION_SIGN_MAX_DAYS).
          alerta: s.estado !== 'PENDIENTE_AUTORIZACION_PREVIA' && dias > this.d.config.SUBSTITUTION_SIGN_MAX_DAYS,
        };
      }),
      discrepancias,
    };
  }

  /** Recetas dispensadas con la transcripción para el registro aún pendiente (dispensación ágil). */
  async registrosPendientes() {
    const filas = await this.d.db
      .select({ id: receta.id, numero: receta.numero, fecha: receta.primeraDispensacionAt, estado: receta.estado })
      .from(receta)
      .where(
        and(
          inArray(receta.estado, ['DISPENSADA', 'DISPENSADA_PARCIAL']),
          isNull(receta.registroCompletadoAt),
          sql`${receta.confirmacion}->>'registroDiferido' = 'true'`,
        ),
      )
      .orderBy(receta.primeraDispensacionAt)
      .limit(200);
    return filas.map((f) => ({ ...f, fecha: f.fecha?.toISOString() ?? null }));
  }

  /** El empleado deja resuelta una discrepancia con una nota (auditada). */
  async resolverDiscrepancia(id: string, nota: string, c: ContextoPeticion) {
    if (nota.trim().length < 10) throw new DomainError('VALIDACION', 'Explica cómo se ha resuelto');
    return this.d.db.transaction(async (tx) => {
      const [r] = await tx
        .update(discrepancia)
        .set({ estado: 'resuelta', resueltaPor: c.usuario.id, resueltaAt: ahoraDe(this.d), notaResolucion: nota.trim() })
        .where(eq(discrepancia.id, id))
        .returning();
      if (!r) throw new DomainError('NO_ENCONTRADO');
      await appendAudit(tx, { actor: c.usuario.id, accion: 'discrepancia_resolver', entidad: 'discrepancia', entidadId: id, despues: { nota: nota.trim() }, ip: c.ip, userAgent: c.userAgent });
      return r;
    });
  }

  /** Contadores de la pantalla de Inicio. */
  async inicio() {
    const contar = async (q: Promise<unknown[]>) => (await q).length;
    return {
      sustitucionesPendientes: await contar(this.d.db.select({ id: sustitucion.id }).from(sustitucion).where(inArray(sustitucion.estado, ['PENDIENTE_AUTORIZACION_PREVIA', 'DISPENSADA', 'RECETA_APARTADA']))),
      recetasNoConformes: await contar(this.d.db.select({ id: receta.id }).from(receta).where(eq(receta.estado, 'NO_CONFORME'))),
      discrepanciasAbiertas: await contar(this.d.db.select({ id: discrepancia.id }).from(discrepancia).where(eq(discrepancia.estado, 'abierta'))),
      outboxIncidencias: await contar(this.d.db.select({ id: outbox.id }).from(outbox).where(inArray(outbox.status, ['failed', 'needs_reconciliation']))),
      registrosPendientes: (await this.registrosPendientes()).length,
      pedidosRecibidosPendientesEntrega: await contar(this.d.db.select({ id: pedidoPendiente.id }).from(pedidoPendiente).where(eq(pedidoPendiente.estado, 'recibido'))),
    };
  }
}
