import { expect, test } from '@playwright/test';
import { doBoxesCollide, type BoundingBox } from './helpers';

const VIEWPORTS = [
  { nombre: '320x568 (Móvil ultra-compacto)', width: 320, height: 568 },
  { nombre: '375x667 (Móvil estándar)', width: 375, height: 667 },
  { nombre: '768x1024 (Tablet vertical)', width: 768, height: 1024 },
  { nombre: '1024x768 (Tablet mostrador / TPV)', width: 1024, height: 768 },
  { nombre: '1440x900 (Escritorio estándar)', width: 1440, height: 900 },
  { nombre: '1920x1080 (Full HD)', width: 1920, height: 1080 },
  { nombre: '3840x2160 (4K Ultra-wide)', width: 3840, height: 2160 },
] as const;

test.describe('Layout Responsive y Ausencia de Superposiciones (AC 1.1)', () => {
  for (const vp of VIEWPORTS) {
    test(`sin desbordamiento horizontal en ${vp.nombre}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // Esperar a que la página cargue el encabezado
      await page.waitForSelector('header, nav, [data-testid="usuario-dev"]');

      // Verificar que el ancho de scroll no excede el ancho de la ventana
      const desbordamientoHorizontal = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth > window.innerWidth;
      });

      expect(
        desbordamientoHorizontal,
        `Se detectó desbordamiento horizontal (scrollWidth > innerWidth) en ${vp.nombre}`,
      ).toBe(false);
    });

    test(`elementos de cabecera y marca no colisionan en ${vp.nombre}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      await page.waitForSelector('header');

      // Obtener cajas delimitadoras de elementos clave en la cabecera / barra superior
      const elementos = await page.evaluate(() => {
        const resultado: Record<string, BoundingBox | null> = {};

        // 1. Logotipo o enlace principal de marca
        const logo =
          document.querySelector(
            'header a[href="/"], header .logo-clearspace, header img[alt*="Mascotix"]',
          ) ?? document.querySelector('header img');
        if (logo) {
          const r = logo.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            resultado.logo = {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }
        }

        // 2. Subtítulo institucional "Medicamentos Veterinarios" (si está visible)
        const todosLosSpans = Array.from(document.querySelectorAll('header span, header p'));
        const subtitulo = todosLosSpans.find((el) => el.textContent?.includes('Medicamentos Veterinarios'));
        if (subtitulo) {
          const r = subtitulo.getBoundingClientRect();
          const estilo = window.getComputedStyle(subtitulo);
          if (r.width > 0 && r.height > 0 && estilo.display !== 'none' && estilo.visibility !== 'hidden') {
            resultado.subtitulo = {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }
        }

        // 3. Barra de navegación si reside en cabecera o primer elemento interactivo de navegación
        const nav = document.querySelector('header nav');
        if (nav) {
          const r = nav.getBoundingClientRect();
          const estilo = window.getComputedStyle(nav);
          if (r.width > 0 && r.height > 0 && estilo.display !== 'none' && estilo.visibility !== 'hidden') {
            resultado.nav = {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }
        }

        // 4. Buscador rápido / paleta ⌘K en Topbar (si existe)
        const todosLosBotones = Array.from(
          document.querySelectorAll('header button, [data-testid="busqueda-rapida"]'),
        );
        const buscador =
          document.querySelector('[data-testid="busqueda-rapida"]') ??
          todosLosBotones.find(
            (b) =>
              b.textContent?.includes('⌘K') || b.getAttribute('aria-label')?.toLowerCase().includes('buscar'),
          );
        if (buscador) {
          const r = buscador.getBoundingClientRect();
          const estilo = window.getComputedStyle(buscador);
          if (r.width > 0 && r.height > 0 && estilo.display !== 'none') {
            resultado.buscador = {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }
        }

        // 5. Controles de usuario / selector dev
        const usuarioDev = document.querySelector('[data-testid="usuario-dev"]');
        if (usuarioDev) {
          const r = usuarioDev.getBoundingClientRect();
          const estilo = window.getComputedStyle(usuarioDev);
          if (r.width > 0 && r.height > 0 && estilo.display !== 'none') {
            resultado.usuarioDev = {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }
        }

        // 6. Selector de tema visual
        const tema = document.querySelector('header [role="radiogroup"]');
        if (tema) {
          const r = tema.getBoundingClientRect();
          const estilo = window.getComputedStyle(tema);
          if (r.width > 0 && r.height > 0 && estilo.display !== 'none') {
            resultado.tema = {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }
        }

        return resultado;
      });

      // Validar ausencia de colisiones entre pares visibles
      const paresAComprobar: Array<[string, string]> = [
        ['subtitulo', 'nav'],
        ['subtitulo', 'buscador'],
        ['subtitulo', 'usuarioDev'],
        ['nav', 'usuarioDev'],
        ['buscador', 'tema'],
        ['buscador', 'usuarioDev'],
      ];

      for (const [idA, idB] of paresAComprobar) {
        const boxA = elementos[idA];
        const boxB = elementos[idB];

        if (boxA && boxB) {
          const colisiona = doBoxesCollide(boxA, boxB);
          expect(colisiona, `Colisión detectada en ${vp.nombre} entre [${idA}] y [${idB}]`).toBe(false);
        }
      }
    });
  }
});
