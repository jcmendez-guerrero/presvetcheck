# Tasks: Multi-Prescription Ticket & Retrospective Dispensation

**Input**: Design documents from `/specs/004-multi-rx-ticket-training-mode/`
**Prerequisites**: [plan.md](file:///Users/ac86016/Git/personal/presvetcheck/specs/004-multi-rx-ticket-training-mode/plan.md), [spec.md](file:///Users/ac86016/Git/personal/presvetcheck/specs/004-multi-rx-ticket-training-mode/spec.md), [research.md](file:///Users/ac86016/Git/personal/presvetcheck/specs/004-multi-rx-ticket-training-mode/research.md), [data-model.md](file:///Users/ac86016/Git/personal/presvetcheck/specs/004-multi-rx-ticket-training-mode/data-model.md), [contracts/api-contracts.yaml](file:///Users/ac86016/Git/personal/presvetcheck/specs/004-multi-rx-ticket-training-mode/contracts/api-contracts.yaml)

---

## Phase 1: Setup (Shared Configuration & Infrastructure)

**Purpose**: Configuration flags, domain error codes, and shared constants.

- [X] T001 [P] Add `RETROSPECTIVE_DISPENSATION_MODE` and `RETROSPECTIVE_MAX_AGE_DAYS` environment variables with Zod validation in `packages/shared/src/config.ts`
- [X] T002 [P] Document `RETROSPECTIVE_DISPENSATION_MODE` and `RETROSPECTIVE_MAX_AGE_DAYS` with defaults in `.env.example`
- [X] T003 [P] Add domain error codes (`TICKET_YA_FINALIZADO`, `TICKET_CANTIDAD_INSUFICIENTE`, `MODO_RETROSPECTIVO_DESHABILITADO`, `RECETA_YA_VINCULADA`) in `packages/shared/src/codes.ts`
- [X] T004 [P] Add Spanish localization messages for the new error codes in `packages/shared/src/i18n/es.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core database tables, migration, and Siweb client parameters required before any user story can run.

**⚠️ CRITICAL**: Must complete before user story implementation begins.

- [X] T005 [P] Define `ticketReceta` junction table in `packages/db/src/schema/infra.ts` with `recetaId` UNIQUE constraint per data-model.md
- [X] T006 [P] Define `evidenciaStockRetrospectiva` table in `packages/db/src/schema/infra.ts`
- [X] T007 Extend `dispensacion` table with `modo` and `fechaOriginal` in `packages/db/src/schema/recetas.ts`
- [X] T008 Export new schemas and types from `packages/db/src/schema/index.ts`
- [X] T009 Create PostgreSQL migration `packages/db/migrations/0017_multi_rx_retrospectivo.sql`
- [X] T010 [P] Define Zod schemas for multi-rx ticket linking and retrospective requests in `packages/shared/src/schemas/conciliacion.ts`
- [X] T011 [P] Extend `SiwebClient.movements()` with `date_from` and `date_to` parameters in `packages/siweb/src/client.ts`

**Checkpoint**: Foundation ready — database schema, shared schemas, and Siweb client are prepared.

---

## Phase 3: User Story 1 - Multi-Prescription Single Ticket (Priority: P1) 🎯 MVP

**Goal**: Allow linking one Siweb360 sales ticket to multiple prescriptions and prevent invalid/duplicate associations.

**Independent Test**: Link ticket `TKT-2026-000042` to prescription `Rx-A`, then link the same ticket to prescription `Rx-B`. Verify both rows exist in `ticket_receta`, duplicate linking is rejected, and unlinking is allowed only while unconfirmed.

### Tests for User Story 1
- [X] T012 [P] [US1] Unit tests for ticket-receta association rules and constraints in `packages/domain/test/ticket-receta.test.ts`
- [X] T013 [P] [US1] Integration tests for `POST /api/conciliacion/tickets/vincular` and `desvincular` in `apps/api/test/vincular-ticket.test.ts`

### Implementation for User Story 1
- [X] T014 [US1] Implement pure validation function `validarVinculacionTicket` in `packages/domain/src/conciliacion.ts`
- [X] T015 [US1] Implement `vincularTicketReceta` and `desvincularTicketReceta` methods in `apps/api/src/servicios/conciliacion.ts`
- [X] T016 [US1] Register endpoints `POST /api/conciliacion/tickets/vincular` and `POST /api/conciliacion/tickets/desvincular` in `apps/api/src/rutas/registros.ts`
- [X] T017 [US1] Update `apps/web/src/componentes/tras-dispensar.tsx` to support entering or selecting an existing ticket to associate with the current prescription

**Checkpoint**: User Story 1 functional — an operator can associate multiple prescriptions to a single ticket.

---

## Phase 4: User Story 2 - Retrospective Dispensation for Training (Priority: P1)

**Goal**: Enable staff training on past transactions by validating stock against Siweb360 stock movements on the historical date instead of current stock, accepting paid tickets.

**Independent Test**: Enable retrospective mode, enter date `2026-10-30`, dispense a product with matching `sale_shipment` movement in Siweb360 fixtures, and confirm with historical ticket `TKT-2026-000035`. Verify `dispensacion.modo = 'retrospectivo'` and evidence is persisted.

### Tests for User Story 2
- [X] T018 [P] [US2] Unit tests for retrospective stock movement evaluation in `packages/domain/test/stock-retrospectivo.test.ts`
- [X] T019 [P] [US2] Integration test for retrospective dispensation flow in `apps/api/test/dispensacion-retrospectiva.test.ts`

### Implementation for User Story 2
- [X] T020 [US2] Implement pure function `evaluarMovimientosRetrospectivos` in `packages/domain/src/conciliacion.ts`
- [X] T021 [US2] Implement `consultarMovimientosRetrospectivos` method in `apps/api/src/servicios/dispensaciones.ts`
- [X] T022 [US2] Extend `DispensacionesService.dispensarConReceta` and `dispensarSinReceta` in `apps/api/src/servicios/dispensaciones.ts` to accept `modo` and `fechaOriginal` and persist `evidencia_stock_retrospectiva`
- [X] T023 [US2] Register endpoint `POST /api/inventario/movimientos/retrospectivo` in `apps/api/src/rutas/operativa.ts`
- [X] T024 [US2] Add retrospective mode toggle and historical date input in `apps/web/src/paginas/revision.tsx` and `apps/web/src/paginas/dispensacion.tsx`

**Checkpoint**: User Story 2 functional — staff can train using historical transactions and stock movements.

---

## Phase 5: User Story 3 - Ticket Reconciliation Across Multiple Prescriptions (Priority: P2)

**Goal**: Consolidate dispensation quantities across all prescriptions linked to a ticket, compare against ticket line items, enforce hard blocks on over-dispensing, and present a unified reconciliation report.

**Independent Test**: Link ticket with 4 units of CN-570016 to two prescriptions (Rx-1 with 2 units, Rx-2 with 2 units) → confirmation passes. Alter Rx-2 to 3 units (total 5 > 4) → confirmation raises `TICKET_CANTIDAD_INSUFICIENTE`.

### Tests for User Story 3
- [X] T025 [P] [US3] Unit tests for multi-prescription ticket reconciliation algorithm in `packages/domain/test/conciliacion-multi-rx.test.ts`
- [X] T026 [P] [US3] Integration test for `GET /api/conciliacion/tickets/:ticketId` and `POST /api/conciliacion/tickets/:ticketId/confirmar` in `apps/api/test/confirmar-ticket-multi-rx.test.ts`

### Implementation for User Story 3
- [X] T027 [US3] Implement pure multi-prescription reconciliation function `conciliarTicketMultiReceta` in `packages/domain/src/conciliacion.ts`
- [X] T028 [US3] Implement `obtenerDetalleTicketMultiReceta` and `confirmarTicketMultiReceta` in `apps/api/src/servicios/conciliacion.ts`
- [X] T029 [US3] Register endpoints `GET /api/conciliacion/tickets/:ticketId` and `POST /api/conciliacion/tickets/:ticketId/confirmar` in `apps/api/src/rutas/registros.ts`
- [X] T030 [US3] Create `TicketMultiRxModal` component in `apps/web/src/componentes/ticket-multi-rx.tsx` displaying consolidated lines, quantities, and discrepancies
- [X] T031 [US3] Integrate `TicketMultiRxModal` into `apps/web/src/componentes/tras-dispensar.tsx` and `apps/web/src/paginas/pendientes.tsx`

**Checkpoint**: User Story 3 functional — full multi-prescription ticket reconciliation and confirmation flow active.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, open decision tracking, and complete regression validation.

- [X] T032 [P] Update glossary entries in `docs/glosario.md` for `ticket_receta` and `modo_retrospectivo`
- [X] T033 [P] Close decisions **D-11** (1:N multi-prescription ticket) and **D-14** (historical training mode) with implementation references in `SPEC.md` §13
- [X] T034 Execute end-to-end scenarios described in `specs/004-multi-rx-ticket-training-mode/quickstart.md`
- [X] T035 Run full test and lint suite (`pnpm lint && pnpm typecheck && pnpm test`) to verify all gates remain green

---

## Dependencies & Execution Order

### Phase Dependencies
1. **Phase 1 (Setup)**: No dependencies — can start immediately.
2. **Phase 2 (Foundational)**: Depends on Phase 1 — blocks all user stories.
3. **Phase 3 (User Story 1 - P1)**: Depends on Phase 2 — unlocks core ticket linking (MVP).
4. **Phase 4 (User Story 2 - P1)**: Depends on Phase 2 — can run in parallel with US1 or immediately after.
5. **Phase 5 (User Story 3 - P2)**: Depends on Phase 3 (US1) and Phase 2 — builds upon ticket association to deliver full multi-prescription reconciliation.
6. **Phase 6 (Polish)**: Depends on completion of all user stories.

### Parallel Opportunities

- **Setup Tasks**: T001, T002, T003, T004 can all be completed in parallel.
- **Foundational Tasks**: T005, T006, T010, T011 can run in parallel; T007 & T008 follow, then T009.
- **Within User Story 1**: T012 and T013 (tests) can run in parallel before T014–T017.
- **Within User Story 2**: T018 and T019 (tests) can run in parallel before T020–T024.
- **Within User Story 3**: T025 and T026 (tests) can run in parallel before T027–T031.
- **User Story 1 and User Story 2** can be developed in parallel by separate developers once Phase 2 (Foundational) is complete.

---

## Implementation Strategy (MVP First)

1. **Foundational Readiness**: Complete Phase 1 & Phase 2 (DB schema migration + Siweb client extensions).
2. **MVP Delivery (User Story 1)**: Complete Phase 3. Operators can immediately associate one ticket to multiple prescriptions.
3. **Training Capability (User Story 2)**: Complete Phase 4. Enables staff training sessions with historical transactions without stock-blocking errors.
4. **Consolidated Reconciliation (User Story 3)**: Complete Phase 5. Delivers whole-ticket multi-prescription reconciliation with over-dispensing hard block enforcement.
5. **Final Hardening**: Complete Phase 6. Verify documentation and full test suite.
