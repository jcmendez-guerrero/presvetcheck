import { comparar, fechaEs, sumarDias, type FechaIso } from './fechas';
import type { LoteStock } from './tipos';

/**
 * Selección de lote FEFO (SPEC §4.5): primero el que caduca antes. Siweb360 devuelve los lotes
 * por fecha de creación, así que el orden se calcula aquí.
 */

export interface AvisoFefo {
  code: 'LOTE_CADUCA_ANTES_FIN_TRATAMIENTO' | 'LOTE_SIN_CADUCIDAD' | 'STOCK_INSUFICIENTE';
  params: Record<string, string | number>;
}

export interface ResultadoFefo {
  recomendado: LoteStock | null;
  /** Reparto entre lotes en orden FEFO si la cantidad supera el primer lote. */
  reparto: { lote: string; unidades: number; caducidad: FechaIso | null; variantId: number }[];
  /** Si el recomendado caduca antes de terminar el tratamiento, el primero que lo cubre. */
  alternativaQueCubre: LoteStock | null;
  avisos: AvisoFefo[];
  excluidos: { lote: string; motivo: 'CADUCADO' | 'SIN_DISPONIBLE' }[];
  disponibleTotal: number;
  ordenados: LoteStock[];
}

export function ordenarFefo(lotes: LoteStock[]): LoteStock[] {
  return [...lotes].sort((a, b) => {
    if (a.caducidad === null && b.caducidad !== null) return 1;
    if (a.caducidad !== null && b.caducidad === null) return -1;
    if (a.caducidad !== null && b.caducidad !== null) {
      const c = comparar(a.caducidad, b.caducidad);
      if (c !== 0) return c;
    }
    // Empate → el lote creado antes
    return (a.creadoAt ?? '').localeCompare(b.creadoAt ?? '');
  });
}

export function proponerLotes(input: {
  lotes: LoteStock[];
  unidades: number;
  hoy: FechaIso;
  duracionDias: number | null;
}): ResultadoFefo {
  const excluidos: ResultadoFefo['excluidos'] = [];
  const validos: LoteStock[] = [];
  for (const l of input.lotes) {
    if (l.disponible <= 0) excluidos.push({ lote: l.lote, motivo: 'SIN_DISPONIBLE' });
    else if (l.caducidad !== null && comparar(l.caducidad, input.hoy) < 0) excluidos.push({ lote: l.lote, motivo: 'CADUCADO' });
    else validos.push(l);
  }
  const ordenados = ordenarFefo(validos);
  const disponibleTotal = ordenados.reduce((s, l) => s + l.disponible, 0);
  const recomendado = ordenados[0] ?? null;
  const avisos: AvisoFefo[] = [];
  let alternativaQueCubre: LoteStock | null = null;

  if (recomendado && input.duracionDias !== null && input.duracionDias > 0 && recomendado.caducidad !== null) {
    const finTratamiento = sumarDias(input.hoy, input.duracionDias);
    if (comparar(recomendado.caducidad, finTratamiento) < 0) {
      avisos.push({
        code: 'LOTE_CADUCA_ANTES_FIN_TRATAMIENTO',
        params: { lote: recomendado.lote, fecha: fechaEs(recomendado.caducidad) },
      });
      alternativaQueCubre =
        ordenados.find((l) => l.caducidad === null || comparar(l.caducidad, finTratamiento) >= 0) ?? null;
    }
  }

  const reparto: ResultadoFefo['reparto'] = [];
  let pendiente = input.unidades;
  for (const l of ordenados) {
    if (pendiente <= 0) break;
    const u = Math.min(pendiente, l.disponible);
    reparto.push({ lote: l.lote, unidades: u, caducidad: l.caducidad, variantId: l.variantId });
    if (l.caducidad === null) avisos.push({ code: 'LOTE_SIN_CADUCIDAD', params: { lote: l.lote } });
    pendiente -= u;
  }
  if (pendiente > 0 && ordenados.length > 0) {
    avisos.push({ code: 'STOCK_INSUFICIENTE', params: { unidades: input.unidades } });
  }
  return { recomendado, reparto, alternativaQueCubre, avisos, excluidos, disponibleTotal, ordenados };
}

/** Stock disponible (no caducado) de una lista de lotes. */
export function disponibleNoCaducado(lotes: LoteStock[], hoy: FechaIso): number {
  return lotes
    .filter((l) => l.disponible > 0 && (l.caducidad === null || comparar(l.caducidad, hoy) >= 0))
    .reduce((s, l) => s + l.disponible, 0);
}

/** Caducidad FEFO más próxima (para ordenar sustitutos por caducidad más lejana). */
export function caducidadFefo(lotes: LoteStock[], hoy: FechaIso): FechaIso | null {
  return proponerLotes({ lotes, unidades: 1, hoy, duracionDias: null }).recomendado?.caducidad ?? null;
}
