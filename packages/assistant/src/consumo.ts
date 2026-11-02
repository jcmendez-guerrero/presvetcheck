import Decimal from 'decimal.js';
import type { EstadoConsumo } from '@mmx/shared';

/** Umbral de aviso a administración (FR-027a). */
export const UMBRAL_AVISO = 0.8;

export interface EntradaEstado {
  tokensEntrada: number;
  tokensSalida: number;
  limiteTokens: number;
  /** Ampliación de administración para el mes; si existe, es el límite efectivo. */
  limiteAmpliado?: number | null;
}

export interface ResultadoEstado {
  estado: EstadoConsumo;
  usados: number;
  limiteEfectivo: number;
  porcentaje: number;
}

export function estadoConsumo(e: EntradaEstado): ResultadoEstado {
  const limiteEfectivo = e.limiteAmpliado ?? e.limiteTokens;
  const usados = e.tokensEntrada + e.tokensSalida;
  const ratio = limiteEfectivo > 0 ? usados / limiteEfectivo : 1;
  const estado: EstadoConsumo = ratio >= 1 ? 'en_pausa' : ratio >= UMBRAL_AVISO ? 'aviso' : 'normal';
  return { estado, usados, limiteEfectivo, porcentaje: Math.round(ratio * 1000) / 10 };
}

export { mesMadrid } from '@mmx/shared';

export interface Precios {
  entradaPor1k?: string | undefined;
  salidaPor1k?: string | undefined;
}

/** Coste estimado en euros con 2 decimales (cadena); null si no hay precios configurados. */
export function costeEstimado(tokensEntrada: number, tokensSalida: number, p: Precios): string | null {
  if (!p.entradaPor1k && !p.salidaPor1k) return null;
  const e = new Decimal(p.entradaPor1k ?? 0).mul(tokensEntrada).div(1000);
  const s = new Decimal(p.salidaPor1k ?? 0).mul(tokensSalida).div(1000);
  return e.plus(s).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
