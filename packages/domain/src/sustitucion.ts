import {
  DomainError,
  type ClasePrescripcion,
  type CodigoIncidencia,
  type EstadoSustitucion,
  type ModoSustitucion,
  type Rol,
  type SustitucionExclusiones,
} from '@mmx/shared';
import type { MedicamentoInfo, ResultadoEquivalencia } from './tipos';

/** Cuándo NO se puede sustituir (SPEC §4.4.1) → PEDIR. */
export function sustitucionPermitida(
  prescrito: MedicamentoInfo,
  clase: ClasePrescripcion | null,
  exclusiones: SustitucionExclusiones['exclusiones'],
): { permitida: boolean; motivos: CodigoIncidencia[] } {
  const motivos: CodigoIncidencia[] = [];
  if (clase === null) motivos.push('SUSTITUCION_PROHIBIDA_CLASE_NO_INDICADA');
  if (clase === 'excepcional') motivos.push('SUSTITUCION_PROHIBIDA_EXCEPCIONAL');
  if (prescrito.inmunologico) motivos.push('SUSTITUCION_PROHIBIDA_INMUNOLOGICO');
  if (prescrito.biologico) motivos.push('SUSTITUCION_PROHIBIDA_BIOLOGICO');
  const pas = new Set(prescrito.composicion.pas.map((p) => p.paId));
  if (exclusiones.some((e) => e.nregistro === prescrito.nregistro || (e.pa_id !== null && pas.has(e.pa_id)))) {
    motivos.push('SUSTITUCION_PROHIBIDA_EXCLUSION');
  }
  return { permitida: motivos.length === 0, motivos };
}

/**
 * Modo efectivo de autorización: el configurado (POST por defecto, D-01), salvo las salvaguardas
 * que exigen aprobación previa del garante (indicación PROBABLE o cantidades no normalizables).
 */
export function modoEfectivo(config: ModoSustitucion, equivalencia: Pick<ResultadoEquivalencia, 'requiereAprobacionPrevia'>): ModoSustitucion {
  return equivalencia.requiereAprobacionPrevia ? 'PRE' : config;
}

// ── Máquina de estados (SPEC §4.4.3) ─────────────────────────────────────────────

export interface RegistroConsentimiento {
  consiente: boolean;
  medio: string;
  fechaHora: string;
  empleado: string;
}
export interface RegistroAvisoVeterinario {
  medio: string;
  fechaHora: string;
  resultado: string;
  empleado: string;
}
export interface RegistroUrgencia {
  justificacion: string;
  fechaHora: string;
  empleado: string;
}

export interface EstadoSustitucionCompleto {
  estado: EstadoSustitucion;
  modo: ModoSustitucion;
  consentimiento: RegistroConsentimiento | null;
  avisoVeterinario: RegistroAvisoVeterinario | null;
  urgencia: RegistroUrgencia | null;
  autorizacionPrevia: { garante: string; fechaHora: string; confirmaIndicacionProbable: boolean } | null;
  firma: { garante: string; fechaHora: string } | null;
  rechazo: { actor: string; motivo: string; fechaHora: string } | null;
  indicacionProbable: boolean;
}

export type EventoSustitucion =
  | { tipo: 'AUTORIZAR_PREVIA'; garante: string; fechaHora: string; confirmaIndicacionProbable: boolean }
  | ({ tipo: 'CONSENTIMIENTO' } & RegistroConsentimiento)
  | ({ tipo: 'AVISO_VETERINARIO' } & RegistroAvisoVeterinario)
  | ({ tipo: 'URGENCIA' } & RegistroUrgencia)
  | { tipo: 'DISPENSAR' }
  | { tipo: 'APARTAR_RECETA' }
  | { tipo: 'FIRMAR'; garante: string; fechaHora: string; mfa: boolean }
  | { tipo: 'VALIDAR'; garante: string; fechaHora: string }
  | { tipo: 'RECHAZAR'; actor: string; motivo: string; fechaHora: string };

