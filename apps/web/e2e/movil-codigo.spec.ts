import { expect, test } from '@playwright/test';

// Spec 016: un código leído con el móvil llega al PC; sin campo de escaneo abierto se ve un aviso visible.
// El «móvil» es una petición a la API con el token del emparejamiento (no hay cámara en la prueba).
test('un código del móvil sin campo de escaneo abierto aparece como aviso visible en el PC', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('boton-movil').click();
  await expect(page.getByTestId('qr-movil')).toBeVisible();
  const token = await page.evaluate(
    () => (JSON.parse(sessionStorage.getItem('mmx.movil') ?? 'null') as { token: string } | null)?.token,
  );
  expect(token).toBeTruthy();

  const r = await page.request.post('/api/movil/m/codigos', {
    headers: { 'x-movil-token': token! },
    data: { raw: '(01)08470000570016(17)261130(10)CLV-2611', id: '3f0c2c7e-8d5e-4b53-9d7a-5b1f3c2a9e10' },
  });
  expect(r.status()).toBe(204);
  // Reenviar el mismo id (reintento) también responde 204 y no crea un segundo aviso.
  const otra = await page.request.post('/api/movil/m/codigos', {
    headers: { 'x-movil-token': token! },
    data: { raw: '(01)08470000570016(17)261130(10)CLV-2611', id: '3f0c2c7e-8d5e-4b53-9d7a-5b1f3c2a9e10' },
  });
  expect(otra.status()).toBe(204);

  // El PC consulta cada 1,5 s.
  const aviso = page.getByTestId('aviso-codigo-pendiente');
  await expect(aviso).toBeVisible({ timeout: 10_000 });
  await expect(aviso).toContainText('Usar el código recibido');
  await expect(aviso).toContainText('(01)08470000570016');
  await expect(aviso).not.toContainText('en espera');
});

// Spec 016, US3: sin campo abierto el código espera; al abrir uno se ofrece «Usar el código recibido» (nunca se aplica
// solo) y se entrega una sola vez. Con un campo ya abierto, el código siguiente se entrega directamente.
test('el código recibido se usa solo cuando la persona lo decide y con el campo abierto llega directo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('boton-movil').click();
  await expect(page.getByTestId('qr-movil')).toBeVisible();
  const token = await page.evaluate(
    () => (JSON.parse(sessionStorage.getItem('mmx.movil') ?? 'null') as { token: string } | null)?.token,
  );
  expect(token).toBeTruthy();
  await page.getByRole('dialog', { name: 'Usar el móvil' }).getByRole('button', { name: 'Cerrar' }).click();

  const enviar = (raw: string) =>
    page.request.post('/api/movil/m/codigos', { headers: { 'x-movil-token': token! }, data: { raw } });
  expect((await enviar('01084700057001681726113010CLV-2611')).status()).toBe(204);
  await expect(page.getByTestId('aviso-codigo-pendiente')).toBeVisible({ timeout: 10_000 });

  // Navegación dentro de la app (el código pendiente vive en la memoria de la pestaña).
  await page.getByRole('link', { name: 'Venta Mostrador' }).first().click();
  const usar = page.getByTestId('usar-codigo-recibido');
  await expect(usar).toBeVisible();
  // No se ha aplicado solo.
  await expect(page.getByRole('textbox', { name: 'Código nacional', exact: true })).toHaveValue('');
  await usar.click();
  await expect(page.getByRole('textbox', { name: 'Código nacional', exact: true })).toHaveValue('570016');
  // Se entrega una sola vez: ni el botón ni el aviso siguen.
  await expect(usar).toBeHidden();
  await expect(page.getByTestId('aviso-codigo-pendiente')).toBeHidden();

  // Con el campo abierto, el código siguiente llega directo: no pasa por pendientes.
  expect((await enviar('01084700057001681726113010CLV-2611')).status()).toBe(204);
  await page.waitForTimeout(3500); // dos consultas del PC (cada 1,5 s)
  await expect(usar).toBeHidden();
  await expect(page.getByTestId('aviso-codigo-pendiente')).toBeHidden();
});
