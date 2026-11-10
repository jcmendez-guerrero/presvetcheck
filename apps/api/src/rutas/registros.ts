import {
  DomainError,
  AsociarTicketBody,
  BuscarTicketsQuery,
  DesvincularTicketBody,
  VincularTicketBody,
} from '@mmx/shared';
import {
  aCsv,
  aXlsx,
  tablaEntradas,
  tablaMovimientos,
  tablaBajas,
  tablaPsicotropos,
  tablaTodasSalidas,
  tablasSalidas,
} from '@mmx/reports';
import type { AppDeps } from '../deps';
import { appendAudit } from '@mmx/db';
import { ROLES, exigirMfa, requiereRol, usuario } from '../plugins/auth';
import { IdParam, RegistrosQuery, ResolverDiscrepanciaDto } from '../schemas';
import { PendientesService } from '../servicios/pendientes';
import { ConciliacionService } from '../servicios/conciliacion';
import { ImportacionesService } from '../servicios/importaciones';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { IsoDate } from '@mmx/shared';
import { RegistrosService } from '@mmx/reports';
import { ctx, enviarFichero, type App } from './comun';

export async function rutasRegistros(app: App, d: AppDeps) {
  const reg = new RegistrosService(d);
  const pend = new PendientesService(d);
  const lectura = requiereRol(...ROLES.lecturaRegistros);

  app.get(
    '/api/registros/salidas',
    {
      preHandler: lectura,
      schema: {
        tags: ['registros'],
        summary: 'Exportación de salidas (plantillas A/B/C de SPEC §4.8)',
        querystring: RegistrosQuery,
      },
    },
    async (req, reply) => {
      const q = req.query;
      const u = usuario(req);
      // DNI completo solo para administración con MFA y queda auditado (p. ej. requerimiento de la
      // inspección); el resto lo ve enmascarado (D-07). El garante no usa la app.
      const dniCompleto = q.dniCompleto === '1';
      if (dniCompleto) {
        if (!u.roles.includes('admin'))
          throw new DomainError('PROHIBIDO', 'El DNI completo solo lo exporta administración');
        exigirMfa(req);
        await d.db.transaction((tx) =>
          appendAudit(tx, {
            actor: u.id,
            accion: 'exportar_dni_completo',
            entidad: 'registro_salidas',
            entidadId: null,
            despues: { desde: q.desde, hasta: q.hasta, plantilla: q.plantilla },
          }),
        );
      }
      const salidas = await reg.salidas(q.desde, q.hasta, {
        incluirPropietario: q.incluirPropietario === '1',
        dniCompleto,
      });
      const tablas = tablasSalidas(salidas, q.plantilla, {
        incluirPropietario: q.incluirPropietario === '1',
        internas: q.internas,
      });
      const base = `salidas-${q.plantilla}-${q.desde}_${q.hasta}`;
      if (q.formato === 'csv')
        return enviarFichero(reply, `${base}.csv`, 'text/csv; charset=utf-8', aCsv(tablas[0]!));
      if (q.formato === 'xlsx')
        return enviarFichero(
          reply,
          `${base}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          await aXlsx(tablas),
        );
      return { tablas };
    },
  );

  app.get(
    '/api/registros/entradas',
    { preHandler: lectura, schema: { tags: ['registros'], querystring: RegistrosQuery } },
    async (req, reply) => {
      const t = tablaEntradas(await reg.entradas(req.query.desde, req.query.hasta));
      const base = `entradas-${req.query.desde}_${req.query.hasta}`;
      if (req.query.formato === 'csv')
        return enviarFichero(reply, `${base}.csv`, 'text/csv; charset=utf-8', aCsv(t));
      if (req.query.formato === 'xlsx')
        return enviarFichero(
          reply,
          `${base}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          await aXlsx([t]),
        );
      return { tablas: [t] };
    },
  );

  // Informes de conjunto: todas las salidas (A, B y C juntas) y todos los movimientos (entradas y salidas).
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  app.get(
    '/api/registros/todas-salidas',
    {
      preHandler: lectura,
      schema: {
        tags: ['registros'],
        summary: 'Todas las salidas del periodo en una tabla',
        querystring: RegistrosQuery,
      },
    },
    async (req, reply) => {
      const incluirPropietario = req.query.incluirPropietario === '1';
      const t = tablaTodasSalidas(
        await reg.salidas(req.query.desde, req.query.hasta, { incluirPropietario, dniCompleto: false }),
        { incluirPropietario },
      );
      const base = `todas-las-salidas-${req.query.desde}_${req.query.hasta}`;
      if (req.query.formato === 'csv')
        return enviarFichero(reply, `${base}.csv`, 'text/csv; charset=utf-8', aCsv(t));
      if (req.query.formato === 'xlsx') return enviarFichero(reply, `${base}.xlsx`, XLSX, await aXlsx([t]));
      return { tablas: [t] };
    },
  );
  app.get(
    '/api/registros/movimientos',
    {
      preHandler: lectura,
      schema: {
        tags: ['registros'],
        summary: 'Entradas y salidas del periodo por fecha',
        querystring: RegistrosQuery,
      },
    },
    async (req, reply) => {
      const entradas = await reg.entradas(req.query.desde, req.query.hasta);
      const incluirPropietario = req.query.incluirPropietario === '1';
      const salidas = await reg.salidas(req.query.desde, req.query.hasta, {
        incluirPropietario,
        dniCompleto: false,
      });
      const base = `entradas-y-salidas-${req.query.desde}_${req.query.hasta}`;
      // Un mismo documento con las entradas y las salidas en hojas distintas (no mezcladas).
      if (req.query.formato === 'xlsx')
        return enviarFichero(
          reply,
          `${base}.xlsx`,
          XLSX,
          await aXlsx([tablaEntradas(entradas), tablaTodasSalidas(salidas, { incluirPropietario })]),
        );
      if (req.query.formato === 'csv')
        throw new DomainError(
          'VALIDACION',
          'Las entradas y las salidas van en hojas distintas: descárgalo en Excel (XLSX)',
        );
      // En pantalla, juntas por fecha con la columna «MOVIMIENTO» (entrada o salida).
      return { tablas: [tablaMovimientos(entradas, salidas)] };
    },
  );

  app.get(
    '/api/registros/psicotropos',
    {
      preHandler: lectura,
      schema: {
        tags: ['registros'],
        summary: 'Registro de psicótropos (TODO D-06b: formato oficial)',
        querystring: RegistrosQuery,
      },
    },
    async (req, reply) => {
      const t = tablaPsicotropos(await reg.psicotropos(req.query.desde, req.query.hasta));
      if (req.query.formato === 'xlsx')
        return enviarFichero(
          reply,
          `psicotropos-${req.query.desde}_${req.query.hasta}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          await aXlsx([t]),
        );
      if (req.query.formato === 'csv')
        return enviarFichero(
          reply,
          `psicotropos-${req.query.desde}_${req.query.hasta}.csv`,
          'text/csv; charset=utf-8',
          aCsv(t),
        );
      return { tablas: [t] };
    },
  );

  app.get(
    '/api/registros/bajas',
    {
      preHandler: lectura,
      schema: {
        tags: ['registros'],
        summary:
          'Bajas de stock justificadas (rotura, caducado, robo…) de los movimientos de Siweb360 (specs/011)',
        querystring: RegistrosQuery,
      },
    },
    async (req, reply) => {
      const t = tablaBajas(await reg.bajas(req.query.desde, req.query.hasta));
      if (req.query.formato === 'xlsx')
        return enviarFichero(
          reply,
          `bajas-${req.query.desde}_${req.query.hasta}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          await aXlsx([t]),
        );
      if (req.query.formato === 'csv')
        return enviarFichero(
          reply,
          `bajas-${req.query.desde}_${req.query.hasta}.csv`,
          'text/csv; charset=utf-8',
          aCsv(t),
        );
      return { tablas: [t] };
    },
  );

  // ── Importación de registros anteriores a la app ───────────────────────────────────
  // Cambia el registro legal: solo la veterinaria responsable y administración.
  const imp = new ImportacionesService(d);
  const importa = requiereRol('veterinaria_responsable', 'admin');
  const leerFichero = async (req: FastifyRequest) => {
    let tipo: string | null = null;
    let plantilla: string | null = null;
    let fichero: { nombre: string; bytes: Uint8Array } | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file')
        fichero = { nombre: part.filename, bytes: new Uint8Array(await part.toBuffer()) };
      else if (part.fieldname === 'tipo') tipo = String(part.value);
      else if (part.fieldname === 'plantilla') plantilla = String(part.value) || null;
    }
    if (tipo !== 'entradas' && tipo !== 'salidas')
      throw new DomainError('VALIDACION', 'Indica si el fichero es de entradas o de salidas', {
        campo: 'tipo',
      });
    if (plantilla !== null && !['A', 'B', 'C'].includes(plantilla))
      throw new DomainError('VALIDACION', 'Plantilla de salidas no válida', { campo: 'plantilla' });
    if (!fichero)
      throw new DomainError('VALIDACION', 'Adjunta el fichero (Excel o CSV)', { campo: 'fichero' });
    return { tipo: tipo as 'entradas' | 'salidas', plantilla: plantilla as 'A' | 'B' | 'C' | null, fichero };
  };
  app.post(
    '/api/importaciones/vista-previa',
    {
      preHandler: importa,
      schema: {
        tags: ['importacion'],
        summary: 'Analiza un fichero de entradas o salidas anteriores (sin guardar)',
        consumes: ['multipart/form-data'],
      },
    },
    async (req) => {
      const f = await leerFichero(req);
      return imp.vistaPrevia(f.tipo, f.fichero, f.plantilla);
    },
  );
  app.post(
    '/api/importaciones',
    {
      preHandler: importa,
      schema: {
        tags: ['importacion'],
        summary: 'Importa entradas o salidas anteriores (solo si el fichero no tiene errores)',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      const f = await leerFichero(req);
      return reply.status(201).send(await imp.importar(f.tipo, f.fichero, f.plantilla, ctx(req)));
    },
  );
  app.get('/api/importaciones', { preHandler: importa, schema: { tags: ['importacion'] } }, async () =>
    imp.listar(),
  );
  app.post(
    '/api/importaciones/:id/anular',
    {
      preHandler: importa,
      schema: {
        tags: ['importacion'],
        summary: 'Anula una importación (deja de contar; no se borra)',
        params: IdParam,
        body: z.object({ motivo: z.string().max(500) }),
      },
    },
    async (req, reply) => {
      await imp.anular(req.params.id, req.body.motivo, ctx(req));
      return reply.status(204).send();
    },
  );

  // ── Pendientes de la operativa (sustituciones en curso y discrepancias) ────────────
  const operativa = requiereRol(...ROLES.operativa);

  // ── Conciliación de salidas con los tickets del TPV ──────────────────────────────
  const conc = new ConciliacionService(d);
  app.post(
    '/api/conciliacion',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary:
          'Concilia las salidas de un día con los tickets (cierre=true: lo que quede sin pareja pasa a discrepancia)',
        body: z
          .object({ fecha: IsoDate.optional(), cierre: z.boolean().default(false) })
          .default({ cierre: false }),
      },
    },
    async (req) =>
      conc.conciliarDias([req.body?.fecha ?? conc.hoy()], ctx(req), {
        origen: req.body?.cierre ? 'cierre-manual' : 'bajo-demanda',
        cierre: req.body?.cierre ?? false,
      }),
  );
  app.get(
    '/api/recetas/:id/conciliacion',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary: 'Estado de conciliación de las salidas de la receta',
        params: IdParam,
      },
    },
    async (req) => ({
      configurado: conc.configurado,
      salidas: await conc.estadoReceta(req.params.id),
    }),
  );
  app.get(
    '/api/conciliacion/tickets',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary: 'Busca tickets en el TPV por número u observaciones para conciliación asistida',
        querystring: BuscarTicketsQuery,
      },
    },
    async (req) => conc.buscarTickets(req.query.search, req.query.estado),
  );
  app.post(
    '/api/conciliacion/asociar',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary: 'Asocia manualmente una salida de dispensación a un ticket del TPV',
        body: AsociarTicketBody,
      },
    },
    async (req) => conc.asociarManual(req.body, ctx(req)),
  );
  app.post(
    '/api/conciliacion/tickets/vincular',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary: 'Asocia un ticket del TPV a una receta (soporta multi-receta)',
        body: VincularTicketBody,
      },
    },
    async (req) => conc.vincularTicketReceta(req.body, ctx(req)),
  );
  app.post(
    '/api/conciliacion/tickets/desvincular',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary: 'Desvincula una receta de un ticket del TPV pendiente',
        body: DesvincularTicketBody,
      },
    },
    async (req) => conc.desvincularTicketReceta(req.body, ctx(req)),
  );
  app.get(
    '/api/conciliacion/tickets/:ticketId',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary: 'Obtiene el detalle y estado de conciliación consolidado de un ticket multi-receta',
        params: z.object({ ticketId: z.string().min(1) }),
      },
    },
    async (req) => conc.obtenerDetalleTicketMultiReceta(req.params.ticketId, ctx(req)),
  );
  app.post(
    '/api/conciliacion/tickets/:ticketId/confirmar',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary: 'Confirma la conciliación del ticket multi-receta comprobando que no haya exceso dispensado',
        params: z.object({ ticketId: z.string().min(1) }),
      },
    },
    async (req) => conc.confirmarTicketMultiReceta(req.params.ticketId, ctx(req)),
  );
  app.post(
    '/api/demo/tpv',
    {
      preHandler: operativa,
      schema: {
        tags: ['conciliacion'],
        summary: 'DEMO: simula el cobro en el TPV (ticket sin lote)',
        body: z.object({ cn: z.string().regex(/^\d{6}$/), unidades: z.number().int().positive().max(99) }),
      },
    },
    async (req, reply) =>
      reply.status(201).send(await conc.cobrarDemo(req.body.cn, req.body.unidades, ctx(req))),
  );
  app.get('/api/pendientes', { preHandler: operativa, schema: { tags: ['pendientes'] } }, async () =>
    pend.listado(),
  );
  app.post(
    '/api/discrepancias/:id/resolver',
    {
      preHandler: operativa,
      schema: { tags: ['pendientes'], params: IdParam, body: ResolverDiscrepanciaDto },
    },
    async (req) => pend.resolverDiscrepancia(req.params.id, req.body.nota, ctx(req)),
  );
}
