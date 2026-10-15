import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import {
  cimavetMaestra,
  cimavetMedAtc,
  cimavetMedEspecie,
  cimavetMedicamento,
  cimavetMedIndicacion,
  cimavetMedPrincipioActivo,
  cimavetMedTiempoEspera,
  cimavetMedVia,
  cimavetNota,
  cimavetPresentacion,
  cimavetSyncRun,
  MAESTRA,
  type Db,
  type DbOrTx,
} from '@mmx/db';
import type { MedicamentoInfo, PresentacionInfo } from '@mmx/domain';
import { normalizeText } from '@mmx/shared';
import type { Diccionarios, NomenclatorSink } from './nomenclator';
import { diasEspera, type RegistroCache } from './normalizar';

export interface ResultadoBusqueda {
  cn: string;
  nregistro: string;
  nombre: string;
  medicamento: string;
  labtitular: string | null;
  comerc: boolean | null;
  estado: string;
  puntuacion: number;
  /** Autorizado para la especie pedida (null si no se pidió especie). No filtra: el veterinario puede
   * prescribir por cascada y el motor avisa con MEDICAMENTO_ESPECIE_NO_AUTORIZADA. */
  autorizadoEspecie: boolean | null;
}

/** Repositorio de la caché local de CIMAVet (SPEC §5.1.2, §6). */
export class CimavetRepository implements NomenclatorSink {
  constructor(private readonly db: Db) {}

  async existentes(cns: string[]): Promise<Set<string>> {
    if (!cns.length) return new Set();
    const rows = await this.db.select({ cn: cimavetPresentacion.cn }).from(cimavetPresentacion).where(inArray(cimavetPresentacion.cn, cns));
    return new Set(rows.map((r) => r.cn));
  }

  /** Upsert idempotente por nregistro/cn. No borra nada: las bajas se marcan con `estado`. */
  async upsert(regs: RegistroCache[]): Promise<void> {
    if (!regs.length) return;
    await this.db.transaction(async (tx) => {
      for (const r of regs) await this.upsertUno(tx, r);
    });
  }

