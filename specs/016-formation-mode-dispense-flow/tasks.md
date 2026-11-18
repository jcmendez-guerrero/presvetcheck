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

- [X] T001 Read `apps/api/src/servicios/dispensaciones.ts` (`retrospectivoDe`, `revisarRetrospectivo`, ≈L138-160 and L920-985), `apps/api/src/servicios/recetas.ts` (`evaluar`, ≈L847-960) and `apps/api/test/dispensacion-retrospectiva.test.ts`; note the existing MSW handlers and fixtures for Siweb360 `movements` to reuse in new tests (no code change). If no fixture exists, do NOT invent a payload: leave an `it.todo` naming the missing file under `fixtures/` (AGENTS.md)

---

## Phase 2: Foundational (blocking)

**Purpose**: share the movement check between evaluation and dispensing without changing dispensing behaviour.

- [X] T002 Create `apps/api/src/servicios/retrospectivo.ts` with a `RetrospectivoService` class (constructor takes the same deps object `d` as the other services) exposing `revisar(body: ConsultaStockRetrospectivoBody)`; move the body of `DispensacionesService.revisarRetrospectivo` there unchanged (variant lookup in `siwebVariantMap`, `siweb.client.movements({reason:'sale_shipment'})`, `SIWEB_NO_DISPONIBLE` on error, `evaluarMovimientosRetrospectivos`)
- [X] T003 Make `DispensacionesService` in `apps/api/src/servicios/dispensaciones.ts` delegate `revisarRetrospectivo` and `consultarMovimientosRetrospectivos` to `RetrospectivoService` (no behaviour change)
- [X] T004 Run `pnpm --filter @mmx/api test -- dispensacion-retrospectiva` and confirm the existing suite still passes (regression gate for T002-T003)

**Checkpoint**: shared service in place; dispensing unchanged.

---

## Phase 3: User Story 1 - Continue to dispensing in formation mode with zero current stock (P1) 🎯 MVP

**Goal**: a prescription saved in formation mode with a past date is judged against that date's sales, so the line offers "Dispensar" instead of "Añadir a lista de pedido".

**Independent Test**: prescription with product at zero current stock, `confirmacion.modo='retrospectivo'`, a `sale_shipment` on the original date → line decision `DISPENSAR`, no `pedido`.

### Tests for User Story 1

- [X] T005 [P] [US1] Create `apps/api/test/evaluar-formacion.test.ts` (MSW + fixtures) with cases: sale found ≥ units → `DISPENSAR` without `pedido`; no sale → `NO_CONFORME` with `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` and `forzable`; partial sale → same incidence; date older than `RETROSPECTIVE_MAX_AGE_DAYS` → `AVISO_FECHA_RETROSPECTIVA_ANTIGUA`; Siweb 5xx and timeout → `SIWEB_NO_DISPONIBLE` (line not judged, not forceable); future `fechaOriginal` → `FECHA_ORIGINAL_INVALIDA`; mode disabled → `MODO_RETROSPECTIVO_DESHABILITADO`; missing `fechaOriginal` → `VALIDACION`; forced override with justification is audited (evaluation `evidencias` keep the movement check; override reaches the audit record when dispensing); `BLOQUEANTE_DURO` (e.g. expired prescription) still not forceable in formation
- [X] T006 [P] [US1] Extend the existing `apps/web/src/paginas/resultado.test.tsx` with a test: an evaluation of a formation line renders the "Dispensar" button and does not render "Añadir a lista de pedido"

### Implementation for User Story 1

