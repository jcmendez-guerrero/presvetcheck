import { diasEntre, type FechaIso } from './fechas';
import type { Incidencia } from './tipos';
import { severidadDe, type PoliticaSeveridad } from './severidad';

/**
 * Conciliación ticket ↔ dispensación (SPEC §5.2.4, job sales-reconciliation). Compara las
 * dispensaciones del día con las ventas de Siweb360 por CN + lote + unidades. Las líneas de ticket de
 * Siweb360 no traen lote (`lote: null`): entonces se concilia por CN + unidades y la conciliación se
 * marca con el lote sin verificar.
 */
export interface DispensacionConciliar {
  id: string;
  cn: string;
  lote: string;
  unidades: number;
  fecha: FechaIso;
}

export interface MovimientoVenta {
  id: string;
  /** Variante de Siweb360 si la fuente la da (las líneas de ticket no la traen). */
  variantId: number | null;
  /** CN (de la línea o de siweb_variant_map); null si no es un medicamento identificable. */
  cn: string | null;
  /** null = la fuente no informa el lote (no verificable). */
  lote: string | null;
  /** Número de ticket, si se conoce (para mostrarlo en la discrepancia). */
  ticket?: string;
  unidades: number;
  fecha: FechaIso;
}

export type TipoDiscrepancia =
  'DISPENSACION_SIN_TICKET' | 'TICKET_SIN_DISPENSACION' | 'LOTE_DISTINTO' | 'UNIDADES_DISTINTAS';

export interface Discrepancia {
  tipo: TipoDiscrepancia;
  dispensacionId: string | null;
  movimientoId: string | null;
  cn: string | null;
  loteDispensacion: string | null;
  loteTicket: string | null;
  unidadesDispensacion: number | null;
  unidadesTicket: number | null;
  ticket: string | null;
}

export interface ResultadoConciliacion {
  conciliadas: { dispensacionId: string; movimientoId: string; loteVerificado: boolean }[];
  discrepancias: Discrepancia[];
}

export function conciliar(
  dispensaciones: DispensacionConciliar[],
  movimientos: MovimientoVenta[],
): ResultadoConciliacion {
  const pendD = [...dispensaciones];
  const pendM = movimientos.filter((m) => m.cn !== null);
  const conciliadas: ResultadoConciliacion['conciliadas'] = [];
  const discrepancias: Discrepancia[] = [];
  const take = <T>(arr: T[], pred: (x: T) => boolean): T | undefined => {
    const i = arr.findIndex(pred);
    return i >= 0 ? arr.splice(i, 1)[0] : undefined;
  };
  const disc = (
    tipo: TipoDiscrepancia,
    d: DispensacionConciliar | null,
    m: MovimientoVenta | null,
  ): Discrepancia => ({
    tipo,
    dispensacionId: d?.id ?? null,
    movimientoId: m?.id ?? null,
    cn: d?.cn ?? m?.cn ?? null,
    loteDispensacion: d?.lote ?? null,
    loteTicket: m?.lote ?? null,
    ticket: m?.ticket ?? null,
    unidadesDispensacion: d?.unidades ?? null,
    unidadesTicket: m?.unidades ?? null,
  });

  // 1. Coincidencia exacta (con lote informado)
  for (const d of [...pendD]) {
    const m = take(pendM, (x) => x.cn === d.cn && x.lote === d.lote && x.unidades === d.unidades);
    if (m) {
      conciliadas.push({ dispensacionId: d.id, movimientoId: m.id, loteVerificado: true });
      pendD.splice(pendD.indexOf(d), 1);
    }
  }
  // 1b. Fuente sin lote: CN + unidades, lote sin verificar
  for (const d of [...pendD]) {
    const m = take(pendM, (x) => x.lote === null && x.cn === d.cn && x.unidades === d.unidades);
    if (m) {
      conciliadas.push({ dispensacionId: d.id, movimientoId: m.id, loteVerificado: false });
      pendD.splice(pendD.indexOf(d), 1);
    }
  }
  // 2. Mismo CN y lote (o lote no informado), unidades distintas
  for (const d of [...pendD]) {
    const m = take(pendM, (x) => x.cn === d.cn && (x.lote === d.lote || x.lote === null));
    if (m) {
      discrepancias.push(disc('UNIDADES_DISTINTAS', d, m));
      pendD.splice(pendD.indexOf(d), 1);
    }
  }
  // 3. Mismo CN, lote distinto (el empleado eligió otro lote en el TPV)
  for (const d of [...pendD]) {
    const m = take(pendM, (x) => x.cn === d.cn);
    if (m) {
      discrepancias.push(disc('LOTE_DISTINTO', d, m));
      pendD.splice(pendD.indexOf(d), 1);
    }
  }
  for (const d of pendD) discrepancias.push(disc('DISPENSACION_SIN_TICKET', d, null));
  for (const m of pendM) discrepancias.push(disc('TICKET_SIN_DISPENSACION', null, m));
  return { conciliadas, discrepancias };
}

