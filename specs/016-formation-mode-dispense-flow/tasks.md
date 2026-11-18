---

description: "Task list for 016 formation mode dispense flow"
---

# Tasks: Formation mode lets the operator continue to dispensing instead of offering "add to order"

**Input**: Design documents from `/specs/016-formation-mode-dispense-flow/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/evaluar-formacion.md, quickstart.md

**Tests**: included (constitution II requires tests; MSW + fixtures only, never real Siweb360).

**Organization**: grouped by user story. Paths are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, US3 (from spec.md)

## Phase 1: Setup

- [ ] T001 Read `apps/api/src/servicios/dispensaciones.ts` (`retrospectivoDe`, `revisarRetrospectivo`, ≈L138-160 and L920-985), `apps/api/src/servicios/recetas.ts` (`evaluar`, ≈L847-960) and `apps/api/test/dispensacion-retrospectiva.test.ts`; note the existing MSW handlers and fixtures for Siweb360 `movements` to reuse in new tests (no code change)

---

## Phase 2: Foundational (blocking)

**Purpose**: share the movement check between evaluation and dispensing without changing dispensing behaviour.

- [ ] T002 Create `apps/api/src/servicios/retrospectivo.ts` with a `RetrospectivoService` class (constructor takes the same deps object `d` as the other services) exposing `revisar(body: ConsultaStockRetrospectivoBody)`; move the body of `DispensacionesService.revisarRetrospectivo` there unchanged (variant lookup in `siwebVariantMap`, `siweb.client.movements({reason:'sale_shipment'})`, `SIWEB_NO_DISPONIBLE` on error, `evaluarMovimientosRetrospectivos`)
- [ ] T003 Make `DispensacionesService` in `apps/api/src/servicios/dispensaciones.ts` delegate `revisarRetrospectivo` and `consultarMovimientosRetrospectivos` to `RetrospectivoService` (no behaviour change)
- [ ] T004 Run `pnpm --filter @mmx/api test -- dispensacion-retrospectiva` and confirm the existing suite still passes (regression gate for T002-T003)

**Checkpoint**: shared service in place; dispensing unchanged.

---

## Phase 3: User Story 1 - Continue to dispensing in formation mode with zero current stock (P1) 🎯 MVP

**Goal**: a prescription saved in formation mode with a past date is judged against that date's sales, so the line offers "Dispensar" instead of "Añadir a lista de pedido".

**Independent Test**: prescription with product at zero current stock, `confirmacion.modo='retrospectivo'`, a `sale_shipment` on the original date → line decision `DISPENSAR`, no `pedido`.

### Tests for User Story 1

- [ ] T005 [P] [US1] Create `apps/api/test/evaluar-formacion.test.ts` (MSW + fixtures) with cases: sale found ≥ units → `DISPENSAR` without `pedido`; no sale → `NO_CONFORME` with `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` and `forzable`; partial sale → same incidence; date older than `RETROSPECTIVE_MAX_AGE_DAYS` → `AVISO_FECHA_RETROSPECTIVA_ANTIGUA`; Siweb 5xx and timeout → `SIWEB_NO_DISPONIBLE`; mode disabled → `MODO_RETROSPECTIVO_DESHABILITADO`; missing `fechaOriginal` → `VALIDACION`; forced override with justification is audited; `BLOQUEANTE_DURO` (e.g. expired prescription) still not forceable in formation
- [ ] T006 [P] [US1] Add a UI test in `apps/web/src/paginas/resultado.test.tsx` (new file next to `inicio.test.tsx`): an evaluation of a formation line renders the "Dispensar" button and does not render "Añadir a lista de pedido"

### Implementation for User Story 1

- [ ] T007 [US1] In `apps/api/src/servicios/recetas.ts` instantiate `RetrospectivoService` in the `RecetasService` constructor/deps and, in `evaluar`, detect formation: `conf.modo === 'retrospectivo' && !manual`; when `RETROSPECTIVE_DISPENSATION_MODE !== 'enabled'` throw `DomainError('MODO_RETROSPECTIVO_DESHABILITADO')`; when `conf.fechaOriginal` is empty throw `DomainError('VALIDACION', 'Indica la fecha original en modo retrospectivo')`
- [ ] T008 [US1] In `RecetasService.evaluar` (`apps/api/src/servicios/recetas.ts`), for formation lines call `retrospectivo.revisar({cn: presentacion.cn, fechaOriginal, unidadesRequeridas: l.cantidadEnvases ?? 1})`, add its `incidencias` to the line's `incs`, and use the same synthetic stock as the manual branch (lote «(entregado)», `disponible = cantidadEnvases ?? 1`) instead of `leerStock`; do not read candidate/equivalent stock (research R3). Keep `forzado` validation order unchanged so `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` can be forced with a reason but hard blocks cannot
- [ ] T009 [US1] Ensure the chequeo result is returned in the line's `resultado.evidencias` (estado, cn, fechaOriginal, encontradas/requeridas) per `specs/016-formation-mode-dispense-flow/data-model.md`; extend the zod/response types in `packages/shared/src/schemas/receta.ts` only if the field is not already typed
- [ ] T010 [US1] In `apps/web/src/paginas/resultado.tsx` show an info banner on formation lines («Modo formación: se ha comprobado la venta del <fecha>») using the saved `fechaOriginal` (fetch via the existing `['receta', id]` query) and never render the "Añadir a lista de pedido" block when the prescription is a formation case; UI text in clear European Spanish
- [ ] T011 [US1] Confirm `irADispensar` in `apps/web/src/paginas/resultado.tsx` and the `useEffect` in `apps/web/src/paginas/dispensacion.tsx` (≈L232-240) already carry modo and fecha to the dispensing screen without re-entry (FR-004); fix only if they do not
- [ ] T012 [US1] Run T005/T006 tests until green

**Checkpoint**: US1 independently demonstrable (MVP).

---

## Phase 4: User Story 2 - Dispensing linked to the ticket already issued, no order created (P1)

**Goal**: formation dispensing ends linked to the existing ticket (also "Pagado"), with no order entry, new sale or stock deduction.

**Independent Test**: complete a formation dispensing for the US1 case; verify ticket link, `modo=retrospectivo` + `fecha_original`, empty pedidos, no outbound stock write.

- [ ] T013 [P] [US2] Extend `apps/api/test/dispensacion-retrospectiva.test.ts` (or add `apps/api/test/formacion-ticket.test.ts`) with an end-to-end API case: evaluate → dispense → link ticket in "Pagado" state; assert dispensación has `modo='retrospectivo'`/`fecha_original`, the `pedidos` table is unchanged, and the outbox has no stock-outbound entry
- [ ] T014 [US2] If T013 reveals a gap, fix it in `apps/api/src/servicios/dispensaciones.ts` / ticket-link code (spec 004 behaviour must hold); otherwise record "verified, no change" in the PR description
- [ ] T015 [P] [US2] Add one Playwright step to the existing prescription → dispensing smoke test (`EXTRACTOR=fake`) covering formation mode on a zero-stock product: result screen shows "Dispensar", flow reaches ticket link; place it with the existing e2e specs

**Checkpoint**: US1 + US2 deliver the full reported scenario.

---

## Phase 5: User Story 3 - Live prescriptions keep today's behaviour (P2)

**Goal**: no regression for live and manual-entry prescriptions.

**Independent Test**: live prescription with zero stock still yields `PEDIR` + "Añadir a lista de pedido"; manual-entry prescription unchanged.

- [ ] T016 [P] [US3] In `apps/api/test/evaluar-formacion.test.ts` add regression cases: live prescription without stock → `PEDIR` with `pedido`; `origen='manual'` receta → unchanged result and no movements query; formation mode disabled + live receta → unchanged
- [ ] T017 [P] [US3] In `apps/web/src/paginas/resultado.test.tsx` add a case: live `PEDIR` line still shows "Añadir a lista de pedido"
- [ ] T018 [US3] Run `pnpm --filter @mmx/api test` and `pnpm --filter @mmx/web test`; fix any regression introduced by T007-T010

---

## Phase 6: Polish & cross-cutting

- [ ] T019 [P] Add one line to the help text in `packages/shared/src/ayuda/secciones.ts` explaining that in formation mode the result screen checks the sale of the original date instead of today's stock (Spanish, no jargon)
- [ ] T020 [P] Check `docs/glosario.md` already defines "modo formación"/"retrospectivo"; add the entry only if missing
- [ ] T021 Confirm no new env variable was needed (`.env.example` unchanged) and no personal data appears in logs/errors from the new code (only `cn`, date, counts)
- [ ] T022 Run `pnpm lint && pnpm typecheck && pnpm test` (add `pnpm test:int` if integration tests cover dispensing) and walk through `specs/016-formation-mode-dispense-flow/quickstart.md`
- [ ] T023 Commit with Conventional Commits (`fix: honour formation mode when evaluating prescriptions`)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T002 → T003 → T004) → user stories.
- US1 (T005-T012) first; T005 and T006 are parallel and written before T007-T010; T007 → T008 → T009 (same file/flow), T010-T011 follow once the API returns the new shape.
- US2 depends on US1 (needs the evaluation to reach "Dispensar"); T013 and T015 are parallel.
- US3 tests (T016, T017) can be written in parallel with US1 but only run green after T008; T018 closes it.
- Polish after all stories.

## Parallel Example

```text
After Phase 2:  T005 (API tests)  ||  T006 (UI test)
After US1:      T013 (ticket e2e API)  ||  T015 (Playwright)  ||  T016 + T017 (regressions)
Polish:         T019  ||  T020
```

## Implementation Strategy

- **MVP**: Phase 1-3 (US1) — fixes the reported defect: "Dispensar" appears in formation mode.
- **Increment 2**: US2 verifies ticket association and no order/stock side effects.
- **Increment 3**: US3 locks in no regression; then Polish and the full gate.
- One PR, one block; if `decidirLinea` turns out to need a domain flag (plan, open point), add it in `packages/domain/src/decision.ts` with `it.each` tables as an extra task before T008.
