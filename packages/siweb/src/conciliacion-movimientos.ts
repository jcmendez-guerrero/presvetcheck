import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import {
  appendAudit,
  cimavetPresentacion,
  conciliacion,
  dispensacion,
  movimientoJustificacion,
  recepcionLinea,
  siwebMovimiento,
  siwebVariantMap,
  type Db,
} from '@mmx/db';
import { conciliarMovimientos, exigirMotivoCompatible, type MovimientoSiweb } from '@mmx/domain';
import { DomainError, diaMadrid, horaMadridAUtc, type JustificarMovimientoBody } from '@mmx/shared';
import type { SiwebClient } from './client';

/**
 * Conciliación de los movimientos de medicamentos de Siweb360 (specs/011, FR-009). Cada noche, tras la
 * conciliación de ventas, se lee el historial desde la fecha de corte, se guarda (solo inserción) y se vinculan
 * solos los movimientos que tienen pareja en la app; el resto queda en la bandeja «Movimientos sin justificar».
 */

const CLAVE_RECEPCION = /^MMX-REC-([0-9a-f-]{36})-L(\d+)$/;
const DIA_MS = 24 * 3600_000;

type Justificacion = typeof movimientoJustificacion.$inferSelect;

export interface ResultadoConciliacionMovimientosDia {
  leidos: number;
  nuevos: number;
  vinculados: number;
  sinJustificar: number;
}

export async function conciliarMovimientosDia(
  db: Db,
  client: SiwebClient,
  o: { corte: string | undefined; almacenId: number; ahora: Date },
): Promise<ResultadoConciliacionMovimientosDia | { inactivo: string }> {
  if (!o.corte) return { inactivo: 'sin fecha de corte (ENTRY_CUTOVER_DATE)' };
  const corte = horaMadridAUtc(o.corte);
  // Se relee desde el día anterior al último movimiento guardado (por si llegó tarde); nunca antes del corte.
  const [ultimo] = await db
    .select({ at: siwebMovimiento.createdAtSiweb })
    .from(siwebMovimiento)
    .orderBy(desc(siwebMovimiento.createdAtSiweb))
    .limit(1);
  const desde = ultimo
    ? diaMadrid(new Date(Math.max(corte.getTime(), ultimo.at.getTime() - DIA_MS)))
    : o.corte;
  const leidos = await client.movements({
    warehouse_id: o.almacenId,
    date_from: desde,
    date_to: diaMadrid(o.ahora),
  });
  const cnDe = new Map((await db.select().from(siwebVariantMap)).map((m) => [m.variantId, m.cn]));
  let nuevos = 0;
  for (const m of leidos) {
    // Solo el almacén configurado, aunque la API ignorase el filtro.
    if (m.warehouse_id !== o.almacenId || !m.created_at) continue;
    const ins = await db
      .insert(siwebMovimiento)
      .values({
        id: m.id,
        variantId: m.variant_id,
        cn: cnDe.get(m.variant_id) ?? null,
        warehouseId: m.warehouse_id,
        quantity: m.quantity,
        reason: m.reason,
        referenceType: m.reference_type ?? null,
        referenceId: m.reference_id,
        referenceNumber: m.reference_number ?? null,
        batchNumber: m.batch_number ?? null,
        expiryDate: m.expiry_date?.slice(0, 10) ?? null,
        notes: m.notes ?? null,
        createdAtSiweb: horaMadridAUtc(m.created_at),
        leidoAt: o.ahora,
      })
      .onConflictDoNothing()
      .returning({ id: siwebMovimiento.id });
    nuevos += ins.length;
  }

  // Candidatos: medicamentos guardados desde el corte que aún no tienen vínculo ni justificación.
  // shortcut: relee todos los pendientes desde el corte cada noche; basta para cientos por semana, paginar si crece.
  const guardados = await db
    .select()
    .from(siwebMovimiento)
    .where(and(isNotNull(siwebMovimiento.cn), gte(siwebMovimiento.createdAtSiweb, corte)));
  const conJustificacion = await justificacionesVigentes(
    db,
    guardados.map((g) => g.id),
  );
  const pendientes = guardados.filter((g) => !conJustificacion.has(g.id));

  const recepciones = [
    ...new Set(
      pendientes.map((p) => CLAVE_RECEPCION.exec(p.notes ?? '')?.[1]).filter((x): x is string => !!x),
    ),
  ];
  const lineasRecepcion = new Map<string, string>();
  if (recepciones.length) {
    for (const l of await db
      .select({
        id: recepcionLinea.id,
        recepcionId: recepcionLinea.recepcionId,
        numero: recepcionLinea.numero,
      })
      .from(recepcionLinea)
      .where(inArray(recepcionLinea.recepcionId, recepciones)))
      lineasRecepcion.set(`MMX-REC-${l.recepcionId}-L${l.numero}`, l.id);
  }
  const tickets = [...new Set(pendientes.map((p) => p.referenceId).filter((x): x is string => !!x))];
  const ventas = tickets.length
    ? (
        await db
          .select({
            movimientoId: conciliacion.movimientoId,
            cn: dispensacion.cn,
            dispensacionId: dispensacion.id,
          })
          .from(conciliacion)
          .innerJoin(dispensacion, eq(dispensacion.id, conciliacion.dispensacionId))
          .where(inArray(sql<string>`split_part(${conciliacion.movimientoId}, ':', 1)`, tickets))
      ).map((v) => ({
        ticketId: v.movimientoId.split(':')[0] ?? '',
        cn: v.cn,
        dispensacionId: v.dispensacionId,
      }))
    : [];

  const movs: MovimientoSiweb[] = pendientes.map((p) => ({
    id: p.id,
    variantId: p.variantId,
    cn: p.cn,
    warehouseId: p.warehouseId,
    quantity: p.quantity,
    reason: p.reason,
    referenceId: p.referenceId,
    notes: p.notes,
    fecha: p.createdAtSiweb,
  }));
  const r = conciliarMovimientos(movs, {
    corte,
    almacenId: o.almacenId,
    lineasRecepcion,
    ventas,
    yaJustificados: new Set(),
  });
  if (r.vinculados.length)
    await db.insert(movimientoJustificacion).values(
      r.vinculados.map((v) => ({
        movimientoId: v.movimientoId,
        tipo: v.tipo,
        recepcionLineaId: v.tipo === 'AUTO_RECEPCION' ? v.recepcionLineaId : null,
        dispensacionId: v.tipo === 'AUTO_VENTA' ? v.dispensacionId : null,
        actor: 'sales-reconciliation',
        at: o.ahora,
      })),
    );
  return {
    leidos: leidos.length,
    nuevos,
    vinculados: r.vinculados.length,
    sinJustificar: r.sinJustificar.length,
  };
}

