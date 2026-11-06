import type { CimavetRepository } from '@mmx/cimavet';
import type { Clock, LoteStock } from '@mmx/domain';
import type { ContextoLineaDto, RulesBundle } from '@mmx/shared';
import type { IndiceFuentes } from '../fuentes/indice';

export interface StockResultadoAsistente {
  estado: 'OK' | 'NO_DISPONIBLE' | 'SIN_MAPEO';
  lotes: LoteStock[];
}

export interface StockPortAsistente {
  lotes(
    cn: string,
    medicamento?: { nombre: string; labtitular: string | null } | null,
  ): Promise<StockResultadoAsistente>;
}

/** Dependencias de las herramientas del asistente (todas de solo lectura). */
export interface DepsHerramientas {
  rules: RulesBundle;
  clock: Clock;
  /** null si no hay guía ni Ayuda cargadas: las herramientas de búsqueda no devuelven resultados. */
  indice: IndiceFuentes | null;
  cimavet: CimavetRepository;
  /** Puerto de consulta de stock en el almacén de la farmacia (null si no está disponible). */
  stock?: StockPortAsistente | null;
  /** ALLOW_PACK_SIZE_CHANGE: si se admite dispensar otra presentación del mismo medicamento. */
  permitirCambioFormato: boolean;
  /** Horas desde las que los datos de CIMAVet se consideran desactualizados (CIMAVET_LIVE_CHECK_MAX_AGE_H). */
  maxEdadCimavetH: number;
  /** Contexto sin datos personales de una línea de receta evaluada (null si no existe). */
  cargarContextoLinea?: (recetaLineaId: string) => Promise<ContextoLineaDto | null>;
}
