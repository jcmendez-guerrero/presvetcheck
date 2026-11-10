---
description: "Task list for 011-manual-prescription-entry"
---

# Tasks: Alta manual de recetas sin imagen

**Input**: Design documents from `specs/011-manual-prescription-entry/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/api.md](contracts/api.md), [quickstart.md](quickstart.md)

**Tests**: Included. The constitution (II. Testing discipline) and `AGENTS.md` require tests for every behavior change;
CIMAVet and Siweb360 are always mocked with MSW + `fixtures/`, never called for real.

**Organization**: Grouped by user story. `packages/domain` is NOT modified (research R2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3 from spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration switch, error codes and glossary

- [X] T001 [P] Add `MANUAL_PRESCRIPTION_ENTRY: z.enum(['enabled','disabled']).default('disabled')` next to `RETROSPECTIVE_DISPENSATION_MODE` in packages/shared/src/config.ts, and document it (description + default) in .env.example
- [X] T002 [P] Add error codes `ALTA_MANUAL_DESHABILITADA`, `MEDICAMENTO_NO_SELECCIONADO`, `ESPECIE_NO_SELECCIONADA`, `FECHA_ORIGINAL_INVALIDA` to packages/shared/src/codes.ts with clear European Spanish texts in packages/shared/src/i18n/errores.es.json (e.g. «Elige el medicamento de la lista de CIMAVet»)
- [X] T003 [P] Add glossary entries «alta manual» and «custodia del papel» to docs/glosario.md
- [X] T004 Extend packages/shared/test/config.test.ts and packages/shared/test/rules-and-i18n.test.ts so the new variable defaults to `disabled` and every new code has a Spanish text

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, role group and per-receta access check used by every story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Add `origen` (text not null default 'escaneo'), `motivoAlta` (text) and `custodiaPapel` (text) to `receta` in packages/db/src/schema/recetas.ts, with an index on `origen`
- [X] T006 Create packages/db/migrations/0019_receta_alta_manual.sql (columns, index, `check (origen <> 'manual' or motivo_alta is not null)`) and its entry in packages/db/migrations/meta; confirm 0019 is not used on main or other open branches first
- [X] T007 Add `ROLES.altaManual = ['veterinaria_responsable']` to the role groups in apps/api/src/plugins/auth.ts
- [X] T008 In apps/api/src/servicios/recetas.ts add a private `exigirAccesoManual(r, c)` helper: if `r.origen === 'manual'`, throw `ALTA_MANUAL_DESHABILITADA` when `config.MANUAL_PRESCRIPTION_ENTRY !== 'enabled'` and `PROHIBIDO` when the user lacks `veterinaria_responsable`; call it in `obtener`, `imagen`, `validez`, `confirmar`, `completarRegistro`, `comprobar`, `evaluar` and `sustituirManual`
- [X] T009 Expose `altaManualHabilitada: config.MANUAL_PRESCRIPTION_ENTRY === 'enabled'` in `GET /api/config/publica` in apps/api/src/rutas/sistema.ts

**Checkpoint**: Foundation ready

---

## Phase 3: User Story 1 - Dar de alta una receta sin imagen con datos de CIMAVet (Priority: P1) 🎯 MVP

**Goal**: The veterinaria responsable creates a receta without an image and confirms it with medicine, pack, form,
active ingredient, strength and species taken from CIMAVet; the engine evaluates it like a scanned one.

**Independent Test**: quickstart scenarios 1 and 2 — access refused to `dev-empleado`/`dev-admin`/switch off; alta with
motivo + custodia → revisión without image; saving a line without a CIMAVet pick is refused; CIMAVet fields come back
overwritten; evaluation shows results per line.

### Tests for User Story 1

- [X] T010 [P] [US1] Create apps/api/test/receta-alta-manual.test.ts (MSW + fixtures): `it.each` for `POST /api/recetas/manual` validation (motivo < 15 chars, papel without custodia, electrónica without plataforma/identificador → `VALIDACION`), 403 `PROHIBIDO` for `dev-empleado` and `dev-admin`, 403 `ALTA_MANUAL_DESHABILITADA` with the switch off, and 403 when a `dev-empleado` calls `GET /api/recetas/:id` on a manual receta
- [X] T011 [US1] In apps/api/test/receta-alta-manual.test.ts: `PUT /api/recetas/:id/confirmacion` on a manual receta rejects a line without `cn` (`MEDICAMENTO_NO_SELECCIONADO`) and a species without `especieId` (`ESPECIE_NO_SELECCIONADA`), and overwrites typed `formaTexto`/`principioActivoTexto`/`concentracionTexto` with the CIMAVet values from the fixture

### Implementation for User Story 1

- [X] T012 [P] [US1] Add zod schema `PeticionAltaManual` (`tipo`, `motivo` min 15, `custodiaPapel`, `plataformaId`, `idPlataforma`, with a `superRefine` per tipo) to packages/shared/src/schemas/receta.ts and export it
- [X] T013 [US1] Add `crearManual(input, c)` to apps/api/src/servicios/recetas.ts: insert `receta` with `origen: 'manual'`, `estado: 'BORRADOR'`, `motivoAlta`, `custodiaPapel` (or plataforma fields), no images, no extraction; audit `receta_alta_manual` (no personal data in the payload)
- [X] T014 [US1] Add `POST /api/recetas/manual` in apps/api/src/rutas/recetas.ts with `preHandler: requiereRol(...ROLES.altaManual)`, the switch check and body `PeticionAltaManual`; return `201 { id }`
- [X] T015 [US1] In `confirmar` (apps/api/src/servicios/recetas.ts), for `origen === 'manual'`: require `cn` on every line that resolves via `this.med.presentacion` (live or cache) and `especie.especieId`; overwrite `nregistro`, `formaTexto`, `principioActivoTexto`, `concentracionTexto` from `this.med.resumen` (no `??` fallback to typed text); reject `registroDiferido`
- [X] T016 [US1] Return `origen`, `motivoAlta`, `custodiaPapel` from `obtener` in apps/api/src/servicios/recetas.ts (images list stays empty)
- [X] T017 [P] [US1] Create apps/web/src/paginas/alta-manual.tsx: short form (tipo papel/electrónica, motivo, «Dónde está guardada la receta en papel» or plataforma + identificador, hint «sin nombres ni teléfonos»), posts to `/api/recetas/manual` and navigates to `/recetas/$id/revision`; texts in Spanish, targets ≥ 44 px
- [X] T018 [US1] Register route `/recetas/manual/nueva` in apps/web/src/main.tsx and show an «Alta manual de receta» button in apps/web/src/paginas/inicio.tsx only when `altaManualHabilitada` and the user has `veterinaria_responsable`
- [X] T019 [US1] In apps/web/src/paginas/revision.tsx, when `origen === 'manual'`: replace `VisorReceta` with a notice «Receta dada de alta a mano, sin imagen» plus motivo and custodia; make forma, principio activo and concentración read-only; require choosing the medicine from the CIMAVet search before saving; hide the «dispensación ágil» checkbox

**Checkpoint**: A manual receta can be created, confirmed with CIMAVet data and evaluated

---

## Phase 4: User Story 2 - Registrar la dispensación ya hecha con su fecha original (Priority: P1)

**Goal**: Record what was actually handed over, evaluated at the original date, as a retrospective dispensing pending
TPV reconciliation, with no stock write.

**Independent Test**: quickstart scenarios 3–6 — non-antimicrobial on day +5 is conforme; antimicrobial on day +8 only
saves by forcing; future/pre-emission dates refused; duplicate in imported sales refused without forcing; the row shows
in Registros with the original date and in pending reconciliation; MSW records no stock write.

### Tests for User Story 2

- [X] T020 [P] [US2] Create apps/api/test/dispensacion-alta-manual.test.ts (MSW + fixtures, fixed `Clock`): `it.each` over original dates — emisión 2026-10-20 + non-antimicrobial on 2026-10-25 → conforme; antimicrobial on 2026-10-28 → `BLOQUEANTE_FORMA`, saved only with forzado; tomorrow and 2026-10-19 → `FECHA_ORIGINAL_INVALIDA`; a date across the 2026-10-25 DST change stays the same Madrid day
- [X] T021 [US2] In apps/api/test/dispensacion-alta-manual.test.ts: manual dispensing works with `RETROSPECTIVE_DISPENSATION_MODE=disabled`; `modo` is stored as `retrospectivo` even if the client sends `en_vivo`; `primeraDispensacionAt` equals the original date; a `BLOQUEANTE_DURO` (e.g. narcotic) is rejected; no Siweb360 stock-write request is made; the row appears as pending reconciliation
- [X] T022 [US2] In apps/api/test/dispensacion-alta-manual.test.ts: a receta whose número + colegiado exist in a non-voided `salida_importada` is rejected with `RECETA_YA_DISPENSADA` and cannot be forced

### Implementation for User Story 2

- [X] T023 [US2] In `dispensarConReceta` (apps/api/src/servicios/dispensaciones.ts), load the receta `origen`; for `manual`: apply the access check, force `modo = 'retrospectivo'`, require `fechaOriginal` (≤ today in Europe/Madrid, ≥ `fechaEmision`, else `FECHA_ORIGINAL_INVALIDA`) and skip the `RETROSPECTIVE_DISPENSATION_MODE` gate; keep `retrospectivoDe` (Siweb sale check) as is
- [X] T024 [US2] Before evaluating a manual receta in `dispensarConReceta`, pass the original date as the validity reference: add an optional `fechaReferencia` argument to `evaluar`/`evaluacionDocumental` in apps/api/src/servicios/recetas.ts used as `primeraDispensacion` when the receta has none yet
- [X] T025 [US2] When saving a manual dispensing in apps/api/src/servicios/dispensaciones.ts, set `receta.primeraDispensacionAt` to the original date (00:00 Europe/Madrid) instead of `ahora` when it is the first one; earliest date wins if a later entry has an earlier date
- [X] T026 [US2] Extend the `yaDispensada` check in `evaluacionDocumental` (apps/api/src/servicios/recetas.ts) to also match `salida_importada` (`numeroReceta`, `numColegiado`, importación not voided) for manual recetas
- [X] T027 [US2] Accept `fechaReferencia` in `POST /api/recetas/:id/evaluar` body (apps/api/src/rutas/recetas.ts) so the Resultado screen can show validity at the planned original date for a manual receta
- [X] T028 [US2] In apps/web/src/paginas/dispensacion.tsx, for a manual receta: retrospective mode on and locked, «Fecha en que se entregó» required, batch entered by hand allowed with the notice «Lote no encontrado en las recepciones registradas» when applicable
- [X] T029 [US2] In apps/web/src/paginas/resultado.tsx, for a manual receta ask the planned original date first and send it as `fechaReferencia` when evaluating — *done instead by storing the handover date (`confirmacion.fechaOriginal`) in the review screen (apps/web/src/paginas/revision.tsx); the API uses it for every evaluation of a manual receta, so resultado.tsx needs no change*

**Checkpoint**: US1 + US2 deliver the full value: manual recetas reach the sales register

---

## Phase 5: User Story 3 - Revisión y corrección de lo dado de alta a mano (Priority: P2)

**Goal**: Filter and see manual entries with author, reason and custody; corrections by voiding; weekly report
section; optional image attached later.

**Independent Test**: two manual + one scanned receta; filter «Alta manual» shows only the two with author, motivo and
custodia; voiding keeps original + counter-movement; weekly report lists them.

### Tests for User Story 3

- [X] T030 [P] [US3] Add to apps/api/test/receta-alta-manual.test.ts: `GET /api/registros/salidas?origen=manual` returns only manual rows with `altaManual: true`; voiding a manual dispensing via `POST /api/dispensaciones/:id/anular` keeps the original row and adds the counter-movement; `POST /api/recetas/:id/imagenes` stores a page without running extraction and keeps `origen = 'manual'`

### Implementation for User Story 3

- [X] T031 [US3] Add optional `origen` query filter and an `altaManual` boolean per row (join on `receta.origen`) to `GET /api/registros/salidas` in apps/api/src/rutas/registros.ts; keep owner data excluded by default
- [X] T032 [P] [US3] Add the «Alta manual» filter and row label in apps/web/src/paginas/registros.tsx, showing author, fecha de alta, motivo and custodia
- [X] T033 [P] [US3] Add an «Altas manuales» section (receta, autor, fecha de alta, motivo, nº de dispensaciones; no owner data) to the weekly report in apps/worker/src/jobs/reportes.ts
- [X] T034 [US3] Add `POST /api/recetas/:id/imagenes` (manual recetas only, `ROLES.altaManual`) in apps/api/src/rutas/recetas.ts and `adjuntarImagen` in apps/api/src/servicios/recetas.ts: Blob + `receta_imagen`, no extraction, audit `receta_imagen_adjunta`
- [X] T035 [US3] Add an «Adjuntar imagen de la receta» button for manual recetas in apps/web/src/paginas/revision.tsx that uploads to that endpoint and then shows the normal viewer

**Checkpoint**: All stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T036 [P] Add Playwright flow apps/web/e2e/alta-manual.spec.ts with `EXTRACTOR=fake` and `dev-veterinaria`: alta → revisión (CIMAVet pick) → resultado → dispensación with original date → row in Registros with «Alta manual» — *narrowed: the browser test covers access (employee sees no option) and alta → revisión without image; CIMAVet pick, result, dispensing at the original date and the register row are covered by the API tests in apps/api/test/dispensacion-alta-manual.test.ts*
- [X] T037 [P] Add a short «Alta manual de receta» entry to the in-app help (done in packages/shared/src/ayuda/secciones.ts, which feeds the Ayuda page and the assistant) explaining when to use it and that the paper must be kept
- [X] T038 Update SPEC.md §8 (screens) and §9.1 (veterinaria_responsable can register manual recetas when `MANUAL_PRESCRIPTION_ENTRY=enabled`) and keep AGENTS.md's variable list consistent
- [X] T039 Check logs/errors for the new paths contain no owner data (logger redaction), then run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm test:int`, and walk through quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: after Setup; blocks all stories
- **US1 (Phase 3)**: after Foundational
- **US2 (Phase 4)**: after US1 (needs a confirmed manual receta to dispense)
- **US3 (Phase 5)**: after Foundational; its registros/report tasks are most useful after US2
- **Polish (Phase 6)**: after the stories you ship

