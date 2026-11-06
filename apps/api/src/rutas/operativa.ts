import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { appendAudit, pedidoPendiente } from '@mmx/db';
import { DomainError, ConsultaStockRetrospectivoBody } from '@mmx/shared';
import type { AppDeps } from '../deps';
import { ROLES, requiereRol } from '../plugins/auth';
import {
  AnularDto,
  DispensacionDto,
  IdParam,
  LineaEntradaDto,
  PedidoDto,
  RecepcionDto,
  SustitucionAccionDto,
  SustitucionAccionParams,
  SustitucionCrearDto,
  EditarLineaEntradaDto,
  EditarRecepcionDto,
  CorregirRecepcionDto,
} from '../schemas';
import { DispensacionesService } from '../servicios/dispensaciones';
import { RecepcionesService } from '../servicios/recepciones';
import { SustitucionesService } from '../servicios/sustituciones';
import { ctx, type App } from './comun';

export async function rutasOperativa(app: App, d: AppDeps) {
  const disp = new DispensacionesService(d);
  const sust = new SustitucionesService(d);
  const rec = new RecepcionesService(d);
  const pre = requiereRol(...ROLES.operativa);

  // ── Dispensaciones ─────────────────────────────────────────────────────────────
  app.post(
    '/api/dispensaciones',
    {
      preHandler: pre,
      schema: {
        tags: ['dispensaciones'],
        summary: 'Confirma una dispensación (con o sin receta). El forzado se valida aquí.',
        body: DispensacionDto,
      },
    },
    async (req, reply) => {
      const b = req.body;
      const r = b.conReceta
        ? await disp.dispensarConReceta(b, ctx(req))
        : await disp.dispensarSinReceta(b, ctx(req));
      return reply.status(201).send(r);
    },
  );
  app.post(
    '/api/dispensaciones/:id/anular',
    {
      preHandler: pre,
      schema: {
        tags: ['dispensaciones'],
        summary: 'Anulación con motivo (contramovimiento), registrada por el empleado',
        params: IdParam,
        body: AnularDto,
      },
    },
    async (req) => disp.anular(req.params.id, req.body.motivo, ctx(req)),
  );
  app.post(
    '/api/inventario/movimientos/retrospectivo',
    {
      preHandler: pre,
      schema: {
        tags: ['inventario'],
        summary: 'Consulta movimientos históricos de stock en Siweb360 para formación (D-14)',
        body: ConsultaStockRetrospectivoBody,
      },
    },
    async (req) => disp.consultarMovimientosRetrospectivos(req.body, ctx(req)),
  );

  // ── Sustituciones ──────────────────────────────────────────────────────────────
  app.post(
    '/api/sustituciones',
    {
      preHandler: pre,
      schema: {
        tags: ['sustituciones'],
        summary: 'Inicia la sustitución con un sustituto propuesto',
        body: SustitucionCrearDto,
      },
    },
    async (req, reply) =>
      reply.status(201).send(await sust.crear(req.body.recetaId, req.body.lineaOrden, req.body.cn, ctx(req))),
  );
  app.get(
    '/api/sustituciones/:id',
    { preHandler: pre, schema: { tags: ['sustituciones'], params: IdParam } },
    async (req) => sust.detalle(req.params.id),
  );
  app.post(
    '/api/sustituciones/:id/:accion',
    {
      preHandler: pre,
      schema: {
        tags: ['sustituciones'],
        summary:
          'Transiciones: consentimiento, aviso-veterinario, autorizacion-garante, anotacion, firma-garante, rechazar (lo registra el empleado)',
        params: SustitucionAccionParams,
        body: SustitucionAccionDto,
      },
    },
    async (req) => sust.accion(req.params.id, req.params.accion, req.body ?? {}, ctx(req)),
  );

  // ── Recepciones ────────────────────────────────────────────────────────────────
  app.post(
    '/api/recepciones',
    { preHandler: pre, schema: { tags: ['recepciones'], body: RecepcionDto } },
    async (req, reply) => reply.status(201).send(await rec.crear(req.body, ctx(req))),
  );
  app.get(
    '/api/recepciones/proveedores',
    {
      preHandler: pre,
      schema: {
        tags: ['recepciones'],
        summary: 'Distribuidores conocidos: los de la app y los proveedores de Siweb360',
      },
    },
    async () => rec.proveedores(),
  );
  const MIMES_ALBARAN = ['image/png', 'image/jpeg', 'image/heic', 'image/webp', 'application/pdf'];
  app.post(
    '/api/recepciones/albaranes',
    {
      preHandler: pre,
      schema: {
        tags: ['recepciones'],
        summary:
          'Lee el albarán o la factura antes de crear la recepción: número, proveedor, fecha, líneas y posibles duplicados',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      const f = await req.file();
      if (!f) throw new DomainError('VALIDACION', 'Adjunta el albarán o la factura (foto o PDF)');
      if (!MIMES_ALBARAN.includes(f.mimetype))
        throw new DomainError('VALIDACION', `Tipo de fichero no admitido: ${f.mimetype}`);
      return reply
        .status(201)
        .send(
          await rec.leerAlbaran({ bytes: new Uint8Array(await f.toBuffer()), mime: f.mimetype }, ctx(req)),
        );
    },
  );
  app.get(
    '/api/recepciones/:id/documento',
    {
      preHandler: pre,
      schema: { tags: ['recepciones'], summary: 'Foto o PDF del albarán de la recepción', params: IdParam },
    },
    async (req, reply) => {
      const b = await rec.documento(req.params.id);
      return reply
        .header('Content-Type', b.mime)
        .header('Cache-Control', 'private, max-age=300')
        .send(Buffer.from(b.bytes));
    },
  );
  app.get('/api/recepciones', { preHandler: pre, schema: { tags: ['recepciones'] } }, async () =>
    rec.listar(),
  );
  app.get(
    '/api/recepciones/:id',
    { preHandler: pre, schema: { tags: ['recepciones'], params: IdParam } },
    async (req) => rec.detalle(req.params.id),
  );
  app.put(
    '/api/recepciones/:id',
    {
      preHandler: pre,
      schema: {
        tags: ['recepciones'],
        summary: 'Cambia la cabecera de una recepción abierta',
        params: IdParam,
        body: EditarRecepcionDto,
      },
    },
    async (req) => rec.editar(req.params.id, req.body, ctx(req)),
  );
  app.post(
    '/api/recepciones/:id/correccion',
    {
      preHandler: pre,
      schema: {
        tags: ['recepciones'],
        summary: 'Corrige la cabecera de una recepción finalizada (con motivo, queda auditado)',
        params: IdParam,
        body: CorregirRecepcionDto,
      },
    },
    async (req) => rec.corregir(req.params.id, req.body, ctx(req)),
  );
  app.post(
    '/api/recepciones/:id/descartar',
    {
      preHandler: pre,
      schema: {
        tags: ['recepciones'],
        summary: 'Descarta una recepción abierta (no se borra)',
        params: IdParam,
        body: z.object({ motivo: z.string() }),
      },
    },
    async (req, reply) => {
      await rec.descartar(req.params.id, req.body.motivo, ctx(req));
      return reply.status(204).send();
    },
  );
  app.post(
    '/api/recepciones/:id/lineas',
    { preHandler: pre, schema: { tags: ['recepciones'], params: IdParam, body: LineaEntradaDto } },
    async (req, reply) => reply.status(201).send(await rec.anadirLinea(req.params.id, req.body, ctx(req))),
  );
  app.post(
    '/api/recepciones/:id/documento',
    {
      preHandler: pre,
      schema: {
        tags: ['recepciones'],
        summary: 'Lee el albarán o la factura (Document Intelligence) y propone las líneas',
        params: IdParam,
        consumes: ['multipart/form-data'],
      },
    },
    async (req) => {
      const f = await req.file();
      if (!f) throw new DomainError('VALIDACION', 'Adjunta el albarán o la factura (foto o PDF)');
      if (!['image/png', 'image/jpeg', 'image/heic', 'image/webp', 'application/pdf'].includes(f.mimetype))
        throw new DomainError('VALIDACION', `Tipo de fichero no admitido: ${f.mimetype}`);
      return rec.leerDocumento(
        req.params.id,
        { bytes: new Uint8Array(await f.toBuffer()), mime: f.mimetype },
        ctx(req),
      );
    },
  );
  app.put(
    '/api/recepciones/:id/lineas/:lineaId',
    {
      preHandler: pre,
      schema: {
        tags: ['recepciones'],
        summary: 'Modifica una línea de una recepción abierta',
        params: z.object({ id: z.uuid(), lineaId: z.uuid() }),
        body: EditarLineaEntradaDto,
      },
    },
    async (req) => rec.editarLinea(req.params.id, req.params.lineaId, req.body, ctx(req)),
  );
  app.delete(
    '/api/recepciones/:id/lineas/:lineaId',
    {
      preHandler: pre,
      schema: { tags: ['recepciones'], params: z.object({ id: z.uuid(), lineaId: z.uuid() }) },
    },
    async (req, reply) => {
      await rec.eliminarLinea(req.params.id, req.params.lineaId);
      return reply.status(204).send();
    },
  );
  app.post(
    '/api/recepciones/:id/finalizar',
    { preHandler: pre, schema: { tags: ['recepciones'], params: IdParam } },
    async (req) => rec.finalizar(req.params.id, ctx(req)),
  );

  // ── Pedidos pendientes (la compra se hace fuera del sistema en v1) ──────────────
  app.get(
    '/api/pedidos',
    {
      preHandler: pre,
      schema: { tags: ['pedidos'], querystring: z.object({ estado: z.string().optional() }) },
    },
    async (req) => {
      const q = d.db.select().from(pedidoPendiente);
      const filas = await (req.query.estado ? q.where(eq(pedidoPendiente.estado, req.query.estado)) : q)
        .orderBy(desc(pedidoPendiente.createdAt))
        .limit(200);
      return filas.map(({ contactoTutorEnc, ...p }) => ({ ...p, tieneContacto: !!contactoTutorEnc }));
    },
  );
  app.post(
    '/api/pedidos',
    { preHandler: pre, schema: { tags: ['pedidos'], body: PedidoDto } },
    async (req, reply) => {
      const c = ctx(req);
      const row = await d.db.transaction(async (tx) => {
        const [p] = await tx
          .insert(pedidoPendiente)
          .values({
            cn: req.body.cn,
            nregistro: req.body.nregistro,
            unidades: req.body.unidades,
            motivo: req.body.motivo,
            recetaLineaId: req.body.recetaLineaId,
            contactoTutorEnc: d.cipher.encrypt(req.body.contactoTutor),
            creadoPor: c.usuario.id,
          })
          .returning({ id: pedidoPendiente.id });
        await appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'pedido_crear',
          entidad: 'pedido_pendiente',
          entidadId: p!.id,
          despues: { cn: req.body.cn, unidades: req.body.unidades },
        });
        return p!;
      });
      return reply.status(201).send(row);
    },
  );
  app.post(
    '/api/pedidos/:id/:estado',
    {
      preHandler: pre,
      schema: {
        tags: ['pedidos'],
        params: z.object({ id: z.uuid(), estado: z.enum(['recibido', 'entregado', 'cancelado']) }),
      },
    },
    async (req) => {
      const c = ctx(req);
      const [p] = await d.db
        .update(pedidoPendiente)
        .set({ estado: req.params.estado })
        .where(and(eq(pedidoPendiente.id, req.params.id)))
        .returning();
      if (!p) throw new DomainError('NO_ENCONTRADO');
      await d.db.transaction((tx) =>
        appendAudit(tx, {
          actor: c.usuario.id,
          accion: `pedido_${req.params.estado}`,
          entidad: 'pedido_pendiente',
          entidadId: p.id,
        }),
      );
      return { id: p.id, estado: p.estado };
    },
  );
}
