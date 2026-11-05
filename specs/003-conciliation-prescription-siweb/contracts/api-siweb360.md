# Contract: Cliente Siweb360 API 1.2.0 (Precios, Costes y Movimientos)

**Feature**: `specs/003-conciliation-prescription-siweb/spec.md`  
**Package**: `@mmx/siweb`

---

## 1. Actualización de Precios y Costes de Variante

- **Endpoint Siweb360**: `PUT /api/public/inventory/variants/{id}/pricing`
- **Headers**:
  - `Authorization: Bearer <SIWEB_TOKEN>`
  - `Content-Type: application/json`
- **Método Cliente**: `SiwebClient.actualizarPrecios(variantId: number, body: VariantPricingRequest)`
- **Request Body Schema**:
  ```ts
  export const VariantPricingRequestSchema = z.object({
    price_cents: z.number().nonnegative().optional(),
    cost_cents: z.number().nonnegative().optional(),
  });
  export type VariantPricingRequest = z.infer<typeof VariantPricingRequestSchema>;
  ```
- **Ejemplo de Petición**:
  ```json
  {
    "price_cents": 2495,
    "cost_cents": 1425.5
  }
  ```
- **Response 200 OK Schema**:
  ```ts
  export const VariantPricingResponseSchema = Envelope(
    z.object({
      variant_id: z.number(),
      sku: z.string().optional(),
      price_cents: z.number().nullable().optional(),
      cost_cents: z.number().nullable().optional(),
    })
  );
  ```

---

## 2. Historial de Movimientos de Inventario

- **Endpoint Siweb360**: `GET /api/public/inventory/movements`
- **Query Parameters**:
  - `variant_id` (number, opcional)
  - `warehouse_id` (number, opcional)
  - `reason` (string, opcional): `'purchase_receipt' | 'sale_shipment' | 'adjustment_positive' | 'adjustment_negative' | ...`
  - `page` (number, opcional)
  - `limit` (number, opcional, máx 200)
- **Método Cliente**: `SiwebClient.movements(filtros: FiltrosMovimientos)`
- **Response Schema**:
  ```ts
  export const StockMovementSchema = z.object({
    id: z.number(),
    variant_id: z.number(),
    sku: z.string().optional(),
    warehouse_id: z.number(),
    quantity: z.number(),
    reason: z.string(),
    reference_type: z.string().nullable().optional(),
    reference_id: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    created_at: z.string(),
  });
  ```
