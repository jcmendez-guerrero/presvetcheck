import type { FechaIso } from './fechas';

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
  | 'DISPENSACION_SIN_TICKET'
  | 'TICKET_SIN_DISPENSACION'
  | 'LOTE_DISTINTO'
  | 'UNIDADES_DISTINTAS';

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
