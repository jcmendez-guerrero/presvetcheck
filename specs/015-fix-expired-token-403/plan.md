# Implementation Plan: Expired sign-in answered with "access denied" still returns to Microsoft sign-in

**Branch**: `015-fix-expired-token-403` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-fix-expired-token-403/spec.md`

## Summary

When the sign-in token expires, the platform sign-in in front of the app answers with 403 instead of 401. The web
client only treats 401 as "session lost", so it retries forever on «Conectando…». Fix: the web client's single
fetch wrapper (`apps/web/src/lib/api.ts`) classifies a 403 **without the API's `{ error: { code } }` envelope** as a
platform rejection, runs the existing renew-and-retry path, and if still rejected throws `ApiError(401)`. Everything
downstream (spec 009's redirect limit, sign-in page, session-expired notice) is reused unchanged. API 403s keep
their envelope and keep showing the permission message. See [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 22

**Primary Dependencies**: React + react-query (web), Fastify (API) — no new dependencies

**Storage**: N/A

**Testing**: Vitest (`it.each` table for the classifier), Playwright `apps/web/e2e/sesion.spec.ts` with route mocks

**Target Platform**: Browser SPA behind Azure Container Apps built-in auth (Entra)

**Project Type**: Web application (pnpm monorepo: `apps/api`, `apps/web`)

**Performance Goals**: N/A (one extra `res.clone().json()` only on 403 answers)

**Constraints**: no infrastructure change (spec 009 decision); no calls to Microsoft/Azure from tests

**Scale/Scope**: ~2 source files changed in `apps/web`, 2 test files extended

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|-----------|--------|------|
| I. Code quality | PASS | Pure classifier, strict types, no domain changes, no new dependencies |
| II. Testing discipline | PASS | `it.each` table + Playwright mocks; no real Azure/Microsoft calls |
| III. Security & data protection | PASS | No personal data or token contents logged; API-side 403 checks untouched; `AUTH_MODE=dev` unaffected |
| IV. Maintainability | PASS | No new env vars; Conventional Commit `fix(web): …` |
| V. Language | PASS | Code comments in Spanish; no new UI copy (existing messages reused) |
| Public repository | PASS | Real environment hostname kept out of all artifacts |

Post-design re-check: PASS (design adds no stored data, no endpoints, no infra).

## Project Structure

### Documentation (this feature)

```text
specs/015-fix-expired-token-403/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/rechazo-plataforma.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/lib/
├── sesion.ts          # + esRechazoDePlataforma(status, cuerpo)
├── sesion.test.ts     # + it.each table from contracts/rechazo-plataforma.md
├── api.ts             # rechazada() uses the classifier on 403; normalise to ApiError(401, 'NO_AUTORIZADO')
└── auth.tsx           # unchanged (already maps ApiError 401 → sesionPerdida); comment updated
apps/web/e2e/
└── sesion.spec.ts     # + 403 HTML scenarios (startup, in use, API 403 with code)
apps/web/src/paginas/movil.tsx   # unchanged (already tolerant; verified in quickstart)
```

**Structure Decision**: fix is confined to the web client's fetch wrapper; API and infra untouched.

## Complexity Tracking

None.
