# Tasks: El diálogo «Usar el móvil» siempre cabe en la pantalla

**Input**: Documentos de diseño de `/specs/008-fix-mobile-qr-dialog/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/dialogo-movil.md, quickstart.md (no hay data-model.md: no cambian datos)

**Tests**: Sí. FR-008 exige una comprobación automática con ventanas bajas (Playwright, research.md R6).

**Organization**: Tareas agrupadas por historia de usuario. El arreglo ya está implementado en la rama
`008-fix-mobile-qr-dialog` (commits `9a8670b` y `719d2f7`, PR #19); las tareas hechas están marcadas `[x]`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: historia de usuario de la spec (US1, US2)

## Path Conventions

Aplicación web en monorepo: solo cambia `apps/web/` (`src/componentes/`, `src/lib/`, `e2e/`).

---

## Phase 1: Setup (Shared Infrastructure)

Sin tareas: no hay dependencias, configuración ni estructura nuevas (`react-dom` y Playwright ya están instalados).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Sacar el diálogo de la cabecera; sin esto ninguna historia funciona (research.md R1, R2).

- [x] T001 Renderizar `DialogoMovil` en `document.body` con `createPortal` desde `BotonMovil`, con comentario de una línea sobre el `backdrop-filter` de la cabecera, en apps/web/src/componentes/movil-pc.tsx
- [x] T002 Estabilizar el cierre con `const cerrar = useCallback(() => setAbierto(false), [])` y pasarlo como `onCerrar` (lo exigen `useFocusTrap` y el efecto de cierre automático) en apps/web/src/componentes/movil-pc.tsx

**Checkpoint**: el velo `fixed inset-0` ocupa toda la ventana y oscurece la página (FR-009).

---

## Phase 3: User Story 1 - Leer el QR en una pantalla baja (Priority: P1) 🎯 MVP

**Goal**: El panel nunca se sale de la ventana; el título y el QR entero se pueden ver (FR-001, FR-002, FR-003, FR-005, FR-006).

**Independent Test**: Abrir el diálogo con la ventana a 430 px de alto: el título está dentro de la ventana y el QR se ve entero al desplazar el panel (quickstart.md §2).

### Tests for User Story 1

- [x] T003 [P] [US1] Crear prueba e2e con ventanas de 300, 430, 600 y 1080 px que compruebe: diálogo hijo de `<body>`, velo a toda la ventana, panel con `top ≥ 0` y `bottom ≤ alto`, título visible y QR entero tras desplazarlo (contracts/dialogo-movil.md), en apps/web/e2e/dialogo-movil.spec.ts

### Implementation for User Story 1

- [x] T004 [US1] Añadir al panel `max-h-[90vh] overflow-auto` (mismo patrón que forzado.tsx, ticket-multi-rx.tsx y resultado.tsx) sin reducir el QR `w-64`, en apps/web/src/componentes/movil-pc.tsx
- [x] T005 [US1] Fijar el color del texto del velo a `text-slate-900` para que el título se lea sobre el panel blanco en tema oscuro (research.md R7), en apps/web/src/componentes/movil-pc.tsx
- [x] T006 [US1] Abrir el panel arriba: título con `tabIndex={-1}` y `data-autofocus` como foco inicial, para que el foco no baje a «Desconectar el móvil» y desplace el panel (research.md R7), en apps/web/src/componentes/movil-pc.tsx

**Checkpoint**: US1 completa: con 430 px se lee el QR a la primera (SC-001, SC-002).

---

## Phase 4: User Story 2 - Cerrar o desconectar en una pantalla baja (Priority: P2)

**Goal**: «Cerrar» y «Desconectar el móvil» siempre alcanzables con ratón y teclado (FR-004).

**Independent Test**: Con la ventana a 430 px, cerrar el diálogo solo con el ratón y luego solo con el teclado (Tab, Shift+Tab, Escape).

### Tests for User Story 2

- [x] T007 [P] [US2] Ampliar la prueba e2e: «Desconectar el móvil» visible, «Cerrar» cierra; Shift+Tab desde el título va a «Cerrar», Tab no sale del diálogo, Escape cierra y el foco vuelve a `boton-movil`, en apps/web/e2e/dialogo-movil.spec.ts
- [x] T008 [P] [US2] Prueba de no regresión: con el asistente abierto (panel sin velo), Tab en la página no salta al panel, en apps/web/e2e/asistente.spec.ts

### Implementation for User Story 2

- [x] T009 [US2] Marcar el diálogo con `aria-modal="true"` y usar `useFocusTrap(panelRef, true, onCerrar)` sobre el panel, en apps/web/src/componentes/movil-pc.tsx
- [x] T010 [US2] `useFocusTrap`: enfocar primero `[data-autofocus]` si existe; si el foco está **dentro** del contenedor pero fuera de la lista de enfocables, Tab/Shift+Tab va al primero/último; si está fuera, no intervenir. Opt-in: no cambia los demás diálogos. En apps/web/src/lib/a11y.ts

**Checkpoint**: US1 y US2 funcionan; el cajón lateral, la búsqueda y el asistente se comportan como antes.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T011 Revisar FR-007: confirmar que ningún otro diálogo combina «dentro de un antecesor con `backdrop-filter`» y «sin límite de altura» (research.md R5); sin cambios
- [x] T012 Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y la suite Playwright completa desde la raíz (Constitución II)
- [x] T013 Validar a mano según specs/008-fix-mobile-qr-dialog/quickstart.md a 1280×430 en tema oscuro
- [ ] T014 Leer el QR con un móvil real a 430 px de alto contra el entorno no productivo tras desplegar (SC-001; no automatizable)

---

## Dependencies & Execution Order

- **Phase 2 (T001–T002)** bloquea todo: sin el portal el velo sigue atrapado en la cabecera.
- **US1 (Phase 3)** depende de la Phase 2. **US2 (Phase 4)** depende de la Phase 2 y comparte archivo con US1
  (`movil-pc.tsx`), así que sus tareas de implementación van después de las de US1.
- T006 (US1) usa el `data-autofocus` que lee T010 (US2): implementarlas juntas o T010 antes que T006.
- **Phase 5** al final; T014 solo tras desplegar.

### Parallel Opportunities

- T003, T007 y T008 son pruebas en archivos distintos de la implementación: se pueden escribir en paralelo.
- T010 (`a11y.ts`) puede hacerse en paralelo con T004–T005 (`movil-pc.tsx`).

```text
# US1 + US2 en paralelo (archivos distintos):
T003 apps/web/e2e/dialogo-movil.spec.ts
T008 apps/web/e2e/asistente.spec.ts
T010 apps/web/src/lib/a11y.ts
```

## Implementation Strategy

- **MVP**: Phase 2 + US1 (T001–T006). Con eso el QR se puede leer, que es el defecto.
- **Incremento**: US2 (T007–T010) para teclado y cierre seguro.
- **Estado**: todo hecho salvo T014 (comprobación con móvil real tras desplegar).

---

## Phase 6: Convergence

- [x] T015 Impedir que la página de detrás se desplace con la rueda del ratón mientras el diálogo está abierto (hoy, girar la rueda sobre el velo oscuro desplaza la página 56 px a 1280×430): bloquear el desplazamiento del documento al abrir y restaurarlo al cerrar, y añadir `overscroll-contain` al panel; ampliar apps/web/e2e/dialogo-movil.spec.ts para comprobar que el desplazamiento de la página no cambia; en apps/web/src/componentes/movil-pc.tsx per spec Edge Cases («The page behind the dialog must not scroll instead of the dialog») (partial)
- [x] T016 Traducir al español europeo specs/008-fix-mobile-qr-dialog/spec.md y specs/008-fix-mobile-qr-dialog/checklists/requirements.md, manteniendo identificadores (FR-xxx, SC-xxx, US1/US2) y contenido; el plan ya lo marcaba como ⚠️ per Constitution V (contradicts)
