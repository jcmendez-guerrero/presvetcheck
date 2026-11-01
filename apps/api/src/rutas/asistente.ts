import { z } from 'zod';
import { CrearConversacionBody, ListarConversacionesQuery, PreguntarBody, ValoracionBody } from '@mmx/shared';
import type { AppDeps } from '../deps';
import { ROLES, requiereRol, usuario } from '../plugins/auth';
import { AsistenteService } from '../servicios/asistente';
import type { App } from './comun';

const IdParam = z.object({ id: z.string().uuid() });

/** Asistente de consultas (contracts/api.md). Todas las rutas son de solo lectura sobre la operativa. */
export async function rutasAsistente(app: App, d: AppDeps) {
  const svc = new AsistenteService(d);
  const pre = requiereRol(...ROLES.lecturaRegistros);

  app.get(
    '/api/asistente/estado',
    {
      preHandler: pre,
      schema: {
        tags: ['asistente'],
        summary: 'Si el asistente está activo, su estado de consumo y preguntas de ejemplo',
      },
    },
    async () => svc.estado(),
  );

  app.post(
    '/api/asistente/conversaciones',
    {
      preHandler: pre,
      schema: { tags: ['asistente'], summary: 'Abre una conversación', body: CrearConversacionBody },
    },
    async (req, reply) =>
      reply.status(201).send(await svc.crearConversacion(req.body.contexto, usuario(req))),
  );

  app.post(
    '/api/asistente/conversaciones/:id/mensajes',
    {
      preHandler: pre,
      schema: {
        tags: ['asistente'],
        summary: 'Hace una pregunta al asistente',
        params: IdParam,
        body: PreguntarBody,
      },
    },
    async (req) => ({ intercambio: await svc.preguntar(req.params.id, req.body.pregunta, usuario(req)) }),
  );

  app.get(
    '/api/asistente/fuentes/:fuenteId',
    {
      preHandler: pre,
      schema: {
        tags: ['asistente'],
        summary: 'Abre una fuente citada por el asistente',
        params: z.object({ fuenteId: z.string().min(3).max(200) }),
        querystring: z.object({ version: z.string().max(200).optional() }),
      },
    },
    async (req) => svc.abrirFuente(req.params.fuenteId, req.query.version, usuario(req)),
  );

  app.put(
    '/api/asistente/intercambios/:id/valoracion',
    { preHandler: pre, schema: { tags: ['asistente'], summary: 'Valora una respuesta (útil o incorrecta)', params: IdParam, body: ValoracionBody } },
    async (req) => svc.valorar(req.params.id, req.body, usuario(req)),
  );

  app.get(
    '/api/asistente/conversaciones',
    { preHandler: pre, schema: { tags: ['asistente'], summary: 'Histórico de consultas (el empleado, solo las suyas)', querystring: ListarConversacionesQuery } },
    async (req) => svc.listar(req.query, usuario(req)),
  );

  app.get(
    '/api/asistente/conversaciones/:id',
    { preHandler: pre, schema: { tags: ['asistente'], summary: 'Una conversación con sus respuestas, fuentes y valoraciones', params: IdParam } },
    async (req) => svc.detalle(req.params.id, usuario(req)),
  );

  app.post(
    '/api/asistente/conversaciones/:id/cerrar',
    { preHandler: pre, schema: { tags: ['asistente'], summary: 'Cierra la conversación', params: IdParam } },
    async (req, reply) => {
      await svc.cerrar(req.params.id, usuario(req));
      return reply.status(204).send();
    },
  );
}
