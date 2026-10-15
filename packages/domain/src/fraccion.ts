import { normalizeText } from '@mmx/shared';
import type { PresentacionInfo } from './tipos';

/**
 * Dispensación fraccionada (guía de la oficina de farmacia §5.9; DUDA-10 resuelta). Por defecto se
 * dispensa el envase original intacto. Solo las presentaciones que el Nomenclátor marca con
 * `sw_dispensacion_fraccionada=SI` admiten fracciones, y siempre en múltiplos de la fracción autorizada
 * por el laboratorio (`fracciones_autorizadas`: "1 blister de 10 comprimidos", "6 fracciones de 3
 * comprimidos", "fracción: una pipeta"…). Nunca se corta el acondicionamiento primario.
 */

export interface FraccionAutorizada {
  /** Unidades de dosificación de la fracción mínima (p. ej. 10 comprimidos, 1 pipeta, 1 vial). */
  unidades: number;
  /** Unidad de la fracción en singular y minúsculas ("comprimido", "pipeta", "vial", "jeringa"…). */
  unidad: string;
  /** Nº de fracciones del envase si el texto lo dice ("21 fracciones de 1 pipeta" → 21). */
  fraccionesEnvase: number | null;
  /** Texto original del Nomenclátor. */
  texto: string;
}

const NUMEROS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
const UNIDADES_DOSIS = ['comprimido', 'capsula', 'jeringa', 'pipeta', 'tubo', 'aplicador', 'sobre', 'vial', 'frasco', 'collar', 'dosis'];

const numero = (t: string): number | null => (/^\d+$/.test(t) ? Number(t) : (NUMEROS[t] ?? null));
const singular = (u: string): string | null => {
  const s = u.replace(/(es|s)$/, '');
  return UNIDADES_DOSIS.find((x) => x === u || x === s || `${x}s` === u || `${x}es` === u) ?? null;
};

/**
 * Interpreta `fracciones_autorizadas`. Devuelve null si el texto no se entiende: entonces solo se
 * dispensan envases completos (conservador) y se muestra el texto a la persona.
 */
export function parseFraccion(texto: string | null | undefined): FraccionAutorizada | null {
  if (!texto) return null;
  // Sin el prefijo "N fracciones de" / "fracción:" / "fracción de"; sin paréntesis aclaratorios.
  const limpio = normalizeText(texto).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const nFr = /^(\d+)\s+fracciones\b/.exec(limpio);
  const fraccionesEnvase = nFr ? Number(nFr[1]) : null;
  const t = limpio.replace(/^(\d+\s+)?fracci(?:ones|on)\b\s*(?::|de)?\s*/, '').trim();
  // "1 blister de 10 comprimidos", "2 blister de 7 comprimidos", "blister con 1 aplicador", "sobres con 4 jeringas"
  const env = /^(?:(\d+|una?|uno|dos|tres|cuatro|cinco|seis)\s+)?(?:blister|blisteres|blisters|sobres?)\s+(?:de|con)\s+(\d+|una?|uno)\s+([a-z]+)/.exec(t);
  if (env) {
    const n = env[1] ? numero(env[1]) : 1;
    const m = numero(env[2] as string);
    const u = singular(env[3] as string);
    if (n !== null && m !== null && u) return { unidades: n * m, unidad: u, fraccionesEnvase, texto };
  }
  // "3 comprimidos", "una pipeta", "1 vial de 50 dosis…", "1 frasco", "4 jeringas", "10 tubos"
  const directo = /^(\d+|una?|uno|dos|tres|cuatro|cinco|seis)\s+([a-z]+)/.exec(t);
  if (directo) {
    const n = numero(directo[1] as string);
    const u = singular(directo[2] as string);
    if (n !== null && u) return { unidades: n, unidad: u, fraccionesEnvase, texto };
  }
  return null;
}

export interface ValidacionFraccion {
  valida: boolean;
  motivo: 'NO_FRACCIONABLE' | 'FRACCION_DESCONOCIDA' | 'NO_MULTIPLO' | 'SUPERA_ENVASE' | 'SUPERA_PRESCRITAS' | null;
}

