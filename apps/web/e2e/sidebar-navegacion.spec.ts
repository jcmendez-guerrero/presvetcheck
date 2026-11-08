import { expect, test } from '@playwright/test';

test.describe('Barra Lateral y Navegación por Secciones (AC 1.2)', () => {
  test.beforeEach(async ({ page }) => {
    // Usar resolución de escritorio para verificar la barra lateral
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
  });

  test('muestra las 4 secciones lógicas del flujo veterinario', async ({ page }) => {
    // Esperar a que la navegación esté visible
    const contenedorNav = page
      .locator('aside, nav[aria-label*="lateral" i], nav[aria-label*="Principal" i]')
      .first();
    await expect(contenedorNav).toBeVisible();

    // Comprobar la presencia o encabezados de las 4 secciones lógicas
    // En el Sidebar moderno de PROJECT.md: Dispensación, Operaciones, Registros, Sistema
    const textoNav = await page.evaluate(() => {
      const aside =
        document.querySelector('aside') ??
        document.querySelector('nav[aria-label*="lateral" i], nav[aria-label*="Principal" i]');
      return aside ? (aside.textContent ?? '') : '';
    });

    // Secciones o enlaces clave de las 4 áreas:
    // 1. Dispensación / Recetas
    const tieneDispensacion =
      textoNav.includes('Dispensación') || textoNav.includes('Receta') || textoNav.includes('Inicio');
    expect(tieneDispensacion, 'Debe contener la sección o enlaces de Dispensación').toBe(true);

    // 2. Operaciones / Recepción y Stock
    const tieneOperaciones =
      textoNav.includes('Operaciones') || textoNav.includes('Recepciones') || textoNav.includes('Pendientes');
    expect(tieneOperaciones, 'Debe contener la sección o enlaces de Operaciones').toBe(true);

    // 3. Registros y Consultas
    const tieneRegistros = textoNav.includes('Registros') || textoNav.includes('Vademécum');
    expect(tieneRegistros, 'Debe contener la sección o enlaces de Registros').toBe(true);

    // 4. Sistema / Administración
    const tieneSistema =
      textoNav.includes('Sistema') || textoNav.includes('Administración') || textoNav.includes('Ayuda');
    expect(tieneSistema, 'Debe contener la sección o enlaces de Sistema').toBe(true);
  });

  test('la ruta activa muestra el estilo píldora distintivo', async ({ page }) => {
    // En la página de inicio '/', el enlace a Inicio debe estar activo
    const enlaceInicio = page.locator('nav a[href="/"], aside a[href="/"]').first();
    await expect(enlaceInicio).toBeVisible();

    // Comprobar estilo píldora: aria-current="page" o clases semánticas activas (active / bg-pedir-bg / dark:bg-acento)
    const estadoActivo = await enlaceInicio.evaluate((el) => {
      const ariaCurrent = el.getAttribute('aria-current');
      const classList = Array.from(el.classList);
      const tieneClaseActiva = classList.some(
        (c) => c === 'active' || c.includes('bg-pedir-bg') || c.includes('bg-marca') || c.includes('active:'),
      );
      const esAriaCurrent = ariaCurrent === 'page' || ariaCurrent === 'true';
      return esAriaCurrent || tieneClaseActiva;
    });

    expect(estadoActivo, 'El enlace activo a "/" debe tener estilo distintivo de píldora activa').toBe(true);
  });

  test('la navegación a otras secciones actualiza el estado activo', async ({ page }) => {
    // Navegar a /recepciones
    const enlaceRecepciones = page
      .locator('nav a[href="/recepciones"], aside a[href="/recepciones"]')
      .first();
    if (await enlaceRecepciones.isVisible()) {
      await enlaceRecepciones.click();
      await expect(page).toHaveURL(/\/recepciones/);

      // Comprobar que Recepciones ahora es el activo
      const esRecepcionesActivo = await enlaceRecepciones.evaluate((el) => {
        const ariaCurrent = el.getAttribute('aria-current');
        const classList = Array.from(el.classList);
        return (
          ariaCurrent === 'page' ||
          classList.some((c) => c === 'active' || c.includes('bg-pedir-bg') || c.includes('bg-marca'))
        );
      });
      expect(esRecepcionesActivo, 'El enlace a "/recepciones" debe mostrarse como activo').toBe(true);

      // Comprobar que Inicio ya no es el activo
      const enlaceInicio = page.locator('nav a[href="/"], aside a[href="/"]').first();
      const esInicioActivo = await enlaceInicio.evaluate((el) => {
        const ariaCurrent = el.getAttribute('aria-current');
        const classList = Array.from(el.classList);
        return ariaCurrent === 'page' || classList.includes('active');
      });
      expect(esInicioActivo, 'El enlace a "/" ya no debe mostrarse como activo').toBe(false);
    }
  });
});
