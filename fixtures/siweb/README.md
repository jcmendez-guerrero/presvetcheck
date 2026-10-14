# Fixtures de Siweb360 (API pública)

Fuente: `docs/ref/siweb360-openapi.json` (OpenAPI 3.0.3 "Siweb360 / Sygna Public API", generado de la
documentación pública de https://app.siweb360.com/developers, octubre 2026). La especificación define los
**esquemas** pero no trae valores de ejemplo: estas fixtures siguen exactamente esos esquemas con valores
de prueba.

| Fichero | Endpoint |
|---|---|
| `doc-products.json` | `GET inventory/products` (con `pagination {page, limit, total, pages}`) |
| `doc-variant.json` | `GET inventory/variants/{id}` (con `stock_levels[]`: almacén, ubicación, `batch_number`, `expiry_date`, `on_hand`, `reserved`, `allocated`, `available`) |
| `doc-stock.json` | `GET inventory/variants/{id}/stock` (`levels[]`, mismos campos) |
| `doc-lots.json` | `GET inventory/variants/{id}/lots` |
| `doc-warehouses.json`, `doc-low-stock.json` | almacenes y bajo mínimo |
| `doc-adjustment.json`, `doc-transfer.json` | `POST inventory/stock/adjustments` / `transfers` |
| `doc-tickets.json`, `doc-ticket-700x.json` | `GET tickets` y `GET tickets/{id}` (líneas con `nombre` y `cantidad`; sin variante ni lote) |
| `farmacia-*.json` | Mismas estructuras con medicamentos para los flujos de la app |
| `demo-stock.json` | Stock **sintético** por CN para `pnpm demo` sin token (nunca en producción) |

Consecuencias para la app:

- El lote, la caducidad y el disponible por lote salen de `stock_levels[]` (antes era una hipótesis).
- Los tickets no identifican variante ni lote: la conciliación saca el CN del **nombre** de la línea
  (`SIWEB_TICKET_CN_REGEX`) y concilia por CN + unidades, con el lote **sin verificar**
  (TODO(decision D-02b): confirmar con tickets reales que el nombre conserva el CN).
- No hay endpoints de alta/edición de productos ni de movimientos de inventario: D-04b sigue en tareas
  manuales y el control de entradas manuales sin `MMX-REC-` no se puede hacer por API.
- La app nunca usa `POST/DELETE tickets` ni `PUT tickets/{id}/status`.
