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
