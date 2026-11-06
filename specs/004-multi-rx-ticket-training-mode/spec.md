# Feature Specification: Multi-Prescription Ticket & Retrospective Dispensation

**Feature Branch**: `004-multi-rx-ticket-training-mode`

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "A ticket must be capable of being associated to multiple prescriptions because a single ticket can supply multiple prescriptions. Add a capability to do prescriptions from the past (training mode): the app is used with already-dispensed items, checking stock movements rather than current stock, and the user confirms the ticket that was dispensed."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Multi-Prescription Single Ticket (Priority: P1)

A pharmacy operator dispenses products from two or more prescriptions for the same pet owner. The owner pays everything in a single POS transaction, producing one Siweb360 ticket. The operator links that ticket to all the prescriptions involved. The system confirms the ticket reconciles against the combined dispensation lines.

**Why this priority**: Without this, the operator must either split purchases into separate tickets (which the POS may not support cleanly) or leave prescriptions unlinked, breaking the regulatory traceability chain required for every dispensation.

**Independent Test**: Can be fully tested by dispensing two prescriptions, entering a single ticket number, and verifying that both prescriptions are linked and the reconciliation report shows combined quantities matching the ticket items.

**Acceptance Scenarios**:

1. **Given** two valid prescriptions (Rx-A with 2 units of CN-570016, Rx-B with 1 unit of CN-590948), both dispensed, **When** the operator enters ticket TKT-2026-000042 that contains 2×CN-570016 and 1×CN-590948, **Then** both prescriptions are linked to the ticket and the reconciliation shows zero discrepancy for each line.
2. **Given** Rx-A is dispensed and already linked to ticket TKT-001, **When** the operator dispenses Rx-B and enters the same ticket TKT-001, **Then** Rx-B is added as a second linked prescription and reconciliation recalculates with both prescriptions' dispensation lines.
3. **Given** Rx-A (3 units CN-570016) and Rx-B (2 units CN-570016) are both linked to ticket TKT-001 that contains 5×CN-570016, **When** reconciliation runs, **Then** the total dispensed (3+2=5) matches the ticket quantity (5) and confirmation succeeds.
4. **Given** a ticket is linked to Rx-A and fully reconciled and finalized, **When** the operator attempts to add Rx-C to the same ticket, **Then** the system returns `TICKET_YA_FINALIZADO` and prevents the link.
5. **Given** Rx-A is already linked to ticket TKT-001, **When** the operator attempts to link Rx-A to TKT-001 again, **Then** the system detects the duplicate and does not create a second link.

---

### User Story 2 - Retrospective Dispensation for Training (Priority: P1)

A trainee uses the app with a prescription for a product that was already dispensed and sold days or weeks ago. Instead of checking current stock (which would fail because the product has already left the warehouse), the system checks the Siweb360 stock movement history for the relevant date to verify the product was indeed sold. The trainee then confirms the original POS ticket.

**Why this priority**: The pharmacy is actively training staff. Without this mode, trainees cannot practise the complete dispensation flow with real historical transactions, severely limiting training effectiveness.

**Independent Test**: Can be fully tested by entering retrospective mode, providing a past date, dispensing a product, and verifying the system queries movement history rather than current stock — and that the resulting dispensation record is flagged as retrospective.

**Acceptance Scenarios**:

