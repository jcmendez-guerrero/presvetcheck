import { expect, test, type Page } from '@playwright/test';

// Regresión 008: el diálogo se pintaba dentro de la cabecera (backdrop-filter) y se salía por arriba.
const ALTURAS = [300, 430, 600, 1080] as const;
const ANCHO = 1280;

async function abrirDialogo(page: Page) {
  await page.goto('/');
  await page.getByTestId('boton-movil').click();
  const dialogo = page.getByRole('dialog', { name: 'Usar el móvil' });
  await expect(dialogo).toBeVisible();
  // El foco inicial va al título: el panel se abre arriba y Enter no desconecta el móvil por accidente.
  await expect(dialogo.getByRole('heading', { name: 'Usar el móvil' })).toBeFocused();
  return dialogo;
}

test.describe('Diálogo «Usar el móvil» cabe en la ventana (spec 008)', () => {
  for (const alto of ALTURAS) {
    test(`ventana de ${alto} px de alto`, async ({ page }) => {
      await page.setViewportSize({ width: ANCHO, height: alto });
      const dialogo = await abrirDialogo(page);

      // El velo cubre toda la ventana y no queda atrapado en la cabecera.
      expect(await dialogo.evaluate((el) => el.parentElement === document.body)).toBe(true);
      const velo = await dialogo.boundingBox();
      expect(velo).toMatchObject({ x: 0, y: 0, width: ANCHO, height: alto });

      // El panel no se sale ni por arriba ni por abajo.
      const panel = await dialogo.locator('> div').boundingBox();
      expect(panel!.y).toBeGreaterThanOrEqual(0);
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(alto + 1);
      await expect(dialogo.getByRole('heading', { name: 'Usar el móvil' })).toBeInViewport();

      // El QR se puede ver entero y los botones se alcanzan.
      const qr = dialogo.getByTestId('qr-movil');
      await qr.scrollIntoViewIfNeeded();
      await expect(qr).toBeInViewport({ ratio: 1 });
      await expect(dialogo.getByRole('button', { name: 'Desconectar el móvil' })).toBeVisible();
      await dialogo.getByRole('button', { name: 'Cerrar' }).click();
      await expect(dialogo).toBeHidden();
    });
  }

  test('teclado: el foco no sale del diálogo y Escape lo cierra', async ({ page }) => {
    await page.setViewportSize({ width: ANCHO, height: 430 });
    const dialogo = await abrirDialogo(page);
    await expect(dialogo.getByTestId('qr-movil')).toBeVisible();

    await page.keyboard.press('Shift+Tab');
    await expect(dialogo.getByRole('button', { name: 'Cerrar' })).toBeFocused();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await dialogo.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
    await expect(page.getByTestId('boton-movil')).toBeFocused();
  });
});
