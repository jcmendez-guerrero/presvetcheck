# Data model: 015 — expired token answered with 403

No stored data, migrations or schemas change. The only "model" is how the web client classifies an HTTP answer.

## Answer classification (web client)

| Answer received                                          | Class                 | Client behaviour (existing path)                      |
|----------------------------------------------------------|-----------------------|-------------------------------------------------------|
| 401 (any body)                                           | platform rejection    | renew once → retry → else `ApiError(401)`             |
| Manual redirect (`opaqueredirect`)                        | platform rejection    | same as above                                         |
| 403 whose body has no `error.code` (HTML, empty, other)  | platform rejection    | same as above (**new**)                               |
| 403 with `{ "error": { "code": "…" } }`                  | API permission error  | `ApiError(403, code)` → permission message (unchanged)|
| 5xx, network failure, time-out                           | server not available  | retry with back-off, never sign-in (unchanged)        |
| Other 2xx/4xx                                            | normal                | unchanged                                             |

## Session states (`EstadoSesion`, unchanged)

`conectando → comprobando → activa | sin-acceso | redirigiendo | sin-sesion`, and `activa → caducada`.
A platform 403 now reaches `redirigiendo`/`sin-sesion` on startup and `caducada` during use, exactly like a 401.
