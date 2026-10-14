import defectos from './defectos.es.json';
import errores from './errores.es.json';
import type { CodigoIncidencia } from '../codes';
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
