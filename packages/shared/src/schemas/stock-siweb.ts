import { z } from 'zod';

/** Escritura de stock en Siweb360 y conciliación de movimientos (specs/011). */

const nota = z.string().trim().min(5, 'Escribe una nota de al menos 5 caracteres');

/** Cierre de un envío en revisión por cualquier usuario (reenviar y descartar son de administración). */
export const CerrarOutboxBody = z.object({
  accion: z.enum(['revisado', 'resuelto_a_mano']),
  nota,
});
export type CerrarOutboxBody = z.infer<typeof CerrarOutboxBody>;

export const PruebaEscrituraBody = z.object({
  sku: z.string().trim().min(1),
  confirmacion: z.literal('SI', { message: 'Escribe SI para confirmar' }),
});
export type PruebaEscrituraBody = z.infer<typeof PruebaEscrituraBody>;

/** Motivos para justificar un movimiento de Siweb360 sin pareja en la app. */
export const MOTIVOS_JUSTIFICACION = [
  'REVISION_INVENTARIO',
  'REVISION_LOTE',
  'REVISION_CADUCIDAD',
  'CADUCADO',
  'ROTURA',
  'DEVOLUCION_CLIENTE',
  'DEVOLUCION_PROVEEDOR',
  'ROBO_PERDIDA',
  'OTRO',
] as const;
export type MotivoJustificacion = (typeof MOTIVOS_JUSTIFICACION)[number];

export const TEXTO_MOTIVO: Record<MotivoJustificacion, string> = {
  REVISION_INVENTARIO: 'Revisión de inventario',
  REVISION_LOTE: 'Revisión de lote',
  REVISION_CADUCIDAD: 'Revisión de caducidad',
  CADUCADO: 'Caducado',
  ROTURA: 'Rotura',
  DEVOLUCION_CLIENTE: 'Devolución de cliente',
  DEVOLUCION_PROVEEDOR: 'Devolución a proveedor',
  ROBO_PERDIDA: 'Robo o pérdida',
  OTRO: 'Otro',
};

/** Motivos que solo encajan con una salida o solo con una entrada (el resto, con ambas). */
const SOLO_SALIDA: ReadonlySet<MotivoJustificacion> = new Set([
  'CADUCADO',
  'ROTURA',
  'ROBO_PERDIDA',
  'DEVOLUCION_PROVEEDOR',
]);
const SOLO_ENTRADA: ReadonlySet<MotivoJustificacion> = new Set(['DEVOLUCION_CLIENTE']);

/** ¿Encaja el motivo con un movimiento de `unidades` (>0 entrada, <0 salida)? */
export function motivoEncaja(motivo: MotivoJustificacion, unidades: number): boolean {
  return !((SOLO_SALIDA.has(motivo) && unidades >= 0) || (SOLO_ENTRADA.has(motivo) && unidades <= 0));
}

export const JustificarMovimientoBody = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('VINCULO_RECEPCION'), recepcionLineaId: z.string().uuid(), nota }),
  z.object({ tipo: z.literal('VINCULO_DISPENSACION'), dispensacionId: z.string().uuid(), nota }),
  z.object({ tipo: z.literal('MOTIVO'), motivo: z.enum(MOTIVOS_JUSTIFICACION), nota }),
]);
export type JustificarMovimientoBody = z.infer<typeof JustificarMovimientoBody>;

export const MovimientosSiwebQuery = z.object({
  estado: z.enum(['sin_justificar', 'justificados']).default('sin_justificar'),
  desde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  hasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type MovimientosSiwebQuery = z.infer<typeof MovimientosSiwebQuery>;
