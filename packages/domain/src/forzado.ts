import { DomainError, type CodigoIncidencia, type EquivalenciaRules } from '@mmx/shared';
import { evaluarEquivalencia } from './equivalencia';
import type { ContextoPrescripcion, Incidencia, MedicamentoInfo } from './tipos';

/**
 * Forzado (bypass) de defectos de forma (SPEC §4.1.6). Se valida en la API, no solo en la UI:
 * un BLOQUEANTE_DURO nunca se puede forzar.
 */

export const MOTIVO_FORZADO_MIN = 15;

export interface SolicitudForzado {
  codigos: CodigoIncidencia[];
  motivo: string;
  /** "Entiendo los riesgos de dispensar una receta que no cumple los requisitos y asumo la responsabilidad". */
  aceptaRiesgos: boolean;
}

export interface ForzadoAceptado {
  codigos: CodigoIncidencia[];
  motivo: string;
}

/** Defectos forzables presentes (BLOQUEANTE_FORMA). */
export function defectosForzables(incs: Incidencia[]): CodigoIncidencia[] {
  return [...new Set(incs.filter((i) => i.severidad === 'BLOQUEANTE_FORMA').map((i) => i.code))];
}

/** Valida la solicitud; lanza `DomainError` si no procede. */
export function validarForzado(incs: Incidencia[], s: SolicitudForzado): ForzadoAceptado {
  const duros = incs.filter((i) => i.severidad === 'BLOQUEANTE_DURO');
  if (duros.length) {
    const soloPorPsicotropo = duros.every((d) => d.porPsicotropo);
    throw new DomainError(
      soloPorPsicotropo ? 'FORZADO_PSICOTROPO_NO_PERMITIDO' : 'FORZADO_NO_PERMITIDO',
      `Defectos no forzables: ${duros.map((d) => d.code).join(', ')}`,
      { codigos: duros.map((d) => d.code) },
    );
  }
  if (!s.aceptaRiesgos) throw new DomainError('FORZADO_SIN_ACEPTACION');
  if (s.motivo.trim().length < MOTIVO_FORZADO_MIN) throw new DomainError('FORZADO_MOTIVO_CORTO');
  const esperados = defectosForzables(incs).sort();
  const pedidos = [...new Set(s.codigos)].sort();
  if (esperados.length === 0 || esperados.join() !== pedidos.join()) {
    // La persona debe ver y aceptar exactamente los defectos vigentes.
    throw new DomainError('FORZADO_CODIGOS_NO_COINCIDEN', undefined, { esperados, pedidos });
  }
  return { codigos: esperados, motivo: s.motivo.trim() };
}

/**
 * Prescripción solo por principio activo forzada (SPEC §4.1.4): el medicamento elegido debe
 * cumplir las mismas condiciones de equivalencia que una sustitución respecto a lo que indica
 * la receta (principio activo, cantidad, forma, vía, especie, indicación).
 */
export function validarEleccionSoloPA(
  prescripcionVirtual: MedicamentoInfo,
  elegido: MedicamentoInfo,
  ctx: ContextoPrescripcion,
  rules: EquivalenciaRules,
): void {
  const r = evaluarEquivalencia(prescripcionVirtual, elegido, ctx, rules, { prescripcionVirtual: true });
  if (!r.equivalente) {
    throw new DomainError('FORZADO_ELECCION_NO_EQUIVALENTE', undefined, { motivos: r.motivos, indicacion: r.indicacion });
  }
}

/** Construye la "prescripción virtual" con lo que indica la receta (principios activos, forma, vía, especie). */
export function prescripcionVirtual(d: {
  pas: { paId: number; nombre: string; cantidad: string | null; unidad: string | null }[];
  porCantidad: string | null;
  porUnidad: string | null;
  formaId: number | null;
  viaId: number | null;
  especieId: number | null;
}): MedicamentoInfo {
  return {
    nregistro: '(receta)',
    nombre: d.pas.map((p) => p.nombre).join(' + '),
    labtitular: null,
    receta: true,
    antibiotico: false,
    estupefaciente: false,
    psicotropo: false,
    inmunologico: false,
    biologico: false,
    usoHumano: false,
    formaId: d.formaId,
    viaIds: d.viaId !== null ? [d.viaId] : [],
    especieIds: d.especieId !== null ? [d.especieId] : [],
    atc: [],
    indicaciones: [],
    tiemposEspera: [],
    estado: 'autorizado',
    comerc: true,
    psum: false,
    notas: false,
    composicion: { pas: d.pas, porCantidad: d.porCantidad, porUnidad: d.porUnidad },
  };
}
