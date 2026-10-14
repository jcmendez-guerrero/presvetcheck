import { DomainError } from '@mmx/shared';
import { comparar, fechaEs, type FechaIso } from './fechas';
import { incidencia, type PoliticaSeveridad } from './severidad';
import type { Incidencia } from './tipos';

/**
 * Validaciones al escanear el envase en la dispensación (SPEC §4.6): CN distinto (bloqueo),
 * envase caducado (bloqueo), lote distinto al FEFO (aviso con motivo obligatorio), unidades por
 * encima de lo prescrito (bloqueo), nº de serie ya dispensado (aviso) y psicótropos (1 envase).
 */
export interface EntradaEscaneo {
  linea?: number;
  cnSeleccionado: string;
  envase: { cn: string | null; lote: string; caducidad: FechaIso | null; serie: string | null };
  loteRecomendado: string | null;
  motivoLoteDistinto: string | null;
  unidadesYaDispensadas: number;
  unidadesAhora: number;
  unidadesMax: number;
  seriesYaDispensadas: string[];
  psicotropo: boolean;
  hoy: FechaIso;
  politica: PoliticaSeveridad;
}

export function validarEnvase(e: EntradaEscaneo): Incidencia[] {
  const pol = e.politica;
  const extra = e.linea !== undefined ? { linea: e.linea } : {};
  const out: Incidencia[] = [];
  if (e.envase.cn !== null && e.envase.cn !== e.cnSeleccionado) {
    out.push(incidencia('CN_ESCANEADO_DISTINTO', pol, { ...extra, params: { cnEscaneado: e.envase.cn, cnSeleccionado: e.cnSeleccionado } }));
  }
  if (e.envase.caducidad !== null && comparar(e.envase.caducidad, e.hoy) < 0) {
    out.push(incidencia('ENVASE_CADUCADO', pol, { ...extra, params: { fecha: fechaEs(e.envase.caducidad) } }));
  }
  if (e.loteRecomendado !== null && e.envase.lote !== e.loteRecomendado) {
    out.push(incidencia('LOTE_NO_FEFO', pol, { ...extra, params: { lote: e.envase.lote, loteRecomendado: e.loteRecomendado } }));
  }
  const total = e.unidadesYaDispensadas + e.unidadesAhora;
  if (e.psicotropo && total > 1) {
    out.push(incidencia('PSICOTROPO_MAS_DE_UN_ENVASE', pol, { ...extra, params: { medicamento: e.cnSeleccionado } }));
  } else if (total > e.unidadesMax) {
    out.push(incidencia('UNIDADES_SUPERAN_PRESCRITAS', pol, { ...extra, params: { unidades: total, maximo: e.unidadesMax } }));
  }
  if (e.envase.serie !== null && e.seriesYaDispensadas.includes(e.envase.serie)) {
    out.push(incidencia('SERIE_YA_DISPENSADA', pol, { ...extra, params: { serie: e.envase.serie } }));
  }
  return out;
}

/** Lote distinto al FEFO exige motivo (SPEC §4.6). */
export function exigirMotivoLote(incs: Incidencia[], motivo: string | null): void {
  if (incs.some((i) => i.code === 'LOTE_NO_FEFO') && (!motivo || motivo.trim().length < 3)) {
    throw new DomainError('MOTIVO_LOTE_OBLIGATORIO');
  }
}