- [X] T007 [US1] In `apps/api/src/servicios/recetas.ts` instantiate `RetrospectivoService` in the `RecetasService` constructor/deps and, in `evaluar`, detect formation: `conf.modo === 'retrospectivo' && !manual`; when `RETROSPECTIVE_DISPENSATION_MODE !== 'enabled'` throw `DomainError('MODO_RETROSPECTIVO_DESHABILITADO')`; when `conf.fechaOriginal` is empty throw `DomainError('VALIDACION', 'Indica la fecha original en modo retrospectivo')`; also reject a `fechaOriginal` later than today (`hoyDe(this.d)`, `Europe/Madrid`, injected clock) with the existing `FECHA_ORIGINAL_INVALIDA`
- [X] T008 [US1] In `RecetasService.evaluar` (`apps/api/src/servicios/recetas.ts`), for formation lines call `retrospectivo.revisar({cn: presentacion.cn, fechaOriginal, unidadesRequeridas: l.cantidadEnvases ?? 1})`, add its `incidencias` to the line's `incs`, and use the same synthetic stock as the manual branch (lote «(entregado)», `disponible = cantidadEnvases ?? 1`) instead of `leerStock`; do not read candidate/equivalent stock (research R3). Keep `forzado` validation order unchanged so `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` can be forced with a reason but hard blocks cannot
- [X] T009 [US1] Verify the chequeo result is returned in the line's `resultado.evidencias` (estado, cn, fechaOriginal, encontradas/requeridas) per `specs/016-formation-mode-dispense-flow/data-model.md` and persisted by `persistirEvaluacion`; if the field is not typed, extend the zod schema in `packages/shared/src/schemas/receta.ts` (types inferred, not duplicated)
- [X] T010 [US1] In `apps/web/src/paginas/resultado.tsx` show an info banner on formation lines («Modo formación: se ha comprobado la venta del <fecha>») using the saved `fechaOriginal` (fetch via the existing `['receta', id]` query; extend its local response type with `confirmacion.modo`/`fechaOriginal`) and never render the "Añadir a lista de pedido" block when the prescription is a formation case; UI text in clear European Spanish
- [X] T011 [US1] Confirm `irADispensar` in `apps/web/src/paginas/resultado.tsx` and the `useEffect` in `apps/web/src/paginas/dispensacion.tsx` (≈L232-240) already carry modo and fecha to the dispensing screen without re-entry (FR-004); fix only if they do not
- [X] T012 [US1] Run T005/T006 tests until green

**Checkpoint**: US1 independently demonstrable (MVP).

---

## Phase 4: User Story 2 - Dispensing linked to the ticket already issued, no order created (P1)

**Goal**: formation dispensing ends linked to the existing ticket (also "Pagado"), with no order entry, new sale or stock deduction.

**Independent Test**: complete a formation dispensing for the US1 case; verify ticket link, `modo=retrospectivo` + `fecha_original`, empty pedidos, no outbound stock write.

- [X] T013 [P] [US2] Extend `apps/api/test/dispensacion-retrospectiva.test.ts` (or add `apps/api/test/formacion-ticket.test.ts`) with an end-to-end API case: evaluate → dispense → link ticket in "Pagado" state; assert dispensación has `modo='retrospectivo'`/`fecha_original`, the `pedidos` table is unchanged, no new sale is created, the outbox has no stock-outbound entry, and a forced `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` appears in `audit_event`
- [X] T014 [US2] If T013 reveals a gap, fix it in `apps/api/src/servicios/dispensaciones.ts` / ticket-link code (spec 004 behaviour must hold); otherwise note "verified, no change" in the commit message
- [X] T014b [US2] Verify that after linking, the operator can check the ticket (FR-010): `GET /api/conciliacion/tickets/:ticketId` (`apps/api/src/rutas/registros.ts`, `obtenerDetalleTicketMultiReceta`) returns lines, linked prescriptions and reconciliation state for a "Pagado" ticket, and `apps/web/src/componentes/ticket-multi-rx.tsx` / `tras-dispensar.tsx` show it after a formation dispensing; add a test in `apps/api/test/dispensacion-retrospectiva.test.ts` and a component test next to the component; fix gaps if any
- [ ] T015 (OPEN: the e2e server has no Siweb360, so a formation line can only end in «Dispensar igualmente»; needs a Siweb360 stub in `playwright.config.ts` webServer to prove the fix end to end) [P] [US2] Add one Playwright step to the existing prescription → dispensing smoke test (`EXTRACTOR=fake`) covering formation mode on a zero-stock product: result screen shows "Dispensar", flow reaches ticket link and opens the ticket detail; place it with the existing e2e specs

**Checkpoint**: US1 + US2 deliver the full reported scenario.

---

## Phase 5: User Story 3 - Live prescriptions keep today's behaviour (P2)

**Goal**: no regression for live and manual-entry prescriptions.

**Independent Test**: live prescription with zero stock still yields `PEDIR` + "Añadir a lista de pedido"; manual-entry prescription unchanged.

