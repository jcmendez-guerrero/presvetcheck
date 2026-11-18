# Quickstart: validar la feature

Prerrequisitos: `pnpm i`; para la integración, Docker (Testcontainers). Nada llama a Siweb360 real.

## 1. Pruebas automáticas
```bash
pnpm --filter @mmx/domain test      # coste del proveedor (it.each) y normalización de CIF
pnpm --filter @mmx/siweb test       # cliente + outbox con MSW (4xx, 5xx, timeout, 0/1/varias coincidencias)
pnpm --filter @mmx/api test        # encolado al finalizar, envío y reanudación tras vincular proveedor
pnpm lint && pnpm typecheck && pnpm test
```

## 2. Escenarios de aceptación (mapa a la spec)
| Escenario | Esperado |
|---|---|
| Línea con coste, casilla **desmarcada**, proveedor conocido | 1 operación `siweb_actualizar_coste_proveedor`; ninguna `siweb_actualizar_precio` (US1.1, US1.3) |
| Misma línea con casilla **marcada** | Las dos operaciones (variante y proveedor) (US1.2) |
| Línea sin coste | Ninguna operación; el coste previo no cambia (US1.4) |
| Distribuidor sin contacto recordado, CIF coincide con un solo proveedor | Búsqueda una vez, `siweb_contact_id` guardado; segunda recepción sin búsqueda (US2.1–2.2) |
| Sin CIF / sin coincidencia / varias | Operación en `needs_supplier`, recepción y stock terminan bien (US2.3) |
| Vincular el proveedor en administración | La operación pasa a `pending` y se envía una vez con el coste de su recepción (US2.4) |
| Línea pendiente de alta en Siweb360, casilla desmarcada | Al completar el alta se encola el coste de proveedor, una sola vez (US3) |
| `SIWEB_STOCK_WRITE_MODE=off`, o finalizada «sin precios» | Ninguna operación (edge cases) |
| Ayuda de la casilla | Dice que el coste del proveedor se actualiza siempre (US4) |

## 3. Comprobación manual en entorno de pruebas (con la escritura activada)
1. Recibir un albarán de un distribuidor con CIF y desmarcar «actualizar precio».
2. En administración → outbox, ver la operación enviada (`sent`).
3. En Siweb360 (entorno de pruebas), comprobar el coste de ese proveedor en el producto.
