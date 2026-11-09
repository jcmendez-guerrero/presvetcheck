---

description: "Task list for 009-fix-session-expiry-sso"
---

# Tasks: Expired session always returns to Microsoft sign-in

**Input**: Design documents from `specs/009-fix-session-expiry-sso/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/sesion.md](contracts/sesion.md), [quickstart.md](quickstart.md)

**Tests**: Included. The constitution (II) requires `pnpm lint && pnpm typecheck && pnpm test` green, and the plan and
quickstart define unit and Playwright cases. No real Entra/Azure calls: Playwright fakes `/api/config/publica`,
`/.auth/*` and `/api/me` with `page.route` (the e2e web server runs the real API with `AUTH_MODE=dev`).

**Organization**: Tasks are grouped by user story. All paths are relative to the repository root; every change is
in `apps/web`. UI copy in European Spanish; generic identifiers in English where they have no domain meaning.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 from spec.md

---

## Phase 1: Setup

**Purpose**: Nothing to install; confirm the baseline is green so later failures belong to this feature.

- [X] T001 Run `pnpm lint && pnpm typecheck && pnpm test` at the repository root and record that it passes before any change (no file edits)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Pure helpers, the session-state type and the API-client hooks that all three stories use.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Create `apps/web/src/lib/sesion.ts` with pure, clock-free helpers (see data-model.md "Validation rules"):
  `export type EstadoSesion = 'conectando' | 'comprobando' | 'activa' | 'sin-acceso' | 'redirigiendo' | 'sin-sesion' | 'caducada'`;
  `export const VENTANA_REINTENTO_MS = 60_000`; `export const LIMITE_COMPROBACION_MS = 15_000`;
  `export const CLAVE_REINTENTO = 'mmx.reintentoLogin'`; `export const CLAVE_CERRADA = 'mmx.sesionCerrada'`;
  `rutaRetorno(pathname: string, search: string, hash: string): string` — joins the parts and returns `/` unless the
  result starts with a single `/` and does not start with `//`, `/\` or `/.auth/`;
  `puedeRedirigir(ahora: number, ultimoIntento: number | null, cerradaPorUsuario: boolean): boolean` — `false` when
  `cerradaPorUsuario`, otherwise `ultimoIntento === null || ahora - ultimoIntento > VENTANA_REINTENTO_MS`;
  `urlLogin(retorno: string): string` → `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(retorno)}`;
  `urlLogout(): string` → `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent('/')}`.
  Comments in Spanish.
- [X] T003 [P] Create `apps/web/src/lib/sesion.test.ts` (Vitest, `it.each` tables) covering: `rutaRetorno` keeps
  `/recetas/abc/revision?x=1#l2` intact; returns `/` for `//evil.com`, `/\evil.com`, `https://evil.com`,
  `/.auth/login/aad`, empty string. `puedeRedirigir`: `null` last attempt → true; 59 999 ms → false; 60 001 ms → true;
  signed out by user (with `null` and with an old attempt) → false. `urlLogin('/recetas?x=1')` encodes to
  `post_login_redirect_uri=%2Frecetas%3Fx%3D1`; `urlLogout()` ends with `post_logout_redirect_uri=%2F`.
- [X] T004 Update `apps/web/src/lib/api.ts`: (a) add `'X-Requested-With': 'XMLHttpRequest'` to the headers of every
  `fetch` in `api()` (research R4, so the platform answers 401 instead of a 302 to Microsoft); (b) add a module-level
  handler `let alNoAutorizado: (() => Promise<boolean>) | null = null` with
  `export function configurarNoAutorizado(f: (() => Promise<boolean>) | null)`; (c) in `api()`, when
  `res.status === 401`, the URL is not `/api/config/publica`, and a handler is set, `await` it once: if it resolves
  `true`, retry the same request once (rebuilding headers via `cabeceras()`), otherwise fall through and throw the
  usual `ApiError`. Never retry more than once per call. Add a one-line Spanish comment that retrying is safe for
  writes because the API rejects a 401 request before doing anything. Keep `ApiError` and `descargar` unchanged.

**Checkpoint**: `pnpm --filter @mmx/web test` passes with the new helper tests; app behaviour unchanged (no handler set yet).

---

## Phase 3: User Story 1 — Reload with an expired session goes back to sign-in (Priority: P1) 🎯 MVP

**Goal**: A reload with an expired/revoked session ends signed in on the requested screen (silently via refresh, or
via Microsoft sign-in), never on "Iniciando sesión…", and no menu or data is shown before the session is active.

**Independent Test**: quickstart.md rows "Expired reload, refresh works" and "Expired reload, refresh fails"; plus
"no header/menu while not signed in".

### Tests for User Story 1

- [X] T005 [P] [US1] Create `apps/web/e2e/sesion.spec.ts` with a helper `modoEntra(page, opciones)` that uses
  `page.route` to: answer `/api/config/publica` with the real response patched to `authMode: 'entra'` (fetch it with
  `route.fetch()` and override the field); answer `/.auth/me` with `200 [{ "id_token": "t1" }]` (JSON); answer
  `/.auth/refresh` with a configurable status; answer `/api/me` with a configurable sequence of responses (e.g. first
  401 `{ error: { code: 'NO_AUTORIZADO' } }`, then 200 `{ id: 'u1', nombre: 'Prueba', roles: ['empleado'], mfa: false }`;
  a sequence item may also be `'abort'` (network error) or `'pendiente'` (never fulfilled)); and intercept
  `/.auth/login/aad**` to fulfil a tiny HTML page while recording the requested URL. Add tests:
  (1) refresh works → after `page.goto('/recepciones')` the heading `Recepción de mercancía` (`getByRole('heading')`)
  is visible, the login route was never hit, and `/api/me` was called with `X-Requested-With: XMLHttpRequest`;
  (2) refresh fails (`/.auth/refresh` 401, `/api/me` always 401) → `page.goto('/recetas/nueva?x=1')` ends on the
  login route with `post_login_redirect_uri=%2Frecetas%2Fnueva%3Fx%3D1`;
  (3) while `/api/me` is `'pendiente'` the page shows "Iniciando sesión…" and no element with `role="navigation"`
  and no Topbar "Cerrar sesión" button is present.

### Implementation for User Story 1

- [X] T006 [US1] In `apps/web/src/lib/auth.tsx`, add the session state and classify the session check (data-model.md
  "Transitions"): add `estado: EstadoSesion` (from `./sesion`) to the context (`Ctx`) and keep a mirror in a
  `useRef` (`estadoRef`) for handlers; keep `config`, `usuario`, `tiene` and the dev selectors unchanged for existing
  consumers. Initial `conectando`; after config loads → `comprobando`. In `entra` mode keep the `/.auth/me` header
  builder but remove its `window.location.href` navigation: when `/.auth/me` is not ok it returns `{}` so the API
  answers 401. Bound the whole check (`/.auth/me` + `/api/me` including the retry) with `LIMITE_COMPROBACION_MS`
  (e.g. `Promise.race` with a timer that is cleared afterwards). Classify the outcome:
  user with ≥1 role → `activa` and `localStorage.removeItem` of `CLAVE_REINTENTO` and `CLAVE_CERRADA`;
  user with `roles: []` → `sin-acceso`;
  `ApiError` with status 401, or a 200 that is not a user (`esUsuario` false) → call `sesionPerdida()` (T008);
  anything else — `TypeError` (network), `ApiError` with status ≥ 500, or the time limit — → `conectando` and
  schedule the check again with the existing backoff (1 s doubling to 5 s, as the config loader does). A network
  error MUST NOT lead to a sign-in redirect (research R2). In `dev` mode `sesionPerdida()` simply sets `sin-sesion`.
  No `console` call that prints the user, e-mail or token (FR-012).
- [X] T007 [US1] In `apps/web/src/lib/auth.tsx`, add the refresh handler for `entra` mode: `refrescar()` keeps one
  shared in-flight promise (cleared when it settles) that calls
  `fetch('/.auth/refresh', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })` and resolves `r.ok` (`false` on
  any error). Register `configurarNoAutorizado(refrescar)` once config is `entra`; in `dev` mode call
  `configurarNoAutorizado(null)`. Result: `api()` retries the failed `/api/me` once after a successful refresh.
- [X] T008 [US1] In `apps/web/src/lib/auth.tsx`, implement `sesionPerdida()` for `entra` mode (redirect + loop guard):
  `const cerrada = leer(CLAVE_CERRADA) === '1'`; `const ultimo = Number(leer(CLAVE_REINTENTO)) || null`;
  if `puedeRedirigir(Date.now(), ultimo, cerrada)` → `escribir(CLAVE_REINTENTO, String(Date.now()))`, set
  `redirigiendo`, `window.location.href = urlLogin(rutaRetorno(location.pathname, location.search, location.hash))`;
  else set `sin-sesion`. Replace the old `REINTENTO_LOGIN` constant and the inline login URLs with the `./sesion`
  helpers.
- [X] T009 [US1] Create `apps/web/src/componentes/pagina-acceso.tsx`: a bare full-height page (logo
  `/logo-horizontal.png`, an `h1`, message, optional primary button) using existing Tailwind tokens (`bg-fondo`,
  `text-texto`) and the house `Boton` component (`variante="principal"`) and `Cargando` from
  `apps/web/src/componentes/ui.tsx`. Props: `estado: EstadoSesion`. Copy per contracts/sesion.md "Screen per state":
  `conectando` → "Conectando con el servidor…"; `comprobando`/`redirigiendo` → "Iniciando sesión…" (with
  `aria-live="polite"`). Leave `sin-sesion` and `sin-acceso` branches as placeholders completed by US2 (render the
  message text only for now).
- [X] T010 [US1] Update `apps/web/src/componentes/layout.tsx`: read `estado` from `useAuth()`. When
  `estado !== 'activa' && estado !== 'caducada'`, return `<PaginaAcceso estado={estado} />` only — no `Topbar`,
  sidebar, demo banner, `AvisosMovil`, or `ProveedorMovil` children. Otherwise render the current layout unchanged;
  remove the old `usuario ? … : 'Iniciando sesión…'` branch inside `<main>` (the `<Outlet />` is now always rendered
  when active).
- [X] T011 [US1] Run `pnpm --filter @mmx/web test` and `pnpm --filter @mmx/web test:e2e -- sesion.spec.ts humo.spec.ts`
  and fix failures; the existing dev-mode smoke test (`humo.spec.ts`) must still pass unchanged.

**Checkpoint**: US1 delivers the reported fix on its own (MVP).

---

## Phase 4: User Story 2 — Sign-in page when automatic redirection cannot complete (Priority: P2)

**Goal**: When a redirect is not allowed (loop guard or after sign-out) the user sees a Spanish sign-in page with
"Iniciar sesión con Microsoft"; accounts without roles see a "sin acceso" page; server down or slow still shows
"Conectando con el servidor…".

**Independent Test**: quickstart.md rows "Loop guard", "After sign-out", "No roles", "Server down", "Session check
hangs", "Several tabs".

### Tests for User Story 2

- [X] T012 [P] [US2] Add tests to `apps/web/e2e/sesion.spec.ts`:
  (1) loop guard — before navigation set `localStorage['mmx.reintentoLogin'] = String(Date.now())` via
  `page.addInitScript`, `/api/me` and `/.auth/refresh` 401 → heading "Tu sesión ha terminado" and button "Iniciar
  sesión con Microsoft" visible, login route not hit; clicking the button navigates to the login route with the
  current path as `post_login_redirect_uri`;
  (2) after sign-out — set `localStorage['mmx.sesionCerrada'] = '1'` via `page.addInitScript`, `/api/me` and
  `/.auth/refresh` 401 → sign-in page shown and login route not hit; `page.reload()` twice → still the sign-in page;
  a second page in the same context opened on `/` → also the sign-in page;
  (3) no roles — `/api/me` 200 with `roles: []` → text "no tiene acceso" and a "Cerrar sesión" button visible, no
  navigation menu;
  (4) server down — `/api/me` sequence `'abort'`, then 503, then 200 user → "Conectando con el servidor…" is shown,
  the login route is never hit, and the reception heading appears once the 200 arrives;
  (5) session check hangs — `page.clock.install()` before `goto`, `/api/me` `'pendiente'`, then
  `page.clock.fastForward(16_000)` → "Conectando con el servidor…" visible and "Iniciando sesión…" gone;
  (6) several tabs — refresh fails and `/api/me` always 401; page A `goto('/')` hits the login route; then page B in
  the same context `goto('/')` → sign-in page, and the login route was hit exactly once in total.

### Implementation for User Story 2

- [X] T013 [US2] In `apps/web/src/componentes/pagina-acceso.tsx` complete the `sin-sesion` branch: in `entra` mode
  `h1` "Tu sesión ha terminado", text "Vuelve a entrar con tu cuenta de trabajo de Microsoft.", primary button
  "Iniciar sesión con Microsoft" that calls `iniciarSesion()` from `useAuth()`; in `dev` mode (`config.authMode`)
  `h1` "No se ha podido iniciar sesión" and a "Reintentar" button that calls `location.reload()`. Complete the
  `sin-acceso` branch: `h1` "Sin acceso", text "Tu cuenta no tiene acceso a esta aplicación. Pide a Administración que
  te asigne un rol.", button "Cerrar sesión" that calls `cerrarSesion()` from `useAuth()`. Initial focus on the
  primary button.
- [X] T014 [US2] In `apps/web/src/lib/auth.tsx` expose in the context:
  `iniciarSesion(): void` — user-initiated, ignores the loop guard, removes `CLAVE_CERRADA`, writes
  `CLAVE_REINTENTO`, sets `redirigiendo` and navigates to
  `urlLogin(rutaRetorno(location.pathname, location.search, location.hash))`;
  `cerrarSesion(): void` — in `entra` mode writes `CLAVE_CERRADA = '1'` then navigates to `urlLogout()`; in `dev`
  mode keeps the current dev behaviour of `topbar.tsx` `salir()`.
- [X] T015 [US2] Update `apps/web/src/componentes/topbar.tsx` `salir()` to call `cerrarSesion()` from `useAuth()`
  instead of building the inline `/.auth/logout?post_logout_redirect_uri=/` string.

**Checkpoint**: US1 + US2 work; no state can leave the user without a way forward.

---

## Phase 5: User Story 3 — Session that expires while working (Priority: P3)

**Goal**: A 401 during use (after a failed refresh) shows a blocking dialog warning about unsaved changes, with a
single "Volver a iniciar sesión" button (FR-007).

**Independent Test**: quickstart.md row "Mid-session expiry".

### Tests for User Story 3

- [X] T016 [P] [US3] Add tests to `apps/web/e2e/sesion.spec.ts`: start `activa` (`/api/me` 200 with role
  `empleado`) on `/recepciones`; then switch the route mocks so every other `/api/**` call and `/.auth/refresh` answer
  401; trigger a data request (navigate via the sidebar link "Registros"); expect a `role="alertdialog"` containing
  "Tu sesión ha caducado" and "Los cambios sin guardar", focus on the button "Volver a iniciar sesión", and
  `/.auth/refresh` called exactly once despite the query retry; clicking the button navigates to the login route
  with `post_login_redirect_uri=%2Fregistros`. Add a second test where refresh answers 200 on the mid-session 401
  and the retried request succeeds: no dialog appears.

### Implementation for User Story 3

- [X] T017 [US3] In `apps/web/src/lib/auth.tsx`, wrap the registered `configurarNoAutorizado` handler so that:
  if `estadoRef.current === 'caducada'` it resolves `false` at once without calling `refrescar()` (TanStack Query
  `retry: 1` would otherwise trigger a second refresh); if `estadoRef.current === 'activa'` and `refrescar()`
  resolves `false`, it sets `estado` to `caducada` (no redirect) and resolves `false`; otherwise it returns the
  result of `refrescar()`. Concurrent 401s share the same refresh promise and set the state once.
- [X] T018 [US3] Create the dialog in `apps/web/src/componentes/sesion-caducada.tsx`: `role="alertdialog"`,
  `aria-modal="true"`, labelled by its heading "Tu sesión ha caducado", body "Los cambios sin guardar de esta pantalla
  se pueden perder.", single button "Volver a iniciar sesión" calling `iniciarSesion()`. Use `useFocusTrap` from
  `apps/web/src/lib/a11y.ts` the same way existing dialogs do, initial focus on the button, Escape does nothing.
  Render it from `apps/web/src/componentes/layout.tsx` when `estado === 'caducada'`, on top of the current layout.

**Checkpoint**: all three stories independently functional.

---

## Phase 6: Polish & cross-cutting

- [X] T019 [P] Add a Spanish comment block at the top of `apps/web/src/lib/auth.tsx` replacing the old one, summarising
  why the client must detect lost sessions (service worker serves the shell; expired `id_token`; 302 vs 401; network
  errors mean "server unreachable", not "signed out") and pointing to `specs/009-fix-session-expiry-sso/research.md`.
- [X] T020 [P] Check `docs/glosario.md` and add no entry unless a new domain term was introduced (none expected; the
  terms are generic) — document the decision in the PR description instead.
- [X] T021 [P] Add a test to `apps/web/e2e/sesion.spec.ts` for FR-011: with `modoEntra` mocks, `page.goto('/movil')`
  makes no request to `/.auth/**` (record with `page.on('request')`) and never shows "Iniciando sesión…".
- [X] T022 Grep `apps/web/src` for any remaining `'/.auth/login/aad'` or `'/.auth/logout'` literal outside
  `apps/web/src/lib/sesion.ts` and route them through `urlLogin`/`urlLogout`. Then check FR-012:
  `grep -nE "console\.(log|info|warn|error|debug)" apps/web/src/lib/sesion.ts apps/web/src/lib/auth.tsx apps/web/src/lib/api.ts apps/web/src/componentes/pagina-acceso.tsx apps/web/src/componentes/sesion-caducada.tsx`
  returns no line that prints a user, e-mail or token (none expected at all).
- [X] T023 Run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm --filter @mmx/web test:e2e` at the repository
  root; all green.
- [ ] T024 Manual non-production checks N1–N5 from `specs/009-fix-session-expiry-sso/quickstart.md` (after deploy;
  real hosts only in Confluence). If N1 shows a 302 instead of 401, apply the `redirect: 'manual'` fallback from
  research R4 in `apps/web/src/lib/api.ts`. SC-002 (under 10 s when Microsoft still recognises the user) is checked
  here only; it cannot be automated without real Microsoft sign-in.

---

## Dependencies & execution order

- **Phase 1 → Phase 2 → US1 → US2 → US3 → Polish.**
- Within US1: T006 → T007 → T008 (same file, in order); T009 and T010 after T006 (they read `estado`).
- US2 and US3 both edit `auth.tsx` and `pagina-acceso.tsx`/`layout.tsx`, built in US1, so they follow US1 and run in
  sequence (same files), not in parallel.
- Within Phase 2: T002 and T003 in parallel; T004 independent of both (different file) and can run alongside.
- Test tasks marked [P] (T005, T012, T016, T021) touch only `e2e/sesion.spec.ts` and can be written before their
  implementation tasks; they are expected to fail until the story is implemented. Two of them must not be edited at
  the same time (same file).

## Parallel examples

```text
# Phase 2
T002 apps/web/src/lib/sesion.ts
T003 apps/web/src/lib/sesion.test.ts
T004 apps/web/src/lib/api.ts

# US1
T005 apps/web/e2e/sesion.spec.ts   (alongside T006–T010)

# Polish
T019 apps/web/src/lib/auth.tsx comment
T020 docs/glosario.md check
T021 apps/web/e2e/sesion.spec.ts /movil test
```

## Implementation strategy

1. **MVP = Phase 1 + Phase 2 + US1 (T001–T011)**: fixes the reported stuck "Iniciando sesión…" and hides the app
   shell while signed out. Shippable on its own.
2. **US2 (T012–T015)**: safety net — sign-in page, no-access page, sign-out that sticks, server-down handling.
3. **US3 (T016–T018)**: mid-session warning dialog.
4. **Polish (T019–T024)**: docs, `/movil` check, consistency, full gates, non-production verification.

One PR for the whole feature (Constitution IV: one scoped change), Conventional Commit `fix(web): …`.

---

## Phase 7: Convergence

**Source**: ponytail review of commit `392825b` (findings 1–4).

- [X] T025 In `apps/web/src/lib/api.ts` `pedir()`, add `redirect: 'manual'` to the `fetch` options and treat a response with `res.type === 'opaqueredirect'` exactly like a 401 (handler call, retry, then `ApiError(401, 'NO_AUTORIZADO', …)`), so a platform 302 to Microsoft ends in the sign-in path instead of a network error shown as "Conectando con el servidor…" forever; update research R4 to say the fallback is now built in and N1 only confirms it; add an e2e case to `apps/web/e2e/sesion.spec.ts` where `/api/me` answers `302` with `Location: https://login.example.test/` and refresh fails → the login route is hit with the return address per FR-001, FR-002, research R4 (partial)
- [X] T026 In `apps/web/src/lib/api.ts`, when the retried request after a successful refresh is still 401, call the handler a second time with a flag (`alNoAutorizado(true)`, handler type `(reintento: boolean) => Promise<boolean>`); in `apps/web/src/lib/auth.tsx` the handler, when `reintento` is true, sets `caducada` if the state is `activa` and resolves `false` without calling `/.auth/refresh`; add an e2e case to `apps/web/e2e/sesion.spec.ts`: app active, then `/.auth/refresh` 200 but every API-client `/api/**` call keeps answering 401 → the "Tu sesión ha caducado" dialog appears per FR-007, US3/AC1 (partial)
- [X] T027 Remove the dead `url !== '/api/config/publica'` condition from the 401 branch in `apps/web/src/lib/api.ts` (the config is loaded before the handler is registered and `/movil` uses its own `fetch`) per plan: api.ts touch-point (unrequested)
- [X] T028 In `apps/web/src/lib/auth.tsx`, merge the config loader's retry loop into the session-check effect so one backoff (1 s doubling to 5 s, `esperaRef`/`intento`) serves both "config not loaded" and "session check unreachable"; keep `conectando` until the config answers and keep the existing comment about slow API start per research R2 "existing backoff" (partial)
