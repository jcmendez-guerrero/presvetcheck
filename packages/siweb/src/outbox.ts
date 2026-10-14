import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { appendAudit, outbox, recepcion, recepcionLinea, type Db, type DbOrTx } from '@mmx/db';
import { DomainError } from '@mmx/shared';
import { HttpError } from '@mmx/shared/node';
import type { SiwebClient } from './client';
import { SiwebValidationError } from './client';
import type { AdjustmentRequest } from './schemas';

/**
 * Outbox de escrituras en Siweb360 (ADR-08, SPEC §5.2.4–5.2.5).
 * - Solo ENTRADAS (`purchase_receipt`, cantidad positiva, modo delta). Nunca salidas: las descuenta el TPV.
 * - Respeta `SIWEB_STOCK_WRITE_MODE` (por defecto `off`: no se encola ni se envía nada).
 * - La clave de idempotencia `MMX-REC-{id}-L{n}` viaja en `notes`. Ante timeout o respuesta ambigua la
 *   operación pasa a `needs_reconciliation` y NO se reintenta sola; un 4xx determinista → `failed`.
 */

export type ModoEscritura = 'off' | 'entries_only';
export const OPERACION_ENTRADA = 'stock_adjustment_entry';

export function claveEntrada(recepcionId: string, numeroLinea: number): string {
  return `MMX-REC-${recepcionId}-L${numeroLinea}`;
}

/** Garantía: el outbox solo admite entradas de stock. */
export function exigirEntrada(p: AdjustmentRequest): void {
  if (!(p.quantity > 0) || (p.mode ?? 'delta') !== 'delta' || p.reason !== 'purchase_receipt') {
    throw new DomainError('SIWEB_SALIDAS_PROHIBIDAS', 'El outbox solo admite entradas (purchase_receipt, delta, cantidad > 0)');
  }
}

export interface ResultadoEncolado {
  encoladas: number;
  pendientesAlta: number;
  escrituraDesactivada: boolean;
}

export type ResultadoEnvio = 'sent' | 'failed' | 'needs_reconciliation';

export class OutboxService {
  constructor(
    private readonly db: Db,
    private readonly client: SiwebClient,
    private readonly cfg: { modo: ModoEscritura; almacenId: () => Promise<number> },
    private readonly opts: { now?: () => Date; log?: (m: string, d?: Record<string, unknown>) => void } = {},
  ) {}

  private now() {
    return (this.opts.now ?? (() => new Date()))();
  }

  /**
   * Encola los ajustes de una recepción recién finalizada (llamar dentro de la transacción de
   * finalización). Las líneas sin variante mapeada quedan en PENDIENTE_ALTA_SIWEB.
   */
  async encolarRecepcion(tx: DbOrTx, recepcionId: string): Promise<ResultadoEncolado> {
    const lineas = await tx.select().from(recepcionLinea).where(eq(recepcionLinea.recepcionId, recepcionId)).orderBy(asc(recepcionLinea.numero));
    const meds = lineas.filter((l) => l.tipo === 'medicamento');
    if (this.cfg.modo === 'off') {
      await tx.update(recepcion).set({ syncEstado: 'ESCRITURA_DESACTIVADA' }).where(eq(recepcion.id, recepcionId));
      return { encoladas: 0, pendientesAlta: 0, escrituraDesactivada: true };
    }
    const almacen = await this.cfg.almacenId();
    let encoladas = 0;
    let pendientesAlta = 0;
    for (const l of meds) {
      if (l.siwebVariantId === null) {
        await tx.update(recepcionLinea).set({ estado: 'PENDIENTE_ALTA_SIWEB' }).where(eq(recepcionLinea.id, l.id));
        pendientesAlta++;
        continue;
      }
      await this.encolarLinea(tx, l, almacen);
      encoladas++;
    }
    await tx
      .update(recepcion)
      .set({ syncEstado: pendientesAlta ? 'PENDIENTE_ALTA_SIWEB' : encoladas ? 'ENCOLADA' : 'SIN_MEDICAMENTOS' })
      .where(eq(recepcion.id, recepcionId));
    return { encoladas, pendientesAlta, escrituraDesactivada: false };
  }

