import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Convierte un canal sRGB [0..255] a luminancia lineal según W3C WCAG 2.1.
 */
function sRGBtoLinear(canal: number): number {
  const norm = canal / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

/**
 * Calcula la luminancia relativa (0.0 a 1.0) para un código hexadecimal RGB.
 */
export function luminanciaRelativa(hex: string): number {
  const limpio = hex.replace('#', '').trim();
  const expandido =
    limpio.length === 3
      ? limpio
          .split('')
          .map((c) => c + c)
          .join('')
      : limpio;
  const num = parseInt(expandido, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

/**
 * Calcula el ratio de contraste entre dos colores según W3C WCAG 2.1:
 * Ratio = (L1 + 0.05) / (L2 + 0.05) con L1 >= L2.
 */
export function ratioContraste(hex1: string, hex2: string): number {
  const l1 = luminanciaRelativa(hex1);
  const l2 = luminanciaRelativa(hex2);
  const masClaro = Math.max(l1, l2);
  const masOscuro = Math.min(l1, l2);
  return (masClaro + 0.05) / (masOscuro + 0.05);
}

/**
 * Extrae tokens CSS (--color-*) en formato hexadecimal desde un bloque de texto.
 */
function extraerTokensHex(bloque: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const regex = /(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(bloque)) !== null) {
    if (match[1] && match[2]) {
      tokens[match[1]] = match[2].toLowerCase();
    }
  }
  return tokens;
}

describe('Matemática de Contraste WCAG 2.1 AA', () => {
  it('valida referencias absolutas estándar (blanco y negro)', () => {
    expect(ratioContraste('#ffffff', '#000000')).toBeCloseTo(21.0, 1);
    expect(ratioContraste('#ffffff', '#ffffff')).toBeCloseTo(1.0, 1);
    expect(ratioContraste('#000000', '#000000')).toBeCloseTo(1.0, 1);
  });
});

describe('Tokens de Diseño y Accesibilidad en estilos.css', () => {
  const rutaCss = resolve(__dirname, 'estilos.css');
  const contenidoCss = readFileSync(rutaCss, 'utf-8');

  const bloqueTheme = contenidoCss.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const bloqueDark = contenidoCss.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

  const tokensClaro = extraerTokensHex(bloqueTheme);
  const tokensOscuro = extraerTokensHex(bloqueDark);

  describe('Capa 1: Primitivas Institucionales Mundo Mascotix', () => {
    it('declara los 5 colores corporativos oficiales más el dorado normativo', () => {
      expect(tokensClaro['--color-mmx-petroleo']).toBe('#016581');
      expect(tokensClaro['--color-mmx-azul-medio']).toBe('#2f8198');
      expect(tokensClaro['--color-mmx-turquesa']).toBe('#60abb8');
      expect(tokensClaro['--color-mmx-noche']).toBe('#002028');
      expect(tokensClaro['--color-mmx-hielo']).toBe('#f2f8f9');
      expect(tokensClaro['--color-mmx-dorado']).toBe('#e3a857');
    });
  });

  describe('Capa 2: Tema Claro (Light Theme) — Cumplimiento WCAG 2.1 AA', () => {
    it('texto de lectura principal cumple ratio AAA (>= 7.0:1)', () => {
      const texto = tokensClaro['--color-texto']!;
      const fondo = tokensClaro['--color-fondo']!;
      const superficie = tokensClaro['--color-superficie']!;

      expect(ratioContraste(texto, fondo)).toBeGreaterThanOrEqual(7.0);
      expect(ratioContraste(texto, superficie)).toBeGreaterThanOrEqual(7.0);
    });

    it('texto muted y subtítulos superan WCAG 2.1 AA (>= 4.5:1, resolviendo fallo histórico de #2f8198)', () => {
      const muted = tokensClaro['--color-texto-muted']!;
      const superficie = tokensClaro['--color-superficie']!;
      const fondo = tokensClaro['--color-fondo']!;

      // Anteriormente #2f8198 daba 4.45:1 (fallaba). El nuevo token #1f5d6e debe superar 7:1
      expect(ratioContraste(muted, superficie)).toBeGreaterThanOrEqual(4.5);
      expect(ratioContraste(muted, fondo)).toBeGreaterThanOrEqual(4.5);
    });

    it('texto atenuado cumple ratio WCAG 2.1 AA (>= 4.5:1)', () => {
      const atenuado = tokensClaro['--color-texto-atenuado']!;
      const superficie = tokensClaro['--color-superficie']!;
      const fondo = tokensClaro['--color-fondo']!;

      expect(ratioContraste(atenuado, superficie)).toBeGreaterThanOrEqual(4.5);
      expect(ratioContraste(atenuado, fondo)).toBeGreaterThanOrEqual(4.5);
    });

    it('botón principal y estado hover cumplen ratio WCAG 2.1 AA (>= 4.5:1 con texto blanco)', () => {
      const blanco = '#ffffff';
      const marca = tokensClaro['--color-marca']!;
      const marcaHover = tokensClaro['--color-marca-hover']!;

      expect(ratioContraste(blanco, marca)).toBeGreaterThanOrEqual(4.5);
      expect(ratioContraste(blanco, marcaHover)).toBeGreaterThanOrEqual(4.5);
    });

    it('estados regulatorios en modo claro cumplen ratio WCAG 2.1 AA (>= 4.5:1)', () => {
      expect(
        ratioContraste(tokensClaro['--color-dispensar']!, tokensClaro['--color-dispensar-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensClaro['--color-sustituir']!, tokensClaro['--color-sustituir-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensClaro['--color-noconforme']!, tokensClaro['--color-noconforme-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensClaro['--color-pedir']!, tokensClaro['--color-pedir-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensClaro['--color-dorado']!, tokensClaro['--color-dorado-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensClaro['--color-dorado']!, tokensClaro['--color-superficie']!),
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('Capa 2 y 3: Tema Oscuro (.dark) — Calibración y Elevación', () => {
    it('lienzo y superficie de tarjeta están diferenciados para permitir elevación visual', () => {
      const fondo = tokensOscuro['--color-fondo']!;
      const superficie = tokensOscuro['--color-superficie']!;

      expect(fondo).not.toBe(superficie);
      // El lienzo debe ser más oscuro que la superficie de la tarjeta
      expect(luminanciaRelativa(superficie)).toBeGreaterThan(luminanciaRelativa(fondo));
    });

    it('texto de lectura principal en modo oscuro cumple ratio AAA (>= 7.0:1)', () => {
      const texto = tokensOscuro['--color-texto']!;
      const superficie = tokensOscuro['--color-superficie']!;
      const fondo = tokensOscuro['--color-fondo']!;

      expect(ratioContraste(texto, superficie)).toBeGreaterThanOrEqual(7.0);
      expect(ratioContraste(texto, fondo)).toBeGreaterThanOrEqual(7.0);
    });

    it('texto muted y atenuado en modo oscuro cumplen ratio WCAG 2.1 AA (>= 4.5:1)', () => {
      const muted = tokensOscuro['--color-texto-muted']!;
      const atenuado = tokensOscuro['--color-texto-atenuado']!;
      const superficie = tokensOscuro['--color-superficie']!;

      expect(ratioContraste(muted, superficie)).toBeGreaterThanOrEqual(4.5);
      expect(ratioContraste(atenuado, superficie)).toBeGreaterThanOrEqual(4.5);
    });

    it('botón principal en modo oscuro (píldora turquesa con texto noche) cumple WCAG 2.1 AA (>= 4.5:1)', () => {
      const textoNoche = tokensClaro['--color-mmx-noche']!;
      const marcaOscura = tokensOscuro['--color-marca']!;
      const marcaHoverOscura = tokensOscuro['--color-marca-hover']!;

      expect(ratioContraste(textoNoche, marcaOscura)).toBeGreaterThanOrEqual(4.5);
      expect(ratioContraste(textoNoche, marcaHoverOscura)).toBeGreaterThanOrEqual(4.5);
    });

    it('contornos y elementos de interfaz en modo oscuro cumplen ratio UI (>= 3.0:1)', () => {
      const marca = tokensOscuro['--color-marca']!;
      const superficie = tokensOscuro['--color-superficie']!;

      expect(ratioContraste(marca, superficie)).toBeGreaterThanOrEqual(3.0);
    });

    it('estados regulatorios en modo oscuro cumplen ratio WCAG 2.1 AA (>= 4.5:1)', () => {
      expect(
        ratioContraste(tokensOscuro['--color-dispensar']!, tokensOscuro['--color-dispensar-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensOscuro['--color-sustituir']!, tokensOscuro['--color-sustituir-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensOscuro['--color-noconforme']!, tokensOscuro['--color-noconforme-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensOscuro['--color-pedir']!, tokensOscuro['--color-pedir-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensOscuro['--color-dorado']!, tokensOscuro['--color-dorado-bg']!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioContraste(tokensOscuro['--color-dorado']!, tokensOscuro['--color-superficie']!),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('tooltip informativo con fondo fijo noche (--color-mmx-noche) mantiene ratio AAA (>= 7.0:1) con texto blanco en ambos modos', () => {
      const fondoNoche = tokensClaro['--color-mmx-noche']!;
      const textoBlanco = '#ffffff';

      // bg-mmx-noche (#002028) sobre text-white (#ffffff) rinde 16.97:1 (> 7.0:1)
      expect(ratioContraste(fondoNoche, textoBlanco)).toBeGreaterThanOrEqual(7.0);
    });
  });

  describe('Reglas de Elevación y Sombra en estilos.css', () => {
    it('contiene clases de elevación de tarjeta para modo claro y oscuro con rim light', () => {
      expect(contenidoCss).toContain('.tarjeta-elevada');
      expect(contenidoCss).toContain('.dark .tarjeta-elevada');
      expect(contenidoCss).toContain('box-shadow');
    });
  });
});
