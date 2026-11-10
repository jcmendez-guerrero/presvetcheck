# Fixtures de Siweb360 (API pública)

Fuente: `docs/ref/siweb360-openapi.json` (OpenAPI 3.0.3 "Siweb360 / Sygna Public API", generado de la
documentación pública de https://app.siweb360.com/developers, octubre 2026). La especificación define los
**esquemas** pero no trae valores de ejemplo: estas fixtures siguen exactamente esos esquemas con valores
de prueba.

| Fichero | Endpoint |
| --- | --- |
| `doc-products.json` | `GET inventory/products` (con `pagination {page, limit, total, pages}`) |
| `doc-variant.json` | `GET inventory/variants/{id}` (con `stock_levels[]`: almacén, ubicación, `batch_number`, `expiry_date`, `on_hand`, `reserved`, `allocated`, `available`) |
| `doc-stock.json` | `GET inventory/variants/{id}/stock` (`levels[]`, mismos campos) |
| `doc-lots.json` | `GET inventory/variants/{id}/lots` |
| `doc-warehouses.json`, `doc-low-stock.json` | almacenes y bajo mínimo |
| `doc-adjustment.json`, `doc-transfer.json` | `POST inventory/stock/adjustments` / `transfers` |
| `doc-contacts-proveedores.json` | `GET contacts?tipo=Proveedor` (mismos campos que el ejemplo de la especificación) |
| `doc-movements.json` | `GET inventory/movements` (ejemplo literal de la especificación 1.3.0; `reference_id` es cadena y `created_at` no lleva zona horaria) |
| `movements-conciliacion.json` | **Derivado** de `doc-movements.json` (no es una respuesta real) para la conciliación de movimientos (specs/011): entrada con `MMX-REC-…`, venta del ticket 7001, rotura, entrada manual sin nota, variante no mapeada y movimiento anterior al corte (2026-11-01) |
| `doc-tickets.json`, `doc-ticket-700x.json` | `GET tickets` y `GET tickets/{id}` (líneas con `nombre` y `cantidad`; sin variante ni lote) |
| `farmacia-*.json` | Mismas estructuras con medicamentos para los flujos de la app |
| `demo-stock.json` | Stock **sintético** por CN para `pnpm demo` sin token (nunca en producción) |

Consecuencias para la app:

- El lote, la caducidad y el disponible por lote salen de `stock_levels[]` (antes era una hipótesis).
- Los tickets no identifican variante ni lote: la conciliación saca el CN del **nombre** de la línea
  (`SIWEB_TICKET_CN_REGEX`) y concilia por CN + unidades, con el lote **sin verificar**
  (TODO(decision D-02b): confirmar con tickets reales que el nombre conserva el CN).
- No hay endpoints de alta/edición de productos: D-04b sigue en tareas manuales. El historial de movimientos
  (`GET inventory/movements`) sí existe y devuelve `notes`: con él se verifican los envíos dudosos y se
  concilian los movimientos de medicamentos (specs/011).
- La app nunca usa `POST/DELETE tickets` ni `PUT tickets/{id}/status`.
