# Research: Expired session always returns to Microsoft sign-in

All findings come from reading the current code (`apps/web/src/lib/auth.tsx`, `apps/web/src/lib/api.ts`,
`apps/web/src/componentes/layout.tsx`, `apps/web/vite.config.ts`, `apps/api/src/plugins/auth.ts`,
`infra/np/main.bicep`). No real Entra or Azure service was called.

## R1. Why a reload does not reach Microsoft sign-in

- **Decision**: Treat the client as the only place that can detect a lost session on reload; do not rely on the
  platform's `RedirectToLoginPage`.
- **Rationale**: `vite-plugin-pwa` precaches `index.html` and serves it for every navigation except `/api/*` and
  `/.auth/*` (`navigateFallbackDenylist`). A reload is answered by the service worker, so the platform's
  authentication never sees the request and never redirects. The app shell boots, and only then talks to the server.
- **Alternatives considered**:
  - *Exclude `index.html` from the service worker / disable navigate fallback*: fixes reloads but loses offline start
    and the PWA install experience the staff use; still leaves the mid-session case unsolved.
  - *Unregister the service worker on 401*: heavy-handed and racy.

## R2. Why the app stays on "Iniciando sesión…"

- **Decision**: Every 401 from the API (and a 200 that is not a user) is "session lost" and goes through one
  handler. A network error (`TypeError`), a 5xx, or a session check with no answer after 15 s is "server
  unreachable": state `conectando`, retried with the existing backoff (1 s doubling to 5 s). It never triggers a
  sign-in redirect, because a redirect to a server that is down fails too and hides the real problem (US2-4).
  With `X-Requested-With` (R4) a lost platform session answers 401, so no network error needs to mean "signed out";
  if N1 shows the header is not honoured, the R4 `redirect: 'manual'` fallback turns the 302 into a 401-equivalent,
  still without reinterpreting network errors.
- **Rationale**: In `auth.tsx` the `/api/me` call ends in `.catch(() => setUsuario(null))`. With the token store,
  `/.auth/me` can return 200 with an `id_token` that has already expired (the platform session cookie lasts longer
  than the 1 h token), so the API answers 401 `NO_AUTORIZADO`, the promise rejects, and the user is cleared with no
  redirect. `layout.tsx` then shows "Iniciando sesión…" forever because `config` is set and `usuario` is null.
  The existing redirect (non-user 200 body, guarded to once per minute) is skipped entirely on a rejection, and
  within the minute window there is no fallback screen either.
- **Timeout**: the session check (`/.auth/me` + `/api/me`, including one refresh) is bounded by 15 s
  (`LIMITE_COMPROBACION_MS`) so "Iniciando sesión…" cannot hang on a request that never answers (FR-006).
- **Alternatives considered**: Treating a network error as "signed out" — breaks US2-4 (server down would bounce
  the user to Microsoft). Decoding the `id_token` `exp` client-side before each call — works for one cause
  only, duplicates token logic in the browser; rejected in favour of reacting to 401.

## R3. Refresh before redirect

- **Decision**: On the first 401, call `GET /.auth/refresh` once, re-read `/.auth/me`, and retry the failed request
  once. Only if that fails, start the sign-in redirect.
- **Rationale**: With the token store, the platform can renew tokens silently from the stored refresh token. This
  covers the common case (token expired, platform session still valid) with no visible redirect. Concurrent 401s
  share one in-flight refresh promise so several parallel queries do not trigger several refreshes.
- **Alternatives considered**: Redirect immediately — simpler but causes a full-page round trip every hour.
- **Note**: `/.auth/refresh` requires the `offline_access` scope in the auth config's login parameters to return a
  refresh token. If it is absent, refresh fails and the flow falls through to the redirect, which is still correct.
  Verify the setting in non-production (internal Confluence page; real values are not versioned).

## R4. Platform answering 302 to `fetch`

