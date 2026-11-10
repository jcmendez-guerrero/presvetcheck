import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { reportRun } from '@mmx/db';
import { hoy } from '@mmx/domain';
import { empaquetarReporte, generarReporteSemanal, semanaAnterior } from '@mmx/reports';
import { movimientosSinJustificar } from '@mmx/siweb';
import { DomainError, IsoDate } from '@mmx/shared';
import type { AppDeps } from '../deps';
import { ROLES, requiereRol } from '../plugins/auth';
import { IdParam } from '../schemas';
import { enviarFichero, type App } from './comun';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Reportes (SPEC §4.11, §7): listado y generación bajo demanda (se guardan en Blob). */
export async function rutasReportes(app: App, d: AppDeps) {
  app.get(
    '/api/reportes',
    { preHandler: requiereRol(...ROLES.lecturaRegistros), schema: { tags: ['reportes'] } },
    async () => d.db.select().from(reportRun).orderBy(desc(reportRun.generadoAt)).limit(100),
  );
  app.get(
    '/api/reportes/:id/descargar',
    { preHandler: requiereRol(...ROLES.lecturaRegistros), schema: { tags: ['reportes'], params: IdParam } },
    async (req, reply) => {
      const [r] = await d.db.select().from(reportRun).where(eq(reportRun.id, req.params.id));
      if (!r?.blobPath) throw new DomainError('NO_ENCONTRADO');
      const b = await d.blob.get('reportes', r.blobPath.replace(/^reportes\//, ''));
      if (!b) throw new DomainError('NO_ENCONTRADO');
      return enviarFichero(reply, `reporte-${r.periodo}.xlsx`, b.mime, Buffer.from(b.bytes));
    },
  );
  app.post(
    '/api/reportes/:tipo/generar',
    {
      preHandler: requiereRol(...ROLES.lecturaRegistros),
      schema: {
        tags: ['reportes'],
        summary: 'Genera el reporte semanal bajo demanda',
        params: z.object({ tipo: z.enum(['semanal']) }),
        body: z.object({ desde: IsoDate.optional(), hasta: IsoDate.optional() }).default({}),
      },
    },
    async (req, reply) => {
      const hoyIso = hoy(d.clock);
      const p =
        req.body?.desde && req.body.hasta
          ? { desde: req.body.desde, hasta: req.body.hasta, etiqueta: `${req.body.desde}_${req.body.hasta}` }
          : semanaAnterior(hoyIso);
      const corte = d.config.ENTRY_CUTOVER_DATE;
      const tablas = await generarReporteSemanal(
        {
          db: d.db,
          cipher: d.cipher,
          lotesProximos: null,
          producto_no_valido: d.rules.bundle.recetaCampos.producto_no_valido,
          movimientosSinJustificar: corte ? () => movimientosSinJustificar(d.db, { corte }) : null,
        },
        p,
        hoyIso,
      );
      const { xlsx } = await empaquetarReporte(tablas);
      const ruta = await d.blob.put('reportes', `bajo-demanda/${p.etiqueta}-${Date.now()}.xlsx`, xlsx, XLSX);
      await d.db.insert(reportRun).values({
        tipo: req.params.tipo,
        periodo: p.etiqueta,
        blobPath: ruta,
        formato: 'xlsx',
        generadoAt: new Date(d.clock.now().epochMilliseconds),
        enviadoA: [],
      });
      return enviarFichero(reply, `reporte-${p.etiqueta}.xlsx`, XLSX, xlsx);
    },
  );
}