  private async encolarLinea(tx: DbOrTx, l: typeof recepcionLinea.$inferSelect, almacen: number) {
    const key = claveEntrada(l.recepcionId, l.numero);
    const payload: AdjustmentRequest = {
      variant_id: l.siwebVariantId as number,
      warehouse_id: almacen,
      quantity: l.unidades,
      mode: 'delta',
      reason: 'purchase_receipt',
      notes: key,
      ...(l.lote ? { batch_number: l.lote } : {}),
      ...(l.caducidad ? { expiry_date: l.caducidad } : {}),
    };
    exigirEntrada(payload);
    await tx
      .insert(outbox)
      .values({ operation: OPERACION_ENTRADA, payload: payload as never, idempotencyKey: key, entidad: 'recepcion_linea', entidadId: l.id })
      .onConflictDoNothing({ target: outbox.idempotencyKey });
    await tx.update(recepcionLinea).set({ estado: 'ENCOLADA' }).where(eq(recepcionLinea.id, l.id));
  }

  /**
   * Cuando se completa el alta en Siweb360 de un CN, se mapean sus líneas PENDIENTE_ALTA_SIWEB y se
   * encola el ajuste pendiente (SPEC §5.2.2).
   */
  async reencolarPendientesAlta(cn: string, variantId: number): Promise<number> {
    if (this.cfg.modo === 'off') return 0;
    const almacen = await this.cfg.almacenId();
    return this.db.transaction(async (tx) => {
      const lineas = await tx
        .select()
        .from(recepcionLinea)
        .where(and(eq(recepcionLinea.cn, cn), eq(recepcionLinea.estado, 'PENDIENTE_ALTA_SIWEB')));
      for (const l of lineas) {
        await tx.update(recepcionLinea).set({ siwebVariantId: variantId }).where(eq(recepcionLinea.id, l.id));
        await this.encolarLinea(tx, { ...l, siwebVariantId: variantId }, almacen);
      }
      return lineas.length;
    });
  }

  /** Envía las operaciones pendientes (job `outbox-dispatcher`, y disparo tras finalizar una recepción). */
  async despachar(limite = 20): Promise<Record<ResultadoEnvio, number>> {
    const cuenta: Record<ResultadoEnvio, number> = { sent: 0, failed: 0, needs_reconciliation: 0 };
    if (this.cfg.modo === 'off') return cuenta;
    const bloqueoCaducado = new Date(this.now().getTime() - 10 * 60_000);
    const filas = await this.db
      .select()
      .from(outbox)
      .where(and(eq(outbox.status, 'pending'), or(isNull(outbox.lockedAt), lt(outbox.lockedAt, bloqueoCaducado))))
      .orderBy(asc(outbox.createdAt))
      .limit(limite);
    for (const f of filas) {
      // Toma la fila (evita que dos dispatchers envíen la misma operación).
      const tomadas = await this.db
        .update(outbox)
        .set({ lockedAt: this.now(), attempts: sql`${outbox.attempts} + 1` })
        .where(and(eq(outbox.id, f.id), eq(outbox.status, 'pending'), or(isNull(outbox.lockedAt), lt(outbox.lockedAt, bloqueoCaducado))))
        .returning({ id: outbox.id });
      if (!tomadas.length) continue;
      const r = await this.enviar(f);
      cuenta[r]++;
    }
    return cuenta;
  }

