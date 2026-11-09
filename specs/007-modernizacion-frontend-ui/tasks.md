# Tasks: Modernización de la Interfaz de Usuario y Sistema de Diseño (UI/UX) de Mundo Mascotix

**Input**: Design documents from `/specs/007-modernizacion-frontend-ui/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/ui-design-system.md`, `quickstart.md`)  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`

---

## Phase 1: Setup (Shared Infrastructure & Design Tokens)

**Purpose**: Configuración de tokens de diseño, tipografías corporativas y reglas base de maquetación en Tailwind CSS v4.

- [x] T001 Actualizar directiva `@theme` en `apps/web/src/estilos.css` con los 5 colores corporativos oficiales (#016581, #2f8198, #60abb8, #002028, #f2f8f9) y los colores semánticos regulatorios.
- [x] T002 Configurar familias tipográficas en `@theme` en `apps/web/src/estilos.css` (`--font-titulo` con Bricolage Grotesque Variable y `--font-sans` con Inter Variable).
- [x] T003 [P] Configurar regla global `scroll-padding-top` en `apps/web/src/estilos.css` para evitar solapamiento de foco por cabecera y barras adhesivas (WCAG 2.2 Focus Not Obscured).
- [x] T004 [P] Definir utilidades para el margen de protección del logotipo ($\ge$ altura de la «M») y objetivos táctiles mínimos ($\ge 44\text{px}$) en `apps/web/src/estilos.css`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestructura y componentes atómicos base que bloquean la implementación de las historias de usuario.

**⚠️ CRITICAL**: Ninguna historia de usuario puede completarse sin estos componentes base.

- [x] T005 Crear utilidad y hook accesible `useFocusTrap` en `apps/web/src/lib/a11y.ts` con soporte para tecla Escape, ciclado de tabulación y retorno de foco al disparador.
- [x] T006 Modernizar el componente `Boton` en `apps/web/src/componentes/ui.tsx` con soporte de 5 variantes (`principal`, `secundario`, `contorno`, `peligro`, `texto`), 3 tamaños, área táctil $\ge 44\text{px}$ y estado de carga accesible (`aria-busy`).
- [x] T007 [P] Modernizar el componente `Tarjeta` en `apps/web/src/componentes/ui.tsx` con borde sutil en Turquesa al 20%, fondo blanco puro, elevación refinada y ranura para subtítulo.
- [x] T008 [P] Modernizar `Campo`, `Etiqueta` e `Info` en `apps/web/src/componentes/ui.tsx` con soporte de estado dudoso en Dorado `#e3a857`, tooltip interactivo y anuncios de error con `aria-invalid`.
- [x] T009 Rediseñar `EstadoDecision` y `TarjetaDefecto` en `apps/web/src/componentes/estado.tsx` estructurando la severidad (Aviso, Bloqueante de Forma, Bloqueante Duro) con iconos Lucide y textos en español europeo.

**Checkpoint**: Base de diseño e interactividad completada. El desarrollo de historias de usuario puede comenzar.

---

## Phase 3: User Story 1 - Experiencia de Mostrador y Dispensación Inmersiva (Priority: P1) 🎯 MVP

**Goal**: Permitir al empleado dispensar con máxima agilidad y seguridad mediante un panel HUD del lote FEFO recomendado y microinteracción de copia para el TPV de Siweb360.

**Independent Test**: Acceder a `/recetas/demo-compania-papel/dispensar/1`. Verificar que el lote recomendado se presenta con tipografía monoespaciada gigante, semáforo de caducidad, y que pulsar «Copiar lote» copia el texto al portapapeles con confirmación visual verde inmediata.

### Implementation for User Story 1

- [x] T010 [US1] Rediseñar el componente `RecordatorioTpv` en `apps/web/src/componentes/bandas.tsx` con microinteracción de estado activo (2.0 segundos), icono `CheckCircle2`, etiqueta «¡Lote copiado!» y anuncio accesible con `role="status"` y `aria-live="polite"`.
- [x] T011 [P] [US1] Implementar fallback de copiado al portapapeles en `apps/web/src/lib/portapapeles.ts` para entornos donde `navigator.clipboard` no esté disponible.
- [x] T012 [US1] Rediseñar `BandaPsicotropo` y `BandaSustitucion` en `apps/web/src/componentes/bandas.tsx` con estilo redondeado moderno, efecto `backdrop-blur-md` y z-index optimizado sin desbordar el viewport.
- [x] T013 [US1] Rediseñar la pantalla de dispensación en `apps/web/src/paginas/dispensacion.tsx` incorporando el módulo HUD de lote FEFO recomendado (lote en `text-3xl font-extrabold text-marca`, indicador de caducidad relativa y ubicación física).
- [x] T014 [US1] Ajustar espaciado entre botones de acción en `apps/web/src/paginas/dispensacion.tsx` para garantizar separación mínima de 8px (`gap-2` o superior).

