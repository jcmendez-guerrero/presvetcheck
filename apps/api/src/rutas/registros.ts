import { aCsv, aXlsx, tablaEntradas, tablaPsicotropos, tablasSalidas } from '@mmx/reports';
import type { AppDeps } from '../deps';
import { ROLES, requiereRol, usuario } from '../plugins/auth';
import { RegistrosQuery, RevisionDto } from '../schemas';
import { GaranteService } from '../servicios/garante';
import { RegistrosService } from '@mmx/reports';
import { ctx, enviarFichero, type App } from './comun';

export async function rutasRegistros(app: App, d: AppDeps) {
  const reg = new RegistrosService(d);
  const gar = new GaranteService(d);
  const lectura = requiereRol(...ROLES.lecturaRegistros);

  app.get(
    '/api/registros/salidas',
    { preHandler: lectura, schema: { tags: ['registros'], summary: 'Exportación de salidas (plantillas A/B/C de SPEC §4.8)', querystring: RegistrosQuery } },
    async (req, reply) => {
      const q = req.query;
      const u = usuario(req);
      // DNI completo solo para el rol garante (D-07); el resto lo ve enmascarado.
      const salidas = await reg.salidas(q.desde, q.hasta, { incluirPropietario: q.incluirPropietario === '1', dniCompleto: u.roles.includes('farmaceutico_garante') });
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

  app.get('/api/registros/psicotropos', { preHandler: lectura, schema: { tags: ['registros'], summary: 'Registro de psicótropos (TODO D-06b: formato oficial)', querystring: RegistrosQuery } }, async (req, reply) => {
    const t = tablaPsicotropos(await reg.psicotropos(req.query.desde, req.query.hasta));
    if (req.query.formato === 'xlsx') return enviarFichero(reply, `psicotropos-${req.query.desde}_${req.query.hasta}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await aXlsx([t]));
    if (req.query.formato === 'csv') return enviarFichero(reply, `psicotropos-${req.query.desde}_${req.query.hasta}.csv`, 'text/csv; charset=utf-8', aCsv(t));
    return { tablas: [t] };
  });

  // ── Bandeja del garante ────────────────────────────────────────────────────────
  app.get('/api/garante/bandeja', { preHandler: requiereRol(...ROLES.garante), schema: { tags: ['garante'] } }, async () => gar.bandeja());
  app.post('/api/garante/revisiones', { preHandler: requiereRol(...ROLES.garante), schema: { tags: ['garante'], body: RevisionDto } }, async (req, reply) =>
    reply.status(201).send(await gar.revisar(req.body, ctx(req))),
  );
}
