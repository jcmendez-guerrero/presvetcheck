# Data Model: Multi-Prescription Ticket & Retrospective Dispensation

**Feature**: `004-multi-rx-ticket-training-mode`
**Date**: 2026-11-06
**Status**: Completed

## 1. Entity Overview

```
                      ┌──────────────────────┐
                      │        receta        │
                      └──────────┬───────────┘
                                 │ 1
                                 │
                                 │ 0..1
                      ┌──────────┴───────────┐
                      │    ticket_receta     │ (Junction Table)
                      └──────────┬───────────┘
                                 │ N
                                 │
                                 │ 1
                      ┌──────────┴───────────┐
                      │    Siweb360 Ticket   │ (External / Reference)
                      └──────────────────────┘
                                 ▲
                                 │ referenced by
                      ┌──────────┴───────────┐
                      │     conciliacion     │ (Reconciliation Result)
                      └──────────┬───────────┘
                                 │ N
                                 │
                                 │ 1
                      ┌──────────┴───────────┐
                      │     dispensacion     │ (Extended: modo, fecha_original)
                      └──────────┬───────────┘
                                 │ 1
                                 │
                                 │ 0..1
                      ┌──────────┴──────────────────────────┐
                      │  evidencia_stock_retrospectiva      │
                      └─────────────────────────────────────┘
```

---

## 2. Entities & Schema Changes

### 2.1 Table: `ticket_receta` (New)
Represents the explicit association of a Siweb360 POS ticket with a prescription. A single ticket may be linked to multiple prescriptions, but a prescription can be associated with at most one ticket.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | No | Primary Key |
| `ticket_id` | `text` | No | Internal Siweb360 Ticket ID (e.g., `"12345"`) |
| `ticket_numero` | `text` | No | Human-readable Ticket Number (e.g., `"TKT-2026-000042"`) |
| `receta_id` | `uuid` | No | Foreign Key → `receta(id)` ON DELETE RESTRICT |
| `fecha_vinculacion` | `timestamp with time zone` | No | When the ticket was linked |
| `usuario_id` | `text` | No | Operator who performed the linking |
| `estado` | `text` | No | `'vinculado'` \| `'confirmado'` |
| `created_at` | `timestamp with time zone` | No | Creation timestamp |

**Indexes & Constraints**:
- `CONSTRAINT ticket_receta_receta_id_unique UNIQUE (receta_id)`: Enforces that a prescription is linked to at most one ticket.
- `INDEX ticket_receta_ticket_id_idx ON ticket_receta (ticket_id)`: Rapid lookup of all prescriptions belonging to a ticket.
- `INDEX ticket_receta_ticket_numero_idx ON ticket_receta (ticket_numero)`: Fast search by ticket number.

---

### 2.2 Table: `dispensacion` (Extended)
The existing append-only table is extended with two columns to track retrospective training dispensations.

| Field | Type | Nullable | Default | Description |
|-------|------|----------|---------|-------------|
| `modo` | `text` | No | `'en_vivo'` | Mode: `'en_vivo'` (standard live sale) or `'retrospectivo'` (training mode with historical transaction) |
| `fecha_original` | `date` | Yes | `NULL` | The actual date the medication was dispensed in the past (only for `modo = 'retrospectivo'`) |

**Integrity & Immutability**:
- The PostgreSQL trigger `dispensacion_append_only` remains active. `UPDATE` and `DELETE` remain strictly forbidden.
- Any correction to a retrospective dispensation must use a counter-movement with `anula_dispensacion_id`, exactly like live dispensations.

---

### 2.3 Table: `evidencia_stock_retrospectiva` (New)
Records the stock movement query evidence obtained from Siweb360 to justify a retrospective dispensation.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | No | Primary Key |
| `dispensacion_id` | `uuid` | No | Foreign Key → `dispensacion(id)` UNIQUE |
| `cn` | `text` | No | 6-digit National Code |
| `variant_id` | `integer` | Yes | Siweb360 variant ID queried |
| `fecha_original` | `date` | No | Date for which movements were queried |
| `movimientos_consultados` | `jsonb` | No | Array of movements returned by Siweb360 `inventory/movements` |
| `unidades_requeridas` | `integer` | No | Units required by the dispensation |
| `unidades_encontradas` | `integer` | No | Total units found in `sale_shipment` outbound movements on that date |
| `resultado` | `text` | No | `'OK'` \| `'MOVIMIENTO_PARCIAL'` \| `'SIN_MOVIMIENTO'` |
| `forzado` | `boolean` | No | `false` if verified; `true` if overridden with operator justification |
| `motivo_forzado` | `text` | Yes | Operator justification if overridden |
| `created_at` | `timestamp with time zone` | No | Timestamp of the check |

---

## 3. State Transitions

### 3.1 Ticket-Prescription Lifecycle (`ticket_receta.estado`)

```
                ┌──────────────────────────────────┐
                │             START                │
                └────────────────┬─────────────────┘
                                 │
                                 │ Operator scans/links ticket
                                 ▼
                    ┌──────────────────────────┐
                    │        vinculado         │
                    └────────────┬─────────────┘
                                 │
             ┌───────────────────┴───────────────────┐
             │                                       │
             │ Confirm (Reconciliation Passes)       │ Unlink (only if not confirmed)
             ▼                                       ▼
┌──────────────────────────┐             ┌──────────────────────────┐
│        confirmado        │             │         (Deleted)        │
└──────────────────────────┘             └──────────────────────────┘
```

**Transition Rules**:
1. `vinculado → confirmado`:
   - Can only occur when total dispensed units per CN across **all** prescriptions linked to this `ticket_id` are `≤` the ticket item quantities.
   - Updates all `ticket_receta` rows for this `ticket_id` to `'confirmado'`.
   - Populates or finalizes `conciliacion` records for all associated `dispensacion` lines.
2. `vinculado → [Deleted]`:
   - Allowed only when `estado === 'vinculado'`.
   - If `estado === 'confirmado'`, unlinking is blocked with domain error `TICKET_YA_FINALIZADO`.

---

## 4. Validation Rules

1. **Multi-Rx Ticket Quantity Constraint**:
   $$\sum_{r \in \text{recetas}} \text{unidadesDispensadas}(r, \text{CN}) \le \text{unidadesTicket}(\text{ticket}, \text{CN})$$
   - Violation: If dispensed units exceed ticket units, confirmation returns domain error:
     `DomainError('TICKET_CANTIDAD_INSUFICIENTE', { cn, dispensadas, ticket })`.

2. **Retrospective Mode Date Constraint**:
   $$\text{hoy} - \text{fechaOriginal} \le \text{RETROSPECTIVE\_MAX\_AGE\_DAYS} \quad (\text{default } 90 \text{ days})$$
   - Violation: Generates soft warning `Incidencia('AVISO_FECHA_RETROSPECTIVA_ANTIGUA', 'AVISO')`.

3. **Retrospective Dispensation Stock Rule**:
   - `movimientos_sale_shipment(cn, fechaOriginal)` must account for required units.
   - If not found or insufficient: produces `Incidencia('SIN_MOVIMIENTO_STOCK_RETROSPECTIVO', 'BLOQUEANTE_FORMA')`.
   - Can only proceed if the operator includes a non-empty `motivoForzado`.
