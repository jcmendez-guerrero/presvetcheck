# Infraestructura de Pruebas E2E y Calidad UI/UX: PresVetCheck

Este documento establece la filosofía, metodología, inventario de pruebas por niveles (Tiers 1-4) y criterios objetivos de aceptación para la verificación automatizada del rediseño de interfaz de usuario de Mundo Mascotix "Medicamentos Veterinarios".

---

## 1. Filosofía de Pruebas

### 1.1 Principio de Caja Opaca (Opaque-Box Testing)
Las pruebas automatizadas de interfaz tratan a la aplicación como un sistema cerrado. No inspeccionan estados internos de React ni hooks privados; evalúan exclusivamente:
1. **Comportamiento observable**: Renderizado en el DOM, visibilidad de elementos, contenido textual e interactividad.
2. **Contratos de accesibilidad (a11y)**: Roles ARIA (`role="dialog"`, `role="navigation"`, `role="radiogroup"`), estados (`aria-current="page"`, `aria-modal="true"`, `aria-checked`), navegación por teclado (`Tab`, `Shift+Tab`, `Escape`) y trampas de foco activas.
3. **Propiedades geométricas y computadas**: Cajas delimitadoras (`getBoundingClientRect()`), ausencia de colisiones entre elementos de cabecera, ausencia de desbordamiento horizontal (`scrollWidth <= innerWidth`) y visibilidad de anillos de enfoque sin oclusión por elementos fijos (`sticky`/`fixed`).
4. **Fidelidad cromática matemática**: Evaluación algorítmica de luminancia relativa y ratios de contraste WCAG 2.1 AA a partir de estilos computados (`window.getComputedStyle`).

### 1.2 Enfoque Dirigido por Requisitos (Requirement-Driven)
Cada caso de prueba se deriva directamente de las especificaciones normativas y de diseño:
- **`ORIGINAL_REQUEST.md`**: Requerimientos R1 (Layout con Sidebar y Topbar sin colisiones), R2 (Tokens, contraste WCAG 2.1 AA y elevación de tarjetas), R3 (Dashboard estructurado con indicadores duales icono + texto) y sus Criterios de Aceptación.
- **`SPEC.md` §2.1**: Principios de diseño para mostrador de farmacia veterinaria (pantallas táctiles y de alta luminosidad, prohibición estricta de comunicar estado sólo por color, textos claros en castellano normativo, objetivo táctil mínimo de 44×44px, navegación completa por teclado).
- **`PROJECT.md`**: Contratos de interfaz entre tokens de diseño, layout, enrutador y APIs de inicio.

### 1.3 Entorno de Ejecución Aislado y Determinista
Las pruebas se ejecutan mediante Playwright utilizando los dos servidores web integrados en `playwright.config.ts`:
- **API (`http://localhost:3101`)**: Node 22 + tsx + PGlite en memoria (`DATABASE_URL=pglite://memory`), extractor OCR simulado (`EXTRACTOR=fake`), asistente sintético (`ASSISTANT=fake`) y stock sintético Siweb360 (`fixtures/siweb/demo-stock.json`).
- **Web (`http://localhost:5174`)**: Vite 6 con proxy hacia la API, garantizando condiciones idénticas entre desarrollo local e integración continua (CI).

---

## 2. Metodología de Pruebas

Se aplican cuatro técnicas formales de ingeniería de calidad de software:

### 2.1 Partición de Equivalencia (Category-Partition)
Se dividen las entradas y contextos en clases de equivalencia exhaustivas:
- **Resoluciones y Dispositivos**:
  - *Móvil ultracompacto*: 320 × 568 px (iPhone SE 1ª gen - límite inferior absoluto).
  - *Móvil estándar*: 375 × 667 px (iPhone SE / 8 - viewport móvil de referencia).
  - *Tablet vertical*: 768 × 1024 px (iPad Portrait).
  - *Tablet mostrador / horizontal*: 1024 × 768 px (iPad Landscape / Pantalla táctil TPV).
  - *Escritorio estándar*: 1440 × 900 px (Portátil estándar).
  - *Escritorio Full HD*: 1920 × 1080 px (Monitor principal mostrador).
  - *Ultra-panorámico / 4K*: 3840 × 2160 px (Monitor 4K de alta densidad).
