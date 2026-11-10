import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  appendAudit,
  outbox,
  distribuidor,
  plataformaRecetaElectronica,
  reglaVersion,
  siwebTarea,
  siwebVariantMap,
  sustitucionExclusion,
} from '@mmx/db';
import { DomainError, LimiteConsumoBody, PruebaEscrituraBody } from '@mmx/shared';
import {
  ACCION_PRUEBA_ESCRITURA,
  ejecutarSpike,
  esPruebaVigente,
  movimientosSinJustificar,
  ultimaPruebaEscritura,
} from '@mmx/siweb';
import { ahoraDe, type AppDeps } from '../deps';
import { ROLES, exigirMfa, requiereRol } from '../plugins/auth';
import { IdParam } from '../schemas';
import { ConsumoRepo } from '../servicios/asistente-consumo';
import { ctx, type App } from './comun';

/** Administración (SPEC §8.11): mapeo CN↔Siweb360, distribuidores, reglas, exclusiones, outbox, CIMAVet. */
export async function rutasAdmin(app: App, d: AppDeps) {
  const admin = requiereRol(...ROLES.admin);
  const siweb = () => {
    if (!d.siweb) throw new DomainError('SIWEB_NO_DISPONIBLE', 'Siweb360 no está configurado (modo demo)');
    return d.siweb;
  };
  /** Llamadas a Siweb360 desde la operativa: si no responde, un error claro en lugar de un error interno. */
  const conSiweb = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError(
        'SIWEB_NO_DISPONIBLE',
        'Siweb360 no responde ahora. Vuelve a intentarlo en unos segundos.',
      );
    }
  };

  // ── Asistente de consultas: consumo mensual (FR-027b) ──────────────────────────────
  const consumo = new ConsumoRepo(d.db, d.config);
  app.get(
    '/api/admin/asistente/consumo',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary: 'Consumo del asistente: mes en curso y meses anteriores',
        querystring: z.object({ meses: z.coerce.number().int().min(1).max(36).default(6) }),
      },
    },
    async (req) => {
      const ahora = ahoraDe(d);
      return {
        actual: consumo.dto(await consumo.mes(ahora)),
        historico: (await consumo.historico(ahora, req.query.meses)).map((m) => consumo.dto(m)),
      };
    },
  );
  app.put(
    '/api/admin/asistente/consumo/limite',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary: 'Amplía el límite de tokens del mes en curso',
        body: LimiteConsumoBody,
      },
    },
    async (req) => {
      exigirMfa(req);
      const c = ctx(req);
      const { antes, despues } = await consumo.ampliar(ahoraDe(d), req.body.limiteTokens, c.usuario.id);
      await d.db.transaction((tx) =>
        appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'asistente_ampliar_limite',
          entidad: 'asistente_consumo_mes',
          entidadId: despues.fila.mes,
          antes: { limiteEfectivo: antes.limiteEfectivo },
          despues: { limiteEfectivo: despues.limiteEfectivo },
        }),
      );
      return consumo.dto(despues);
    },
  );

  // ── Distribuidores ─────────────────────────────────────────────────────────────
  app.get(
    '/api/admin/distribuidores',
    { preHandler: requiereRol(...ROLES.operativa, 'admin'), schema: { tags: ['admin'] } },
    async () => d.db.select().from(distribuidor).orderBy(asc(distribuidor.nombre)),
  );
  const DistDto = z.object({
    nombre: z.string().min(2).max(200),
    cif: z.string().max(20).nullable().default(null),
    activo: z.boolean().default(true),
  });
  app.post(
    '/api/admin/distribuidores',
    { preHandler: admin, schema: { tags: ['admin'], body: DistDto } },
    async (req, reply) => {
      const c = ctx(req);
      const [r] = await d.db.insert(distribuidor).values(req.body).returning();
      await d.db.transaction((tx) =>
        appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'distribuidor_crear',
          entidad: 'distribuidor',
          entidadId: r!.id,
          despues: req.body,
        }),
      );
      return reply.status(201).send(r);
    },
  );
  app.put(
    '/api/admin/distribuidores/:id',
    { preHandler: admin, schema: { tags: ['admin'], params: IdParam, body: DistDto } },
    async (req) => {
      const c = ctx(req);
      const [r] = await d.db
        .update(distribuidor)
        .set(req.body)
        .where(eq(distribuidor.id, req.params.id))
        .returning();
      if (!r) throw new DomainError('NO_ENCONTRADO');
      await d.db.transaction((tx) =>
        appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'distribuidor_editar',
          entidad: 'distribuidor',
          entidadId: r.id,
          despues: req.body,
        }),
      );
      return r;
    },
  );

  // ── Reglas (solo lectura del YAML activo y su aprobación) ──────────────────────
  app.get('/api/admin/reglas', { preHandler: admin, schema: { tags: ['admin'] } }, async () => ({
    version: d.rules.bundle.version,
    ficheros: await d.db
      .select()
      .from(reglaVersion)
      .where(eq(reglaVersion.activa, true))
      .orderBy(asc(reglaVersion.nombreFichero)),
  }));
  // El garante revisa las reglas fuera de la app; administración deja constancia de la activación (MFA).
  app.post(
    '/api/admin/reglas/:id/aprobar',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary: 'Registro de la aprobación de una versión de reglas (administración, MFA)',
        params: IdParam,
      },
    },
    async (req) => {
      exigirMfa(req);
      const c = ctx(req);
      const [r] = await d.db
        .update(reglaVersion)
        .set({ aprobadaPor: c.usuario.id, aprobadaAt: ahoraDe(d) })
        .where(eq(reglaVersion.id, req.params.id))
        .returning();
      if (!r) throw new DomainError('NO_ENCONTRADO');
      await d.db.transaction((tx) =>
        appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'reglas_aprobar',
          entidad: 'regla_version',
          entidadId: r.id,
          despues: { fichero: r.nombreFichero, hash: r.hash },
        }),
      );
      return r;
    },
  );

  // ── Exclusiones de sustitución (las indica el garante fuera de la app; las da de alta administración) ──
  app.get('/api/admin/exclusiones', { preHandler: admin, schema: { tags: ['admin'] } }, async () =>
    d.db.select().from(sustitucionExclusion).orderBy(desc(sustitucionExclusion.createdAt)),
  );
  app.post(
    '/api/admin/exclusiones',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        body: z
          .object({
            nregistro: z.string().nullable().default(null),
            paId: z.number().int().nullable().default(null),
            motivo: z.string().min(5),
            fuente: z.string().min(3),
          })
          .refine((b) => b.nregistro || b.paId, 'nregistro o paId'),
      },
    },
    async (req, reply) => {
      const c = ctx(req);
      const [r] = await d.db
        .insert(sustitucionExclusion)
        .values({ ...req.body, altaPor: c.usuario.id })
        .returning();
      await d.db.transaction((tx) =>
        appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'exclusion_crear',
          entidad: 'sustitucion_exclusion',
          entidadId: r!.id,
          despues: req.body,
        }),
      );
      return reply.status(201).send(r);
    },
  );

  // ── Plataformas de receta electrónica (D-14) ──────────────────────────────────
  app.get(
    '/api/admin/plataformas',
    { preHandler: requiereRol(...ROLES.operativa, 'admin'), schema: { tags: ['admin'] } },
    async () =>
      d.db.select().from(plataformaRecetaElectronica).orderBy(asc(plataformaRecetaElectronica.nombre)),
  );
  app.put(
    '/api/admin/plataformas/:id',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary: 'Marca si la plataforma figura en el listado del MAPA',
        params: z.object({ id: z.string() }),
        body: z.object({
          reconocidaMapa: z.boolean().nullable(),
          urlVerificacion: z.url().nullable().default(null),
        }),
      },
    },
    async (req) => {
      const c = ctx(req);
      const [r] = await d.db
        .update(plataformaRecetaElectronica)
        .set({
          reconocidaMapa: req.body.reconocidaMapa,
          urlVerificacion: req.body.urlVerificacion,
          verificadaPor: c.usuario.id,
          verificadaAt: ahoraDe(d),
        })
        .where(eq(plataformaRecetaElectronica.id, req.params.id))
        .returning();
      if (!r) throw new DomainError('NO_ENCONTRADO');
      await d.db.transaction((tx) =>
        appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'plataforma_verificar',
          entidad: 'plataforma_receta_electronica',
          entidadId: r.id,
          despues: req.body,
        }),
      );
      return r;
    },
  );

  // ── Mapeo CN ↔ Siweb360 y bandeja "Pendiente en Siweb360" ─────────────────────
  app.get('/api/admin/mapeo-siweb', { preHandler: admin, schema: { tags: ['admin'] } }, async () => ({
    mapeos: await d.db.select().from(siwebVariantMap).orderBy(asc(siwebVariantMap.cn)),
    tareas: await d.db
      .select()
      .from(siwebTarea)
      .where(eq(siwebTarea.estado, 'pendiente'))
      .orderBy(asc(siwebTarea.createdAt)),
  }));
  app.post(
    '/api/admin/mapeo-siweb/resolver',
    {
      preHandler: requiereRol(...ROLES.operativa, 'admin'),
      schema: { tags: ['admin'], body: z.object({ cn: z.string().regex(/^\d{6,7}$/) }) },
    },
    async (req) => {
      const pres = await d.cimavet.presentacion(req.body.cn);
      const m = pres ? await d.cimavet.medicamento(pres.nregistro) : null;
      return conSiweb(() =>
        siweb().resolver.resolver(req.body.cn, m ? { nombre: m.nombre, labtitular: m.labtitular } : null),
      );
    },
  );
  app.put(
    '/api/admin/mapeo-siweb',
    {
      preHandler: requiereRol(...ROLES.operativa, 'admin'),
      schema: {
        tags: ['admin'],
        summary: 'Mapeo manual: por candidato (variantId) o por SKU',
        body: z.object({
          cn: z.string().regex(/^\d{6,7}$/),
          variantId: z.number().int().optional(),
          sku: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const c = ctx(req);
      const s = siweb();
      if (req.body.variantId === undefined && !req.body.sku?.trim())
        throw new DomainError('VALIDACION', 'Indica el SKU de Siweb360', { campo: 'sku' });
      const r = await conSiweb(() =>
        req.body.variantId !== undefined
          ? s.resolver.mapearVariante(req.body.cn, req.body.variantId, c.usuario.id)
          : s.resolver.mapearPorSku(req.body.cn, req.body.sku ?? '', c.usuario.id),
      );
      await d.db.transaction((tx) =>
        appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'siweb_mapeo_manual',
          entidad: 'siweb_variant_map',
          entidadId: req.body.cn,
          despues: { variantId: r.variante.id, sku: r.variante.sku },
        }),
      );
      const reencoladas = await s.outbox.reencolarPendientesAlta(req.body.cn, r.variante.id);
      return { ...r, reencoladas, preguntarRenombrado: !r.cumpleConvencion };
    },
  );
  app.post(
    '/api/admin/mapeo-siweb/tareas',
    {
      preHandler: requiereRol(...ROLES.operativa, 'admin'),
      schema: {
        tags: ['admin'],
        summary:
          'Crea una tarea de alta o renombrado en Siweb360 con propuesta de SKU (correlativo reservado)',
        body: z.object({
          tipo: z.enum(['crear', 'renombrar']),
          cn: z.string().regex(/^\d{6,7}$/),
          variantId: z.number().int().optional(),
          prefijoConfirmado: z.string().optional(),
          origen: z.enum(['recepcion_linea', 'mapeo', 'dispensacion']).default('mapeo'),
          origenId: z.string().nullable().default(null),
        }),
      },
    },
    async (req, reply) => {
      const c = ctx(req);
      const pres = await d.cimavet.presentacion(req.body.cn);
      const m = pres ? await d.cimavet.medicamento(pres.nregistro) : null;
      if (!pres || !m?.labtitular)
        throw new DomainError('NO_ENCONTRADO', 'Medicamento o laboratorio no encontrado en CIMAVet');
      const s = siweb();
      const r =
        req.body.tipo === 'crear'
          ? await s.catalogo.solicitarAlta({
              cn: req.body.cn,
              nregistro: m.nregistro,
              nombre: pres.nombre,
              labtitular: m.labtitular,
              origen: req.body.origen,
              origenId: req.body.origenId,
              actor: c.usuario.id,
              ...(req.body.prefijoConfirmado ? { prefijoConfirmado: req.body.prefijoConfirmado } : {}),
            })
          : await s.catalogo.solicitarRenombrado({
              cn: req.body.cn,
              nregistro: m.nregistro,
              variante: await (async () => {
                const v = await s.resolver.mapeos(req.body.cn);
                const id = req.body.variantId ?? v[0]?.variantId;
                if (!id) throw new DomainError('NO_ENCONTRADO', 'Sin variante mapeada');
                return {
                  id,
                  sku: v.find((x) => x.variantId === id)?.sku ?? null,
                  name: null,
                  product_name: pres.nombre,
                };
              })(),
              labtitular: m.labtitular,
              actor: c.usuario.id,
              ...(req.body.prefijoConfirmado ? { prefijoConfirmado: req.body.prefijoConfirmado } : {}),
            });
      if ('tareaId' in r)
        await d.db.transaction((tx) =>
          appendAudit(tx, {
            actor: c.usuario.id,
            accion: `siweb_tarea_${req.body.tipo}`,
            entidad: 'siweb_tarea',
            entidadId: r.tareaId,
            despues: r.propuesta,
          }),
        );
      return reply.status('tareaId' in r ? 201 : 200).send(r);
    },
  );
  app.post(
    '/api/admin/mapeo-siweb/tareas/:id/hecha',
    { preHandler: requiereRol(...ROLES.operativa, 'admin'), schema: { tags: ['admin'], params: IdParam } },
    async (req) => {
      const c = ctx(req);
      const s = siweb();
      const [t] = await d.db.select().from(siwebTarea).where(eq(siwebTarea.id, req.params.id));
      const r = await s.bandeja.marcarHecha(req.params.id, c.usuario.id);
      const reencoladas = t ? await s.outbox.reencolarPendientesAlta(t.cn, r.variantId) : 0;
      return { ...r, reencoladas };
    },
  );
  app.post(
    '/api/admin/mapeo-siweb/tareas/:id/descartar',
    {
      preHandler: admin,
      schema: { tags: ['admin'], params: IdParam, body: z.object({ motivo: z.string().min(3) }) },
    },
    async (req) => {
      await siweb().bandeja.descartar(req.params.id, ctx(req).usuario.id, req.body.motivo);
      return { ok: true };
    },
  );

  // ── Outbox y reconciliación ────────────────────────────────────────────────────
  app.get(
    '/api/admin/outbox',
    {
      preHandler: admin,
      schema: { tags: ['admin'], querystring: z.object({ estado: z.string().optional() }) },
    },
    async (req) => {
      const s = siweb();
      const filas = await s.outbox.listar(req.query.estado ? req.query.estado.split(',') : undefined);
      return Promise.all(
        filas.map(async (f) => ({
          ...f,
          // Para decidir una reconciliación, la persona ve el stock actual de la variante.
          stockActual:
            f.status === 'needs_reconciliation'
              ? await s.stockActual((f.payload as { variant_id: number }).variant_id).catch(() => null)
              : null,
          proximaComprobacion: f.nextAttemptAt,
          evidencia: f.status === 'needs_reconciliation' ? f.lastError : null,
        })),
      );
    },
  );
  app.post(
    '/api/admin/outbox/:id/resolver',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        params: IdParam,
        body: z.object({
          accion: z.enum(['confirmar_aplicada', 'reenviar', 'descartar']),
          nota: z.string().min(5),
        }),
      },
    },
    async (req) => {
      await siweb().outbox.resolver(req.params.id, req.body.accion, ctx(req).usuario.id, req.body.nota);
      return { ok: true };
    },
  );

  app.post(
    '/api/admin/recepciones/:id/enviar-siweb',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary:
          'Envía a Siweb360 el stock de una recepción finalizada con la escritura apagada (a petición expresa)',
        params: IdParam,
        body: z.object({ nota: z.string().trim().min(5) }),
      },
    },
    async (req) =>
      siweb().outbox.enviarRecepcionDesactivada(req.params.id, ctx(req).usuario.id, req.body.nota),
  );

  // ── Escritura de stock en Siweb360: estado y prueba de escritura (specs/011) ─────────────
  app.get(
    '/api/admin/estado-stock',
    {
      preHandler: admin,
      schema: { tags: ['admin'], summary: 'Estado de la escritura de stock en Siweb360' },
    },
    async () => {
      const ultima = await ultimaPruebaEscritura(d.db);
      const cuenta = await d.db
        .select({ status: outbox.status, n: sql<number>`count(*)::int` })
        .from(outbox)
        .where(inArray(outbox.status, ['pending', 'failed', 'needs_reconciliation']))
        .groupBy(outbox.status);
      const n = (st: string) => cuenta.find((c) => c.status === st)?.n ?? 0;
      return {
        escrituraStock: d.config.SIWEB_STOCK_WRITE_MODE,
        fechaCorte: d.config.ENTRY_CUTOVER_DATE ?? null,
        almacenStock: d.config.SIWEB_WAREHOUSE_NAME,
        ultimaPruebaEscritura: ultima,
        pruebaEscrituraVigente: esPruebaVigente(ultima, ahoraDe(d)),
        outbox: { pendientes: n('pending'), fallidos: n('failed'), enRevision: n('needs_reconciliation') },
        movimientosSinJustificar: d.config.ENTRY_CUTOVER_DATE
          ? (await movimientosSinJustificar(d.db, { corte: d.config.ENTRY_CUTOVER_DATE })).length
          : 0,
      };
    },
  );
  app.post(
    '/api/admin/siweb/prueba-escritura',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary: 'Prueba de escritura en una variante TEST- (SPEC §12.3): +1 y −1, y comprueba el historial',
        body: PruebaEscrituraBody,
      },
    },
    async (req) => {
      const client = siweb().client;
      if (!client) throw new DomainError('SIWEB_NO_DISPONIBLE', 'Siweb360 no está configurado');
      const { sku } = req.body;
      const registrar = (despues: Record<string, unknown>) =>
        d.db.transaction((tx) =>
          appendAudit(tx, {
            actor: ctx(req).usuario.id,
            accion: ACCION_PRUEBA_ESCRITURA,
            entidad: 'siweb',
            entidadId: sku,
            despues,
          }),
        );
      // Se comprueba aquí además de en ejecutarSpike: nunca se escribe en un producto real.
      if (!sku.startsWith('TEST-')) {
        await registrar({ ok: false, motivo: 'SKU_NO_TEST', sku });
        throw new DomainError('SKU_NO_TEST', 'El SKU de la prueba debe empezar por TEST-');
      }
      const r = await conSiweb(() =>
        ejecutarSpike({
          client,
          sku,
          almacen: { nombre: d.config.SIWEB_WAREHOUSE_NAME, id: d.config.SIWEB_WAREHOUSE_ID },
          // La confirmación es el «SI» escrito en el formulario (PruebaEscrituraBody).
          preguntar: async () => 'SI',
          log: (m) => req.log.info({ prueba: m }, 'prueba de escritura'),
          hoy: ahoraDe(d),
        }),
      );
      const resumen = r.ok
        ? {
            ok: true,
            coherente: r.coherente,
            historialOk: r.historialOk,
            sku,
            variantId: r.variantId,
            lote: r.lote,
            movimientos: r.movimientos,
          }
        : { ok: false, motivo: r.motivo, sku };
      await registrar(resumen);
      return resumen;
    },
  );

  // ── Estado de la sincronización con CIMAVet ───────────────────────────────────
  app.get('/api/admin/cimavet', { preHandler: admin, schema: { tags: ['admin'] } }, async () => ({
    ultimas: await d.cimavet.ultimasSync(20),
  }));

  // ── Tareas pendientes en Siweb360 (todas, para la UI) ─────────────────────────
  app.get(
    '/api/admin/tareas-siweb',
    { preHandler: requiereRol(...ROLES.operativa, 'admin'), schema: { tags: ['admin'] } },
    async () =>
      d.db
        .select()
        .from(siwebTarea)
        .where(and(eq(siwebTarea.estado, 'pendiente')))
        .orderBy(asc(siwebTarea.createdAt)),
  );
}
