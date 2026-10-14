import Decimal from 'decimal.js';
import type {
  CodigoEquivalencia,
  CodigoIncidencia,
  Decision,
  EquivalenciaRules,
  ModoSustitucion,
  SustitucionExclusiones,
} from '@mmx/shared';
import { evaluarEquivalencia } from './equivalencia';
import { comparar, type FechaIso } from './fechas';
import { caducidadFefo, disponibleNoCaducado, proponerLotes, type ResultadoFefo } from './fefo';
import { evaluarAlternativaFormato, notaAdministracion, type ResultadoFormato } from './formato';
import type { ForzadoAceptado } from './forzado';
import { incidencia, type PoliticaSeveridad } from './severidad';
import { modoEfectivo, sustitucionPermitida } from './sustitucion';
import type {
  ContextoPrescripcion,
  Incidencia,
  MedicamentoInfo,
  PresentacionInfo,
  ResultadoEquivalencia,
  ResultadoMotor,
  StockPorCn,
} from './tipos';

/**
 * Motor de decisión por línea (SPEC §4.3). Orden de evaluación:
 *  1. BLOQUEANTE_DURO → NO_CONFORME (no forzable); BLOQUEANTE_FORMA → NO_CONFORME (forzable),
 *     y si se fuerza se continúa con forzado=true.
 *  2. Stock del CN prescrito → DISPENSAR (lote FEFO).
 *  3. Stock de otra presentación que cumpla la regla de formato y concentración → DISPENSAR_CON_AVISO.
 *  4. ¿Sustitución permitida? Si no → PEDIR.
 *  5. Equivalentes con stock → SUSTITUIR.  6. Equivalentes sin stock → PEDIR + lista.  7. → PEDIR.
 */

export interface Candidato {
  medicamento: MedicamentoInfo;
  presentacion: PresentacionInfo;
  /** Precio de coste conocido (4 decimales), para ordenar sustitutos. */
  precioCoste?: string | null;
}

export interface EntradaDecision {
  linea: number;
  incidencias: Incidencia[];
  forzado: ForzadoAceptado | null;
  prescrito: { medicamento: MedicamentoInfo; presentacion: PresentacionInfo; envases: number } | null;
  /** Otras presentaciones con los mismos principios activos (de la caché), excluida la prescrita. */
  candidatos: Candidato[];
  stock: StockPorCn;
  /** Avisos del adaptador de stock (p. ej. stock ilimitado mal configurado). */
  avisosStock?: Incidencia[];
  ctx: ContextoPrescripcion;
  exclusiones: SustitucionExclusiones['exclusiones'];
  politica: PoliticaSeveridad;
  equivalencia: EquivalenciaRules;
  config: { allowPackSizeChange: boolean; modoSustitucion: ModoSustitucion };
  hoy: FechaIso;
  reglaVersion: string;
}

export interface Sustituto {
  cn: string;
  nregistro: string;
  nombre: string;
  labtitular: string | null;
  origen: 'EQUIVALENTE' | 'MENOR_CONCENTRACION_OTRO_LABORATORIO';
  equivalencia: ResultadoEquivalencia;
  formato: ResultadoFormato | null;
  modo: ModoSustitucion;
  disponible: number;
  caducidadFefo: FechaIso | null;
  precioCoste: string | null;
  envases: number;
  nota: string | null;
}

export interface EvidenciasDecision {
  forzable: boolean;
  forzado: boolean;
  codigosForzados: CodigoIncidencia[];
  psicotropo: boolean;
  cn: string | null;
  lotes?: ResultadoFefo;
  alternativaFormato?: {
    cn: string;
    nregistro: string;
    nombre: string;
    envases: number;
    formato: ResultadoFormato;
    nota: string | null;
    lotes: ResultadoFefo;
  };
  alternativasDescartadas: { cn: string; nombre: string; motivos: CodigoEquivalencia[] }[];
  sustitucionBloqueada: CodigoIncidencia[];
  sustitutos: Sustituto[];
  descartados: { cn: string; nombre: string; motivos: CodigoEquivalencia[] }[];
  revisarManual: { cn: string; nombre: string; motivos: CodigoEquivalencia[] }[];
  pedido?: {
    cn: string;
    nombre: string;
    labtitular: string | null;
    psum: boolean;
    equivalentes: { cn: string; nombre: string; labtitular: string | null; psum: boolean }[];
  };
}

export type ResultadoDecision = ResultadoMotor<Decision, EvidenciasDecision>;

const AVISOS_FEFO_A_INCIDENCIA = (r: ResultadoFefo, linea: number, pol: PoliticaSeveridad): Incidencia[] =>
  r.avisos.map((a) => incidencia(a.code, pol, { linea, params: a.params }));

