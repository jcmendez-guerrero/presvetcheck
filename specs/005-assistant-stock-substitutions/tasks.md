# Tasks: Asistente de sustitución de medicamentos con consulta de CIMAVet y stock en tiempo real

**Input**: Design documents from `/specs/005-assistant-stock-substitutions/` (`plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/herramientas-sustitucion-stock.md`, `quickstart.md`)

**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `contracts/`

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Exact file paths included in all task descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Esquemas y definiciones compartidas en `@mmx/shared` y dependencias del asistente

- [X] T001 [P] Añadir esquemas de validación Zod `ArgsBuscarSustitutos` y `ArgsConsultarStock` en `packages/shared/src/schemas/asistente.ts`
- [X] T002 [P] Extender la interfaz `DepsHerramientas` en `packages/assistant/src/tools/contexto.ts` para admitir dependencia opcional de consulta de stock (`stock?: StockPort | null`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Actualización del rol del asistente en mostrador e inyección de dependencias en la API

**⚠️ CRITICAL**: Ninguna historia de usuario puede completarse hasta que el rol y la conexión de dependencias estén preparados

- [X] T003 Actualizar `INSTRUCCIONES` en `packages/assistant/src/instrucciones.ts` para fijar que el usuario es el personal del establecimiento dispensador (no el tutor del animal), prohibir advertencias de autoconsumo («consulte a su veterinario antes de cambiar el fármaco»), y guiar en el procedimiento legal de sustitución por falta de existencias (RD 1157/2021)
- [X] T004 Inyectar el puerto de stock `stock: d.stock` en la llamada a `crearHerramientas` dentro de `apps/api/src/crear-deps.ts`

**Checkpoint**: Base lista: el orquestador tiene acceso al contexto de stock y las instrucciones orientan al personal de mostrador.

---

## Phase 3: User Story 1 & 2 - Consulta de sustitución con candidatos y verificación de inventario (Priority: P1) 🎯 MVP

**Goal**: Permitir al personal consultar alternativas autorizadas ante falta de existencias de un medicamento prescrito (ej. Prednicortone 5 mg perro), consultando equivalencias en CIMAVet y existencias en Siweb360, presentando opciones con y sin stock y recordando las 3 obligaciones legales.

**Independent Test**: Ejecutar una consulta sobre un medicamento prescrito sin existencias (ej. Prednicortone 5 mg para perro). El asistente debe invocar `buscar_sustitutos`, devolver los equivalentes autorizados desglosados según disponibilidad en el almacén «Farmacia», y detallar los pasos legales (consentimiento tutor, comunicación prescriptor y receta apartada para garante en modo POST), sin dirigirse al usuario como tutor del animal.

### Tests for User Story 1 & 2

- [X] T005 [P] [US1] Crear suite de pruebas unitarias para `buscar_sustitutos` y `consultar_stock` en `packages/assistant/test/tools-sustitucion.test.ts`
- [X] T006 [P] [US1] Añadir test de integración en `packages/assistant/test/orchestrator.test.ts` para la consulta de sustitución de Prednicortone 5 mg perro validando el rol de personal dispensador y la presentación de stock

### Implementation for User Story 1 & 2

- [X] T007 [P] [US2] Implementar la herramienta de solo lectura `consultar_stock` en `packages/assistant/src/tools/stock.ts`
- [X] T008 [US1] Implementar la herramienta de solo lectura `buscar_sustitutos` en `packages/assistant/src/tools/sustitucion.ts` integrando `cimavet.nregistrosMismosPa`, `evaluarEquivalencia` de `@mmx/domain`, y consulta de stock disponible en `StockPort`
- [X] T009 [US1] Registrar `buscar_sustitutos` y `consultar_stock` en `packages/assistant/src/tools/index.ts` y exportarlas en `packages/assistant/src/index.ts`
- [X] T010 [US1] Integrar la ejecución en `packages/assistant/src/orchestrator.ts` asegurando que las fuentes y citas de sustitución y stock se computen correctamente

**Checkpoint**: MVP operativo. El asistente responde a consultas de sustitución por falta de existencias con datos de stock reales de la farmacia.

---

## Phase 4: User Story 3 - Casos sin stock o sin candidatos autorizados (Priority: P2)

**Goal**: Orientar adecuadamente al empleado cuando todos los medicamentos equivalentes autorizados tienen stock cero o cuando no existe ningún equivalente en CIMAVet para esa especie y principio activo.

**Independent Test**: Consultar por un medicamento cuyos equivalentes autorizados tienen 0 unidades en inventario. El asistente debe clasificarlos como «Sin stock en almacén» y recomendar generar pedido al distribuidor (`PEDIR`), o indicar la necesidad de nueva prescripción si no hay ningún equivalente en el catálogo.

### Implementation for User Story 3

- [X] T011 [US3] Añadir casos de prueba en `packages/assistant/test/tools-sustitucion.test.ts` para candidatos con stock cero y para fármacos sin equivalentes autorizados
- [X] T012 [US3] Refinar el formateo de respuesta en `packages/assistant/src/tools/sustitucion.ts` y las directrices en `packages/assistant/src/instrucciones.ts` para orientar a la tramitación de pedido (`PEDIR`) ante falta global de stock

**Checkpoint**: Respuestas robustas y sin alucinaciones cuando no hay existencias de ningún sustituto en tienda.

---

## Phase 5: User Story 4 - Bloqueo normativo de medicamentos no sustituibles (Priority: P2)

**Goal**: Garantizar que el asistente deniegue de manera determinista la sustitución de medicamentos biológicos, inmunológicos o excluidos por normativa sanitaria (RD 1157/2021).

**Independent Test**: Consultar por la sustitución de una vacuna o medicamento inmunológico. El asistente debe responder que la sustitución está legalmente excluida por normativa y recomendar `PEDIR`.

### Implementation for User Story 4

- [X] T013 [US4] Añadir casos de prueba en `packages/assistant/test/tools-sustitucion.test.ts` con medicamentos biológicos e inmunológicos
- [X] T014 [US4] Integrar la verificación determinista `sustitucionPermitida` de `@mmx/domain` al inicio de `buscar_sustitutos` en `packages/assistant/src/tools/sustitucion.ts` para devolver de inmediato el bloqueo legal y sus motivos sin evaluar equivalencias

**Checkpoint**: Protección sanitaria y legal completa contra sustituciones indebidas.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validación integral, linters, pruebas de tipos y escenarios de quickstart

- [X] T015 [P] Actualizar la documentación y contratos en `specs/005-assistant-stock-substitutions/contracts/herramientas-sustitucion-stock.md` con los detalles finales
- [X] T016 Ejecutar los tests unitarios y de integración: `pnpm --filter @mmx/assistant test`
- [X] T017 Ejecutar la verificación completa de calidad: `pnpm lint && pnpm typecheck && pnpm test`
- [X] T018 Validar los escenarios de prueba descritos en `specs/005-assistant-stock-substitutions/quickstart.md`

---

## Phase 7: Normalización Canónica CIMAVet y Aclaración de Indicación (FR-013, FR-014, FR-015)

**Purpose**: Resolver las discrepancias de IDs de CIMAVet (eliminando falsos negativos por IDs negativos como `-29`), armonizar códigos de vía e incorporar la solicitud de aclaración de patología en sustitución de mostrador.

**Independent Test**: Ejecutar una consulta de sustitución para «HEDYLON 5 MG 30 COMP para un perro». El sistema debe resolver la especie canónica «Perros» (`id: 14`), identificar a **Prednicortone 5 mg 30 comprimidos** como sustituto válido con 7 unidades en stock en Siweb360, y solicitar al profesional la aclaración de la indicación prescrita para completar la evaluación de equivalencia reglamentaria (Escenario 4 de `quickstart.md`).

### Tests for Phase 7

- [X] T019 [P] [US1] Añadir pruebas unitarias en `packages/cimavet/test/client.test.ts` y `packages/cimavet/test/nomenclator-jobs.test.ts` para `especiePorTexto` verificando el descarte de IDs sintéticos o negativos (`id <= 0`) ante registros duplicados
- [X] T020 [P] [US1] Añadir test unitario en `packages/assistant/test/tools-sustitucion.test.ts` que simule la búsqueda de sustitutos de Hedylon 5 mg con Prednicortone 5 mg verificando que no se bloquea por especie ni vía y activa `requiereAclaracionIndicacion`

### Implementation for Phase 7

- [X] T021 [US1] Modificar `especiePorTexto` en `packages/cimavet/src/repo.ts` y en `apps/api/src/servicios/medicamentos.ts` para filtrar estrictamente `cimavetMaestra.id > 0` y ordenar por `id asc` para seleccionar el ID canónico positivo (`14` para «Perros») (FR-013)
- [X] T022 [US1] Reconciliar y asegurar correspondencia de vías de administración en `packages/cimavet/src/normalizar.ts` y `packages/cimavet/src/repo.ts` entre los códigos de Nomenclátor XML (`cod_via_admin`) y la API REST (`viasAdministracion.codigo` / `id`) (FR-014)
- [X] T023 [US1] Actualizar `buscar_sustitutos` en `packages/assistant/src/tools/sustitucion.ts` y `simulaciones-medicamento.ts` para emitir `requiereAclaracionIndicacion: true` cuando la consulta no aporte indicación clínica expresa y asegurar que `simular_equivalencia` use la especie canónica resuelta (FR-015)
- [X] T024 [US1] Actualizar `INSTRUCCIONES` en `packages/assistant/src/instrucciones.ts` para orientar al modelo a solicitar aclaración de la indicación prescrita al dispensador antes de confirmar la sustitución definitiva
- [X] T025 [P] Ejecutar la suite completa de linters, chequeo de tipos y pruebas automatizadas: `pnpm lint && pnpm typecheck && pnpm test`
- [X] T026 Validar de extremo a extremo el Escenario 4 de `specs/005-assistant-stock-substitutions/quickstart.md` (Hedylon 5 mg vs Prednicortone 5 mg con stock)

**Checkpoint**: Consulta de Hedylon 5 mg para perro propone Prednicortone 5 mg con stock en mostrador y solicita la aclaración de indicación sin falsos negativos de especie o vía.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias, inicia inmediatamente.
- **Foundational (Phase 2)**: Depende de Phase 1. Bloquea las historias de usuario.
- **User Story 1 & 2 (Phase 3 - MVP)**: Depende de Phase 2. Entrega el flujo principal de sustitución con stock.
- **User Story 3 (Phase 4)**: Depende de Phase 3. Maneja casos de desabastecimiento total.
- **User Story 4 (Phase 5)**: Depende de Phase 3. Aplica bloqueos deterministas de no sustituibles.
- **Polish (Phase 6)**: Validación inicial de la base de herramientas.
- **Normalización y Aclaración (Phase 7)**: Depende de Phase 6. Corrige falsos negativos de CIMAVet (FR-013, FR-014) y añade la solicitud interactiva de indicación prescrita (FR-015).

### User Story Dependencies

```mermaid
flowchart TD
    Setup["Phase 1: Setup (T001-T002)"] --> Foundational["Phase 2: Foundational (T003-T004)"]
    Foundational --> US1_US2["Phase 3: US1 & US2 - Sustitución y Stock (T005-T010) [MVP]"]
    US1_US2 --> US3["Phase 4: US3 - Sin stock / Pedir (T011-T012)"]
    US1_US2 --> US4["Phase 5: US4 - No sustituibles (T013-T014)"]
    US3 --> Polish["Phase 6: Polish & Verificación (T015-T018)"]
    US4 --> Polish
    Polish --> Phase7["Phase 7: Normalización CIMAVet y Aclaración Indicación (T019-T026)"]
```

### Parallel Opportunities

- `T001` y `T002` se pueden ejecutar en paralelo (archivos independientes).
- `T005`, `T006` y `T007` se pueden escribir en paralelo una vez completada la fase Foundational.
- `US3` y `US4` pueden implementarse en paralelo tras completar el MVP (`US1 & US2`).
- En Phase 7, `T019` y `T020` (tests de CIMAVet y de sustitución) se pueden escribir en paralelo antes de la implementación de `T021-T024`.

---

## Implementation Strategy

### MVP First (User Story 1 & 2)
1. Completar Setup (`T001`-`T002`) y Foundational (`T003`-`T004`).
2. Implementar herramientas `buscar_sustitutos` y `consultar_stock` con tests (`T005`-`T010`).
3. **Validar MVP**: Probar consulta de Prednicortone 5 mg y verificar respuesta en mostrador.

### Incremental Delivery & Robustez Regulatoria
1. Añadir gestión de desabastecimiento total y no sustituibles (`T011`-`T014`).
2. Pasar linter, typecheck y suite completa de tests (`T015`-`T018`).
3. Aplicar normalización estricta de CIMAVet (`id > 0`, vías unificadas) y flujo de aclaración interactiva de indicación clínica (`T019`-`T026`).
