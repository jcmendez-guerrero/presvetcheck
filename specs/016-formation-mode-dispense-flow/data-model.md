# Data model: Formation mode dispense flow

Sin cambios de esquema ni migraciones.

## Entidades existentes usadas

- **Receta confirmada** (`confirmacion`): `modo` (`en_vivo` | `retrospectivo`) y `fechaOriginal` (fecha ISO o
  `null`). Fuente de verdad del caso de formación; la evaluación pasa a leerlos.
- **Evaluación de línea** (`LineaEvaluada.resultado`): `{ decision, motivos[], evidencias, reglaVersion }`.
  En formación, el resultado del chequeo de movimientos viaja en las incidencias de la línea (`SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` con `cn`, `fecha`, `encontradas`, `requeridas` en `params`; `AVISO_FECHA_RETROSPECTIVA_ANTIGUA`). Con venta suficiente no hay incidencia. La evidencia completa (estado, movimientos consultados) se guarda al dispensar en `evidencia_stock_retrospectiva`, como hasta ahora.
- **Incidencias**: `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` (forzable con motivo, auditada), 
  `AVISO_FECHA_RETROSPECTIVA_ANTIGUA` (aviso), `SIWEB_NO_DISPONIBLE`.
- **Auditoría**: la evaluación persistida (`persistirEvaluacion`) conserva las incidencias del chequeo; el forzado de `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` queda en el registro de auditoría al dispensar, como hoy.
- **Dispensación** (append-only): sin cambios; ya guarda `modo` y `fecha_original`.

## Reglas de validación

- Formación solo con `RETROSPECTIVE_DISPENSATION_MODE=enabled` (salvo alta manual).
- `fechaOriginal` obligatoria, válida y no futura (comparada con la fecha de hoy en `Europe/Madrid` del `Clock` inyectado); si falta o es futura → `VALIDACION`.
- Un `BLOQUEANTE_DURO` nunca se fuerza, en formación tampoco.

## Estados

Sin nuevos estados. La línea pasa a `DISPENSAR`/`DISPENSAR_CON_AVISO`/`NO_CONFORME` (forzable) en lugar de `PEDIR`
cuando el chequeo del día original lo permite.
