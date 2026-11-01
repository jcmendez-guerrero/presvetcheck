# AGENTS.md — Code Agent Instructions

This repository implements the prescription verification, dispensing, and stock movement logging system for Mundo Mascotix "Medicamentos Veterinarios". The functional and technical specification is in `SPEC.md`; this file describes **how** to work on the project.

## AI guidance and precedence

- Follow the project constitution in `.specify/memory/constitution.md`. It defines the governing principles and takes precedence over this file.
- Use `SPEC.md` as the source of functional and technical requirements. If an open decision in `SPEC.md` §13 affects the work, implement it as configuration using the specified default and add a `TODO(decision D-xx)`.
- This file contains the operational conventions derived from the constitution. Keep it consistent with the constitution and specification.
- Repository-specific Copilot custom agents are in `.github/agents/`. They specialize tasks such as API design, QA, security, accessibility, Azure architecture, React, and TypeScript MCP server development.
- Path-specific Copilot instructions are in `.github/instructions/`. Follow the relevant file when working on matching paths; each file's `applyTo` front matter describes its scope.
- Copilot Agent Skills and their bundled resources are in `.github/skills/`. Read the relevant `SKILL.md` and referenced assets when a task matches a skill.
- Spec Kit workflows are provided through `.claude/skills/` and `.specify/`. The Spec Kit constitution is `.specify/memory/constitution.md`; templates and workflow configuration are under `.specify/templates/` and `.specify/workflows/`.
- `CLAUDE.md` is the Claude-specific index to these AI guidance files and tools.

## Priorities

1. Regulatory correctness and traceability take precedence over speed or aesthetics.
2. The domain (`packages/domain`) is pure and is the most important part of the repository. It must have no I/O, no implicit system-clock reads (inject a `Clock`), and no infrastructure dependencies.
3. Anything affected by an open decision in `SPEC.md` §13 must be implemented as configuration with the specified default and a `TODO(decision D-xx)`.

## Do not

- **Do not invent** external data structures. The Nomenclátor XML schema comes from `fixtures/nomenclator/`; CIMAVet and Siweb360 responses come from `docs/ref/` and `fixtures/`. If a sample is missing, leave a skeleton and an `it.todo` explaining which file is needed.
- Validate defect overrides (bypasses) in the API, not only in the UI. A `BLOQUEANTE_DURO` must never be overridden.
- Do not put legal rules in AI prompts or UI components. They belong in `packages/domain` and `config/rules/*.yaml`.
- Do not write stock to Siweb360 except for inbound receipts through the outbox and in accordance with `SIWEB_STOCK_WRITE_MODE` (default `off`). **Never write outbound stock movements**; the POS ticket decrements stock.
- Do not `UPDATE` or `DELETE` `dispensacion`, finalized `recepcion_linea`, or `audit_event`. Corrections must be counter-movements.
- Never put personal data (pet owner name, phone number, ID number, or address) in logs, errors, or telemetry.
- Do not call real services (CIMAVet, Siweb360, Azure) from tests. Use MSW and fixtures.
- Do not add heavy dependencies without justification in the PR. Do not add alternative ORMs or additional UI frameworks.
- Do not silence a vulnerable dependency ad hoc. Follow `docs/adr/0016-dependencias-vulnerables-y-excepciones.md`: upgrade first; every `pnpm.overrides` entry (range-scoped, never global) and every dismissed GitHub alert needs a row in its exceptions table, and dismissals must also be listed in `allow-ghsas` of the `dependencias` CI job — all in the same PR.

## Stack and commands

- Node.js 22, pnpm 9, strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- `pnpm i` — install dependencies.
- `pnpm dev` — Docker Compose (PostgreSQL 16 + Azurite), API, and web app in development mode.
- `pnpm db:migrate` / `pnpm db:seed` — run migrations / seed data.
- `pnpm test` — Vitest across all packages; `pnpm test:int` — integration tests with Testcontainers.
- `pnpm lint` / `pnpm typecheck` / `pnpm build` — lint / type-check / build.
- `pnpm eval:extraction` — extraction evaluation bench using `fixtures/recetas/`.
- `pnpm worker <job>` — run a local job (`cimavet-delta`, `cimavet-full`, `outbox-dispatcher`, `sales-reconciliation`, `weekly-reports`, `nomenclator-import`, `retention-sweep`).

