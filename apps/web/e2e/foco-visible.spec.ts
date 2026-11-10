import { expect, test } from '@playwright/test';

test.describe('Navegación por Teclado y Foco Visible (AC 2.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    // La cabecera y el menú solo aparecen con la sesión activa.
    await expect(page.getByRole('heading', { name: /Hola, Empleada/ })).toBeVisible();
  });

  test('el anillo :focus-visible es visible en elementos interactivos', async ({ page }) => {
    // Pulsar Tab sucesivamente para enfocar elementos interactivos
    let elementosComprobados = 0;

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');

      const infoFoco = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || el === document.documentElement) {
          return null;
        }

        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        // Verificar si tiene outline activo o box-shadow de anillo
        const outlineWidth = parseFloat(cs.outlineWidth);
        const tieneOutline = outlineWidth >= 1 && cs.outlineStyle !== 'none';
        const tieneRingShadow =
          cs.boxShadow && cs.boxShadow !== 'none' && !cs.boxShadow.includes('rgba(0, 0, 0, 0)');
        const tieneRingClass = Array.from(el.classList).some(
          (c) => c.includes('focus-visible:ring') || c.includes('ring-'),
        );

        return {
          tagName: el.tagName,
          visible: rect.width > 0 && rect.height > 0,
          outlineWidth,
          tieneOutline,
          tieneRingShadow,
          tieneRingClass,
          rect: {
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          },
        };
      });

      if (infoFoco && infoFoco.visible) {
        elementosComprobados++;
        const focoVisible = infoFoco.tieneOutline || infoFoco.tieneRingShadow || infoFoco.tieneRingClass;
        expect(
          focoVisible,
          `El elemento enfocado (${infoFoco.tagName}) en la pulsación ${i + 1} debe presentar anillo :focus-visible`,
        ).toBe(true);
      }
    }

    expect(elementosComprobados, 'Debe haber interactivos enfocados por teclado').toBeGreaterThanOrEqual(2);
  });

  test('ningún elemento interactivo enfocado queda oculto bajo la cabecera fija', async ({ page }) => {
    // Obtener la posición de la cabecera fija
    const headerBottom = await page.evaluate(() => {
      const header = document.querySelector('header.sticky, header.fixed, header');
      if (header) {
        const r = header.getBoundingClientRect();
        return r.bottom;
      }
      return 0;
    });

    // Navegar con Tab a través de varios elementos
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');

      const elementoEnfocado = await page.evaluate((limiteCabecera) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || el === document.documentElement) {
          return null;
        }

        const rect = el.getBoundingClientRect();
        // Si el elemento está dentro del header mismo, no se considera ocluido
        const estaEnHeader = !!el.closest('header');

        return {
          estaEnHeader,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          limiteCabecera,
        };
      }, headerBottom);

      if (elementoEnfocado && !elementoEnfocado.estaEnHeader && elementoEnfocado.height > 0) {
        // El elemento no debe quedar solapado detrás de la cabecera
        expect(
          elementoEnfocado.top >= elementoEnfocado.limiteCabecera - 2,
          `El elemento enfocado (top: ${elementoEnfocado.top}) quedó oculto tras la cabecera (bottom: ${elementoEnfocado.limiteCabecera})`,
        ).toBe(true);
      }
    }
  });
});
