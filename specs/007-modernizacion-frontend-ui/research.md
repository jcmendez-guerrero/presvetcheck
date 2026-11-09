# Research & Architectural Decisions: Modernización de la Interfaz de Usuario (UI/UX)

**Feature Branch**: `007-modernizacion-frontend-ui` | **Date**: 2026-11-08  
**Spec Reference**: [spec.md](./spec.md)

---

## 1. Integración de Tokens y Temas en Tailwind CSS v4

### Contexto y Problema
`apps/web` utiliza Tailwind CSS v4 (`@tailwindcss/vite` y `tailwindcss` ^4.1.0). En Tailwind v4, la configuración ya no se realiza mediante un archivo `tailwind.config.js`, sino mediante la directiva `@theme` en el archivo principal de estilos (`apps/web/src/estilos.css`).
Actualmente, `estilos.css` contiene una definición preliminar de variables que no estructura la separación entre tokens de marca corporativos (según el Manual Oficial de Mundo Mascotix) y tokens semánticos regulatorios del dominio farmacéutico (SPEC §2.1).

### Decisión de Arquitectura de Tokens
Se estructura `@theme` en tres capas:

1. **Tokens Primitivos de Marca (Brand Core)**:
   - `--color-marca: #016581;` (Azul petróleo - 60% presencia en elementos clave de acción y titulares)
   - `--color-marca-apoyo: #2F8198;` (Azul medio - apoyo a enlaces, iconos y subtítulos)
   - `--color-acento: #60ABB8;` (Turquesa - acentos de huella, bordes activos y detalles)
   - `--color-texto: #002028;` (Azul noche - lectura de alto contraste 16.5:1)
   - `--color-fondo: #F2F8F9;` (Blanco hielo - lienzo base)

2. **Tokens Semánticos de Estado Regulatorio (Regulatory Semantics)**:
   - `--color-dispensar: #047857;` / `--color-dispensar-bg: #d1fae5;`
   - `--color-sustituir: #b45309;` / `--color-sustituir-bg: #fef3c7;`
   - `--color-noconforme: #b91c1c;` / `--color-noconforme-bg: #fee2e2;`
   - `--color-pedir: #016581;` / `--color-pedir-bg: #e0f2f7;`
   - `--color-psicotropo: #6b21a8;` / `--color-psicotropo-bg: #f3e8ff;`
   - `--color-dorado: #e3a857;` / `--color-dorado-bg: #fef9c3;` (Revisión/MFA/Foco)

3. **Tokens de Tipografía y Escala**:
   - `--font-titulo: 'Bricolage Grotesque Variable', sans-serif;`
   - `--font-sans: 'Inter Variable', system-ui, sans-serif;`
   - `--font-mono: 'JetBrains Mono', ui-monospace, monospace;`

---

## 2. Accesibilidad WCAG 2.2: Foco No Oculto y Navegación de Mostrador

### Contexto y Problema
En las pantallas de **Dispensación** (`/recetas/$id/dispensar/$linea`) y **Revisión** (`/recetas/$id/revision`), coexisten barras persistentes fijas al scroll:
- Cabecera de la aplicación (`Cabecera` fija o compacta)
- Banda de aviso reglamentario (`BandaSustitucion` en ámbar o `BandaPsicotropo` en púrpura)

Si un usuario navega con teclado (`Tab` / `Shift+Tab`) en pantallas táctiles o teclados de mostrador, el navegador desplaza la página hacia el campo activo, pero este puede quedar oculto debajo de las bandas fijas (violación de WCAG 2.2 Criterio 2.4.11 / 2.4.12 *Focus Not Obscured*).

### Decisión Técnica
1. **Regla de Desplazamiento Seguro (`scroll-padding-top`)**:
   Se define en el contenedor de maquetación principal:
   ```css
   html {
     scroll-padding-top: calc(var(--altura-cabecera, 64px) + var(--altura-banda-aviso, 0px) + 16px);
   }
   ```
2. **Anillo de Foco Accesible**:
   Se mantiene el Dorado `#E3A857` con `outline: 3px solid var(--color-dorado); outline-offset: 2px;` asegurando visibilidad sobre fondos blancos, blanco hielo y azul petróleo.

---

## 3. Ergonomía de Mostrador: Copia de Lote para TPV y HUD FEFO

### Contexto y Problema
En la operativa diaria de Mundo Mascotix, la farmacia decrementa el stock mediante el ticket de TPV en Siweb360 (`SPEC §5.2.4`, Decisión `D-02`). El empleado debe introducir exactamente el lote seleccionado por el sistema de recomendación FEFO. El botón de copia actual es estático y no proporciona retroalimentación inmediata, lo que provoca dudas en momentos de afluencia de clientes.

### Decisión Técnica
1. **Microinteracción con Feedback Háptico / Visual**:
   - Estado inactivo: Botón `Copiar lote` con icono `Copy`.
   - Estado copiado (2.0 segundos): Mutación visual inmediata con fondo verde esmeralda suave (`bg-dispensar-bg text-dispensar`), icono `CheckCircle2` y etiqueta «¡Lote copiado!».
   - Accesibilidad: Anuncio auditivo mediante `<span role="status" aria-live="polite">` oculto visualmente.
2. **Fallback Robusto para Entornos No Seguros**:
   Si `navigator.clipboard.writeText` es denegado o falla (p.ej. iframe o restricciones de permisos locales), se ejecuta un fallback con selección de rango de texto (`document.execCommand('copy')` o selección asistida) sin arrojar excepción no controlada.

---

## 4. Gestión de Foco en Modales y Cajones (React 19)

### Contexto y Problema
`ModalForzado`, `TicketMultiRxModal` y el cajón del asistente (`asistente.tsx`) deben cumplir con el estándar WAI-ARIA Dialog (Modal):
1. El foco debe dirigirse al primer elemento interactivo o al título del modal al abrirse.
2. La pulsación de `Tab` debe ciclar exclusivamente dentro del diálogo.
3. La tecla `Escape` debe cerrar el diálogo.
4. Al cerrarse, el foco debe regresar de forma determinista al elemento desencadenante (`triggerRef`).

### Decisión Técnica
Implementar un hook reusable `useFocusTrap(ref, isOpen, onClose)` en `apps/web/src/lib/a11y.ts` que capture eventos de teclado y gestione la restitución del foco sin introducir dependencias externas pesadas.

---

## 5. Rendimiento y No Regresiones en Pruebas

- **Compatibilidad con Playwright (`EXTRACTOR=fake`)**:
  Los selectores de prueba `data-testid` existentes (`boton-receta`, `campo-escaneo`, `visor-receta`, `usuario-dev`, etc.) se preservan intactos para garantizar la estabilidad de los tests e2e existentes.
- **Optimización de Fuentes Web**:
  Se aprovechan las fuentes ya instaladas en el repositorio (`@fontsource-variable/bricolage-grotesque` e `@fontsource-variable/inter`), asegurando tiempo de renderizado cero (FOUT prevenido mediante `font-display: swap`).
