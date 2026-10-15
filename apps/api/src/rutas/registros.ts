import { DomainError } from '@mmx/shared';
import { aCsv, aXlsx, tablaEntradas, tablaMovimientos, tablaPsicotropos, tablaTodasSalidas, tablasSalidas } from '@mmx/reports';
import type { AppDeps } from '../deps';
import { appendAudit } from '@mmx/db';
import { ROLES, exigirMfa, requiereRol, usuario } from '../plugins/auth';
import { IdParam, RegistrosQuery, ResolverDiscrepanciaDto } from '../schemas';
import { PendientesService } from '../servicios/pendientes';
import { RegistrosService } from '@mmx/reports';
import { ctx, enviarFichero, type App } from './comun';

export async function rutasRegistros(app: App, d: AppDeps) {
  const reg = new RegistrosService(d);
  const pend = new PendientesService(d);
  const lectura = requiereRol(...ROLES.lecturaRegistros);

  app.get(
    '/api/registros/salidas',
    { preHandler: lectura, schema: { tags: ['registros'], summary: 'Exportación de salidas (plantillas A/B/C de SPEC §4.8)', querystring: RegistrosQuery } },
    async (req, reply) => {
      const q = req.query;
      const u = usuario(req);
      // DNI completo solo para administración con MFA y queda auditado (p. ej. requerimiento de la
      // inspección); el resto lo ve enmascarado (D-07). El garante no usa la app.
      const dniCompleto = q.dniCompleto === '1';
      if (dniCompleto) {
        if (!u.roles.includes('admin')) throw new DomainError('PROHIBIDO', 'El DNI completo solo lo exporta administración');
        exigirMfa(req);
        await d.db.transaction((tx) => appendAudit(tx, { actor: u.id, accion: 'exportar_dni_completo', entidad: 'registro_salidas', entidadId: null, despues: { desde: q.desde, hasta: q.hasta, plantilla: q.plantilla } }));
      }
      const salidas = await reg.salidas(q.desde, q.hasta, { incluirPropietario: q.incluirPropietario === '1', dniCompleto });
      const tablas = tablasSalidas(salidas, q.plantilla, { incluirPropietario: q.incluirPropietario === '1', internas: q.internas });
      const base = `salidas-${q.plantilla}-${q.desde}_${q.hasta}`;
      if (q.formato === 'csv') return enviarFichero(reply, `${base}.csv`, 'text/csv; charset=utf-8', aCsv(tablas[0]!));
      if (q.formato === 'xlsx') return enviarFichero(reply, `${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await aXlsx(tablas));
      return { tablas };
    },
  );

  app.get('/api/registros/entradas', { preHandler: lectura, schema: { tags: ['registros'], querystring: RegistrosQuery } }, async (req, reply) => {
    const t = tablaEntradas(await reg.entradas(req.query.desde, req.query.hasta));
    const base = `entradas-${req.query.desde}_${req.query.hasta}`;
    if (req.query.formato === 'csv') return enviarFichero(reply, `${base}.csv`, 'text/csv; charset=utf-8', aCsv(t));
    if (req.query.formato === 'xlsx') return enviarFichero(reply, `${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await aXlsx([t]));
    return { tablas: [t] };
  });

  // Informes de conjunto: todas las salidas (A, B y C juntas) y todos los movimientos (entradas y salidas).
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  app.get('/api/registros/todas-salidas', { preHandler: lectura, schema: { tags: ['registros'], summary: 'Todas las salidas del periodo en una tabla', querystring: RegistrosQuery } }, async (req, reply) => {
    const t = tablaTodasSalidas(await reg.salidas(req.query.desde, req.query.hasta, { incluirPropietario: false, dniCompleto: false }));
    const base = `todas-las-salidas-${req.query.desde}_${req.query.hasta}`;
    if (req.query.formato === 'csv') return enviarFichero(reply, `${base}.csv`, 'text/csv; charset=utf-8', aCsv(t));
    if (req.query.formato === 'xlsx') return enviarFichero(reply, `${base}.xlsx`, XLSX, await aXlsx([t]));
    return { tablas: [t] };
  });
  app.get('/api/registros/movimientos', { preHandler: lectura, schema: { tags: ['registros'], summary: 'Entradas y salidas del periodo por fecha', querystring: RegistrosQuery } }, async (req, reply) => {
    const entradas = await reg.entradas(req.query.desde, req.query.hasta);
    const salidas = await reg.salidas(req.query.desde, req.query.hasta, { incluirPropietario: false, dniCompleto: false });
    const t = tablaMovimientos(entradas, salidas);
    const base = `entradas-y-salidas-${req.query.desde}_${req.query.hasta}`;
    if (req.query.formato === 'csv') return enviarFichero(reply, `${base}.csv`, 'text/csv; charset=utf-8', aCsv(t));
    // En XLSX, además de la tabla conjunta, una hoja con las entradas y otra con todas las salidas.
    if (req.query.formato === 'xlsx') return enviarFichero(reply, `${base}.xlsx`, XLSX, await aXlsx([t, tablaEntradas(entradas), tablaTodasSalidas(salidas)]));
    return { tablas: [t] };
  });

  app.get('/api/registros/psicotropos', { preHandler: lectura, schema: { tags: ['registros'], summary: 'Registro de psicótropos (TODO D-06b: formato oficial)', querystring: RegistrosQuery } }, async (req, reply) => {
    const t = tablaPsicotropos(await reg.psicotropos(req.query.desde, req.query.hasta));
    if (req.query.formato === 'xlsx') return enviarFichero(reply, `psicotropos-${req.query.desde}_${req.query.hasta}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await aXlsx([t]));
    if (req.query.formato === 'csv') return enviarFichero(reply, `psicotropos-${req.query.desde}_${req.query.hasta}.csv`, 'text/csv; charset=utf-8', aCsv(t));
    return { tablas: [t] };
  });

  // ── Pendientes de la operativa (sustituciones en curso y discrepancias) ────────────
  const operativa = requiereRol(...ROLES.operativa);
  app.get('/api/pendientes', { preHandler: operativa, schema: { tags: ['pendientes'] } }, async () => pend.listado());
  app.post('/api/discrepancias/:id/resolver', { preHandler: operativa, schema: { tags: ['pendientes'], params: IdParam, body: ResolverDiscrepanciaDto } }, async (req) =>
    pend.resolverDiscrepancia(req.params.id, req.body.nota, ctx(req)),
  );
}
