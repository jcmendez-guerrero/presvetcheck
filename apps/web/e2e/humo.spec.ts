import { expect, test } from '@playwright/test';

/** Humo: receta → revisión → resultado → dispensación con EXTRACTOR=fake (datos de demostración). */
test('receta de compañía completa hasta la dispensación', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Hola, Empleada/ })).toBeVisible();
  await page.getByTestId('boton-receta').click();

  // Página de la receta (imagen cualquiera: el extractor falso devuelve la fixture elegida).
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  await page.getByTestId('subir-receta').setInputFiles({ name: 'receta.png', mimeType: 'image/png', buffer: png });
  await page.getByTestId('enviar-receta').click();

  // Revisión: la IA propone, la persona decide.
  await expect(page.getByRole('heading', { name: 'Revisión de datos' })).toBeVisible();
  await expect(page.getByTestId('firma')).not.toBeChecked();
  await page.getByTestId('elegir-570016').click();
  await page.getByTestId('especie').selectOption('14');
  await page.getByTestId('firma').check();
  await page.getByTestId('comprobado').check();
  await page.getByTestId('evaluar').click();

  // Resultado
  await expect(page.getByRole('heading', { name: 'Resultado' })).toBeVisible();
  await expect(page.locator('[data-decision="DISPENSAR"]').first()).toBeVisible();
  await page.getByTestId('dispensar-1').click();

  // Dispensación: lote FEFO y escaneo de un DataMatrix GS1 (lector HID simulado).
  await expect(page.getByTestId('lote-recomendado')).toHaveText('CLV-2611');
  await page.getByTestId('campo-escaneo').fill('01084700057001681726113010CLV-2611');
  await page.getByTestId('campo-escaneo').press('Enter');
  await expect(page.getByLabel('Lote').first()).toHaveValue('CLV-2611');
  await page.getByTestId('confirmar-dispensacion').click();

  await expect(page.getByRole('heading', { name: 'Dispensación registrada' })).toBeVisible();
  await expect(page.locator('[data-recordatorio="tpv"]')).toContainText('CLV-2611');
});
