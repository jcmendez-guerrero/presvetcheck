# Tasks: Sincronización y autorrelleno de veterinarios y clínicas con SiWeb (ERP)

**Input**: Design documents from `/specs/006-siweb-vet-clinic-sync/` (`plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/contactos-siweb.md`, `quickstart.md`)

**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `contracts/`

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Exact file paths included in all task descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Esquemas Zod y utilidades puras de serialización/parseo de notas en `@mmx/shared`

- [ ] T001 [P] Crear esquemas Zod de metadatos de veterinario y contratos de contacto en `packages/shared/src/schemas/contactos-siweb.ts`
- [ ] T002 [P] Implementar utilidades puras de serialización y parseo de delimitador `---PRESVET---` en `packages/shared/src/utils/notas-siweb.ts`
- [ ] T003 Re-exportar esquemas y utilidades de contactos de SiWeb en `packages/shared/src/index.ts`
- [ ] T004 [P] Crear tests unitarios para `parsearNotasSiweb` y `formatearNotasSiweb` en `packages/shared/test/notas-siweb.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extensión del cliente HTTP y esquemas de SiWeb en `packages/siweb`

**⚠️ CRITICAL**: Ninguna historia de usuario puede completarse hasta que el cliente de SiWeb disponga de los métodos de búsqueda y consulta de contactos

- [ ] T005 [P] Extender esquemas de detalle y creación de contactos de SiWeb en `packages/siweb/src/schemas.ts`
- [ ] T006 Implementar métodos `contactos()`, `contacto()`, `crearContacto()` y `actualizarContacto()` en `packages/siweb/src/client.ts`
- [ ] T007 [P] Crear tests unitarios con mocks de MSW para los nuevos métodos de contactos en `packages/siweb/test/contactos.test.ts`

**Checkpoint**: Base de integración lista: el cliente de SiWeb puede listar, obtener y registrar contactos en el ERP.

---

## Phase 3: User Story 1 - Búsqueda y autorrelleno ágil de veterinario y clínica desde SiWeb (Priority: P1) 🎯 MVP

**Goal**: Al empezar a escribir el nombre o colegiado (o tras OCR), el personal ve sugerencias de contactos del ERP (clientes y proveedores) y autorrellena con un clic todos los campos de veterinario y clínica en la receta.

**Independent Test**: Abrir la pantalla de revisión de una receta y escribir las primeras letras de un veterinario existente en SiWeb. Al seleccionar la sugerencia, los campos (nombre, colegiado, colegio, teléfono, email, clínica, dirección) se autorrellenan inmediatamente en el formulario.

### Tests for User Story 1

- [ ] T008 [P] [US1] Crear tests de endpoints `GET /api/contactos-siweb` y `GET /api/contactos-siweb/:id` en `apps/api/test/contactos-siweb.test.ts`
- [ ] T009 [P] [US1] Crear test de componente para autocompletado en `apps/web/src/componentes/selector-contacto-siweb.test.tsx`

### Implementation for User Story 1

- [ ] T010 [US1] Implementar rutas `GET /api/contactos-siweb` y `GET /api/contactos-siweb/:id` con extracción de metadatos en `apps/api/src/rutas/contactos-siweb.ts`
- [ ] T011 [US1] Registrar rutas de contactos de SiWeb en `apps/api/src/server.ts`
- [ ] T012 [P] [US1] Implementar componente `SelectorContactoSiweb` con autocompletado y debounce en `apps/web/src/componentes/selector-contacto-siweb.tsx`
- [ ] T013 [US1] Integrar `SelectorContactoSiweb` en la tarjeta de Veterinario y en DatosRegistro dentro de `apps/web/src/paginas/revision.tsx`
- [ ] T014 [US1] Añadir mapeo automático de campos del veterinario y clínica seleccionados al estado de `RecetaConfirmadaInput` y seguimiento de modificaciones para confirmación de actualización de SiWeb (FR-014) en `apps/web/src/paginas/revision.tsx`

**Checkpoint**: MVP operativo. El personal puede autocompletar veterinarios y clínicas existentes en SiWeb en menos de 5 segundos.

---

## Phase 4: User Story 2 - Detección de contacto inexistente y alta en SiWeb tras registro (Priority: P1)

**Goal**: Si el veterinario o clínica introducidos no constan en SiWeb, avisar al usuario y permitir su alta rápida en el ERP codificando la información facultativa en el bloque JSON de `notas`.

**Independent Test**: Rellenar los datos de un veterinario nuevo no existente en SiWeb, pulsar el botón de alta rápida en SiWeb, confirmar el diálogo y verificar que el contacto queda creado en SiWeb con sus atributos profesionales empaquetados en `notas`.

### Tests for User Story 2

- [ ] T015 [P] [US2] Añadir tests para endpoint `POST /api/contactos-siweb` validando serialización en notas en `apps/api/test/contactos-siweb.test.ts`
- [ ] T016 [P] [US2] Añadir test para modal de alta rápida de contacto en `apps/web/src/componentes/selector-contacto-siweb.test.tsx`

### Implementation for User Story 2

- [ ] T017 [US2] Implementar endpoint `POST /api/contactos-siweb` con validación Zod, llamada a `SiwebClient` y registro de evento de auditoría en `apps/api/src/rutas/contactos-siweb.ts`
- [ ] T018 [US2] Implementar diálogo modal de alta rápida de contacto con selector de alcance de entidad (veterinario, clínica o ambos, FR-015) y fallback de email `@sin-mail.mundo-mascotix.es` (FR-013) en `apps/web/src/componentes/selector-contacto-siweb.tsx`
- [ ] T019 [US2] Conectar acción de alta y diálogo de confirmación de actualización de SiWeb ante datos modificados (FR-014) desde `apps/web/src/paginas/revision.tsx`
- [ ] T020 [US2] Asegurar que ningún dato de tutor de animal (nombre, DNI, dirección, teléfono) se transfiera en la creación en `apps/api/src/rutas/contactos-siweb.ts`

**Checkpoint**: Ciclo completo bidireccional: búsqueda y autorrelleno de existentes + alta de nuevos contactos en el ERP.

---

## Phase 5: User Story 3 - Lectura e interpretación de metadatos profesionales en notas del ERP (Priority: P2)

**Goal**: Garantizar la compatibilidad robusta ante notas con texto humano comercial previo, JSON puro o notas mal formateadas sin arrojar errores.

**Independent Test**: Configurar en SiWeb un contacto con texto libre y bloque `---PRESVET---`; comprobar que la lectura extrae el número de colegiado correctamente y que la edición posterior conserva el texto libre preexistente.

### Tests for User Story 3

- [ ] T021 [P] [US3] Añadir casos de prueba para notas con texto previo, JSON corrupto y texto plano en `packages/shared/test/notas-siweb.test.ts`
- [ ] T022 [P] [US3] Añadir tests de tolerancia a notas corruptas en `apps/api/test/contactos-siweb.test.ts`

### Implementation for User Story 3

- [ ] T023 [US3] Refinar tolerancia en `parsearNotasSiweb` para rescatar notas libres sin lanzar excepciones en `packages/shared/src/utils/notas-siweb.ts`
- [ ] T024 [US3] Preservar texto libre previo de SiWeb al actualizar notas en `apps/api/src/rutas/contactos-siweb.ts`

**Checkpoint**: Resiliencia probada: el ERP convive con anotaciones manuales sin romper la sincronización.

---

## Phase 6: User Story 4 - Búsqueda combinada y desambiguación de profesionales y centros (Priority: P3)

**Goal**: Presentar información discriminatoria suficiente (número de colegiado, localidad, provincia, NIF/CIF, cliente vs proveedor) para desambiguar rápidamente contactos homónimos.

**Independent Test**: Buscar un nombre con múltiples coincidencias; verificar que la lista desplegable muestra claramente la provincia, colegiado y clínica asociada para elegir la opción correcta.

### Tests for User Story 4

- [ ] T025 [P] [US4] Añadir tests de visualización de información discriminatoria en `apps/web/src/componentes/selector-contacto-siweb.test.tsx`

### Implementation for User Story 4

- [ ] T026 [US4] Añadir etiquetas visuales discriminatorias (colegiado, CIF, localidad, cliente/proveedor) en los elementos de la lista en `apps/web/src/componentes/selector-contacto-siweb.tsx`
- [ ] T027 [US4] Soportar autocompletado simultáneo de clínica vinculada cuando el veterinario tenga clínica asociada en `apps/web/src/paginas/revision.tsx`

**Checkpoint**: Experiencia de usuario pulida ante nombres ambiguos o múltiples sedes de clínicas.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentación, glosario, ayudas en pantalla y verificación final

- [ ] T028 [P] Actualizar ayudas contextuales para el autocompletado de SiWeb en `packages/shared/src/ayuda/secciones.ts`
- [ ] T029 [P] Documentar términos y convención de notas de SiWeb en `docs/glosario.md`
- [ ] T030 Ejecutar validación de quickstart y verificar suite completa (`pnpm lint && pnpm typecheck && pnpm test`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias - se puede iniciar de inmediato.
- **Foundational (Phase 2)**: Depende de Phase 1 (esquemas compartidos). Bloquea la implementación de los servicios de las historias de usuario.
- **User Story 1 (Phase 3)**: Depende de Phase 2. Constituye el **MVP**.
- **User Story 2 (Phase 4)**: Depende de Phase 2 y se integra con la interfaz de US1.
- **User Story 3 (Phase 5)**: Depende de Phase 1 y Phase 2. Refina la tolerancia de parseo y serialización.
- **User Story 4 (Phase 6)**: Depende de US1 y US2 para afinar la presentación y desambiguación.
- **Polish (Phase 7)**: Depende de la finalización de las historias de usuario.

### Parallel Opportunities

- T001, T002, T004 se pueden ejecutar en paralelo dentro de Phase 1.
- T005 y T007 se pueden ejecutar en paralelo en Phase 2.
- En Phase 3: T008 y T009 (tests) pueden desarrollarse en paralelo; T010 y T012 pueden prepararse en paralelo.
- En Phase 4: T015 y T016 pueden ejecutarse en paralelo.
- T028 y T029 de Polish pueden ejecutarse en paralelo.

---

## Parallel Example: User Story 1

```bash
# Ejecutar tests de User Story 1 juntos:
pnpm --filter @mmx/api test test/contactos-siweb.test.ts
pnpm --filter @mmx/web test src/componentes/selector-contacto-siweb.test.tsx
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Completar **Phase 1: Setup** (esquemas y utilidades de notas).
2. Completar **Phase 2: Foundational** (cliente SiWeb ampliado).
3. Completar **Phase 3: User Story 1** (búsqueda y autocompletado).
4. **Validar MVP**: Probar que buscar un contacto existente autocompleta el formulario de la receta.
5. Continuar incrementalmente con **Phase 4: User Story 2** (alta directa en SiWeb).
