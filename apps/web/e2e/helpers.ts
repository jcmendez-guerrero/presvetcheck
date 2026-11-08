/**
 * Utilidades compartidas para pruebas E2E en Playwright
 * PresVetCheck - Mundo Mascotix
 */

export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Calcula si dos cajas delimitadoras colisionan en el plano 2D.
 * Se aplica una tolerancia de 1px para evitar falsos positivos por redondeo de bordes adyacentes.
 */
export function doBoxesCollide(a: BoundingBox, b: BoundingBox, tolerance = 1): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }
  const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return xOverlap > tolerance && yOverlap > tolerance;
}

/**
 * Parsea colores en formato rgb(...), rgba(...) o hexadecimal (#hex).
 */
export function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  const c = color.trim().toLowerCase();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: 1,
      };
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  const match = c.match(
    /rgba?\s*\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[/,]\s*([\d.]+))?\s*\)/,
  );
  if (match && match[1] && match[2] && match[3]) {
    return {
      r: parseFloat(match[1]),
      g: parseFloat(match[2]),
      b: parseFloat(match[3]),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1,
    };
  }

  const oklchMatch = c.match(/oklch\s*\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)/);
  if (oklchMatch && oklchMatch[1] && oklchMatch[3] && oklchMatch[4]) {
    let L = parseFloat(oklchMatch[1]);
    if (oklchMatch[2] === '%') L /= 100;
    const C = parseFloat(oklchMatch[3]);
    const H = parseFloat(oklchMatch[4]);
    const hRad = (H * Math.PI) / 180;
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);

    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const rLin = +4.0767434721 * l - 3.3077115913 * m + 0.2309699292 * s;
    const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

    const toGamma = (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    };

    let alpha = 1;
    if (oklchMatch[5]) {
      const aVal = oklchMatch[5];
      alpha = aVal.endsWith('%') ? parseFloat(aVal) / 100 : parseFloat(aVal);
    }

    return {
      r: Math.round(toGamma(rLin) * 255),
      g: Math.round(toGamma(gLin) * 255),
      b: Math.round(toGamma(bLin) * 255),
      a: alpha,
    };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Convierte un canal de color sRGB a espacio lineal según fórmula WCAG 2.1 / ITU-R BT.709
 */
export function sRGBtoLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

/**
 * Calcula la luminancia relativa según fórmula estándar WCAG 2.1
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

/**
 * Calcula el ratio de contraste entre dos luminancias relativas (1:1 a 21:1).
 */
export function contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Mezcla un color en primer plano con canal alfa sobre un color de fondo opaco.
 */
export function compositeColor(
  fg: { r: number; g: number; b: number; a: number },
  bg: { r: number; g: number; b: number; a: number },
): { r: number; g: number; b: number } {
  const alpha = fg.a;
  return {
    r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
    g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
    b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
  };
}