export function decidirLinea(e: EntradaDecision): ResultadoDecision {
  const pol = e.politica;
  const linea = e.linea;
  const avisosEntrada = e.incidencias.filter((i) => i.severidad === 'AVISO');
  const duros = e.incidencias.filter((i) => i.severidad === 'BLOQUEANTE_DURO');
  const forma = e.incidencias.filter((i) => i.severidad === 'BLOQUEANTE_FORMA');
  const ev: EvidenciasDecision = {
    forzable: false,
    forzado: false,
    codigosForzados: [],
    psicotropo: e.prescrito?.medicamento.psicotropo ?? false,
    cn: e.prescrito?.presentacion.cn ?? null,
    alternativasDescartadas: [],
    sustitucionBloqueada: [],
    sustitutos: [],
    descartados: [],
    revisarManual: [],
  };
  const out = (decision: Decision, motivos: Incidencia[]): ResultadoDecision => ({
    decision,
    motivos,
    evidencias: ev,
    reglaVersion: e.reglaVersion,
  });

  // 1. Bloqueos
  if (duros.length) return out('NO_CONFORME', [...duros, ...forma, ...avisosEntrada]);
  if (forma.length) {
    const forzadosOk =
      e.forzado !== null &&
      forma.every((f) => e.forzado?.codigos.includes(f.code)) &&
      e.forzado.codigos.every((c) => forma.some((f) => f.code === c));
    if (!forzadosOk) {
      ev.forzable = true;
      return out('NO_CONFORME', [...forma, ...avisosEntrada]);
    }
    ev.forzado = true;
    ev.codigosForzados = [...new Set(forma.map((f) => f.code))];
  }
  /* v8 ignore next 2 -- MEDICAMENTO_NO_SELECCIONADO (duro) ya cubre este caso */
  if (!e.prescrito) return out('NO_CONFORME', [incidencia('MEDICAMENTO_NO_SELECCIONADO', pol, { linea, params: { linea } })]);

  const motivos: Incidencia[] = [...(ev.forzado ? forma : []), ...avisosEntrada, ...(e.avisosStock ?? [])];
  const P = e.prescrito;
  if (e.stock === 'NO_DISPONIBLE') {
    return out('PENDIENTE_STOCK', [...motivos, incidencia('STOCK_NO_DISPONIBLE', pol, { linea })]);
  }
  const stock = e.stock;
  const lotesDe = (cn: string) => stock[cn] ?? [];

  // 2. Stock de la presentación prescrita
  const lotesPrescrito = lotesDe(P.presentacion.cn);
  if (disponibleNoCaducado(lotesPrescrito, e.hoy) > 0) {
    const fefo = proponerLotes({ lotes: lotesPrescrito, unidades: P.envases, hoy: e.hoy, duracionDias: e.ctx.duracionDias });
    ev.lotes = fefo;
    return out('DISPENSAR', [...motivos, ...AVISOS_FEFO_A_INCIDENCIA(fefo, linea, pol)]);
  }

  // 3. Otra presentación (mismo medicamento o mismo laboratorio) que cumpla la regla de formato
  const evaluados = e.candidatos.map((c) => ({
    c,
    formato: evaluarAlternativaFormato(P, c, e.ctx, e.equivalencia),
    disponible: disponibleNoCaducado(lotesDe(c.presentacion.cn), e.hoy),
  }));
  if (e.config.allowPackSizeChange) {
    const validos = evaluados
      .filter((x) => x.formato.valido && !x.formato.otroLaboratorio && x.disponible > 0)
      .sort((a, b) => ordenFormato(a.formato, b.formato));
    for (const x of evaluados) {
      if (!x.formato.valido && !x.formato.otroLaboratorio) {
        ev.alternativasDescartadas.push({ cn: x.c.presentacion.cn, nombre: x.c.presentacion.nombre, motivos: x.formato.motivos });
      }
    }
    const mejor = validos[0];
    if (mejor) {
      const envases = Math.min(mejor.formato.envasesPropuestos, mejor.disponible);
      const lotes = proponerLotes({ lotes: lotesDe(mejor.c.presentacion.cn), unidades: envases, hoy: e.hoy, duracionDias: e.ctx.duracionDias });
      ev.alternativaFormato = {
        cn: mejor.c.presentacion.cn,
        nregistro: mejor.c.medicamento.nregistro,
        nombre: mejor.c.presentacion.nombre,
        envases,
        formato: mejor.formato,
        nota: notaAdministracion(mejor.formato),
        lotes,
      };
      ev.cn = mejor.c.presentacion.cn;
      return out('DISPENSAR_CON_AVISO', [
        ...motivos,
        ...mejor.formato.avisos.map((a) => incidencia(a, pol, { linea })),
        ...AVISOS_FEFO_A_INCIDENCIA(lotes, linea, pol),
      ]);
    }
  }

  const pedido = (equivalentes: Candidato[]): NonNullable<EvidenciasDecision['pedido']> => ({
    cn: P.presentacion.cn,
    nombre: P.presentacion.nombre,
    labtitular: P.medicamento.labtitular,
    psum: P.medicamento.psum,
    equivalentes: equivalentes.map((c) => ({
      cn: c.presentacion.cn,
      nombre: c.presentacion.nombre,
      labtitular: c.medicamento.labtitular,
      psum: c.medicamento.psum,
    })),
  });

  // 4. ¿Sustitución permitida? (no se evalúan equivalentes si no lo está)
  const permitida = sustitucionPermitida(P.medicamento, e.ctx.clase, e.exclusiones);
  if (!permitida.permitida) {
    ev.sustitucionBloqueada = permitida.motivos;
    ev.pedido = pedido([]);
    return out('PEDIR', [...motivos, ...permitida.motivos.map((m) => incidencia(m, pol, { linea }))]);
  }

  // 5-7. Equivalentes de otros medicamentos
  const equivalentes: Candidato[] = [];
  for (const x of evaluados) {
    if (x.c.medicamento.nregistro === P.medicamento.nregistro) continue;
    if (x.c.medicamento.usoHumano) {
      ev.descartados.push({ cn: x.c.presentacion.cn, nombre: x.c.presentacion.nombre, motivos: ['USO_HUMANO'] });
      continue;
    }
    let equivalencia = evaluarEquivalencia(P.medicamento, x.c.medicamento, e.ctx, e.equivalencia);
    let origen: Sustituto['origen'] = 'EQUIVALENTE';
    let formato: ResultadoFormato | null = null;
    let envases = P.envases;
    // Menor concentración de otro laboratorio: regla de formato + condiciones y flujo de sustitución
    // (§4.3.1). Conservador: siempre con aprobación previa del garante (docs/dudas.md DUDA-09).
    if (!equivalencia.equivalente && x.formato.valido && x.formato.otroLaboratorio && x.formato.tipo === 'CAMBIO_CONCENTRACION') {
      const sinConc = evaluarEquivalencia(P.medicamento, x.c.medicamento, e.ctx, e.equivalencia, { ignorarConcentracion: true });
      if (sinConc.equivalente) {
        equivalencia = { ...sinConc, requiereAprobacionPrevia: true };
        origen = 'MENOR_CONCENTRACION_OTRO_LABORATORIO';
        formato = x.formato;
        envases = x.formato.envasesPropuestos;
      }
    }
    if (!equivalencia.equivalente) {
      // No normalizable → "revisar manualmente" (no se propone sola); el resto, descartado con motivo.
      (equivalencia.revisarManual ? ev.revisarManual : ev.descartados).push({
        cn: x.c.presentacion.cn,
        nombre: x.c.presentacion.nombre,
        motivos: equivalencia.motivos,
      });
      continue;
    }
    equivalentes.push(x.c);
    if (x.disponible > 0) {
      ev.sustitutos.push({
        cn: x.c.presentacion.cn,
        nregistro: x.c.medicamento.nregistro,
        nombre: x.c.presentacion.nombre,
        labtitular: x.c.medicamento.labtitular,
        origen,
        equivalencia,
        formato,
        modo: modoEfectivo(e.config.modoSustitucion, equivalencia),
        disponible: x.disponible,
        caducidadFefo: caducidadFefo(lotesDe(x.c.presentacion.cn), e.hoy),
        precioCoste: x.c.precioCoste ?? null,
        envases: Math.min(envases, x.disponible),
        nota: formato ? notaAdministracion(formato) : null,
      });
    }
  }

  if (ev.sustitutos.length) {
    ev.sustitutos.sort(ordenSustitutos);
    ev.cn = ev.sustitutos[0]?.cn ?? null;
    return out('SUSTITUIR', [...motivos, incidencia('SUSTITUCION', pol, { linea })]);
  }
  ev.pedido = pedido(equivalentes);
  return out('PEDIR', motivos);
}