1. **Given** retrospective mode is enabled (`RETROSPECTIVE_DISPENSATION_MODE=enabled`) and the operator selects retrospective mode with date 2026-10-30, **When** the operator dispenses CN-570016 (2 units), **Then** the system queries Siweb360 movement history for `sale_shipment` movements of CN-570016 on 2026-10-30 and finds 2 outbound units, and the stock check passes.
2. **Given** retrospective mode with date 2026-10-30, **When** the system queries movements for CN-590948 and finds no `sale_shipment` on that date, **Then** the system displays a warning (soft block) allowing the operator to override with a justification, and the override is recorded in the audit trail.
3. **Given** retrospective mode is active and the dispensation is confirmed, **When** the operator enters ticket number TKT-2026-000035 (a ticket in "Pagado" state from 2026-10-30), **Then** the system accepts the ticket despite its "Pagado" state and links it to the prescription with status `confirmado`.
4. **Given** `RETROSPECTIVE_DISPENSATION_MODE=disabled`, **When** an operator attempts to activate retrospective mode via the UI, **Then** the option is not visible. If attempted via API, the system returns `MODO_RETROSPECTIVO_DESHABILITADO`.
5. **Given** retrospective mode with a date 100 days in the past and `RETROSPECTIVE_MAX_AGE_DAYS=90`, **When** the operator proceeds, **Then** the system warns that the date exceeds the recommended range but allows proceeding.

---

### User Story 3 - Ticket Reconciliation Across Multiple Prescriptions (Priority: P2)

When a ticket is linked to more than one prescription, the confirmation and reconciliation flow must verify that the combined dispensed quantities across all linked prescriptions are consistent with the ticket's line items. The ticket detail view shows all linked prescriptions and their dispensation lines grouped by prescription.

**Why this priority**: Reconciliation accuracy is critical for regulatory compliance and the daily sales-reconciliation job. However, this builds on Story 1 and can be tested once multi-prescription linking works.

**Independent Test**: Can be tested by linking multiple prescriptions to a ticket and verifying the reconciliation report correctly sums quantities and identifies mismatches.

**Acceptance Scenarios**:

1. **Given** ticket TKT-001 linked to Rx-A (2×CN-570016) and Rx-B (1×CN-570016), and the ticket shows 3×CN-570016, **When** reconciliation runs, **Then** the report shows: ticket quantity = 3, dispensed total = 3, difference = 0.
2. **Given** ticket TKT-001 linked to Rx-A (2×CN-570016) and Rx-B (3×CN-570016), and the ticket shows 4×CN-570016, **When** reconciliation runs, **Then** the system raises a hard block because dispensed total (5) exceeds ticket quantity (4).
3. **Given** ticket TKT-001 with 5 line items linked to 2 prescriptions covering 3 of those items, **When** the ticket detail is viewed, **Then** all 5 ticket items are shown, 3 are matched to dispensation lines (grouped by prescription), and 2 are flagged as unmatched (informational, not errors).
4. **Given** ticket TKT-001 is linked to Rx-A and reconciled, **When** Rx-B is later linked and reconciliation re-runs, **Then** only Rx-B's dispensation lines are checked against the remaining unmatched ticket quantities — Rx-A's confirmed matches are not re-checked.

---

### Edge Cases

