import { and, asc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  cimavetMedicamento,
  entradaImportada,
  importacion,
  salidaImportada,
  conciliacion,
  cimavetPresentacion,
  discrepancia,
  dispensacion,
  movimientoJustificacion,
  siwebMovimiento,
  distribuidor,
  maskDni,
  plataformaRecetaElectronica,
  propietario,
  receta,
  recepcion,
  recepcionLinea,
  sustitucion,
  veterinario,
} from '@mmx/db';
import type { ColumnCipher, Db } from '@mmx/db';
import { fechaEntrada, type Baja, type Entrada, type MovimientoPsicotropo } from './entradas';
import { TEXTO_MOTIVO, rangoMadrid, type MotivoJustificacion } from '@mmx/shared';

/**
 * Fecha con la que cuenta una entrada en los registros: la de recepción (cuando llega el producto), no la de
 * compra del albarán o la factura. Si no se registró la recepción, se usa la de compra.
 */
export const fechaEntradaRecepcion = sql<string>`coalesce(${recepcion.fechaRecepcion}, ${recepcion.fechaCompra})`;
const fechaEntradaImportada = sql<string>`coalesce(${entradaImportada.fechaRecepcion}, ${entradaImportada.fecha})`;
import type { Salida } from './salidas';

// Se mantiene la exportación desde @mmx/reports (la usan el worker y la API).
export { rangoMadrid };

/** Consultas de los registros de entradas y salidas (API y reportes semanales). */
/**
 * Titular de la receta (cifrado en la confirmación) para las salidas con receta: se lee al exportar, así que
 * incluye lo transcrito después de dispensar (dispensación ágil).
 */
