# TEST_READY: Suite de Pruebas E2E y Verificación de Calidad UI/UX

**Proyecto:** PresVetCheck — Mundo Mascotix «Medicamentos Veterinarios»  
**Fecha de Publicación:** 2026-11-08  
**Autor:** Instancia de Pruebas E2E (`teamwork_test_writer_e2e_1`)  
**Estado:** Suite de Pruebas E2E Implementada y Lista para Verificación de Hitos

---

## 1. Resumen Ejecutivo de la Suite E2E

Se ha diseñado e implementado una suite completa de pruebas E2E basada en los principios de **caja opaca (opaque-box)**, orientada al cumplimiento estricto de los requisitos de `ORIGINAL_REQUEST.md`, las directrices ergonómicas de `SPEC.md` §2.1 y la arquitectura de `PROJECT.md`.

La suite cubre desde pruebas funcionales de flujo de mostrador (humo y asistente con citas) hasta comprobaciones matemáticas de contrastes WCAG 2.1 AA, detección geométrica de colisiones entre elementos de cabecera en 7 resoluciones (320px a 4K) y validación de trampas de foco en menús modales móviles.

---

## 2. Instrucciones de Ejecución (Test Runner)

### 2.1 Requisitos Previos del Entorno
- **Node.js**: Versión 22 (`>=22 <23`).
  ```bash
  export PATH="/Users/ac86016/.nvm/versions/node/v22.23.3/bin:$PATH"
  node -v # Debe responder v22.23.3
  pnpm -v # Debe responder 9.15.9
  ```
- **Playwright**: Los navegadores y dependencias ya se encuentran instalados en el entorno local (`@playwright/test` v1.53+).

### 2.2 Comandos de Ejecución

#### A. Ejecución de toda la suite E2E (todos los proyectos configurados: tablet, escritorio, móvil)
```bash
export PATH="/Users/ac86016/.nvm/versions/node/v22.23.3/bin:$PATH"
pnpm test:e2e
```

#### B. Ejecución por proyecto específico de resolución
```bash
export PATH="/Users/ac86016/.nvm/versions/node/v22.23.3/bin:$PATH"

# Proyecto Tablet Mostrador / TPV (1024x768 - estándar de mostrador)
pnpm --filter @mmx/web test:e2e --project=tablet

# Proyecto Escritorio Estándar (1440x900)
pnpm --filter @mmx/web test:e2e --project=escritorio

# Proyecto Móvil (Pixel 7 / 375-412px con emulación táctil)
pnpm --filter @mmx/web test:e2e --project=movil
```

#### C. Ejecución de suites individuales por funcionalidad
```bash
export PATH="/Users/ac86016/.nvm/versions/node/v22.23.3/bin:$PATH"

# 1. Contraste cromático matemático WCAG 2.1 AA
pnpm --filter @mmx/web test:e2e contraste-wcag

# 2. Layout responsive y colisión de cabecera (320px a 4K)
pnpm --filter @mmx/web test:e2e layout-responsive

# 3. Barra lateral y navegación por 4 secciones
pnpm --filter @mmx/web test:e2e sidebar-navegacion

# 4. Drawer móvil con trampa de foco y Escape
pnpm --filter @mmx/web test:e2e drawer-movil

# 5. Selector de tema y persistencia sin FOUC
pnpm --filter @mmx/web test:e2e tema

# 6. Elevación visual y diferenciación de tarjetas
pnpm --filter @mmx/web test:e2e tarjetas-elevacion

# 7. Navegación por teclado y anillo de foco visible
pnpm --filter @mmx/web test:e2e foco-visible

# 8. Flujo de humo completo de dispensación
pnpm --filter @mmx/web test:e2e humo

# 9. Asistente conversacional con fuentes y retorno de foco
pnpm --filter @mmx/web test:e2e asistente
```

#### D. Verificación de Tipos y Compilación
```bash
export PATH="/Users/ac86016/.nvm/versions/node/v22.23.3/bin:$PATH"
pnpm typecheck
```

---

## 3. Desglose de Pruebas por Niveles (Tier Breakdown)

### Tier 1: Funcionalidad Base y Flujo Operativo Crítico
- **`apps/web/e2e/humo.spec.ts`**:
  - Subida de receta simulada (EXTRACTOR=fake).
  - Revisión asistida por IA con decisión humana (firma y comprobado).
  - Calificación de dispensación en línea por el motor.
  - Escaneo 2D GS1 DataMatrix (lote FEFO `CLV-2611`) y confirmación de salida.
  - *Resultado:* **100% PASANDO** (3/3 proyectos).
- **`apps/web/e2e/asistente.spec.ts`**:
  - Consulta de plazos con citación de fuente normativa.
  - Anonimización automática de datos personales (RGPD).
  - Retorno de foco al campo de escaneo tras pulsar Escape o cerrar panel.
  - *Resultado:* **100% PASANDO** (3/3 proyectos).
