# Feature Specification: Always update the supplier cost in Siweb360 when goods are received

**Feature Branch**: `016-always-update-supplier-cost`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "when receiving goods, the supplier cost of the variant in Siweb360 must always be updated, regardless of whether the cost-update check is ticked; that is, the supplier cost of a variant always has to be updated whether or not the update check is marked"

## Context

When staff register a goods receipt (albarán), each medicine line carries an "update price" tick box. Today that
tick decides whether the line's purchase cost is sent to Siweb360 as the variant's cost. If staff leave it
unticked (or forget it), Siweb360 keeps an outdated supplier cost even though the receipt shows the real, current
price paid. Siweb360 is the system that holds the cost used for margins and pricing, so a stale cost there leads to
wrong margins.

**Decision requested**: receiving goods must **always** refresh the supplier cost of the variant in Siweb360 when
the line has a purchase cost and a Siweb360 variant. The tick box no longer gates that update.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Supplier cost is refreshed on every receipt (Priority: P1)

A member of staff finalises a goods receipt in which a line has a purchase cost but the "update price" tick is
**off**. After finalising, Siweb360 shows the new supplier cost for that variant, exactly as if the tick had been on.

**Why this priority**: it is the whole request; without it Siweb360 costs silently go stale.

**Independent Test**: finalise a receipt with one costed line whose tick is off and another with it on; confirm
both variants end up with the line's cost in Siweb360 (using the Siweb360 test double, never the real service).

**Acceptance Scenarios**:

1. **Given** a receipt line with a purchase cost and a Siweb360 variant, **When** the receipt is finalised with the
   price tick **off**, **Then** the cost update for that variant is queued and sent to Siweb360.
2. **Given** the same line with the tick **on**, **When** the receipt is finalised, **Then** the result is
   identical to the previous scenario (one cost update, same value).
3. **Given** a receipt line with no purchase cost, **When** the receipt is finalised, **Then** no cost update is
   sent and the existing Siweb360 cost is left untouched (never overwritten with zero or empty).

---

### User Story 2 - Cost is also refreshed when the product is registered later (Priority: P2)

A receipt line refers to a medicine not yet registered in Siweb360, so it waits for registration. Once the
registration completes and the line is linked to its variant, the supplier cost is updated in Siweb360 even if the
tick was off, in the same way as for lines that were already linked.

**Why this priority**: same rule on the deferred path; skipping it would leave a loophole.

**Independent Test**: finalise a receipt with an unregistered, costed line (tick off), complete the registration,
and confirm one cost update is queued for the new variant.

**Acceptance Scenarios**:

1. **Given** a costed line waiting for registration with the tick off, **When** the registration completes,
   **Then** the supplier cost is queued for the new variant.
2. **Given** the same line, **When** the registration completes more than once or the job is repeated, **Then**
   the cost is still sent only once for that receipt line.

---

### User Story 3 - Staff understand what the tick still does (Priority: P3)

The "update price" tick stays visible but staff are told clearly what it controls now, so nobody believes that
leaving it off prevents the Siweb360 cost update.

**Why this priority**: avoids confusion; the behaviour change is useless if the screen still promises otherwise.

**Independent Test**: open the receipt line form and read the tick label and its help text; confirm they state
that the Siweb360 supplier cost is always updated and describe only the remaining effect of the tick.

**Acceptance Scenarios**:

1. **Given** the receipt line form, **When** staff read the help for the tick, **Then** it says (in plain European
   Spanish) that the supplier cost in Siweb360 is always updated and explains what the tick still changes.

---

### Edge Cases

- **Siweb360 writing is switched off** (`SIWEB_STOCK_WRITE_MODE=off`): nothing is sent to Siweb360, as today; the
  receipt is marked as "writing disabled". This feature does not bypass that switch.
- **Line without stock update** ("update stock" tick off): the cost update is still sent; stock and cost are
  independent decisions.
- **Receipt finalised without prices** (the existing "without prices" finalisation option): no cost updates are
  sent, because the user explicitly chose not to provide prices.
- **Cost update fails or times out**: handled by the existing delivery rules (no automatic retry after an
  uncertain outcome, manual reconciliation); the receipt itself and its stock entries are not rolled back.
- **Same line processed twice** (retry, re-queue): the cost is applied once per receipt line.
- **Existing receipts finalised before this change**: not touched retroactively.
- **Cost lower or higher than the current one**: always applied; the latest receipt wins, no confirmation asked.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On finalising a goods receipt, the system MUST queue a supplier-cost update in Siweb360 for every
  medicine line that has a purchase cost and is linked to a Siweb360 variant, **regardless of the "update price"
  tick**.
- **FR-002**: The cost sent MUST be the same value the system sends today when the tick is on (the line's cost
  price, or its net purchase price when no cost price exists).
- **FR-003**: Lines without any purchase cost MUST NOT produce a cost update and MUST NOT clear or alter the
  existing Siweb360 cost.
- **FR-004**: Lines that are not yet linked to a Siweb360 variant MUST get their cost update queued as soon as
  they are linked, regardless of the tick.
- **FR-005**: A given receipt line MUST result in at most one cost update, even if finalisation or the deferred
  linking is repeated.
- **FR-006**: The existing safeguards MUST be preserved: no writes when Siweb360 writing is off, no writes when the
  write test is not valid, no writes for receipts finalised "without prices", and no outbound (sales) stock
  movements ever.
- **FR-007**: The cost update MUST be independent of the "update stock" decision of the line.
- **FR-008**: The "update price" tick MUST remain available and keep its other effect (the reference cost kept in
  the app and used in reports, unchanged from today), and its label/help text MUST state that the Siweb360
  supplier cost is always updated.
- **FR-009**: The outcome of each cost update (sent, failed, needs reconciliation) MUST remain visible and
  auditable exactly as for existing cost updates; no personal data is added to logs or telemetry.
- **FR-010**: Behaviour for receipts already finalised before this change MUST NOT change.

### Key Entities

- **Receipt line**: one medicine on a goods receipt, with its purchase cost, link to a Siweb360 variant, and the
  "update stock" / "update price" decisions.
- **Supplier cost update**: the queued operation that sets the variant's cost in Siweb360; one per receipt line.
- **Siweb360 variant**: the product variant whose supplier cost is refreshed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100 % of finalised receipts, every costed line linked to a variant produces exactly one supplier
  cost update, whatever the state of the price tick.
- **SC-002**: After finalising a receipt, the supplier cost shown in Siweb360 for each costed variant matches the
  receipt's cost with no manual action by staff.
- **SC-003**: Zero cost updates are produced for lines without a cost, for "without prices" receipts, and while
  Siweb360 writing is off.
- **SC-004**: Staff reading the line form can state correctly, without help, that the Siweb360 supplier cost is
  updated even with the tick off (checked in review of the help text).
- **SC-005**: No regressions in existing receipt, stock-entry and reconciliation behaviour (existing automated
  tests keep passing).

## Assumptions

- "Supplier cost of the variant in Siweb360" means the variant cost field Siweb360 already exposes for update
  (the same one the current cost update uses); no new Siweb360 capability is needed.
- The tick keeps governing only the app's own reference cost (used in the weekly cost report); removing or
  renaming the tick is out of scope.
- "Without prices" finalisation and the write-mode / write-test safeguards are intentional and stay as they are.
- Existing rules about what value is sent (cost price, else net purchase price) are unchanged.
- No decision in SPEC §13 is affected; no new configuration variable is needed.
- Siweb360 and its responses are never called for real in tests; fixtures and mocks are used.
