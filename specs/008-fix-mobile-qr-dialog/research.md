# Investigación: el diálogo «Usar el móvil» se corta por arriba

**Feature**: [spec.md](./spec.md) · **Fecha**: 2026-11-09

## R1. Causa raíz

- **Decision**: la causa principal es que el diálogo se pinta **dentro de la cabecera**. La cabecera
  (`apps/web/src/componentes/topbar.tsx:44`) lleva `backdrop-blur-md` (`backdrop-filter`). Según la especificación
  CSS, un antecesor con `backdrop-filter` (igual que `transform` o `filter`) pasa a ser el bloque contenedor de sus
  descendientes `position: fixed`. Por eso `fixed inset-0` en `movil-pc.tsx:51` no ocupa la ventana, sino solo la
  franja de 64 px de la cabecera, y el panel se centra en esa franja: la mitad sobresale por encima del borde
  superior, donde no se puede desplazar.
- **Pruebas que lo confirman**: en la captura del informe el fondo de la página **no** se oscurece (el velo
  `bg-black/60` solo cubre la cabecera) y el panel aparece centrado a la altura de la cabecera. La búsqueda rápida
  (`comando-buscar.tsx`), que usa el mismo patrón, funciona porque se monta **fuera** del `<header>`
  (`topbar.tsx:219`).
- **Causa secundaria**: el panel no tiene límite de altura ni desplazamiento propio, a diferencia del resto de
  diálogos (`forzado.tsx:37`, `ticket-multi-rx.tsx:51`, `resultado.tsx:340`, todos con `max-h-[90vh] overflow-auto`).
  Aunque el velo ocupase toda la ventana, en pantallas bajas el panel seguiría sin caber.
- **Alternatives considered**: solo añadir `max-h-[90vh] overflow-auto` (no basta: el contenedor sigue siendo la
  cabecera de 64 px, así que el panel quedaría limitado a la franja de la cabecera).

## R2. Cómo sacar el diálogo de la cabecera

- **Decision**: renderizar `DialogoMovil` con `createPortal(…, document.body)` de `react-dom` (ya instalado).
- **Rationale**: cambio de una línea, sin dependencias nuevas; el estado (`abierto`) sigue en `BotonMovil`, así que
  no hay que tocar `topbar.tsx` ni a quien lo usa. Funciona en cualquier pantalla que monte la cabecera.
- **Alternatives considered**:
  - Subir el estado a `topbar.tsx` y montar el diálogo junto a `ComandoBuscar` — más código y acopla la cabecera
    al flujo del móvil.
  - Quitar `backdrop-blur-md` de la cabecera — cambia el diseño aprobado en la feature 007 y deja la trampa para el
    siguiente diálogo.
  - Usar `<dialog>` nativo con `showModal()` (capa superior, inmune al bloque contenedor) — más cambios de
    comportamiento (foco, `Escape`, estilos de `::backdrop`) para el mismo resultado; ningún otro diálogo del
    proyecto lo usa.

## R3. Altura y desplazamiento

- **Decision**: dar al panel `max-h-[90vh] overflow-auto`, igual que los otros diálogos.
- **Rationale**: patrón ya usado en la casa; con el panel desplazable, el código QR se ve entero con su tamaño
  actual (`w-64`) y los botones quedan siempre alcanzables (FR-002, FR-003, FR-004). El velo con `items-center` y
  `p-4` deja el panel centrado y dentro de la ventana en cualquier altura.
- **Alternatives considered**: reducir el QR en pantallas bajas — rechazado por la spec (debe seguir siendo legible).

## R4. Teclado y foco

- **Decision**: usar el gancho de la casa `useFocusTrap(ref, true, onCerrar)` de `apps/web/src/lib/a11y.ts` y marcar
  el panel con `aria-modal="true"`.
- **Rationale**: al pasar el diálogo al final de `<body>`, sin trampa de foco el tabulador recorrería toda la página
  antes de llegar a él. El gancho ya lo usan `comando-buscar.tsx`, `sidebar.tsx` y `asistente.tsx`; además cierra con
  `Escape` y devuelve el foco al botón (FR-004, User Story 2).

## R5. Otros diálogos (FR-007)

- **Decision**: no hace falta tocar otros diálogos.
- **Rationale**: `forzado.tsx`, `ticket-multi-rx.tsx` y `resultado.tsx` ya limitan su altura y no están dentro de
  un antecesor con `backdrop-filter`. `comando-buscar.tsx` se monta fuera de la cabecera. `escaner.tsx` se usa dentro
  del contenido de las páginas (`recepciones`, `venta`, `dispensacion`, `movil`), no dentro de la cabecera. Solo
  `movil-pc.tsx` combina las dos causas.

## R6. Prueba automática (FR-008)

- **Decision**: una prueba Playwright nueva, `apps/web/e2e/dialogo-movil.spec.ts`, con `AUTH_MODE=dev` (ya
  configurado en `playwright.config.ts`) y las alturas de ventana de SC-002 (300, 430, 600, 1080 px).
- **Rationale**: el fallo solo aparece con maquetación real del navegador; jsdom/Vitest no calcula posiciones. Se
  sigue el patrón de `layout-responsive.spec.ts` (`page.setViewportSize` + `boundingBox`).
- **Nota**: la API del móvil debe responder para que aparezca el QR; si en e2e no hay sesión real, la prueba
  comprueba el panel en estado «Preparando el código…» y el botón «Cerrar», donde el defecto ya se ve. Ver
  [quickstart.md](./quickstart.md).

## R7. Ajustes hallados al implementar

- **Foco inicial**: `useFocusTrap` enfocaba el primer botón («Desconectar el móvil»), al fondo del panel; en ventanas
  bajas el panel se abría desplazado abajo, con el QR cortado, y Enter desconectaba el móvil. Se añade al gancho un
  destino opcional `[data-autofocus]` (el título, `tabIndex={-1}`) y Tab/Shift+Tab desde un elemento fuera de la
  lista vuelve al primero/último. Los demás diálogos no usan el atributo: su comportamiento no cambia.
- **Contraste en tema oscuro**: el panel es siempre blanco pero heredaba `text-texto` (claro en tema oscuro); el título
  casi no se veía. El velo usa ahora `text-slate-900`.