/** Justificaciones vigentes (no sustituidas por otra) de unos movimientos. */
export async function justificacionesVigentes(db: Db, ids: number[]): Promise<Map<number, Justificacion>> {
  if (!ids.length) return new Map();
  const todas = await db
    .select()
    .from(movimientoJustificacion)
    .where(inArray(movimientoJustificacion.movimientoId, ids));
  return vigentesDe(todas);
}

function vigentesDe(todas: Justificacion[]): Map<number, Justificacion> {
  const sustituidas = new Set(todas.map((j) => j.sustituyeA).filter(Boolean));
  return new Map(todas.filter((j) => !sustituidas.has(j.id)).map((j) => [j.movimientoId, j]));
}

/** Fila de la bandeja de movimientos, con la justificación vigente si la hay. */
export interface MovimientoBandeja {
  id: number;
  fecha: Date;
  cn: string | null;
  nombre: string | null;
  lote: string | null;
  caducidad: string | null;
  unidades: number;
  motivoSiweb: string;
  referencia: string | null;
  justificacion: Justificacion | null;
}

/** Movimientos de medicamentos desde el corte (y opcionalmente entre `desde` y `hasta`), con o sin justificar. */
export async function listarMovimientos(
  db: Db,
  o: {
    corte: string;
    estado: 'sin_justificar' | 'justificados';
    desde?: string | undefined;
    hasta?: string | undefined;
  },
): Promise<MovimientoBandeja[]> {
  const corte = horaMadridAUtc(o.corte);
  const inicio = o.desde && horaMadridAUtc(o.desde) > corte ? horaMadridAUtc(o.desde) : corte;
  const filas = await db
    .select({ m: siwebMovimiento, nombre: cimavetPresentacion.nombre })
    .from(siwebMovimiento)
    .leftJoin(cimavetPresentacion, eq(cimavetPresentacion.cn, siwebMovimiento.cn))
    .where(
      and(
        isNotNull(siwebMovimiento.cn),
        gte(siwebMovimiento.createdAtSiweb, inicio),
        o.hasta
          ? lt(siwebMovimiento.createdAtSiweb, new Date(horaMadridAUtc(o.hasta).getTime() + DIA_MS))
          : undefined,
      ),
    )
    .orderBy(siwebMovimiento.createdAtSiweb);
  const vigentes = await justificacionesVigentes(
    db,
    filas.map((f) => f.m.id),
  );
  return filas
    .filter((f) => (o.estado === 'sin_justificar') === !vigentes.has(f.m.id))
    .map(({ m, nombre }) => ({
      id: m.id,
      fecha: m.createdAtSiweb,
      cn: m.cn,
      nombre,
      lote: m.batchNumber,
      caducidad: m.expiryDate,
      unidades: m.quantity,
      motivoSiweb: m.reason,
      referencia: m.referenceNumber ?? m.referenceId,
      justificacion: vigentes.get(m.id) ?? null,
    }));
}

