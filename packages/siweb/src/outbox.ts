import { and, asc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  appendAudit,
  distribuidor,
  outbox,
  recepcion,
  recepcionLinea,
  siwebVariantMap,
  type Db,
  type DbOrTx,
} from '@mmx/db';
import { costeProveedorCents } from '@mmx/domain';
import { DomainError, diaMadrid } from '@mmx/shared';
import { HttpError } from '@mmx/shared/node';
import type { SiwebClient } from './client';
import { SiwebValidationError } from './client';
import type { AdjustmentRequest } from './schemas';
import { esPruebaVigente } from './prueba-escritura';
import { resolverProveedor, type MotivoProveedor } from './proveedor';

/**
 * Outbox de escrituras en Siweb360 (ADR-08, SPEC §5.2.4–5.2.5).
 * - Solo ENTRADAS (`purchase_receipt`, cantidad positiva, modo delta) y ACTUALIZACIÓN DE PRECIOS/COSTES.
 *   Nunca salidas: las descuenta el TPV.
 * - Respeta `SIWEB_STOCK_WRITE_MODE` (por defecto `off`: no se encola ni se envía nada).
 * - La clave de idempotencia `MMX-REC-{id}-L{n}` viaja en `notes`. Ante timeout o respuesta ambigua la
 *   operación pasa a `needs_reconciliation` y NO se reintenta sola; un 4xx determinista → `failed`.
 * - Una operación dudosa se comprueba contra el historial de movimientos de Siweb360 (`verificarDudosos`):
 *   si la clave aparece una vez se da por enviada; si no, queda para una persona (specs/011).
 * - Sin una prueba de escritura superada en los últimos 30 días no se envía nada (specs/011, FR-010b).
 */

export type ModoEscritura = 'off' | 'entries_only';
export const OPERACION_ENTRADA = 'stock_adjustment_entry';
export const OPERACION_ACTUALIZAR_PRECIO = 'siweb_actualizar_precio';
/** Coste de compra del proveedor de la recepción para el producto (specs/016). Siempre, sin depender de la casilla. */
export const OPERACION_ACTUALIZAR_COSTE_PROVEEDOR = 'siweb_actualizar_coste_proveedor';
/**
 * Estado de una fila del outbox cuyo proveedor de Siweb360 no se ha podido identificar (specs/016): no se ha enviado
 * nada y se reintenta sola al vincular el proveedor o en el siguiente barrido. No es un `ResultadoEnvio`.
 */
export const ESTADO_SIN_PROVEEDOR = 'needs_supplier';
/** Reintento de la resolución del proveedor: diario (spec FR-007) y a la media hora si Siweb360 no respondió. */
export const REINTENTO_PROVEEDOR_MS = 24 * 3_600_000;
export const REINTENTO_PROVEEDOR_RED_MS = 30 * 60_000;
/** `last_error` cuando no se pudo consultar Siweb360 para identificar al proveedor (la UI lo traduce). */
export const ERROR_PROVEEDOR_SIN_RESPUESTA = 'SIWEB_NO_DISPONIBLE';

/** Carga útil de `siweb_actualizar_coste_proveedor`. `product_id` y `contact_id` se completan al resolver el envío. */
export interface PayloadCosteProveedor {
  variant_id: number;
  distribuidor_id: string;
  cost_cents: number;
  product_id?: number;
  contact_id?: number;
}

export function claveCosteProveedor(recepcionId: string, numeroLinea: number): string {
  return `MMX-PRV-${recepcionId}-L${numeroLinea}`;
}

export function claveEntrada(recepcionId: string, numeroLinea: number): string {
  return `MMX-REC-${recepcionId}-L${numeroLinea}`;
}

export function clavePrecio(recepcionId: string, numeroLinea: number): string {
  return `MMX-PRC-${recepcionId}-L${numeroLinea}`;
}

/** Garantía: el outbox solo admite entradas de stock. */
export function exigirEntrada(p: AdjustmentRequest): void {
  if (!(p.quantity > 0) || (p.mode ?? 'delta') !== 'delta' || p.reason !== 'purchase_receipt') {
    throw new DomainError(
      'SIWEB_SALIDAS_PROHIBIDAS',
      'El outbox solo admite entradas (purchase_receipt, delta, cantidad > 0)',
    );
  }
}

