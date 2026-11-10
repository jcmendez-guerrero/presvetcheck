import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

/**
 * Sesión con Entra simulada (sin llamar a Microsoft ni a Azure): se responde a /api/config/publica con
 * authMode 'entra', a /.auth/* y a /api/me con respuestas configurables. El resto de /api se pasa a la API real
 * (AUTH_MODE=dev) como la empleada, o se responde 401 para simular una sesión caducada.
 * Ver specs/009-fix-session-expiry-sso/quickstart.md.
 */
type Respuesta = number | 'abort' | 'pendiente' | 'redireccion' | Record<string, unknown>;

const USUARIO = { id: 'u1', nombre: 'Empleada', roles: ['empleado'], mfa: false };
const NO_AUTORIZADO = { error: { code: 'NO_AUTORIZADO' } };

async function modoEntra(
  contexto: BrowserContext,
  opciones: { me?: Respuesta[]; refresh?: number; config?: Array<Respuesta | 'real'> } = {},
) {
  const estado = {
    me: opciones.me ?? [USUARIO],
    refresh: opciones.refresh ?? 401,
    /** Peticiones a /api (salvo /api/me y la config) que responderán 401 antes de volver a funcionar. */
    resto401: 0,
  };
  const reg = {
    login: [] as string[],
    auth: [] as string[],
    refresh: 0,
    config: 0,
    cabecerasMe: [] as Record<string, string>[],
  };
  let iMe = 0;
  let iConfig = 0;
  const config = opciones.config ?? ['real'];

  const responder = async (route: Route, r: Respuesta) => {
    if (r === 'pendiente') return; // la petición queda sin respuesta
    if (r === 'abort') return route.abort();
    // La plataforma sin X-Requested-With: 302 al inicio de sesión de Microsoft.
    if (r === 'redireccion')
      return route.fulfill({ status: 302, headers: { location: 'https://login.example.test/' } });
    if (typeof r === 'number')
      return route.fulfill({ status: r, json: r === 401 ? NO_AUTORIZADO : { error: {} } });
    return route.fulfill({ json: r });
  };

  await contexto.route(
    (u) => u.pathname.startsWith('/api/') || u.pathname.startsWith('/.auth/'),
    async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      if (p.startsWith('/.auth/')) reg.auth.push(p);
      if (p === '/api/config/publica') {
        reg.config++;
        const c = config[Math.min(iConfig++, config.length - 1)] ?? 'real';
        if (c !== 'real') return responder(route, c);
        const r = await route.fetch();
        return route.fulfill({ response: r, json: { ...(await r.json()), authMode: 'entra' } });
      }
      if (p === '/.auth/me') return route.fulfill({ json: [{ id_token: 't1' }] });
      if (p === '/.auth/refresh') {
        reg.refresh++;
        return route.fulfill({ status: estado.refresh, body: '' });
      }
      if (p.startsWith('/.auth/')) {
        reg.login.push(`${p}${url.search}`);
        return route.fulfill({ contentType: 'text/html', body: '<p>Microsoft</p>' });
      }
      if (p === '/api/me') {
        reg.cabecerasMe.push(route.request().headers());
        const r = estado.me[Math.min(iMe++, estado.me.length - 1)] ?? USUARIO;
        return responder(route, r);
      }
      // Solo peticiones del cliente de la API (no imágenes ni flujos de eventos, que no renuevan la sesión).
      if (estado.resto401 > 0 && route.request().headers()['x-requested-with']) {
        estado.resto401--;
        return route.fulfill({ status: 401, json: NO_AUTORIZADO });
      }
      return route.continue({ headers: { ...route.request().headers(), 'x-dev-user': 'dev-empleado' } });
    },
  );
  return { estado, reg };
}

const navegacion = (page: Page) => page.getByRole('navigation', { name: 'Navegación principal' });

