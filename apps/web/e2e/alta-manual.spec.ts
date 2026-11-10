import { expect, test } from '@playwright/test';

/** Alta manual de recetas sin imagen (specs/011): solo la veterinaria responsable. */
test.describe('Alta manual de receta', () => {
  test('la empleada no ve la opción', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Hola, Empleada/ })).toBeVisible();
    await expect(page.getByTestId('boton-alta-manual')).toHaveCount(0);
  });

  test('la veterinaria da de alta una receta sin imagen y llega a la revisión', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mmx.devUser', 'dev-veterinaria'));
    await page.goto('/');
    await page.getByTestId('boton-alta-manual').click();
    await expect(page.getByRole('heading', { name: 'Alta manual de receta' })).toBeVisible();

    // Sin motivo suficiente ni custodia, no se puede continuar.
    await expect(page.getByTestId('alta-continuar')).toBeDisabled();
    await page.getByTestId('alta-motivo').fill('Dispensada con la aplicación caída');
    await page.getByTestId('alta-custodia').fill('Archivador de recetas de octubre');
    await page.getByTestId('alta-continuar').click();

    // Revisión sin imagen: aviso con motivo y custodia, y la fecha de entrega.
    await expect(page.getByRole('heading', { name: 'Revisión de datos' })).toBeVisible();
    await expect(page.getByText('Receta dada de alta a mano, sin imagen')).toBeVisible();
    await expect(page.getByText('Archivador de recetas de octubre')).toBeVisible();
    await expect(page.getByTestId('fecha-entrega')).toBeVisible();
  });
});
