# Research: Multi-Prescription Ticket & Retrospective Dispensation

**Feature**: `004-multi-rx-ticket-training-mode`
**Date**: 2026-11-06
**Status**: Completed

## 1. Multi-Prescription Ticket Association & Reconciliation

### Context
Currently, each dispensation line in `dispensacion` is reconciled individually via the `conciliacion` table (`dispensacionId` UNIQUE, `ticket: string`, `movimientoId: text`). The POS (Siweb360) produces a single sales ticket for a customer, even when that customer purchases medications prescribed under multiple distinct prescriptions (e.g., Rx-A for antibiotics and Rx-B for analgesics). The system previously lacked an explicit association between tickets and prescriptions, relying only on 1:1 post-dispensation line matching or manual single-line assignment.

### Decision
1. **Explicit Junction Entity (`ticket_receta`)**:
   Introduce a `ticket_receta` table in `@mmx/db`:
   - `id: uuid PRIMARY KEY`
   - `ticketId: text NOT NULL` (Siweb360 internal ticket ID, e.g. `"12345"`)
   - `ticketNumero: text NOT NULL` (e.g. `"TKT-2026-000042"`)
   - `recetaId: uuid NOT NULL REFERENCES receta(id)`
   - `fechaVinculacion: timestamp with time zone NOT NULL`
   - `usuarioId: text NOT NULL`
   - `estado: text NOT NULL DEFAULT 'vinculado'` (`'vinculado'` | `'confirmado'`)
   - Unique index on `recetaId`: Each prescription can be linked to at most ONE ticket (a single prescription is fulfilled in one sale; if partial, see below).
   - Compound index on `(ticketId, recetaId)`: Prevents duplicate links.

2. **Reconciliation Algorithm Across Multiple Prescriptions**:
   - Given a `ticketId`, query all `ticket_receta` rows to retrieve all associated `recetaId`s.
   - For all associated prescriptions, retrieve all non-annulled `dispensacion` lines.
   - Group and sum dispensed quantities by CN: `dispensadasPorCn: Map<string, number>`.
   - Retrieve ticket items from Siweb360 via `GET /api/public/tickets/{id}`.
   - Parse each ticket item name using `TicketsSalesMovementsSource.cnDeLinea(item.nombre)` to extract the 6-digit CN.
   - Group and sum ticket quantities by CN: `ticketPorCn: Map<string, number>`.
   - Comparison rules:
     - **Exact Match** (`dispensadasPorCn[cn] === ticketPorCn[cn]`): Validated.
     - **Deficit / Additional Items on Ticket** (`dispensadasPorCn[cn] < ticketPorCn[cn]` or ticket line without prescription): Soft warning / informational. The ticket may include non-prescription items or items for a prescription not yet entered.
     - **Excess Dispensed** (`dispensadasPorCn[cn] > ticketPorCn[cn]`): **Hard Block (`BLOQUEANTE_DURO`)**. You cannot confirm a ticket that accounts for fewer units than dispensed across the linked prescriptions.
   - Upon confirmation:
     - For each dispensation line, create or update `conciliacion` row linking to the corresponding ticket line.
     - Mark `ticket_receta` rows for this ticket as `'confirmado'`.
     - Log immutable audit event `ticket_confirmado_multi_receta`.

### Alternatives Considered
- *Implicit matching through `conciliacion` table only*: Rejected because it does not model the operator's intent to bind a specific ticket to multiple prescriptions before all lines are reconciled, and cannot enforce whole-ticket consistency across prescriptions.
- *Modifying `receta` table directly with `ticket_id` column*: Rejected because it couples prescription master data with POS sales transaction lifecycle and complicates audit history.

---

## 2. Retrospective Dispensation Mode (Training Mode)

### Context
The pharmacy is training staff using real past transactions. In training mode, medications were already dispensed and sold days or weeks ago through Siweb360 POS. Checking current stock levels (`GET /api/public/inventory/variants/{id}/stock`) fails because the items have already left the pharmacy stock. Staff need to practise the full workflow (OCR review → decision engine → scanning/confirmation → ticket reconciliation) without receiving false "sin stock" errors.

### Decision
1. **Feature Flagging**:
   - `RETROSPECTIVE_DISPENSATION_MODE`: `'enabled'` | `'disabled'` (default: `'disabled'`). Documented in `.env.example`.
   - In production or when set to `'disabled'`, UI suppresses retrospective options and API returns `DomainError('MODO_RETROSPECTIVO_DESHABILITADO')`.
   - `RETROSPECTIVE_MAX_AGE_DAYS`: integer (default: `90`). If `fechaOriginal` is older than this limit, the system raises a soft warning (`AVISO_FECHA_RETROSPECTIVA_ANTIGUA`).

