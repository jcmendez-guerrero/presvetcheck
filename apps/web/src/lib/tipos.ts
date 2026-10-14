import type { Motivo } from './textos';

export interface Lote {
  lote: string;
  caducidad: string | null;
  disponible: number;
  ubicacion?: string | null;
}
export interface Fefo {
  recomendado: Lote | null;
  reparto: { lote: string; unidades: number; caducidad: string | null }[];
  alternativaQueCubre: Lote | null;
  avisos: { code: string; params: Record<string, string | number> }[];
}
export interface Sustituto {
  cn: string;
  nombre: string;
  labtitular: string | null;
  modo: 'PRE' | 'POST';
  disponible: number;
  caducidadFefo: string | null;
  envases: number;
  nota: string | null;
  origen: string;
  equivalencia: { indicacion: string };
}
export interface Evidencias {
  forzable: boolean;
  forzado: boolean;
  psicotropo: boolean;
  cn: string | null;
  lotes?: Fefo;
  alternativaFormato?: { cn: string; nombre: string; envases: number; nota: string | null; lotes: Fefo; formato: { tipo: string; avisos: string[] } };
  sustitutos: Sustituto[];
  descartados: { cn: string; nombre: string; motivos: string[] }[];
  sustitucionBloqueada: string[];
  pedido?: { cn: string; nombre: string; labtitular: string | null; psum: boolean; equivalentes: { cn: string; nombre: string; labtitular: string | null }[] };
}
export interface LineaEvaluada {
  orden: number;
  resultado: { decision: string; motivos: Motivo[]; evidencias: Evidencias };
  incidencias: Motivo[];
  opcionesSoloPA: { cn: string; nombre: string; labtitular: string | null; enStock: boolean }[] | null;
}
export interface Evaluacion {
  recetaId: string;
  resumen: string | null;
  validez: { efectiva: string } | null;
  incidenciasReceta: Motivo[];
  lineas: LineaEvaluada[];
  reglaVersion: string;
}
