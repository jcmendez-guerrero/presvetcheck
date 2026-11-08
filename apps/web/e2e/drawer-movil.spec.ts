import { expect, test } from '@playwright/test';

test.describe('Drawer Móvil Accesible con Trampa de Foco (AC 1.3)', () => {
  test.beforeEach(async ({ page }) => {
    // Configurar viewport móvil
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
  });

  test('el botón hamburguesa abre un diálogo modal accesible', async ({ page }) => {
    // Localizar botón de menú móvil
    const botonMenu = page.locator('button[aria-label*="menú" i], button[aria-label*="Abrir menú"]').first();
    await expect(botonMenu).toBeVisible();

    // Abrir drawer
    await botonMenu.click();

    // Comprobar que existe un diálogo modal con role="dialog" y aria-modal="true"
    const dialogoModal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialogoModal).toBeVisible();

    // Comprobar que tiene etiqueta accesible
    const tieneAriaLabel = await dialogoModal.evaluate((el) => {
      return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
    });
    expect(tieneAriaLabel, 'El diálogo modal debe tener aria-label o aria-labelledby').toBe(true);
  });

  test('la trampa de foco mantiene el foco dentro del drawer al pulsar Tab', async ({ page }) => {
    const botonMenu = page.locator('button[aria-label*="menú" i], button[aria-label*="Abrir menú"]').first();
    await botonMenu.click();

    const dialogoModal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialogoModal).toBeVisible();

    // Obtener todos los elementos interactivos dentro del drawer
    const interactivosDrawer = await dialogoModal.evaluate((dialog) => {
      const selectores =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(dialog.querySelectorAll(selectores)).length;
    });

    expect(
      interactivosDrawer,
      'El drawer debe contener al menos 2 elementos interactivos',
    ).toBeGreaterThanOrEqual(2);

    // Pulsar Tab múltiples veces para dar una vuelta completa a los elementos
    for (let i = 0; i < interactivosDrawer + 2; i++) {
      await page.keyboard.press('Tab');

      // Verificar que el elemento enfocado está contenido dentro del diálogo modal
      const focoEnDrawer = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        const active = document.activeElement;
        return dialog && active ? dialog.contains(active) : false;
      });

      expect(focoEnDrawer, `El foco se escapó fuera del drawer en la iteración ${i + 1}`).toBe(true);
    }
  });

  test('la tecla Escape cierra el drawer y retorna el foco al botón de apertura', async ({ page }) => {
    const botonMenu = page.locator('button[aria-label*="menú" i], button[aria-label*="Abrir menú"]').first();
    await botonMenu.click();

    const dialogoModal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialogoModal).toBeVisible();

    // Pulsar Escape
    await page.keyboard.press('Escape');

    // Comprobar que el drawer se cierra
    await expect(dialogoModal).toBeHidden();

    // Comprobar que el foco retorna al botón de apertura
    await expect(botonMenu).toBeFocused();
  });

  test('el botón de cerrar oculta el drawer', async ({ page }) => {
    const botonMenu = page.locator('button[aria-label*="menú" i], button[aria-label*="Abrir menú"]').first();
    await botonMenu.click();

    const dialogoModal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialogoModal).toBeVisible();

    const botonCerrar = dialogoModal
      .locator('button[aria-label*="Cerrar" i], button[aria-label*="cerrar" i]')
      .first();
    await botonCerrar.click();

    await expect(dialogoModal).toBeHidden();
  });
});