const ROLES_GARANTE: readonly Rol[] = ['farmaceutico_garante'];
const ROLES_EMPLEADO: readonly Rol[] = ['empleado', 'veterinaria_responsable', 'farmaceutico_garante'];

export function nuevaSustitucion(modo: ModoSustitucion, indicacionProbable: boolean): EstadoSustitucionCompleto {
  return {
    estado: modo === 'PRE' ? 'PENDIENTE_AUTORIZACION_PREVIA' : 'PROPUESTA',
    modo,
    consentimiento: null,
    avisoVeterinario: null,
    urgencia: null,
    autorizacionPrevia: null,
    firma: null,
    rechazo: null,
    indicacionProbable,
  };
}

/** ¿Se puede habilitar el botón de dispensar? Consentimiento + aviso (o urgencia) + autorización previa si PRE. */
export function puedeDispensarSustitucion(s: EstadoSustitucionCompleto): boolean {
  return (
    s.estado === 'AVISO_VETERINARIO' &&
    s.consentimiento?.consiente === true &&
    (s.avisoVeterinario !== null || s.urgencia !== null) &&
    (s.modo === 'POST' || s.autorizacionPrevia !== null)
  );
}

const ANTES_DE_DISPENSAR: readonly EstadoSustitucion[] = [
  'PROPUESTA',
  'PENDIENTE_AUTORIZACION_PREVIA',
  'AUTORIZADA_PREVIA',
  'CONSENTIMIENTO_TUTOR',
  'AVISO_VETERINARIO',
];

function exigirRol(rol: Rol, permitidos: readonly Rol[]) {
  if (!permitidos.includes(rol)) throw new DomainError('PROHIBIDO', `Rol ${rol} no permitido`);
}

function noPermitida(s: EstadoSustitucionCompleto, e: EventoSustitucion): never {
  throw new DomainError('TRANSICION_NO_PERMITIDA', `${e.tipo} no permitido en ${s.estado}`);
}