2. **Stock Verification Strategy**:
   - Normal mode: Calls `StockPort.lotes(cn, ...)` checking current on-hand warehouse stock.
   - Retrospective mode:
     - Resolves CN to Siweb360 `variantId` using `VariantResolver`.
     - Queries Siweb360 stock movement history via `GET /api/public/inventory/movements`:
       - `variant_id`: resolved variant ID
       - `warehouse_id`: Farmacia warehouse ID
       - `reason`: `'sale_shipment'`
       - `date_from`: `fechaOriginal`
       - `date_to`: `fechaOriginal`
     - Evaluates whether outbound movements (`quantity < 0`) on that date account for the required quantity:
       - If matching outbound movements found: Stock verification **PASSES** (`estado: 'OK'`, pseudo-lotes constructed from movements with `disponible: abs(mov.quantity)`).
       - If no movement or insufficient quantity found: Soft warning `Incidencia('SIN_MOVIMIENTO_STOCK_RETROSPECTIVO', 'BLOQUEANTE_FORMA')`. The operator can force/override with an explicit justification, preserving training velocity.

3. **Ticket Acceptance in Retrospective Mode**:
   - Historical tickets in Siweb360 are already in `'Pagado'` state.
   - In retrospective mode, the ticket lookup and confirmation allows tickets with `estado === 'Pagado'`.

4. **Data Model & Audit Trail**:
   - `dispensacion` table extended with:
     - `modo: text NOT NULL DEFAULT 'en_vivo'` (`'en_vivo'` | `'retrospectivo'`)
     - `fechaOriginal: date` (NULL for live; YYYY-MM-DD for retrospective)
   - Table `evidencia_stock_retrospectiva` (or jsonb field): records `variantId`, `fechaConsulta`, `movimientosEncontrados`, `decision`.
   - Append-only trigger on `dispensacion` remains intact: rows are strictly insert-only.

### Alternatives Considered
- *Mock stock completely in frontend*: Rejected because trainers need staff to use the actual backend API, test real Siweb360 connectivity, and inspect real ticket numbers.
- *Writing synthetic stock adjustments before training*: Rejected by Constitution Principle VI ("never write outbound stock; entries only through outbox"). Modifying live or test inventory destroys inventory reconciliation integrity.

---

## 3. Siweb360 API Integration Findings

### Endpoints Verified against OpenAPI 1.2.0 Spec
1. `GET /api/public/inventory/movements`:
   - Supports query params: `variant_id`, `warehouse_id`, `reason`, `date_from`, `date_to`, `page`, `limit`.
   - Returned items include: `id`, `created_at`, `variant_id`, `sku`, `warehouse_id`, `quantity` (negative for outbound), `reason` (`sale_shipment`), `reference_type` (`budget` / `ticket`), `reference_number`, `batch_number`, `expiry_date`.
   - Fits retrospective stock movement verification.

2. `GET /api/public/tickets`:
   - Supports query params: `search`, `fecha_desde`, `fecha_hasta`, `estado` (`Pagado`, `Pendiente`, `Cancelado`), `limit`.
   - Returned items: `id`, `numero`, `fecha`, `hora`, `estado`, `total`, `items_count`.

3. `GET /api/public/tickets/{id}`:
   - Returns full ticket details including `items: [{ id, nombre, cantidad, precio_unitario, impuesto, ... }]`.
   - Product CN is embedded in `nombre` (e.g. `"CLAVUBAY 50/12.5 MG CN570016"`), extracted with existing `TicketsSalesMovementsSource.cnDeLinea()`.

---

## 4. Summary of Architecture Decisions

| Area | Decision | Constitution Compliance |
|------|----------|-------------------------|
| **Multi-Rx Ticket** | `ticket_receta` junction table with `recetaId` UNIQUE | Purity in domain, append-only traceability |
| **Reconciliation** | Sum-by-CN across prescriptions; hard block on over-dispense | Regulatory-first; defect validation in API |
| **Retrospective Mode** | Feature-flagged; stock check via `movements(reason=sale_shipment)` | No outbound writes to Siweb360; strict audit |
| **Dispensation Storage** | Add `modo` and `fecha_original` to `dispensacion` | Preserves append-only triggers and counter-movement rules |
