/** Texto de cada estado de recepción tal como lo ve el personal (specs/014). */
export const TEXTO_ESTADO_RECEPCION = {
  ABIERTA: 'Abierta',
  FINALIZADA: 'Finalizada',
  SINCRONIZADA: 'Enviada',
  ERROR_SINCRONIZACION: 'Error al enviar',
  DESCARTADA: 'Descartada',
} as const;
export type CodigoEstadoRecepcion = keyof typeof TEXTO_ESTADO_RECEPCION;

/** Códigos ordenados por su texto: el orden de la columna Estado en la tabla de recepciones. */
export const ESTADOS_RECEPCION_POR_TEXTO = (
  Object.keys(TEXTO_ESTADO_RECEPCION) as CodigoEstadoRecepcion[]
).sort((a, b) => TEXTO_ESTADO_RECEPCION[a].localeCompare(TEXTO_ESTADO_RECEPCION[b], 'es'));
