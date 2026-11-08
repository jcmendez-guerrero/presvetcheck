# Project: PresVetCheck UI/UX Redesign & Modernization

## Architecture
- **Framework & Libraries**: React 19, Tailwind CSS v4 (`@tailwindcss/vite`), TanStack Router v1, TanStack Query v5, Lucide React icons (`lucide-react`).
- **Styling Architecture**: Multi-layer design tokens in `apps/web/src/estilos.css`:
  - Brand primitives (#016581 petróleo, #2F8198 azul medio, #60ABB8 turquesa, #002028 noche, #F2F8F9 hielo).
  - Semantic surface and text tokens with strict WCAG 2.1 AA ratios (≥4.5:1 standard text, ≥3.0:1 UI/large text).
  - Regulatory state tokens (dispensar, sustituir, noconforme, pedir, psicotropo, dorado).
  - Light/Dark theme calibration with dark rim-light, depth shadows, and distinct card backgrounds.
- **Layout Architecture**:
  - `Sidebar` (`apps/web/src/componentes/sidebar.tsx`): Left navigation column structured into 4 regulatory sections (Dispensación, Operaciones, Registros, Sistema) with soft pill active state, badge indicators for pending queues, and responsive drawer for `<1024px` viewports with focus trap (`useFocusTrap`).
  - `Topbar` (`apps/web/src/componentes/topbar.tsx`): Header bar with guaranteed clearspace for brand logo & subtitle (no collisions 320px to 4K), ⌘K command/quick search bar, 3-state segmented theme switcher (`Sistema | Claro | Oscuro`), mobile pairing status, user session details, dev user selector (`data-testid="usuario-dev"`), and logout action.
  - `Layout` (`apps/web/src/componentes/layout.tsx`): Main shell integrating Sidebar, Topbar, content container supporting full-width split views (`staticData: { anchoCompleto: true }`), demo banner, mobile alerts, and floating assistant widget.
- **Dashboard Architecture**:
  - `Inicio` (`apps/web/src/paginas/inicio.tsx`): Structured operational view with welcome header, immediate priority banners, 4 hero/quick counter action cards (preserving `data-testid="boton-receta"`), 4 operational metric cards with dual icon + text status indicators (SPEC §2.1 compliance), and bottom productivity panels (Libro Oficial RD 1157/2021 & Vademécum CIMAVet).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Tokens institucionales y semánticos desacoplados | Desacoplar colores de marca de tokens semánticos en `estilos.css` | M1 | Survey 1 / R2 |
| 2 | Calibración de contraste WCAG 2.1 AA | Garantizar ≥4.5:1 en texto y ≥3.0:1 en UI para claro y oscuro | M1 | Survey 1 / R2 |
| 3 | Elevación visual y profundidad de tarjetas | Bordes suaves, sombras, fondos diferenciados y rim light | M1 | Survey 1 / R2 |
| 4 | Corrección de exclusión en `eslint.config.js` | Ignorar `.agents/**` para garantizar `pnpm lint` 100% pasando | M1 | Survey 3 / AC |
| 5 | Barra lateral (Sidebar) por 4 secciones | Navegación vertical categorizada con píldoras activas suaves | M2 | Survey 2 / R1 |
| 6 | Barra superior (Topbar) sin superposiciones | Espacio normativo garantizado para logo y subtítulo en 320px-4K | M2 | Survey 2 / R1 |
| 7 | Selector de tema de 3 posiciones | Selector `Sistema \| Claro \| Oscuro` con persistencia `localStorage` | M2 | Survey 2 / R1 |
| 8 | Cajón responsive (Drawer) con trampa de foco | Menú móvil accesible con `useFocusTrap` y tecla Escape | M2 | Survey 2 / R1 |
| 9 | Acceso rápido / Paleta de comandos (⌘K) | Acceso rápido de búsqueda y navegación en Topbar | M2 | Survey 2 / R1 |
| 10 | Preservación de identificadores de sesión/test | Mantener `usuario-dev`, `boton-movil`, `asistente-abrir` intactos | M2 | Survey 2 / AC |
| 11 | Encabezado operativo y avisos en Dashboard | Saludo con turno, hora local y banner de avisos prioritarios | M3 | Survey 3 / R3 |
| 12 | Tarjetas operativas de mostrador jerarquizadas | 4 accesos rápidos con subtítulos manteniendo `data-testid="boton-receta"` | M3 | Survey 3 / R3 |
| 13 | Indicadores de métricas con icono + texto | Sustituir números planos por cifra + badge semántico (icono + texto) | M3 | Survey 3 / R3 |
| 14 | Paneles de productividad en Dashboard | Libro de Registros RD 1157/2021 y guía rápida Vademécum CIMAVet | M3 | Survey 3 / R3 |
| 15 | Infraestructura de pruebas E2E multi-resolución | Configurar proyectos tablet, desktop y mobile en Playwright | E2E Track | Survey 3 / AC |
| 16 | Pruebas E2E Tier 1 (Cobertura de funcionalidades) | Tests para layout, sidebar, topbar, dashboard, selector tema | E2E Track | Survey 3 / AC |
| 17 | Pruebas E2E Tier 2 (Límites y esquinas) | Bounding box 320px-4K sin colisiones, contraste WCAG y foco | E2E Track | Survey 3 / AC |
| 18 | Pruebas E2E Tier 3 (Combinaciones cruzadas) | Tema + navegación, drawer móvil + foco, ⌘K + salto | E2E Track | Survey 3 / AC |
| 19 | Pruebas E2E Tier 4 (Escenarios de mostrador) | Flujo completo de dispensación con nuevo layout | E2E Track | Survey 3 / AC |
| 20 | Pase 100% de la suite E2E de `TEST_READY.md` | Ejecución íntegra de pruebas con código de salida 0 | M4 (Final) | Pattern / AC |
| 21 | Endurecimiento adversarial de cobertura (Tier 5) | Detección de caminos no cubiertos con Challengers | M4 (Final) | Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Tokens, Color Contrast (WCAG 2.1 AA), ESLint Fix & Card Elevation | `estilos.css`, `ui.tsx`, `eslint.config.js` | none | DONE |
| M2 | Global Layout (Sidebar, Topbar, Mobile Drawer, Theme Switcher) | `layout.tsx`, `sidebar.tsx`, `topbar.tsx`, `index.html` | M1 | DONE |
| M3 | Dashboard Modernization (Inicio, Métricas icono+texto, Acciones) | `inicio.tsx` | M1, M2 | DONE |
| E2E | E2E Testing Suite (Tiers 1-4, multi-viewport, contrast & layout) | `apps/web/e2e/**`, `playwright.config.ts`, `TEST_READY.md` | none (opaque-box) | DONE |
| M4 | Final Milestone: 100% E2E Test Pass & Tier 5 Hardening | Full application against E2E suite, adversarial stress-testing | M1, M2, M3, E2E | DONE |

## Interface Contracts
### `estilos.css` ↔ Componentes de UI y Layout
- Variables CSS expuestas:
  - `--color-fondo`, `--color-fondo-secundario`, `--color-superficie`, `--color-superficie-elevada`
  - `--color-borde`, `--color-borde-marca`, `--color-superficie-borde`
  - `--color-texto`, `--color-texto-muted`, `--color-texto-atenuado`
  - `--color-marca`, `--color-marca-hover`, `--color-marca-apoyo`, `--color-acento`
  - `--color-dispensar`, `--color-dispensar-bg`, `--color-sustituir`, `--color-sustituir-bg`
  - `--color-noconforme`, `--color-noconforme-bg`, `--color-pedir`, `--color-pedir-bg`
  - `--color-dorado`, `--color-dorado-bg`
- Tema oscuro activado mediante clase `.dark` en el elemento raíz `<html>`.

### Topbar & Theme Switcher ↔ Navegador / Almacenamiento
- LocalStorage key: `mmx-tema-ui` ('claro' | 'oscuro' | 'sistema').
- Sincronización inmediata con `document.documentElement.classList` y `document.documentElement.style.colorScheme`.
- Script en `<head>` de `index.html` para evitar FOUC.

### Sidebar & Navegación ↔ TanStack Router
- Soporte para páginas `anchoCompleto` a través de `staticData: { anchoCompleto: true }`.
- Detección de ruta activa y aplicación de clases de píldora activa suave.

### Dashboard ↔ API `/api/inicio`
- Tipo `Contadores`:
  ```ts
  interface Contadores {
    sustitucionesPendientes: number;
    recetasNoConformes: number;
    discrepanciasAbiertas: number;
    outboxIncidencias: number;
    pedidosRecibidosPendientesEntrega: number;
    registrosPendientes: number;
  }
  ```

## Code Layout
- `apps/web/src/estilos.css`: Tokens de diseño, Tailwind v4, temas claro y oscuro.
- `apps/web/src/componentes/ui.tsx`: Primitivas de interfaz (Tarjeta, Boton, Mensaje, Etiqueta).
- `apps/web/src/componentes/layout.tsx`: Layout principal integrador.
- `apps/web/src/componentes/sidebar.tsx`: Barra lateral con 4 secciones, responsive drawer y trampa de foco.
- `apps/web/src/componentes/topbar.tsx`: Barra superior con logo, buscador ⌘K, selector tema y sesión.
- `apps/web/src/paginas/inicio.tsx`: Dashboard principal modernizado.
- `apps/web/index.html`: Script de inicialización anti-FOUC para tema.
- `eslint.config.js`: Exclusión de `.agents/**`.
- `apps/web/playwright.config.ts`: Configuración multi-proyecto (móvil, tablet, escritorio).
- `apps/web/e2e/`: Suites de pruebas automatizadas E2E.
