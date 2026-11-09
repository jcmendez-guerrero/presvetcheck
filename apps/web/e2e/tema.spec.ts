import { expect, test } from '@playwright/test';

test.describe('Conmutación de Temas y Persistencia (AC 1.4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[role="radiogroup"], header');
  });

  test('conmuta a modo Claro aplicando clases y persistiendo en localStorage', async ({ page }) => {
    // Localizar botón de tema claro
    const botonClaro = page.locator('button[aria-label*="claro" i], button[title*="claro" i]').first();
    await expect(botonClaro).toBeVisible();

    // Hacer clic en Modo Claro
    await botonClaro.click();

    // Comprobar que <html> NO tiene la clase dark
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // Comprobar valor en localStorage
    const valorAlmacenado = await page.evaluate(() => localStorage.getItem('mmx-tema-ui'));
    expect(valorAlmacenado).toBe('claro');
  });

  test('conmuta a modo Oscuro aplicando la clase .dark y persistiendo en localStorage', async ({ page }) => {
    // Localizar botón de tema oscuro
    const botonOscuro = page.locator('button[aria-label*="oscuro" i], button[title*="oscuro" i]').first();
    await expect(botonOscuro).toBeVisible();

    // Hacer clic en Modo Oscuro
    await botonOscuro.click();

    // Comprobar que <html> TIENE la clase dark
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Comprobar valor en localStorage
    const valorAlmacenado = await page.evaluate(() => localStorage.getItem('mmx-tema-ui'));
    expect(valorAlmacenado).toBe('oscuro');
  });

  test('conmuta a modo Sistema adaptándose a la preferencia del navegador', async ({ page }) => {
    // Localizar botón de tema sistema
    const botonSistema = page.locator('button[aria-label*="sistema" i], button[title*="sistema" i]').first();
    await expect(botonSistema).toBeVisible();

    // Emular preferencia de sistema oscuro
    await page.emulateMedia({ colorScheme: 'dark' });
    await botonSistema.click();

    await expect(page.locator('html')).toHaveClass(/dark/);
    const valorAlmacenado = await page.evaluate(() => localStorage.getItem('mmx-tema-ui'));
    expect(valorAlmacenado).toBe('sistema');

    // Emular preferencia de sistema claro
    await page.emulateMedia({ colorScheme: 'light' });
    // Al cambiar la media query en modo sistema, debe adaptarse
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('persiste la preferencia tras recargar la página sin parpadeo (sin FOUC)', async ({ page }) => {
    // 1. Establecer en Oscuro
    const botonOscuro = page.locator('button[aria-label*="oscuro" i], button[title*="oscuro" i]').first();
    await botonOscuro.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // 2. Recargar página
    await page.reload();

    // Comprobar que .dark está presente inmediatamente en <html>
    const esOscuroInmediato = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(esOscuroInmediato, 'El tema oscuro debe persistir de inmediato al recargar').toBe(true);

    // 3. Establecer en Claro
    const botonClaro = page.locator('button[aria-label*="claro" i], button[title*="claro" i]').first();
    await botonClaro.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // 4. Recargar página
    await page.reload();

    // Comprobar que .dark NO está presente inmediatamente en <html>
    const esClaroInmediato = await page.evaluate(() => !document.documentElement.classList.contains('dark'));
    expect(esClaroInmediato, 'El tema claro debe persistir de inmediato al recargar').toBe(true);
  });
});