**Checkpoint**: User Story 1 totalmente operativa y validable de forma independiente.

---

## Phase 4: User Story 2 - Visor Dual de Recetas y Validación OCR con Trazabilidad (Priority: P1)

**Goal**: Permitir la revisión ágil de recetas mediante visualización paralela interactiva de la imagen original (zoom, rotación, miniaturas) y formulario con foco accesible en campos dudosos.

**Independent Test**: Abrir `/recetas/:id/revision` con una receta escaneada. Rotar la imagen 90°, ampliar con zoom, y verificar que los campos dudosos muestran el badge en Dorado `#e3a857` con navegación por teclado fluida.

### Implementation for User Story 2

- [x] T015 [US2] Implementar controles de navegación por miniaturas de página, botones de rotación de 90° y reinicio de zoom en `apps/web/src/componentes/visor-receta.tsx`.
- [x] T016 [US2] Incorporar componente `ResumenErrores` (`Focusable Error Summary`) con `role="alert"` y `tabindex="-1"` en la cabecera del formulario en `apps/web/src/paginas/revision.tsx`, enlazando a los campos con incidencias.
- [x] T017 [P] [US2] Estilizar el contenedor de texto OCR reconocido en `apps/web/src/componentes/visor-receta.tsx` con tipografía monoespaciada de alto contraste y botón de copia rápida por bloque.
- [x] T018 [US2] Conectar el estado de campo enfocado con el visor de receta en `apps/web/src/paginas/revision.tsx` para resaltar visualmente el área de extracción correspondiente.

**Checkpoint**: User Story 1 y 2 plenamente operativas en paralelo.

---

## Phase 5: User Story 3 - Dashboard Operativo de Inicio (Priority: P2)

**Goal**: Presentar en `/` un saludo claro, accesos directos de mostrador con identidad de marca y tarjetas métricas con regiones vivas semánticas para lectores de pantalla.

**Independent Test**: Navegar a `/` con usuario `emp-1`. Verificar que los 4 accesos principales presentan relieve suave, iconos geométricos en Azul petróleo y que los contadores anuncian frases completas accesibles.

### Implementation for User Story 3

- [x] T019 [US3] Rediseñar las 4 tarjetas de acceso rápido («Receta», «Venta sin receta», «Pedido online», «Recepción de mercancía») en `apps/web/src/paginas/inicio.tsx` con estilos de marca, microinteracción al pasar el cursor y objetivos táctiles $\ge 44\text{px}$.
- [x] T020 [US3] Actualizar el componente `Contador` en `apps/web/src/paginas/inicio.tsx` integrando `<span role="status" aria-atomic="true">` con frases completas de contexto para tecnologías asistenciales.
- [x] T021 [US3] Estilizar los avisos informativos y de advertencia de la pantalla de inicio en `apps/web/src/paginas/inicio.tsx` utilizando los tokens semánticos correspondientes.

**Checkpoint**: Dashboard de inicio modernizado e integrado con el resto del flujo.

---

## Phase 6: User Story 4 - Cabecera Unificada y Navegación Responsiva (Priority: P2)

**Goal**: Unificar la doble cabecera superior en una sola barra responsiva y accesible que proteja el margen del logotipo y ofrezca menú móvil deslizante.

**Independent Test**: Modificar el ancho de pantalla de 1440px a 768px y 375px. Verificar que en escritorio se presenta la franja horizontal unificada con el logo horizontal normativo, y en pantallas estrechas conmuta al isotipo de la huella y menú táctil.

### Implementation for User Story 4

