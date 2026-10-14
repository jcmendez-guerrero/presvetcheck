/**
 * Parser de códigos GS1 (DataMatrix GS1, GS1-128, QR GS1) y EAN-13 — SPEC §4.6.
 * Puro y sin dependencias: lo usan la API (`POST /scan/parse`) y la PWA (lector HID y cámara).
 *
 * Identificadores de aplicación soportados (GS1 General Specifications):
 *  - (01) GTIN-14 (fijo 14)           - (17) caducidad AAMMDD, día 00 = último día del mes
 *  - (10) lote (variable ≤ 20)        - (21) nº de serie (variable ≤ 20)
 *  - (11) fecha de fabricación        - (15) consumo preferente AAMMDD
 *  - (240) id adicional (≤ 30)        - (710)-(715) NHRN nacional (≤ 20); (712) = España
 *  - (30) cantidad (≤ 8)
 */

export const GS = '\u001d';

const FIJOS: Record<string, number> = { '01': 14, '02': 14, '11': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
const VARIABLES: Record<string, number> = {
  '10': 20,
  '21': 20,
  '22': 20,
  '30': 8,
  '37': 8,
  '240': 30,
  '241': 30,
  '710': 20,
  '711': 20,
  '712': 20,
  '713': 20,
  '714': 20,
  '715': 20,
};

export type Simbologia = 'datamatrix' | 'gs1-128' | 'qr' | 'ean13' | 'desconocida';

export interface Gs1Ok {
  ok: true;
  simbologia: Simbologia;
  /** GTIN-14 (EAN-13 con un 0 delante). */
  gtin: string | null;
  /** CN por heurística (GTIN-13 español 847000 + 6 dígitos) o por NHRN España (712). Validar contra CIMAVet. */
  cn: string | null;
  cnOrigen: 'heuristica_gtin' | 'nhrn_712' | null;
  lote: string | null;
  /** Caducidad AAAA-MM-DD (día 00 → último día del mes). */
  caducidad: string | null;
  caducidadRaw: string | null;
  serie: string | null;
  ais: Record<string, string>;
  avisos: string[];
}

export interface Gs1Error {
  ok: false;
  error: 'VACIO' | 'FORMATO_DESCONOCIDO' | 'AI_DESCONOCIDO' | 'LONGITUD' | 'GTIN_CONTROL' | 'FECHA_INVALIDA' | 'GS_AUSENTE';
  detalle: string;
}

export type Gs1Resultado = Gs1Ok | Gs1Error;

export interface OpcionesGs1 {
  /** Carácter que el lector HID emite en lugar de GS (ASCII 29), p. ej. `~` o `|` (SCANNER_GS_SUBSTITUTE). */
  gsSubstitute?: string | undefined;
  /** Año de referencia para el siglo de AAMMDD (regla GS1 de ±50 años). Por defecto 2000+AA. */
  anioReferencia?: number | undefined;
}

/** Dígito de control GS1 (módulo 10) válido. */
export function gtinValido(gtin: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(gtin)) return false;
  const digits = gtin.split('').map(Number);
  const check = digits.pop() as number;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Heurística CN desde GTIN-13 español (prefijo 847000 → 6 dígitos siguientes). Marcar como heurística. */
export function cnDesdeGtin(gtin: string | null): string | null {
  if (!gtin) return null;
  const g13 = gtin.length === 14 && gtin.startsWith('0') ? gtin.slice(1) : gtin;
  return /^847000\d{7}$/.test(g13) ? g13.slice(6, 12) : null;
}

function fecha(aammdd: string, anioRef: number | undefined): string | null {
  if (!/^\d{6}$/.test(aammdd)) return null;
  const yy = Number(aammdd.slice(0, 2));
  const mm = Number(aammdd.slice(2, 4));
  const dd = Number(aammdd.slice(4, 6));
  let year = 2000 + yy;
  if (anioRef !== undefined) {
    const diff = yy - (anioRef % 100);
    const siglo = Math.floor(anioRef / 100) * 100;
    year = siglo + yy + (diff >= 51 ? -100 : diff <= -50 ? 100 : 0);
  }
  if (mm < 1 || mm > 12) return null;
  const ultimo = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const dia = dd === 0 ? ultimo : dd;
  if (dia > ultimo) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function quitarPrefijo(raw: string): { s: string; simbologia: Simbologia } {
  const m = /^\](d2|C1|Q3|E0|e0)/.exec(raw);
  if (!m) return { s: raw, simbologia: 'desconocida' };
  const map: Record<string, Simbologia> = { d2: 'datamatrix', C1: 'gs1-128', Q3: 'qr', E0: 'ean13', e0: 'gs1-128' };
  return { s: raw.slice(3), simbologia: map[m[1] as string] as Simbologia };
}

function leerAi(s: string, i: number): string | null {
  for (const len of [2, 3, 4]) {
    const ai = s.slice(i, i + len);
    if (ai in FIJOS || ai in VARIABLES) return ai;
  }
  return null;
}

export function parseGs1(raw: string, opts: OpcionesGs1 = {}): Gs1Resultado {
  let input = raw.replace(/[\r\n]+$/g, '');
  if (opts.gsSubstitute) input = input.split(opts.gsSubstitute).join(GS);
  input = input.trim();
  if (!input) return { ok: false, error: 'VACIO', detalle: 'Código vacío' };
  const { s: sinPrefijo, simbologia: simb } = quitarPrefijo(input);
  let s = sinPrefijo;
  let simbologia = simb;

  // EAN-13 lineal: sin lote ni caducidad (se piden a mano).
  if (/^\d{13}$/.test(s) && (simbologia === 'ean13' || simbologia === 'desconocida')) {
    if (!gtinValido(s)) return { ok: false, error: 'GTIN_CONTROL', detalle: 'Dígito de control EAN-13 incorrecto' };
    const gtin = `0${s}`;
    const cn = cnDesdeGtin(gtin);
    return { ok: true, simbologia: 'ean13', gtin, cn, cnOrigen: cn ? 'heuristica_gtin' : null, lote: null, caducidad: null, caducidadRaw: null, serie: null, ais: {}, avisos: ['SOLO_GTIN'] };
  }

  // Formato legible "(01)…(17)…(10)…": se convierte a cadena con GS.
  if (s.startsWith('(')) {
    const partes = [...s.matchAll(/\((\d{2,4})\)([^(]*)/g)];
    if (!partes.length) return { ok: false, error: 'FORMATO_DESCONOCIDO', detalle: 'Paréntesis sin AI' };
    s = partes.map(([, ai, v]) => `${ai}${(v as string).trim()}${(ai as string) in VARIABLES ? GS : ''}`).join('');
  }
  if (s.startsWith(GS)) s = s.slice(1); // FNC1 inicial
  if (!/^\d{2}/.test(s)) return { ok: false, error: 'FORMATO_DESCONOCIDO', detalle: 'No empieza por un identificador de aplicación' };
  if (simbologia === 'desconocida') simbologia = 'datamatrix';

  const ais: Record<string, string> = {};
  const avisos: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) {
      i++;
      continue;
    }
    const ai = leerAi(s, i);
    if (!ai) return { ok: false, error: 'AI_DESCONOCIDO', detalle: `Identificador desconocido en la posición ${i}: ${s.slice(i, i + 4)}` };
    i += ai.length;
    if (ai in FIJOS) {
      const len = FIJOS[ai] as number;
      const v = s.slice(i, i + len);
      if (v.length !== len || !/^\d+$/.test(v)) return { ok: false, error: 'LONGITUD', detalle: `(${ai}) debe tener ${len} dígitos` };
      ais[ai] = v;
      i += len;
    } else {
      const max = VARIABLES[ai] as number;
      const fin = s.indexOf(GS, i);
      const v = fin === -1 ? s.slice(i) : s.slice(i, fin);
      if (v.length > max) {
        return {
          ok: false,
          error: 'GS_AUSENTE',
          detalle: `(${ai}) supera ${max} caracteres: probablemente el lector no envía el separador GS (configura SCANNER_GS_SUBSTITUTE)`,
        };
      }
      ais[ai] = v;
      i += v.length;
    }
  }

  const gtin = ais['01'] ?? null;
  if (gtin && !gtinValido(gtin)) return { ok: false, error: 'GTIN_CONTROL', detalle: 'Dígito de control del GTIN incorrecto' };
  let caducidad: string | null = null;
  if (ais['17']) {
    caducidad = fecha(ais['17'], opts.anioReferencia);
    if (!caducidad) return { ok: false, error: 'FECHA_INVALIDA', detalle: `Caducidad (17) no válida: ${ais['17']}` };
  }
  const nhrnEs = ais['712'] ? ais['712'].replace(/\D/g, '') : null;
  const cnNhrn = nhrnEs && nhrnEs.length >= 6 ? nhrnEs.slice(0, 6) : null;
  const cnGtin = cnDesdeGtin(gtin);
  if (cnNhrn && cnGtin && cnNhrn !== cnGtin) avisos.push('CN_NHRN_DISTINTO_DE_GTIN');
  if (!ais['10']) avisos.push('SIN_LOTE');
  if (!ais['17']) avisos.push('SIN_CADUCIDAD');
  return {
    ok: true,
    simbologia,
    gtin,
    cn: cnNhrn ?? cnGtin,
    cnOrigen: cnNhrn ? 'nhrn_712' : cnGtin ? 'heuristica_gtin' : null,
    lote: ais['10'] ?? null,
    caducidad,
    caducidadRaw: ais['17'] ?? null,
    serie: ais['21'] ?? null,
    ais,
    avisos,
  };
}

/**
 * Detección de lector HID: una ráfaga de teclas con < 50 ms entre caracteres (SPEC §4.6).
 * Recibe los instantes (ms) de cada tecla.
 */
export function esRafagaLector(tiempos: number[], umbralMs = 50, minCaracteres = 6): boolean {
  if (tiempos.length < minCaracteres) return false;
  for (let k = 1; k < tiempos.length; k++) {
    if ((tiempos[k] as number) - (tiempos[k - 1] as number) >= umbralMs) return false;
  }
  return true;
}

/** Representación legible de los bytes recibidos (pantalla "Probar lector"). */
export function bytesLegibles(raw: string): string {
  return [...raw]
    .map((c) => {
      const code = c.charCodeAt(0);
      if (code === 29) return '<GS>';
      if (code === 13) return '<CR>';
      if (code === 10) return '<LF>';
      if (code < 32) return `<${code}>`;
      return c;
    })
    .join('');
}
