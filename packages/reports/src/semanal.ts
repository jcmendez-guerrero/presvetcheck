import { and, asc, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import {
  discrepancia,
  dispensacion,
  outbox,
  receta,
  recepcion,
  recepcionLinea,
  sustitucion,
  type ColumnCipher,
  type Db,
} from '@mmx/db';
import { RegistrosService, fechaEntradaRecepcion, rangoMadrid } from './datos';
import { aCsv, aXlsx, fechaEs, type Tabla } from './formato';
import { tablaBajas, tablaEntradas, tablaPsicotropos } from './entradas';
import { tablasSalidas } from './salidas';

/** Lote con caducidad próxima (lo aporta la integración de Siweb360). */
export interface LoteProximo {
  cn: string | null;
  sku: string | null;
  nombre: string;
  lote: string;
  caducidad: string;
  disponible: number;
}

export interface ContextoReporte {
  db: Db;
  cipher: ColumnCipher;
  /** null si Siweb360 no está configurado. */
  lotesProximos: ((hasta: string) => Promise<LoteProximo[]>) | null;
  producto_no_valido: readonly string[];
  /**
   * Movimientos de medicamentos de Siweb360 sin vínculo ni justificación desde la fecha de corte (specs/011).
   * null si no hay fecha de corte o Siweb360 no está configurado.
   */
  movimientosSinJustificar?: (() => Promise<MovimientoSinJustificar[]>) | null;
}

export interface MovimientoSinJustificar {
  fecha: Date;
  cn: string | null;
  nombre: string | null;
  lote: string | null;
  unidades: number;
  motivoSiweb: string;
  referencia: string | null;
}

/** Lunes–domingo de la semana anterior a `hoy` (Europe/Madrid). */
export function semanaAnterior(hoyIso: string): { desde: string; hasta: string; etiqueta: string } {
  const d = new Date(`${hoyIso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(d);
  lunes.setUTCDate(d.getUTCDate() - dow - 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { desde: iso(lunes), hasta: iso(domingo), etiqueta: `${iso(lunes)}_${iso(domingo)}` };
}

const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Reportes de la semana (SPEC §4.11): entradas, salidas A/B/C, sustituciones, no conformes y forzadas
 * (producto no válido aparte), caducidades próximas, registro de psicótropos, discrepancias y precios de coste.
 * Las exportaciones no incluyen datos del propietario (SPEC §9.2).
 */
export async function generarReporteSemanal(
  ctx: ContextoReporte,
  periodo: { desde: string; hasta: string },
  hoyIso: string,
): Promise<Tabla[]> {
  const reg = new RegistrosService(ctx);
  const [ini, fin] = rangoMadrid(periodo.desde, periodo.hasta);
  const tablas: Tabla[] = [];

  // 1. Entradas
  const entradas = await reg.entradas(periodo.desde, periodo.hasta);
  tablas.push({ ...tablaEntradas(entradas), nombre: '1 Entradas' });

  // 2. Salidas A/B/C
  const salidas = await reg.salidas(periodo.desde, periodo.hasta, {
    incluirPropietario: false,
    dniCompleto: false,
  });
  for (const p of ['A', 'B', 'C'] as const) {
    const [t] = tablasSalidas(salidas, p, { incluirPropietario: false, internas: 'final' });
    tablas.push({ ...t!, nombre: `2${p} Salidas ${p}` });
  }

  // 3. Sustituciones
  const sust = await ctx.db
    .select()
    .from(sustitucion)
    .where(and(gte(sustitucion.createdAt, ini), lt(sustitucion.createdAt, fin)))
    .orderBy(asc(sustitucion.createdAt));
  tablas.push({
    nombre: '3 Sustituciones',
    // La autorización previa y la firma del garante se obtienen fuera de la app y las registra el empleado.
    columnas: [
      'ID',
      'FECHA',
      'CN PRESCRITO',
      'CN DISPENSADO',
      'MODO',
      'ESTADO',
      'AUTORIZACIÓN PREVIA (GARANTE / MEDIO / REGISTRA)',
      'HORAS HASTA FIRMA',
      'FIRMA (GARANTE / REGISTRA)',
      'PROCEDIMIENTO',
    ],
    filas: sust.map((s) => {
      const aut = s.autorizacion as {
        previa?: { garante: string; medio: string; empleado: string } | null;
        firma?: { garante: string; fechaHora: string; empleado: string } | null;
      } | null;
      const firma = aut?.firma ?? null;
      const previa = aut?.previa ?? null;
      const horas = firma
        ? Math.round((new Date(firma.fechaHora).getTime() - s.createdAt.getTime()) / 36e5)
        : '';
      return [
        s.id,
        fechaEs(s.createdAt),
        s.cnPrescrito ?? '',
        s.cnPropuesto,
        s.modo,
        s.estado,
        previa ? `${previa.garante} / ${previa.medio} / ${previa.empleado}` : '',
        horas,
        firma ? `${firma.garante} / ${firma.empleado}` : '',
        s.procedimientoVersion ?? '',
      ];
    }),
  });

  // 4. No conformes y forzadas
  const noConf = await ctx.db
    .select()
    .from(receta)
    .where(and(eq(receta.estado, 'NO_CONFORME'), gte(receta.createdAt, ini), lt(receta.createdAt, fin)));
  tablas.push({
    nombre: '4a Recetas no conformes',
    columnas: ['ID RECETA', 'Nº RECETA', 'FECHA', 'MOTIVOS'],
    filas: noConf.map((r) => [
      r.id,
      r.numero ?? '',
      fechaEs(r.createdAt),
      [
        ...new Set(
          (
            (
              r.evaluacion as {
                lineas?: { resultado: { motivos: { code: string; severidad: string }[] } }[];
              } | null
            )?.lineas ?? []
          ).flatMap((l) => l.resultado.motivos.filter((m) => m.severidad !== 'AVISO').map((m) => m.code)),
        ),
      ].join(', '),
    ]),
  });
  // Forzadas: el garante las revisa en este reporte (fuera de la app).
  const forzadas = await ctx.db
    .select({ d: dispensacion })
    .from(dispensacion)
    .where(
      and(
        eq(dispensacion.forzado, true),
        gte(dispensacion.fechaVenta, ini),
        lt(dispensacion.fechaVenta, fin),
      ),
    );
  // Filas: las registradas esta semana; fecha: la de la entrega (las pasadas cuentan en su fecha original).
  const fila = ({ d }: (typeof forzadas)[number]) => [
    d.id,
    fechaEs(d.fechaOriginal ?? d.fechaVenta),
    d.nombreFarmaco,
    d.cn,
    d.lote,
    (d.defectosForzados ?? []).join(', '),
    d.motivoForzado ?? '',
    d.empleado,
  ];
  const COL_F = ['ID DISPENSACIÓN', 'FECHA', 'MEDICAMENTO', 'CN', 'LOTE', 'DEFECTOS', 'MOTIVO', 'EMPLEADO'];
  const pnv = (x: (typeof forzadas)[number]) =>
    (x.d.defectosForzados ?? []).some((c) => ctx.producto_no_valido.includes(c));
  tablas.push({
    nombre: '4b Dispensaciones forzadas',
    columnas: COL_F,
    filas: forzadas.filter((x) => !pnv(x)).map(fila),
  });
  // "Producto no válido" se lista aparte para decidir cuándo endurecerlo. TODO(decision D-05c)
  tablas.push({
    nombre: '4c Producto no valido forzado',
    columnas: COL_F,
    filas: forzadas.filter(pnv).map(fila),
  });

  // 5. Caducidades próximas (≤ 90 días)
  const hasta90 = sumarDias(hoyIso, 90);
  if (ctx.lotesProximos) {
    const lotes = await ctx.lotesProximos(hasta90);
    tablas.push({
      nombre: '5 Caducidades proximas',
      columnas: ['CN', 'SKU', 'PRODUCTO', 'LOTE', 'CADUCIDAD', 'DISPONIBLE'],
      filas: lotes.map((l) => [
        l.cn ?? '',
        l.sku ?? '',
        l.nombre,
        l.lote,
        fechaEs(l.caducidad),
        l.disponible,
      ]),
    });
  } else {
    tablas.push({
      nombre: '5 Caducidades proximas',
      columnas: ['AVISO'],
      filas: [['Siweb360 no configurado: no se pueden leer los lotes']],
    });
  }

  // 5b. Psicótropos. TODO(decision D-06b): formato oficial
  tablas.push({
    ...tablaPsicotropos(await reg.psicotropos(periodo.desde, periodo.hasta)),
    nombre: '5b Psicotropos',
  });

  // 5c. Bajas justificadas de la semana (specs/011)
  tablas.push({ ...tablaBajas(await reg.bajas(periodo.desde, periodo.hasta)), nombre: '5c Bajas' });

  // 6. Discrepancias (outbox con error o en reconciliación + conciliación de ventas)
  const ob = await ctx.db
    .select()
    .from(outbox)
    .where(inArray(outbox.status, ['failed', 'needs_reconciliation']))
    .orderBy(desc(outbox.createdAt));
  const disc = await ctx.db
    .select()
    .from(discrepancia)
    .where(
      or(eq(discrepancia.estado, 'abierta'), and(gte(discrepancia.fecha, ini), lt(discrepancia.fecha, fin))),
    );
  tablas.push({
    nombre: '6 Discrepancias',
    columnas: ['ORIGEN', 'TIPO / ESTADO', 'REFERENCIA', 'FECHA', 'DETALLE'],
    filas: [
      ...ob.map((o) => ['outbox', o.status, o.idempotencyKey, fechaEs(o.createdAt), o.lastError ?? '']),
      ...disc.map((x) => [
        x.origen,
        `${x.tipo} (${x.estado})`,
        x.id,
        fechaEs(x.fecha),
        JSON.stringify(x.datos),
      ]),
    ],
  });

  // 6b. Movimientos de Siweb360 sin justificar (todos los pendientes, no solo los de la semana)
  const sinJustificar = ctx.movimientosSinJustificar ? await ctx.movimientosSinJustificar() : null;
  tablas.push({
    nombre: '6b Movimientos sin justificar',
    columnas: [
      'FECHA',
      'CÓDIGO NACIONAL',
      'MEDICAMENTO',
      'LOTE',
      'UNIDADES',
      'MOTIVO EN SIWEB360',
      'REFERENCIA',
    ],
    filas:
      sinJustificar === null
        ? [['Conciliación de movimientos sin fecha de corte', '', '', '', '', '', '']]
        : sinJustificar.map((m) => [
            fechaEs(m.fecha),
            m.cn ?? '',
            m.nombre ?? '',
            m.lote ?? '',
            m.unidades,
            m.motivoSiweb,
            m.referencia ?? '',
          ]),
  });

  // 7. Precios de coste de la semana con variación respecto al coste anterior. Solo las líneas marcadas
  // «Actualizar precio» cuentan como precio de coste de referencia (hoy y como coste anterior).
  const conCoste = entradas.filter((e) => e.precioCoste !== null && e.actualizarPrecio !== false);
  const filas7: Array<Array<string | number>> = [];
  for (const e of conCoste) {
    const [ant] = await ctx.db
      .select({ coste: recepcionLinea.precioCoste })
      .from(recepcionLinea)
      .innerJoin(recepcion, eq(recepcion.id, recepcionLinea.recepcionId))
      .where(
        and(
          eq(recepcionLinea.cn, e.cn ?? ''),
          eq(recepcionLinea.actualizarPrecio, true),
          sql`${fechaEntradaRecepcion} < ${periodo.desde}`,
          sql`${recepcionLinea.precioCoste} is not null`,
        ),
      )
      .orderBy(desc(fechaEntradaRecepcion))
      .limit(1);
    const variacion =
      ant?.coste && Number(ant.coste) !== 0
        ? (((Number(e.precioCoste) - Number(ant.coste)) / Number(ant.coste)) * 100).toFixed(2)
        : '';
    filas7.push([
      e.nombreFarmaco,
      e.cn ?? '',
      e.lote ?? '',
      e.precioNetoCompra ?? '',
      e.rePct ?? '',
      e.precioCoste ?? '',
      ant?.coste ?? '',
      variacion,
    ]);
  }
  tablas.push({
    nombre: '7 Precios de coste',
    columnas: [
      'PRODUCTO',
      'CN',
      'LOTE',
      'PRECIO NETO',
      'RE %',
      'PRECIO COSTE',
      'COSTE ANTERIOR',
      'VARIACIÓN %',
    ],
    filas: filas7,
  });

  // 8. Altas manuales de recetas (sin imagen) de la semana: para revisarlas con el papel (specs/011).
  const manuales = await ctx.db
    .select({
      id: receta.id,
      numero: receta.numero,
      creadaPor: receta.creadaPor,
      createdAt: receta.createdAt,
      motivo: receta.motivoAlta,
      custodia: receta.custodiaPapel,
      // Nombres cualificados a mano: dentro de un select de una sola tabla, Drizzle no cualifica las columnas.
      entregas: sql<number>`(select count(*)::int from dispensacion d where d.receta_id = receta.id and d.anula_dispensacion_id is null)`,
      // Defectos que en el alta manual quedaron como aviso: lo que hay que revisar con el papel.
      avisos: sql<
        string | null
      >`(select string_agg(distinct a, ', ' order by a) from dispensacion d, jsonb_array_elements_text(coalesce(d.avisos, '[]'::jsonb)) a where d.receta_id = receta.id and d.anula_dispensacion_id is null)`,
    })
    .from(receta)
    .where(and(eq(receta.origen, 'manual'), gte(receta.createdAt, ini), lt(receta.createdAt, fin)))
    .orderBy(asc(receta.createdAt));
  tablas.push({
    nombre: '8 Altas manuales',
    columnas: [
      'ID RECETA',
      'Nº RECETA',
      'FECHA DE ALTA',
      'DADA DE ALTA POR',
      'MOTIVO',
      'DÓNDE ESTÁ EL PAPEL',
      'ENTREGAS',
      'AVISOS PARA REVISAR',
    ],
    filas: manuales.map((m) => [
      m.id,
      m.numero ?? '',
      fechaEs(m.createdAt),
      m.creadaPor,
      m.motivo ?? '',
      m.custodia ?? '',
      m.entregas,
      m.avisos ?? '',
    ]),
  });
  return tablas;
}

export async function empaquetarReporte(
  tablas: Tabla[],
): Promise<{ xlsx: Buffer; csvs: { nombre: string; contenido: string }[] }> {
  return {
    xlsx: await aXlsx(tablas),
    csvs: tablas.map((t) => ({
      nombre: `${t.nombre.replace(/\s+/g, '-').toLowerCase()}.csv`,
      contenido: aCsv(t),
    })),
  };
}
