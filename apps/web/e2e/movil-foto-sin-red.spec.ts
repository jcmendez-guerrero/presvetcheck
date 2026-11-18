import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { writeBarcode } from 'zxing-wasm/writer';

/** Leer una foto del código con el móvil sin red: si la lectura falla, la persona debe verlo. */
const GS1 = '(01)08470000570016(17)261130(10)CLV-2611';

async function foto(): Promise<Buffer> {
  const r = await writeBarcode(GS1, { format: 'DataMatrix', scale: 8 });
  if (r.error || !r.image) throw new Error(r.error ?? 'sin imagen');
  return Buffer.from(await r.image.arrayBuffer());
}

async function movilEmparejado(page: Page, browser: Browser) {
  await page.goto('/');
  await page.getByTestId('boton-movil').click();
  await expect(page.getByTestId('qr-movil')).toBeVisible();
  const token = await page.evaluate(
    () => (JSON.parse(sessionStorage.getItem('mmx.movil') ?? 'null') as { token: string } | null)?.token,
  );
  const ctx = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:5174' });
  const movil = await ctx.newPage();
  await movil.goto(`/movil#t=${token}`);
  await expect(movil.getByText(/Conectado al ordenador de/)).toBeVisible();
  return { ctx, movil };
}

test.describe('foto del código sin red', () => {
  test('con el lector ya cargado se lee sin red y se avisa de que no se ha enviado', async ({ page, browser }) => {
    const { ctx, movil } = await movilEmparejado(page, browser);
    const buffer = await foto();
    let n = 0;
    const leer = () =>
      movil.getByLabel('Foto del código').setInputFiles({ name: `dm-${++n}.png`, mimeType: 'image/png', buffer });
    await leer();
    await expect(movil.getByText('Enviado', { exact: true })).toBeVisible({ timeout: 15_000 });
    await ctx.setOffline(true);
    await leer();
    // La lectura no necesita red (sin el arreglo se volvía a pedir el módulo y no salía nada).
    await expect(movil.getByRole('alert').filter({ hasText: 'No se ha enviado' })).toBeVisible();
    await ctx.close();
  });

  test('si el lector no se puede cargar sin red, se explica en vez de quedarse callado', async ({ page, browser }) => {
    const { ctx, movil } = await movilEmparejado(page, browser);
    await ctx.setOffline(true);
    await movil
      .getByLabel('Foto del código')
      .setInputFiles({ name: 'dm.png', mimeType: 'image/png', buffer: await foto() });
    await expect(movil.getByRole('alert')).toContainText('No se ha podido leer el código de la foto');
    await ctx.close();
  });
});
