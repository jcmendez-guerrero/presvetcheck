# Feature Specification: Always update the supplier cost in Siweb360 when goods are received

**Feature Branch**: `016-always-update-supplier-cost`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "when receiving goods, the supplier cost of the variant in Siweb360 must always be updated, regardless of whether the cost-update check is ticked; that is, the supplier cost of a variant always has to be updated whether or not the update check is marked"

## Clarifications

### Session 2026-11-18

- Q: Is "supplier cost" the single variant cost or a per-supplier cost? → A: A per-supplier cost. Siweb360 (API 1.3.0) links suppliers to the **product** (shared by all its variants) with a purchase cost per supplier, readable with the product's supplier list and updatable per supplier contact. It is distinct from the variant's general cost.
- Q: How does the app find the Siweb360 supplier contact for a receipt's distributor? → A: Both: the distributor keeps the Siweb360 contact once known, and when it is not known yet the app looks the supplier up by tax ID (CIF) in Siweb360 and remembers the result.
- Q: Does the variant's general cost keep being updated by the "update price" tick? → A: Yes, unchanged: the tick still controls the variant's general cost (as today). The per-supplier cost is updated in addition and always.

## Context

When staff register a goods receipt (albarán), each medicine line has an "update price" tick. Today that tick decides
whether the line's cost is sent to Siweb360 as the **variant's general cost**. The **cost of the supplier for that
product** — which Siweb360 keeps per supplier, shared by all variants of the product — is never updated by the app,
so it goes stale even though the receipt shows the real price paid to that supplier.

**Decision requested**: receiving goods must **always** refresh, in Siweb360, the purchase cost of the receipt's
supplier for the product of each costed line, whatever the state of the "update price" tick.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Supplier cost is refreshed on every receipt (Priority: P1)

A member of staff finalises a goods receipt in which a line has a purchase cost but the "update price" tick is
**off**. After finalising, Siweb360 shows the receipt's cost as that supplier's purchase cost for the product, exactly
as if the tick had been on.

**Why this priority**: it is the whole request; without it supplier costs silently go stale.

**Independent Test**: finalise a receipt with one costed line whose tick is off and another with it on, from a
distributor already known in Siweb360; confirm both products end up with the line's cost for that supplier (using
the Siweb360 test double, never the real service).

**Acceptance Scenarios**:

1. **Given** a costed line linked to a Siweb360 variant and a distributor whose Siweb360 supplier is known, **When**
   the receipt is finalised with the tick **off**, **Then** the supplier-cost update for that product and supplier
   is queued and sent.
2. **Given** the same line with the tick **on**, **When** the receipt is finalised, **Then** the supplier-cost update
   is identical, and the variant's general cost is also updated as today.
3. **Given** the tick **off**, **When** the receipt is finalised, **Then** the variant's general cost is **not**
   updated (unchanged behaviour); only the supplier cost is.
4. **Given** a line with no purchase cost, **When** the receipt is finalised, **Then** no update is sent and the
   existing supplier cost in Siweb360 is left untouched (never cleared or set to zero).
5. **Given** two variants of the same product on one receipt, **When** it is finalised, **Then** the supplier cost
   of that product is updated once per receipt line without conflicting results (last line wins, in line order).

---

### User Story 2 - The supplier is found automatically and remembered (Priority: P1)

The first time a distributor is used for a supplier-cost update, the app finds the matching supplier contact in
Siweb360 by the distributor's tax ID and remembers it, so later receipts need no lookup.

**Why this priority**: without knowing which Siweb360 supplier to update, story 1 cannot work.

**Independent Test**: finalise a receipt for a distributor with no remembered Siweb360 supplier; confirm one lookup
by tax ID, the cost update, and that a second receipt uses the remembered supplier with no lookup.

**Acceptance Scenarios**:

1. **Given** a distributor with no remembered supplier and a tax ID matching exactly one Siweb360 supplier, **When**
   a costed line is processed, **Then** that supplier is used and remembered on the distributor.