Before considering a task complete, `pnpm lint && pnpm typecheck && pnpm test` must pass.

## Conventions

- Use technical English for generic code and identifiers (`OutboxDispatcher`, `parseGs1`); retain Spanish regulatory-domain terms where no exact translation exists (`receta`, `nregistro`, `cn`, `garante`, `dispensacion`). Maintain the glossary in `docs/glosario.md`.
- UI text must be in clear European Spanish for non-technical staff. Avoid jargon; display "Código nacional" instead of "CN".
- Use `decimal.js` for money (never `number`). Use the Temporal polyfill or `date-fns-tz` for dates; business rules must always use `Europe/Madrid`.
- Validate input and output with zod in `packages/shared`; infer types from schemas.
- Use typed domain errors (`DomainError` with a stable `code`, e.g. `RECETA_CADUCADA`, `PRESCRIPCION_SOLO_PA`); the UI translates each `code` into a message.
- Every rule-engine decision returns `{ decision, motivos[], evidencias, reglaVersion }`, never a bare boolean.
- Use Conventional Commits (`feat:`, `fix:`, `chore:`, etc.). One PR per block in `SPEC.md` §12.1.

## Configuration (environment variables)

Document every variable in `.env.example`, including its description and default value. At minimum:
`DATABASE_URL`, `BLOB_CONNECTION_STRING` (local) / `BLOB_ACCOUNT_URL` (Azure), `KEY_VAULT_URL`, `CIMAVET_BASE_URL`, `CIMAVET_RPS`, `CIMAVET_LIVE_CHECK_MAX_AGE_H`, `SIWEB_BASE_URL`, `SIWEB_TOKEN` (local only), `SIWEB_STOCK_WRITE_MODE`, `SIWEB_SKU_CN_REGEX`, `SIWEB_CATALOG_WRITE`, `SIWEB_WAREHOUSE_NAME` (default `Farmacia`), `SIWEB_WAREHOUSE_ID` (optional), `EXTRACTOR` (`fake|azure`), `DOCINTEL_ENDPOINT`, `DOCINTEL_MODEL_ID`, `EXTRACTION_CONFIDENCE_THRESHOLD`, `SUBSTITUTION_APPROVAL_MODE`, `SUBSTITUTION_SIGN_MAX_DAYS`, `ALLOW_PACK_SIZE_CHANGE`, `ALLOW_PARTIAL_DISPENSATION`, `ENTRY_MIN_SHELF_LIFE_DAYS`, `SCANNER_GS_SUBSTITUTE`, `PRODUCT_VALIDITY_HARD_BLOCK`, `PSYCHOTROPIC_ALLOW_FORCE`, `AUTH_MODE` (`entra|dev`), `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `MAILER` (`smtp|acs|console`), `COLUMN_ENCRYPTION_KEY` (local only).

In production, the app must not start if a required variable is missing (validate with zod at startup).

## Local authentication

`AUTH_MODE=dev` enables a user/role selector in the UI and the `x-dev-user` header. It must be impossible to enable this when `NODE_ENV=production`.

## Tests

- Domain: table-driven cases (`it.each`) covering at least the cases in `SPEC.md` §12.2, plus edge cases (month-end, daylight-saving transitions, day `00` in GS1 expiry dates).
- Integrations: use MSW with responses from `fixtures/`. Include error cases: 5xx, timeout, differently cased field names, unknown new fields, and 409 for unlimited stock.
- Outbox: simulate a timeout after sending; the operation must end in `needs_reconciliation` and must never be retried automatically.
- UI: Playwright smoke test of the prescription → dispensing flow with `EXTRACTOR=fake`.

## Infrastructure

Bicep lives in `infra/`. Target: Azure Container Apps (Consumption) + PostgreSQL Flexible B1ms + Blob + Key Vault + Document Intelligence (custom model; no Azure OpenAI, DUDA-27), in `spaincentral` unless a service is unavailable there. Use managed identity for everything; do not put access keys in app configuration. See `SPEC.md` §10.
