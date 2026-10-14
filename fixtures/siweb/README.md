# Fixtures de Siweb360 (API de Inventario)

Fuente: `docs/ref/Siweb360 _ El mejor software de gestión para empresas.pdf` (página de desarrolladores,
14/10/2026). Los ejemplos JSON de la documentación aparecen **truncados** en el PDF (capturas de pantalla).

| Fichero | Origen |
|---|---|
| `doc-products.json` | Literal de la doc (`GET inventory/products`), campos visibles |
| `doc-variant.json` | Literal de la doc (`GET inventory/variants/:id`), campos visibles |
| `doc-stock.json` | Literal (totales y `levels[0].warehouse_id`); **resto de campos de `levels[]` = HIPÓTESIS** |
| `doc-lots.json` | Literal de la doc (`GET inventory/variants/:id/lots`) |
| `doc-warehouses.json` | Literal (primer almacén completo; segundo truncado tras `name`) |
| `doc-adjustment.json` | Literal (`message`, `data`, `movement.id/variant_id/warehouse_id/quantity`) |
| `doc-transfer.json` | Literal (`message`, `reference_id`, primer movimiento) |
| `doc-low-stock.json` | Literal, campos visibles |
| `farmacia-*.json` | Mismas estructuras con datos de medicamentos para los flujos de la app |

**HIPÓTESIS (a confirmar con una respuesta real):** cada fila de `levels[]` trae `warehouse_id`
(documentado), `location_id`, `lot_code`, `on_hand`, `reserved`, `allocated`, `available` (nombres
derivados de los totales documentados `total_on_hand`, `total_reserved`, `total_allocated`,
`total_available` y de `lot_code` en `/lots`). El adaptador es tolerante y, si no encuentra el
disponible por lote, **no** recomienda dispensar (`PENDIENTE_STOCK`). Hay un `it.todo` en
`packages/siweb/test/client.test.ts`. Tampoco se conocen los metadatos de paginación.