export interface ResultadoEncolado {
  encoladas: number;
  pendientesAlta: number;
  escrituraDesactivada: boolean;
}

export type ResultadoEnvio = 'sent' | 'failed' | 'needs_reconciliation';

/** Error guardado cuando la variante tiene stock ilimitado (409): código estable que traduce la UI. */
export const ERROR_STOCK_ILIMITADO = 'SIWEB_STOCK_ILIMITADO';
/** Primera comprobación de un envío dudoso, intervalo y número máximo (24 h). */
const PRIMERA_VERIFICACION_MS = 10 * 60_000;
const INTERVALO_VERIFICACION_MS = 15 * 60_000;
export const MAX_VERIFICACIONES = 96;

export interface ResultadoVerificacion {
  verificadas: number;
  noConsta: number;
  duplicadas: number;
}

export class OutboxService {
  constructor(
    private readonly db: Db,
    private readonly client: SiwebClient,
    private readonly cfg: {
      modo: ModoEscritura;
      almacenId: () => Promise<number>;
      /** Fecha de la última prueba de escritura superada (o null). */
      pruebaVigente: () => Promise<Date | null>;
      /** `coste_proveedor_base` de `config/rules/precios.v1.yaml` (TODO(decision D-15)); por defecto `precio_coste`. */
      costeProveedorBase?: 'precio_coste' | 'precio_neto';
    },
    private readonly opts: { now?: () => Date; log?: (m: string, d?: Record<string, unknown>) => void } = {},
  ) {}

  private now() {
    return (this.opts.now ?? (() => new Date()))();
  }

  /**
   * Encola los ajustes de una recepción recién finalizada (llamar dentro de la transacción de
   * finalización). Las líneas sin variante mapeada quedan en PENDIENTE_ALTA_SIWEB.
   */
  async encolarRecepcion(
    tx: DbOrTx,
    recepcionId: string,
    o: { sinPrecios?: boolean } = {},
  ): Promise<ResultadoEncolado> {
    const lineas = await tx
      .select()
      .from(recepcionLinea)
      .where(eq(recepcionLinea.recepcionId, recepcionId))
      .orderBy(asc(recepcionLinea.numero));
    const meds = lineas.filter((l) => l.tipo === 'medicamento');
    if (this.cfg.modo === 'off') {
      await tx
        .update(recepcion)
        .set({ syncEstado: 'ESCRITURA_DESACTIVADA' })
        .where(eq(recepcion.id, recepcionId));
      return { encoladas: 0, pendientesAlta: 0, escrituraDesactivada: true };
    }
    const almacen = await this.cfg.almacenId();
    const [rec] = await tx
      .select({ distribuidorId: recepcion.distribuidorId })
      .from(recepcion)
      .where(eq(recepcion.id, recepcionId));
    let encoladas = 0;
    let pendientesAlta = 0;
    for (const l of meds) {
      // Coste del proveedor: siempre, esté o no marcada «actualizar precio» (specs/016).
      if (!o.sinPrecios && l.siwebVariantId !== null && rec)
        await this.encolarCosteProveedor(tx, l, rec.distribuidorId);
      if (
        !o.sinPrecios &&
        l.siwebVariantId !== null &&
        l.actualizarPrecio &&
        (l.precioCoste || l.precioNetoCompra)
      ) {
        await this.encolarActualizarPrecio(tx, l);
      }
      // La persona puede decidir no dar entrada de stock de una línea («Actualizar stock» desmarcado).
      if (!l.actualizarStock) {
        await tx
          .update(recepcionLinea)
          .set({ estado: 'SIN_ACTUALIZAR_STOCK' })
          .where(eq(recepcionLinea.id, l.id));
        continue;
      }
      if (l.siwebVariantId === null) {
        await tx
          .update(recepcionLinea)
          .set({ estado: 'PENDIENTE_ALTA_SIWEB' })
          .where(eq(recepcionLinea.id, l.id));
        pendientesAlta++;
        continue;
      }
      await this.encolarLinea(tx, l, almacen);
      encoladas++;
    }
    await tx
      .update(recepcion)
      .set({
        syncEstado: pendientesAlta ? 'PENDIENTE_ALTA_SIWEB' : encoladas ? 'ENCOLADA' : 'SIN_MEDICAMENTOS',
      })
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
      .values({
        operation: OPERACION_ENTRADA,
        payload: payload as never,
        idempotencyKey: key,
        entidad: 'recepcion_linea',
        entidadId: l.id,
      })
      .onConflictDoNothing({ target: outbox.idempotencyKey });
    await tx.update(recepcionLinea).set({ estado: 'ENCOLADA' }).where(eq(recepcionLinea.id, l.id));
  }

