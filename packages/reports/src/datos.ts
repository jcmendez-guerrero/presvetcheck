import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  cimavetMedicamento,
  dispensacion,
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
import type { Entrada, MovimientoPsicotropo } from './entradas';
import type { Salida } from './salidas';

/** Rango [desde 00:00, hasta+1 00:00) en Europe/Madrid → instantes UTC. */
export function rangoMadrid(desde: string, hasta: string): [Date, Date] {
  const aUtc = (iso: string) => {
    // Desfase de Madrid ese día (CET/CEST), calculado con Intl.
    const guess = new Date(`${iso}T00:00:00Z`);
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' }).formatToParts(guess).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
    const h = Number(/GMT([+-]\d+)/.exec(offset)?.[1] ?? 1);
    return new Date(guess.getTime() - h * 3600_000);
  };
  const fin = new Date(`${hasta}T00:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return [aUtc(desde), aUtc(fin.toISOString().slice(0, 10))];
}

/** Consultas de los registros de entradas y salidas (API y reportes semanales). */
export class RegistrosService {
  constructor(private readonly d: { db: Db; cipher: ColumnCipher }) {}

  /** Salidas del periodo, con anulaciones marcadas. Datos del propietario solo si se piden. */
  async salidas(desde: string, hasta: string, opts: { incluirPropietario: boolean; dniCompleto: boolean }): Promise<Salida[]> {
    const [ini, fin] = rangoMadrid(desde, hasta);
    const filas = await this.d.db
      .select({ d: dispensacion, r: receta, v: veterinario, p: propietario, pl: plataformaRecetaElectronica, s: sustitucion })
      .from(dispensacion)
      .leftJoin(receta, eq(receta.id, dispensacion.recetaId))
      .leftJoin(veterinario, eq(veterinario.id, receta.veterinarioId))
      .leftJoin(propietario, eq(propietario.id, dispensacion.propietarioId))
      .leftJoin(plataformaRecetaElectronica, eq(plataformaRecetaElectronica.id, receta.plataformaId))
      .leftJoin(sustitucion, eq(sustitucion.id, dispensacion.sustitucionId))
      .where(and(gte(dispensacion.fechaVenta, ini), lt(dispensacion.fechaVenta, fin), sql`${dispensacion.anulaDispensacionId} is null`))
      .orderBy(asc(dispensacion.fechaVenta));
    const anuladas = new Set(
      (
        await this.d.db
          .select({ id: dispensacion.anulaDispensacionId })
          .from(dispensacion)
          .where(sql`${dispensacion.anulaDispensacionId} is not null`)
      ).map((x) => x.id),
    );
    const c = this.d.cipher;
    return filas.map(({ d, r, v, p, pl, s }) => {
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
        propietario:
          opts.incluirPropietario && p
            ? { nombre: c.decrypt(p.nombreEnc), movil: c.decrypt(p.movilEnc), dni: opts.dniCompleto ? dni : maskDni(dni), direccion: c.decrypt(p.direccionEnc) }
            : null,
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
      };
    });
  }

  async entradas(desde: string, hasta: string): Promise<Entrada[]> {
    const filas = await this.d.db
      .select({ l: recepcionLinea, r: recepcion, dist: distribuidor })
      .from(recepcionLinea)
      .innerJoin(recepcion, eq(recepcion.id, recepcionLinea.recepcionId))
      .innerJoin(distribuidor, eq(distribuidor.id, recepcion.distribuidorId))
      .where(and(gte(recepcion.fechaCompra, desde), sql`${recepcion.fechaCompra} <= ${hasta}`, inArray(recepcion.estado, ['FINALIZADA', 'SINCRONIZADA', 'ERROR_SINCRONIZACION'])))
      .orderBy(asc(recepcion.fechaCompra), asc(recepcionLinea.numero));
    return filas.map(({ l, r, dist }) => ({
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
    }));
  }

  /** Movimientos de psicótropos (entradas, salidas, anulaciones) para el registro del garante. TODO(decision D-06b) */
  async psicotropos(desde: string, hasta: string): Promise<MovimientoPsicotropo[]> {
    const [ini, fin] = rangoMadrid(desde, hasta);
    const psico = (await this.d.db.select({ n: cimavetMedicamento.nregistro }).from(cimavetMedicamento).where(eq(cimavetMedicamento.psicotropo, true))).map((x) => x.n);
    if (!psico.length) return [];
    const salidas = await this.d.db
      .select()
      .from(dispensacion)
      .where(and(inArray(dispensacion.nregistro, psico), gte(dispensacion.fechaVenta, ini), lt(dispensacion.fechaVenta, fin)));
    const entradas = await this.d.db
      .select({ l: recepcionLinea, r: recepcion })
      .from(recepcionLinea)
      .innerJoin(recepcion, eq(recepcion.id, recepcionLinea.recepcionId))
      .where(and(inArray(recepcionLinea.nregistro, psico), gte(recepcion.fechaCompra, desde), sql`${recepcion.fechaCompra} <= ${hasta}`, sql`${recepcion.estado} <> 'ABIERTA'`));
    return [
      ...entradas.map(({ l, r }) => ({ fecha: r.fechaCompra, tipo: 'ENTRADA' as const, cn: l.cn ?? '', nombre: l.nombreFarmaco, lote: l.lote ?? '', unidades: l.unidades, referencia: `MMX-REC-${r.id}-L${l.numero}` })),
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