/** Unidades de forma a dispensar en fracción: múltiplo de la fracción, ≤ envase y ≤ prescritas. */
export function validarUnidadesFraccion(
  pres: Pick<PresentacionInfo, 'fraccionable' | 'fracciones' | 'contenido' | 'unidadContenido'>,
  unidades: number,
  prescritas: number | null,
): ValidacionFraccion {
  if (!pres.fraccionable) return { valida: false, motivo: 'NO_FRACCIONABLE' };
  const f = parseFraccion(pres.fracciones);
  if (!f) return { valida: false, motivo: 'FRACCION_DESCONOCIDA' };
  if (!Number.isInteger(unidades) || unidades < f.unidades || unidades % f.unidades !== 0) return { valida: false, motivo: 'NO_MULTIPLO' };
  // Una fracción es menos que el envase completo (si no, se dispensa el envase).
  const total = unidadesEnvase(pres, f);
  if (total !== null && unidades >= total) return { valida: false, motivo: 'SUPERA_ENVASE' };
  if (prescritas !== null && unidades > prescritas) return { valida: false, motivo: 'SUPERA_PRESCRITAS' };
  return { valida: true, motivo: null };
}

/** Unidades de la fracción que contiene un envase completo, si se puede saber. */
export function unidadesEnvase(pres: Pick<PresentacionInfo, 'contenido' | 'unidadContenido'>, f: FraccionAutorizada): number | null {
  const unidadEnvase = pres.unidadContenido ? singular(normalizeText(pres.unidadContenido).split(' ')[0] as string) : null;
  const contenido = pres.contenido !== null ? Number(pres.contenido) : NaN;
  if (unidadEnvase === f.unidad && Number.isFinite(contenido)) return contenido;
  return f.fraccionesEnvase !== null ? f.fraccionesEnvase * f.unidades : null;
}

const TIPOS_ENVASE = ['caja', 'frasco', 'vial', 'blister', 'bolsa', 'bidon', 'tubo', 'sobre', 'bote', 'botella', 'estuche', 'saco', 'jeringa', 'pipeta', 'cartucho', 'envase', 'aplicador', 'lata', 'cubo'];
const TILDES: Record<string, string> = { blister: 'blíster', bidon: 'bidón' };

/** Tipo de envase a partir del nombre de la presentación ("…, Caja con 2 Blisters…" → "caja"). */
export function tipoEnvase(nombrePresentacion: string): string {
  const tras = nombrePresentacion.includes(',') ? nombrePresentacion.slice(nombrePresentacion.indexOf(',') + 1) : '';
  const palabras = normalizeText(tras).split(/[^a-z]+/);
  const t = palabras.find((p) => TIPOS_ENVASE.includes(p) || TIPOS_ENVASE.includes(p.replace(/(es|s)$/, '')));
  const base = t ? (TIPOS_ENVASE.includes(t) ? t : t.replace(/(es|s)$/, '')) : 'envase';
  return TILDES[base] ?? base;
}

const ABREVIADAS = /^(ml|l|g|mg|kg|ui|%|dosis)$/i;
function plural(unidad: string, n: number): string {
  const u = unidad.toLowerCase();
  if (n === 1 || ABREVIADAS.test(u) || /s$/.test(u)) return u;
  return /[aeiou]$/.test(u) ? `${u}s` : `${u}es`;
}
const num = (n: number) => String(n).replace('.', ',');

/**
 * Texto de UNIDADES DISPENSADAS del registro de salidas: "1 caja 20 comprimidos", "1 frasco 10 ml",
 * "2 cajas 28 comprimidos"; en fracción, "14 comprimidos (fracción de caja 28 comprimidos)".
 */
export function textoUnidadesDispensadas(
  pres: Pick<PresentacionInfo, 'nombre' | 'contenido' | 'unidadContenido'>,
  d: { envases: number } | { unidadesForma: number; unidad?: string },
): string {
  const tipo = tipoEnvase(pres.nombre);
  const contenido = pres.contenido !== null ? Number(pres.contenido) : null;
  const unidad = pres.unidadContenido;
  const descEnvase = contenido !== null && Number.isFinite(contenido) && unidad ? `${num(contenido)} ${plural(unidad, contenido)}` : null;
  if ('envases' in d) {
    const t = d.envases === 1 ? tipo : plural(tipo, d.envases);
    return descEnvase ? `${d.envases} ${t} ${descEnvase}` : `${d.envases} ${t}`;
  }
  const u = d.unidad ?? unidad ?? 'unidad';
  return `${d.unidadesForma} ${plural(u, d.unidadesForma)} (fracción de ${tipo}${descEnvase ? ` ${descEnvase}` : ''})`;
}