- [x] T022 [US4] Reemplazar la doble cabecera en `apps/web/src/componentes/layout.tsx` por una barra única integrada de 64px sobre fondo Blanco hielo/blanco puro, con margen perimetral del logotipo $\ge$ altura de la «M».
- [x] T023 [US4] Estilizar los enlaces de navegación activa en `apps/web/src/componentes/layout.tsx` con indicador inferior en Azul petróleo y tipografía `Inter Medium`.
- [x] T024 [P] [US4] Implementar menú lateral desplegable (drawer) para pantallas estrechas (< 1024px) en `apps/web/src/componentes/layout.tsx` con el isotipo de la huella y atrapamiento de foco accesible.
- [x] T025 [US4] Rediseñar el selector de usuario dev y el indicador de MFA en `apps/web/src/componentes/layout.tsx` para integrarse limpiamente sin provocar desbordamiento horizontal.
- [x] T025b [US4] Implementar el selector accesible de 3 estados («Claro», «Oscuro», «Sistema») con persistencia en `localStorage` (`mmx-tema-ui`) y listener dinámico de `prefers-color-scheme` en `apps/web/src/componentes/layout.tsx`.

**Checkpoint**: Navegación de escritorio y móvil unificada y adaptativa.

---

## Phase 7: User Story 5 - Asistente IA Integrado con Citas Normativas (Priority: P3)

**Goal**: Ofrecer asistencia clínica y regulatoria contextual mediante un cajón lateral animado con streaming de respuestas, tabla comparativa estructurada y chips de citas oficiales.

**Independent Test**: Pulsar «Preguntar al asistente» en una línea de receta. Verificar que el panel lateral se despliega con focus trap, tecla Escape funcional y tabla de criterios estilizada con la paleta de Mundo Mascotix.

### Implementation for User Story 5

- [x] T026 [US5] Integrar `useFocusTrap` y tecla Escape en el cajón lateral de `apps/web/src/componentes/asistente.tsx`.
- [x] T027 [US5] Estilizar `TablaComparativaCriterios` en `apps/web/src/componentes/asistente.tsx` con los tokens de color corporativos y semánticos.
- [x] T028 [P] [US5] Rediseñar los chips de fuentes citadas oficiales (CIMAVet, AEMPS, RD 666/2023) en `apps/web/src/componentes/asistente.tsx` con visualización emergente accesible.

**Checkpoint**: Todas las historias de usuario implementadas y verificables de extremo a extremo.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verificación de accesibilidad, estabilidad en tests automatizados y rendimiento general.

- [x] T029 [P] Verificar que todas las animaciones y transiciones respetan `@media (prefers-reduced-motion: reduce)` en `apps/web/src/estilos.css`.
- [x] T030 Ejecutar auditoría de contraste de color y verificar que ningún elemento interactivo incumple WCAG 2.2 AA (4.5:1) ni objetivos táctiles de 44px.
- [x] T031 Ejecutar suite completa de tests de componentes y tipo estricto (`pnpm typecheck && pnpm --filter @mmx/web test`).
- [x] T032 Ejecutar suite de pruebas de integración de extremo a extremo en Playwright (`pnpm --filter @mmx/web test:e2e`).
- [x] T033 Validar los escenarios paso a paso descritos en `specs/007-modernizacion-frontend-ui/quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies
1. **Setup (Phase 1)**: Inmediata, no tiene dependencias.
2. **Foundational (Phase 2)**: Depende de Phase 1. Bloquea todas las historias de usuario.
3. **User Stories (Phases 3 a 7)**: Dependen de la finalización de Phase 2.
   - P1 (US1 y US2) pueden ejecutarse en paralelo o en secuencia.
   - P2 (US3 y US4) continúan sobre la base establecida.
   - P3 (US5) se integra sobre los componentes de layout y estilos.
4. **Polish (Phase 8)**: Depende de la finalización de las historias de usuario deseadas.

---

## Implementation Strategy

### MVP First (Phases 1, 2 y 3)
1. Completar Setup (Tokens `@theme`) y Foundational (`Boton`, `Tarjeta`, `a11y`).
2. Completar User Story 1 (HUD FEFO de mostrador y copia instantánea para TPV).
3. **Validación MVP**: Probar la dispensación de mostrador en `/recetas/demo-compania-papel/dispensar/1`.
4. Continuar incrementalmente con US2 (Visor de recetas), US3 (Dashboard), US4 (Cabecera) y US5 (Asistente).
