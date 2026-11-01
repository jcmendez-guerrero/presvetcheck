import type { RecetaCamposRules } from '@mmx/shared';
import type { MedicamentoInfo } from './tipos';

/** Antimicrobiano = antibiotico=true en CIMAVet o ATC con prefijo configurado (SPEC §4.1.2). */
export function esAntimicrobiano(
  m: Pick<MedicamentoInfo, 'antibiotico' | 'atc'>,
  rules: RecetaCamposRules,
): boolean {
  return (
    m.antibiotico ||
    m.atc.some((a) => rules.antimicrobianos_atc_prefijos.some((p) => a.toUpperCase().startsWith(p)))
  );
}

/** ATC excluido de la validez ampliada de crónico/preventivo (gases medicinales…). */
export function excluidoValidezAmpliada(m: Pick<MedicamentoInfo, 'atc'>, rules: RecetaCamposRules): boolean {
  return m.atc.some((a) => rules.excluidos_cronico_atc_prefijos.some((p) => a.toUpperCase().startsWith(p)));
}

/**
 * ¿Autorizado para la especie? Coincidencia exacta o, si la especie de la receta es una
 * subcategoría (`especie_padre`), autorización de la especie base. Nunca al revés.
 */
export function autorizadoParaEspecie(
  m: Pick<MedicamentoInfo, 'especieIds'>,
  especieId: number | null,
  especiePadre: Record<string, number>,
): boolean {
  if (especieId === null) return false;
  if (m.especieIds.includes(especieId)) return true;
  const padre = especiePadre[String(especieId)];
  return padre !== undefined && m.especieIds.includes(padre);
}

/** Especie efectiva para comparar indicaciones/tiempos (la base si es subcategoría). */
export function especiesEquivalentes(
  especieId: number | null,
  especiePadre: Record<string, number>,
): number[] {
  if (especieId === null) return [];
  const padre = especiePadre[String(especieId)];
  return padre !== undefined ? [especieId, padre] : [especieId];
}