  private async enviar(f: typeof outbox.$inferSelect): Promise<ResultadoEnvio> {
    let status: ResultadoEnvio;
    let error: string | null = null;
    let response: unknown = null;
    try {
      if (f.operation !== OPERACION_ENTRADA) throw new DomainError('SIWEB_SALIDAS_PROHIBIDAS', `Operación no admitida: ${f.operation}`);
      const payload = f.payload as AdjustmentRequest;
      exigirEntrada(payload);
      const r = await this.client.ajustarStock(payload);
      status = 'sent';
      response = r.raw;
    } catch (e) {
      if (e instanceof HttpError && e.kind === 'HTTP' && e.status !== null && e.status >= 400 && e.status < 500) {
        status = 'failed';
        error = e.status === 409 ? 'La variante tiene stock ilimitado en Siweb360 (409)' : `HTTP ${e.status}: ${JSON.stringify(e.body ?? null).slice(0, 500)}`;
      } else if (e instanceof DomainError) {
        status = 'failed';
        error = e.message;
      } else {
        // Timeout, error de red, 5xx o respuesta no interpretable: no se sabe si se aplicó.
        status = 'needs_reconciliation';
        error = e instanceof HttpError || e instanceof SiwebValidationError ? e.message : String(e);
      }
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(outbox)
        .set({ status, lastError: error, response: response as never, lockedAt: null, sentAt: status === 'sent' ? this.now() : null })
        .where(eq(outbox.id, f.id));
      if (f.entidad === 'recepcion_linea' && f.entidadId) await this.actualizarRecepcion(tx, f.entidadId, status);
      await appendAudit(tx, {
        actor: 'outbox-dispatcher',
        accion: `outbox_${status}`,
        entidad: 'outbox',
        entidadId: f.id,
        despues: { idempotencyKey: f.idempotencyKey, status, error },
      });
    });
    if (status !== 'sent') this.opts.log?.('outbox: operación no enviada', { id: f.id, status });
    return status;
  }

  private async actualizarRecepcion(tx: DbOrTx, lineaId: string, status: ResultadoEnvio | 'resuelta') {
    const estadoLinea = status === 'sent' || status === 'resuelta' ? 'SINCRONIZADA' : 'ERROR';
    const [l] = await tx.update(recepcionLinea).set({ estado: estadoLinea }).where(eq(recepcionLinea.id, lineaId)).returning({ recepcionId: recepcionLinea.recepcionId });
    if (!l) return;
    const lineas = await tx.select({ estado: recepcionLinea.estado, tipo: recepcionLinea.tipo }).from(recepcionLinea).where(eq(recepcionLinea.recepcionId, l.recepcionId));
    const meds = lineas.filter((x) => x.tipo === 'medicamento');
    if (meds.some((x) => x.estado === 'ERROR')) {
      await tx.update(recepcion).set({ estado: 'ERROR_SINCRONIZACION', syncEstado: 'ERROR' }).where(eq(recepcion.id, l.recepcionId));
    } else if (meds.every((x) => x.estado === 'SINCRONIZADA')) {
      await tx.update(recepcion).set({ estado: 'SINCRONIZADA', syncEstado: 'SINCRONIZADA' }).where(eq(recepcion.id, l.recepcionId));
    }
  }

  listar(status?: string[]) {
    const q = this.db.select().from(outbox);
    return (status?.length ? q.where(inArray(outbox.status, status)) : q).orderBy(asc(outbox.createdAt));
  }

  /**
   * Resolución humana de una operación `needs_reconciliation` (bandeja de administración, con el stock
   * actual de la variante a la vista):
   *  - `confirmar_aplicada`: la persona comprueba en Siweb360 que el ajuste SÍ se aplicó → sent.
   *  - `reenviar`: comprueba que NO se aplicó y decide reenviar → pending.
   *  - `descartar`: no se enviará (p. ej. se dio de alta a mano) → failed.
   */
  async resolver(id: string, accion: 'confirmar_aplicada' | 'reenviar' | 'descartar', actor: string, nota: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [f] = await tx.select().from(outbox).where(eq(outbox.id, id)).for('update');
      if (!f || (f.status !== 'needs_reconciliation' && f.status !== 'failed')) {
        throw new DomainError('CONFLICTO', 'Solo se resuelven operaciones en reconciliación o fallidas');
      }
      const status = accion === 'confirmar_aplicada' ? 'sent' : accion === 'reenviar' ? 'pending' : 'failed';
      await tx
        .update(outbox)
        .set({ status, resolvedBy: actor, resolvedAt: this.now(), resolution: `${accion}: ${nota}`, lockedAt: null })
        .where(eq(outbox.id, id));
      if (accion === 'confirmar_aplicada' && f.entidad === 'recepcion_linea' && f.entidadId) await this.actualizarRecepcion(tx, f.entidadId, 'resuelta');
      await appendAudit(tx, { actor, accion: `outbox_resolver_${accion}`, entidad: 'outbox', entidadId: id, antes: { status: f.status }, despues: { status, nota } });
    });
  }
}