2. **Given** a distributor with a remembered supplier, **When** a costed line is processed, **Then** no lookup is made.
3. **Given** the tax ID matches no supplier, or more than one, or the distributor has no tax ID, **When** a costed
   line is processed, **Then** the supplier cost is **not** guessed or created: the update is left pending, the
   receipt and its stock entries finish normally, and staff can see which distributor needs its Siweb360 supplier
   linked.
4. **Given** a pending update because the supplier could not be resolved, **When** the supplier is later linked
   (or the lookup then succeeds), **Then** the pending cost update is sent once, with the receipt's own cost.

---

### User Story 3 - Cost is also refreshed when the product is registered later (Priority: P2)

A receipt line refers to a medicine not yet registered in Siweb360, so it waits for registration. Once the
registration completes and the line is linked to its variant and product, the supplier cost is updated even if the
tick was off.

**Why this priority**: same rule on the deferred path; skipping it would leave a loophole.

**Independent Test**: finalise a receipt with an unregistered, costed line (tick off), complete the registration,
and confirm one supplier-cost update is queued for the new product.

**Acceptance Scenarios**:

1. **Given** a costed line waiting for registration with the tick off, **When** the registration completes, **Then**
   the supplier cost is queued for the product.
2. **Given** the same line, **When** the registration completes more than once or the job is repeated, **Then** the
   cost is still sent only once for that receipt line.

---

### User Story 4 - Staff understand what the tick still does (Priority: P3)

The "update price" tick stays but staff are told clearly what it controls now, so nobody believes that leaving it
off prevents the supplier-cost update.

**Why this priority**: avoids confusion; the screen must not promise otherwise.

**Independent Test**: open the receipt line form and read the tick label and help; confirm they state that the
supplier's cost in Siweb360 is always updated, and describe only what the tick still changes.

**Acceptance Scenarios**:

1. **Given** the receipt line form, **When** staff read the help for the tick, **Then** it says, in plain European
   Spanish, that the supplier cost in Siweb360 is always updated and that the tick only decides whether the
   variant's general cost (and the app's reference cost) is updated.

---

### Edge Cases

- **Siweb360 writing is switched off** (`SIWEB_STOCK_WRITE_MODE=off`): nothing is sent, as today; this feature does
  not bypass that switch.
- **Write test not valid**: nothing is sent, as today.
- **Line with "update stock" off**: the supplier cost is still updated; stock and cost are independent.
- **Receipt finalised "without prices"**: no supplier-cost updates, because the user chose not to provide prices.
- **Supplier not yet linked to the product in Siweb360**: the update links it (Siweb360 does this on update); the
  app does not mark it as preferred or change its reference.
- **Supplier cost update fails or times out**: existing delivery rules apply (no automatic retry after an uncertain
  outcome, manual reconciliation); the receipt and its stock entries are not rolled back.
- **Same line processed twice** (retry, re-queue): the cost is applied once per receipt line.
- **Receipts finalised before this change**: not touched retroactively.
- **New cost lower or higher than the current one**: always applied; the latest receipt wins, no confirmation asked.
- **Remembered supplier no longer exists in Siweb360**: treated like an unresolved supplier (update left pending and
  visible), never silently dropped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On finalising a goods receipt, the system MUST queue a supplier-cost update in Siweb360 for every
  medicine line that has a purchase cost and is linked to a Siweb360 product, **regardless of the "update price"
  tick**, targeting the receipt's supplier for that product.
- **FR-002**: The "update price" tick MUST keep controlling, exactly as today, the update of the variant's general
  cost in Siweb360 and the app's reference cost; the supplier-cost update MUST NOT depend on it.
- **FR-003**: The supplier cost sent MUST be the same value currently used for the variant cost update (the line's
  cost price, or its net purchase price when no cost price exists). Only the cost is changed: the supplier's
  reference and "preferred" status MUST NOT be altered by the app.
- **FR-004**: Lines without any purchase cost MUST NOT produce an update and MUST NOT clear or alter the existing
  supplier cost.
- **FR-005**: The system MUST identify the Siweb360 supplier of a receipt from the distributor: use the supplier
  remembered on the distributor if any; otherwise look it up by the distributor's tax ID and, when exactly one
  supplier matches, remember it on the distributor.
