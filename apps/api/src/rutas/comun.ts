import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyInstance, RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, FastifyBaseLogger } from 'fastify';
import type { ContextoPeticion } from '../servicios/recetas';
import { usuario } from '../plugins/auth';

export type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, FastifyBaseLogger, ZodTypeProvider>;

export function ctx(req: FastifyRequest): ContextoPeticion {
  return { usuario: usuario(req), ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined) ?? null };
}

export async function enviarFichero(reply: FastifyReply, nombre: string, mime: string, cuerpo: Buffer | string) {
  return reply
    .header('Content-Type', mime)
    .header('Content-Disposition', `attachment; filename="${nombre}"`)
    .header('Cache-Control', 'no-store')
    .send(cuerpo);
}
