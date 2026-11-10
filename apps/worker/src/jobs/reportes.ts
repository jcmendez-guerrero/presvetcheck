import { eq } from 'drizzle-orm';
import { asistenteConsumoMes, reportRun, verifyAuditChain, siwebVariantMap } from '@mmx/db';
import { costeEstimado, estadoConsumo } from '@mmx/assistant';
import { mesMadrid } from '@mmx/shared';
import { hoy } from '@mmx/domain';
import { empaquetarReporte, generarReporteSemanal, semanaAnterior, type LoteProximo } from '@mmx/reports';
import { movimientosSinJustificar } from '@mmx/siweb';
import type { Contexto } from '../contexto';

/**
 * Reportes semanales (lunes 07:00 Europe/Madrid, SPEC §4.11): XLSX y CSV en Blob y por correo al garante y a
 * JC. Verifica además la cadena de auditoría (SPEC §9.4): una ruptura genera alerta.
 */
export async function weeklyReports(ctx: Contexto, args: Record<string, string>) {
  const hoyIso = hoy(ctx.clock);
  const periodo =
    args.desde && args.hasta
      ? { desde: args.desde, hasta: args.hasta, etiqueta: `${args.desde}_${args.hasta}` }
      : semanaAnterior(hoyIso);
  const tablas = await generarReporteSemanal(
    {
      db: ctx.db,
      cipher: ctx.cipher,
      lotesProximos: ctx.siweb ? (hasta) => lotesProximos(ctx, hasta) : null,
      producto_no_valido: ctx.rules.recetaCampos.producto_no_valido,
      movimientosSinJustificar: ctx.config.ENTRY_CUTOVER_DATE
        ? () => movimientosSinJustificar(ctx.db, { corte: ctx.config.ENTRY_CUTOVER_DATE as string })
        : null,
    },
    periodo,
    hoyIso,
  );
  const { xlsx, csvs } = await empaquetarReporte(tablas);
  const base = `semanal/${periodo.etiqueta}`;
  const ruta = await ctx.blob.put(
    'reportes',
    `${base}/reporte-semanal.xlsx`,
    xlsx,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  for (const c of csvs)
    await ctx.blob.put(
      'reportes',
      `${base}/${c.nombre}`,
      Buffer.from(c.contenido, 'utf8'),
      'text/csv; charset=utf-8',
    );

  const cadena = await verifyAuditChain(ctx.db);
  if (!cadena.ok) ctx.log('ALERTA: ruptura de la cadena de auditoría', { seq: cadena.roturaEn?.seq });

  const asistente = await lineaAsistente(ctx);
  const para = (ctx.config.REPORT_RECIPIENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (para.length) {
    await ctx.mailer.enviar({
      para,
      asunto: `Reporte semanal ${periodo.desde} – ${periodo.hasta}${cadena.ok ? '' : ' · ALERTA: cadena de auditoría rota'}`,
      texto: [
        `Reporte semanal de Mundo Mascotix (${periodo.desde} a ${periodo.hasta}).`,
        ...tablas.map((t) => `· ${t.nombre}: ${t.filas.length} fila(s)`),
        cadena.ok
          ? `Cadena de auditoría verificada (${cadena.total} eventos).`
          : 'ATENCIÓN: la verificación de la cadena de auditoría ha fallado.',
        ...(asistente ? [asistente] : []),
      ].join('\n'),
      adjuntos: [
        {
          nombre: `reporte-semanal-${periodo.etiqueta}.xlsx`,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          contenido: xlsx,
        },
      ],
    });
  }
  await ctx.db.insert(reportRun).values({
    tipo: 'semanal',
    periodo: periodo.etiqueta,
    blobPath: ruta,
    formato: 'xlsx+csv',
    generadoAt: new Date(ctx.clock.now().epochMilliseconds),
    enviadoA: para,
  });
  return {
    periodo: periodo.etiqueta,
    hojas: tablas.map((t) => ({ nombre: t.nombre, filas: t.filas.length })),
    blob: ruta,
    enviadoA: para.length,
    auditoria: cadena,
  };
}

/** Consumo acumulado del mes del asistente de consultas (FR-027b); nada si aún no se ha usado. */
async function lineaAsistente(ctx: Contexto): Promise<string | null> {
  const mes = mesMadrid(new Date(ctx.clock.now().epochMilliseconds));
  const [f] = await ctx.db.select().from(asistenteConsumoMes).where(eq(asistenteConsumoMes.mes, mes));
  if (!f) return null;
  const e = estadoConsumo({
    tokensEntrada: f.tokensEntrada,
    tokensSalida: f.tokensSalida,
    limiteTokens: f.limiteTokens,
    limiteAmpliado: f.limiteAmpliado,
  });
  const coste = costeEstimado(f.tokensEntrada, f.tokensSalida, {
    entradaPor1k: ctx.config.ASSISTANT_PRICE_IN_PER_1K_EUR,
    salidaPor1k: ctx.config.ASSISTANT_PRICE_OUT_PER_1K_EUR,
  });
  const estado = e.estado === 'en_pausa' ? ' · EN PAUSA' : e.estado === 'aviso' ? ' · cerca del límite' : '';
  return `Asistente de consultas (${mes}): ${e.usados} tokens, ${e.porcentaje} % del límite, ${f.preguntas} pregunta(s)${coste ? `, coste estimado ${coste} €` : ''}${estado}.`;
}

async function lotesProximos(ctx: Contexto, hasta: string): Promise<LoteProximo[]> {
  const mapas = await ctx.db.select().from(siwebVariantMap);
  const porCn = new Map<string, number[]>();
  for (const m of mapas) porCn.set(m.cn, [...(porCn.get(m.cn) ?? []), m.variantId]);
  const out: LoteProximo[] = [];
  for (const [cn, ids] of porCn) {
    const s = await ctx.siweb!.stock.lotesDeVariantes(cn, ids);
    for (const l of s.lotes)
      if (l.caducidad && l.caducidad <= hasta && l.disponible > 0)
        out.push({
          cn,
          sku: mapas.find((m) => m.variantId === l.variantId)?.sku ?? null,
          nombre: cn,
          lote: l.lote,
          caducidad: l.caducidad,
          disponible: l.disponible,
        });
  }
  return out.sort((a, b) => a.caducidad.localeCompare(b.caducidad));
}
