import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Buscadores de medicamentos (spec 010): indicador «Buscando…», sin resultados, error con reintento, respuestas
 * desfasadas descartadas, lista anterior no seleccionable y pocas peticiones. La búsqueda se intercepta con
 * `page.route`: nunca se llama a CIMAVet.
 */

const item = (nombre: string, cn: string) => ({
  cn,
  nregistro: `R${cn}`,
  nombre,
  medicamento: nombre,
  labtitular: 'Laboratorio de prueba',
  comerc: true,
  autorizadoEspecie: true,
});

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Respuestas falsas según el texto buscado. Devuelve los textos pedidos, para contar peticiones. */
async function simularCatalogo(page: Page) {
  const pedidos: string[] = [];
  let fallos = 0;
  await page.route('**/api/medicamentos/buscar**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    pedidos.push(q);
    const responder = async (cuerpo: unknown, demora = 0, status = 200) => {
      if (demora) await esperar(demora);
      // La petición puede haberse anulado mientras tanto: eso es lo esperado, no un fallo de la prueba.
      await route.fulfill({ status, json: cuerpo }).catch(() => undefined);
    };
    if (q === 'lento') return responder([item('Lento Uno', '900001')], 1000);
    if (q === 'nada') return responder([]);
    if (q === 'falla') {
      fallos += 1;
      return fallos === 1
        ? responder({ error: { code: 'ERROR_INTERNO', mensaje: 'caído' } }, 0, 503)
        : responder([item('Recuperado', '900002')]);
    }
    if (q === 'amoxi') return responder([item('Viejo amoxi', '900003')], 1500);
    if (q === 'amoxicilina') return responder([item('Nuevo amoxicilina', '900004')]);
    if (q === 'amoxicilinax') return responder([item('Ultimo amoxicilinax', '900005')], 1500);
    if (q === 'colgado') return; // el catálogo no responde nunca
    return responder([]);
  });
  return pedidos;
}

interface Buscador {
  campo: Locator;
  estado: Locator;
  lista: Locator;
}

/** La misma batería para cualquier buscador (SC-005). */
async function bateria(page: Page, b: Buscador, pedidos: string[]) {
  const { campo, estado, lista } = b;

  // Historia 1: indicador mientras se busca y lista al terminar.
  await campo.fill('lento');
  await expect(estado).toContainText('Buscando «lento»');
  await expect(campo).toBeEditable(); // el campo nunca se bloquea
  await expect(lista.getByText('Lento Uno')).toBeVisible();
  await expect(estado).not.toContainText('Buscando');

  // Sin resultados.
  await campo.fill('nada');
  await expect(estado).toContainText('No se ha encontrado ningún medicamento');

  // Error y reintento.
  await campo.fill('falla');
  await expect(estado).toContainText('No se ha podido consultar el catálogo');
  await estado.getByTestId('reintentar-busqueda').click();
  await expect(lista.getByText('Recuperado')).toBeVisible();

  // Historia 2: la respuesta lenta de «amoxi» llega después que la de «amoxicilina» y se descarta.
  const salioAmoxi = page.waitForRequest((r) => new URL(r.url()).searchParams.get('q') === 'amoxi');
  await campo.fill('amoxi');
  await salioAmoxi; // la petición de «amoxi» ya ha salido: así se prueba de verdad la carrera
  await campo.fill('amoxicilina');
  await expect(lista.getByText('Nuevo amoxicilina')).toBeVisible();
  await esperar(1500);
  await expect(page.getByText('Viejo amoxi')).toHaveCount(0);

  // La lista anterior se atenúa y no se puede elegir mientras llega la nueva.
  await campo.fill('amoxicilinax');
  await expect(lista).toHaveAttribute('inert', '');
  await expect(lista).toHaveAttribute('aria-busy', 'true');
  await expect(lista.getByText('Ultimo amoxicilinax')).toBeVisible();
  await expect(lista).not.toHaveAttribute('inert');

  // SC-003: escribir seguido no lanza una búsqueda por letra.
  await campo.fill('');
  const antes = pedidos.length;
  await campo.pressSequentially('contadorpp', { delay: 50 });
  await expect(estado).toContainText('No se ha encontrado ningún medicamento');
  expect(pedidos.slice(antes).length).toBeLessThanOrEqual(2);
}