### Within Each Story

- Tests first (they must fail), then shared schema → service → route → UI
- T015 and T024/T026 all edit apps/api/src/servicios/recetas.ts: do them in order, not in parallel
- T023 and T025 both edit apps/api/src/servicios/dispensaciones.ts: sequential

### Parallel Opportunities

- Phase 1: T001, T002, T003 together
- US1: T010 (tests), T012 (shared schema) and T017 (new page) in parallel
- US2: T020 runs in parallel with the US2 implementation; T021 and T022 follow it in the same file
- US3: T032 and T033 in parallel after T031
- Polish: T036 and T037 in parallel

## Parallel Example: User Story 1

```text
Task: "T010 [US1] alta validation and access tests in apps/api/test/receta-alta-manual.test.ts"
Task: "T012 [US1] PeticionAltaManual schema in packages/shared/src/schemas/receta.ts"
Task: "T017 [US1] alta form page in apps/web/src/paginas/alta-manual.tsx"
```

## Implementation Strategy

### MVP

US1 + US2 together are the minimum useful delivery (the goal is getting these recetas into the sales register). US1
alone can be demoed but does not record the dispensing.

### Incremental Delivery

1. Setup + Foundational → switch off by default, nothing visible
2. US1 → create and confirm manual recetas (demo)
3. US2 → dispensing at the original date → enable `MANUAL_PRESCRIPTION_ENTRY` in the environment
4. US3 → filters, weekly report, attach image later
5. Polish → e2e, help, SPEC/AGENTS updates

