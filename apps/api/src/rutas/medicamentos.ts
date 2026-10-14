import { z } from 'zod';
import { parseGs1, bytesLegibles } from '@mmx/gs1';
import { evaluarEquivalencia, proponerLotes, validarVentaSinReceta } from '@mmx/domain';
import { DomainError, type Canal } from '@mmx/shared';
import { eq } from 'drizzle-orm';
import { gtinCn } from '@mmx/db';
import { hoyDe, politica, type AppDeps } from '../deps';
import { ROLES, requiereRol } from '../plugins/auth';
import { BuscarQuery, FefoQuery, ScanDto } from '../schemas';
import { MedicamentosService } from '../servicios/medicamentos';
import type { App } from './comun';

export async function rutasMedicamentos(app: App, d: AppDeps) {
  const med = new MedicamentosService(d);
  const pre = requiereRol(...ROLES.operativa, 'admin');

  app.get('/api/medicamentos/buscar', { preHandler: pre, schema: { tags: ['medicamentos'], summary: 'Candidatos desde la caché (trigramas)', querystring: BuscarQuery } }, async (req) =>
    d.cimavet.buscar(req.query.q, { especieId: req.query.especie ?? null, formaId: req.query.forma ?? null }),
  );

  app.get(
    '/api/medicamentos/:nregistro',
    { preHandler: pre, schema: { tags: ['medicamentos'], params: z.object({ nregistro: z.string().min(1) }), querystring: z.object({ vivo: z.enum(['0', '1']).default('0') }) } },
    async (req) => {
      const cacheDesde = req.query.vivo === '1' ? await med.verificar(req.params.nregistro) : null;
      const m = await med.info(req.params.nregistro);
      if (!m) throw new DomainError('NO_ENCONTRADO');
      return { ...m, presentaciones: await d.cimavet.presentacionesDe([m.nregistro]), cacheDesde, especies: await med.nombresEspecies(m.especieIds) };
    },
  );

  app.get(
    '/api/medicamentos/:nregistro/equivalentes',
    {
      preHandler: pre,
      schema: {
        tags: ['medicamentos'],
        params: z.object({ nregistro: z.string().min(1) }),
        querystring: z.object({ especie: z.coerce.number().int().optional(), indicacion: z.string().optional(), produccion: z.enum(['0', '1']).default('0') }),
      },
    },
    async (req) => {
      const p = await med.info(req.params.nregistro);
      if (!p) throw new DomainError('NO_ENCONTRADO');
      const cands = await med.candidatos(p.nregistro, '');
      const out = [];
      for (const c of cands.filter((x) => x.medicamento.nregistro !== p.nregistro)) {
        const e = evaluarEquivalencia(
          p,
          c.medicamento,
          { especieId: req.query.especie ?? null, especieProduccion: req.query.produccion === '1', clase: 'ordinaria', indicacion: req.query.indicacion ?? null, viaPrescritaId: null, duracionDias: null },
          d.rules.bundle.equivalencia,
        );
        const s = await d.stock.lotes(c.presentacion.cn, c.medicamento);
        out.push({ cn: c.presentacion.cn, nombre: c.presentacion.nombre, labtitular: c.medicamento.labtitular, equivalencia: e, stock: s.estado === 'OK' ? s.lotes.reduce((a, l) => a + l.disponible, 0) : null });
      }
      return out;
    },
  );

  app.get(
    '/api/stock/:cn/fefo',
    { preHandler: pre, schema: { tags: ['stock'], summary: 'Propuesta de lote(s) FEFO', params: z.object({ cn: z.string().regex(/^\d{6}$/) }), querystring: FefoQuery } },
    async (req) => {
      const pres = await med.presentacion(req.params.cn);
      const m = pres ? await med.info(pres.nregistro) : null;
      const s = await d.stock.lotes(req.params.cn, m ? { nombre: m.nombre, labtitular: m.labtitular } : null);
      if (s.estado !== 'OK') return { estado: s.estado, propuesta: null };
      return { estado: s.estado, avisosStock: s.avisos, propuesta: proponerLotes({ lotes: s.lotes, unidades: req.query.unidades, hoy: hoyDe(d), duracionDias: req.query.duracionDias ?? null }) };
    },
  );

  app.post('/api/scan/parse', { preHandler: pre, schema: { tags: ['stock'], summary: 'Parsea un código GS1/EAN → GTIN, CN, lote, caducidad, serie', body: ScanDto } }, async (req) => {
    const r = parseGs1(req.body.raw, { gsSubstitute: d.config.SCANNER_GS_SUBSTITUTE });
    let cn = r.ok ? r.cn : null;
    let origen: string | null = r.ok ? r.cnOrigen : null;
    if (r.ok && r.gtin) {
      const [aprendido] = await d.db.select().from(gtinCn).where(eq(gtinCn.gtin, r.gtin));
      if (aprendido) {
        cn = aprendido.cn;
        origen = 'aprendido';
      }
    }
    const pres = cn ? await med.presentacion(cn) : null;
    return { ...r, cn, cnOrigen: origen, cnEnCimavet: !!pres, presentacion: pres, bytes: bytesLegibles(req.body.raw) };
  });

  app.get(
    '/api/venta/comprobar',
    {
      preHandler: requiereRol(...ROLES.operativa),
      schema: { tags: ['dispensaciones'], summary: 'Comprueba si un CN se puede vender sin receta', querystring: z.object({ cn: z.string().regex(/^\d{6}$/), canal: z.enum(['presencial', 'online']) }) },
    },
    async (req) => {
      const pres = await med.presentacion(req.query.cn);
      const m = pres ? await med.info(pres.nregistro) : null;
      if (!pres || !m) throw new DomainError('NO_ENCONTRADO');
      const incs = validarVentaSinReceta(req.query.canal as Canal, m, politica(d));
      const s = await d.stock.lotes(req.query.cn, m);
      return {
        presentacion: pres,
        medicamento: { nombre: m.nombre, receta: m.receta, psicotropo: m.psicotropo, especies: await med.nombresEspecies(m.especieIds) },
        incidencias: incs,
        permitido: !incs.some((i) => i.severidad !== 'AVISO'),
        stock: s.estado,
        propuesta: s.estado === 'OK' ? proponerLotes({ lotes: s.lotes, unidades: 1, hoy: hoyDe(d), duracionDias: null }) : null,
      };
    },
  );
}
