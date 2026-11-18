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