// US1 — recarga con la sesión caducada
test('renueva la sesión en silencio y abre la pantalla pedida', async ({ page, context }) => {
  const { reg } = await modoEntra(context, { me: [401, USUARIO], refresh: 200 });
  await page.goto('/recepciones');
  await expect(page.getByRole('heading', { name: 'Recepción de mercancía' })).toBeVisible();
  expect(reg.login).toEqual([]);
  expect(reg.cabecerasMe[0]?.['x-requested-with']).toBe('XMLHttpRequest');
});

test('sin renovación posible, va a Microsoft con la dirección de vuelta', async ({ page, context }) => {
  const { reg } = await modoEntra(context, { me: [401], refresh: 401 });
  await page.goto('/recetas/nueva?x=1');
  await expect.poll(() => reg.login[0]).toContain('post_login_redirect_uri=%2Frecetas%2Fnueva%3Fx%3D1');
});

test('si la plataforma redirige en vez de responder 401, también va a Microsoft', async ({
  page,
  context,
}) => {
  const { reg } = await modoEntra(context, { me: ['redireccion'], refresh: 401 });
  await page.goto('/recepciones');
  await expect.poll(() => reg.login[0]).toContain('post_login_redirect_uri=%2Frecepciones');
  await expect(page.getByText('Conectando con el servidor…')).toHaveCount(0);
});

test('la plataforma rechaza la configuración: va a Microsoft, no a «Conectando…»', async ({
  page,
  context,
}) => {
  const { reg } = await modoEntra(context, { config: [401] });
  await page.goto('/recepciones');
  await expect.poll(() => reg.login[0]).toContain('post_login_redirect_uri=%2Frecepciones');
  await expect(page.getByText('Conectando con el servidor…')).toHaveCount(0);
});

test('la configuración falla una vez y luego responde: se reintenta y abre la pantalla', async ({
  page,
  context,
}) => {
  const { reg } = await modoEntra(context, { config: ['abort', 'real'] });
  await page.goto('/recepciones');
  await expect(page.getByRole('heading', { name: 'Recepción de mercancía' })).toBeVisible({
    timeout: 15_000,
  });
  expect(reg.config).toBe(2);
  expect(reg.login).toEqual([]);
});

test('mientras se comprueba la sesión no se ve nada de la aplicación', async ({ page, context }) => {
  await modoEntra(context, { me: ['pendiente'] });
  await page.goto('/');
  await expect(page.getByText('Iniciando sesión…')).toBeVisible();
  await expect(navegacion(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Cerrar sesión/ })).toHaveCount(0);
});

// US2 — página de acceso
test('protección contra bucles: muestra la página de acceso y el botón inicia sesión', async ({
  page,
  context,
}) => {
  const { reg } = await modoEntra(context, { me: [401], refresh: 401 });
  await page.addInitScript(() => localStorage.setItem('mmx.reintentoLogin', String(Date.now())));
  await page.goto('/registros');
  await expect(page.getByRole('heading', { name: 'Tu sesión ha terminado' })).toBeVisible();
  expect(reg.login).toEqual([]);
  await page.getByRole('button', { name: 'Iniciar sesión con Microsoft' }).click();
  await expect.poll(() => reg.login[0]).toContain('post_login_redirect_uri=%2Fregistros');
});

test('tras cerrar sesión no se vuelve a entrar al recargar ni en otra pestaña', async ({ page, context }) => {
  const { reg } = await modoEntra(context, { me: [401], refresh: 401 });
  await context.addInitScript(() => localStorage.setItem('mmx.sesionCerrada', '1'));
  await page.goto('/');
  const titulo = page.getByRole('heading', { name: 'Tu sesión ha terminado' });
  await expect(titulo).toBeVisible();
  await page.reload();
  await expect(titulo).toBeVisible();
  await page.reload();
  await expect(titulo).toBeVisible();
  const otra = await context.newPage();
  await otra.goto('/');
  await expect(otra.getByRole('heading', { name: 'Tu sesión ha terminado' })).toBeVisible();
  expect(reg.login).toEqual([]);
});

