import Decimal from 'decimal.js';
import { normalizeText } from '@mmx/shared';
import type { Composicion, PresentacionInfo, PrincipioActivo } from './tipos';

/**
 * Normalización de cantidades de CIMAVet (SPEC §4.4.2 punto 1). Las cantidades llegan como
 * texto: se convierten a `{valor: Decimal, unidad canónica}` o se declaran NO normalizables.
 * Unidades canónicas: mg (masa), ml (volumen), UI, %, unidad (formas contables).
 */

export type UnidadCanonica = 'mg' | 'ml' | 'UI' | '%' | 'unidad' | 'cm2';

const MASA: Record<string, number> = { kg: 1e6, g: 1000, mg: 1, ug: 0.001, mcg: 0.001, microgramos: 0.001, ng: 1e-6 };
const VOLUMEN: Record<string, number> = { l: 1000, litro: 1000, litros: 1000, ml: 1, cl: 10, dl: 100 };

/**
 * Formas contables (diccionario de unidades de composición del Nomenclátor): una "unidad"
 * es un comprimido, una cápsula, una pipeta, una dosis… Se compara por nombre normalizado.
 */
const CONTABLES = [
  'comprimido', 'comprimidos', 'comprimidos recubierto', 'comprimido recubierto', 'capsula', 'capsulas', 'pipeta', 'pipetas',
  'dosis', 'vial', 'viales', 'ampolla', 'ampollas', 'unidad', 'unidades', 'sobre', 'sobres', 'bolo', 'collar', 'implante',
  'jeringa', 'jeringa precargada', 'tableta', 'gragea', 'pastilla', 'supositorio', 'ovulo', 'parche', 'chicle', 'caramelo',
  'perla', 'pildora', 'sello', 'tira', 'tampon', 'anillo', 'aplicador', 'cartucho', 'pellet', 'barra', 'crotal', 'oblea',
  'unidad de dosificacion', 'comprimido vaginal', 'pluma', 'pluma precargada', 'liotabas',
].map(normalizeText);

export interface Cantidad {
  valor: Decimal;
  unidad: UnidadCanonica;
}

/** Factor a unidad canónica de una unidad simple ("mg", "ml", "Comprimido"…). */
export function unidadCanonica(u: string | null | undefined): { factor: Decimal; unidad: UnidadCanonica } | null {
  if (!u) return null;
  // «µ» se sustituye antes de normalizar: si no, «µg» se convertiría en «g» (factor ×10⁶).
  const n = normalizeText(u.replace(/[µμ]/g, 'u')).replace(/\.$/, '');
  if (n in MASA) return { factor: new Decimal(MASA[n] as number), unidad: 'mg' };
  if (n in VOLUMEN) return { factor: new Decimal(VOLUMEN[n] as number), unidad: 'ml' };
  if (n === 'ui' || n === 'u.i.' || n === 'u.i') return { factor: new Decimal(1), unidad: 'UI' };
  if (n === '%') return { factor: new Decimal(1), unidad: '%' };
  if (n === 'cm2') return { factor: new Decimal(1), unidad: 'cm2' };
  if (CONTABLES.includes(n)) return { factor: new Decimal(1), unidad: 'unidad' };
  return null;
}

/** Decimal desde texto con coma o punto decimal ("2,5" → 2.5). */
export function parseDecimal(s: string | number | null | undefined): Decimal | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/\s/g, '');
  if (!/^\d+([.,]\d+)?$/.test(t)) return null;
  return new Decimal(t.replace(',', '.'));
}

/** Parsea "500 mg", "0,5 g", "50 mg/ml", "2,5 %" → cantidad + unidad (posiblemente compuesta). */
export function parseCantidadTexto(texto: string | null | undefined): { valor: Decimal; unidad: string } | null {
  if (!texto) return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([^\d\s].*?)\s*$/.exec(texto);
  if (!m) return null;
  const valor = parseDecimal(m[1]);
  return valor ? { valor, unidad: (m[2] as string).trim() } : null;
}

/** Concentración de un principio activo por una unidad canónica de forma (p. ej. mg por comprimido, mg por ml). */
export interface Concentracion {
  valor: Decimal;
  /** Unidad del principio activo (mg, UI, %…). */
  num: UnidadCanonica;
  /** Unidad de la forma (unidad, ml, mg…). */
  den: UnidadCanonica;
}

/**
 * Concentración normalizada de un principio activo. Admite unidades compuestas en el propio
 * PA ("mg/ml") o la base de la composición (cantidad_concentracion + unidad).
 */
export function concentracion(pa: PrincipioActivo, comp: Composicion): Concentracion | null {
  const cantidad = parseDecimal(pa.cantidad);
  if (!cantidad || !pa.unidad) return null;
  const [numTxt, denTxt] = pa.unidad.split('/').map((s) => s.trim());
  const num = unidadCanonica(numTxt);
  if (!num) return null;
  let denCantidad: Decimal | null;
  let den: ReturnType<typeof unidadCanonica>;
  if (denTxt) {
    const parsed = parseCantidadTexto(denTxt) ?? { valor: new Decimal(1), unidad: denTxt };
    denCantidad = parsed.valor;
    den = unidadCanonica(parsed.unidad);
  } else {
    denCantidad = parseDecimal(comp.porCantidad);
    den = unidadCanonica(comp.porUnidad);
  }
  if (!den || !denCantidad || denCantidad.isZero()) return null;
  if (num.unidad === '%') {
    // % no se convierte a masa/volumen (p/p vs p/v): solo comparable con otro %.
    return { valor: cantidad, num: '%', den: '%' };
  }
  const valor = cantidad.mul(num.factor).div(denCantidad.mul(den.factor));
  return { valor, num: num.unidad, den: den.unidad };
}

/** Contenido del envase en unidad canónica (10 comprimidos → 10 unidad; 1 l → 1000 ml). */
export function contenidoEnvase(p: Pick<PresentacionInfo, 'contenido' | 'unidadContenido'>): Cantidad | null {
  const v = parseDecimal(p.contenido);
  const u = unidadCanonica(p.unidadContenido);
  if (!v || !u) return null;
  return { valor: v.mul(u.factor), unidad: u.unidad };
}

/** Cantidad total de principio activo en un envase (concentración × contenido), o null si no es normalizable. */
export function totalPaEnvase(c: Concentracion | null, contenido: Cantidad | null): Decimal | null {
  if (!c || !contenido || c.den === '%' || c.den !== contenido.unidad) return null;
  return c.valor.mul(contenido.valor);
}

/** Texto legible de una concentración ("250 mg"). */
export function textoConcentracion(c: Concentracion): string {
  return `${c.valor.toDecimalPlaces(4).toString()} ${c.num}`;
}
