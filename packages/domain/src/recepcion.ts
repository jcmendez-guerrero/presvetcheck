import { comparar, fechaEs, sumarDias, type FechaIso } from './fechas';
import { incidencia, type PoliticaSeveridad } from './severidad';
import type { Incidencia } from './tipos';

/**
 * Recepción de mercancía (SPEC §4.9): campos obligatorios por línea, aviso de caducidad próxima y
 * acumulación de escaneos del mismo lote (deduplicando por nº de serie).
 */
export interface LineaEntrada {
  tipo: 'medicamento' | 'producto';
  unidades: number | null;
  nombreFarmaco: string | null;
  principioActivo: string | null;
  forma: string | null;
  caducidad: FechaIso | null;
  lote: string | null;
  cn: string | null;
  seriales: string[];
}

export const CAMPOS_OBLIGATORIOS_ENTRADA = ['unidades', 'nombreFarmaco', 'principioActivo', 'forma', 'caducidad', 'lote', 'cn'] as const;

/** Campos que faltan (fecha de compra y distribuidor se validan en la cabecera). */
export function camposFaltantes(l: LineaEntrada): string[] {
  if (l.tipo === 'producto') return [l.unidades ? null : 'unidades', l.nombreFarmaco ? null : 'nombreFarmaco'].filter((x): x is string => x !== null);
  return CAMPOS_OBLIGATORIOS_ENTRADA.filter((c) => {
    const v = l[c];
    return v === null || v === '' || (c === 'unidades' && (v as number) <= 0);
  });
}

export function avisosEntrada(l: LineaEntrada, hoy: FechaIso, minDias: number, pol: PoliticaSeveridad): Incidencia[] {
  if (!l.caducidad) return [];
  if (comparar(l.caducidad, sumarDias(hoy, minDias)) < 0) {
    return [incidencia('CADUCIDAD_PROXIMA_ENTRADA', pol, { params: { lote: l.lote ?? '', fecha: fechaEs(l.caducidad), dias: minDias } })];
  }
  return [];
}

/**
 * Un producto ya caducado no se puede recibir: la caducidad es anterior a hoy (el día de caducidad todavía
 * es válido). Se comprueba al añadir y al modificar la línea, antes de guardarla.
 */
export function entradaCaducada(caducidad: FechaIso | null, hoy: FechaIso): boolean {
  return caducidad !== null && comparar(caducidad, hoy) < 0;
}

/**
 * Escanear varias veces el mismo lote suma unidades; si el envase trae nº de serie y ya estaba,
 * no suma (deduplicación).
 */
export function acumularEscaneo(l: LineaEntrada, serie: string | null): { linea: LineaEntrada; duplicado: boolean } {
  if (serie && l.seriales.includes(serie)) return { linea: l, duplicado: true };
  return {
    linea: { ...l, unidades: (l.unidades ?? 0) + 1, seriales: serie ? [...l.seriales, serie] : l.seriales },
    duplicado: false,
  };
}