---

## Phase 7: Convergence

- [X] T040 CRITICAL: In `prepararManual` (apps/api/src/servicios/dispensaciones.ts), also read `receta.confirmacion` and refuse with `VALIDACION` unless `comprobadoConOriginal === true`, because `POST /api/recetas/:id/evaluar` moves a draft to `EVALUADA` and lets it skip the strict CIMAVet check (species, medicine, handover date); add a test in apps/api/test/dispensacion-alta-manual.test.ts: unconfirmed draft → evaluate → dispense is refused per FR-008, FR-005 (contradicts)
- [X] T041 Make the psychotropics book use the handover date: in the psychotropics query of packages/reports/src/datos.ts (~L323-331) filter with the shared `fechaRegistro` expression instead of `dispensacion.fechaVenta` and map `fecha: s.fechaOriginal ?? s.fechaVenta`, so it matches the sales register; add a test with a past-dated psychotropic sale per FR-016, SC-003, Constitution (Regulatory compliance and traceability) (partial)
- [X] T042 Make automatic TPV ticket matching search the handover day: in apps/api/src/servicios/conciliacion.ts (~L71) use `s.fechaOriginal ?? dia(s.fechaVenta)` for the day to search, and add a test where a manual sale matches a demo ticket dated on the original day per FR-016, US2/AC4 (partial)
- [X] T043 Decide with the vet whether past-dated training sales (spec 004, `modo = 'retrospectivo'` on non-manual recetas) should also move to their original date in the sales register; either restrict `fechaRegistro` in packages/reports/src/datos.ts to `receta.origen = 'manual'`, or keep it and add a test with a non-manual retrospective sale per plan: research R2/R8 (unrequested) — *kept for all past-dated sales (consistent with T041/T042) and pinned by a test in apps/api/test/dispensacion-retrospectiva.test.ts; confirmed by the user on 2026-11-10: every past-dated sale counts on its original date*
- [X] T044 Hide the recommended-batch box for manual recetas in apps/web/src/paginas/dispensacion.tsx (`data-testid="lote-recomendado"`, ~L397), so the stand-in `(entregado)` stock row is never shown as a batch to follow per US2/AC1, plan: research R5 (partial)
- [X] T045 Simplify the attach-image route in apps/api/src/rutas/recetas.ts to `preHandler: requiereRol(...ROLES.altaManual)` (drop `...pre.slice(1)`; `adjuntarImagen` already enforces the manual-entry rule) per FR-024, Constitution IV (unrequested)

