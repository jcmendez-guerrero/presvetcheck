import type Decimal from 'decimal.js';
import type { CodigoEquivalencia, CodigoIncidencia, EquivalenciaRules } from '@mmx/shared';
import { concentraciones, mismosPrincipiosActivos, viaCompatible } from './equivalencia';
import { autorizadoParaEspecie } from './medicamento';
import type { ContextoPrescripcion, MedicamentoInfo, PresentacionInfo } from './tipos';
import { contenidoEnvase, totalPaEnvase, type Concentracion } from './unidades';

/**
 * Regla de formato y concentración (SPEC §4.3.1, D-09): se puede dispensar otra presentación si
 * la concentración por unidad es igual o menor y la cantidad total de principio activo nunca es
 * mayor que la prescrita. La menor concentración solo vale para el MISMO medicamento (mismo
 * laboratorio y mismo nombre comercial, p. ej. CLAVUBAY 200/50 en lugar de CLAVUBAY 400/100); entre
 * medicamentos distintos solo cabe sustituir por la misma composición y concentración.
 */

/** Nombre comercial sin dosis ni forma: "CLAVUBAY 400 mg / 100 mg COMPRIMIDOS…" → "CLAVUBAY". */
export function nombreComercial(nombre: string): string {
  return (
    nombre
      // Corta en la primera coma o en el primer dígito a principio de palabra. Con *lookbehind* el coste es lineal
      // (`(?:^|\s+)\d` reintentaba cada tramo de espacios desde cada posición: CodeQL js/polynomial-redos).
      .split(/,|(?<=^|\s)\d/)[0]!
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Mismo medicamento: mismo registro, o mismo laboratorio titular y mismo nombre comercial. */
export function mismoMedicamento(a: MedicamentoInfo, b: MedicamentoInfo): boolean {
  if (a.nregistro === b.nregistro) return true;
  if (!a.labtitular || a.labtitular !== b.labtitular) return false;
  const na = nombreComercial(a.nombre);
  return na !== '' && na === nombreComercial(b.nombre);
}

export type TipoAlternativa = 'MISMA_PRESENTACION' | 'CAMBIO_FORMATO' | 'CAMBIO_CONCENTRACION';

export interface PrescritoFormato {
  medicamento: MedicamentoInfo;
  presentacion: PresentacionInfo;
  envases: number;
}

export interface ResultadoFormato {
  valido: boolean;
  tipo: TipoAlternativa;
  /** Nº de envases que más se acerca sin pasarse. */
  envasesPropuestos: number;
  totalPrescrito: Decimal | null;
  totalPorEnvase: Decimal | null;
  motivos: CodigoEquivalencia[];
  avisos: CodigoIncidencia[];
  /** Unidades (o volumen) del candidato por cada unidad prescrita (500 mg → 250 mg: 2). */
  factorDosis: Decimal | null;
  /** Unidad de forma de la dosis (unidad, ml…). */
  unidadDosis: Concentracion['den'] | null;
  concentracionPrescrita: Concentracion | null;
  concentracionCandidato: Concentracion | null;
  otroLaboratorio: boolean;
}

export function evaluarAlternativaFormato(
  prescrito: PrescritoFormato,
  candidato: { medicamento: MedicamentoInfo; presentacion: PresentacionInfo },
  ctx: ContextoPrescripcion,
  rules: EquivalenciaRules,
): ResultadoFormato {
  const P = prescrito.medicamento;
  const C = candidato.medicamento;
  const motivos: CodigoEquivalencia[] = [];
  const avisos: CodigoIncidencia[] = [];
  const otroLaboratorio = (P.labtitular ?? '') !== (C.labtitular ?? '');
  const base: ResultadoFormato = {
    valido: false,
    tipo: 'CAMBIO_FORMATO',
    envasesPropuestos: 0,
    totalPrescrito: null,
    totalPorEnvase: null,
    motivos,
    avisos,
    factorDosis: null,
    unidadDosis: null,
    concentracionPrescrita: null,
    concentracionCandidato: null,
    otroLaboratorio,
  };

  // 1. Mismos principios activos (y misma proporción si hay varios)
  if (!mismosPrincipiosActivos(P, C)) return { ...base, motivos: ['COMPOSICION_DISTINTA'] };
  // 2. Misma forma, vía y especie autorizada
  if (P.formaId === null || P.formaId !== C.formaId) motivos.push('FORMA_DISTINTA');
  if (!viaCompatible(P, C, ctx.viaPrescritaId)) motivos.push('VIA_NO_AUTORIZADA');
  if (!autorizadoParaEspecie(C, ctx.especieId, rules.especie_padre)) motivos.push('ESPECIE_NO_AUTORIZADA');
  if (C.estado !== 'autorizado' || candidato.presentacion.estado !== 'autorizado')
    motivos.push('NO_AUTORIZADO');
  if (motivos.length) return base;

  const cp = concentraciones(P);
  const cc = concentraciones(C);
  const contP = contenidoEnvase(prescrito.presentacion);
  const contC = contenidoEnvase(candidato.presentacion);
  let ratio: Decimal | null = null;
  let primeraP: Concentracion | null = null;
  let primeraC: Concentracion | null = null;
  let totalPrescrito: Decimal | null = null;
  let totalPorEnvase: Decimal | null = null;

  for (const [paId, c1] of cp) {
    const c2 = cc.get(paId) ?? null;
    // 6. Cantidades no normalizables → no se propone automáticamente
    if (!c1 || !c2 || c1.num !== c2.num || c1.den !== c2.den)
      return { ...base, motivos: ['CANTIDAD_NO_NORMALIZABLE'] };
    // 3. Concentración por unidad ≤ prescrita
    if (c2.valor.greaterThan(c1.valor)) {
      return {
        ...base,
        motivos: ['CONCENTRACION_SUPERIOR'],
        concentracionPrescrita: c1,
        concentracionCandidato: c2,
      };
    }
    const r = c1.valor.div(c2.valor);
    if (ratio === null) {
      ratio = r;
      primeraP = c1;
      primeraC = c2;
      totalPrescrito = totalPaEnvase(c1, contP)?.mul(prescrito.envases) ?? null;
      totalPorEnvase = totalPaEnvase(c2, contC);
    } else if (!ratio.equals(r)) {
      // 1. Misma proporción entre principios activos
      return { ...base, motivos: ['PROPORCION_DISTINTA'] };
    }
  }
  if (!ratio || !primeraP || !primeraC || !totalPrescrito || !totalPorEnvase || totalPorEnvase.isZero()) {
    return { ...base, motivos: ['CANTIDAD_NO_NORMALIZABLE'] };
  }

  // 4. Cantidad total ≤ prescrita: nº de envases que más se acerca sin pasarse
  const envasesPropuestos = totalPrescrito.div(totalPorEnvase).floor().toNumber();
  const mismaConcentracion = ratio.equals(1);
  const mismaPresentacion = candidato.presentacion.cn === prescrito.presentacion.cn;
  const tipo: TipoAlternativa = mismaPresentacion
    ? 'MISMA_PRESENTACION'
    : mismaConcentracion && P.nregistro === C.nregistro
      ? 'CAMBIO_FORMATO'
      : 'CAMBIO_CONCENTRACION';
  const out: ResultadoFormato = {
    ...base,
    tipo,
    envasesPropuestos,
    totalPrescrito,
    totalPorEnvase,
    factorDosis: ratio,
    unidadDosis: primeraC.den,
    concentracionPrescrita: primeraP,
    concentracionCandidato: primeraC,
  };
  if (envasesPropuestos < 1) return { ...out, motivos: ['CANTIDAD_SUPERIOR'] };
  // Menor concentración solo del mismo medicamento (DUDA-09 resuelta).
  if (!mismaConcentracion && !mismoMedicamento(P, C))
    return { ...out, motivos: ['CONCENTRACION_OTRO_MEDICAMENTO'] };

  // 5. Con menor concentración, la dosis debe alcanzarse con unidades enteras (formas contables)
  if (!mismaConcentracion && primeraC.den === 'unidad' && !ratio.isInteger())
    avisos.push('DOSIS_NO_AJUSTABLE');
  if (tipo === 'CAMBIO_FORMATO') avisos.push('CAMBIO_FORMATO');
  if (tipo === 'CAMBIO_CONCENTRACION') avisos.push('CAMBIO_CONCENTRACION');
  return { ...out, valido: true };
}

/** Valida un nº de envases concreto contra la regla (p. ej. 3 × 250 mg × 10 → CANTIDAD_SUPERIOR). */
export function validarEnvasesFormato(r: ResultadoFormato, envases: number): CodigoEquivalencia | null {
  if (!r.totalPrescrito || !r.totalPorEnvase) return 'CANTIDAD_NO_NORMALIZABLE';
  return r.totalPorEnvase.mul(envases).greaterThan(r.totalPrescrito) ? 'CANTIDAD_SUPERIOR' : null;
}

/**
 * Nota de administración para el tutor (obligatoria en cambio de concentración, §4.3.1).
 * Ej.: "Este envase es de 250 mg: administre 2 comprimidos por cada toma de 500 mg indicada por su veterinario".
 */
export function notaAdministracion(r: ResultadoFormato, nombreUnidad = 'comprimidos'): string | null {
  if (
    r.tipo !== 'CAMBIO_CONCENTRACION' ||
    !r.factorDosis ||
    !r.concentracionCandidato ||
    !r.concentracionPrescrita
  )
    return null;
  const fmt = (d: Decimal) => d.toDecimalPlaces(2).toString().replace('.', ',');
  const unidad = r.unidadDosis === 'ml' ? 'ml' : nombreUnidad;
  const porUnidad = r.unidadDosis === 'ml' ? '/ml' : '';
  return (
    `Este envase es de ${fmt(r.concentracionCandidato.valor)} ${r.concentracionCandidato.num}${porUnidad}: ` +
    `administre ${fmt(r.factorDosis)} ${unidad} por cada ${r.unidadDosis === 'ml' ? 'ml' : 'toma'} de ` +
    `${fmt(r.concentracionPrescrita.valor)} ${r.concentracionPrescrita.num}${porUnidad} indicada por su veterinario`
  );
}
