import type { CodigoIncidencia, RecetaCamposRules, Severidad } from '@mmx/shared';
import type { Incidencia } from './tipos';

/** Política de severidades: reglas YAML + flags de configuración (SPEC §4.1.6). */
export interface PoliticaSeveridad {
  rules: RecetaCamposRules;
  /** TODO(decision D-05c): "producto no válido" no forzable. Por defecto false. */
  productValidityHardBlock: boolean;
  /** Defectos de forma forzables en psicótropos. Por defecto false. */
  psychotropicAllowForce: boolean;
}

/** Severidad configurada para una incidencia no ligada a un campo, aplicando el grupo "producto no válido". */
export function severidadDe(code: CodigoIncidencia, pol: PoliticaSeveridad): Severidad {
  const base = pol.rules.incidencias[code];
  if (!base) throw new Error(`Incidencia ${code} sin severidad configurada en receta-campos`);
  if (pol.rules.producto_no_valido.includes(code) && base !== 'AVISO') {
    return pol.productValidityHardBlock ? 'BLOQUEANTE_DURO' : 'BLOQUEANTE_FORMA';
  }
  return base;
}

type Extra = Omit<Incidencia, 'code' | 'severidad' | 'ambito'> & { ambito?: Incidencia['ambito'] };

export function incidencia(code: CodigoIncidencia, pol: PoliticaSeveridad, extra: Extra = {}): Incidencia {
  const { ambito, ...rest } = extra;
  return {
    code,
    severidad: severidadDe(code, pol),
    ambito: ambito ?? (rest.linea !== undefined ? 'linea' : 'receta'),
    ...rest,
  };
}

/**
 * En psicótropos, con PSYCHOTROPIC_ALLOW_FORCE=false, los defectos de forma pasan a no forzables
 * (SPEC §4.1.5).
 */
export function aplicarPoliticaPsicotropo(
  incs: Incidencia[],
  esPsicotropo: boolean,
  pol: PoliticaSeveridad,
): Incidencia[] {
  if (!esPsicotropo || pol.psychotropicAllowForce) return incs;
  return incs.map((i) =>
    i.severidad === 'BLOQUEANTE_FORMA' ? { ...i, severidad: 'BLOQUEANTE_DURO', porPsicotropo: true } : i,
  );
}

export function peorSeveridad(incs: Incidencia[]): Severidad | null {
  if (incs.some((i) => i.severidad === 'BLOQUEANTE_DURO')) return 'BLOQUEANTE_DURO';
  if (incs.some((i) => i.severidad === 'BLOQUEANTE_FORMA')) return 'BLOQUEANTE_FORMA';
  if (incs.some((i) => i.severidad === 'AVISO')) return 'AVISO';
  return null;
}

export const bloqueantes = (incs: Incidencia[]) => incs.filter((i) => i.severidad !== 'AVISO');
export const avisos = (incs: Incidencia[]) => incs.filter((i) => i.severidad === 'AVISO');