function titularDeReceta(conf: unknown, c: ColumnCipher, dniCompleto: boolean): Salida['propietario'] {
  const t = (conf as { _cifrado?: boolean; titular?: Record<string, string | null> } | null)?.titular;
  if (!t || !(conf as { _cifrado?: boolean })._cifrado) return null;
  const d = (k: string) => c.decrypt(t[k] ?? null);
  const dni = d('dni');
  const out = {
    nombre: d('nombre'),
    movil: d('telefono'),
    dni: dniCompleto ? dni : maskDni(dni),
    direccion: d('direccion'),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

export class RegistrosService {
  constructor(private readonly d: { db: Db; cipher: ColumnCipher }) {}

  /** Salidas del periodo, con anulaciones marcadas. Datos del propietario solo si se piden. */
  async salidas(
    desde: string,
    hasta: string,
    opts: { incluirPropietario: boolean; dniCompleto: boolean },
  ): Promise<Salida[]> {
    const [ini, fin] = rangoMadrid(desde, hasta);
    const filas = await this.d.db
      .select({
        d: dispensacion,
        r: receta,
        v: veterinario,
        p: propietario,
        pl: plataformaRecetaElectronica,
        s: sustitucion,
        cc: conciliacion,
      })
      .from(dispensacion)
      .leftJoin(receta, eq(receta.id, dispensacion.recetaId))
      .leftJoin(veterinario, eq(veterinario.id, receta.veterinarioId))
      .leftJoin(propietario, eq(propietario.id, dispensacion.propietarioId))
      .leftJoin(plataformaRecetaElectronica, eq(plataformaRecetaElectronica.id, receta.plataformaId))
      .leftJoin(sustitucion, eq(sustitucion.id, dispensacion.sustitucionId))
      .leftJoin(conciliacion, eq(conciliacion.dispensacionId, dispensacion.id))
      .where(
        and(
          gte(dispensacion.fechaVenta, ini),
          lt(dispensacion.fechaVenta, fin),
          sql`${dispensacion.anulaDispensacionId} is null`,
        ),
      )
      .orderBy(asc(dispensacion.fechaVenta));
    const anuladas = new Set(
      (
        await this.d.db
          .select({ id: dispensacion.anulaDispensacionId })
          .from(dispensacion)
          .where(sql`${dispensacion.anulaDispensacionId} is not null`)
      ).map((x) => x.id),
    );
    const conDiscrepancia = new Set(
      (
        await this.d.db
          .select({ datos: discrepancia.datos })
          .from(discrepancia)
          .where(eq(discrepancia.estado, 'abierta'))
      )
        .map((x) => (x.datos as { dispensacionId?: string | null }).dispensacionId)
        .filter(Boolean),
    );
    const c = this.d.cipher;
    const propias: Salida[] = filas.map(({ d, r, v, p, pl, s, cc }) => {
      const dni = p ? c.decrypt(p.dniEnc) : null;
      const firma = (s?.autorizacion as { firma?: { garante?: string } } | null)?.firma?.garante ?? null;
      return {
        id: d.id,
        canal: d.canal as Salida['canal'],
        conReceta: d.conReceta,
        nombreFarmaco: d.nombreFarmaco,
        principioActivo: d.principioActivoTxt,
        forma: d.formaTxt,
        especie: d.especieTxt,
        fechaVenta: d.fechaVenta,
        caducidad: d.caducidad,
        lote: d.lote,
        cn: d.cn,
        unidades: d.unidades,
        unidadesTexto: d.unidadesTexto,
        fechaReceta: r?.fechaEmision ?? null,
        numeroReceta: r?.numero ?? null,
        veterinario: v?.nombre ?? null,
        numColegiado: v?.numColegiado ?? r?.numColegiado ?? null,
        clinica: v?.clinica ?? null,
        direccionVeterinario: v?.direccion ?? null,
        propietario: !opts.incluirPropietario
          ? null
          : p
            ? {
                nombre: c.decrypt(p.nombreEnc),
                movil: c.decrypt(p.movilEnc),
                dni: opts.dniCompleto ? dni : maskDni(dni),
                direccion: c.decrypt(p.direccionEnc),
              }
            : titularDeReceta(r?.confirmacion, c, opts.dniCompleto),
        tipoReceta: r?.tipo ?? null,
        plataforma: pl?.nombre ?? null,
        esSustitucion: d.esSustitucion,
        forzado: d.forzado,
        defectosForzados: d.defectosForzados ?? [],
        medicamentoPrescrito: d.nombrePrescrito ?? d.cnPrescrito,
        autorizadoPor: firma,
        empleado: d.empleado,
        metodoCaptura: d.metodoCaptura,
        anulada: anuladas.has(d.id),
        registro: !r
          ? 'no aplica'
          : (r.confirmacion as { registroDiferido?: boolean } | null)?.registroDiferido &&
              !r.registroCompletadoAt
            ? 'pendiente'
            : 'completo',
        conciliacion: cc ? 'conciliada' : conDiscrepancia.has(d.id) ? 'discrepancia' : 'pendiente',
      };
    });
    return [...propias, ...(await this.salidasImportadas(desde, hasta, opts))].sort(
      (a, b) => new Date(a.fechaVenta).getTime() - new Date(b.fechaVenta).getTime(),
    );
  }

  /** Salidas anteriores a la app importadas de Excel (sin las importaciones anuladas). */
  private async salidasImportadas(
    desde: string,
    hasta: string,
    opts: { incluirPropietario: boolean; dniCompleto: boolean },
  ): Promise<Salida[]> {
    const filas = await this.d.db
      .select({ s: salidaImportada, i: importacion })
      .from(salidaImportada)
      .innerJoin(importacion, eq(importacion.id, salidaImportada.importacionId))
      .where(
        and(
          gte(salidaImportada.fecha, desde),
          sql`${salidaImportada.fecha} <= ${hasta}`,
          sql`${importacion.anuladaAt} is null`,
        ),
      )
      .orderBy(asc(salidaImportada.fecha), asc(salidaImportada.fila));
    const c = this.d.cipher;
    return filas.map(({ s, i }) => {
      const dni = c.decrypt(s.propietarioDniEnc);
      const prop = {
        nombre: c.decrypt(s.propietarioNombreEnc),
        movil: c.decrypt(s.propietarioMovilEnc),
        dni: opts.dniCompleto ? dni : maskDni(dni),
        direccion: c.decrypt(s.propietarioDireccionEnc),
      };
      return {
        id: s.id,
        canal: s.plantilla === 'C' ? 'online' : 'presencial',
        conReceta: s.plantilla === 'A',
        nombreFarmaco: s.nombreFarmaco,
        principioActivo: s.principioActivo,
        forma: s.forma,
        especie: s.especie,
        fechaVenta: s.fecha,
        caducidad: s.caducidad,
        lote: s.lote ?? '',
        cn: s.cn ?? '',
        unidades: s.unidades ?? 0,
        unidadesTexto: s.unidadesTexto,
        fechaReceta: s.fechaReceta,
        numeroReceta: s.numeroReceta,
        veterinario: s.veterinario,
        numColegiado: s.numColegiado,
        clinica: s.clinica,
        direccionVeterinario: s.direccionVeterinario,
        propietario: opts.incluirPropietario && Object.values(prop).some(Boolean) ? prop : null,
        tipoReceta: null,
        plataforma: null,
        esSustitucion: false,
        forzado: false,
        defectosForzados: [],
        medicamentoPrescrito: null,
        autorizadoPor: null,
        empleado: i.creadaPor,
        metodoCaptura: 'importado',
        anulada: false,
        registro: 'completo',
        conciliacion: 'no aplica',
      } satisfies Salida;
    });
  }

  async entradas(desde: string, hasta: string): Promise<Entrada[]> {
    const filas = await this.d.db
      .select({ l: recepcionLinea, r: recepcion, dist: distribuidor })
      .from(recepcionLinea)
      .innerJoin(recepcion, eq(recepcion.id, recepcionLinea.recepcionId))
      .innerJoin(distribuidor, eq(distribuidor.id, recepcion.distribuidorId))
      // Solo medicamentos: el registro de entradas es obligatorio para ellos; los demás productos no van (SPEC §4.9).
      .where(
        and(
          sql`${fechaEntradaRecepcion} >= ${desde}`,
          sql`${fechaEntradaRecepcion} <= ${hasta}`,
          inArray(recepcion.estado, ['FINALIZADA', 'SINCRONIZADA', 'ERROR_SINCRONIZACION']),
          eq(recepcionLinea.tipo, 'medicamento'),
        ),
      )
      .orderBy(asc(fechaEntradaRecepcion), asc(recepcionLinea.numero));
    const propias: Entrada[] = filas.map(({ l, r, dist }) => ({
      recepcionId: r.id,
      distribuidor: dist.nombre,
      albaran: r.albaran,
      fechaCompra: r.fechaCompra,
      nombreFarmaco: l.nombreFarmaco,
      principioActivo: l.principioActivoTxt,
      forma: l.formaTxt,
      cn: l.cn,
      lote: l.lote,
      caducidad: l.caducidad,
      unidades: l.unidades,
      precioNetoCompra: l.precioNetoCompra,
      ivaPct: l.ivaPct,
      rePct: l.rePct,
      precioCoste: l.precioCoste,
      seriales: l.seriales ?? [],
      origenDatos: l.origenDatos,
      empleado: l.empleado,
      fechaRecepcion: r.fechaRecepcion,
      actualizarPrecio: l.actualizarPrecio,
    }));
    // Entradas anteriores a la app importadas de Excel (sin las importaciones anuladas).
    const importadas = await this.d.db
      .select({ e: entradaImportada, i: importacion })
      .from(entradaImportada)
      .innerJoin(importacion, eq(importacion.id, entradaImportada.importacionId))
      .where(
        and(
          sql`${fechaEntradaImportada} >= ${desde}`,
          sql`${fechaEntradaImportada} <= ${hasta}`,
          sql`${importacion.anuladaAt} is null`,
        ),
      )
      .orderBy(asc(fechaEntradaImportada), asc(entradaImportada.fila));
    const otras: Entrada[] = importadas.map(({ e, i }) => ({
      recepcionId: i.id,
      distribuidor: e.distribuidor,
      albaran: e.albaran,
      fechaCompra: e.fecha,
      fechaRecepcion: e.fechaRecepcion,
      nombreFarmaco: e.nombreFarmaco,
      principioActivo: e.principioActivo,
      forma: e.forma,
      cn: e.cn,
      lote: e.lote,
      caducidad: e.caducidad,
      unidades: e.unidades,
      precioNetoCompra: e.precioNetoCompra,
      ivaPct: e.ivaPct,
      rePct: e.rePct,
      precioCoste: e.precioCoste,
      seriales: [],
      origenDatos: 'importado',
      empleado: i.creadaPor,
    }));
    return [...propias, ...otras].sort((a, b) => fechaEntrada(a).localeCompare(fechaEntrada(b)));
  }

  /**
   * Bajas: salidas de medicamentos en Siweb360 justificadas con un motivo (specs/011, FR-009d), por fecha del
   * movimiento. Una justificación sustituida aparece como baja y como anulación; la vigente, como baja.
   */
  async bajas(desde: string, hasta: string): Promise<Baja[]> {
    return (await this.justificadosConMotivo(desde, hasta, 'salida')) as Baja[];
  }

  /**
   * Movimientos de Siweb360 justificados con motivo, de salida (BAJA) o de entrada (ALTA). Las altas solo van al
   * registro de psicótropos (specs/011, FR-009e, DUDA-30).
   */
  private async justificadosConMotivo(
    desde: string,
    hasta: string,
    sentido: 'salida' | 'entrada',
  ): Promise<(Omit<Baja, 'tipo'> & { tipo: Baja['tipo'] | 'ALTA' | 'ANULACIÓN ALTA' })[]> {
    const [ini, fin] = rangoMadrid(desde, hasta);
    const [tipo, anulacion] =
      sentido === 'salida' ? (['BAJA', 'ANULACIÓN BAJA'] as const) : (['ALTA', 'ANULACIÓN ALTA'] as const);
    const filas = await this.d.db
      .select({ j: movimientoJustificacion, m: siwebMovimiento, p: cimavetPresentacion })
      .from(movimientoJustificacion)
      .innerJoin(siwebMovimiento, eq(siwebMovimiento.id, movimientoJustificacion.movimientoId))
      .leftJoin(cimavetPresentacion, eq(cimavetPresentacion.cn, siwebMovimiento.cn))
      .where(
        and(
          eq(movimientoJustificacion.tipo, 'MOTIVO'),
          sentido === 'salida' ? lt(siwebMovimiento.quantity, 0) : gt(siwebMovimiento.quantity, 0),
          gte(siwebMovimiento.createdAtSiweb, ini),
          lt(siwebMovimiento.createdAtSiweb, fin),
        ),
      );
    // Todas las justificaciones de esos movimientos (también vínculos), para saber cuáles se sustituyeron y en qué
    // orden.
    const movs = [...new Set(filas.map((f) => f.m.id))];
    const cadena = movs.length
      ? await this.d.db
          .select({ id: movimientoJustificacion.id, sustituyeA: movimientoJustificacion.sustituyeA })
          .from(movimientoJustificacion)
          .where(inArray(movimientoJustificacion.movimientoId, movs))
      : [];
    const anterior = new Map(cadena.map((c) => [c.id, c.sustituyeA]));
    const sustituidas = new Set(cadena.map((c) => c.sustituyeA).filter(Boolean));
    const orden = (id: string): number => {
      let n = 0;
      for (let a = anterior.get(id); a; a = anterior.get(a)) n++;
      return n;
    };
    return filas.flatMap(({ j, m, p }) => {
      const baja = {
        fecha: m.createdAtSiweb,
        tipo,
        cn: m.cn ?? '',
        nombre: p?.nombre ?? '',
        nregistro: p?.nregistro ?? null,
        lote: m.batchNumber ?? '',
        unidades: Math.abs(m.quantity),
        motivo: TEXTO_MOTIVO[j.motivo as MotivoJustificacion] ?? j.motivo ?? '',
        nota: j.nota,
        referencia: j.id,
        orden: orden(j.id),
      };
      return sustituidas.has(j.id) ? [baja, { ...baja, tipo: anulacion }] : [baja];
    });
  }

  /** Movimientos de psicótropos (entradas, salidas, anulaciones) para el registro del garante. TODO(decision D-06b) */
  async psicotropos(desde: string, hasta: string): Promise<MovimientoPsicotropo[]> {
    const [ini, fin] = rangoMadrid(desde, hasta);
    const psico = (
      await this.d.db
        .select({ n: cimavetMedicamento.nregistro })
        .from(cimavetMedicamento)
        .where(eq(cimavetMedicamento.psicotropo, true))
    ).map((x) => x.n);
    if (!psico.length) return [];
    const salidas = await this.d.db
      .select()
      .from(dispensacion)
      .where(
        and(
          inArray(dispensacion.nregistro, psico),
          gte(dispensacion.fechaVenta, ini),
          lt(dispensacion.fechaVenta, fin),
        ),
      );
    const entradas = await this.d.db
      .select({ l: recepcionLinea, r: recepcion })
      .from(recepcionLinea)
      .innerJoin(recepcion, eq(recepcion.id, recepcionLinea.recepcionId))
      .where(
        and(
          inArray(recepcionLinea.nregistro, psico),
          sql`${fechaEntradaRecepcion} >= ${desde}`,
          sql`${fechaEntradaRecepcion} <= ${hasta}`,
          sql`${recepcion.estado} <> 'ABIERTA'`,
        ),
      );
    const bajas = [
      ...(await this.justificadosConMotivo(desde, hasta, 'salida')),
      ...(await this.justificadosConMotivo(desde, hasta, 'entrada')),
    ].filter((b) => b.nregistro && psico.includes(b.nregistro));
    return [
      ...bajas.map((b) => ({
        fecha: b.fecha,
        tipo: b.tipo,
        cn: b.cn,
        nombre: b.nombre,
        lote: b.lote,
        unidades: b.unidades,
        referencia: b.referencia,
      })),
      ...entradas.map(({ l, r }) => ({
        fecha: r.fechaRecepcion ?? r.fechaCompra,
        tipo: 'ENTRADA' as const,
        cn: l.cn ?? '',
        nombre: l.nombreFarmaco,
        lote: l.lote ?? '',
        unidades: l.unidades,
        referencia: `MMX-REC-${r.id}-L${l.numero}`,
      })),
      ...salidas.map((s) => ({
        fecha: s.fechaVenta,
        tipo: (s.anulaDispensacionId ? 'ANULACIÓN SALIDA' : 'SALIDA') as MovimientoPsicotropo['tipo'],
        cn: s.cn,
        nombre: s.nombreFarmaco,
        lote: s.lote,
        unidades: s.unidades,
        unidadesTexto: s.unidadesTexto,
        referencia: s.anulaDispensacionId ?? s.id,
      })),
    ];
  }
}
