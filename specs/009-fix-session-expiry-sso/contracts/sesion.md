# Contract: session handling (web client ↔ platform authentication)

The web app does not expose new endpoints. This contract fixes what the client relies on from the platform's
built-in authentication (Azure Container Apps, Entra ID provider, token store on) and from the existing API, and
what the user sees in each session state.

## Platform endpoints used by the client

| Call | When | Expected | Client reaction |
|------|------|----------|-----------------|
| `GET /.auth/me` | Building request headers in `entra` mode | 200 JSON `[{ id_token, … }]` → send `Authorization: Bearer <id_token>`. 200 non-JSON (no token store) → send no header, rely on `X-MS-CLIENT-PRINCIPAL`. 401 → not signed in. | 401 → session-lost path |
| `GET /.auth/refresh` | First 401 of a burst (not once `caducada`) | 200 → tokens renewed. Any other status → refresh failed. | ok → re-read `/.auth/me`, retry once; fail → redirect / sign-in page / dialog |
| `GET /.auth/login/aad?post_login_redirect_uri=<rutaRetorno>` | Automatic or user-initiated sign-in | Browser navigation to Microsoft and back to `<rutaRetorno>` | — |
| `GET /.auth/logout?post_logout_redirect_uri=/` | "Cerrar sesión" (after writing `mmx.sesionCerrada = '1'`) | Session cleared, back to `/` | Flag set → sign-in page, no auto-redirect, on every reload and tab until the user signs in |

## Request header added to every API call

- `X-Requested-With: XMLHttpRequest` — makes the platform answer **401** instead of **302 to the login page** for
  unauthenticated API calls. (Fallback if not honoured: `fetch(..., { redirect: 'manual' })` and treat
  `opaqueredirect` as 401 — see research R4.)

## Existing API behaviour relied on (unchanged)

- Any `/api/*` route other than the public ones answers **401** with `{ error: { code: 'NO_AUTORIZADO' } }` when the
  token is missing, invalid or expired (`apps/api/src/plugins/auth.ts`, `plugins/errores.ts`).
- `GET /api/me` returns `{ id, nombre, roles: Rol[], mfa }`; `roles` may be empty.
- Public routes (`/api/config/publica`, `/api/health`, `/api/movil/m/*`, …) never trigger the session-lost path.
- A network error, a 5xx, or no answer within 15 s on the session check is "server unreachable" (`conectando`),
  never "not signed in".

## Screen per state (UI contract)

| State | Header & menu | Content | Primary action |
|-------|---------------|---------|----------------|
| `conectando` | hidden | "Conectando con el servidor…" (retrying) | — |
| `comprobando` / `redirigiendo` | hidden | "Iniciando sesión…" | — |
| `sin-sesion` | hidden | "Tu sesión ha terminado. Vuelve a entrar con tu cuenta de trabajo de Microsoft." (dev mode: "No se ha podido iniciar sesión.") | **Iniciar sesión con Microsoft** (dev mode: **Reintentar**) |
| `sin-acceso` | hidden | "Tu cuenta no tiene acceso a esta aplicación. Pide a Administración que te asigne un rol." | **Cerrar sesión** |
| `activa` | shown | Routed page | — |
| `caducada` | shown, inert behind dialog | Dialog: "Tu sesión ha caducado. Los cambios sin guardar de esta pantalla se pueden perder." | **Volver a iniciar sesión** |

Accessibility: the bare page has an `h1`; the dialog uses the existing focus-trap pattern (`useFocusTrap`), is
`role="alertdialog"`, and takes initial focus on its button.
