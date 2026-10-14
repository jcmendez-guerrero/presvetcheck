import { and, eq, inArray, sql } from 'drizzle-orm';
import { cimavetMaestra, MAESTRA } from '@mmx/db';
import type { Candidato, MedicamentoInfo, PresentacionInfo } from '@mmx/domain';
import { normalizeText } from '@mmx/shared';
import type { AppDeps } from '../deps';

/** Acceso a la caché de CIMAVet para los servicios (SPEC §4.2). */
export class MedicamentosService {
  constructor(private readonly d: AppDeps) {}

  info(nregistro: string) {
    return this.d.cimavet.medicamento(nregistro);
  }

  presentacion(cn: string) {
    return this.d.cimavet.presentacion(cn);
  }

  /** Verificación en vivo si la caché es antigua; devuelve la fecha de la caché si CIMAVet no responde. */
  async verificar(nregistro: string): Promise<Date | null> {
    if (!this.d.verificarEnVivo) return null;
    try {
      return (await this.d.verificarEnVivo(nregistro)).cacheDesde;
    } catch {
      return (await this.info(nregistro))?.fetchedAt ?? null;
    }
  }

  /** Otras presentaciones con el mismo conjunto de principios activos (formato y sustitución). */
  async candidatos(nregistro: string, excluirCn: string): Promise<Candidato[]> {
    const nregs = await this.d.cimavet.nregistrosMismosPa(nregistro);
    const meds = await this.d.cimavet.medicamentos(nregs);
    const pres = await this.d.cimavet.presentacionesDe(nregs);
    return pres
      .filter((p) => p.cn !== excluirCn && meds.has(p.nregistro))
      .map((p) => ({ medicamento: meds.get(p.nregistro) as MedicamentoInfo, presentacion: p as PresentacionInfo }));
  }

  /** Ids de una maestra cuyo nombre coincide (o contiene) el texto normalizado. */
  async idsPorTexto(tipo: number, texto: string | null, limite = 5): Promise<number[]> {
    if (!texto) return [];
    const t = normalizeText(texto);
    const filas = await this.d.db.select({ id: cimavetMaestra.id, nombre: cimavetMaestra.nombre }).from(cimavetMaestra).where(eq(cimavetMaestra.tipo, tipo));
    const exactos = filas.filter((f) => normalizeText(f.nombre) === t);
    const parecidos = filas.filter((f) => normalizeText(f.nombre).startsWith(t) || t.startsWith(normalizeText(f.nombre)));
    return [...new Set([...exactos, ...parecidos].map((f) => f.id as number))].slice(0, limite);
  }

  /** Especie de la receta: id de la maestra de especies (texto libre "Perro" → Perros). */
  async especiePorTexto(texto: string | null): Promise<number | null> {
    if (!texto) return null;
    const t = normalizeText(texto);
    const filas = await this.d.db.select({ id: cimavetMaestra.id, nombre: cimavetMaestra.nombre }).from(cimavetMaestra).where(eq(cimavetMaestra.tipo, MAESTRA.ESPECIES));
    const exacto = filas.find((f) => normalizeText(f.nombre) === t);
    if (exacto) return exacto.id;
    // Singular/plural: "perro" → "perros", "gato" → "gatos", "bovino".
    const plural = filas.find((f) => normalizeText(f.nombre) === `${t}s` || normalizeText(f.nombre) === `${t}es`);
    return plural?.id ?? null;
  }

  async nombresEspecies(ids: number[]): Promise<string[]> {
    if (!ids.length) return [];
    const m = await this.d.cimavet.nombresMaestra(MAESTRA.ESPECIES, ids);
    return ids.map((i) => m.get(i)).filter((x): x is string => !!x);
  }

  async nombreMaestra(tipo: number, id: number | null): Promise<string | null> {
    if (id === null) return null;
    const [r] = await this.d.db.select().from(cimavetMaestra).where(and(eq(cimavetMaestra.tipo, tipo), eq(cimavetMaestra.id, id)));
    return r?.nombre ?? null;
  }

  /** "amoxicilina 400 mg; ácido clavulánico 100 mg" (SPEC §4.8). */
  textoPrincipiosActivos(m: MedicamentoInfo): string {
    return m.composicion.pas
      .map((p) => [p.nombre.toLowerCase(), p.cantidad, p.unidad].filter(Boolean).join(' '))
      .join('; ');
  }

  /**
   * Opciones para una receta solo con principio activo (SPEC §4.1.4): medicamentos autorizados y
   * comercializados con ese principio activo, especie y forma, y cuáles hay en stock.
   */
  async opcionesSoloPA(paTexto: string | null, especieId: number | null) {
    const paIds = await this.idsPorTexto(MAESTRA.PRINCIPIOS_ACTIVOS, paTexto, 20);
    const nregs = await this.d.cimavet.nregistrosConPa(paIds);
    const meds = await this.d.cimavet.medicamentos(nregs);
    const pres = await this.d.cimavet.presentacionesDe(nregs);
    const out = [];
    for (const p of pres) {
      const m = meds.get(p.nregistro);
      if (!m || m.estado !== 'autorizado') continue;
      if (especieId !== null && !m.especieIds.includes(especieId)) continue;
      const s = await this.d.stock.lotes(p.cn, { nombre: m.nombre, labtitular: m.labtitular });
      out.push({ cn: p.cn, nregistro: p.nregistro, nombre: p.nombre, labtitular: m.labtitular, comerc: p.comerc, enStock: s.lotes.some((l) => l.disponible > 0) });
    }
    return out.sort((a, b) => Number(b.enStock) - Number(a.enStock) || Number(b.comerc) - Number(a.comerc));
  }

  async contarMedicamentos(): Promise<number> {
    const r = await this.d.db.execute(sql`select count(*)::int as n from cimavet_medicamento`);
    const rows = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  async maestra(tipo: number, ids: number[]) {
    if (!ids.length) return [];
    return this.d.db.select().from(cimavetMaestra).where(and(eq(cimavetMaestra.tipo, tipo), inArray(cimavetMaestra.id, ids)));
  }
}
