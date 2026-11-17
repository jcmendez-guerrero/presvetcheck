# Feature Specification: Formation mode lets the operator continue to dispensing instead of offering "add to order"

**Feature Branch**: `016-formation-mode-dispense-flow`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "When using the formation mode after initial checking the prescription and going to the dispense the system is asking for add that to order instead of letting continue with the data and associate with the actual already done ticket"

## Context

Spec 004 introduced the **formation mode** ("Modo formación (retrospectivo)"): staff practise with a prescription
whose products were **already sold** at the till (POS) on a past date, and the dispensing is validated against the
stock movements of that date and linked to the ticket that was already issued.

**Observed defect**: the operator ticks formation mode and the original date on the prescription review screen
(they are saved with the prescription). The next step, the result screen (the "initial check"), still judges every
line against the **current** stock. Because the product already left the shelf, the line is judged "out of stock"
and the screen offers **"Añadir a lista de pedido"** (reorder the product) with no "Dispensar" button. The
operator therefore never reaches the dispensing screen where the already-issued ticket can be linked, and the
exercise cannot continue. (Confirmed in code during planning: the evaluation ignores the saved formation mode.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Continue to dispensing in formation mode even when current stock is zero (Priority: P1)

A trainee reviews a prescription for a product that was sold days ago and is now out of stock. They indicate that
this is a formation (past) case. The review screen no longer treats the missing current stock as the reason to
order the product; it lets them continue to dispensing with the prescription data already captured.

**Why this priority**: this is the reported defect; today the formation flow cannot be started for exactly the
products it was designed for.

**Independent Test**: take a prescription whose product has zero current stock, mark it as a formation case with a
past date, and confirm the review screen offers "Dispensar" (not only "Añadir a lista de pedido").

**Acceptance Scenarios**:

1. **Given** a prescription line whose product has no current stock, saved as a formation case with its original
   date, **When** the operator opens the result screen, **Then** the line is judged against
   the stock movements of that date and the screen offers **Dispensar**.
2. **Given** the same case, **When** the operator continues, **Then** the dispensing screen opens with formation
   mode and the original date already selected, so they do not have to enter them again.
3. **Given** the stock movements of that date show the product was indeed sold, **When** the line is judged,
   **Then** no "add to order" suggestion is made for it.
4. **Given** the stock movements of that date show **no** sale of the product, **When** the line is judged,
   **Then** the operator is warned, and may continue only by overriding with a recorded justification (same rule
   as spec 004, FR-011).

---

### User Story 2 - Associate the dispensing with the ticket already issued (Priority: P1)

Once in the dispensing screen in formation mode, the operator completes the dispensing and links it to the ticket
that the till already issued, without being asked to create or add anything to an order.

**Why this priority**: it is the second half of the reported problem: the dispensing must end up tied to the
existing ticket for traceability.

**Independent Test**: complete a formation dispensing and confirm it is linked to the existing ticket and that no
order, reorder list entry or new sale is created.

**Acceptance Scenarios**:

1. **Given** a formation dispensing is confirmed, **When** the operator enters the number of the ticket already
   issued (including one already in "Pagado" state), **Then** the dispensing is linked to that ticket.
2. **Given** a formation dispensing, **When** it is completed, **Then** no entry is added to the order list and no
   stock is deducted again (the till ticket already did).
3. **Given** a formation dispensing is flagged as formation with its original date, **When** it is viewed later,
   **Then** it is distinguishable from live dispensings.

---

### User Story 3 - Normal (live) prescriptions keep today's behaviour (Priority: P2)

Operators who do not use formation mode still see "Añadir a lista de pedido" when a product is genuinely out of
stock, and cannot dispense stock that does not exist.

**Why this priority**: regression protection for the daily live flow.

**Independent Test**: review a live prescription with a product out of stock and confirm the order suggestion is
unchanged.

**Acceptance Scenarios**:

1. **Given** a live prescription whose product has no current stock, **When** it is reviewed, **Then** the screen
   offers "Añadir a lista de pedido" exactly as before.
2. **Given** formation mode is disabled for the pharmacy, **When** a prescription is reviewed, **Then** the
   formation option is not shown and the behaviour is unchanged.

---

### Edge Cases

- A prescription with several lines where only some products are out of stock: each line is judged on its own; the
  formation date applies to the whole prescription.
- The operator switches formation mode off after switching it on: lines are judged against current stock again.
- Original date missing or in the future: the operator cannot continue until a valid past date is entered.
- Date older than the recommended range: warning only, as in spec 004 (FR-012).
- Movement history unavailable (service down): operator is told the check could not be completed and may continue
  only with a recorded justification; nothing is silently accepted.
- Hard blocks unrelated to stock (expired prescription, wrong species, etc.) still apply in formation mode.
- A formation case must never deduct stock or send any stock movement to Siweb360.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The formation choice and original date already captured on the prescription review screen MUST be
  honoured by the result screen's judgement; the operator MUST NOT have to repeat them.
- **FR-002**: In a formation case, the stock part of the line judgement MUST use the stock movements of the
  original date instead of current stock; all other rules (validity, species, prescription expiry, substitution
  limits, controlled-substance rules) MUST be evaluated exactly as in live mode.
- **FR-003**: In a formation case, a product with no current stock MUST NOT by itself lead to an "order the
  product" outcome; the screen MUST offer to continue to dispensing when the original-date check passes.
- **FR-004**: The dispensing screen MUST open with formation mode and the original date carried over from the
  review, with no re-entry required.
- **FR-005**: A formation dispensing MUST be linkable to the ticket already issued (including "Pagado" state) and
  MUST NOT create an order, a reorder-list entry or a new sale.
- **FR-006**: The check MUST be enforced by the server, not only by the screen. A formation request while the mode
  is disabled MUST be rejected (`MODO_RETROSPECTIVO_DESHABILITADO`).
- **FR-007**: If no sale of the product is found on the original date, or the history cannot be read, the
  operator MUST be warned and MAY continue only with a recorded justification (soft block, audit-trailed). Hard
  blocks (`BLOQUEANTE_DURO`) MUST never be overridable.
- **FR-008**: Live (non-formation) reviews MUST behave exactly as today, including the "Añadir a lista de pedido"
  suggestion for genuinely out-of-stock products.
- **FR-009**: Formation dispensings MUST remain flagged with the mode and original date, and the audit trail MUST
  record the original-date check and any override. No personal data in logs or errors.

### Key Entities

- **Formation case**: a prescription reviewed in formation mode; carries the original date and the result of the
  movement check per line.
- **Prescription line judgement**: the per-line outcome (dispense, dispense with notice, order, substitute, blocked)
  and its reasons; in a formation case its stock reason comes from the original-date movements.
- **Existing ticket**: the till ticket already issued for the original sale, to which the dispensing is linked.
- **Dispensing record**: append-only record flagged live or formation, with the original date when formation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A trainee can go from the prescription review to a confirmed, ticket-linked formation dispensing for
  an out-of-stock product without ever seeing an "add to order" prompt for it.
- **SC-002**: 100% of formation reviews for products with a matching sale on the original date offer to continue
  to dispensing.
- **SC-003**: 0 order-list entries, 0 stock deductions and 0 new sales are generated by formation dispensings.
- **SC-004**: Live-prescription reviews show identical outcomes before and after this change (no regressions).
- **SC-005**: The operator does not re-enter the formation choice or original date between the review and the
  dispensing screens.

## Assumptions

- "Formation mode" is the "Modo formación (retrospectivo)" of spec 004, still controlled by
  `RETROSPECTIVE_DISPENSATION_MODE` (default `disabled`).
- The ticket is not created here: it already exists in Siweb360; this feature only links to it (spec 004 rules).
- The movement-history check and its soft-block/override behaviour from spec 004 are reused unchanged.
- The choice of formation mode is made by the operator on the existing review screen; it is not inferred
  automatically from stock being zero.
- Legal and regulatory rules stay in the domain and rule configuration, not in screens or prompts.
- Out of scope: changing the live flow, creating tickets, writing stock to Siweb360, and training content.
