import { devices, expect, test, type Page } from '@playwright/test';
import { writeBarcode } from 'zxing-wasm/writer';

/**
 * Spec 016 con un «móvil» emulado (perfil Pixel 7) que abre la página real `/movil` y lee un DataMatrix GS1 de una
 * foto con el lector de la propia página. Sustituye a la prueba manual con un móvil de verdad en lo que no depende del
 * hardware (cámara en vivo) ni del entorno desplegado (bloqueos de la plataforma, que solo se ven allí).
 * Cubre los escenarios 1 a 5 y 8 de quickstart.md.
 */
const GS1 = '(01)08470000570016(17)261130(10)CLV-2611';

async function fotoDataMatrix(texto: string): Promise<Buffer> {
  const r = await writeBarcode(texto, { format: 'DataMatrix', scale: 8 });
  if (r.error || !r.image) throw new Error(r.error ?? 'sin imagen');
  return Buffer.from(await r.image.arrayBuffer());
}

test('móvil emulado: leer, fallar sin red, volver a la página, reintentar y emparejamiento cerrado', async ({
  page,
  browser,
}) => {
  // PC: abre el emparejamiento y toma el token (el QR lo leería el móvil).
  await page.goto('/');
  await page.getByTestId('boton-movil').click();
  await expect(page.getByTestId('qr-movil')).toBeVisible();
  const token = await page.evaluate(
    () => (JSON.parse(sessionStorage.getItem('mmx.movil') ?? 'null') as { token: string } | null)?.token,
  );
  expect(token).toBeTruthy();
  await page.getByRole('dialog', { name: 'Usar el móvil' }).getByRole('button', { name: 'Cerrar' }).click();

  // Móvil: perfil de teléfono, página real, sin iniciar sesión.
  const movilCtx = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:5174' });
  const movil: Page = await movilCtx.newPage();
  await movil.goto(`/movil#t=${token}`);
  await expect(movil.getByText(/Conectado al ordenador de/)).toBeVisible();
  const foto = { name: 'dm.png', mimeType: 'image/png', buffer: await fotoDataMatrix(GS1) };
  // Un nombre distinto cada vez: así el navegador siempre ve una foto nueva.
  let n = 0;
  const leer = () => movil.getByLabel('Foto del código').setInputFiles({ ...foto, name: `dm-${++n}.png` });
  const envio = '**/api/movil/m/codigos';

  // 1) Con red: «Enviado» solo tras la respuesta de la API; el código llega al PC como aviso visible.
  await leer();
  await expect(movil.getByText('Enviado', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('aviso-codigo-pendiente')).toContainText('(01)08470000570016', {
    timeout: 10_000,
  });

  // 2) El envío falla (la lectura en el móvil sí funciona): aviso grande «No se ha enviado» con «Reintentar».
  await movil.route(envio, (r) => r.abort('internetdisconnected'));
  await leer();
  const alerta = movil.getByRole('alert').filter({ hasText: 'No se ha enviado' });
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText('comprueba la conexión del móvil');

  // 8) Volver a la página (p. ej. tras bloquear la pantalla): el estado de la última lectura sigue visible.
  await movil.goto('/movil');
  await expect(movil.getByRole('alert').filter({ hasText: 'No se ha enviado' })).toBeVisible();

  // 3) Con red otra vez: «Reintentar» envía el mismo código sin volver a escanear y llega una sola vez.
  await movil.unroute(envio);
  await movil.getByRole('button', { name: 'Reintentar' }).click();
  await expect(movil.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('aviso-codigo-pendiente')).toContainText('1 más en espera', {
    timeout: 10_000,
  });

  // 4) El PC cierra el emparejamiento: el móvil lo explica y no ofrece reintentar.
  await page.getByTestId('boton-movil').click();
  await page.getByRole('button', { name: 'Desconectar el móvil' }).click();
  await leer();
  const caducado = movil.getByRole('alert').filter({ hasText: 'El emparejamiento ha caducado' });
  await expect(caducado).toBeVisible();
  await expect(movil.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);

  await movilCtx.close();
});
