import { z } from 'zod';

export const BuscarTicketsQuery = z.object({
  search: z.string().trim().min(3, 'Introduce al menos 3 caracteres'),
  estado: z.enum(['Pagado', 'Pendiente', 'Cancelado']).optional(),
});
export type BuscarTicketsQuery = z.infer<typeof BuscarTicketsQuery>;

export const AsociarTicketBody = z.object({
  dispensacionId: z.string().uuid('Identificador de dispensación no válido'),
  ticketId: z.number().int().positive(),
  ticketNumero: z.string().trim().min(1, 'Número de ticket requerido'),
  lineaId: z.union([z.string(), z.number()]).optional(),
  nota: z.string().trim().max(500).optional(),
});
export type AsociarTicketBody = z.infer<typeof AsociarTicketBody>;

export const VincularTicketBody = z.object({
  ticketId: z.union([z.string(), z.number()]).transform(String),
  ticketNumero: z.string().trim().min(1, 'Número de ticket requerido'),
  recetaId: z.string().uuid('Identificador de receta no válido'),
});
export type VincularTicketBody = z.infer<typeof VincularTicketBody>;

export const DesvincularTicketBody = z.object({
  ticketId: z.union([z.string(), z.number()]).transform(String),
  recetaId: z.string().uuid('Identificador de receta no válido'),
});
export type DesvincularTicketBody = z.infer<typeof DesvincularTicketBody>;

export const LineaConciliacionResumen = z.object({
  cn: z.string(),
  nombre: z.string(),
  unidadesTicket: z.number().int().nonnegative(),
  unidadesDispensadasTotal: z.number().int().nonnegative(),
  estadoLinea: z.enum(['COINCIDE', 'DEFICIT_TICKET', 'EXCESO_DISPENSADO', 'SIN_DISPENSACION']),
});
export type LineaConciliacionResumen = z.infer<typeof LineaConciliacionResumen>;

export const DetalleTicketMultiReceta = z.object({
  ticketId: z.string(),
  ticketNumero: z.string(),
  estado: z.enum(['vinculado', 'confirmado']),
  recetas: z.array(
    z.object({
      recetaId: z.string().uuid(),
      numeroReceta: z.string().nullable(),
      fecha: z.string(),
    }),
  ),
  conciliacionLineas: z.array(LineaConciliacionResumen),
  puedeConfirmar: z.boolean(),
  bloqueos: z.array(z.string()),
});
export type DetalleTicketMultiReceta = z.infer<typeof DetalleTicketMultiReceta>;

export const ConfirmarTicketResponse = z.object({
  ok: z.boolean(),
  ticketId: z.string(),
  ticketNumero: z.string(),
  salidasConciliadas: z.number().int().nonnegative(),
});
export type ConfirmarTicketResponse = z.infer<typeof ConfirmarTicketResponse>;

export const ConsultaStockRetrospectivoBody = z.object({
  cn: z.string().regex(/^\d{6,7}$/, 'Código nacional no válido'),
  fechaOriginal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha AAAA-MM-DD requerido'),
  unidadesRequeridas: z.number().int().positive(),
});
export type ConsultaStockRetrospectivoBody = z.infer<typeof ConsultaStockRetrospectivoBody>;

export const ConsultaStockRetrospectivoResponse = z.object({
  estado: z.enum(['OK', 'MOVIMIENTO_PARCIAL', 'SIN_MOVIMIENTO']),
  cn: z.string(),
  fechaOriginal: z.string(),
  unidadesEncontradas: z.number().int().nonnegative(),
  unidadesRequeridas: z.number().int().positive(),
  movimientos: z.array(
    z.object({
      id: z.number(),
      quantity: z.number(),
      reason: z.string(),
      reference_number: z.string().nullable().optional(),
    }),
  ),
});
export type ConsultaStockRetrospectivoResponse = z.infer<typeof ConsultaStockRetrospectivoResponse>;
