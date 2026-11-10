# Research: Activar la escritura de entradas de stock en Siweb360

Fase 0 de `/speckit-plan`. Cada punto: decisión, motivo y alternativas descartadas.

## R1. ¿Cambia algo en el envío con la API 1.3.0?

- **Decisión**: no se toca el envío. `POST inventory/stock/adjustments`, `stock/infinite` y `stock/transfers` son
  idénticos en 1.2.0 y 1.3.0 (comparación campo a campo del 2026-11-09). Solo se actualiza la copia de referencia
  `docs/ref/siweb360-openapi.json` a 1.3.0 (convertida a JSON con los alias YAML resueltos).
- **Motivo**: el diff completo son 20 cambios: versión, fecha de revisión, ejemplos de facturas y fichajes y cinco
  campos nuevos en `GET inventory/variants/{id}` (`cost_cents`, `price_tax_included`, `price_tax_rate`,
  `cost_tax_included`, `cost_tax_rate`).
- **Alternativas**: usar los campos nuevos de coste/IVA → fuera de alcance (spec, Assumptions).

## R2. Comprobar un envío dudoso contra el historial (US2, FR-005..007)

- **Decisión**: `OutboxService.verificarDudosos()` se ejecuta en cada pasada del job `outbox-dispatcher` (cada 5 min
  en horario comercial). Para cada fila `needs_reconciliation` de `stock_adjustment_entry` con `next_attempt_at <= now`
  llama a `client.movements({ variant_id, warehouse_id, reason: 'purchase_receipt', date_from: día del encolado })` y
  cuenta los movimientos con `notes === idempotencyKey` (igualdad exacta).
  - 1 coincidencia → `status = 'sent'`, `response = { movimiento }`, línea `SINCRONIZADA`, auditoría
    `outbox_verificado_auto` con actor `outbox-verificador`.
  - 0 → sigue en revisión, `last_error = 'No consta en Siweb360 a {fecha}'`, `next_attempt_at = now + 15 min`,
    `verificaciones + 1`; al llegar a 96 (24 h) `next_attempt_at = null` (solo manual).
  - ≥2 → sigue en revisión, `last_error = 'Posible duplicado en Siweb360 ({n} movimientos)'`, sin más comprobaciones.
  - Error leyendo el historial → no cambia nada (FR-005, escenario 3).
- Al pasar a `needs_reconciliation` (en `enviar` y en el bloqueo caducado) se fija `next_attempt_at = now + 10 min`.
- **Motivo**: reutiliza el job y el cliente existentes (`SiwebClient.movements`, ya paginado). No reenvía nunca.
- **Alternativas**: job nuevo → más infraestructura sin ganancia; consultar por `reference_id` → la API no devuelve
  nuestra clave ahí, solo en `notes`.

## R3. Cierre de avisos por cualquier usuario (Q2, FR-008)

- **Decisión**: nueva ruta `POST /api/outbox/:id/cerrar` con rol `operativa` o `admin` y acciones `revisado` |
  `resuelto_a_mano` (nota ≥ 5 caracteres). Ambas cierran la fila (`revisado` → `sent`; `resuelto_a_mano` →
  `resolved_manually`, estado nuevo) y dejan la línea de recepción `SINCRONIZADA`. `reenviar` / `descartar` /
  `confirmar_aplicada` siguen en la ruta de admin existente.
- **Consecuencia**: si se resuelve a mano, el movimiento manual aparecerá en la conciliación nocturna sin vínculo; se
  vincula a la línea de recepción desde la bandeja (R5). Es coherente: deja rastro de que se tecleó a mano.
- **Alternativas**: abrir la ruta de admin a todos → mezcla acciones que sí escriben (reenviar) con cierres.

## R4. Prueba de escritura exigida por la app (Q3, FR-010a/b)

- **Hallazgo**: `apps/worker/src/spikes/siweb-write-check.ts` solo imprime el resultado; no guarda nada. Los jobs de
  Container Apps no admiten argumentos al lanzarlos (`infra/np/README.md`), así que no sirve un job manual.
- **Decisión**: mover `ejecutarSpike` (`apps/worker/src/spikes/spike-siweb.ts`) a `packages/siweb/src/prueba-escritura.ts`
  sin reescribirlo, añadiendo las notas existentes `MMX-SPIKE-{AAAAMMDD}-ENTRADA` y `-REVERSION` a los dos ajustes y un paso final que lee el historial y
  comprueba que ambos movimientos aparecen con esa nota (`historialOk`). Nueva ruta de admin
  `POST /api/admin/siweb/prueba-escritura { sku, confirmacion: 'SI' }` que la ejecuta con el token de Key Vault y
  registra `audit_event` `siweb_prueba_escritura` con `{ ok, coherente, historialOk, sku, variantId, lote }`. El
  script de portátil sigue existiendo (importa de `@mmx/siweb`) para depurar, pero no cuenta para la puerta.
