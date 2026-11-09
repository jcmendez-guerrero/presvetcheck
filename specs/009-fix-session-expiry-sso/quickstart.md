# Quickstart: validate the expired-session fix

## 1. Automated checks (local, no Azure)

```bash
pnpm lint && pnpm typecheck && pnpm test
```

- `apps/web/src/lib/sesion.test.ts` — table cases for `rutaRetorno` (deep link with query/hash, `//evil.com`,
  `/\evil`, `/.auth/login`, empty) and `puedeRedirigir` (no previous attempt, inside/outside 60 s, signed out by
  user).

```bash
pnpm --filter @mmx/web test:e2e -- sesion.spec.ts
```

`apps/web/e2e/sesion.spec.ts` mocks `/api/config/publica` with `authMode: 'entra'` and the `/.auth/*` endpoints
with `page.route`. Expected outcomes:

| Scenario | Mocks | Expected |
|----------|-------|----------|
| Expired reload, refresh works | `/api/me` 401 then 200; `/.auth/refresh` 200 | App shown on the requested path; no navigation to `/.auth/login` |
| Expired reload, refresh fails | `/api/me` 401; `/.auth/refresh` 401 | Navigation to `/.auth/login/aad?post_login_redirect_uri=%2Frecetas%3Fx%3D1` |
| Loop guard | as above + `mmx.reintentoLogin` = now | Sign-in page with "Iniciar sesión con Microsoft"; no header or menu |
| After sign-out | `mmx.sesionCerrada = '1'`, `/api/me` 401; reload twice | Sign-in page each time; no login navigation; a second tab too |
| Server down | `/api/me` aborted (network error), then 503, then 200 | "Conectando con el servidor…", no login navigation; app shown once 200 |
| Session check hangs | `/api/me` never answered; clock moved 16 s | "Conectando con el servidor…", not "Iniciando sesión…" |
| Several tabs | refresh fails; tab A redirects, then tab B opens | Tab B shows the sign-in page (loop guard shared) |
| `/movil` | `authMode: 'entra'`, open `/movil` | No `/.auth/*` request; no "Iniciando sesión…" |
| No roles | `/api/me` 200 `roles: []` | "no tiene acceso" page; no menu |
| Mid-session expiry | app `activa`, then any API call 401 and refresh 401 | Dialog with unsaved-changes warning; button navigates to login; `/.auth/refresh` called once |
| Dev mode | `authMode: 'dev'` | Unchanged; no `/.auth/*` calls (existing `humo.spec.ts`) |

## 2. Manual check in non-production (Entra)

Prerequisites: access to the non-production app and its internal Confluence page (real host names are not in the
repository).

- **N1 — 401 instead of 302**: with an expired platform session, in DevTools → Network, an `/api/me` call carries
  `X-Requested-With` and returns **401** (not 302 to `login.microsoftonline.com`). If it is a 302, switch to the
  `redirect: 'manual'` fallback (research R4).
- **N2 — Reload next morning** (or after revoking sessions for the test user in Entra): reload `/recepciones` →
  lands on `/recepciones` signed in, either silently or after Microsoft sign-in; never stuck on "Iniciando sesión…".
- **N3 — Refresh token**: after > 1 h idle with the platform session still valid, the next action succeeds without
  a page navigation (requires `offline_access` in login parameters; if not configured, a quick redirect is accepted).
- **N4 — Sign-out**: "Cerrar sesión" → sign-in page; reload twice → still the sign-in page; pressing the button
  signs in and returns to `/`.
- **N5 — `/movil`**: pairing a phone still works without Microsoft sign-in.
