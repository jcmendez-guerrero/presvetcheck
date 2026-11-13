import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AppDeps } from '../deps';
import { ROLES, requiereRol } from '../plugins/auth';
import { IdParam } from '../schemas';
import { DomainError } from '@mmx/shared';
import { MovilService, urlBaseMovil } from '../servicios/movil';
import { MAX_BYTES_ALBARAN, RecepcionesService } from '../servicios/recepciones';
import { RecetasService } from '../servicios/recetas';
import { ctx, type App } from './comun';
import { MIMES_ALBARAN } from './operativa';
import { leerPaginas } from './recetas';

/** Prefijo de las rutas del móvil: sin sesión de usuario, se autentican con el token del QR. */
export const PREFIJO_MOVIL = '/api/movil/m';

export async function rutasMovil(app: App, d: AppDeps) {
  const svc = new MovilService(d);
  const recetas = new RecetasService(d);
  const pre = requiereRol(...ROLES.operativa);

  // ── Lado del PC (con sesión) ──
  app.post(
    '/api/movil/sesiones',
    {
      preHandler: pre,
      schema: { tags: ['movil'], summary: 'Abre un emparejamiento con un móvil (token para el QR)' },
    },
    async (req, reply) => {
      const s = await svc.abrir(ctx(req));
      const origen =
        (req.headers.origin as string | undefined) ?? `${req.protocol}://${req.headers.host ?? ''}`;
      return reply.status(201).send({
        ...s,
        urlBase: urlBaseMovil(d.config.APP_PUBLIC_URL, origen, d.config.NODE_ENV === 'production'),
      });
    },
  );

  app.get(
    '/api/movil/sesiones/:id/eventos',
    {
      preHandler: pre,
      schema: {
        tags: ['movil'],
        summary: 'Eventos enviados por el móvil desde `desde`',
        params: IdParam,
        querystring: z.object({ desde: z.coerce.number().int().min(0).default(0) }),
      },
    },
    async (req) => svc.eventos(req.params.id, ctx(req).usuario, req.query.desde),
  );

  app.post(
    '/api/movil/sesiones/:id/cerrar',
    { preHandler: pre, schema: { tags: ['movil'], summary: 'Desconecta el móvil', params: IdParam } },
    async (req, reply) => {
      await svc.cerrar(req.params.id, ctx(req));
      return reply.status(204).send();
    },
  );

  // ── Lado del móvil (token del QR) ──
  const delMovil = (req: FastifyRequest) =>
    svc.autenticar(
      req.headers['x-movil-token'] as string | undefined,
      req.ip ?? null,
      (req.headers['user-agent'] as string | undefined) ?? null,
    );

  app.get(
    `${PREFIJO_MOVIL}/sesion`,
    { schema: { tags: ['movil'], summary: 'Comprueba el emparejamiento (cabecera x-movil-token)' } },
    async (req) => {
      const m = await delMovil(req);
      // `albaranes`: si hay lector de albaranes; sin él, el móvil no ofrece la opción.
      return { usuario: m.ctx.usuario.nombre, expiraAt: m.expiraAt, albaranes: !!d.lectorAlbaranes };
    },
  );

  const recepciones = new RecepcionesService(d);
  app.post(
    `${PREFIJO_MOVIL}/albaranes`,
    {
      schema: {
        tags: ['movil'],
        summary: 'Sube las fotos (o el PDF) de un albarán o factura; el PC recibe el aviso y lo leído',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      const m = await delMovil(req);
      const paginas: { bytes: Uint8Array; mime: string }[] = [];
      let total = 0;
      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;
        if (!MIMES_ALBARAN.includes(part.mimetype))
          throw new DomainError('VALIDACION', `Tipo de fichero no admitido: ${part.mimetype}`);
        const bytes = await part.toBuffer();
        total += bytes.length;
        // Se corta aquí, sin esperar al servicio: así no se acumulan en memoria más páginas de las permitidas.
        if (total > MAX_BYTES_ALBARAN)
          throw new DomainError(
            'VALIDACION',
            `El albarán pesa demasiado: ${MAX_BYTES_ALBARAN / 1024 / 1024} MB como máximo entre todas las páginas`,
          );
        paginas.push({ bytes, mime: part.mimetype });
      }
      if (!paginas.length)
        throw new DomainError('VALIDACION', 'Adjunta el albarán o la factura (foto o PDF)');
      await svc.publicar(m.sesionId, { tipo: 'leyendo' });
      try {
        const r = await recepciones.leerAlbaran(paginas, m.ctx);
        await svc.publicar(m.sesionId, { tipo: 'albaran', documentoId: r.documentoId });
      } catch (e) {
        // El PC deja de mostrar «leyendo» y avisa; el móvil recibe el error de siempre.
        await svc.publicar(m.sesionId, { tipo: 'albaran', documentoId: null });
        throw e;
      }
      return reply.status(201).send({ enviado: true });
    },
  );

  app.post(
    `${PREFIJO_MOVIL}/recetas`,
    {
      schema: {
        tags: ['movil'],
        summary: 'Sube las fotos de una receta; el PC abre su revisión',
        consumes: ['multipart/form-data'],
      },
    },
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
    {
      schema: {
        tags: ['movil'],
        summary: 'Envía al PC la lectura de un código del envase',
        body: z.object({ raw: z.string().min(1).max(512) }),
      },
    },
    async (req, reply) => {
      const m = await delMovil(req);
      await svc.publicar(m.sesionId, { tipo: 'codigo', raw: req.body.raw });
      return reply.status(204).send();
    },
  );
}
