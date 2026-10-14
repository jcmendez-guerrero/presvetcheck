import { z } from 'zod';

/**
 * Esquemas de la API de Inventario de Siweb360 (docs/ref, ejemplos parcialmente truncados).
 * Envoltorio documentado: `{ success, message?, data }`. Tolerantes a campos nuevos.
 */
const num = z.union([z.number(), z.string()]).transform((v) => Number(v));
const numN = z.union([z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined || v === '' ? null : Number(v)));

export const Envelope = <T extends z.ZodTypeAny>(data: T) => z.looseObject({ success: z.boolean().optional(), message: z.string().optional(), data });

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

/** Fila de desglose por almacén/ubicación/lote. Solo `warehouse_id` está documentado (ver fixtures/siweb/README.md). */
export const LevelSchema = z.looseObject({
  warehouse_id: numN,
  location_id: numN,
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
  levels: z.array(LevelSchema).nullish(),
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

export const AdjustmentResultSchema = z.looseObject({
  variant_id: numN,
  warehouse_id: numN,
  location_id: numN,
  on_hand: numN,
  movement: z.looseObject({ id: numN, variant_id: numN, warehouse_id: numN, quantity: numN }).nullish(),
});

export type Product = z.infer<typeof ProductSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type Stock = z.infer<typeof StockSchema>;
export type Lot = z.infer<typeof LotSchema>;
export type Warehouse = z.infer<typeof WarehouseSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type AdjustmentResult = z.infer<typeof AdjustmentResultSchema>;

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

/**
 * Lectura tolerante del lote y del disponible de una fila de `levels[]` (HIPÓTESIS documentada en
 * fixtures/siweb/README.md). Devuelve null si no hay datos suficientes: entonces no se recomienda dispensar.
 */
export function leerNivel(l: Level): { lote: string | null; disponible: number | null } {
  const r = l as Record<string, unknown>;
  const lote = ['lot_code', 'batch_number', 'lot'].map((k) => r[k]).find((v) => typeof v === 'string' && v !== '') as string | undefined;
  const disp = ['available', 'quantity_available'].map((k) => r[k]).find((v) => typeof v === 'number' || (typeof v === 'string' && v !== ''));
  return { lote: lote ?? null, disponible: disp === undefined ? null : Number(disp) };
}
