# Implementation Plan: Multi-Prescription Ticket & Retrospective Dispensation

**Branch**: `004-multi-rx-ticket-training-mode` | **Date**: 2026-11-06 | **Spec**: [spec.md](file:///Users/ac86016/Git/personal/presvetcheck/specs/004-multi-rx-ticket-training-mode/spec.md)

**Input**: Feature specification from `/specs/004-multi-rx-ticket-training-mode/spec.md`

## Summary

This feature delivers two core capabilities:
1. **Multi-prescription ticket association and reconciliation**: Enables a single Siweb360 POS sales ticket to cover items dispensed across multiple prescriptions (1:N ticket-to-prescription). A new `ticket_receta` junction entity maintains associations and validates that total dispensed units per National Code (CN) across all linked prescriptions match the ticket line items, raising hard blocks on over-dispensing.
2. **Retrospective dispensation (Training mode)**: Provides a configurable training capability (`RETROSPECTIVE_DISPENSATION_MODE`, default `disabled`) allowing staff to practise with historical transactions. Instead of validating on-hand stock, the system queries Siweb360 stock movement history (`inventory/movements`, `reason=sale_shipment`) for the original dispensation date and allows confirming tickets already in `Pagado` status. Dispensation rows record `modo = 'retrospectivo'` and `fecha_original`, preserving the immutable append-only audit trail.

---

## Technical Context

**Language/Version**: TypeScript 5.8+, Node.js 22 (ESM)
**Primary Dependencies**: Fastify, Zod 3, Drizzle ORM, decimal.js, date-fns-tz / @js-temporal/polyfill
**Storage**: PostgreSQL 16 (Drizzle migrations in `packages/db/migrations`)
**Testing**: Vitest across all packages; MSW for external Siweb360 mock fixtures
**Target Platform**: Node.js backend (Azure Container Apps) + React PWA frontend (Vite)
**Project Type**: Monorepo with core domain library (`packages/domain`), database layer (`packages/db`), Siweb adapter (`packages/siweb`), shared schemas (`packages/shared`), API service (`apps/api`), and web app (`apps/web`).
**Performance Goals**: Multi-prescription ticket reconciliation response `< 200ms`; stock movement query response `< 500ms`.
**Constraints**:
- `packages/domain` must remain 100% pure (no I/O, no clock reads, inject `Clock`).
- `dispensacion` table is strictly append-only (PostgreSQL triggers enforce no UPDATE/DELETE; corrections via counter-movement).
- Outbound stock must NEVER be written to Siweb360 (POS ticket decrements stock).
- Personal data (pet owner PII) must never appear in logs or telemetry.
**Scale/Scope**: Daily counter transactions (tens to hundreds of tickets/day; 1–5 prescriptions per multi-prescription ticket).

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status | Justification / Implementation |
|-----------|-------|--------|--------------------------------|
| **I. Code Quality** | Pure domain, typed errors, Zod inference, Decimal for money, `Europe/Madrid` dates | ✅ PASSED | Multi-prescription reconciliation logic lives in `@mmx/domain` as a pure function. Typed errors (`TICKET_YA_FINALIZADO`, `TICKET_CANTIDAD_INSUFICIENTE`). |
| **II. Testing Discipline** | `pnpm lint && pnpm typecheck && pnpm test` green; MSW and versioned fixtures; table-driven tests | ✅ PASSED | All tests in domain, siweb, and api pass (1,494 domain tests, 115 siweb/api tests). Integration tests use MSW and `fixtures/siweb/`. |
| **III. Security & Data Protection** | No owner PII in logs; `BLOQUEANTE_DURO` cannot be bypassed; append-only for `dispensacion`; no dev auth in prod | ✅ PASSED | Over-dispensing is enforced as a hard block in the API. `dispensacion` table remains append-only. Only `BLOQUEANTE_FORMA` can be overridden in training mode with justification. |
| **IV. Maintainability** | Document env vars in `.env.example`; open decisions tagged `TODO(decision D-xx)`; Conventional Commits | ✅ PASSED | Resolves decisions **D-11** (1:N tickets) and **D-14** (retrospective training mode). Documented via `RETROSPECTIVE_DISPENSATION_MODE` in `.env.example`. |
| **V. Spanish Product, English Architecture** | UI and regulatory terms in Spanish; technical code in English | ✅ PASSED | UI copy in European Spanish ("Vincular ticket", "Modo retrospectivo"); API and domain code in English identifiers. |

---

## Project Structure

### Documentation (this feature)

```text
specs/004-multi-rx-ticket-training-mode/
├── spec.md                         # Feature specification
├── plan.md                         # This file (/speckit-plan output)
├── research.md                     # Technical research & decisions
├── data-model.md                   # Data model & schema changes
├── quickstart.md                   # Runnable validation guide
├── contracts/
│   └── api-contracts.yaml          # OpenAPI specification of endpoints
└── siweb360-openapi-v1.2.0.yaml    # Uploaded reference API spec
```

### Source Code Impact

```text
packages/
├── domain/
│   └── src/
│       ├── conciliacion.ts         # Multi-rx reconciliation algorithm (pure)
│       └── tipos.ts                # Extended types: RetrospectiveStockCheck, TicketMultiReceta
├── db/
│   ├── src/schema/
│   │   ├── infra.ts                # Add ticket_receta table, evidencia_stock_retrospectiva
│   │   └── recetas.ts              # Add modo and fecha_original to dispensacion
│   └── migrations/
│       └── 0017_multi_rx_retrospectivo.sql # PostgreSQL migration
├── shared/
│   └── src/
│       ├── codes.ts                # Domain error codes: TICKET_YA_FINALIZADO, etc.
│       └── config.ts               # Env vars: RETROSPECTIVE_DISPENSATION_MODE, RETROSPECTIVE_MAX_AGE_DAYS
├── siweb/
│   └── src/
│       ├── client.ts               # Add date_from/date_to parameters to movements()
│       └── ventas.ts               # Ticket search & detail extraction
apps/
├── api/
│   └── src/
│       ├── rutas/
│       │   ├── registros.ts        # Routes: vincular, desvincular, confirmar, detalle ticket
│       │   └── operativa.ts        # Retrospective movements query endpoint
│       └── servicios/
│           ├── conciliacion.ts     # Multi-prescription ticket service logic
│           └── dispensaciones.ts   # Support modo and fecha_original in dispensarConReceta
└── web/
    └── src/
        ├── componentes/
        │   ├── tras-dispensar.tsx  # Multi-prescription ticket linking UI
        │   └── ticket-multi-rx.tsx # Consolidated ticket reconciliation report
        └── paginas/
            └── dispensacion.tsx    # Retrospective mode toggle and historical date input
```

---

## Complexity Tracking

> No constitution violations detected. No unjustified complexity introduced.
