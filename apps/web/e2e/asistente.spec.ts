import { expect, test } from '@playwright/test';

/**
 * Humo del asistente de consultas con ASSISTANT=fake (guiones, sin servicio real): duda general con fuente,
 * pregunta sobre una línea de receta con el foco de vuelta en el campo de escaneo, y valoración + historial.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);

test('duda general: respuesta con la fuente citada y simulación del motor', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('asistente-abrir').click();
  const panel = page.getByTestId('asistente-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('No escribas datos del cliente')).toBeVisible();

  await page.getByTestId('asistente-pregunta').fill('¿Cuántos días vale una receta con antibiótico?');
  await page.getByTestId('asistente-enviar').click();
  const r1 = panel.getByTestId('asistente-respuesta').first();
  await expect(r1).toContainText('5 días');
  await expect(r1.getByTestId('asistente-fuente')).toContainText('Plazos de validez');
  await r1.getByTestId('asistente-fuente').click();
  await expect(panel.getByText('antimicrobiano').first()).toBeVisible();

  // Caso hipotético: el motor calcula la fecha y se muestra como «Simulación»; los datos personales se eliminan.
  await page
    .getByTestId('asistente-pregunta')
    .fill(
      'Receta del 3 de octubre con antibiótico, ¿hasta cuándo vale? El cliente tiene el teléfono 612345678',
    );
  await page.getByTestId('asistente-pregunta').press('Enter');
  await expect(panel.getByTestId('asistente-simulacion')).toContainText('Simulación');
  await expect(panel.getByText('Hemos eliminado datos personales')).toBeVisible();

  // Valoración e historial.
  await panel.getByRole('button', { name: 'Útil' }).last().click();
  await expect(panel.getByText('tu valoración queda guardada').last()).toBeVisible();
  await panel.getByRole('link', { name: 'Historial' }).click();
  await expect(page.getByRole('heading', { name: 'Consultas al asistente' })).toBeVisible();
  await expect(page.getByTestId('asistente-lista')).toContainText(
    '¿Cuántos días vale una receta con antibiótico?',
  );
  await expect(page.getByTestId('asistente-lista')).not.toContainText('612345678');
});

test('pregunta sobre una línea: explica el resultado del motor y devuelve el foco al escaneo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('boton-receta').click();
  await page
    .getByTestId('subir-receta')
    .setInputFiles({ name: 'receta.png', mimeType: 'image/png', buffer: PNG });
  await page.getByTestId('enviar-receta').click();
  await expect(page.getByRole('heading', { name: 'Revisión de datos' })).toBeVisible();
  // La app identifica sola el medicamento de la receta de ejemplo; si no, se elige el candidato.
  const elegir = page.getByTestId('elegir-570016');
  if (await elegir.isVisible()) await elegir.click();
  await expect(page.getByText(/Caja de cartón con 2 Blisters/).first()).toBeVisible();
  await page.getByTestId('especie').selectOption('14');
  // La lectura simulada siempre da DEMO-0001 y el test de humo ya la dispensa (misma base en memoria): con otro
  // número no salta «receta en papel ya dispensada».
  await page.getByRole('textbox', { name: /^Nº de receta/ }).fill('DEMO-ASISTENTE-1');
  await page.getByTestId('firma').check();
  await page.getByTestId('comprobado').check();
  await page.getByTestId('evaluar').click();
  await expect(page.getByRole('heading', { name: 'Resultado' })).toBeVisible();
  await expect(page.locator('[data-decision="DISPENSAR"]').first()).toBeVisible();

  // Desde el resultado: botón en la línea.
  await page.getByTestId('asistente-linea').first().click();
  const panel = page.getByTestId('asistente-panel');
  await page.getByTestId('asistente-pregunta').fill('¿Se puede dispensar esto?');
  await page.getByTestId('asistente-enviar').click();
  await expect(panel.getByTestId('asistente-motor')).toContainText('DISPENSAR');
  await expect(panel).not.toContainText('Titular de demostración');
  await panel.getByRole('button', { name: 'Cerrar el asistente' }).click();

  // En dispensación: al cerrar el panel el foco vuelve al campo de escaneo.
  await page.getByTestId('dispensar-1').click();
  const escaneo = page.getByTestId('campo-escaneo');
  await expect(escaneo).toBeFocused();
  await page.getByTestId('asistente-linea').click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(escaneo).toBeFocused();
});

test('con el asistente abierto, Tab en la página no salta al panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('asistente-abrir').click();
  const panel = page.getByTestId('asistente-panel');
  await expect(panel).toBeVisible();

  // El panel no tiene velo: se puede seguir trabajando en la página de al lado.
  await page.getByTestId('boton-movil').focus();
  await page.keyboard.press('Tab');
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(false);
});
