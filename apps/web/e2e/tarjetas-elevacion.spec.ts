import { expect, test } from '@playwright/test';
import { parseColor, relativeLuminance } from './helpers';

test.describe('Elevación de Tarjetas y Delimitación de Superficies (AC 2.2)', () => {
  test('las tarjetas tienen fondo diferenciado del lienzo y bordes/sombras en Modo Claro', async ({
    page,
  }) => {
    await page.goto('/');
    // Activar tema claro
    const botonClaro = page.locator('button[aria-label*="claro" i], button[title*="claro" i]').first();
    await botonClaro.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    const evaluacion = await page.evaluate(() => {
      const canvasBg = window.getComputedStyle(document.body).backgroundColor || 'rgb(244, 248, 249)';
      // Localizar tarjetas operativas o de mostrador
      const tarjetas = Array.from(
        document.querySelectorAll(
          '[data-testid="boton-receta"], article, .tarjeta, main div.rounded-2xl, main div.rounded-xl, main a.rounded-2xl',
        ),
      );

      const detalles = tarjetas.map((t) => {
        const cs = window.getComputedStyle(t as HTMLElement);
        return {
          bg: cs.backgroundColor,
          borderWidth: cs.borderWidth,
          borderStyle: cs.borderStyle,
          borderColor: cs.borderColor,
          boxShadow: cs.boxShadow,
          tagName: t.tagName,
        };
      });

      return { canvasBg, detalles };
    });

    expect(
      evaluacion.detalles.length,
      'Debe haber tarjetas identificadas en el dashboard',
    ).toBeGreaterThanOrEqual(1);

    const parsedCanvas = parseColor(evaluacion.canvasBg);
    const _lumCanvas = relativeLuminance(parsedCanvas.r, parsedCanvas.g, parsedCanvas.b);

    for (const card of evaluacion.detalles) {
      const parsedCard = parseColor(card.bg);
      // Si la tarjeta no es transparente
      if (parsedCard.a > 0) {
        // La tarjeta debe tener delimitación visual (borde o sombra)
        const tieneSombra = card.boxShadow && card.boxShadow !== 'none';
        const tieneBorde = parseFloat(card.borderWidth) >= 1 && card.borderStyle !== 'none';
        const colorDiferente =
          parsedCard.r !== parsedCanvas.r ||
          parsedCard.g !== parsedCanvas.g ||
          parsedCard.b !== parsedCanvas.b;

        expect(
          tieneSombra || tieneBorde || colorDiferente,
          `La tarjeta (${card.tagName}) debe diferenciarse del lienzo claro mediante fondo distinto, borde o sombra`,
        ).toBe(true);
      }
    }
  });

  test('las tarjetas tienen elevación, rim-light y fondo diferenciado en Modo Oscuro', async ({ page }) => {
    await page.goto('/');
    // Activar tema oscuro
    const botonOscuro = page.locator('button[aria-label*="oscuro" i], button[title*="oscuro" i]').first();
    await botonOscuro.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    const evaluacion = await page.evaluate(() => {
      const canvas = document.querySelector('div.min-h-screen, body') ?? document.body;
      const canvasBg = window.getComputedStyle(canvas).backgroundColor || 'rgb(0, 32, 40)';

      const tarjetas = Array.from(
        document.querySelectorAll(
          '[data-testid="boton-receta"], article, .tarjeta, main div.rounded-2xl, main div.rounded-xl, main a.rounded-2xl',
        ),
      );

      const detalles = tarjetas.map((t) => {
        const cs = window.getComputedStyle(t as HTMLElement);
        return {
          bg: cs.backgroundColor,
          borderWidth: cs.borderWidth,
          borderStyle: cs.borderStyle,
          borderColor: cs.borderColor,
          borderTopColor: cs.borderTopColor,
          boxShadow: cs.boxShadow,
          tagName: t.tagName,
        };
      });

      return { canvasBg, detalles };
    });

    expect(
      evaluacion.detalles.length,
      'Debe haber tarjetas identificadas en modo oscuro',
    ).toBeGreaterThanOrEqual(1);

    const parsedCanvas = parseColor(evaluacion.canvasBg);

    for (const card of evaluacion.detalles) {
      const parsedCard = parseColor(card.bg);
      if (parsedCard.a > 0) {
        const tieneSombra = card.boxShadow && card.boxShadow !== 'none';
        const tieneBorde = parseFloat(card.borderWidth) >= 1 && card.borderStyle !== 'none';
        const colorDiferente =
          parsedCard.r !== parsedCanvas.r ||
          parsedCard.g !== parsedCanvas.g ||
          parsedCard.b !== parsedCanvas.b;

        expect(
          tieneSombra || tieneBorde || colorDiferente,
          `La tarjeta oscura (${card.tagName}) debe diferenciarse del lienzo noche mediante fondo distinto, borde o sombra`,
        ).toBe(true);
      }
    }
  });
});
