import type { CodigoEquivalencia, EquivalenciaIndicacion, EquivalenciaRules } from '@mmx/shared';
import { compararIndicacion, esIndicacionGenerica } from './indicacion';
import { autorizadoParaEspecie, especiesEquivalentes } from './medicamento';
import type { ContextoPrescripcion, MedicamentoInfo, ResultadoEquivalencia } from './tipos';
import { concentracion, concentracionDelNombre, type Concentracion } from './unidades';

/** Conjunto de principios activos con su concentración normalizada (null = no normalizable). */
export function concentraciones(m: MedicamentoInfo): Map<number, Concentracion | null> {
  return new Map(m.composicion.pas.map((pa) => [pa.paId, concentracion(pa, m.composicion)]));
}

export function mismosPrincipiosActivos(a: MedicamentoInfo, b: MedicamentoInfo): boolean {
  const ia = new Set(a.composicion.pas.map((p) => p.paId));
  const ib = new Set(b.composicion.pas.map((p) => p.paId));
  return ia.size > 0 && ia.size === ib.size && [...ia].every((x) => ib.has(x));
}

/** Vía: la prescrita debe estar entre las del candidato; sin vía en receta, todas las del prescrito. */
export function viaCompatible(
  prescrito: MedicamentoInfo,
  candidato: MedicamentoInfo,
  viaPrescritaId: number | null,
): boolean {
  if (viaPrescritaId !== null) return candidato.viaIds.includes(viaPrescritaId);
  return prescrito.viaIds.length > 0 && prescrito.viaIds.every((v) => candidato.viaIds.includes(v));
}

/**
 * Tiempo de espera del candidato ≤ el del prescrito para cada tejido y especie (productoras).
 * Sin dato comparable → no equivalente (conservador).
 */
export function tiemposEsperaCompatibles(
  prescrito: MedicamentoInfo,
  candidato: MedicamentoInfo,
  especies: number[],
): CodigoEquivalencia | null {
  const delPrescrito = prescrito.tiemposEspera.filter(
    (t) => t.especieId === null || especies.includes(t.especieId),
  );
  if (delPrescrito.length === 0) return 'TIEMPO_ESPERA_DESCONOCIDO';
  for (const tp of delPrescrito) {
    if (tp.noAplica) continue;
    const tc = candidato.tiemposEspera.filter(
      (t) =>
        (t.especieId === null || especies.includes(t.especieId)) && (t.tejido ?? '') === (tp.tejido ?? ''),
    );
    if (tc.length === 0 || tp.dias === null) return 'TIEMPO_ESPERA_DESCONOCIDO';
    for (const t of tc) {
      if (t.noAplica) continue;
      if (t.dias === null) return 'TIEMPO_ESPERA_DESCONOCIDO';
      if (t.dias > tp.dias) return 'TIEMPO_ESPERA_SUPERIOR';
    }
  }
  return null;
}

export interface OpcionesEquivalencia {
  /** Prescripción "virtual" construida desde la receta (solo principio activo): sin tiempos de espera propios. */
  prescripcionVirtual?: boolean;
}

/**
 * Equivalencia para sustitución (SPEC §4.4.2). Todas las condiciones son obligatorias.
 */
export function evaluarEquivalencia(
  prescrito: MedicamentoInfo,
  candidato: MedicamentoInfo,
  ctx: ContextoPrescripcion,
  rules: EquivalenciaRules,
  opts: OpcionesEquivalencia = {},
): ResultadoEquivalencia {
  const motivos: CodigoEquivalencia[] = [];
  let revisarManual = false;

  if (candidato.usoHumano) motivos.push('USO_HUMANO');

  // 1 y 4. Composición cualitativa y cuantitativa
  if (!mismosPrincipiosActivos(prescrito, candidato)) {
    motivos.push('COMPOSICION_DISTINTA');
  } else {
    const cp = concentraciones(prescrito);
    const cc = concentraciones(candidato);
    let concentracionDistinta = false;
    for (const [paId, c1] of cp) {
      const c2 = cc.get(paId) ?? null;
      if (!c1 || !c2) {
        revisarManual = true;
        continue;
      }
      if (c1.num !== c2.num || c1.den !== c2.den || !c1.valor.equals(c2.valor)) {
        concentracionDistinta = true;
        break;
      }
    }
    if (concentracionDistinta) {
      const nomP = prescrito.nombre ? concentracionDelNombre(prescrito.nombre) : null;
      const nomC = candidato.nombre ? concentracionDelNombre(candidato.nombre) : null;
      if (nomP && nomC && nomP.toLowerCase() === nomC.toLowerCase()) {
        if (nomP.includes('+') || nomP.includes('/') || prescrito.composicion.pas.length > 1) {
          concentracionDistinta = false;
        }
      } else {
        motivos.push('CONCENTRACION_DISTINTA');
      }
      if (concentracionDistinta && !motivos.includes('CONCENTRACION_DISTINTA')) {
        motivos.push('CONCENTRACION_DISTINTA');
      }
    }
    if (revisarManual && concentracionDistinta) motivos.push('CANTIDAD_NO_NORMALIZABLE');
  }

  // 2. Forma farmacéutica
  if (prescrito.formaId === null || prescrito.formaId !== candidato.formaId) motivos.push('FORMA_DISTINTA');
  // 3. Vía
  if (!viaCompatible(prescrito, candidato, ctx.viaPrescritaId)) motivos.push('VIA_NO_AUTORIZADA');
  // 5. Especie
  if (!autorizadoParaEspecie(candidato, ctx.especieId, rules.especie_padre))
    motivos.push('ESPECIE_NO_AUTORIZADA');

  const especies = especiesEquivalentes(ctx.especieId, rules.especie_padre);

  // 6. Indicación
  const esGenerica = esIndicacionGenerica(ctx.indicacion);
  let ind: { resultado: EquivalenciaIndicacion; similitud: number; mejor: string | null };
  if (esGenerica) {
    ind = { resultado: 'PROBABLE', similitud: 0, mejor: null };
    motivos.push('INDICACION_PROBABLE');
  } else {
    const indicacionesCandidato = candidato.indicaciones
      .filter((i) => i.especieId === null || especies.includes(i.especieId))
      .map((i) => i.texto);
    ind = compararIndicacion(ctx.indicacion, indicacionesCandidato, rules.indicacion);
    if (ind.resultado === 'NO_COINCIDE') motivos.push('INDICACION_NO_COINCIDE');
    if (ind.resultado === 'PROBABLE') motivos.push('INDICACION_PROBABLE');
  }

  // 7. Tiempos de espera en especies productoras
  if (ctx.especieProduccion) {
    const te = opts.prescripcionVirtual
      ? 'TIEMPO_ESPERA_DESCONOCIDO'
      : tiemposEsperaCompatibles(prescrito, candidato, especies);
    if (te) motivos.push(te);
  }

  // 8. Autorizado y comercializado
  if (candidato.estado !== 'autorizado') motivos.push('NO_AUTORIZADO');
  if (!candidato.comerc) motivos.push('NO_COMERCIALIZADO');

  const bloqueantes = motivos.filter((m) => m !== 'INDICACION_PROBABLE' && m !== 'CANTIDAD_NO_NORMALIZABLE');
  return {
    equivalente: bloqueantes.length === 0 && !revisarManual,
    revisarManual: bloqueantes.length === 0 && revisarManual,
    indicacion: ind.resultado,
    motivos,
    requiereAprobacionPrevia: ind.resultado === 'PROBABLE' || revisarManual,
  };
}