- **Ticket quantity less than dispensed across prescriptions**: The sum of dispensed units for a product across all linked prescriptions exceeds the ticket line item quantity. This is a hard block — the operator must correct a dispensation (counter-movement) before the ticket can be confirmed.
- **Prescription split across tickets**: A prescription's products are paid across two separate tickets. Only one ticket can be linked to the prescription (enforced by unique constraint). The operator notes the discrepancy manually.
- **Retrospective date with no movement data**: The Siweb360 API returns no movements for the queried date (e.g., data archived beyond 90 days). The operator is warned and may override (soft block).
- **CN not found in ticket item name**: The ticket item name does not contain a recognisable CN (per `SIWEB_TICKET_CN_REGEX`). The item is treated as unmatched and flagged for manual review.
- **Concurrent linking**: Two operators attempt to link different prescriptions to the same ticket simultaneously. The second link must succeed without corrupting the first (handled by the junction table's append-only nature).
- **Retrospective dispensation for a product not in the local catalogue**: The CN→variant_id mapping is missing. The stock movement lookup fails. The operator is warned and may skip the stock check with a justification.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a many-to-many relationship between tickets and prescriptions via a junction entity, replacing the current 1:1 foreign key.
- **FR-002**: System MUST reconcile ticket line item quantities against the sum of dispensation quantities across all linked prescriptions when confirming a ticket.
- **FR-003**: System MUST allow adding a prescription to a ticket that is not yet finalized, running incremental reconciliation against remaining unmatched quantities.
- **FR-004**: System MUST display all linked prescriptions and their dispensation lines when viewing a ticket's details.
- **FR-005**: System MUST prevent unlinking a prescription from a finalized ticket (`TICKET_YA_FINALIZADO`) and prevent duplicate links.
- **FR-006**: System MUST provide an operator-selectable "retrospective mode" that requires the operator to enter the original dispensation date before starting the flow.
- **FR-007**: In retrospective mode, system MUST validate stock availability by querying Siweb360 stock movement history (`GET /api/public/inventory/movements`, filtered by `variant_id`, `warehouse_id`, `reason=sale_shipment`, and date range) instead of current stock levels.
- **FR-008**: In retrospective mode, system MUST allow the operator to look up and confirm the original Siweb360 ticket, accepting tickets in "Pagado" state.
- **FR-009**: System MUST record retrospective dispensations with `modo=retrospectivo` and `fecha_original` in the dispensation record, distinguishing them from live dispensations (`modo=en_vivo`).
- **FR-010**: Retrospective mode MUST be controlled by `RETROSPECTIVE_DISPENSATION_MODE` (values: `enabled` | `disabled`, default: `disabled`). When disabled, the UI hides the option and the API rejects retrospective requests with `MODO_RETROSPECTIVO_DESHABILITADO`.
- **FR-011**: System MUST warn (soft block, not `BLOQUEANTE_DURO`) when no matching stock movement is found in retrospective mode, allowing the operator to override with a recorded justification.
- **FR-012**: System MUST warn when the retrospective date exceeds `RETROSPECTIVE_MAX_AGE_DAYS` (default: `90` days) but allow proceeding.

### Key Entities

- **ticket_receta** (junction): Links `ticket_siweb_id` and `receta_id`. Also stores `fecha_vinculacion` and `usuario_id`. Unique constraint on `receta_id` (each prescription links to at most one ticket).
- **dispensacion** (extended): New fields `modo` (enum `en_vivo` | `retrospectivo`) and `fecha_original` (date, nullable — populated only for retrospective). Existing fields unchanged; the entity remains append-only.
- **evidencia_stock_retrospectiva**: Evidence record capturing the Siweb360 movement query results (variant_id, date range, movements found, match result) used to validate a retrospective dispensation. Linked to the dispensation record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operators can link 2 prescriptions to a single ticket and confirm reconciliation in under 5 minutes for a typical transaction.
- **SC-002**: 100% of dispensations (live and retrospective) maintain full traceability — every dispensation record is linked to a confirmed ticket.
- **SC-003**: Training sessions using retrospective mode achieve at least 90% dispensation completion rate without false "insufficient stock" errors.
- **SC-004**: The ticket reconciliation report accurately reflects combined quantities across all linked prescriptions, with zero false-positive mismatch errors.
- **SC-005**: No audit trail gaps or data inconsistencies when an operator switches between live and retrospective modes within the same session.

## Assumptions

- A prescription is linked to at most one ticket. If a prescription's products are split across multiple tickets, only the "primary" ticket is linked and the operator notes the discrepancy.
- The Siweb360 stock movement history is reliable and complete for the past 90 days via the API. Movements older than 90 days may be archived and unavailable.
- The `sale_shipment` reason in Siweb360 movements corresponds to POS ticket sales. Other outbound reasons (damage, theft, expiry) are not evidence of a past dispensation.
- Retrospective mode is a temporary training capability. Once the team is trained, the configuration will be set to `disabled`.
- Ticket line items in Siweb360 can be matched to dispensation lines by product CN, extracted from the item name using the `SIWEB_TICKET_CN_REGEX` pattern (consistent with existing conciliation logic).
- The Siweb360 API rate limit (1,000 req/h) is sufficient for training-period movement history lookups.
- This spec resolves open decisions **D-11** (multi-prescription ticket, previously defaulting to 1:1) and **D-14** (historical/training mode, previously unimplemented).
