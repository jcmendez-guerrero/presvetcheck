# Quickstart: Multi-Prescription Ticket & Retrospective Dispensation

**Feature**: `004-multi-rx-ticket-training-mode`
**Date**: 2026-11-06

This guide provides runnable scenarios to validate multi-prescription ticket reconciliation and retrospective training dispensation.

---

## Prerequisites

1. Set up test environment variables in `.env`:
   ```bash
   RETROSPECTIVE_DISPENSATION_MODE=enabled
   RETROSPECTIVE_MAX_AGE_DAYS=90
   ```
2. Verify local database and seed data:
   ```bash
   pnpm db:migrate
   ```
3. Run the unit and integration tests:
   ```bash
   ./node_modules/.bin/vitest run packages/domain packages/siweb apps/api/test/conciliacion.test.ts
   ```

---

## Scenario 1: Multi-Prescription Ticket Association & Confirmation

**Objective**: Link two distinct prescriptions to a single Siweb360 ticket and verify reconciliation.

### Step 1: Dispense Prescription A
- Dispense 2 units of CN `570016` for prescription `Rx-A` (`11111111-1111-1111-1111-111111111111`).
- Verify `dispensacion` row created with `unidades = 2`.

### Step 2: Dispense Prescription B
- Dispense 1 unit of CN `590948` for prescription `Rx-B` (`22222222-2222-2222-2222-222222222222`).
- Verify `dispensacion` row created with `unidades = 1`.

### Step 3: Link Ticket to Both Prescriptions
- Link ticket `TKT-2026-000042` (ID `"7001"`):
  ```bash
  curl -X POST http://localhost:3000/api/conciliacion/tickets/vincular \
    -H "Content-Type: application/json" \
    -d '{"ticketId":"7001","ticketNumero":"TKT-2026-000042","recetaId":"11111111-1111-1111-1111-111111111111"}'
  ```
- Link the same ticket to the second prescription:
  ```bash
  curl -X POST http://localhost:3000/api/conciliacion/tickets/vincular \
    -H "Content-Type: application/json" \
    -d '{"ticketId":"7001","ticketNumero":"TKT-2026-000042","recetaId":"22222222-2222-2222-2222-222222222222"}'
  ```

### Step 4: Verify Multi-Prescription Details
- Query the consolidated ticket status:
  ```bash
  curl http://localhost:3000/api/conciliacion/tickets/7001
  ```
- **Expected Outcome**:
  - `recetas` array lists both `Rx-A` and `Rx-B`.
  - `conciliacionLineas` shows `CN 570016: 2 dispensadas, 2 ticket (COINCIDE)` and `CN 590948: 1 dispensada, 1 ticket (COINCIDE)`.
  - `puedeConfirmar === true`.

### Step 5: Confirm Ticket
- Execute confirmation:
  ```bash
  curl -X POST http://localhost:3000/api/conciliacion/tickets/7001/confirmar
  ```
- **Expected Outcome**: Returns `{ "ok": true, "salidasConciliadas": 2 }`. Both `ticket_receta` rows transition to `confirmado`.

---

## Scenario 2: Retrospective Dispensation (Training Mode)

**Objective**: Dispense a historical prescription by verifying stock movements from the past instead of current stock.

### Step 1: Query Historical Stock Movement
- Check stock movements for a past date:
  ```bash
  curl -X POST http://localhost:3000/api/inventario/movimientos/retrospectivo \
    -H "Content-Type: application/json" \
    -d '{"cn":"570016","fechaOriginal":"2026-10-30","unidadesRequeridas":2}'
  ```
- **Expected Outcome**:
  - If outbound `sale_shipment` movement exists on `2026-10-30`: returns `estado: "OK"`.
  - If no movement exists: returns `estado: "SIN_MOVIMIENTO"` with `Incidencia('SIN_MOVIMIENTO_STOCK_RETROSPECTIVO', 'BLOQUEANTE_FORMA')`.

### Step 2: Dispense with Retrospective Mode Flag
- Submit dispensation with `modo: "retrospectivo"` and `fechaOriginal: "2026-10-30"`.
- Verify the `dispensacion` table contains `modo = 'retrospectivo'` and `fecha_original = '2026-10-30'`.
- Verify `evidencia_stock_retrospectiva` contains the query evidence and movement IDs.

### Step 3: Confirm Historical Ticket
- Link and confirm historical ticket `TKT-2026-000035` (even if in `Pagado` status).
- **Expected Outcome**: Ticket confirmation succeeds without demanding a live `Pendiente` POS ticket.

---

## Scenario 3: Hard Block on Over-Dispensing

**Objective**: Verify that a ticket cannot be confirmed if dispensed units exceed ticket line quantities.

### Step 1: Setup Over-Dispensing Condition
- Prescription Rx-1 dispenses 3 units of CN `570016`.
- Prescription Rx-2 dispenses 2 units of CN `570016`.
- Both linked to ticket `TKT-OVER` which only contains 4 units of CN `570016`.

### Step 2: Attempt Confirmation
- Execute confirmation:
  ```bash
  curl -X POST http://localhost:3000/api/conciliacion/tickets/TKT-OVER/confirmar
  ```
- **Expected Outcome**:
  - HTTP 400 Bad Request.
  - Error: `DomainError('TICKET_CANTIDAD_INSUFICIENTE')`.
  - Details report: `dispensadas: 5, ticket: 4, cn: "570016"`.
  - Ticket remains in `vinculado` status.