- **FR-006**: If the supplier cannot be identified (no tax ID, no match, several matches, or a remembered supplier
  that no longer exists), the system MUST NOT guess or create a supplier; it MUST leave the update pending, finish
  the receipt and its stock entries normally, and make the pending update and its cause visible to staff.
- **FR-007**: A pending update MUST be sent once, with the receipt's own cost, as soon as the supplier can be
  identified, without staff re-entering the receipt.
- **FR-008**: Lines not yet linked to a Siweb360 product MUST get their supplier-cost update queued when they are
  linked, regardless of the tick.
- **FR-009**: A given receipt line MUST result in at most one supplier-cost update, even if finalisation, the
  deferred linking or the supplier resolution is repeated.
- **FR-010**: Existing safeguards MUST be preserved: no writes when Siweb360 writing is off or the write test is not
  valid, none for receipts finalised "without prices", and no outbound stock movements ever.
- **FR-011**: The supplier-cost update MUST be independent of the line's "update stock" decision.
- **FR-012**: The outcome of each update (sent, failed, needs reconciliation, pending supplier) MUST be visible and
  auditable like existing Siweb360 operations, with no personal data added to logs or telemetry.
- **FR-013**: The tick's label and help text MUST state that the supplier cost in Siweb360 is always updated and
  describe what the tick still controls (in plain European Spanish, no jargon).
- **FR-014**: Behaviour for receipts finalised before this change MUST NOT change.

### Key Entities

- **Receipt line**: one medicine on a receipt, with its purchase cost, link to a Siweb360 variant/product, and the
  "update stock" / "update price" decisions.
- **Distributor**: the supplier company of a receipt, with its tax ID and, once known, the remembered Siweb360
  supplier contact.
- **Supplier-cost update**: the queued operation that sets a supplier's purchase cost for a product in Siweb360; at
  most one per receipt line; can be pending while the supplier is unresolved.
- **Siweb360 product / variant**: the supplier is linked to the product (shared by its variants); the variant keeps
  its own general cost.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100 % of finalised receipts, every costed line linked to a product whose supplier is identified
  produces exactly one supplier-cost update, whatever the state of the price tick.
- **SC-002**: After finalising such a receipt, the cost Siweb360 holds for that supplier and product matches the
  receipt's cost with no manual action by staff.
- **SC-003**: For a distributor seen for the first time, the supplier is identified and remembered automatically in
  the same receipt flow in at least 95 % of cases where the tax ID matches a single Siweb360 supplier; later receipts
  need no lookup.
- **SC-004**: 100 % of updates that cannot proceed because the supplier is unidentified are visible to staff with
  the distributor named, and none are lost or guessed.
- **SC-005**: Zero updates are produced for lines without a cost, for "without prices" receipts, and while Siweb360
  writing is off.
- **SC-006**: Staff reading the line form can state correctly that the supplier cost is updated even with the tick
  off (checked in review of the help text).
- **SC-007**: No regressions in existing receipt, stock-entry, variant-cost and reconciliation behaviour (existing
  automated tests keep passing).

## Assumptions

- The Siweb360 contract used is `docs/ref/siweb360-openapi.json` v1.3.0: supplier cost is set per product and
  supplier contact; Siweb360 links the supplier to the product if not yet linked.
- Looking up a supplier by tax ID uses the contact search Siweb360 already offers; a match is a contact of type
  supplier with the same normalised tax ID.
- The value sent as supplier cost is the same as for the variant cost today; whether the supplier cost should be the
  net purchase price instead is not decided here and can be revisited in planning without changing this scope.
- The tick is neither removed nor renamed; it keeps governing the variant's general cost and the app's reference
  cost used in the weekly cost report.
- "Without prices" finalisation and the write-mode / write-test safeguards are intentional and stay as they are.
- No decision in SPEC §13 is affected; no new configuration variable is needed.
- Siweb360 is never called for real in tests; fixtures and mocks are used (a fixture for the supplier list and the
  supplier update is needed from `docs/ref`).
- Storing the remembered supplier on the distributor is a data change handled in planning; it contains no personal
  data (a Siweb360 contact identifier of a company).