  private async upsertUno(tx: DbOrTx, r: RegistroCache): Promise<void> {
    const m = r.medicamento;
    const nreg = m.nregistro;
    await tx
      .insert(cimavetMedicamento)
      .values(m)
      .onConflictDoUpdate({
        target: cimavetMedicamento.nregistro,
        set: {
          nombre: sql`excluded.nombre`,
          nombreNorm: sql`excluded.nombre_norm`,
          labtitular: sql`coalesce(excluded.labtitular, ${cimavetMedicamento.labtitular})`,
          labtitularId: sql`coalesce(excluded.labtitular_id, ${cimavetMedicamento.labtitularId})`,
          receta: sql`coalesce(excluded.receta, ${cimavetMedicamento.receta})`,
          antibiotico: sql`coalesce(excluded.antibiotico, ${cimavetMedicamento.antibiotico})`,
          estupefaciente: sql`coalesce(excluded.estupefaciente, ${cimavetMedicamento.estupefaciente})`,
          psicotropo: sql`coalesce(excluded.psicotropo, ${cimavetMedicamento.psicotropo})`,
          tipoMedicamentoId: sql`coalesce(excluded.tipo_medicamento_id, ${cimavetMedicamento.tipoMedicamentoId})`,
          formaId: sql`coalesce(excluded.forma_id, ${cimavetMedicamento.formaId})`,
          administracionId: sql`coalesce(excluded.administracion_id, ${cimavetMedicamento.administracionId})`,
          dispensacionId: sql`coalesce(excluded.dispensacion_id, ${cimavetMedicamento.dispensacionId})`,
          estado: sql`excluded.estado`,
          estadoCodigo: sql`excluded.estado_codigo`,
          comerc: sql`coalesce(excluded.comerc, ${cimavetMedicamento.comerc})`,
          psum: sql`coalesce(excluded.psum, ${cimavetMedicamento.psum})`,
          ema: sql`coalesce(excluded.ema, ${cimavetMedicamento.ema})`,
          notas: sql`coalesce(excluded.notas, ${cimavetMedicamento.notas})`,
          primeraAutorizacion: sql`coalesce(excluded.primera_autorizacion, ${cimavetMedicamento.primeraAutorizacion})`,
          cantidadConcentracion: sql`coalesce(excluded.cantidad_concentracion, ${cimavetMedicamento.cantidadConcentracion})`,
          unidadConcentracion: sql`coalesce(excluded.unidad_concentracion, ${cimavetMedicamento.unidadConcentracion})`,
          raw: sql`excluded.raw`,
          source: sql`excluded.source`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
    for (const p of r.presentaciones) {
      await tx
        .insert(cimavetPresentacion)
        .values(p)
        .onConflictDoUpdate({
          target: cimavetPresentacion.cn,
          set: {
            nregistro: sql`excluded.nregistro`,
            nombre: sql`excluded.nombre`,
            nombreNorm: sql`excluded.nombre_norm`,
            comerc: sql`coalesce(excluded.comerc, ${cimavetPresentacion.comerc})`,
            estado: sql`excluded.estado`,
            estadoCodigo: sql`excluded.estado_codigo`,
            contenido: sql`coalesce(excluded.contenido, ${cimavetPresentacion.contenido})`,
            unidadContenido: sql`coalesce(excluded.unidad_contenido, ${cimavetPresentacion.unidadContenido})`,
            // La API REST no informa la fraccionada: se conserva la del Nomenclátor.
            dispensacionFraccionada: sql`coalesce(excluded.dispensacion_fraccionada, ${cimavetPresentacion.dispensacionFraccionada})`,
            fraccionesAutorizadas: sql`coalesce(excluded.fracciones_autorizadas, ${cimavetPresentacion.fraccionesAutorizadas})`,
            raw: sql`coalesce(excluded.raw, ${cimavetPresentacion.raw})`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    }
    if (r.principiosActivos) {
      // La API no da la base de la composición: no se sustituye una composición normalizable del Nomenclátor.
      const existentes = await tx.select().from(cimavetMedPrincipioActivo).where(eq(cimavetMedPrincipioActivo.nregistro, nreg));
      const conservar = m.source === 'api' && existentes.some((e) => e.normalizable);
      if (!conservar) {
        await tx.delete(cimavetMedPrincipioActivo).where(eq(cimavetMedPrincipioActivo.nregistro, nreg));
        if (r.principiosActivos.length) {
          await tx.insert(cimavetMedPrincipioActivo).values(r.principiosActivos.map((p) => ({ ...p, nregistro: nreg })));
        }
      }
    }
    if (r.especies) {
      await tx.delete(cimavetMedEspecie).where(eq(cimavetMedEspecie.nregistro, nreg));
      const ids = [...new Set(r.especies)];
      if (ids.length) await tx.insert(cimavetMedEspecie).values(ids.map((especieId) => ({ nregistro: nreg, especieId })));
    }
    if (r.vias) {
      await tx.delete(cimavetMedVia).where(eq(cimavetMedVia.nregistro, nreg));
      const ids = [...new Set(r.vias)];
      if (ids.length) await tx.insert(cimavetMedVia).values(ids.map((viaId) => ({ nregistro: nreg, viaId })));
    }
    if (r.atc) {
      await tx.delete(cimavetMedAtc).where(eq(cimavetMedAtc.nregistro, nreg));
      const cods = [...new Set(r.atc)];
      if (cods.length) await tx.insert(cimavetMedAtc).values(cods.map((codigo) => ({ nregistro: nreg, codigo })));
    }
    if (r.indicaciones) {
      await tx.delete(cimavetMedIndicacion).where(eq(cimavetMedIndicacion.nregistro, nreg));
      if (r.indicaciones.length) await tx.insert(cimavetMedIndicacion).values(r.indicaciones.map((i) => ({ ...i, nregistro: nreg })));
    }
    if (r.tiemposEspera) {
      await tx.delete(cimavetMedTiempoEspera).where(eq(cimavetMedTiempoEspera.nregistro, nreg));
      if (r.tiemposEspera.length) await tx.insert(cimavetMedTiempoEspera).values(r.tiemposEspera.map((t) => ({ ...t, nregistro: nreg })));
    }
  }

  /** Marca una baja (tipoCambio 2) sin borrar nada. */
  async marcarBaja(nregistro: string, fecha: string | null, fetchedAt: Date): Promise<void> {
    await this.db
      .update(cimavetMedicamento)
      .set({ estadoCodigo: 'revocado', estado: sql`coalesce(${cimavetMedicamento.estado}, '{}'::jsonb) || ${JSON.stringify({ baja: fecha })}::jsonb`, fetchedAt })
      .where(eq(cimavetMedicamento.nregistro, nregistro));
  }

  async guardarNotas(nregistro: string, notas: { num: string; ref: string | null; asunto: string | null; fecha: string | null; url: string | null }[]) {
    for (const n of notas) {
      await this.db
        .insert(cimavetNota)
        .values({ nregistro, ...n })
        .onConflictDoUpdate({ target: [cimavetNota.nregistro, cimavetNota.num], set: { ref: n.ref, asunto: n.asunto, fecha: n.fecha, url: n.url } });
    }
  }

  async upsertMaestras(tipo: number, items: { id: number | null; codigo: string | null; nombre: string }[]): Promise<number> {
    let n = 0;
    for (const it of items) {
      const clave = it.id !== null ? String(it.id) : it.codigo;
      if (!clave) continue;
      await this.db
        .insert(cimavetMaestra)
        .values({ tipo, clave, id: it.id, codigo: it.codigo, nombre: it.nombre })
        .onConflictDoUpdate({ target: [cimavetMaestra.tipo, cimavetMaestra.clave], set: { id: it.id, codigo: it.codigo, nombre: it.nombre } });
      n++;
    }
    return n;
  }

  async diccionarios(): Promise<Diccionarios> {
    const rows = await this.db
      .select()
      .from(cimavetMaestra)
      .where(inArray(cimavetMaestra.tipo, [MAESTRA.UNIDADES, MAESTRA.PRINCIPIOS_ACTIVOS, MAESTRA.LABORATORIOS, MAESTRA.INDICACIONES]));
    const map = (tipo: number) => new Map(rows.filter((r) => r.tipo === tipo && r.id !== null).map((r) => [r.id as number, r.nombre]));
    return {
      unidades: map(MAESTRA.UNIDADES),
      principiosActivos: map(MAESTRA.PRINCIPIOS_ACTIVOS),
      laboratorios: map(MAESTRA.LABORATORIOS),
      indicaciones: map(MAESTRA.INDICACIONES),
    };
  }

  async nombresMaestra(tipo: number, ids: number[]): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.select().from(cimavetMaestra).where(and(eq(cimavetMaestra.tipo, tipo), inArray(cimavetMaestra.id, ids)));
    return new Map(rows.map((r) => [r.id as number, r.nombre]));
  }

  // ── Lectura ──────────────────────────────────────────────────────────────────

  async medicamentos(nregistros: string[]): Promise<Map<string, MedicamentoInfo & { fetchedAt: Date; source: string }>> {
    const out = new Map<string, MedicamentoInfo & { fetchedAt: Date; source: string }>();
    const ids = [...new Set(nregistros)];
    if (!ids.length) return out;
    const [meds, pas, esp, vias, atcs, inds, tes, pres] = await Promise.all([
      this.db.select().from(cimavetMedicamento).where(inArray(cimavetMedicamento.nregistro, ids)),
      this.db.select().from(cimavetMedPrincipioActivo).where(inArray(cimavetMedPrincipioActivo.nregistro, ids)).orderBy(asc(cimavetMedPrincipioActivo.orden)),
      this.db.select().from(cimavetMedEspecie).where(inArray(cimavetMedEspecie.nregistro, ids)),
      this.db.select().from(cimavetMedVia).where(inArray(cimavetMedVia.nregistro, ids)),
      this.db.select().from(cimavetMedAtc).where(inArray(cimavetMedAtc.nregistro, ids)),
      this.db.select().from(cimavetMedIndicacion).where(inArray(cimavetMedIndicacion.nregistro, ids)),
      this.db.select().from(cimavetMedTiempoEspera).where(inArray(cimavetMedTiempoEspera.nregistro, ids)),
      this.db.select({ nregistro: cimavetPresentacion.nregistro, comerc: cimavetPresentacion.comerc }).from(cimavetPresentacion).where(inArray(cimavetPresentacion.nregistro, ids)),
    ]);
    for (const m of meds) {
      const de = <T extends { nregistro: string }>(xs: T[]) => xs.filter((x) => x.nregistro === m.nregistro);
      const atc = de(atcs).map((a) => a.codigo);
      out.set(m.nregistro, {
        nregistro: m.nregistro,
        nombre: m.nombre,
        labtitular: m.labtitular,
        receta: m.receta ?? true,
        antibiotico: m.antibiotico ?? false,
        estupefaciente: m.estupefaciente ?? false,
        psicotropo: m.psicotropo ?? false,
        // Inmunológico: tipoMedicamento 2 (inmunológico) o 3 (mixto), o ATCvet QI (docs/dudas.md DUDA-06).
        inmunologico: m.tipoMedicamentoId === 2 || m.tipoMedicamentoId === 3 || atc.some((a) => a.toUpperCase().startsWith('QI')),
        biologico: false,
        usoHumano: false,
        formaId: m.formaId,
        viaIds: de(vias).map((v) => v.viaId),
        especieIds: de(esp).map((e) => e.especieId),
        atc,
        indicaciones: de(inds).map((i) => ({ especieId: i.especieId, texto: i.nombre ?? '' })).filter((i) => i.texto),
        tiemposEspera: de(tes).map((t) => ({
          especieId: t.especieId,
          tejido: t.tejido,
          dias: diasEspera(t.cantidad, t.unidad),
          noAplica: t.noAplicaTejido,
        })),
        estado: m.estadoCodigo as MedicamentoInfo['estado'],
        comerc: m.comerc ?? de(pres).some((p) => p.comerc === true),
        psum: m.psum ?? false,
        notas: m.notas ?? false,
        composicion: {
          pas: de(pas).map((p) => ({ paId: p.paId, nombre: p.nombre ?? `PA ${p.paId}`, cantidad: p.cantidadRaw, unidad: p.unidadRaw })),
          porCantidad: m.cantidadConcentracion,
          porUnidad: m.unidadConcentracion,
        },
        fetchedAt: m.fetchedAt,
        source: m.source,
      });
    }
    return out;
  }

  async medicamento(nregistro: string) {
    return (await this.medicamentos([nregistro])).get(nregistro) ?? null;
  }

  private toPresentacion(p: typeof cimavetPresentacion.$inferSelect): PresentacionInfo & { fetchedAt: Date } {
    return {
      cn: p.cn,
      nregistro: p.nregistro,
      nombre: p.nombre,
      comerc: p.comerc ?? false,
      estado: p.estadoCodigo as PresentacionInfo['estado'],
      contenido: p.contenido,
      unidadContenido: p.unidadContenido,
      fraccionable: p.dispensacionFraccionada ?? false,
      fracciones: p.fraccionesAutorizadas,
      fetchedAt: p.fetchedAt,
    };
  }

  async presentacion(cn: string) {
    const [p] = await this.db.select().from(cimavetPresentacion).where(eq(cimavetPresentacion.cn, cn));
    return p ? this.toPresentacion(p) : null;
  }

  async presentacionesDe(nregistros: string[]) {
    if (!nregistros.length) return [];
    const rows = await this.db.select().from(cimavetPresentacion).where(inArray(cimavetPresentacion.nregistro, nregistros)).orderBy(asc(cimavetPresentacion.cn));
    return rows.map((p) => this.toPresentacion(p));
  }

  /**
   * Búsqueda difusa (trigramas) sobre nombre de medicamento y presentación, filtrada por especie y
   * forma si constan (SPEC §4.2.1). Nunca autoselecciona: devuelve candidatos con puntuación.
   */
  async buscar(q: string, f: { especieId?: number | null; formaId?: number | null; limite?: number } = {}): Promise<ResultadoBusqueda[]> {
    const n = normalizeText(q);
    if (!n) return [];
    const cn = /^\d{6,7}$/.test(n) ? n.slice(0, 6) : null;
    // La especie ordena (primero los autorizados) pero no filtra.
    const especie = f.especieId ? sql`exists (select 1 from cimavet_med_especie e where e.nregistro = m.nregistro and e.especie_id = ${f.especieId})` : sql`null::boolean`;
    const filtros = [sql`true`, f.formaId ? sql`m.forma_id = ${f.formaId}` : sql`true`];
    const res = await this.db.execute(sql`
      select p.cn, p.nregistro, p.nombre, m.nombre as medicamento, m.labtitular, p.comerc, p.estado_codigo as estado, ${especie} as autorizado_especie,
             greatest(similarity(p.nombre_norm, ${n}), word_similarity(${n}, p.nombre_norm), word_similarity(${n}, m.nombre_norm),
                      case when p.cn = ${cn} then 1 else 0 end) as puntuacion
      from cimavet_presentacion p join cimavet_medicamento m on m.nregistro = p.nregistro
      where (p.nombre_norm % ${n} or ${n} <% p.nombre_norm or ${n} <% m.nombre_norm or p.nombre_norm like ${`%${n}%`} or p.cn = ${cn})
        and ${filtros[0]} and ${filtros[1]}
      order by puntuacion desc, autorizado_especie desc nulls last, p.comerc desc nulls last, p.cn
      limit ${f.limite ?? 10}`);
    const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      cn: String(r.cn),
      nregistro: String(r.nregistro),
      nombre: String(r.nombre),
      medicamento: String(r.medicamento),
      labtitular: (r.labtitular as string | null) ?? null,
      comerc: (r.comerc as boolean | null) ?? null,
      estado: String(r.estado),
      puntuacion: Number(r.puntuacion),
      autorizadoEspecie: r.autorizado_especie === null || r.autorizado_especie === undefined ? null : Boolean(r.autorizado_especie),
    }));
  }

  /** Medicamentos con el mismo conjunto de principios activos (candidatos a formato/sustitución). */
  async nregistrosMismosPa(nregistro: string, limite = 50): Promise<string[]> {
    const res = await this.db.execute(sql`
      with objetivo as (
        select array_agg(pa_id order by pa_id) as pas from cimavet_med_principio_activo where nregistro = ${nregistro}
      ), todos as (
        select nregistro, array_agg(pa_id order by pa_id) as pas from cimavet_med_principio_activo group by nregistro
      )
      select t.nregistro from todos t, objetivo o where t.pas = o.pas order by t.nregistro limit ${limite}`);
    const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Array<{ nregistro: string }>;
    return rows.map((r) => r.nregistro);
  }

  /** Medicamentos que contienen un principio activo (opciones para "solo principio activo"). */
  async nregistrosConPa(paIds: number[], limite = 50): Promise<string[]> {
    if (!paIds.length) return [];
    const rows = await this.db
      .selectDistinct({ nregistro: cimavetMedPrincipioActivo.nregistro })
      .from(cimavetMedPrincipioActivo)
      .where(inArray(cimavetMedPrincipioActivo.paId, paIds))
      .limit(limite);
    return rows.map((r) => r.nregistro);
  }

  async nregistrosAntiguos(antesDe: Date, limite = 5000): Promise<string[]> {
    const rows = await this.db
      .select({ nregistro: cimavetMedicamento.nregistro })
      .from(cimavetMedicamento)
      .where(lt(cimavetMedicamento.fetchedAt, antesDe))
      .orderBy(asc(cimavetMedicamento.fetchedAt))
      .limit(limite);
    return rows.map((r) => r.nregistro);
  }

  async iniciarSync(tipo: string, inicio: Date): Promise<string> {
    const [r] = await this.db.insert(cimavetSyncRun).values({ tipo, inicio }).returning({ id: cimavetSyncRun.id });
    return r!.id;
  }

  async finalizarSync(id: string, fin: Date, contadores: unknown, error: string | null = null): Promise<void> {
    await this.db.update(cimavetSyncRun).set({ fin, contadores: contadores as never, error }).where(eq(cimavetSyncRun.id, id));
  }

  /** Inicio de la última sincronización correcta (nomenclator, delta o full). */
  async ultimaSyncCorrecta(): Promise<Date | null> {
    const [r] = await this.db
      .select({ inicio: cimavetSyncRun.inicio })
      .from(cimavetSyncRun)
      .where(and(isNotNull(cimavetSyncRun.fin), sql`${cimavetSyncRun.error} is null`, inArray(cimavetSyncRun.tipo, ['nomenclator', 'delta', 'full'])))
      .orderBy(desc(cimavetSyncRun.inicio))
      .limit(1);
    return r?.inicio ?? null;
  }

  async ultimasSync(limite = 20) {
    return this.db.select().from(cimavetSyncRun).orderBy(desc(cimavetSyncRun.inicio)).limit(limite);
  }
}
