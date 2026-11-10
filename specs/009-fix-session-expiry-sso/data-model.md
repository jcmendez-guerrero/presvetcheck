# Data Model: client session state

No server data or database change. The only "model" is the session state held by `ProveedorAuth` in the browser,
plus one `localStorage` key.

## EstadoSesion (typed union)

| Value | Meaning | Screen (see [contracts/sesion.md](contracts/sesion.md)) |
|-------|---------|---------|
| `conectando` | Server unreachable: `/api/config/publica` not answered yet, or the session check failed with a network error, a 5xx, or no answer in 15 s. Retries with backoff (existing 1 s → 5 s). | "Conectando con el servidor…" |
| `comprobando` | Config loaded; checking `/.auth/me` + `/api/me` (and at most one refresh). | "Iniciando sesión…" (bounded: always ends in another state) |
| `activa` | `/api/me` returned a user with ≥ 1 role. | Full app (Topbar, menu, routes) |
| `sin-acceso` | `/api/me` returned a user with `roles: []`. | Bare page: no access message + sign-out |
| `redirigiendo` | Automatic sign-in started (`location.href` set). | "Iniciando sesión…" until the browser navigates |
| `sin-sesion` | Not signed in and an automatic redirect is not allowed (loop guard, or the "signed out" flag), or a 401 in dev mode. | Bare sign-in page with "Iniciar sesión con Microsoft" (dev mode: "Reintentar") |
| `caducada` | Session lost while `activa` (401 after refresh failed). | Blocking dialog over the current screen with the unsaved-changes warning |

In `AUTH_MODE=dev` no refresh or redirect happens: `comprobando` ends in `activa`, `sin-acceso`, `sin-sesion` (401 or
non-user) or `conectando` (network/5xx/timeout).

## Transitions

```text
conectando ──config ok──▶ comprobando
comprobando ──/api/me user, roles≥1──▶ activa          (clears mmx.reintentoLogin)
comprobando ──/api/me user, roles=[]──▶ sin-acceso
comprobando ──network error / 5xx / no answer in 15 s──▶ conectando (retry with backoff → comprobando)
comprobando ──401 / non-user──▶ refresh once ──ok──▶ comprobando (retry once)
                                     └─fail─▶ puedeRedirigir? ──yes──▶ redirigiendo
                                                             └─no───▶ sin-sesion
activa ──any API 401──▶ refresh once ──ok──▶ activa (request retried once)
                              └─fail─▶ caducada
caducada ──further 401s──▶ handler returns false at once (no new refresh)
caducada ──"Volver a iniciar sesión"──▶ redirigiendo
sin-sesion ──"Iniciar sesión con Microsoft"──▶ redirigiendo   (button ignores loop guard; user-initiated)
sin-acceso / activa ──"Cerrar sesión"──▶ set mmx.sesionCerrada, /.auth/logout
```

## Validation rules

- **rutaRetorno(pathname, search, hash)**: same-origin path only. Valid if it starts with `/`, not with `//` or
  `/\`, and not with `/.auth/`. Otherwise `/`.
- **puedeRedirigir(ahora, ultimoIntento, cerradaPorUsuario)**: `false` if `cerradaPorUsuario`; `true` if
  `ultimoIntento` is `null`; else `ahora - ultimoIntento > 60_000`. `ahora` is injected (no implicit clock read in
  the helper).
- **Session-check limit**: `LIMITE_COMPROBACION_MS = 15_000`; past it the check counts as "server unreachable".
- **Refresh**: at most one in-flight refresh at a time; each failed request is retried at most once.

## Stored values

| Key | Where | Value | Lifetime |
|-----|-------|-------|----------|
| `mmx.reintentoLogin` | `localStorage` (existing) | epoch ms of last automatic redirect | Cleared on `activa`; otherwise overwritten |
| `mmx.sesionCerrada` | `localStorage` (new) | `'1'` after the user signs out | Cleared by `iniciarSesion()` or on `activa` |

No personal data is stored or logged (no name, e-mail or token).