export function transicionSustitucion(
  s: EstadoSustitucionCompleto,
  e: EventoSustitucion,
  rol: Rol,
): EstadoSustitucionCompleto {
  switch (e.tipo) {
    case 'AUTORIZAR_PREVIA':
      // El rol admin no puede autorizar sustituciones (SPEC §9.1).
      exigirRol(rol, ROLES_GARANTE);
      if (s.estado !== 'PENDIENTE_AUTORIZACION_PREVIA') noPermitida(s, e);
      if (s.indicacionProbable && !e.confirmaIndicacionProbable) {
        throw new DomainError('SUSTITUCION_REQUISITOS', 'La indicación PROBABLE exige confirmación expresa del garante');
      }
      return {
        ...s,
        estado: 'AUTORIZADA_PREVIA',
        autorizacionPrevia: { garante: e.garante, fechaHora: e.fechaHora, confirmaIndicacionProbable: e.confirmaIndicacionProbable },
      };
    case 'CONSENTIMIENTO': {
      exigirRol(rol, ROLES_EMPLEADO);
      const ok = s.estado === 'PROPUESTA' || s.estado === 'AUTORIZADA_PREVIA';
      if (!ok) noPermitida(s, e);
      const { tipo: _t, ...registro } = e;
      if (!e.consiente) {
        return { ...s, estado: 'RECHAZADA', consentimiento: registro, rechazo: { actor: e.empleado, motivo: 'El tutor no da su conformidad', fechaHora: e.fechaHora } };
      }
      return { ...s, estado: 'CONSENTIMIENTO_TUTOR', consentimiento: registro };
    }
    case 'AVISO_VETERINARIO':
    case 'URGENCIA': {
      exigirRol(rol, ROLES_EMPLEADO);
      if (s.estado !== 'CONSENTIMIENTO_TUTOR') noPermitida(s, e);
      const { tipo: _t, ...registro } = e;
      if (e.tipo === 'URGENCIA') {
        if (e.justificacion.trim().length < 15) {
          throw new DomainError('SUSTITUCION_REQUISITOS', 'La urgencia exige una justificación');
        }
        return { ...s, estado: 'AVISO_VETERINARIO', urgencia: registro as RegistroUrgencia };
      }
      return { ...s, estado: 'AVISO_VETERINARIO', avisoVeterinario: registro as RegistroAvisoVeterinario };
    }
    case 'DISPENSAR':
      exigirRol(rol, ROLES_EMPLEADO);
      if (!puedeDispensarSustitucion(s)) {
        throw new DomainError('SUSTITUCION_REQUISITOS', 'Faltan consentimiento, aviso al veterinario o autorización previa');
      }
      return { ...s, estado: 'DISPENSADA' };
    case 'APARTAR_RECETA':
      exigirRol(rol, ROLES_EMPLEADO);
      if (s.estado !== 'DISPENSADA') noPermitida(s, e);
      return { ...s, estado: 'RECETA_APARTADA' };
    case 'FIRMAR':
      exigirRol(rol, ROLES_GARANTE);
      if (s.estado !== 'RECETA_APARTADA') noPermitida(s, e);
      if (!e.mfa) throw new DomainError('PROHIBIDO', 'La firma del garante exige MFA');
      return { ...s, estado: 'FIRMADA_GARANTE', firma: { garante: e.garante, fechaHora: e.fechaHora } };
    case 'VALIDAR':
      exigirRol(rol, ROLES_GARANTE);
      if (s.estado !== 'FIRMADA_GARANTE') noPermitida(s, e);
      return { ...s, estado: 'VALIDADA' };
    case 'RECHAZAR': {
      const antes = ANTES_DE_DISPENSAR.includes(s.estado);
      if (antes) {
        exigirRol(rol, ROLES_EMPLEADO);
        return { ...s, estado: 'RECHAZADA', rechazo: { actor: e.actor, motivo: e.motivo, fechaHora: e.fechaHora } };
      }
      // Después de dispensar solo el garante marca "sustitución no conforme"; no se borra nada.
      exigirRol(rol, ROLES_GARANTE);
      if (s.estado === 'RECHAZADA' || s.estado === 'NO_CONFORME_GARANTE' || s.estado === 'VALIDADA') noPermitida(s, e);
      return { ...s, estado: 'NO_CONFORME_GARANTE', rechazo: { actor: e.actor, motivo: e.motivo, fechaHora: e.fechaHora } };
    }
  }
}

// ── Plantillas (v1 no envía mensajes: el empleado copia el texto) ──────────────────

export interface DatosAvisoSustitucion {
  prescrito: { nombre: string; cn: string };
  sustituto: { nombre: string; cn: string; laboratorio: string | null };
  lote: string | null;
  motivo: string;
  numeroReceta: string | null;
  farmacia: string;
}

export function plantillaAvisoVeterinario(d: DatosAvisoSustitucion): string {
  return [
    `Buenos días. Le escribimos desde ${d.farmacia} en relación con su receta${d.numeroReceta ? ` nº ${d.numeroReceta}` : ''}.`,
    `El medicamento prescrito, ${d.prescrito.nombre} (CN ${d.prescrito.cn}), no está disponible en este momento.`,
    `Con la conformidad del tutor se ha dispensado ${d.sustituto.nombre} (CN ${d.sustituto.cn}${d.sustituto.laboratorio ? `, ${d.sustituto.laboratorio}` : ''})${d.lote ? `, lote ${d.lote}` : ''}.`,
    `Motivo: ${d.motivo}.`,
    'Si tiene cualquier objeción, por favor, contacte con nosotros.',
  ].join('\n');
}

/** Texto de la anotación al dorso de la receta (etiqueta 62 mm o A6). */
export function textoAnotacionDorso(d: { nombre: string; cn: string; lote: string; fecha: string }): string {
  return [
    'SUSTITUCIÓN (Reglamento (UE) 2019/6 · RD 666/2023)',
    `Dispensado: ${d.nombre}`,
    `CN: ${d.cn}   Lote: ${d.lote}`,
    `Fecha: ${d.fecha}`,
    'Firma del farmacéutico: ______________________',
  ].join('\n');
}
