# Data Model: Activar la escritura de entradas de stock en Siweb360

Migración nueva `packages/db/migrations/0020_conciliacion_movimientos.sql` (+ esquema drizzle en
`packages/db/src/schema/infra.ts`).

## Cambios en tablas existentes

### `outbox`

| Campo             | Cambio                                 | Uso                                           |
| ----------------- | -------------------------------------- | --------------------------------------------- |
| `status`          | nuevo valor `resolved_manually`        | Cierre "Resuelto a mano en Siweb360" (R3).    |
| `next_attempt_at` | ya existe, sin uso hasta ahora         | Próxima comprobación de un envío dudoso (R2). |
| `verificaciones`  | **nuevo** `integer not null default 0` | Comprobaciones hechas; a 96 se paran.         |

Transiciones (las nuevas en negrita):

```text
pending ──envío ok──► sent
pending ──4xx/409──► failed
pending ──timeout/5xx/bloqueo caducado──► needs_reconciliation  (next_attempt_at = +10 min)
needs_reconciliation ──**historial: 1 coincidencia**──► sent           (actor outbox-verificador)
needs_reconciliation ──**historial: 0**──► needs_reconciliation        (+15 min, verificaciones+1; a 96 → next_attempt_at null)
needs_reconciliation ──**historial: ≥2**──► needs_reconciliation       (posible duplicado, next_attempt_at null)
needs_reconciliation|failed ──**usuario: revisado**──► sent
needs_reconciliation|failed ──**usuario: resuelto_a_mano**──► resolved_manually
needs_reconciliation|failed ──admin: confirmar_aplicada / reenviar / descartar──► sent / pending / failed  (existente)
```

`pending` no avanza si no hay prueba de escritura vigente (FR-010b).

## Tablas nuevas

### `siweb_movimiento` (copia de lectura del historial de Siweb360)

| Campo                             | Tipo                   | Notas                                                                  |
| --------------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `id`                              | `bigint` PK            | Id del movimiento en Siweb360 (identidad; evita duplicados al releer). |
| `variant_id`                      | `bigint not null`      |                                                                        |
| `cn`                              | `text null`            | CN del mapeo en el momento de la lectura; `null` → ignorado.           |
| `warehouse_id`                    | `bigint null`          |                                                                        |
| `quantity`                        | `integer not null`     | >0 entrada, <0 salida.                                                 |
| `reason`                          | `text not null`        | Motivo de Siweb360 tal cual.                                           |
| `reference_type` / `reference_id` | `text null`            | `reference_id` normalizado a texto (R5).                               |
| `batch_number` / `expiry_date`    | `text` / `date null`   |                                                                        |
| `notes`                           | `text null`            | No se registra en logs.                                                |
| `created_at_siweb`                | `timestamptz not null` | Fecha del movimiento.                                                  |
| `leido_at`                        | `timestamptz not null` |                                                                        |

Solo `INSERT … ON CONFLICT DO NOTHING`. `REVOKE UPDATE, DELETE, TRUNCATE` a `mmx_app`.

### `movimiento_justificacion` (append-only)

| Campo                | Tipo                                        | Notas                                                                                                                                                                                      |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                 | `uuid` PK                                   |                                                                                                                                                                                            |
| `movimiento_id`      | `bigint not null` → `siweb_movimiento.id`   |                                                                                                                                                                                            |
| `tipo`               | `text not null`                             | `AUTO_RECEPCION` · `AUTO_VENTA` · `VINCULO_RECEPCION` · `VINCULO_DISPENSACION` · `MOTIVO`                                                                                                  |
| `recepcion_linea_id` | `uuid null`                                 | Obligatorio con `*_RECEPCION`.                                                                                                                                                             |
| `dispensacion_id`    | `uuid null`                                 | Obligatorio con `*_DISPENSACION`/`AUTO_VENTA`.                                                                                                                                             |
| `motivo`             | `text null`                                 | Obligatorio con `MOTIVO`: `REVISION_INVENTARIO` · `REVISION_LOTE` · `REVISION_CADUCIDAD` · `CADUCADO` · `ROTURA` · `DEVOLUCION_CLIENTE` · `DEVOLUCION_PROVEEDOR` · `ROBO_PERDIDA` · `OTRO` |
| `nota`               | `text null`                                 | Obligatoria con `OTRO` y en toda justificación manual (≥ 5 caracteres).                                                                                                                    |
| `sustituye_a`        | `uuid null` → `movimiento_justificacion.id` | Corrección de una justificación anterior.                                                                                                                                                  |
| `actor`              | `text not null`                             | Usuario o `sales-reconciliation`.                                                                                                                                                          |
| `at`                 | `timestamptz not null`                      |                                                                                                                                                                                            |

Restricciones: `CHECK` por `tipo` (campos obligatorios), índice único parcial
`(sustituye_a) WHERE sustituye_a IS NOT NULL` (una sustitución por justificación). Trigger `mmx_append_only` y
`REVOKE UPDATE, DELETE, TRUNCATE` a `mmx_app` (como `recepcion_ajuste`).

**Justificación vigente** de un movimiento = la que no está sustituida por ninguna otra. **Movimiento sin justificar** =
`siweb_movimiento` con `cn` no nulo, almacén configurado, `created_at_siweb >= corte` y sin justificación vigente.

Validación en `packages/shared` (zod): `JustificarMovimientoBody` (discriminada por `tipo`), `CerrarOutboxBody`.

## Lectura derivada: registro de bajas

`RegistrosService.bajas()` = justificaciones vigentes `tipo = MOTIVO` de movimientos con `quantity < 0` → filas
`BAJA` (fecha del movimiento, CN, nombre CIMAVet, lote, unidades positivas, motivo en español, referencia = id de la
justificación). Las sustituidas generan además `ANULACIÓN BAJA`. Tipo `MovimientoPsicotropo['tipo']` amplía su unión
con `'BAJA' | 'ANULACIÓN BAJA'`.

## Prueba de escritura (sin tabla)

`audit_event` con `accion = 'siweb_prueba_escritura'`, `despues = { ok, coherente, historialOk, sku, variantId, lote }`.
Vigente = la más reciente con los tres a `true` y `at >= now − 30 días`.