export interface VinculacionTicketExistente {
  ticketId: string;
  ticketNumero: string;
  recetaId: string;
  estado: 'vinculado' | 'confirmado';
}

export interface ResultadoValidacionVinculacion {
  valido: boolean;
  error?: 'RECETA_YA_VINCULADA' | 'TICKET_YA_FINALIZADO' | 'NO_ENCONTRADO';
}

/**
 * Valida si se puede asociar una receta a un ticket (specs/004-multi-rx-ticket-training-mode, D-11).
 * Reglas:
 * 1. Una receta solo puede estar asociada a un único ticket (recetaId única).
 * 2. No se puede añadir recetas a un ticket ya confirmado.
 */
export function validarVinculacionTicket(p: {
  ticketId: string;
  recetaId: string;
  existentes: VinculacionTicketExistente[];
}): ResultadoValidacionVinculacion {
  // Comprobar si la receta ya está vinculada a este o a otro ticket
  const yaVinculada = p.existentes.find((x) => x.recetaId === p.recetaId);
  if (yaVinculada) {
    return { valido: false, error: 'RECETA_YA_VINCULADA' };
  }

  // Comprobar si el ticket destino ya está confirmado
  const ticketConfirmado = p.existentes.find((x) => x.ticketId === p.ticketId && x.estado === 'confirmado');
  if (ticketConfirmado) {
    return { valido: false, error: 'TICKET_YA_FINALIZADO' };
  }

  return { valido: true };
}

/**
 * Valida si se puede desvincular una receta de un ticket.
 * Regla: solo se permite si el ticket no ha sido confirmado (estado = 'vinculado').
 */
export function validarDesvinculacionTicket(p: {
  ticketId: string;
  recetaId: string;
  existentes: VinculacionTicketExistente[];
}): ResultadoValidacionVinculacion {
  const match = p.existentes.find((x) => x.ticketId === p.ticketId && x.recetaId === p.recetaId);
  if (!match) {
    return { valido: false, error: 'NO_ENCONTRADO' };
  }
  if (match.estado === 'confirmado') {
    return { valido: false, error: 'TICKET_YA_FINALIZADO' };
  }
  return { valido: true };
}

export interface MovimientoStockSimple {
  id: number;
  variantId: number;
  quantity: number;
  reason: string;
  date: string;
}

export interface ResultadoEvaluacionRetrospectiva {
  estado: 'OK' | 'MOVIMIENTO_PARCIAL' | 'SIN_MOVIMIENTO';
  unidadesEncontradas: number;
  unidadesRequeridas: number;
  incidencias: Incidencia[];
}

/**
 * Evalúa los movimientos históricos de stock de Siweb360 para dispensación en modo retrospectivo (D-14).
 */
export function evaluarMovimientosRetrospectivos(p: {
  cn: string;
  fechaOriginal: FechaIso;
  hoy: FechaIso;
  maxAgeDays?: number;
  unidadesRequeridas: number;
  movimientos: MovimientoStockSimple[];
  pol?: PoliticaSeveridad;
}): ResultadoEvaluacionRetrospectiva {
  const incidencias: Incidencia[] = [];
  const maxDias = p.maxAgeDays ?? 90;

  // Comprobar antigüedad
  const dias = diasEntre(p.fechaOriginal, p.hoy);
  if (dias > maxDias) {
    incidencias.push({
      code: 'AVISO_FECHA_RETROSPECTIVA_ANTIGUA',
      severidad: 'AVISO',
      ambito: 'receta',
      params: { dias: maxDias },
    });
  }

  // Filtrar movimientos de venta
  const ventas = p.movimientos.filter((m) => m.reason === 'sale_shipment' && m.quantity < 0);

  const unidadesEncontradas = ventas.reduce((acc, m) => acc + Math.abs(m.quantity), 0);

  let estado: ResultadoEvaluacionRetrospectiva['estado'];
  if (unidadesEncontradas >= p.unidadesRequeridas) {
    estado = 'OK';
  } else if (unidadesEncontradas > 0) {
    estado = 'MOVIMIENTO_PARCIAL';
    incidencias.push({
      code: 'SIN_MOVIMIENTO_STOCK_RETROSPECTIVO',
      severidad: p.pol ? severidadDe('SIN_MOVIMIENTO_STOCK_RETROSPECTIVO', p.pol) : 'BLOQUEANTE_FORMA',
      ambito: 'receta',
      params: {
        cn: p.cn,
        fecha: p.fechaOriginal,
        encontradas: unidadesEncontradas,
        requeridas: p.unidadesRequeridas,
      },
    });
  } else {
    estado = 'SIN_MOVIMIENTO';
    incidencias.push({
      code: 'SIN_MOVIMIENTO_STOCK_RETROSPECTIVO',
      severidad: p.pol ? severidadDe('SIN_MOVIMIENTO_STOCK_RETROSPECTIVO', p.pol) : 'BLOQUEANTE_FORMA',
      ambito: 'receta',
      params: { cn: p.cn, fecha: p.fechaOriginal, encontradas: 0, requeridas: p.unidadesRequeridas },
    });
  }

  return {
    estado,
    unidadesEncontradas,
    unidadesRequeridas: p.unidadesRequeridas,
    incidencias,
  };
}