- **Modos de Color / Temas**:
  - `claro`: Fondo claro (`#f4f8f9` / `#f2f8f9`), tarjetas blancas (`#ffffff`), texto petróleo oscuro (`#002028`).
  - `oscuro`: Fondo noche profundo (`#00161c` / `#002028`), tarjetas elevadas (`#00252f`), texto blanco hielo (`#f2f8f9`).
  - `sistema`: Sincronización automática con la preferencia `prefers-color-scheme` del sistema operativo.
- **Topología de Navegación**:
  - *Sidebar expandido (>= 1024px)*: 4 secciones fijas, enlaces directos, píldora activa.
  - *Drawer colapsable (< 1024px)*: Menú hamburguesa accesible, panel modal lateral con trampa de foco.
- **Capas de Elevación de Tarjetas**:
  - *Lienzo base (`Canvas`)*: Fondo general de la página.
  - *Superficie estándar (`Card`)*: Tarjetas de mostrador, métricas operativas y paneles.
  - *Superficie elevada (`Raised Card`)*: Diálogos, desplegables y menús flotantes.

### 2.2 Análisis de Valores Límite (Boundary Value Analysis - BVA)
- **Anchura de Pantalla**: Pruebas en el extremo inferior (320px), en los umbrales de quiebre de media queries (`1023px` vs `1024px`), y en el límite superior (3840px).
- **Ratios de Contraste WCAG 2.1**: Umbral de `4.5:1` para texto estándar (< 18pt regular / < 14pt negrita) y `3.0:1` para texto grande e interactivos gráficos.
- **Desbordamiento**: Evaluación estricta de `document.documentElement.scrollWidth <= window.innerWidth` (tolerancia 0px de scroll horizontal no deseado).
- **Colisión de Bounding Boxes**: Intersección geométrica nula entre elementos de cabecera:
  $$\text{Colisión} \iff \max(A_{left}, B_{left}) < \min(A_{right}, B_{right}) \land \max(A_{top}, B_{top}) < \min(A_{bottom}, B_{bottom})$$

### 2.3 Pruebas por Pares (Pairwise Testing)
Combinaciones de factores ortogonales para maximizar la cobertura con el menor número de iteraciones:
- Tema (`claro`, `oscuro`) $\times$ Resolución (`375x667`, `1024x768`, `1440x900`).
- Tipo de Usuario (`empleado`, `veterinaria_responsable`, `admin`) $\times$ Sección activa.
- Estado de Drawer móvil (`abierto`, `cerrado`) $\times$ Tecla de escape / clic exterior.

### 2.4 Pruebas de Flujos de Carga Real de Mostrador (Real-World Workloads)
- **Flujo de dispensación rápida**: Inicio $\to$ Nueva Receta $\to$ Extracción asistida $\to$ Validación con firma $\to$ Dispensación con escaneo DataMatrix GS1 $\to$ Registro completado.
- **Flujo de consulta y retorno de foco**: Apertura de panel de asistente conversacional $\to$ Consulta de plazo $\to$ Cierre con Escape $\to$ Retorno inmediato del foco al campo de escaneo DataMatrix sin pérdida de contexto.

---

## 3. Inventario de Pruebas por Niveles (Tiers 1 - 4)

El plan de pruebas E2E en `apps/web/e2e/` se organiza en 4 niveles de madurez y cobertura:

