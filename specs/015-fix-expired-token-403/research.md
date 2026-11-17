# Research: 015 — expired token answered with 403

## R1. Where the 403 is lost today

- **Finding**: `apps/web/src/lib/api.ts` decides "session rejected" with
  `rechazada = status === 401 || type === 'opaqueredirect'`. A 403 is not rejected, so it is parsed as an ordinary
  API error (`ApiError(403, 'ERROR_INTERNO')` when the body is not the API's JSON). `ProveedorAuth`
  (`apps/web/src/lib/auth.tsx`) only maps `ApiError.status === 401` to `sesionPerdida`; anything else goes to
  `sinServidor()`, which retries forever on "Conectando…".
- **Consequence**: on startup (`/api/config/publica`) and on `/api/me` a platform 403 traps the user; during use,
  a platform 403 skips the silent renewal and surfaces a generic error.

## R2. How to tell a platform 403 from the API's own 403

- **Decision**: a 403 is a platform rejection **unless its body is the API's error envelope**
  (`{ "error": { "code": "<string>" } }`).
- **Rationale**: every API error goes through `apps/api/src/plugins/errores.ts`, which always replies with that JSON
  envelope (`PROHIBIDO`, `ASISTENTE_CONVERSACION_AJENA`, `MODO_RETROSPECTIVO_DESHABILITADO`,
  `ALTA_MANUAL_DESHABILITADA` are the 403 codes). The platform sign-in (Container Apps built-in auth) never produces
  that envelope: its 403 is an HTML page or an empty body.
- **Alternatives considered**:
  - *Any 403 = session lost*: rejected, it would turn real permission errors into sign-in loops (spec story 3).
  - *Only non-JSON 403s*: rejected as less robust; checking for `error.code` also covers a JSON body from the
    platform and needs the body anyway.
  - *Route-specific (only `/api/config/publica`)*: rejected, `/api/me` and in-use requests hit the same 403.
  - *Change platform config so it answers 401* (e.g. exclude `/api/config/publica` from platform auth): rejected,
    spec 009's clarification keeps that address protected and this feature does not change infrastructure.

## R3. Where to put the fix

- **Decision**: normalise in `api.ts`. A platform rejection (401, platform 403, or manual redirect) follows the
  existing renew-and-retry path and, if still rejected, is thrown as `ApiError(401, 'NO_AUTORIZADO')`.
- **Rationale**: `auth.tsx` already treats `ApiError(401)` as "not signed in" with the once-per-minute limit and
  the "after sign-out" rule. Normalising at the single fetch wrapper means `auth.tsx`, react-query handling and
  the session-expired notice stay unchanged — one place, one path (FR-001, FR-002, FR-004).
- **Classification as a pure function** in `apps/web/src/lib/sesion.ts` (next to `puedeRedirigir`) so it is
  covered by an `it.each` table without a browser.
- **Body reading**: the classifier needs the body of a 403. Use `res.clone()` so the normal error path can still
  read it when the 403 is the API's own.

## R4. Paired mobile page

- **Finding**: `apps/web/src/paginas/movil.tsx` reads `/api/config/publica` with a raw `fetch` and
  `.catch(() => {})`. An HTML 403 makes `r.json()` throw, the catch swallows it and the demo flag stays off.
- **Decision**: no code change; FR-006 is already met. Cover it in the quickstart check only.

## R5. Residual risk

- If the platform answers 403 for a reason other than expiry (e.g. a principal not allowed by the auth config),
  the user is sent to Microsoft at most once per minute and otherwise sees the sign-in page — no loop, no trap.
- The exact body/content type of the platform's 403 in the deployed environment was not captured; the decision in
  R2 does not depend on it.