- **Decision**: Send `X-Requested-With: XMLHttpRequest` on every API call.
- **Rationale**: The built-in authentication (App Service / Container Apps "Easy Auth") answers 401 instead of a 302
  to the login page when the request carries this header. Without it, `fetch` follows the redirect to
  `login.microsoftonline.com`, fails CORS and rejects with a `TypeError`, indistinguishable from "server down".
- **Alternatives considered**: `redirect: 'manual'` on `fetch` — gives an opaque redirect response; works but is
  less explicit than a 401. Kept as the fallback if the header does not behave as documented in Container Apps
  (to confirm in quickstart step N1).

## R5. Loop protection

- **Decision**: Keep the existing `localStorage` key `mmx.reintentoLogin` and the 60 s window. Within the window,
  show the sign-in page instead of redirecting again. Clear the key once a session becomes active.
- **Rationale**: Shared across tabs (several tabs expiring together redirect once); already deployed behaviour;
  no new configuration (Constitution IV).
- **Alternatives considered**: `sessionStorage` (per tab) — allows N redirects for N tabs; rejected.

## R6. Return address

- **Decision**: Use `location.pathname + location.search + location.hash`; accept it only if it starts with a single
  `/` (not `//`, not `/\`), and is not under `/.auth/`; otherwise use `/`. Pass it as `post_login_redirect_uri`.
- **Rationale**: Preserves deep links (FR-009, edge case) and closes an open-redirect vector.

## R7. Screen while not signed in

- **Decision**: `layout.tsx` renders a bare `PaginaAcceso` (logo + message + action) for every state other than
  `activa`; Topbar, sidebar, demo banner and mobile notices are rendered only when `activa`.
- **Rationale**: FR-005: no menus or data before the session is active.

## R8. Sign-out and sign-in page

- **Decision**: Sign-out already exists (`topbar.tsx`, `/.auth/logout`). Before navigating to it, `cerrarSesion()`
  writes the `localStorage` flag `mmx.sesionCerrada = '1'`. While the flag is set, a lost session shows the sign-in
  page instead of redirecting automatically. The flag is cleared only by `iniciarSesion()` (the user presses the
  button) or when a session becomes `activa`. `post_logout_redirect_uri` stays `/`.
- **Rationale**: `/.auth/logout` clears the app session but not the Microsoft one, so an automatic redirect would
  sign the user straight back in. A marker in the address bar would be lost on the next reload and not seen by other
  tabs; a `localStorage` flag survives both (FR-013).
- **Alternatives considered**: `?sesion=cerrada` in the post-logout URL — removed from the URL after one load, so a
  second reload signs the user back in silently; rejected.

## R9. Signed in without roles

- **Decision**: If `/api/me` returns a user with an empty `roles` array, state `sin-acceso`: message "Tu cuenta no
  tiene acceso a esta aplicación. Pide a Administración que te asigne un rol." plus sign-out button.
- **Rationale**: FR-008; the API already filters roles with `Rol.safeParse`, so an account without app roles reaches
  the client as `roles: []`.

## R10. Mid-session expiry warning

- **Decision**: When the session is lost while the app was `activa` (any 401 after refresh failed), show a blocking
  dialog (FR-007) "Tu sesión ha caducado. Los cambios sin guardar de esta pantalla se pueden perder." with a single
  "Volver a iniciar sesión" button, instead of an automatic redirect.
- **Rationale**: Acceptance scenario US3-2 (warn about unsaved changes); an automatic redirect would discard the form
  without warning. On load (no form yet) the redirect stays automatic.
- **Repeat 401s**: TanStack Query retries failed queries once (`retry: 1` in `main.tsx`). Once the state is
  `caducada`, the 401 handler returns `false` at once without calling `/.auth/refresh` again.

## R11. Out of scope / unchanged

- `/movil` is rendered outside `ProveedorAuth` (`main.tsx`) and is excluded from platform auth; untouched.
- `AUTH_MODE=dev`: the 401 handler is only installed in `entra` mode. A 401 or non-user answer in dev mode ends in
  `sin-sesion` with a "Reintentar" button (reload), never in a Microsoft redirect; network errors behave as in
  `entra` mode (`conectando`).
- API (`apps/api`) and infra: no change.
