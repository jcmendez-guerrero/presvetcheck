import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AppDeps } from '../deps';
import { ROLES, requiereRol } from '../plugins/auth';
import { IdParam } from '../schemas';
import { MovilService, urlBaseMovil } from '../servicios/movil';
import { RecetasService } from '../servicios/recetas';
import { ctx, type App } from './comun';
import { leerPaginas } from './recetas';

/** Prefijo de las rutas del móvil: sin sesión de usuario, se autentican con el token del QR. */
export const PREFIJO_MOVIL = '/api/movil/m';

export async function rutasMovil(app: App, d: AppDeps) {
  const svc = new MovilService(d);
  const recetas = new RecetasService(d);
  const pre = requiereRol(...ROLES.operativa);

  // ── Lado del PC (con sesión) ──
  app.post('/api/movil/sesiones', { preHandler: pre, schema: { tags: ['movil'], summary: 'Abre un emparejamiento con un móvil (token para el QR)' } }, async (req, reply) => {
    const s = await svc.abrir(ctx(req));
    const origen = (req.headers.origin as string | undefined) ?? `${req.protocol}://${req.headers.host ?? ''}`;
    return reply.status(201).send({ ...s, urlBase: urlBaseMovil(d.config.APP_PUBLIC_URL, origen, d.config.NODE_ENV === 'production') });
  });

  app.get(
    '/api/movil/sesiones/:id/eventos',
    { preHandler: pre, schema: { tags: ['movil'], summary: 'Eventos enviados por el móvil desde `desde`', params: IdParam, querystring: z.object({ desde: z.coerce.number().int().min(0).default(0) }) } },
    async (req) => svc.eventos(req.params.id, ctx(req).usuario, req.query.desde),
  );

  app.post('/api/movil/sesiones/:id/cerrar', { preHandler: pre, schema: { tags: ['movil'], summary: 'Desconecta el móvil', params: IdParam } }, async (req, reply) => {
    await svc.cerrar(req.params.id, ctx(req));
    return reply.status(204).send();
  });

  // ── Lado del móvil (token del QR) ──
  const delMovil = (req: FastifyRequest) =>
    svc.autenticar(req.headers['x-movil-token'] as string | undefined, req.ip ?? null, (req.headers['user-agent'] as string | undefined) ?? null);

  app.get(`${PREFIJO_MOVIL}/sesion`, { schema: { tags: ['movil'], summary: 'Comprueba el emparejamiento (cabecera x-movil-token)' } }, async (req) => {
    const m = await delMovil(req);
    return { usuario: m.ctx.usuario.nombre, expiraAt: m.expiraAt };
  });

  app.post(
    `${PREFIJO_MOVIL}/recetas`,
    { schema: { tags: ['movil'], summary: 'Sube las fotos de una receta; el PC abre su revisión', consumes: ['multipart/form-data'] } },
    async (req, reply) => {
      const m = await delMovil(req);
      const { paginas, fixture } = await leerPaginas(req, d);
      await svc.publicar(m.sesionId, { tipo: 'leyendo' });
      const r = await recetas.crear(paginas, m.ctx, fixture ? { fixture } : {});
      await svc.publicar(m.sesionId, { tipo: 'receta', recetaId: r.id, aviso: r.aviso ?? null });
      return reply.status(201).send({ id: r.id, aviso: r.aviso ?? null });
    },
  );

  app.post(
    `${PREFIJO_MOVIL}/codigos`,
    { schema: { tags: ['movil'], summary: 'Envía al PC la lectura de un código del envase', body: z.object({ raw: z.string().min(1).max(512) }) } },
    async (req, reply) => {
      const m = await delMovil(req);
      await svc.publicar(m.sesionId, { tipo: 'codigo', raw: req.body.raw });
      return reply.status(204).send();
    },
  );
}
