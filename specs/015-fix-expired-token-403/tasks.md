---

description: "Task list for 015-fix-expired-token-403"
---

# Tasks: Expired sign-in answered with "access denied" still returns to Microsoft sign-in

**Input**: Design documents from `specs/015-fix-expired-token-403/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/rechazo-plataforma.md](contracts/rechazo-plataforma.md), [quickstart.md](quickstart.md)

**Tests**: Included — required by spec FR-008 and constitution II. No real Entra/Azure calls: Playwright fakes
`/api/config/publica`, `/.auth/*` and `/api/me` with `context.route` in `apps/web/e2e/sesion.spec.ts`.

**Organization**: Grouped by user story. All paths relative to the repository root; every change is in `apps/web`.
Code comments in European Spanish; no new UI copy (spec 009 messages are reused).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 from spec.md

---

## Phase 1: Setup

No setup: no new dependencies, env vars or files.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: the pure classifier that decides "platform rejection" vs "API permission error".

- [X] T001 [P] Add an `it.each` table `esRechazoDePlataforma` to `apps/web/src/lib/sesion.test.ts` with every row of
  the table in `specs/015-fix-expired-token-403/contracts/rechazo-plataforma.md`: 401 + any body → `true`; 403 with
  `null`, `'<html>…</html>'`, `''`, `{}`, `{ error: {} }`, `{ error: { code: '' } }` → `true`; 403 with
  `{ error: { code: 'PROHIBIDO' } }` → `false`; 200, 404, 500 with any body → `false`. Run it and confirm it fails
  (function missing).
- [X] T002 Implement and export `esRechazoDePlataforma(status: number, cuerpo: unknown): boolean` in
  `apps/web/src/lib/sesion.ts`: `true` when `status === 401`; when `status === 403`, `true` unless `cuerpo` is an
  object whose `error.code` is a non-empty string; otherwise `false`. Pure, no I/O. One-line Spanish comment: the
  API always answers its own errors with `{ error: { code } }` (`apps/api/src/plugins/errores.ts`), the platform
  sign-in never does. T001 must pass.

**Checkpoint**: `pnpm --filter @mmx/web test -- sesion` green.

---

## Phase 3: User Story 1 — Reload with an expired token goes back to sign-in (P1) 🎯 MVP

**Goal**: a platform 403 on `/api/config/publica` or `/api/me` at startup follows spec 009's "not signed in" path.

**Independent Test**: Playwright with `/api/config/publica` answering 403 HTML → user goes to the mocked Microsoft
sign-in, not «Conectando…».

### Tests for User Story 1

- [X] T003 [US1] In `apps/web/e2e/sesion.spec.ts`, extend `type Respuesta` with `'prohibido-plataforma'` and make
  `responder` fulfil it as `{ status: 403, contentType: 'text/html', body: '<p>Forbidden</p>' }` (what the platform
  sign-in sends; no `error.code`).
- [X] T004 [US1] Add Playwright tests in `apps/web/e2e/sesion.spec.ts`, modelled on «la plataforma rechaza la
  configuración: va a Microsoft, no a «Conectando…»» (line ~111):
  (a) `config: ['prohibido-plataforma']` → `reg.login` has one entry with the return address, «Conectando» never
  stays visible;
  (b) `config: ['real']`, `me: ['prohibido-plataforma']`, `refresh: 401` → goes to Microsoft;
  (c) same as (a) after signing out (`context.addInitScript(() => localStorage.setItem('mmx.sesionCerrada', '1'))`,
  as the existing «tras cerrar sesión…» test does) → heading «Tu sesión ha terminado», `reg.login` empty;
  (d) `config: [503, 'real']` still retries and opens the screen (regression guard, FR-005);
  (e) same as (a) with a recent redirect (`page.addInitScript(() => localStorage.setItem('mmx.reintentoLogin',
  String(Date.now())))`, as «protección contra bucles…» does) → heading «Tu sesión ha terminado», `reg.login` empty
  (FR-004, SC-004).
  In (a), wait for the redirect with `{ timeout: 10_000 }` (SC-001).
  Run them and confirm (a), (b), (c) and (e) fail before T005.

### Implementation for User Story 1

- [X] T005 [US1] In `apps/web/src/lib/api.ts`, replace `const rechazada = (r: Response) => r.status === 401 ||
  r.type === 'opaqueredirect'` with an async check: `opaqueredirect` → `true`; status 401/403 → read the body from
  `r.clone()` (JSON if `content-type` includes `json`, else text; `null` on parse error) and return
  `esRechazoDePlataforma(r.status, cuerpo)`; else `false`. Update both call sites (`await rechazada(res)`), keep the
  renew-once-then-retry logic unchanged, and after it, if the final response is still a platform rejection, throw
  `new ApiError(401, 'NO_AUTORIZADO', null, null)` (replacing the current `opaqueredirect`-only throw). Update the
  Spanish comments that say "ante un 401" to "ante un rechazo de la plataforma (401, o 403 sin código de la API)".
- [X] T006 [US1] In `apps/web/src/lib/auth.tsx`, update only the comments near `ProveedorAuth` and the
  `/api/config/publica` catch (line ~166) to say the platform may answer 401 or 403 and `api.ts` normalises both to
  `ApiError(401)`; reference `specs/015-fix-expired-token-403/research.md`. No logic change.

**Checkpoint**: T004 (a)–(e) and all pre-existing tests in `apps/web/e2e/sesion.spec.ts` pass.

---

## Phase 4: User Story 3 — Real "no permission" answers stay permission errors (P1)

**Goal**: API 403s with `error.code` never trigger renewal or sign-in.

**Independent Test**: signed in, an action answered `403 { error: { code: 'PROHIBIDO' } }` shows the permission
message; `reg.refresh === 0` and `reg.login` is empty.

- [X] T007 [US3] In `apps/web/e2e/sesion.spec.ts`, generalise `estado.resto401` into `estado.resto: { n: number;
  r: Respuesta }` (default `{ n: 0, r: 401 }`) and update the existing tests that set `resto401`, keeping their
  behaviour unchanged.
- [X] T008 [US3] Add a Playwright test in `apps/web/e2e/sesion.spec.ts`: signed in, next `/api` request answers
  `{ status: 403, json: { error: { code: 'PROHIBIDO' } } }` (via `estado.resto` with an inline object or a new
  `Respuesta` variant) → the screen shows the Spanish permission message for `PROHIBIDO` (from `textoError`), no
  session-expired notice, `reg.refresh === 0`, `reg.login` empty.
- [X] T009 [US3] No new test: acceptance US3-2 (no roles → «sin acceso» screen) is already guarded by the existing
  «cuenta sin roles: mensaje de sin acceso y sin menú» test in `apps/web/e2e/sesion.spec.ts`; confirm it still passes
  after T005.

**Checkpoint**: T008 and the existing no-roles test pass with no source change beyond T005 (the T001 table already covers the rule).

---

## Phase 5: User Story 2 — Token expires while the app is open (P2)

**Goal**: an in-use platform 403 triggers one silent renewal, then the session-expired notice if it fails.

**Independent Test**: app open, next request → 403 HTML; with refresh 200 the action completes silently; with
refresh 401 the session-expired notice appears.

- [X] T010 [US2] Add Playwright test in `apps/web/e2e/sesion.spec.ts`, modelled on «caducidad durante el uso con
  renovación correcta: sin aviso» (line ~233): `estado.resto = { n: 1, r: 'prohibido-plataforma' }`, `refresh: 200`
  → no notice, data shown, `reg.refresh === 1`.
- [X] T011 [US2] Add Playwright test in `apps/web/e2e/sesion.spec.ts`, modelled on «caducidad durante el uso: aviso
  bloqueante y vuelta a la pantalla» (line ~214): `estado.resto = { n: 99, r: 'prohibido-plataforma' }`,
  `refresh: 401` → `alertdialog` contains «Tu sesión ha caducado» and «Los cambios sin guardar» (unsaved-data
  warning, US2 acceptance 2); pressing «Volver a iniciar sesión» records one `reg.login` entry.

**Checkpoint**: T010–T011 pass (behaviour comes from T005; no extra source change expected).

---

## Phase 6: Polish & cross-cutting

- [X] T012 In `apps/web/e2e/sesion.spec.ts`, add a test modelled on «/movil no llama a la autenticación de la
  plataforma» (line ~259): `/api/config/publica` → `'prohibido-plataforma'`, open `/movil?t=x` → page renders its
  header, no uncaught page error (FR-006). No change to `apps/web/src/paginas/movil.tsx`.
- [X] T013 [P] Review the T005 diff in `apps/web/src/lib/api.ts` for any `console.*` or telemetry call that could
  carry token contents or personal data (FR-007); there should be none.
- [X] T014 Run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm --filter @mmx/web test:e2e -- e2e/sesion.spec.ts`;
  all green.
- [X] T015 Tick off `specs/015-fix-expired-token-403/quickstart.md` §1–§4; leave §5 (deployed check) for the user.

---

## Dependencies & execution order

- **Phase 2 (T001→T002)** blocks everything.
- **US1 (T003→T004→T005→T006)** is the MVP and contains the only production logic change (T005).
- **US3 (T007→T008→T009)** depends on T003 (shared `Respuesta` type) and T005; ships with US1 (both P1).
- **US2 (T010→T011)** depends on T005 and T007.
- **Polish** after all stories; T014 last.
- Every e2e task edits `apps/web/e2e/sesion.spec.ts`, so they run in sequence.

## Parallel opportunities

- T001 (unit test file) ∥ T003 (e2e file).
- T013 (review) ∥ T012.

## Implementation strategy

1. **MVP**: Phase 2 + US1 (T001–T006) fixes the reported trap.
2. Add US3 guards (T007–T009) in the same PR: US1 without them risks permission loops going unnoticed.
3. Add US2 tests (T010–T011) and polish (T012–T015).
4. One PR, Conventional Commit `fix(web): un 403 de la plataforma por token caducado vuelve al inicio de sesión`.

---

## Phase 7: Convergence

- [X] T016 In `apps/web/e2e/sesion.spec.ts`, extend the test «403 de la propia API: es un permiso denegado, no una
  sesión caducada» to assert that the receptions screen shows its error message («No se han podido cargar las
  recepciones.», from `apps/web/src/paginas/recepciones-tabla.tsx`), proving the API's 403 surfaces as an ordinary
  error to the user; today the test only checks that no notice, renewal or sign-in happens, per FR-003 / SC-003 /
  US3/AC1 (partial)
