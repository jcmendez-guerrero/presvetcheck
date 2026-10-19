import { z } from 'zod';

/**
 * Esquemas de la API pública de Siweb360 (docs/ref/siweb360-openapi.json, OpenAPI 3.0.3 generado de la
 * documentación pública). Envoltorio `{ success, message?, data, pagination? }`; errores
 * `{ success: false, error, code, message }`. Tolerantes a campos nuevos.
 */
const num = z.union([z.number(), z.string()]).transform((v) => Number(v));
const numN = z.union([z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined || v === '' ? null : Number(v)));

export const PaginationSchema = z.looseObject({ page: numN, limit: numN, total: numN, pages: numN });
export const Envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.looseObject({ success: z.boolean().optional(), message: z.string().optional(), data, pagination: PaginationSchema.nullish() });

/** Cuerpo de error documentado. */
export const ErrorSchema = z.looseObject({ success: z.literal(false).optional(), error: z.string().nullish(), code: z.string().nullish(), message: z.string().nullish() });

export const ProductSchema = z.looseObject({
  id: num,
  code: z.string().nullish(),
  name: z.string().nullish(),
  brand: z.string().nullish(),
  product_type: z.string().nullish(),
  unit_of_measure: z.string().nullish(),
  is_active: z.boolean().nullish(),
  category: z.string().nullish(),
  variants_count: z.number().nullish(),
});

/** Fila de desglose por almacén/ubicación/lote (`stock_levels[]` en la variante, `levels[]` en /stock). */
export const LevelSchema = z.looseObject({
  warehouse_id: numN,
  warehouse_name: z.string().nullish(),
  warehouse_code: z.string().nullish(),
  location_id: numN,
  location_name: z.string().nullish(),
  location_code: z.string().nullish(),
  batch_number: z.string().nullish(),
  expiry_date: z.string().nullish(),
  on_hand: numN,
  reserved: numN,
  allocated: numN,
  available: numN,
});

export const VariantSchema = z.looseObject({
  id: num,
  product_id: numN,
  sku: z.string().nullish(),
  name: z.string().nullish(),
  attributes: z.record(z.string(), z.unknown()).nullish(),
  product_name: z.string().nullish(),
  product_code: z.string().nullish(),
  total_on_hand: numN,
  total_reserved: numN,
  total_allocated: numN,
  total_available: numN,
  is_infinite_stock: z.boolean().nullish(),
  status: z.string().nullish(),
  is_active: z.boolean().nullish(),
  /** Solo en `GET inventory/variants/{id}`. */
  stock_levels: z.array(LevelSchema).nullish(),
});

export const StockSchema = z.looseObject({
  variant_id: num,
  sku: z.string().nullish(),
  total_on_hand: numN,
  total_reserved: numN,
  total_allocated: numN,
  total_available: numN,
  is_infinite_stock: z.boolean().nullish(),
  levels: z.array(LevelSchema).nullish(),
});

export const LotSchema = z.looseObject({
  id: numN,
  lot_code: z.string(),
  expiry_date: z.string().nullish(),
  created_at: z.string().nullish(),
});

export const WarehouseSchema = z.looseObject({
  id: num,
  name: z.string(),
  code: z.string().nullish(),
  is_active: z.boolean().nullish(),
  is_default: z.boolean().nullish(),
});

/** `GET contacts` (docs/ref/siweb360-openapi.json): contactos; los de `tipo_relacion` Proveedor son distribuidores. */
export const ContactSchema = z.looseObject({
  id: num,
  nombre_empresa: z.string().nullish(),
  email_general: z.string().nullish(),
  telefono_principal: z.string().nullish(),
  tipo_relacion: z.string().nullish(),
});
export type Contact = z.output<typeof ContactSchema>;

export const AdjustmentResultSchema = z.looseObject({
  variant_id: numN,
  warehouse_id: numN,
  location_id: numN,
  on_hand: numN,
  movement: z.looseObject({ id: numN, variant_id: numN, warehouse_id: numN, quantity: numN, movement_type: z.string().nullish(), reason: z.string().nullish() }).nullish(),
});

/** `GET tickets` (resumen) y `GET tickets/{id}` (con líneas). Estados: Pagado, Pendiente, Cancelado. */
export const TicketItemSchema = z.looseObject({
  id: numN,
  nombre: z.string().nullish(),
  tipo: z.string().nullish(),
  cantidad: numN,
  precio_unitario: numN,
  subtotal: numN,
});
export const TicketSchema = z.looseObject({
  id: num,
  numero: z.string().nullish(),
  fecha: z.string().nullish(),
  hora: z.string().nullish(),
  estado: z.string().nullish(),
  observaciones: z.string().nullish(),
  items_count: numN,
  items: z.array(TicketItemSchema).nullish(),
});

export type Product = z.infer<typeof ProductSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type Stock = z.infer<typeof StockSchema>;
export type Lot = z.infer<typeof LotSchema>;
export type Warehouse = z.infer<typeof WarehouseSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type AdjustmentResult = z.infer<typeof AdjustmentResultSchema>;
export type Ticket = z.infer<typeof TicketSchema>;

/** Motivos admitidos por `POST inventory/stock/adjustments` (doc). */
export const ADJUSTMENT_REASONS = [
  'purchase_receipt',
  'sale_shipment',
  'adjustment_positive',
  'adjustment_negative',
  'return_customer',
  'return_supplier',
  'damage',
  'theft',
  'expiry',
  'count_adjustment',
  'initial_stock',
  'production_consumption',
  'production_output',
] as const;

export interface AdjustmentRequest {
  variant_id: number;
  warehouse_id: number;
  quantity: number;
  mode?: 'delta' | 'set';
  location_id?: number;
  reason?: (typeof ADJUSTMENT_REASONS)[number];
  notes?: string;
  batch_number?: string;
  expiry_date?: string;
}

export interface TransferRequest {
  variant_id: number;
  from_warehouse_id: number;
  to_warehouse_id: number;
  quantity: number;
  from_location_id?: number;
  to_location_id?: number;
  batch_number?: string;
  notes?: string;
}

/** Lote y disponible de una fila del desglose. null si faltan: entonces no se recomienda dispensar. */
export function leerNivel(l: Level): { lote: string | null; disponible: number | null; caducidad: string | null } {
  const lote = l.batch_number?.trim() || null;
  const disponible = l.available === null || l.available === undefined || Number.isNaN(l.available) ? null : l.available;
  return { lote, disponible, caducidad: l.expiry_date ? l.expiry_date.slice(0, 10) : null };
}