/** Receta demo hasta la revisión (mismo inicio que humo.spec.ts). */
async function abrirRevision(page: Page) {
  await page.goto('/');
  await page.getByTestId('boton-receta').click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    'base64',
  );
  await page
    .getByTestId('subir-receta')
    .setInputFiles({ name: 'receta.png', mimeType: 'image/png', buffer: png });
  await page.getByTestId('enviar-receta').click();
  await expect(page.getByRole('heading', { name: 'Revisión de datos' })).toBeVisible();
}

test.describe('Buscadores de medicamentos', () => {
  test('vademécum, medicamento A', async ({ page }) => {
    const pedidos = await simularCatalogo(page);
    await page.goto('/vademecum');
    await bateria(
      page,
      {
        campo: page.getByTestId('input-med-a'),
        estado: page.getByTestId('estado-busqueda').nth(0),
        lista: page.getByTestId('lista-resultados').first(),
      },
      pedidos,
    );

    // Catálogo colgado: a los 10 s la búsqueda se da por fallida y se ofrece reintentar (FR-003).
    await page.getByTestId('input-med-a').fill('colgado');
    await expect(page.getByTestId('estado-busqueda').nth(0)).toContainText('Buscando «colgado»');
    await expect(page.getByTestId('estado-busqueda').nth(0)).toContainText(
      'No se ha podido consultar el catálogo',
      { timeout: 12_000 },
    );
  });

  test('vademécum, medicamento B', async ({ page }) => {
    const pedidos = await simularCatalogo(page);
    await page.goto('/vademecum');
    await bateria(
      page,
      {
        campo: page.getByTestId('input-med-b'),
        estado: page.getByTestId('estado-busqueda').nth(1),
        lista: page.getByTestId('lista-resultados').first(),
      },
      pedidos,
    );
  });

  test('revisión de la receta', async ({ page }) => {
    await abrirRevision(page);
    const pedidos = await simularCatalogo(page);
    await page.getByRole('button', { name: 'Cambiar', exact: true }).first().click();
    await bateria(
      page,
      {
        campo: page.getByRole('textbox', { name: 'Buscar medicamento' }),
        estado: page.getByTestId('estado-busqueda'),
        lista: page.getByTestId('lista-resultados'),
      },
      pedidos,
    );
  });

  test('buscar sustituto en el resultado', async ({ page }) => {
    await abrirRevision(page);
    await page.getByTestId('especie').selectOption('14');
    await page.getByTestId('firma').check();
    await page.getByTestId('comprobado').check();
    await page.getByTestId('evaluar').click();
    // La comprobación de la receta puede tardar con el servidor recién arrancado.
    await expect(page.getByRole('heading', { name: 'Resultado' })).toBeVisible({ timeout: 30_000 });
    const pedidos = await simularCatalogo(page);
    await page.getByTestId('btn-buscar-sustituto-1').click();
    await bateria(
      page,
      {
        campo: page.getByTestId('input-busqueda-sust-1'),
        estado: page.getByTestId('estado-busqueda'),
        lista: page.getByTestId('lista-resultados'),
      },
      pedidos,
    );
  });

  test('nueva línea de recepción', async ({ page }) => {
    const pedidos = await simularCatalogo(page);
    await page.goto('/recepciones');
    await page.getByRole('button', { name: 'Registrar a mano' }).click();
    await page.getByLabel('Distribuidor').fill('Distribuidor de prueba');
    await page.getByLabel('Nº de albarán o factura').fill(`E2E-${Date.now()}`);
    await page.getByRole('button', { name: 'Empezar recepción' }).click();
    await bateria(
      page,
      {
        campo: page.getByLabel('Nombre del medicamento'),
        estado: page.getByTestId('estado-busqueda'),
        lista: page.getByTestId('lista-resultados'),
      },
      pedidos,
    );
  });
});