---

## Phase 8: Convergence

- [X] T046 In `datosManuales` (apps/api/src/servicios/recetas.ts), when confirming, reject an `especie.especieId` that is not in CIMAVet's species list (check with `this.med.nombresEspecies([id])`) with `ESPECIE_NO_SELECCIONADA`; add a test in apps/api/test/receta-alta-manual.test.ts with an unknown id (e.g. 99999) per FR-008 (partial)
- [X] T047 Add an internal column `CONCILIACIÓN TPV` to `COLUMNAS_INTERNAS` and the `internas()` row in packages/reports/src/salidas.ts, filled from `Salida.conciliacion` (already set in packages/reports/src/datos.ts), so each register row shows its till-ticket reconciliation status; update the column assertions in packages/reports/test/exportaciones.test.ts and apps/api/test/flujos.test.ts, and assert `pendiente`/`conciliada` for a manual sale in apps/api/test/dispensacion-alta-manual.test.ts per US2/AC4 (partial)
- [X] T048 Add internal columns `FECHA ALTA MANUAL`, `MOTIVO ALTA MANUAL` and `CUSTODIA DEL PAPEL` (no personal data; empty for non-manual rows) in packages/reports/src/salidas.ts, filled from `receta.createdAt`, `receta.motivoAlta` and `receta.custodiaPapel` in packages/reports/src/datos.ts, so filtering the register by manual entries shows author, date of entry, reason and where the paper is; extend the register test in apps/api/test/dispensacion-alta-manual.test.ts per US3/AC1, T032 (partial)
- [X] T049 When a manual dispensing records a batch that appears in no recorded receipt line for that código nacional (`recepcion_linea` with the same `cn` and `lote`), add a non-blocking notice «Lote no encontrado en las recepciones registradas» (AVISO incidence code plus Spanish text in packages/shared/src/i18n/defectos.es.json) to the dispensing result and show it on apps/web/src/paginas/dispensacion.tsx; add a test in apps/api/test/dispensacion-alta-manual.test.ts per spec Edge Cases («Lote que no consta en ninguna recepción»), T028 (missing)

---

## Phase 9: Convergence

- [X] T050 In `pendientes()` (apps/api/src/servicios/conciliacion.ts, ~L109), return the handover date as `fecha` (`fechaOriginal` when set, else the Madrid day of `fechaVenta`) while still selecting and ordering by `fechaVenta`, so a manual sale waiting for its till ticket shows the day it was handed over; add an assertion in apps/api/test/dispensacion-alta-manual.test.ts per US2/AC4, FR-016, decision T043 (partial)
- [X] T051 In the weekly report sheets «4b Dispensaciones forzadas» and «4c Producto no valido forzado» (packages/reports/src/semanal.ts, ~L165), show `fechaEs(d.fechaOriginal ?? d.fechaVenta)` in the FECHA column, keeping rows selected by the week they were recorded; extend apps/worker/test/jobs.test.ts or add a reports test with a forced past-dated sale per FR-022, decision T043 (partial)
