import { z } from 'zod';
import {
  RecetaConfirmada,
  DomainError,
  PeticionAltaManual,
  PeticionSobreescribirSustitucion,
} from '@mmx/shared';
import type { AppDeps } from '../deps';
import { ROLES, requiereRol, usuario } from '../plugins/auth';
import { EvaluarBody, IdParam } from '../schemas';
import { RecetasService } from '../servicios/recetas';
import { ConciliacionService } from '../servicios/conciliacion';
import type { FastifyRequest } from 'fastify';
import { ctx, type App } from './comun';

const MIMES = ['image/png', 'image/jpeg', 'image/heic', 'application/pdf'];

/** Páginas de una receta subidas en multipart (`pagina` + `phash`; `fixture` solo fuera de producción). */
export async function leerPaginas(req: FastifyRequest, d: AppDeps) {
  const paginas: { bytes: Uint8Array; mime: string; phash: string | null }[] = [];
  const phashes: string[] = [];
  let fixture: string | undefined;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (!MIMES.includes(part.mimetype))
        throw new DomainError('VALIDACION', `Tipo de fichero no admitido: ${part.mimetype}`);
      paginas.push({ bytes: new Uint8Array(await part.toBuffer()), mime: part.mimetype, phash: null });
    } else if (part.fieldname === 'phash') phashes.push(String(part.value));
    else if (part.fieldname === 'fixture' && d.config.NODE_ENV !== 'production') fixture = String(part.value);
  }
  paginas.forEach(
    (p, i) =>
      (p.phash = phashes[i] && /^[0-9a-f]{16}$/.test(phashes[i] as string) ? (phashes[i] as string) : null),
  );
  return { paginas, fixture };
}

export async function rutasRecetas(app: App, d: AppDeps) {
  const svc = new RecetasService(d);
  const operativa = requiereRol(...ROLES.operativa);
  // Rutas de una receta concreta: además, las de alta manual solo para la veterinaria responsable (specs/011).
  const pre = [
    operativa,
    async (req: FastifyRequest) => {
      await svc.exigirAccesoManual((req.params as { id: string }).id, usuario(req));
    },
  ];

  app.post(
    '/api/recetas',
    {
      preHandler: operativa,
      schema: {
        tags: ['recetas'],
        summary: 'Crea una receta, sube sus páginas y lanza la extracción (multipart)',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      const { paginas, fixture } = await leerPaginas(req, d);
      const r = await svc.crear(paginas, ctx(req), fixture ? { fixture } : {});
      return reply.status(201).send(r);
    },
  );

  app.post(
    '/api/recetas/manual',
    {
      preHandler: requiereRol(...ROLES.altaManual),
      schema: {
        tags: ['recetas'],
        summary: 'Alta manual de una receta sin imagen (solo veterinaria responsable)',
        body: PeticionAltaManual,
      },
    },
    async (req, reply) => reply.status(201).send(await svc.crearManual(req.body, ctx(req))),
  );

  app.get(
    '/api/recetas/:id',
    { preHandler: pre, schema: { tags: ['recetas'], params: IdParam } },
    async (req) => svc.obtener(req.params.id),
  );

  app.post(
    '/api/recetas/:id/imagenes',
    {
      preHandler: requiereRol(...ROLES.altaManual),
      schema: {
        tags: ['recetas'],
        summary: 'Adjunta la imagen de una receta de alta manual, sin extracción (multipart)',
        consumes: ['multipart/form-data'],
        params: IdParam,
      },
    },
    async (req, reply) => {
      const { paginas } = await leerPaginas(req, d);
      return reply.status(201).send(await svc.adjuntarImagen(req.params.id, paginas, ctx(req)));
    },
  );

  app.get(
    '/api/recetas/:id/imagenes/:pagina',
    {
      preHandler: pre,
      schema: {
        tags: ['recetas'],
        params: z.object({ id: z.uuid(), pagina: z.coerce.number().int().positive() }),
      },
    },
    async (req, reply) => {
      const img = await svc.imagen(req.params.id, req.params.pagina);
      return reply
        .header('Content-Type', img.mime)
        .header('Cache-Control', 'private, max-age=300')
        .send(Buffer.from(img.bytes));
    },
  );

  app.put(
    '/api/recetas/:id/confirmacion',
    {
      preHandler: pre,
      schema: {
        tags: ['recetas'],
        summary: 'Guarda los campos confirmados por la persona',
        params: IdParam,
        body: RecetaConfirmada,
      },
    },
    async (req) => svc.confirmar(req.params.id, req.body, ctx(req)),
  );

  app.put(
    '/api/recetas/:id/registro',
    {
      preHandler: pre,
      schema: {
        tags: ['recetas'],
        summary: 'Completa los datos para el registro (también tras dispensar)',
        params: IdParam,
        body: RecetaConfirmada,
      },
    },
    async (req) => {
      const r = await svc.completarRegistro(req.params.id, req.body, ctx(req));
      // Con el registro completo, la salida se concilia con el ticket del TPV (si ya se ha cobrado).
      return {
        ...r,
        conciliacion: await new ConciliacionService(d).conciliarReceta(req.params.id, ctx(req)),
      };
    },
  );

  app.post(
    '/api/recetas/:id/validez',
    {
      preHandler: pre,
      schema: {
        tags: ['recetas'],
        summary: 'Validez (y si está caducada) con los datos del formulario, sin guardarlos',
        params: IdParam,
        body: RecetaConfirmada,
      },
    },
    async (req) => ({ validez: await svc.validez(req.params.id, req.body) }),
  );

  app.post(
    '/api/recetas/:id/comprobar',
    {
      preHandler: pre,
      schema: {
        tags: ['recetas'],
        summary:
          'Comprobación documental (datos obligatorios, validez…) de lo guardado, sin stock ni decisiones',
        params: IdParam,
      },
    },
    async (req) => svc.comprobar(req.params.id),
  );

  app.post(
    '/api/recetas/:id/evaluar',
    {
      preHandler: pre,
      schema: {
        tags: ['recetas'],
        summary: 'Reglas + resolución + stock → decisión por línea',
        params: IdParam,
        body: EvaluarBody,
      },
    },
    async (req) => {
      const forzados = Object.fromEntries(
        Object.entries(req.body?.forzados ?? {}).map(([k, v]) => [Number(k), v]),
      );
      return svc.evaluar(req.params.id, ctx(req), forzados, true, req.body?.fechaReferencia ?? null);
    },
  );

  app.post(
    '/api/recetas/:id/lineas/:orden/sustituir-manual',
    {
      preHandler: pre,
      schema: {
        tags: ['recetas'],
        summary: 'Sobreescribe la sustitución de una línea de receta con motivo obligatorio (FR-017)',
        params: z.object({ id: z.string().uuid(), orden: z.coerce.number().int().positive() }),
        body: PeticionSobreescribirSustitucion,
      },
    },
    async (req) => svc.sustituirManual(req.params.id, req.params.orden, req.body, ctx(req)),
  );
}
