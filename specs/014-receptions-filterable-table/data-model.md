# Data Model: Tabla filtrable de recepciones

Sin cambios de esquema ni migraciones. Se leen tablas existentes de `packages/db/src/schema/entradas.ts`.

## Recepción (`recepcion`) — campos usados

| Campo | Tipo | Columna de la tabla | Notas |
|---|---|---|---|
| `id` | uuid | — | Abre el detalle `/recepciones/$id`. |
| `albaran` | text, nullable | Nº de albarán o factura | Vacío → «Sin albarán». Filtro parcial sin mayúsculas. |
| `distribuidorId` | uuid → `distribuidor.id` | Proveedor (`distribuidor.nombre`) | Filtro exacto por id. |
| `fechaRecepcion` | date, nullable | Fecha de recepción | Vacío → «—». Filtro por rango. |
| `fechaCompra` | date | Fecha de compra | Filtro por rango. |
| `createdAt` | timestamptz | Fecha de registro | Rango en Europe/Madrid (`rangoMadrid`). |
| `estado` | text | Estado | `ABIERTA` · `FINALIZADA` · `SINCRONIZADA` · `ERROR_SINCRONIZACION` · `DESCARTADA`. |

No se exponen `empleado`, `lecturaDocumento`, `documentoPath`, `motivoDescarte` ni datos de líneas.

## Proveedor (`distribuidor`)

`id`, `nombre`. Para el filtro: distribuidores con al menos una recepción, ordenados por nombre.

## Estados (solo lectura; las transiciones no cambian)

`ABIERTA → FINALIZADA → SINCRONIZADA | ERROR_SINCRONIZACION`; `ABIERTA → DESCARTADA`.
Por defecto se excluye `DESCARTADA`; si el filtro `estado` se envía, se usa tal cual (puede incluirla).

## Reglas de validación (consulta)

- `numero`: texto recortado, 1–60 caracteres.
- `distribuidorId`: uuid.
- `estado`: uno o varios de los cinco códigos, separados por comas.
- Fechas `YYYY-MM-DD`; en cada par, `desde ≤ hasta` si están los dos.
- `orden` y `dir` de listas cerradas; `pagina ≥ 1`; `1 ≤ porPagina ≤ 100`.