- **`apps/web/e2e/sidebar-navegacion.spec.ts`**:
  - Verificación de las 4 secciones regulatorias (*Dispensación*, *Operaciones*, *Registros*, *Sistema*).
  - Estilo de píldora activa suave (`aria-current="page"` / clase semántica activa).
  - Conmutación dinámica del indicador activo al navegar entre rutas.
  - *Resultado:* **100% PASANDO** (9/9 ejecuciones).
- **`apps/web/e2e/tema.spec.ts`**:
  - Selector de 3 posiciones (`Claro`, `Oscuro`, `Sistema`).
  - Asignación de `.dark` en `<html>` y persistencia en `localStorage.getItem('mmx-tema-ui')`.
  - Comprobación de recarga inmediata sin FOUC.
  - *Resultado:* **100% PASANDO** (12/12 ejecuciones).

### Tier 2: Límites, Geometría y Esquemas Visuales
- **`apps/web/e2e/layout-responsive.spec.ts`**:
  - Verificación en 7 resoluciones: 320x568, 375x667, 768x1024, 1024x768, 1440x900, 1920x1080, 3840x2160.
  - Ausencia de desbordamiento horizontal (`scrollWidth <= innerWidth`).
  - Detección de colisiones 2D mediante cajas delimitadoras (`getBoundingClientRect`).
  - *Resultado:*
    - 320px, 375px y 768px: **PASANDO**.
    - 1024px, 1440px, 1920px y 4K: **REPRODUCE EL DEFECTO HISTÓRICO DE SUPERPOSICIÓN** (colisión entre `subtitulo` y `nav`), validando que la prueba es fidedigna y no un test fachada. Pasará al 100% una vez completado el Hito M2 (Sidebar + Topbar).
- **`apps/web/e2e/contraste-wcag.spec.ts`**:
  - Algoritmo matemático WCAG 2.1 / ITU-R BT.709 de luminancia relativa y ratio de contraste.
  - Textos estándar $\ge 4.5:1$, textos grandes y componentes UI $\ge 3.0:1$.
  - Modo claro y modo oscuro.
  - *Resultado:* **100% PASANDO** (6/6 ejecuciones).
- **`apps/web/e2e/tarjetas-elevacion.spec.ts`**:
  - Separación cromática entre lienzo base y superficie de tarjeta.
  - Presencia de bordes definidos o sombras suaves para profundidad visual.
  - *Resultado:* **100% PASANDO** (6/6 ejecuciones).
- **`apps/web/e2e/foco-visible.spec.ts`**:
  - Anillo `:focus-visible` activo al tabular por interactivos.
  - Ausencia de oclusión de campos enfocados tras la cabecera fija (`header.sticky`).
  - *Resultado:* **100% PASANDO** (6/6 ejecuciones).

### Tier 3: Dinámica Interactiva y Estados Modales
- **`apps/web/e2e/drawer-movil.spec.ts`**:
  - Menú hamburguesa abre diálogo modal con `role="dialog"` y `aria-modal="true"`.
  - Trampa de foco confinada (`useFocusTrap`) que impide escapar con `Tab`.
  - Tecla `Escape` cierra el panel modal y restaura el foco al botón disparador.
  - *Resultado:* **100% PASANDO** (12/12 ejecuciones).

---

## 4. Estado de Verificación y Defectos Identificados para Escalar

Durante la ejecución y validación de las pruebas E2E sobre el código fuente actual, se han confirmado y delimitado los siguientes defectos de implementación para los hitos M1 y M2:

1. **Defecto de Superposición en Cabecera (Para Hito M2):**
   - *Evidencia:* `apps/web/e2e/layout-responsive.spec.ts` detecta colisión matemática directa entre el subtítulo institucional `Medicamentos Veterinarios` y la barra de navegación `<nav>` en resoluciones $\ge 1024\text{px}$ (1024x768, 1440x900, 1920x1080, 3840x2160).
   - *Causa raíz:* En `apps/web/src/componentes/layout.tsx`, tanto el logotipo, subtítulo, 7 enlaces de navegación y controles de usuario comparten un único contenedor `flex` horizontal en cabecera sin segregación lateral.
   - *Solución:* M2 migrará la navegación a `Sidebar` vertical, dejando `Topbar` despejada para el buscador ⌘K y controles de sesión.

2. **Desbordamiento Horizontal a 1024px (Para Hito M2):**
   - *Evidencia:* En `layout-responsive.spec.ts`, a 1024x768 se registra `scrollWidth > innerWidth`.
   - *Causa raíz:* El contenido de la cabecera en fila única excede los 1024px de pantalla disponible en tableta apaisada.

3. **Configuración de Variante Oscura en Tailwind v4 (Para Hito M1):**
   - *Evidencia:* Tailwind CSS v4 utiliza por defecto `@media (prefers-color-scheme: dark)`. Para que clases condicionales como `dark:bg-superficie` se activen mediante la clase `.dark` en `<html>` independientemente de la preferencia del sistema operativo, se debe asegurar la directiva `@variant dark (&:where(.dark, .dark *));` en `apps/web/src/estilos.css`.
