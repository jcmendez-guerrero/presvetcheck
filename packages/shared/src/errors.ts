/**
 * Errores de dominio tipados con `code` estable. La UI traduce el `code` a un mensaje
 * (`i18n/errores.es.json`); el `message` técnico no se muestra al usuario ni contiene datos personales.
 */
export const CODIGOS_ERROR = [
  'VALIDACION',
  'NO_ENCONTRADO',
  'MEDICAMENTO_NO_EN_SISTEMA',
  'FRACCION_NO_VALIDA',
  'DNI_RETIRA_OBLIGATORIO',
  'NO_AUTORIZADO',
  'PROHIBIDO',
  'CONFLICTO',
  'FORZADO_NO_PERMITIDO',
  'FORZADO_PSICOTROPO_NO_PERMITIDO',
  'FORZADO_SIN_ACEPTACION',
  'FORZADO_MOTIVO_CORTO',
  'FORZADO_CODIGOS_NO_COINCIDEN',
  'FORZADO_ELECCION_NO_EQUIVALENTE',
  'DISPENSACION_BLOQUEADA',
  'MOTIVO_LOTE_OBLIGATORIO',
  'DATOS_NO_COMPROBADOS',
  'DNI_INVALIDO',
  'DATOS_PROPIETARIO_ONLINE',
  'RECEPCION_NO_EDITABLE',
  'RECEPCION_INCOMPLETA',
  'ENTRADA_CADUCADA',
  'TRANSICION_NO_PERMITIDA',
  'SUSTITUCION_REQUISITOS',
  'SIWEB_NO_DISPONIBLE',
  'SIWEB_ESCRITURA_DESACTIVADA',
  'SIWEB_SALIDAS_PROHIBIDAS',
  'SIWEB_STOCK_ILIMITADO',
  'SKU_NO_TEST',
  'PRUEBA_ESCRITURA_NO_VIGENTE',
  'MOTIVO_INCOMPATIBLE',
  'CIMAVET_NO_DISPONIBLE',
  'EXTRACTOR_NO_CONFIGURADO',
  'PROCEDIMIENTO_NO_APROBADO',
  'ANULACION_DUPLICADA',
  'ASISTENTE_DESACTIVADO',
  'ASISTENTE_NO_DISPONIBLE',
  'ASISTENTE_LIMITE_MENSUAL',
  'ASISTENTE_CONVERSACION_AJENA',
  'ASISTENTE_CONVERSACION_CERRADA',
  'RECETA_LINEA_NO_ENCONTRADA',
  'TICKET_YA_FINALIZADO',
  'TICKET_CANTIDAD_INSUFICIENTE',
  'MODO_RETROSPECTIVO_DESHABILITADO',
  'RECETA_YA_VINCULADA',
  'SUSTITUCION_BLOQUEO_DURO',
  // Alta manual de recetas (specs/011-manual-prescription-entry)
  'ALTA_MANUAL_DESHABILITADA',
  'MEDICAMENTO_NO_SELECCIONADO',
  'ESPECIE_NO_SELECCIONADA',
  'FECHA_ORIGINAL_INVALIDA',
] as const;
export type CodigoError = (typeof CODIGOS_ERROR)[number];

export class DomainError extends Error {
  constructor(
    public readonly code: CodigoError,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