export const movimientosSinJustificar = (db: Db, o: { corte: string }) =>
  listarMovimientos(db, { corte: o.corte, estado: 'sin_justificar' });

/**
 * Cierra un movimiento sin pareja: lo vincula a una línea de recepción o a una dispensación, o lo justifica con
 * un motivo (FR-009b). Nunca edita: si ya tenía una justificación vigente, la nueva la sustituye.
 */
export async function justificarMovimiento(
  db: Db,
  movimientoId: number,
  body: JustificarMovimientoBody,
  actor: string,
  ahora: Date,
): Promise<Justificacion> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(siwebMovimiento)
      .where(eq(siwebMovimiento.id, movimientoId))
      .for('update');
    if (!m) throw new DomainError('NO_ENCONTRADO', 'Movimiento de Siweb360 no encontrado');
    if (body.tipo === 'MOTIVO') exigirMotivoCompatible(body.motivo, m.quantity);
    if (body.tipo === 'VINCULO_RECEPCION') {
      const [l] = await tx
        .select({ id: recepcionLinea.id })
        .from(recepcionLinea)
        .where(eq(recepcionLinea.id, body.recepcionLineaId));
      if (!l) throw new DomainError('NO_ENCONTRADO', 'Línea de recepción no encontrada');
    }
    if (body.tipo === 'VINCULO_DISPENSACION') {
      const [d] = await tx
        .select({ id: dispensacion.id })
        .from(dispensacion)
        .where(eq(dispensacion.id, body.dispensacionId));
      if (!d) throw new DomainError('NO_ENCONTRADO', 'Dispensación no encontrada');
    }
    const todas = await tx
      .select()
      .from(movimientoJustificacion)
      .where(eq(movimientoJustificacion.movimientoId, movimientoId));
    const vigente = vigentesDe(todas).get(movimientoId) ?? null;
    const [nueva] = await tx
      .insert(movimientoJustificacion)
      .values({
        movimientoId,
        tipo: body.tipo,
        recepcionLineaId: body.tipo === 'VINCULO_RECEPCION' ? body.recepcionLineaId : null,
        dispensacionId: body.tipo === 'VINCULO_DISPENSACION' ? body.dispensacionId : null,
        motivo: body.tipo === 'MOTIVO' ? body.motivo : null,
        nota: body.nota,
        sustituyeA: vigente?.id ?? null,
        actor,
        at: ahora,
      })
      .returning();
    if (!nueva) throw new Error('No se pudo guardar la justificación');
    await appendAudit(tx, {
      actor,
      accion: 'movimiento_justificar',
      entidad: 'siweb_movimiento',
      entidadId: String(movimientoId),
      antes: vigente ? { justificacionId: vigente.id, tipo: vigente.tipo, motivo: vigente.motivo } : null,
      despues: { justificacionId: nueva.id, tipo: nueva.tipo, motivo: nueva.motivo, nota: nueva.nota },
    });
    return nueva;
  });
}