- **Puerta**: `OutboxService` recibe `pruebaVigente(): Promise<Date | null>` (última auditoría con
  `ok && coherente && historialOk`). `despachar()` no envía nada si es `null` o tiene más de 30 días (reloj inyectado);
  las filas siguen `pending`. La verificación de dudosos (R2) sí funciona sin prueba (solo lee).
- **Alternativas**: tabla propia → la auditoría ya es append-only y encadenada; job manual → sin argumentos.
- **Constitución**: el −1 de reversión es la única salida que se escribe, sobre una variante `TEST-` no mapeada a
  ningún CN, como ya permite SPEC §12.3. `exigirEntrada` del outbox no cambia.

## R5. Conciliación de movimientos (US3, FR-009..009c)

- **Decisión**: función pura `conciliarMovimientos` en `packages/domain` (tabla de casos `it.each`) que recibe los
  movimientos leídos, el mapa variante→CN, la fecha de corte, las claves de recepción existentes y los tickets ya
  conciliados, y devuelve `{ vinculados: [{ movimientoId, tipo, recepcionLineaId | dispensacionId }], sinJustificar,
ignorados }`. Reglas:
  1. Ignorar si la variante no está mapeada a un CN, el almacén no es el configurado o la fecha < corte.
  2. `notes` que casa exacto con `^MMX-REC-(.+)-L(\d+)$` y existe esa línea → vínculo `AUTO_RECEPCION`.
  3. `quantity < 0` y `reference_id` es un ticket con fila en `conciliacion` (`movimiento_id` empieza por
     `{ticketId}:`) para el mismo CN → vínculo `AUTO_VENTA` a esa dispensación.
  4. Resto → `sinJustificar`.
- **Orquestación**: `conciliarMovimientosDia()` en `packages/siweb` (junto a `conciliarDia`), llamada al final del job
  `sales-reconciliation` (21:00 Madrid, ya programado). Lee `inventory/movements` desde `max(corte, último día leído − 1)`
  hasta hoy, guarda cada movimiento en `siweb_movimiento` (`on conflict do nothing` por id de Siweb360, edge case
  "leído dos veces") e inserta los vínculos automáticos en `movimiento_justificacion`. Sin fecha de corte → no hace
  nada y lo devuelve (`{ inactivo: 'sin fecha de corte' }`).
- **`reference_type` de tickets**: el ejemplo de la API usa `budget`; no hay muestra real de un ticket del TPV. No se
  filtra por `reference_type`; se compara `reference_id` con los ids de ticket conciliados. Se deja `it.todo` pidiendo
  `fixtures/siweb/movements-ticket.json` real (Principio II: no inventar).
- **Bug encontrado**: `StockMovementSchema.reference_id` es `z.number()` pero el ejemplo de la API trae `"45120"`
  (cadena). Se cambia a `z.union([z.number(), z.string()]).nullish()` normalizado a `string`; con el esquema actual
  cualquier lectura del historial con referencias fallaría.
- **Alternativas**: tabla `discrepancia` existente → su clave es dispensación+línea de ticket y su estado se edita
  (`abierta`→`resuelta`); las justificaciones deben ser append-only y sustituibles, así que van en tabla propia.

## R6. Registro de bajas (Q5, FR-009d)

- **Decisión**: `RegistrosService.bajas(desde, hasta)` en `packages/reports` devuelve las justificaciones vigentes con
  motivo de movimientos con `quantity < 0` como `BAJA` y, si una justificación fue sustituida, la anterior como
  `ANULACIÓN BAJA`. Se añaden a `psicotropos()` (para psicótropos) y a un registro nuevo "Bajas" en la página de
  registros con su exportación (mismo formato que entradas/salidas). Motivos mostrados en español.
- **Pendiente para decidir**: las justificaciones de **entradas** (devolución de cliente, recuento positivo) no
  entran en el registro según Q5. Se deja `TODO(decision DUDA-30)` en `bajas()`; abrir DUDA-30 en Jira (KAN) al
  implementar.
- **Alternativas**: meter las bajas en el registro de salidas → ese registro es por receta/dispensación y una baja no
  tiene receta.

## R7. Arranque en producción (FR-010)

- **Decisión**: en `packages/shared/src/config.ts` `superRefine`: `NODE_ENV=production && SIWEB_STOCK_WRITE_MODE=entries_only
&& !ENTRY_CUTOVER_DATE` → error "Falta ENTRY_CUTOVER_DATE para escribir stock en Siweb360". Variables ya documentadas
  en `.env.example`; solo se amplía la descripción.

## R8. Lo que ya cumple el código (solo test)

- FR-003 (sin salidas): `exigirEntrada` en encolado y envío.
- FR-012 (apagar conserva pendientes): `despachar()` sale sin tocar filas con `off`.
- FR-013 (no retroactivo): con `off` `encolarRecepcion` no encola nada y marca `ESCRITURA_DESACTIVADA`; no hay
  re-encolado posterior de esas recepciones.
- 409 stock ilimitado → `failed` con mensaje (escenario US1-3): ya existe; solo se traduce el texto en la UI.
