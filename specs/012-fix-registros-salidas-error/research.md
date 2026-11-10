# Research: registros de salidas con `ERROR_INTERNO`

## Evidencia

- Registro de la API en NP (2026-11-10): `Failed query: select "dispensacion"... where (coalesce(("dispensacion"."fecha_original" + time '12:00') at time zone 'UTC', "dispensacion"."fecha_venta") >= $1 ...`,
  pila `RegistrosService.salidas`. Parámetros: dos `Date`. El registro no guarda la causa (`err.cause`).
- Reproducción en PostgreSQL 16 (Testcontainers + postgres-js + Drizzle 0.45.4), comparando una expresión
  `sql\`coalesce(...)\`` con `gte(...)`:

  | Parámetro | Resultado |
  |-----------|-----------|
  | `Date` | ❌ `ERR_INVALID_ARG_TYPE: The "string" argument must be of type string ... Received an instance of Date` |
  | `Date` con `expr.mapWith(Date)` | ❌ mismo error |
  | `date.toISOString()` | ✅ |

- Las únicas comparaciones de una expresión `sql` con un `Date`: `packages/reports/src/datos.ts` líneas 94–95
  (`salidas`) y 403 (`psicotropos`). El resto de filtros por fecha del fichero comparan con cadenas `YYYY-MM-DD`
  y funcionan.
- Los tests (`apps/api/test`, `packages/reports/test`) usan PGlite, que serializa `Date` sin ayuda: por eso no lo
  detectaron.

## Decisiones

### 1. Cómo enviar los límites del periodo

- **Decision**: `gte(fechaRegistro, ini.toISOString())` (y lo mismo para `fin` y `fechaMovimiento`).
- **Rationale**: es el cambio mínimo y probado; el texto ISO lleva zona (`Z`), así que PostgreSQL lo convierte a
  `timestamptz` sin ambigüedad y los límites de Madrid de `rangoMadrid` se conservan.
- **Alternatives considered**:
  - `mapWith(Date)` en la expresión: no funciona (probado); solo afecta a la lectura.
  - `sql\`${expr} >= ${ini}::timestamptz\``: el `Date` sigue llegando sin serializar al driver.
  - Que `rangoMadrid` devuelva cadenas: cambia su contrato y la usan otros sitios (`semanal.ts`), que funcionan.
  - Tipar la expresión como columna personalizada (`customType`): más código para el mismo efecto.

### 2. Cómo evitar que vuelva a pasar

- **Decision**: prueba de integración `packages/reports/test/registros.int.test.ts` con Testcontainers
  (PostgreSQL 16), que inserta salidas (una normal, una de alta manual con `fecha_original`, una de psicótropo y su
  anulación) y llama a `RegistrosService.salidas` y `psicotropos`.
- **Rationale**: es exactamente el driver y motor de producción; CI ya ejecuta `test:int` por paquete.
- **Alternatives considered**: cambiar todos los tests a PostgreSQL real (lento, fuera de alcance); una regla de lint
  contra `Date` en `gte` (no distingue columnas tipadas de expresiones `sql`).

### 3. Registro técnico del error

- **Decision**: en `apps/api/src/plugins/errores.ts`, registrar `message` cortado antes de `\nparams:` y, si existe,
  `cause: { code, message }` (sin `detail`, que puede llevar valores de filas).
- **Rationale**: FR-006 pide la causa real; los parámetros de una consulta pueden contener datos personales
  (nombres, teléfonos), que la constitución prohíbe en logs. Hoy ya se escriben: este cambio lo corrige.
- **Alternatives considered**: registrar el error completo (filtra datos personales); no tocarlo (el próximo fallo
  vuelve a no tener causa).

## Notas de entorno

- En macOS con Colima, Testcontainers necesita `DOCKER_HOST` apuntando al socket de Colima y
  `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`; si no, da «Could not find a working container
  runtime strategy». En CI no hace falta.