- [X] T016 [P] [US3] In `apps/api/test/evaluar-formacion.test.ts` add regression cases: live prescription without stock → `PEDIR` with `pedido`; `origen='manual'` receta → unchanged result and no movements query; formation mode disabled + live receta → unchanged
- [X] T017 [P] [US3] In the existing `apps/web/src/paginas/resultado.test.tsx` add a case: live `PEDIR` line still shows "Añadir a lista de pedido"
- [X] T018 [US3] Run `pnpm --filter @mmx/api test` and `pnpm --filter @mmx/web test`; fix any regression introduced by T007-T010

---

## Phase 6: Polish & cross-cutting

- [X] T019 [P] Add one line to the help text in `packages/shared/src/ayuda/secciones.ts` explaining that in formation mode the result screen checks the sale of the original date instead of today's stock (Spanish, no jargon)
- [X] T020 [P] Check `docs/glosario.md` already defines "modo formación"/"retrospectivo"; add the entry only if missing
- [X] T021 Confirm no new env variable was needed (`.env.example` unchanged) and no personal data appears in logs/errors from the new code (only `cn`, date, counts)
- [X] T022 Run `pnpm lint && pnpm typecheck && pnpm test` (add `pnpm test:int` if integration tests cover dispensing) and walk through `specs/016-formation-mode-dispense-flow/quickstart.md`
- [X] T023 Commit with Conventional Commits (`fix: honour formation mode when evaluating prescriptions`)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T002 → T003 → T004) → user stories.
- US1 (T005-T012) first; T005 and T006 are parallel and written before T007-T010; T007 → T008 → T009 (same file/flow), T010-T011 follow once the API returns the new shape.
- US2 depends on US1 (needs the evaluation to reach "Dispensar"); T013, T014b and T015 are parallel.
- US3 tests (T016, T017) can be written in parallel with US1 but only run green after T008; T018 closes it.
- Polish after all stories.

## Parallel Example

```text
After Phase 2:  T005 (API tests)  ||  T006 (UI test)
After US1:      T013 (ticket e2e API)  ||  T014b  ||  T015 (Playwright)  ||  T016 + T017 (regressions)
Polish:         T019  ||  T020
```

## Implementation Strategy

- **MVP**: Phase 1-3 (US1) — fixes the reported defect: "Dispensar" appears in formation mode.
- **Increment 2**: US2 verifies ticket association and no order/stock side effects.
- **Increment 3**: US3 locks in no regression; then Polish and the full gate.
- One PR, one block; if `decidirLinea` turns out to need a domain flag (plan, open point), add it in `packages/domain/src/decision.ts` with `it.each` tables as an extra task before T008.

## Phase 7: Convergence

- [ ] T024 (BLOCKED: setting `SIWEB_TOKEN` switches the whole API to the real Siweb360 client (stock, catalog index, tickets), so a stub needs many endpoints and would change the existing smoke flow; do it as a separate Playwright project) Complete T015: add a Siweb360 stub (variant mapping + `sale_shipment` movement) to the e2e web servers in `apps/web/playwright.config.ts`, enable `RETROSPECTIVE_DISPENSATION_MODE`, and add the formation step to `apps/web/e2e/humo.spec.ts` ending with the ticket detail open per SC-001/SC-002 (partial)
- [X] T025 Add an API test with a multi-line prescription in formation mode where only some lines have a sale on the original date, asserting each line is judged on its own per Edge Cases (missing)
- [X] T026 Add a test that switching formation mode off (saved `modo='en_vivo'`) judges the line against current stock again per Edge Cases / FR-008 (missing)
- [X] T027 Record the original-date check result (estado, encontradas/requeridas) in the `audit_event` of the formation dispensing, not only in `evidencia_stock_retrospectiva`, per FR-009 (partial)
- [ ] T028 (PARTIAL: quickstart steps 1 and 4 verified by the suites; step 2-3 manual UI walk and `pnpm test:int` not run, no container runtime) Walk through `specs/016-formation-mode-dispense-flow/quickstart.md` and run `pnpm test:int` where a container runtime exists; record the result per T022 (partial)
- [X] T029 Mark T023 once the Conventional Commit for the fix is confirmed in history (`f8c0252`) (partial)
