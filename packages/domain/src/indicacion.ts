import { normalizeText, type EquivalenciaIndicacion, type EquivalenciaRules } from '@mmx/shared';

/**
 * Comparación de la indicación de la receta (texto libre) con las indicaciones autorizadas del
 * candidato (SPEC §4.4.2 punto 6). Similitud = proporción de términos de la receta presentes en
 * la indicación del candidato, tras normalizar, quitar palabras vacías y aplicar sinónimos.
 */
export function tokensIndicacion(texto: string, rules: EquivalenciaRules['indicacion']): Set<string> {
  let t = ` ${normalizeText(texto).replace(/[.,/()+-]/g, ' ')} `;
  for (const grupo of rules.sinonimos) {
    const canon = normalizeText(grupo[0] as string).replace(/\s+/g, '_');
    for (const s of [...grupo].sort((a, b) => b.length - a.length)) {
      t = t.replaceAll(` ${normalizeText(s)} `, ` ${canon} `);
    }
  }
  const vacias = new Set(rules.palabras_vacias.map(normalizeText));
  return new Set(t.split(/\s+/).filter((w) => w.length > 1 && !vacias.has(w)));
}

export function similitudIndicacion(
  receta: string,
  candidata: string,
  rules: EquivalenciaRules['indicacion'],
): number {
  const a = tokensIndicacion(receta, rules);
  if (a.size === 0) return 0;
  const b = tokensIndicacion(candidata, rules);
  let comunes = 0;
  for (const w of a) if (b.has(w)) comunes++;
  return comunes / a.size;
}

export function compararIndicacion(
  receta: string | null,
  candidatas: string[],
  rules: EquivalenciaRules['indicacion'],
): { resultado: EquivalenciaIndicacion; similitud: number; mejor: string | null } {
  if (!receta || candidatas.length === 0) return { resultado: 'NO_COINCIDE', similitud: 0, mejor: null };
  let similitud = 0;
  let mejor: string | null = null;
  for (const c of candidatas) {
    const s = similitudIndicacion(receta, c, rules);
    if (s > similitud) {
      similitud = s;
      mejor = c;
    }
  }
  const resultado: EquivalenciaIndicacion =
    similitud >= rules.umbral_coincide
      ? 'COINCIDE'
      : similitud >= rules.umbral_probable
        ? 'PROBABLE'
        : 'NO_COINCIDE';
  return { resultado, similitud, mejor };
}
