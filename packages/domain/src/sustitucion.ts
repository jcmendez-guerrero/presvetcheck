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
 * El garante no usa la app: su autorización y su firma se obtienen fuera y las REGISTRA el empleado.
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

/** Lo que el garante hace fuera de la app y el empleado deja registrado (confirmación expresa). */
export interface RegistroGarante {
  /** Nombre del farmacéutico garante. */
  garante: string;
  fechaHora: string;
  /** Empleado que lo registra. */
  empleado: string;
}

export interface EstadoSustitucionCompleto {
  estado: EstadoSustitucion;
  modo: ModoSustitucion;
  consentimiento: RegistroConsentimiento | null;
  avisoVeterinario: RegistroAvisoVeterinario | null;
  urgencia: RegistroUrgencia | null;
  /** Autorización previa del garante obtenida fuera de la app (teléfono, presencial…), registrada por el empleado. */
  autorizacionPrevia: RegistroGarante & { medio: string; confirmaIndicacionProbable: boolean } | null;
  /** Firma del garante en la anotación de la receta en papel, registrada por el empleado. */
  firma: RegistroGarante | null;
  rechazo: { actor: string; motivo: string; fechaHora: string } | null;
  indicacionProbable: boolean;
}

export type EventoSustitucion =
  | ({ tipo: 'AUTORIZAR_PREVIA'; medio: string; confirmaIndicacionProbable: boolean } & RegistroGarante)
  | ({ tipo: 'CONSENTIMIENTO' } & RegistroConsentimiento)
  | ({ tipo: 'AVISO_VETERINARIO' } & RegistroAvisoVeterinario)
  | ({ tipo: 'URGENCIA' } & RegistroUrgencia)
  | { tipo: 'DISPENSAR' }
  | { tipo: 'APARTAR_RECETA' }
  | ({ tipo: 'FIRMAR' } & RegistroGarante)
  | { tipo: 'RECHAZAR'; actor: string; motivo: string; fechaHora: string };

/** Quien registra en la app (el rol admin no interviene en sustituciones, SPEC §9.1). */
const ROLES_EMPLEADO: readonly Rol[] = ['empleado', 'veterinaria_responsable'];

const nombreGarante = (g: string) => {
  if (g.trim().length < 3) throw new DomainError('SUSTITUCION_REQUISITOS', 'Indica el nombre del farmacéutico garante');
  return g.trim();
};

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
      // El garante autoriza fuera de la app; el empleado lo registra con confirmación expresa.
      exigirRol(rol, ROLES_EMPLEADO);
      if (s.estado !== 'PENDIENTE_AUTORIZACION_PREVIA') noPermitida(s, e);
      if (e.medio.trim().length < 3) throw new DomainError('SUSTITUCION_REQUISITOS', 'Indica cómo se obtuvo la autorización del garante');
      if (s.indicacionProbable && !e.confirmaIndicacionProbable) {
        throw new DomainError('SUSTITUCION_REQUISITOS', 'Con indicación PROBABLE, confirma expresamente que el garante la ha revisado');
      }
      return {
        ...s,
        estado: 'AUTORIZADA_PREVIA',
        autorizacionPrevia: { garante: nombreGarante(e.garante), medio: e.medio.trim(), fechaHora: e.fechaHora, empleado: e.empleado, confirmaIndicacionProbable: e.confirmaIndicacionProbable },
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
      // El garante firma la anotación en la receta en papel; el empleado registra que está firmada.
      exigirRol(rol, ROLES_EMPLEADO);
      if (s.estado !== 'RECETA_APARTADA') noPermitida(s, e);
      return { ...s, estado: 'FIRMADA_GARANTE', firma: { garante: nombreGarante(e.garante), fechaHora: e.fechaHora, empleado: e.empleado } };
    case 'RECHAZAR': {
      const antes = ANTES_DE_DISPENSAR.includes(s.estado);
      if (antes) {
        exigirRol(rol, ROLES_EMPLEADO);
        return { ...s, estado: 'RECHAZADA', rechazo: { actor: e.actor, motivo: e.motivo, fechaHora: e.fechaHora } };
      }
      // Después de dispensar, el empleado registra que el garante la ha declarado no conforme (fuera de la app).
      exigirRol(rol, ROLES_EMPLEADO);
      if (s.estado === 'RECHAZADA' || s.estado === 'NO_CONFORME_GARANTE') noPermitida(s, e);
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
