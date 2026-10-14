import type {
  ClasePrescripcion,
  CodigoEquivalencia,
  CodigoIncidencia,
  Decision,
  EquivalenciaIndicacion,
  Severidad,
} from '@mmx/shared';
import type { FechaIso } from './fechas';

/** Incidencia detectada por el motor (defecto o aviso). */
export interface Incidencia {
  code: CodigoIncidencia;
  severidad: Severidad;
  ambito: 'receta' | 'linea';
  /** Orden de la línea afectada (si `ambito = linea`). */
  linea?: number;
  campo?: string;
  params?: Record<string, string | number>;
  /** La severidad se endureció por ser psicótropo (PSYCHOTROPIC_ALLOW_FORCE=false). */
  porPsicotropo?: boolean;
}

export type EstadoAutorizacion = 'autorizado' | 'suspendido' | 'revocado';

/** Principio activo tal como lo da CIMAVet (cantidades como texto decimal). */
export interface PrincipioActivo {
  paId: number;
  nombre: string;
  /** Cantidad por `composicion.porCantidad` `composicion.porUnidad` (p. ej. 500 mg por 1 comprimido). */
  cantidad: string | null;
  unidad: string | null;
}

export interface Composicion {
  pas: PrincipioActivo[];
  /** Base de la concentración (p. ej. 1) y su unidad (p. ej. Comprimido, ml, g). */
  porCantidad: string | null;
  porUnidad: string | null;
}

export interface TiempoEspera {
  especieId: number | null;
  tejido: string | null;
  /** Días; null si no es convertible a días. */
  dias: number | null;
  noAplica: boolean;
}

/** Medicamento normalizado desde la caché de CIMAVet (puertos implementados en packages/cimavet). */
export interface MedicamentoInfo {
  nregistro: string;
  nombre: string;
  labtitular: string | null;
  receta: boolean;
  antibiotico: boolean;
  estupefaciente: boolean;
  psicotropo: boolean;
  inmunologico: boolean;
  biologico: boolean;
  usoHumano: boolean;
  formaId: number | null;
  viaIds: number[];
  especieIds: number[];
  atc: string[];
  indicaciones: { especieId: number | null; texto: string }[];
  tiemposEspera: TiempoEspera[];
  estado: EstadoAutorizacion;
  comerc: boolean;
  psum: boolean;
  notas: boolean;
  composicion: Composicion;
}

export interface PresentacionInfo {
  cn: string;
  nregistro: string;
  nombre: string;
  comerc: boolean;
  estado: EstadoAutorizacion;
  /** Contenido del envase (p. ej. 10) y unidad (p. ej. Comprimido). */
  contenido: string | null;
  unidadContenido: string | null;
}

/** Lote con stock en el almacén "Farmacia" (lo construye packages/siweb). */
export interface LoteStock {
  lote: string;
  caducidad: FechaIso | null;
  disponible: number;
  /** Fecha de creación del lote en Siweb360 (desempate FEFO). */
  creadoAt: string | null;
  variantId: number;
  ubicacion?: string | null;
}

/** Stock por CN; `NO_DISPONIBLE` si Siweb360 no respondió (→ PENDIENTE_STOCK). */
export type StockPorCn = Record<string, LoteStock[]> | 'NO_DISPONIBLE';

export interface ResultadoEquivalencia {
  equivalente: boolean;
  /** Cantidades no normalizables: se lista como "revisar manualmente" (no se propone sola). */
  revisarManual: boolean;
  indicacion: EquivalenciaIndicacion;
  motivos: CodigoEquivalencia[];
  /** PROBABLE o no normalizable → aprobación previa del garante (modo PRE para la línea). */
  requiereAprobacionPrevia: boolean;
}

export interface ContextoPrescripcion {
  especieId: number | null;
  especieProduccion: boolean;
  clase: ClasePrescripcion | null;
  indicacion: string | null;
  viaPrescritaId: number | null;
  duracionDias: number | null;
}

/** Salida estándar del motor (AGENTS.md): nunca un booleano suelto. */
export interface ResultadoMotor<D extends string = Decision, E = Record<string, unknown>> {
  decision: D;
  motivos: Incidencia[];
  evidencias: E;
  reglaVersion: string;
}
