import defectos from './defectos.es.json';
import errores from './errores.es.json';
import type { CodigoEquivalencia, CodigoIncidencia } from '../codes';
import type { CodigoError } from '../errors';

export interface TextoDefecto {
  titulo: string;
  donde: string;
  accion: string;
}

const CATALOGO = defectos as Record<string, TextoDefecto>;
const ERRORES = errores as Record<string, string>;

function interpolar(plantilla: string, params: Record<string, string | number> = {}): string {
  return plantilla.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Texto en español de un defecto, interpolando los parámetros (`{fecha}`, `{linea}`…). */
export function textoDefecto(code: CodigoIncidencia, params?: Record<string, string | number>): TextoDefecto {
  const t = CATALOGO[code];
  if (!t) return { titulo: code, donde: '', accion: '' };
  return { titulo: interpolar(t.titulo, params), donde: t.donde, accion: interpolar(t.accion, params) };
}

export function textoError(code: CodigoError): string {
  return ERRORES[code] ?? 'Se ha producido un error.';
}

export const catalogoDefectos = CATALOGO;
export const catalogoErrores = ERRORES;

const TEXTOS_EQUIVALENCIA: Record<CodigoEquivalencia, string> = {
  COMPOSICION_DISTINTA: 'No tiene los mismos principios activos.',
  PROPORCION_DISTINTA: 'Los principios activos no están en la misma proporción.',
  CONCENTRACION_DISTINTA: 'La concentración no es la misma.',
  CONCENTRACION_SUPERIOR: 'La concentración por unidad es mayor que la prescrita.',
  CONCENTRACION_OTRO_MEDICAMENTO: 'Con otro medicamento solo se puede sustituir por la misma concentración.',
  CANTIDAD_SUPERIOR: 'La cantidad total de principio activo sería mayor que la prescrita.',
  CANTIDAD_NO_NORMALIZABLE: 'Las cantidades no se pueden comparar automáticamente: hay que revisarlo a mano.',
  FORMA_DISTINTA: 'No tiene la misma forma farmacéutica.',
  VIA_NO_AUTORIZADA: 'No está autorizado para la vía de administración prescrita.',
  ESPECIE_NO_AUTORIZADA: 'No está autorizado para la especie de la receta.',
  INDICACION_NO_COINCIDE: 'No está autorizado para la misma indicación.',
  INDICACION_PROBABLE: 'La indicación es probablemente la misma, pero hay que confirmarla expresamente.',
  TIEMPO_ESPERA_SUPERIOR: 'Su tiempo de espera es mayor que el del medicamento prescrito.',
  TIEMPO_ESPERA_DESCONOCIDO: 'No consta el tiempo de espera para compararlo.',
  NO_AUTORIZADO: 'No está en estado autorizado.',
  NO_COMERCIALIZADO: 'No está comercializado.',
  USO_HUMANO: 'Es un medicamento de uso humano: nunca se sustituye por uno.',
  DOSIS_NO_AJUSTABLE: 'La dosis no se puede ajustar con unidades enteras.',
};

/** Texto en español de un motivo de no equivalencia (SPEC §4.4.2, §4.3.1). */
export function textoEquivalencia(code: CodigoEquivalencia): string {
  return TEXTOS_EQUIVALENCIA[code] ?? code;
}
