import { DomainError, motivoEncaja, type MotivoJustificacion } from '@mmx/shared';

/**
 * Conciliación de los movimientos de stock de Siweb360 con los registros de la app (specs/011, FR-009).
 * Desde la fecha de corte, cada movimiento de un medicamento debe quedar vinculado a una línea de recepción o a
 * una dispensación, o justificado por una persona. Función pura: los datos llegan ya leídos.
 */

export interface MovimientoSiweb {
  id: number;
  variantId: number;
  /** CN del mapeo de la variante; null → no es un medicamento mapeado. */
  cn: string | null;
  warehouseId: number | null;
  /** >0 entrada, <0 salida. */
  quantity: number;
  reason: string;
  referenceId: string | null;
  notes: string | null;
  /** Instante del movimiento (UTC). */
  fecha: Date;
}

/** Venta ya conciliada ticket ↔ dispensación (conciliación de la spec 003). */
export interface VentaConciliada {
  ticketId: string;
  cn: string;
  dispensacionId: string;
}

export interface ContextoConciliacionMovimientos {
  /** Inicio del día de corte en Europe/Madrid, como instante UTC. */
  corte: Date;
  almacenId: number;
  /** Clave `MMX-REC-{recepción}-L{n}` → id de la línea de recepción. */
  lineasRecepcion: ReadonlyMap<string, string>;
  ventas: readonly VentaConciliada[];
  /** Movimientos que ya tienen un vínculo o una justificación vigente. */
  yaJustificados: ReadonlySet<number>;
}

export type VinculoAutomatico =
  | { movimientoId: number; tipo: 'AUTO_RECEPCION'; recepcionLineaId: string }
  | { movimientoId: number; tipo: 'AUTO_VENTA'; dispensacionId: string };

export type MotivoIgnorado = 'NO_MEDICAMENTO' | 'OTRO_ALMACEN' | 'ANTERIOR_AL_CORTE' | 'YA_JUSTIFICADO';

export interface ResultadoConciliacionMovimientos {
  vinculados: VinculoAutomatico[];
  sinJustificar: number[];
  ignorados: Array<{ movimientoId: number; motivo: MotivoIgnorado }>;
}

export function conciliarMovimientos(
  movimientos: readonly MovimientoSiweb[],
  c: ContextoConciliacionMovimientos,
): ResultadoConciliacionMovimientos {
  const r: ResultadoConciliacionMovimientos = { vinculados: [], sinJustificar: [], ignorados: [] };
  for (const m of movimientos) {
    const ignorar = (motivo: MotivoIgnorado) => r.ignorados.push({ movimientoId: m.id, motivo });
    if (m.cn === null) {
      ignorar('NO_MEDICAMENTO');
      continue;
    }
    if (m.warehouseId !== c.almacenId) {
      ignorar('OTRO_ALMACEN');
      continue;
    }
    if (m.fecha.getTime() < c.corte.getTime()) {
      ignorar('ANTERIOR_AL_CORTE');
      continue;
    }
    if (c.yaJustificados.has(m.id)) {
      ignorar('YA_JUSTIFICADO');
      continue;
    }
    // Entrada enviada por la app: su nota es exactamente la clave de la línea (sin tocar).
    const linea = m.quantity > 0 && m.notes !== null ? c.lineasRecepcion.get(m.notes) : undefined;
    if (linea !== undefined) {
      r.vinculados.push({ movimientoId: m.id, tipo: 'AUTO_RECEPCION', recepcionLineaId: linea });
      continue;
    }
    // Venta del TPV cuyo ticket ya está conciliado con una dispensación del mismo CN.
    // TODO(decision D-02b): confirmar con movimientos reales que `reference_id` es el id del ticket.
    const venta =
      m.quantity < 0 && m.referenceId !== null
        ? c.ventas.find((v) => v.ticketId === m.referenceId && v.cn === m.cn)
        : undefined;
    if (venta !== undefined) {
      r.vinculados.push({ movimientoId: m.id, tipo: 'AUTO_VENTA', dispensacionId: venta.dispensacionId });
      continue;
    }
    r.sinJustificar.push(m.id);
  }
  return r;
}

/** Lanza `MOTIVO_INCOMPATIBLE` si el motivo no encaja con el sentido del movimiento. */
export function exigirMotivoCompatible(motivo: MotivoJustificacion, unidades: number): void {
  if (!motivoEncaja(motivo, unidades)) {
    throw new DomainError(
      'MOTIVO_INCOMPATIBLE',
      `El motivo ${motivo} no encaja con un movimiento de ${unidades} unidades`,
    );
  }
}
