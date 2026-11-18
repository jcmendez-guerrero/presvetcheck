import { z } from 'zod';

/** Longitud máxima del código leído con el móvil; el móvil y la API usan este mismo número. */
export const MAX_CODIGO_MOVIL = 512;

/**
 * Cuerpo de `POST /api/movil/m/codigos`. `id` identifica la lectura: reenviarlo (reintento) no crea un segundo
 * evento. Es opcional para no romper móviles con la página antigua en caché.
 */
export const CodigoMovilBody = z.object({
  raw: z.string().min(1).max(MAX_CODIGO_MOVIL),
  id: z.string().uuid().optional(),
});
export type CodigoMovilBody = z.infer<typeof CodigoMovilBody>;
