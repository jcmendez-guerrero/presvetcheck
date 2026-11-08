import { expect, test } from '@playwright/test';
import { compositeColor, contrastRatio, parseColor, relativeLuminance } from './helpers';

test.describe('Contraste Cromático WCAG 2.1 AA en Modo Claro y Oscuro (AC 2.1)', () => {
  test('evaluación matemática de ratios de contraste en Modo Claro (≥ 4.5:1 texto, ≥ 3:1 UI)', async ({ page }) => {
    await page.goto('/');
    // Activar tema claro
    const botonClaro = page.locator('button[aria-label*="claro" i], button[title*="claro" i]').first();
    await botonClaro.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // Evaluar pares de colores en elementos renderizados
    const resultados = await page.evaluate(() => {
      function getEffectiveBg(el: HTMLElement): string {
        let actual: HTMLElement | null = el;
        while (actual && actual !== document.documentElement) {
          const bg = window.getComputedStyle(actual).backgroundColor;
          if (bg && bg !== 'transparent' && !bg.includes('rgba(0, 0, 0, 0)')) {
            return bg;
          }
          actual = actual.parentElement;
        }
        return window.getComputedStyle(document.body).backgroundColor || 'rgb(244, 248, 249)';
      }

      const evaluaciones: Array<{ selector: string; fg: string; bg: string; fontSize: number; isBold: boolean }> = [];

      // 1. Texto del cuerpo / párrafos
      const p = document.querySelector('main p, main span');
      if (p) {
        const cs = window.getComputedStyle(p);
        evaluaciones.push({
          selector: 'Texto estándar (p/span)',
          fg: cs.color,
          bg: getEffectiveBg(p as HTMLElement),
          fontSize: parseFloat(cs.fontSize),
          isBold: parseInt(cs.fontWeight, 10) >= 700,
        });
      }

      // 2. Encabezados principales
      const h1 = document.querySelector('h1, h2');
      if (h1) {
        const cs = window.getComputedStyle(h1);
        evaluaciones.push({
          selector: 'Encabezado (h1/h2)',
          fg: cs.color,
          bg: getEffectiveBg(h1 as HTMLElement),
          fontSize: parseFloat(cs.fontSize),
          isBold: parseInt(cs.fontWeight, 10) >= 700,
        });
      }

      // 3. Botón de acción rápida (boton-receta)
      const btn = document.querySelector('[data-testid="boton-receta"], main button, main a[href*="receta"]');
      if (btn) {
        const cs = window.getComputedStyle(btn);
        evaluaciones.push({
          selector: 'Botón de acción rápida (texto)',
          fg: cs.color,
          bg: getEffectiveBg(btn as HTMLElement),
          fontSize: parseFloat(cs.fontSize),
          isBold: parseInt(cs.fontWeight, 10) >= 700,
        });
      }

      return evaluaciones;
    });

    expect(resultados.length, 'Debe haber elementos clave evaluados').toBeGreaterThanOrEqual(1);

    for (const item of resultados) {
      const parsedFg = parseColor(item.fg);
      const parsedBg = parseColor(item.bg);
      const compositedFg = parsedFg.a < 1 ? compositeColor(parsedFg, parsedBg) : parsedFg;

      const lumFg = relativeLuminance(compositedFg.r, compositedFg.g, compositedFg.b);
      const lumBg = relativeLuminance(parsedBg.r, parsedBg.g, parsedBg.b);
      const ratio = contrastRatio(lumFg, lumBg);

      // WCAG 2.1 AA: 4.5:1 para texto normal (<18pt / 24px o <14pt / 18.66px negrita), 3.0:1 para texto grande
      const esTextoGrande = item.fontSize >= 24 || (item.fontSize >= 18.66 && item.isBold);
      const ratioRequerido = esTextoGrande ? 3.0 : 4.5;

      expect(
        ratio,
        `Contraste insuficiente en Modo Claro para ${item.selector}: obtenido ${ratio.toFixed(2)}:1, requerido ≥ ${ratioRequerido}:1 (fg: ${item.fg}, bg: ${item.bg})`,
      ).toBeGreaterThanOrEqual(ratioRequerido);
    }
  });

  test('evaluación matemática de ratios de contraste en Modo Oscuro (≥ 4.5:1 texto, ≥ 3:1 UI)', async ({ page }) => {
    await page.goto('/');
    // Activar tema oscuro (emulando media query y conmutador) y esperar a que finalice la transición
    await page.emulateMedia({ colorScheme: 'dark' });
    const botonOscuro = page.locator('button[aria-label*="oscuro" i], button[title*="oscuro" i]').first();
    await botonOscuro.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.waitForTimeout(300);

    const resultados = await page.evaluate(() => {
      function getEffectiveBg(el: HTMLElement): string {
        let actual: HTMLElement | null = el;
        while (actual && actual !== document.documentElement) {
          const bg = window.getComputedStyle(actual).backgroundColor;
          if (bg && bg !== 'transparent' && !bg.includes('rgba(0, 0, 0, 0)')) {
            return bg;
          }
          actual = actual.parentElement;
        }
        return window.getComputedStyle(document.body).backgroundColor || 'rgb(0, 32, 40)';
      }

      const evaluaciones: Array<{ selector: string; fg: string; bg: string; fontSize: number; isBold: boolean }> = [];

      // 1. Texto de cuerpo en modo oscuro
      const p = document.querySelector('main p, main span');
      if (p) {
        const cs = window.getComputedStyle(p);
        evaluaciones.push({
          selector: 'Texto estándar oscuro (p/span)',
          fg: cs.color,
          bg: getEffectiveBg(p as HTMLElement),
          fontSize: parseFloat(cs.fontSize),
          isBold: parseInt(cs.fontWeight, 10) >= 700,
        });
      }

      // 2. Encabezados en modo oscuro
      const h1 = document.querySelector('h1, h2');
      if (h1) {
        const cs = window.getComputedStyle(h1);
        evaluaciones.push({
          selector: 'Encabezado oscuro (h1/h2)',
          fg: cs.color,
          bg: getEffectiveBg(h1 as HTMLElement),
          fontSize: parseFloat(cs.fontSize),
          isBold: parseInt(cs.fontWeight, 10) >= 700,
        });
      }

      // 3. Botón de acción rápida en modo oscuro
      const btn = document.querySelector('[data-testid="boton-receta"], main button, main a[href*="receta"]');
      if (btn) {
        const cs = window.getComputedStyle(btn);
        evaluaciones.push({
          selector: 'Botón de acción rápida oscuro (texto)',
          fg: cs.color,
          bg: getEffectiveBg(btn as HTMLElement),
          fontSize: parseFloat(cs.fontSize),
          isBold: parseInt(cs.fontWeight, 10) >= 700,
        });
      }

      return evaluaciones;
    });

    expect(resultados.length, 'Debe haber elementos clave evaluados en modo oscuro').toBeGreaterThanOrEqual(1);

    for (const item of resultados) {
      const parsedFg = parseColor(item.fg);
      const parsedBg = parseColor(item.bg);
      const compositedFg = parsedFg.a < 1 ? compositeColor(parsedFg, parsedBg) : parsedFg;

      const lumFg = relativeLuminance(compositedFg.r, compositedFg.g, compositedFg.b);
      const lumBg = relativeLuminance(parsedBg.r, parsedBg.g, parsedBg.b);
      const ratio = contrastRatio(lumFg, lumBg);

      const esTextoGrande = item.fontSize >= 24 || (item.fontSize >= 18.66 && item.isBold);
      const ratioRequerido = esTextoGrande ? 3.0 : 4.5;

      expect(
        ratio,
        `Contraste insuficiente en Modo Oscuro para ${item.selector}: obtenido ${ratio.toFixed(2)}:1, requerido ≥ ${ratioRequerido}:1 (fg: ${item.fg}, bg: ${item.bg})`,
      ).toBeGreaterThanOrEqual(ratioRequerido);
    }
  });
});