  private async encolarActualizarPrecio(tx: DbOrTx, l: typeof recepcionLinea.$inferSelect) {
    const key = clavePrecio(l.recepcionId, l.numero);
    const precioBase = l.precioCoste ?? l.precioNetoCompra;
    if (!precioBase || l.siwebVariantId === null) return;
    const costCents = new Decimal(precioBase).times(100).toNumber();
    const payload = {
      variant_id: l.siwebVariantId,
      cost_cents: costCents,
    };
    await tx
      .insert(outbox)
      .values({
        operation: OPERACION_ACTUALIZAR_PRECIO,
        payload: payload as never,
        idempotencyKey: key,
        entidad: 'recepcion_linea',
        entidadId: l.id,
      })
      .onConflictDoNothing({ target: outbox.idempotencyKey });
  }

  /**
   * Encola el coste de compra del proveedor de la recepción para el producto de la variante (specs/016). Solo si la
   * línea tiene un coste positivo y está enlazada a una variante; una por línea (clave idempotente). Nunca borra
   * el coste existente. La resolución del proveedor y del producto se hace al enviar, no aquí.
   */
  private async encolarCosteProveedor(
    tx: DbOrTx,
    l: typeof recepcionLinea.$inferSelect,
    distribuidorId: string,
  ) {
    if (l.siwebVariantId === null) return;
    const cents = costeProveedorCents(l, {
      coste_proveedor_base: this.cfg.costeProveedorBase ?? 'precio_coste',
    });
    if (cents === null) return;
    const payload: PayloadCosteProveedor = {
      variant_id: l.siwebVariantId,
      distribuidor_id: distribuidorId,
      cost_cents: cents,
    };
    await tx
      .insert(outbox)
      .values({
        operation: OPERACION_ACTUALIZAR_COSTE_PROVEEDOR,
        payload: payload as never,
        idempotencyKey: claveCosteProveedor(l.recepcionId, l.numero),
        entidad: 'recepcion_linea',
        entidadId: l.id,
      })
      .onConflictDoNothing({ target: outbox.idempotencyKey });
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
        if (l.actualizarPrecio && (l.precioCoste || l.precioNetoCompra)) {
          await this.encolarActualizarPrecio(tx, { ...l, siwebVariantId: variantId });
        }
        // Coste del proveedor: siempre, salvo en recepciones enviadas a mano con la escritura apagada, que no
        // mandan precios (un precio antiguo podría pisar uno más reciente; ver `enviarRecepcionDesactivada`).
        const [rec] = await tx
          .select({ distribuidorId: recepcion.distribuidorId, syncEstado: recepcion.syncEstado })
          .from(recepcion)
          .where(eq(recepcion.id, l.recepcionId));
        if (rec && rec.syncEstado !== 'ESCRITURA_DESACTIVADA')
          await this.encolarCosteProveedor(tx, { ...l, siwebVariantId: variantId }, rec.distribuidorId);
      }
      return lineas.length;
    });
  }

  /** Envía las operaciones pendientes (job `outbox-dispatcher`, y disparo tras finalizar una recepción). */
  async despachar(limite = 20): Promise<Record<ResultadoEnvio, number>> {
    const cuenta: Record<ResultadoEnvio, number> = { sent: 0, failed: 0, needs_reconciliation: 0 };
    if (this.cfg.modo === 'off') return cuenta;
    if (!esPruebaVigente(await this.cfg.pruebaVigente(), this.now())) {
      this.opts.log?.('outbox: falta la prueba de escritura en Siweb360; no se envía nada');
      return cuenta;
    }
    // Un bloqueo caducado es un envío que se cortó (proceso parado, fallo al guardar el resultado): no se
    // sabe si Siweb360 lo aplicó, así que va a reconciliación humana y nunca se reenvía solo.
    const bloqueoCaducado = new Date(this.now().getTime() - 10 * 60_000);
    const cortadas = await this.db
      .update(outbox)
      .set({
        status: 'needs_reconciliation',
        lockedAt: null,
        lastError: 'Envío interrumpido: no se sabe si se aplicó',
        nextAttemptAt: new Date(this.now().getTime() + PRIMERA_VERIFICACION_MS),
      })
      .where(and(eq(outbox.status, 'pending'), lt(outbox.lockedAt, bloqueoCaducado)))
      .returning();
    for (const f of cortadas) {
      await this.registrar(f, 'needs_reconciliation', f.lastError, null, false);
      cuenta.needs_reconciliation++;
    }
    const filas = await this.db
      .select()
      .from(outbox)
      .where(and(eq(outbox.status, 'pending'), isNull(outbox.lockedAt)))
      .orderBy(asc(outbox.createdAt))
      .limit(limite);
    for (const f of filas) {
      // Toma la fila (evita que dos dispatchers envíen la misma operación).
      const tomadas = await this.db
        .update(outbox)
        .set({ lockedAt: this.now(), attempts: sql`${outbox.attempts} + 1` })
        .where(and(eq(outbox.id, f.id), eq(outbox.status, 'pending'), isNull(outbox.lockedAt)))
        .returning({ id: outbox.id });
      if (!tomadas.length) continue;
      const r = await this.enviar(f);
      if (r !== ESTADO_SIN_PROVEEDOR) cuenta[r]++;
    }
    return cuenta;
  }

  private async enviar(f: typeof outbox.$inferSelect): Promise<ResultadoEnvio | typeof ESTADO_SIN_PROVEEDOR> {
    let status: ResultadoEnvio;
    let error: string | null = null;
    let response: unknown = null;
    try {
      if (f.operation === OPERACION_ENTRADA) {
        const payload = f.payload as AdjustmentRequest;
        exigirEntrada(payload);
        const r = await this.client.ajustarStock(payload);
        status = 'sent';
        response = r.raw;
      } else if (f.operation === OPERACION_ACTUALIZAR_PRECIO) {
        const payload = f.payload as { variant_id: number; cost_cents?: number; price_cents?: number };
        const r = await this.client.actualizarPrecios(payload.variant_id, {
          ...(payload.cost_cents !== undefined ? { cost_cents: payload.cost_cents } : {}),
          ...(payload.price_cents !== undefined ? { price_cents: payload.price_cents } : {}),
        });
        status = 'sent';
        response = r;
      } else if (f.operation === OPERACION_ACTUALIZAR_COSTE_PROVEEDOR) {
        const r = await this.enviarCosteProveedor(f);
        if (r.sinProveedor) return r.sinProveedor;
        status = 'sent';
        response = r.response;
      } else {
        throw new DomainError('SIWEB_SALIDAS_PROHIBIDAS', `Operación no admitida: ${f.operation}`);
      }
    } catch (e) {
      if (
        e instanceof HttpError &&
        e.kind === 'HTTP' &&
        e.status !== null &&
        e.status >= 400 &&
        e.status < 500
      ) {
        status = 'failed';
        error =
          e.status === 409
            ? ERROR_STOCK_ILIMITADO
            : `HTTP ${e.status}: ${JSON.stringify(e.body ?? null).slice(0, 500)}`;
      } else if (e instanceof DomainError) {
        status = 'failed';
        error = e.message;
      } else {
        // Timeout, error de red, 5xx o respuesta no interpretable: no se sabe si se aplicó.
        status = 'needs_reconciliation';
        error = e instanceof HttpError || e instanceof SiwebValidationError ? e.message : String(e);
      }
    }
    await this.registrar(f, status, error, response, true);
    if (status !== 'sent') this.opts.log?.('outbox: operación no enviada', { id: f.id, status });
    return status;
  }

  /**
   * Envío del coste del proveedor (specs/016): obtiene el producto de la variante, identifica el proveedor de
   * Siweb360 del distribuidor y fija su coste con `PUT …/suppliers/{contact_id}`. Si no se puede identificar al
   * proveedor (o Siweb360 no responde a las consultas previas, que son de solo lectura) no se envía nada y la fila
   * queda en `needs_supplier`. Un 404 del `PUT` (contacto o producto inexistente) también.
   */
  private async enviarCosteProveedor(
    f: typeof outbox.$inferSelect,
  ): Promise<
    { response: unknown; sinProveedor?: undefined } | { sinProveedor: typeof ESTADO_SIN_PROVEEDOR }
  > {
    const p = f.payload as PayloadCosteProveedor;
    let productId: number;
    let contactId: number;
    let eraRecordado: boolean;
    try {
      productId = await this.productoDe(p.variant_id);
      const r = await resolverProveedor({ db: this.db, client: this.client }, p.distribuidor_id, productId);
      if ('motivo' in r) {
        await this.marcarSinProveedor(f, r.motivo, REINTENTO_PROVEEDOR_MS);
        return { sinProveedor: ESTADO_SIN_PROVEEDOR };
      }
      contactId = r.contactId;
      eraRecordado = r.origen === 'recordado';
    } catch (e) {
      if (e instanceof HttpError || e instanceof SiwebValidationError) {
        // Solo se ha leído: no se sabe nada del proveedor, pero tampoco se ha escrito nada. Se reintenta pronto.
        await this.marcarSinProveedor(f, ERROR_PROVEEDOR_SIN_RESPUESTA, REINTENTO_PROVEEDOR_RED_MS);
        return { sinProveedor: ESTADO_SIN_PROVEEDOR };
      }
      throw e;
    }
    await this.db
      .update(outbox)
      .set({ payload: { ...p, product_id: productId, contact_id: contactId } as never })
      .where(eq(outbox.id, f.id));
    try {
      const r = await this.client.actualizarCosteProveedor(productId, contactId, p.cost_cents);
      return { response: r };
    } catch (e) {
      if (e instanceof HttpError && e.kind === 'HTTP' && e.status === 404) {
        // El contacto recordado ya no existe (o el producto): se olvida para volver a buscarlo por CIF.
        if (eraRecordado)
          await this.db
            .update(distribuidor)
            .set({ siwebContactId: null })
            .where(eq(distribuidor.id, p.distribuidor_id));
        await this.marcarSinProveedor(f, 'PROVEEDOR_INEXISTENTE', REINTENTO_PROVEEDOR_MS);
        return { sinProveedor: ESTADO_SIN_PROVEEDOR };
      }
      throw e;
    }
  }

  /** `product_id` de una variante: del mapa CN↔variante si lo tiene; si no, de Siweb360 (y se guarda en el mapa). */
  private async productoDe(variantId: number): Promise<number> {
    const [m] = await this.db
      .select()
      .from(siwebVariantMap)
      .where(eq(siwebVariantMap.variantId, variantId))
      .limit(1);
    if (m?.productId != null) return m.productId;
    const v = await this.client.variant(variantId);
    if (v.product_id == null)
      throw new SiwebValidationError(`inventory/variants/${variantId}`, [
        'product_id: Siweb360 no lo indica',
      ]);
    if (m)
      await this.db
        .update(siwebVariantMap)
        .set({ productId: v.product_id })
        .where(eq(siwebVariantMap.id, m.id));
    return v.product_id;
  }

  private async marcarSinProveedor(
    f: typeof outbox.$inferSelect,
    motivo: MotivoProveedor | string,
    enMs: number,
  ) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(outbox)
        .set({
          status: ESTADO_SIN_PROVEEDOR,
          lastError: motivo,
          lockedAt: null,
          nextAttemptAt: new Date(this.now().getTime() + enMs),
        })
        .where(eq(outbox.id, f.id));
      await appendAudit(tx, {
        actor: 'outbox-dispatcher',
        accion: 'outbox_needs_supplier',
        entidad: 'outbox',
        entidadId: f.id,
        despues: { idempotencyKey: f.idempotencyKey, motivo },
      });
    });
    this.opts.log?.('outbox: coste de proveedor pendiente de proveedor en Siweb360', { id: f.id, motivo });
  }

  /**
   * Barrido de los costes de proveedor pendientes cuyo reintento ha vencido: vuelven a `pending` para que
   * `despachar` intente de nuevo identificar al proveedor. Devuelve cuántos reactivó.
   */
  async reintentarProveedoresPendientes(): Promise<number> {
    const r = await this.db
      .update(outbox)
      .set({ status: 'pending', lockedAt: null, nextAttemptAt: null })
      .where(
        and(
          eq(outbox.status, ESTADO_SIN_PROVEEDOR),
          eq(outbox.operation, OPERACION_ACTUALIZAR_COSTE_PROVEEDOR),
          lte(outbox.nextAttemptAt, this.now()),
        ),
      )
      .returning({ id: outbox.id });
    return r.length;
  }

  /**
   * Reactiva de inmediato los costes de proveedor pendientes de un distribuidor (al vincular su proveedor de Siweb360
   * en administración). Se envían una sola vez con el coste de su propia recepción.
   */
  async reactivarCosteProveedor(distribuidorId: string, actor: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const filas = await tx
        .select({ id: outbox.id })
        .from(outbox)
        .where(
          and(
            eq(outbox.status, ESTADO_SIN_PROVEEDOR),
            eq(outbox.operation, OPERACION_ACTUALIZAR_COSTE_PROVEEDOR),
            sql`${outbox.payload}->>'distribuidor_id' = ${distribuidorId}`,
          ),
        );
      if (!filas.length) return 0;
      await tx
        .update(outbox)
        .set({ status: 'pending', lockedAt: null, nextAttemptAt: null })
        .where(
          inArray(
            outbox.id,
            filas.map((x) => x.id),
          ),
        );
      await appendAudit(tx, {
        actor,
        accion: 'outbox_reactivar_coste_proveedor',
        entidad: 'distribuidor',
        entidadId: distribuidorId,
        despues: { reactivadas: filas.length },
      });
      return filas.length;
    });
  }

  /** Guarda el resultado de un envío: fila del outbox (si `guardarFila`), estado de la recepción y auditoría. */
  private async registrar(
    f: typeof outbox.$inferSelect,
    status: ResultadoEnvio,
    error: string | null,
    response: unknown,
    guardarFila: boolean,
  ) {
    await this.db.transaction(async (tx) => {
      if (guardarFila)
        await tx
          .update(outbox)
          .set({
            status,
            lastError: error,
            response: response as never,
            lockedAt: null,
            sentAt: status === 'sent' ? this.now() : null,
            nextAttemptAt:
              status === 'needs_reconciliation'
                ? new Date(this.now().getTime() + PRIMERA_VERIFICACION_MS)
                : null,
          })
          .where(eq(outbox.id, f.id));
      if (f.entidad === 'recepcion_linea' && f.entidadId && f.operation === OPERACION_ENTRADA)
        await this.actualizarRecepcion(tx, f.entidadId, status);
      await appendAudit(tx, {
        actor: 'outbox-dispatcher',
        accion: `outbox_${status}`,
        entidad: 'outbox',
        entidadId: f.id,
        despues: { idempotencyKey: f.idempotencyKey, status, error },
      });
    });
  }

  private async actualizarRecepcion(tx: DbOrTx, lineaId: string, status: ResultadoEnvio | 'resuelta') {
    const estadoLinea = status === 'sent' || status === 'resuelta' ? 'SINCRONIZADA' : 'ERROR';
    const [l] = await tx
      .update(recepcionLinea)
      .set({ estado: estadoLinea })
      .where(eq(recepcionLinea.id, lineaId))
      .returning({ recepcionId: recepcionLinea.recepcionId });
    if (!l) return;
    const lineas = await tx
      .select({ estado: recepcionLinea.estado, tipo: recepcionLinea.tipo })
      .from(recepcionLinea)
      .where(eq(recepcionLinea.recepcionId, l.recepcionId));
    const meds = lineas.filter((x) => x.tipo === 'medicamento');
    if (meds.some((x) => x.estado === 'ERROR')) {
      await tx
        .update(recepcion)
        .set({ estado: 'ERROR_SINCRONIZACION', syncEstado: 'ERROR' })
        .where(eq(recepcion.id, l.recepcionId));
    } else if (meds.every((x) => x.estado === 'SINCRONIZADA')) {
      await tx
        .update(recepcion)
        .set({ estado: 'SINCRONIZADA', syncEstado: 'SINCRONIZADA' })
        .where(eq(recepcion.id, l.recepcionId));
    }
  }

  /**
   * Comprueba los envíos dudosos contra el historial de movimientos de Siweb360 buscando su clave exacta en
   * `notes` (FR-005..007). Solo lee: nunca reenvía. Funciona aunque no haya prueba de escritura vigente.
   */
  async verificarDudosos(limite = 50): Promise<ResultadoVerificacion> {
    const r: ResultadoVerificacion = { verificadas: 0, noConsta: 0, duplicadas: 0 };
    const ahora = this.now();
    const filas = await this.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.status, 'needs_reconciliation'),
          eq(outbox.operation, OPERACION_ENTRADA),
          lte(outbox.nextAttemptAt, ahora),
        ),
      )
      .orderBy(asc(outbox.nextAttemptAt))
      .limit(limite);
    for (const f of filas) {
      const p = f.payload as AdjustmentRequest;
      let movs;
      try {
        movs = await this.client.movements({
          variant_id: p.variant_id,
          warehouse_id: p.warehouse_id,
          reason: 'purchase_receipt',
          date_from: diaMadrid(f.createdAt),
        });
      } catch {
        // Sin historial no se sabe nada: se reintenta la comprobación (no el envío) en la próxima pasada.
        continue;
      }
      const hits = movs.filter((m) => m.notes === f.idempotencyKey);
      if (hits.length === 1) {
        const mov = hits[0];
        await this.db.transaction(async (tx) => {
          await tx
            .update(outbox)
            .set({
              status: 'sent',
              sentAt: ahora,
              nextAttemptAt: null,
              lastError: null,
              response: { movimiento: mov } as never,
              resolvedBy: 'outbox-verificador',
              resolvedAt: ahora,
              resolution: `verificado en el historial de Siweb360 (movimiento ${mov?.id})`,
            })
            .where(and(eq(outbox.id, f.id), eq(outbox.status, 'needs_reconciliation')));
          if (f.entidad === 'recepcion_linea' && f.entidadId)
            await this.actualizarRecepcion(tx, f.entidadId, 'resuelta');
          await appendAudit(tx, {
            actor: 'outbox-verificador',
            accion: 'outbox_verificado_auto',
            entidad: 'outbox',
            entidadId: f.id,
            antes: { status: f.status },
            despues: { status: 'sent', idempotencyKey: f.idempotencyKey, movimientoId: mov?.id },
          });
        });
        r.verificadas++;
      } else if (hits.length === 0) {
        const n = f.verificaciones + 1;
        await this.db
          .update(outbox)
          .set({
            verificaciones: n,
            lastError: `No consta en Siweb360 a ${ahora.toISOString()}`,
            nextAttemptAt:
              n >= MAX_VERIFICACIONES ? null : new Date(ahora.getTime() + INTERVALO_VERIFICACION_MS),
          })
          .where(eq(outbox.id, f.id));
        r.noConsta++;
      } else {
        await this.db.transaction(async (tx) => {
          await tx
            .update(outbox)
            .set({
              verificaciones: f.verificaciones + 1,
              lastError: `Posible duplicado en Siweb360 (${hits.length} movimientos)`,
              nextAttemptAt: null,
            })
            .where(eq(outbox.id, f.id));
          await appendAudit(tx, {
            actor: 'outbox-verificador',
            accion: 'outbox_posible_duplicado',
            entidad: 'outbox',
            entidadId: f.id,
            despues: { idempotencyKey: f.idempotencyKey, movimientos: hits.map((m) => m.id) },
          });
        });
        r.duplicadas++;
      }
    }
    return r;
  }

  /**
   * Envía a petición expresa de administración una recepción finalizada con la escritura apagada
   * (specs/011, FR-013 y casos límite). Solo stock: el precio de entonces podría pisar uno más reciente.
   * Sigue sujeta a la prueba de escritura al despachar; nunca se hace sola.
   */
  async enviarRecepcionDesactivada(
    recepcionId: string,
    actor: string,
    nota: string,
  ): Promise<ResultadoEncolado> {
    if (this.cfg.modo === 'off') throw new DomainError('SIWEB_ESCRITURA_DESACTIVADA');
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(recepcion).where(eq(recepcion.id, recepcionId)).for('update');
      if (!r) throw new DomainError('NO_ENCONTRADO', 'Recepción no encontrada');
      if (r.syncEstado !== 'ESCRITURA_DESACTIVADA' || r.estado === 'ABIERTA' || r.estado === 'DESCARTADA') {
        throw new DomainError('CONFLICTO', 'Solo se envían recepciones finalizadas con la escritura apagada');
      }
      const res = await this.encolarRecepcion(tx, recepcionId, { sinPrecios: true });
      await appendAudit(tx, {
        actor,
        accion: 'recepcion_enviar_siweb_manual',
        entidad: 'recepcion',
        entidadId: recepcionId,
        antes: { syncEstado: r.syncEstado },
        despues: { encoladas: res.encoladas, pendientesAlta: res.pendientesAlta, nota },
      });
      return res;
    });
  }

  /**
   * Cierre de un envío en revisión o fallido por cualquier usuario de la app (specs/011, FR-008):
   *  - `revisado`: la persona comprueba en Siweb360 que el stock está bien → sent.
   *  - `resuelto_a_mano`: lo ha dado de alta a mano en Siweb360 → resolved_manually.
   * Reenviar y descartar siguen siendo de administración (`resolver`).
   */
  async cerrar(
    id: string,
    accion: 'revisado' | 'resuelto_a_mano',
    actor: string,
    nota: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [f] = await tx.select().from(outbox).where(eq(outbox.id, id)).for('update');
      if (!f || (f.status !== 'needs_reconciliation' && f.status !== 'failed')) {
        throw new DomainError('CONFLICTO', 'Solo se cierran operaciones en revisión o fallidas');
      }
      const status = accion === 'revisado' ? 'sent' : 'resolved_manually';
      await tx
        .update(outbox)
        .set({
          status,
          resolvedBy: actor,
          resolvedAt: this.now(),
          resolution: `${accion}: ${nota}`,
          nextAttemptAt: null,
          lockedAt: null,
        })
        .where(eq(outbox.id, id));
      if (f.entidad === 'recepcion_linea' && f.entidadId && f.operation === OPERACION_ENTRADA)
        await this.actualizarRecepcion(tx, f.entidadId, 'resuelta');
      await appendAudit(tx, {
        actor,
        accion: `outbox_cerrar_${accion}`,
        entidad: 'outbox',
        entidadId: id,
        antes: { status: f.status },
        despues: { status, nota },
      });
    });
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
  async resolver(
    id: string,
    accion: 'confirmar_aplicada' | 'reenviar' | 'descartar',
    actor: string,
    nota: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [f] = await tx.select().from(outbox).where(eq(outbox.id, id)).for('update');
      if (!f || (f.status !== 'needs_reconciliation' && f.status !== 'failed')) {
        throw new DomainError('CONFLICTO', 'Solo se resuelven operaciones en reconciliación o fallidas');
      }
      const status = accion === 'confirmar_aplicada' ? 'sent' : accion === 'reenviar' ? 'pending' : 'failed';
      await tx
        .update(outbox)
        .set({
          status,
          resolvedBy: actor,
          resolvedAt: this.now(),
          resolution: `${accion}: ${nota}`,
          lockedAt: null,
          nextAttemptAt: null,
        })
        .where(eq(outbox.id, id));
      if (accion === 'confirmar_aplicada' && f.entidad === 'recepcion_linea' && f.entidadId)
        await this.actualizarRecepcion(tx, f.entidadId, 'resuelta');
      await appendAudit(tx, {
        actor,
        accion: `outbox_resolver_${accion}`,
        entidad: 'outbox',
        entidadId: id,
        antes: { status: f.status },
        despues: { status, nota },
      });
    });
  }
}
