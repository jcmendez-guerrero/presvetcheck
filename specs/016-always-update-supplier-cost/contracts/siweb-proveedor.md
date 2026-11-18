# Contratos: coste de proveedor

## 1. Siweb360 (externo, API 1.3.0; fuente `docs/ref/siweb360-openapi.json`)

| Uso | Llamada | Notas |
|---|---|---|
| Proveedores del producto | `GET /api/public/inventory/products/{id}/suppliers` | `data[]`: `id`, `product_id`, `contact_id`, `supplier_name`, `supplier_cif`, `supplier_reference`, `purchase_cost_cents`, `currency`, `is_preferred`. `id` = product_id de la variante. |
| **Actualizar coste del proveedor** | `PUT /api/public/inventory/products/{id}/suppliers/{contact_id}` | Cuerpo: `{ "purchase_cost_cents": number }`. **Solo** ese campo (no se envían `supplier_reference` ni `is_preferred`). Vincula el proveedor si no lo estaba. `null` borraría el coste: **prohibido** en la app. |
| Detalle de contacto | `GET /api/public/contacts/{id}` | Devuelve `cif`. |
| Buscar proveedores | `GET /api/public/contacts?tipo=Proveedor&activo=true&search=…&limit=10` | No devuelve CIF ni filtra por CIF. |
| Variante | `GET /api/public/inventory/variants/{id}` | `product_id`. |

Parseo tolerante (`z.looseObject`, campos opcionales, mayúsculas/minúsculas) como el resto de `packages/siweb`.
Fixtures nuevas en `fixtures/siweb/` derivadas de los ejemplos del OpenAPI (no se inventan estructuras).
Respuestas esperadas: 200 ok; 400 datos inválidos y 404 recurso inexistente → `failed`/`needs_supplier` según el caso;
401 → fallo de autenticación (misma gestión actual); 5xx/timeout → `needs_reconciliation`.

## 2. API interna (administración)

`POST /api/admin/distribuidores/:id/proveedor-siweb` — rol de administración como el resto de `/api/admin/*`.
- Cuerpo (zod): `{ contactId: number, confirmarCifDistinto?: boolean }`.
- Efecto: valida el contacto en Siweb360, guarda `siweb_contact_id`, reactiva las operaciones `needs_supplier` de ese
  distribuidor (`pending`), registra auditoría (`distribuidor_vincular_siweb`). Respuesta: `{ reactivadas: number }`.
- Errores tipados: `SIWEB_PROVEEDOR_NO_EXISTE`, `SIWEB_PROVEEDOR_CIF_DISTINTO` (pide confirmación), 403 por rol.
- `GET /api/admin/outbox?estado=needs_supplier` (ya existente) lista las pendientes; la fila muestra el distribuidor.
- Se regenera `openapi.json` de la API.