| Nivel | Archivo de Prueba | Propósito y Alcance | Requerimiento / AC |
| :--- | :--- | :--- | :--- |
| **Tier 1: Funcionalidad Base** | `apps/web/e2e/sidebar-navegacion.spec.ts` | Verifica la estructura de navegación en 4 secciones regulatorias (*Dispensación*, *Operaciones*, *Registros*, *Sistema*). Comprueba que la ruta activa aplica el estilo píldora (`aria-current="page"` o clase activa), y que la navegación entre páginas actualiza el indicador visual. | R1, AC 1.2 |
| **Tier 1: Funcionalidad Base** | `apps/web/e2e/tema.spec.ts` | Verifica el funcionamiento del selector de tema de 3 posiciones (`Claro`, `Oscuro`, `Sistema`). Comprueba la asignación de la clase `.dark` en `<html>`, la persistencia en `localStorage.getItem('mmx-tema-ui')`, y la ausencia de FOUC tras recargar (`page.reload()`). | R2, AC 1.4 |
| **Tier 1: Funcionalidad Base** | `apps/web/e2e/humo.spec.ts` | Preserva el flujo de humo original: subida de imagen de receta, revisión humana de datos, confirmación en CIMAVet, calificación del motor y dispensación con lectura de código GS1 DataMatrix. | SPEC §12.1.8 |
| **Tier 1: Funcionalidad Base** | `apps/web/e2e/asistente.spec.ts` | Preserva las pruebas del asistente conversacional de prescripción: consulta de plazos, eliminación de datos de carácter personal (RGPD) y retorno de foco accesible. | SPEC §2.1, ADR-17 |
| **Tier 2: Límites y Esquemas Visuales** | `apps/web/e2e/layout-responsive.spec.ts` | Ejecuta la verificación en 7 resoluciones (320x568, 375x667, 768x1024, 1024x768, 1440x900, 1920x1080, 3840x2160). Calcula matemáticamente colisiones de cajas delimitadoras (`getBoundingClientRect`) entre logotipo, subtítulo corporativo, buscador y controles de usuario. Comprueba `scrollWidth <= innerWidth`. | R1, AC 1.1 |
| **Tier 2: Límites y Esquemas Visuales** | `apps/web/e2e/contraste-wcag.spec.ts` | Evalúa de manera matemática y computada los colores de fondo y texto de elementos clave en temas claro y oscuro, validando que el ratio supere $\ge 4.5:1$ en texto normal y $\ge 3.0:1$ en componentes interactivos e iconos. | R2, AC 2.1 |
| **Tier 2: Límites y Esquemas Visuales** | `apps/web/e2e/tarjetas-elevacion.spec.ts` | Inspecciona los estilos computados (`backgroundColor`, `borderColor`, `boxShadow`) de las tarjetas de mostrador, métricas operativas y paneles, asegurando que la superficie se diferencie del lienzo tanto en modo claro como en modo oscuro. | R2, AC 2.2 |
| **Tier 2: Límites y Esquemas Visuales** | `apps/web/e2e/foco-visible.spec.ts` | Navega secuencialmente con `Tab` por todos los elementos interactivos del layout y dashboard. Verifica la visibilidad del anillo `:focus-visible` (color dorado corporativo o acento) y confirma que ningún elemento enfocado quede oculto tras la cabecera fija. | SPEC §2.1, AC 2.3 |
| **Tier 3: Interacciones Cruzadas** | `apps/web/e2e/drawer-movil.spec.ts` | En viewport móvil (375x667), comprueba la apertura del cajón mediante el botón de menú, atributos `role="dialog"` y `aria-modal="true"`, la trampa de foco con `Tab`/`Shift+Tab`, y el cierre con `Escape` devolviendo el foco al disparador. | R1, AC 1.3 |
| **Tier 4: Carga Operativa Completa** | Flujo Integral de Mostrador | Integración coordinada de cambio de tema en caliente durante la dispensación, redimensionamiento dinámico y persistencia de estado operativo. | AC Global |

---

## 4. Umbrales de Calidad y Criterios de Aceptación (Pass/Fail Criteria)

Para que el conjunto de pruebas sea declarado apto para producción en `TEST_READY.md`, se deben cumplir al 100% los siguientes umbrales:

1. **Tasa de Aprobación**: 100% de los tests E2E aprobados (0 fallos, 0 regresiones en suites existentes).
2. **Colisiones Geométricas de Cabecera**:
   - Área de intersección entre bounding boxes de elementos normativos $= 0\text{ px}^2$.
   - Margen de seguridad normativo del logotipo (`logo-clearspace`) respetado en todas las resoluciones.
3. **Desbordamiento Horizontal**:
   - `scrollWidth - innerWidth <= 0` en todas las páginas evaluadas.
4. **Accesibilidad y Contraste WCAG 2.1 AA**:
   - Texto estándar: Contraste $\ge 4.50:1$.
   - Texto grande ( $\ge 24\text{px}$ regular o $\ge 18.66\text{px}$ negrita) y elementos UI: Contraste $\ge 3.00:1$.
   - Toda información de estado operativo debe presentar canal dual (icono + texto).
5. **Trampa de Foco y Teclado**:
   - Diálogo móvil modal no permite escapar el foco con `Tab` fuera del contenedor.
   - Pulsación de `Escape` restaura el foco al elemento que originó la apertura en $< 100\text{ ms}$.
6. **Persistencia de Tema**:
   - Valor en `localStorage['mmx-tema-ui']` sincronizado con la clase `.dark` en `document.documentElement`.
   - Cero parpadeo de contenido desestilizado (FOUC) al refrescar el navegador.