export interface LineaTicketItem {
  lineaId?: string | number;
  cn: string;
  nombre: string;
  unidades: number;
}

export interface DispensacionMultiRx {
  id: string;
  recetaId: string;
  cn: string;
  nombreFarmaco: string;
  unidades: number;
}

export interface LineaResumenConciliacion {
  cn: string;
  nombre: string;
  unidadesTicket: number;
  unidadesDispensadasTotal: number;
  estadoLinea: 'COINCIDE' | 'DEFICIT_TICKET' | 'EXCESO_DISPENSADO' | 'SIN_DISPENSACION';
}

export interface ResultadoConciliacionMultiReceta {
  lineas: LineaResumenConciliacion[];
  puedeConfirmar: boolean;
  bloqueos: string[];
}

/**
 * Reconciliación de un ticket frente a múltiples recetas vinculadas (D-11, US3).
 * Bloquea la confirmación si las unidades dispensadas superan las unidades del ticket por CN.
 */
export function conciliarTicketMultiReceta(p: {
  ticketItems: LineaTicketItem[];
  dispensaciones: DispensacionMultiRx[];
}): ResultadoConciliacionMultiReceta {
  const lineas: LineaResumenConciliacion[] = [];
  const bloqueos: string[] = [];

  if (p.dispensaciones.length === 0) {
    return {
      lineas: p.ticketItems.map((t) => ({
        cn: t.cn,
        nombre: t.nombre,
        unidadesTicket: t.unidades,
        unidadesDispensadasTotal: 0,
        estadoLinea: 'SIN_DISPENSACION',
      })),
      puedeConfirmar: false,
      bloqueos: ['No hay dispensaciones vinculadas al ticket'],
    };
  }

  // Agrupar unidades del ticket por CN
  const ticketMap = new Map<string, { nombre: string; unidades: number }>();
  for (const t of p.ticketItems) {
    const prev = ticketMap.get(t.cn);
    if (prev) {
      prev.unidades += t.unidades;
    } else {
      ticketMap.set(t.cn, { nombre: t.nombre, unidades: t.unidades });
    }
  }

  // Agrupar unidades dispensadas por CN
  const dispMap = new Map<string, { nombre: string; unidades: number }>();
  for (const d of p.dispensaciones) {
    const prev = dispMap.get(d.cn);
    if (prev) {
      prev.unidades += d.unidades;
    } else {
      dispMap.set(d.cn, { nombre: d.nombreFarmaco, unidades: d.unidades });
    }
  }

  const allCns = new Set([...ticketMap.keys(), ...dispMap.keys()]);

  for (const cn of allCns) {
    const t = ticketMap.get(cn);
    const d = dispMap.get(cn);
    const uTicket = t?.unidades ?? 0;
    const uDisp = d?.unidades ?? 0;
    const nombre = t?.nombre ?? d?.nombre ?? `Medicamento ${cn}`;

    let estadoLinea: LineaResumenConciliacion['estadoLinea'];
    if (uDisp === uTicket) {
      estadoLinea = 'COINCIDE';
    } else if (uDisp > uTicket) {
      estadoLinea = 'EXCESO_DISPENSADO';
      bloqueos.push(
        `EXCESO_DISPENSADO: Se han dispensado ${uDisp} unidades de CN ${cn} pero el ticket solo ampara ${uTicket}.`,
      );
    } else if (uDisp > 0) {
      estadoLinea = 'DEFICIT_TICKET';
    } else {
      estadoLinea = 'SIN_DISPENSACION';
    }

    lineas.push({
      cn,
      nombre,
      unidadesTicket: uTicket,
      unidadesDispensadasTotal: uDisp,
      estadoLinea,
    });
  }

  const puedeConfirmar = bloqueos.length === 0 && p.dispensaciones.length > 0;

  return {
    lineas,
    puedeConfirmar,
    bloqueos,
  };
}
