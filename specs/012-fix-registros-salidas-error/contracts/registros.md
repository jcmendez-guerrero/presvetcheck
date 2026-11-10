# Contrato: endpoints de registros afectados

El contrato no cambia; el arreglo solo hace que vuelvan a cumplirlo. Todos usan `RegistrosQuery`
(`desde`, `hasta`, `plantilla`, `formato=json|csv|xlsx`, `incluirPropietario=0|1`, …) y el rol de lectura de
registros.

| Endpoint | Formatos | Antes | Después |
|----------|----------|-------|---------|
| `GET /api/registros/salidas` | json, csv, xlsx | 500 `ERROR_INTERNO` | 200 `{ tablas }` / fichero |
| `GET /api/registros/todas-salidas` | json, csv, xlsx | 500 | 200 |
| `GET /api/registros/movimientos` | json, xlsx (csv → 422 `VALIDACION`, sin cambios) | 500 | 200 |
| `GET /api/registros/psicotropos` | json, csv, xlsx | 500 si hay psicótropos en el catálogo | 200 |
| `GET /api/registros/entradas`, `/bajas` | json, csv, xlsx | 200 | 200 (sin cambios) |

Errores inesperados: siguen respondiendo 500 con
`{ "error": { "code": "ERROR_INTERNO", "mensaje": "Se ha producido un error. Inténtalo de nuevo.", "detalles": null } }`.
