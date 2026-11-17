# Contract: platform rejection vs API permission error

Internal contract between the API (`apps/api`) and the web client (`apps/web/src/lib/api.ts`). No endpoint changes.

## API side (already true, must stay true)

Every error the API itself returns, including every 403, has a JSON body:

```json
{ "error": { "code": "PROHIBIDO", "mensaje": "…", "detalles": null } }
```

`code` is a non-empty string. Breaking this would make the client mistake an API 403 for an expired session.

## Client side (new)

`esRechazoDePlataforma(status: number, cuerpo: unknown): boolean` — pure, in `apps/web/src/lib/sesion.ts`.

| `status` | `cuerpo`                                   | Result  |
|----------|--------------------------------------------|---------|
| 401      | anything                                   | `true`  |
| 403      | `null`, string (HTML/text), `{}`, `{ error: {} }`, `{ error: { code: "" } }` | `true`  |
| 403      | `{ error: { code: "PROHIBIDO" } }`         | `false` |
| any other| anything                                   | `false` |

`api()` treats `opaqueredirect` or `esRechazoDePlataforma(...) === true` as a rejected session: it calls the
configured renew handler once, repeats the request, and if still rejected throws `ApiError(401, 'NO_AUTORIZADO')`.