/** Preferencia: cambio de formato antes que de concentración; luego la cantidad total más cercana. */
function ordenFormato(a: ResultadoFormato, b: ResultadoFormato): number {
  const rank = (r: ResultadoFormato) => (r.tipo === 'CAMBIO_FORMATO' ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const total = (r: ResultadoFormato) => (r.totalPorEnvase ?? new Decimal(0)).mul(r.envasesPropuestos);
  return total(b).comparedTo(total(a));
}

/** Orden de propuesta (§4.4.2): con stock; caducidad FEFO más lejana; menor precio de coste. */
function ordenSustitutos(a: Sustituto, b: Sustituto): number {
  if (a.caducidadFefo !== b.caducidadFefo) {
    if (a.caducidadFefo === null) return 1;
    if (b.caducidadFefo === null) return -1;
    return comparar(b.caducidadFefo, a.caducidadFefo);
  }
  const pa = a.precioCoste !== null ? new Decimal(a.precioCoste) : null;
  const pb = b.precioCoste !== null ? new Decimal(b.precioCoste) : null;
  if (pa && pb) return pa.comparedTo(pb);
  if (pa) return -1;
  if (pb) return 1;
  return 0;
}

const ORDEN_GRAVEDAD: Decision[] = ['DISPENSAR', 'DISPENSAR_CON_AVISO', 'SUSTITUIR', 'PEDIR', 'PENDIENTE_STOCK', 'NO_CONFORME'];

/** La receta se resume como el peor estado de sus líneas (§4.3). */
export function resumenReceta(decisiones: Decision[]): Decision | null {
  if (decisiones.length === 0) return null;
  return decisiones.reduce((a, b) => (ORDEN_GRAVEDAD.indexOf(b) > ORDEN_GRAVEDAD.indexOf(a) ? b : a));
}