test('cuenta sin roles: mensaje de sin acceso y sin menú', async ({ page, context }) => {
  await modoEntra(context, { me: [{ ...USUARIO, roles: [] }] });
  await page.goto('/');
  await expect(page.getByText(/no tiene acceso/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(navegacion(page)).toHaveCount(0);
});

test('servidor caído: «Conectando con el servidor…» sin ir a Microsoft', async ({ page, context }) => {
  const { reg } = await modoEntra(context, { me: ['abort', 503, USUARIO] });
  await page.goto('/recepciones');
  await expect(page.getByText('Conectando con el servidor…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recepción de mercancía' })).toBeVisible({
    timeout: 15_000,
  });
  expect(reg.login).toEqual([]);
});

test('una comprobación que no responde no deja «Iniciando sesión…» para siempre', async ({
  page,
  context,
}) => {
  await modoEntra(context, { me: ['pendiente'] });
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByText('Iniciando sesión…')).toBeVisible();
  await page.clock.fastForward(16_000);
  await expect(page.getByText('Conectando con el servidor…')).toBeVisible();
  await expect(page.getByText('Iniciando sesión…')).toHaveCount(0);
});

test('varias pestañas: solo una redirige a Microsoft', async ({ page, context }) => {
  const { reg } = await modoEntra(context, { me: [401], refresh: 401 });
  await page.goto('/');
  await expect.poll(() => reg.login.length).toBe(1);
  const otra = await context.newPage();
  await otra.goto('/');
  await expect(otra.getByRole('heading', { name: 'Tu sesión ha terminado' })).toBeVisible();
  expect(reg.login.length).toBe(1);
});

// US3 — la sesión caduca mientras se trabaja
test('caducidad durante el uso: aviso bloqueante y vuelta a la pantalla', async ({ page, context }) => {
  const { estado, reg } = await modoEntra(context);
  await page.goto('/registros');
  await expect(page.getByRole('heading', { name: 'Registros y reportes' })).toBeVisible();
  estado.resto401 = 1_000;
  estado.refresh = 401;
  // Recepciones carga su lista al abrirse: esa petición recibe el 401. Se envía el clic al enlace directamente
  // porque una consulta periódica puede abrir el aviso antes y taparlo.
  await navegacion(page).getByRole('link', { name: 'Recepciones', exact: true }).dispatchEvent('click');
  const aviso = page.getByRole('alertdialog');
  await expect(aviso).toContainText('Tu sesión ha caducado');
  await expect(aviso).toContainText('Los cambios sin guardar');
  const boton = aviso.getByRole('button', { name: 'Volver a iniciar sesión' });
  await expect(boton).toBeFocused();
  expect(reg.refresh).toBe(1);
  await boton.click();
  await expect.poll(() => reg.login[0]).toContain('post_login_redirect_uri=%2Frecepciones');
});

test('caducidad durante el uso con renovación correcta: sin aviso', async ({ page, context }) => {
  const { estado, reg } = await modoEntra(context);
  await page.goto('/registros');
  await expect(page.getByRole('heading', { name: 'Registros y reportes' })).toBeVisible();
  estado.resto401 = 1;
  estado.refresh = 200;
  await navegacion(page).getByRole('link', { name: 'Recepciones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recepción de mercancía' })).toBeVisible();
  await expect.poll(() => reg.refresh).toBeGreaterThan(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('caducidad durante el uso: renovada pero sigue rechazada, muestra el aviso', async ({
  page,
  context,
}) => {
  const { estado } = await modoEntra(context);
  await page.goto('/registros');
  await expect(page.getByRole('heading', { name: 'Registros y reportes' })).toBeVisible();
  estado.resto401 = 1_000;
  estado.refresh = 200;
  await navegacion(page).getByRole('link', { name: 'Recepciones', exact: true }).dispatchEvent('click');
  await expect(page.getByRole('alertdialog')).toContainText('Tu sesión ha caducado');
});

// FR-011 — la página del móvil no pasa por el inicio de sesión
test('/movil no llama a la autenticación de la plataforma', async ({ page, context }) => {
  const { reg } = await modoEntra(context);
  await page.goto('/movil');
  await page.waitForLoadState('networkidle');
  expect(reg.auth).toEqual([]);
  await expect(page.getByText('Iniciando sesión…')).toHaveCount(0);
});
