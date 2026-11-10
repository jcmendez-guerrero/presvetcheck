# Quickstart: validar la feature 011

Nada de esto llama a Siweb360 real: tests con MSW y `fixtures/siweb/`. La puesta en marcha real está al final y la
hace una persona.

## 1. Tests automáticos

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:int   # migración 0020, triggers append-only y permisos de mmx_app
```

Deben cubrir (ver [data-model.md](data-model.md) y [contracts/api-stock-siweb.md](contracts/api-stock-siweb.md)):

| Caso                                                                                                         | Dónde                              | Resultado esperado                                                  |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------- |
| Recepción de 2 líneas con `entries_only` y prueba vigente                                                    | `packages/siweb/test`              | 2 ajustes `purchase_receipt` con lote, caducidad y `MMX-REC-…`      |
| Sin prueba vigente (o > 30 días)                                                                             | `packages/siweb/test`              | 0 envíos; filas siguen `pending`                                    |
| Timeout tras enviar → historial con la clave 1 vez                                                           | `packages/siweb/test`              | `sent`, auditoría `outbox_verificado_auto`                          |
| Ídem, historial sin la clave                                                                                 | `packages/siweb/test`              | sigue en revisión, "No consta…", sin reenvío                        |
| Ídem, clave 2 veces                                                                                          | `packages/siweb/test`              | "Posible duplicado…", sin más comprobaciones                        |
| Historial 5xx / timeout                                                                                      | `packages/siweb/test`              | sin cambios                                                         |
| `reference_id` como cadena y como número; campos con otra capitalización; campos nuevos                      | `packages/siweb/test`              | se parsea                                                           |
| Conciliación: entrada con clave, venta con ticket conciliado, rotura, producto no mapeado, anterior al corte | `packages/domain/test` (`it.each`) | vinculado / vinculado / sin justificar / ignorado / ignorado        |
| Movimiento leído dos noches                                                                                  | `packages/siweb/test`              | una sola fila                                                       |
| Justificar "Rotura" y luego sustituir por "Caducado"                                                         | `apps/api/test`                    | 2 filas; registro: `BAJA` rotura, `ANULACIÓN BAJA`, `BAJA` caducado |
| `UPDATE`/`DELETE` sobre `movimiento_justificacion`                                                           | `pnpm test:int`                    | rechazado                                                           |
| `empleado` → `/api/admin/outbox/:id/resolver`                                                                | `apps/api/test`                    | 403                                                                 |
| `empleado` → `/api/outbox/:id/cerrar`                                                                        | `apps/api/test`                    | 200                                                                 |
| `NODE_ENV=production`, `entries_only`, sin `ENTRY_CUTOVER_DATE`                                              | `packages/shared/test`             | no arranca                                                          |
| Prueba de escritura con SKU sin `TEST-`                                                                      | `apps/api/test`                    | 400 `SKU_NO_TEST`, auditada                                         |

## 2. Local (dev, sin Siweb360 real)

```bash
pnpm dev
```

1. `.env`: `SIWEB_STOCK_WRITE_MODE=entries_only`, `ENTRY_CUTOVER_DATE=<hoy>`, Siweb360 apuntando al mock.
2. Admin → Estado del stock: muestra "Falta la prueba de escritura".
3. Finalizar una recepción → líneas `ENCOLADA`, no se envían.
4. Admin → Prueba de escritura con `TEST-0000-CN000000` y "SI" → estado pasa a vigente; el outbox envía.
5. `pnpm worker sales-reconciliation` → la bandeja "Movimientos sin justificar" muestra solo los del fixture que no
   tienen pareja.

## 3. Puesta en marcha en producción (persona, fuera de CI)

1. Crear a mano en Siweb360 la variante `TEST-…` (sin publicar en TPV ni web).
2. Admin → Prueba de escritura. Debe salir `ok`, `coherente` e `historialOk`. Si `historialOk` es falso, **parar**: la
   API no devuelve la nota y ni la verificación de dudosos ni la conciliación funcionarán.
3. Fijar `ENTRY_CUTOVER_DATE` y `SIWEB_STOCK_WRITE_MODE=entries_only` en el fichero de parámetros local (no versionado)
   y desplegar.
4. Avisar al personal: desde la fecha de corte no se dan entradas de medicamentos a mano en Siweb360.
5. Al día siguiente, revisar la bandeja "Movimientos sin justificar".

Marcha atrás: `SIWEB_STOCK_WRITE_MODE=off` y desplegar; los pendientes se conservan.
