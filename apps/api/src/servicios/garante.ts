import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { appendAudit, discrepancia, dispensacion, outbox, pedidoPendiente, receta, revisionGarante, sustitucion } from '@mmx/db';
import { DomainError } from '@mmx/shared';
import { ahoraDe, type AppDeps } from '../deps';
import type { ContextoPeticion } from './recetas';

const DIA = 24 * 3600 * 1000;

/** Bandeja del garante (SPEC §4.4.3, §8.9) y contadores de Inicio (§8.1). */
export class GaranteService {
  constructor(private readonly d: AppDeps) {}

  async bandeja() {
    const ahora = ahoraDe(this.d).getTime();
    const revisadas = this.d.db.select({ id: revisionGarante.entidadId }).from(revisionGarante);
    const sust = await this.d.db
      .select()
      .from(sustitucion)
      .where(inArray(sustitucion.estado, ['PENDIENTE_AUTORIZACION_PREVIA', 'DISPENSADA', 'RECETA_APARTADA', 'FIRMADA_GARANTE']))
      .orderBy(sustitucion.createdAt);
    const forzadas = await this.d.db
      .select()
      .from(dispensacion)
      .where(and(or(eq(dispensacion.forzado, true), eq(dispensacion.cambioFormato, true), eq(dispensacion.cambioConcentracion, true)), sql`${dispensacion.anulaDispensacionId} is null`, notInArray(dispensacion.id, revisadas)))
      .orderBy(desc(dispensacion.fechaVenta))
      .limit(200);
    const noConformes = await this.d.db
      .select({ id: receta.id, numero: receta.numero, fechaEmision: receta.fechaEmision, createdAt: receta.createdAt, evaluacion: receta.evaluacion })
      .from(receta)
      .where(and(eq(receta.estado, 'NO_CONFORME'), notInArray(receta.id, revisadas)))
      .orderBy(desc(receta.createdAt))
      .limit(100);
    const discrepancias = await this.d.db.select().from(discrepancia).where(eq(discrepancia.estado, 'abierta')).orderBy(desc(discrepancia.fecha)).limit(100);
    return {
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
          alerta: dias > this.d.config.SUBSTITUTION_SIGN_MAX_DAYS,
        };
      }),
      dispensacionesARevisar: forzadas.map((d) => ({
        id: d.id,
        fechaVenta: d.fechaVenta,
        nombre: d.nombreFarmaco,
        cn: d.cn,
        lote: d.lote,
        forzado: d.forzado,
        defectos: d.defectosForzados ?? [],
        motivo: d.motivoForzado,
        cambioFormato: d.cambioFormato,
        cambioConcentracion: d.cambioConcentracion,
        empleado: d.empleado,
        // Productos no válidos forzados se listan aparte (D-05c).
        productoNoValido: (d.defectosForzados ?? []).some((c) => this.d.rules.bundle.recetaCampos.producto_no_valido.includes(c as never)),
      })),
      recetasNoConformes: noConformes.map((r) => ({
        id: r.id,
        numero: r.numero,
        createdAt: r.createdAt,
        motivos: ((r.evaluacion as { lineas?: { resultado: { motivos: { code: string }[] } }[] } | null)?.lineas ?? []).flatMap((l) => l.resultado.motivos.map((m) => m.code)),
      })),
      discrepancias,
    };
  }

  /** Revisión del garante (append-only) con MFA. */
  async revisar(b: { entidad: 'dispensacion' | 'receta' | 'sustitucion' | 'discrepancia'; entidadId: string; resultado: 'conforme' | 'no_conforme'; comentario: string | null }, c: ContextoPeticion) {
    if (!c.usuario.mfa) throw new DomainError('PROHIBIDO', 'La revisión del garante exige MFA');
    return this.d.db.transaction(async (tx) => {
      const [r] = await tx.insert(revisionGarante).values({ ...b, revisadoPor: c.usuario.id, mfa: true }).returning();
      if (b.entidad === 'discrepancia') {
        await tx.update(discrepancia).set({ estado: 'resuelta', resueltaPor: c.usuario.id, resueltaAt: ahoraDe(this.d) }).where(eq(discrepancia.id, b.entidadId));
      }
      await appendAudit(tx, { actor: c.usuario.id, accion: 'revision_garante', entidad: b.entidad, entidadId: b.entidadId, despues: { resultado: b.resultado }, ip: c.ip, userAgent: c.userAgent });
      return r!;
    });
  }

  /** Contadores de la pantalla de Inicio. */
  async inicio() {
    const contar = async (q: Promise<unknown[]>) => (await q).length;
    return {
      sustitucionesPendientes: await contar(this.d.db.select({ id: sustitucion.id }).from(sustitucion).where(inArray(sustitucion.estado, ['PENDIENTE_AUTORIZACION_PREVIA', 'DISPENSADA', 'RECETA_APARTADA']))),
      recetasNoConformes: await contar(this.d.db.select({ id: receta.id }).from(receta).where(eq(receta.estado, 'NO_CONFORME'))),
      outboxIncidencias: await contar(this.d.db.select({ id: outbox.id }).from(outbox).where(inArray(outbox.status, ['failed', 'needs_reconciliation']))),
      pedidosRecibidosPendientesEntrega: await contar(this.d.db.select({ id: pedidoPendiente.id }).from(pedidoPendiente).where(eq(pedidoPendiente.estado, 'recibido'))),
    };
  }
}
