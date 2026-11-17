# Data model: Formation mode dispense flow

Sin cambios de esquema ni migraciones.

## Entidades existentes usadas

- **Receta confirmada** (`confirmacion`): `modo` (`en_vivo` | `retrospectivo`) y `fechaOriginal` (fecha ISO o
  `null`). Fuente de verdad del caso de formación; la evaluación pasa a leerlos.
- **Evaluación de línea** (`LineaEvaluada.resultado`): `{ decision, motivos[], evidencias, reglaVersion }`.
  En formación, `evidencias` incluye el resultado del chequeo de movimientos (estado `OK | MOVIMIENTO_PARCIAL |
  SIN_MOVIMIENTO`, `cn`, `fechaOriginal`, unidades encontradas/requeridas).
- **Incidencias**: `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` (forzable con motivo, auditada), 
  `AVISO_FECHA_RETROSPECTIVA_ANTIGUA` (aviso), `SIWEB_NO_DISPONIBLE`.
- **Dispensación** (append-only): sin cambios; ya guarda `modo` y `fecha_original`.

## Reglas de validación

- Formación solo con `RETROSPECTIVE_DISPENSATION_MODE=enabled` (salvo alta manual).
- `fechaOriginal` obligatoria, válida y no futura; si falta → `VALIDACION`.
- Un `BLOQUEANTE_DURO` nunca se fuerza, en formación tampoco.

## Estados

Sin nuevos estados. La línea pasa a `DISPENSAR`/`DISPENSAR_CON_AVISO`/`NO_CONFORME` (forzable) en lugar de `PEDIR`
cuando el chequeo del día original lo permite.
