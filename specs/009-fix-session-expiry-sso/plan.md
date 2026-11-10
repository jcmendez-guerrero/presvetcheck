# Implementation Plan: Expired session always returns to Microsoft sign-in

**Branch**: `009-fix-session-expiry-sso` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-fix-session-expiry-sso/spec.md`

## Summary

After a reload with a stale session the web app stays on "Iniciando sesión…" with the header and menu drawn, and
never goes back to Microsoft sign-in. Research ([research.md](research.md)) found three causes that combine:

1. **The service worker serves the app shell on reload.** The PWA precaches `index.html` and answers navigations
   from cache, so the reload never reaches the platform's built-in authentication (which would redirect to
   Microsoft). The app always starts client-side and must decide on its own.
2. **An expired token ends in a silent dead end.** With the token store, `/.auth/me` can still answer 200 with an
   `id_token` that has already expired (the platform session outlives the 1 h token). The API rejects it with 401
   (`NO_AUTORIZADO`), and `auth.tsx` handles a rejected `/api/me` with `.catch(() => setUsuario(null))`: no refresh,
   no redirect, no fallback screen.
3. **An expired platform session breaks `fetch`.** API calls without an AJAX marker get a 302 to
   `login.microsoftonline.com`; `fetch` follows it cross-origin and fails with a network error, which also lands in
   the same silent `catch`.

The fix is **client-only** (no API, schema or infra change): an explicit session state machine in `ProveedorAuth`,
one shared "session lost" path for every 401 (refresh once → redirect with loop guard → sign-in page), an AJAX
marker on API calls so the platform answers 401 instead of 302, and a layout that shows only a bare access screen
(no header, no menu) until the session is active.

## Technical Context

**Language/Version**: TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Node.js 22

**Primary Dependencies**: React 19 + TanStack Router/Query (existing), Tailwind, vite-plugin-pwa (existing). No new
dependencies.

**Storage**: Browser `localStorage` for the loop-guard timestamp (already used: `mmx.reintentoLogin`). No server
storage.

**Testing**: Vitest (`apps/web`, node environment) for pure helpers; Playwright (`apps/web/e2e`) with `page.route`
mocks for `/api/config/publica`, `/.auth/*` and `/api/me` to simulate Entra mode. No real Entra calls.

**Target Platform**: Desktop browsers (Chromium/Edge) on staff PCs; Azure Container Apps with built-in
authentication (Entra ID), token store enabled.

**Project Type**: Web application (monorepo: `apps/web` SPA + `apps/api` Fastify). Change is confined to `apps/web`.

**Performance Goals**: Silent re-sign-in round trip under 10 s (SC-002); session check adds no extra request when
the session is valid.

**Constraints**: Never loop (≤ 1 automatic redirect per 60 s); return address must stay in-app; `/movil` and
`AUTH_MODE=dev` unchanged; no personal data in logs.

**Scale/Scope**: ~10 concurrent staff users; ~6 files touched in `apps/web`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| I. Code quality — strict TS, typed errors, no heavy deps | Uses existing `ApiError.status`/`code` (`NO_AUTORIZADO`); session state is a typed union; no new dependency. Domain untouched. | PASS |
| II. Testing — lint/typecheck/test green, no real external calls | Pure helpers unit-tested with `it.each`; Playwright mocks `/.auth/*` and `/api/*`; no Entra calls. | PASS |
| III. Security & data protection | API keeps enforcing auth (FR-010); return URL restricted to same-origin paths (open-redirect guard); no tokens or names logged; `AUTH_MODE=dev` path untouched. | PASS |
| IV. Maintainability | No new env vars (loop window stays a constant: 60 s, as today). One PR, scoped to sign-in. | PASS |
| V. Language | New UI copy in European Spanish ("Tu sesión ha caducado", "Iniciar sesión con Microsoft"); identifiers in English where generic. | PASS |
| Regulatory traceability | No change to `dispensacion`, `recepcion_linea` or `audit_event`; sign-in is not an audited domain event. | PASS |

**Post-design re-check**: PASS — the design adds no server surface, no persistence and no dependency.

## Project Structure

### Documentation (this feature)

```text
specs/009-fix-session-expiry-sso/
├── plan.md              # This file
├── research.md          # Phase 0: root cause and decisions
├── data-model.md        # Phase 1: client session state machine
├── quickstart.md        # Phase 1: how to validate locally and in non-production
├── contracts/
│   └── sesion.md        # Phase 1: platform endpoints used + screen per session state
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
apps/web/src/
├── lib/
│   ├── api.ts            # + X-Requested-With header; + hook for 401 (configurarNoAutorizado)
│   ├── auth.tsx          # session state machine, refresh-once, loop guard, return URL
│   ├── sesion.ts         # NEW pure helpers: rutaRetorno(), puedeRedirigir(), urlLogin(), urlLogout()
│   └── sesion.test.ts    # NEW unit tests (it.each)
├── componentes/
│   ├── layout.tsx        # render PaginaAcceso (bare) unless estado === 'activa'
│   ├── pagina-acceso.tsx # NEW bare screen: conectando / comprobando / sin-sesion / sin-acceso
│   ├── sesion-caducada.tsx # NEW mid-session dialog (estado 'caducada')
│   └── topbar.tsx        # sign-out via cerrarSesion() (sets the "signed out" flag)
apps/web/e2e/
└── sesion.spec.ts        # NEW Playwright: expired reload, loop guard, sign-out, server down, multi-tab,
                          #     mid-session 401, sin acceso, /movil untouched
```

**Structure Decision**: Web application; all changes in `apps/web`. `apps/api` already returns 401 `NO_AUTORIZADO`
for missing/invalid tokens and needs no change. Infra (`authConfigs`) already uses `RedirectToLoginPage` and needs
no change.

## Complexity Tracking

No constitution violations; nothing to justify.
