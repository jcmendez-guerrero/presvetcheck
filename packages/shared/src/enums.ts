import { z } from 'zod';

/** Severidades de incidencia (SPEC §4.1.6). */
export const Severidad = z.enum(['AVISO', 'BLOQUEANTE_FORMA', 'BLOQUEANTE_DURO']);
export type Severidad = z.infer<typeof Severidad>;

/** Resultado por línea del motor de decisión (SPEC §4.3). */
export const Decision = z.enum([
  'DISPENSAR',
  'DISPENSAR_CON_AVISO',
  'SUSTITUIR',
  'PEDIR',
  'NO_CONFORME',
  'PENDIENTE_STOCK',
]);
export type Decision = z.infer<typeof Decision>;

/** Roles de Entra (SPEC §9.1). */
export const Rol = z.enum(['empleado', 'farmaceutico_garante', 'veterinaria_responsable', 'admin']);
export type Rol = z.infer<typeof Rol>;

export const TipoReceta = z.enum(['papel', 'electronica']);
export type TipoReceta = z.infer<typeof TipoReceta>;

export const TipoDispensacion = z.enum(['dispensacion', 'botiquin', 'no_dispensacion']);
export type TipoDispensacion = z.infer<typeof TipoDispensacion>;

export const ClasePrescripcion = z.enum(['ordinaria', 'excepcional']);
export type ClasePrescripcion = z.infer<typeof ClasePrescripcion>;

export const TipoTratamiento = z.enum(['agudo', 'cronico', 'preventivo']);
export type TipoTratamiento = z.infer<typeof TipoTratamiento>;

export const Canal = z.enum(['presencial', 'online']);
export type Canal = z.infer<typeof Canal>;

export const MetodoCaptura = z.enum(['scanner', 'camara', 'manual']);
export type MetodoCaptura = z.infer<typeof MetodoCaptura>;

export const EstadoReceta = z.enum([
  'BORRADOR',
  'EXTRAIDA',
  'CONFIRMADA',
  'EVALUADA',
  'DISPENSADA_PARCIAL',
  'DISPENSADA',
  'NO_CONFORME',
]);
export type EstadoReceta = z.infer<typeof EstadoReceta>;

export const EstadoLinea = z.enum(['PENDIENTE', 'DISPENSADA', 'PENDIENTE_ENTREGA', 'NO_CONFORME', 'PEDIDA']);
export type EstadoLinea = z.infer<typeof EstadoLinea>;

/** Estados de la sustitución (SPEC §4.4.3). */
export const EstadoSustitucion = z.enum([
  'PROPUESTA',
  'PENDIENTE_AUTORIZACION_PREVIA',
  'AUTORIZADA_PREVIA',
  'CONSENTIMIENTO_TUTOR',
  'AVISO_VETERINARIO',
  'DISPENSADA',
  'RECETA_APARTADA',
  'FIRMADA_GARANTE',
  'VALIDADA',
  'RECHAZADA',
  'NO_CONFORME_GARANTE',
]);
export type EstadoSustitucion = z.infer<typeof EstadoSustitucion>;

export const ModoSustitucion = z.enum(['PRE', 'POST']);
export type ModoSustitucion = z.infer<typeof ModoSustitucion>;

export const EquivalenciaIndicacion = z.enum(['COINCIDE', 'PROBABLE', 'NO_COINCIDE']);
export type EquivalenciaIndicacion = z.infer<typeof EquivalenciaIndicacion>;

export const OutboxStatus = z.enum(['pending', 'sent', 'failed', 'needs_reconciliation']);
export type OutboxStatus = z.infer<typeof OutboxStatus>;

export const EstadoRecepcion = z.enum(['ABIERTA', 'FINALIZADA', 'SINCRONIZADA', 'ERROR_SINCRONIZACION']);
export type EstadoRecepcion = z.infer<typeof EstadoRecepcion>;

export const EstadoRecepcionLinea = z.enum(['OK', 'PENDIENTE_ALTA_SIWEB', 'ENCOLADA', 'SINCRONIZADA', 'ERROR']);
export type EstadoRecepcionLinea = z.infer<typeof EstadoRecepcionLinea>;

export const PlantillaSalidas = z.enum(['A', 'B', 'C']);
export type PlantillaSalidas = z.infer<typeof PlantillaSalidas>;
