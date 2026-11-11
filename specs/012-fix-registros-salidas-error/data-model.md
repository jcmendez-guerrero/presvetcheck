# Data Model: registros de salidas

Sin cambios de esquema ni migraciones. Se documentan los datos que intervienen en el filtro.

## dispensacion (salida)

| Campo | Tipo | Papel en el filtro |
|-------|------|--------------------|
| `fecha_venta` | `timestamptz` | Fecha de la salida normal |
| `fecha_original` | `date` (nullable) | Fecha real de una salida de alta manual (specs/011) |
| `anula_dispensacion_id` | `uuid` (nullable) | Si no es nulo, la fila es una anulación |

**Fecha de registro** (`fechaRegistro`): `coalesce((fecha_original + 12:00) at time zone 'UTC', fecha_venta)`.
Las 12:00 UTC caen siempre en el mismo día en Madrid.

**Fecha de movimiento** (`fechaMovimiento`, libro de psicótropos): fecha de registro si no es anulación; si lo es,
`fecha_venta` (el día en que se anula).

## Periodo de consulta

- Entrada: `desde`, `hasta` (`YYYY-MM-DD`, ambos incluidos).
- `rangoMadrid(desde, hasta)` → `[ini, fin)` en UTC: medianoche de Madrid de `desde` y del día siguiente a `hasta`.
- Regla de filtro: `ini <= fecha < fin`. Los límites viajan a la base de datos como texto ISO 8601 con zona.
