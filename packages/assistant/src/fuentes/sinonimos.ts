/**
 * Sinónimos del dominio para la búsqueda léxica en la guía y la Ayuda (grupos de términos que significan lo
 * mismo para el personal). Se comparan sobre texto normalizado (sin acentos, minúsculas).
 */
export const GRUPOS_SINONIMOS: readonly (readonly string[])[] = [
  ['antibiotico', 'antimicrobiano', 'antibioticos', 'antimicrobianos'],
  ['caducidad', 'validez', 'caduca', 'caducada', 'caducar', 'plazo', 'vigencia', 'vale', 'valida'],
  ['sustituir', 'sustitucion', 'sustituto', 'cambiar', 'cambio', 'alternativa', 'equivalente'],
  ['psicotropo', 'psicotropos'],
  ['estupefaciente', 'estupefacientes'],
  ['vacuna', 'inmunologico', 'inmunologicos', 'biologico', 'biologicos'],
  ['receta', 'prescripcion', 'prescribir', 'prescrito', 'prescrita'],
  ['dispensar', 'dispensacion', 'dispensar', 'entregar', 'dar'],
  ['envase', 'envases', 'caja', 'cajas', 'presentacion', 'formato'],
  ['concentracion', 'dosis', 'miligramos', 'mg'],
  ['principio', 'activo'],
  ['forzar', 'forzado', 'saltarse', 'bypass'],
  ['humano', 'personas'],
  ['produccion', 'productor', 'productora', 'consumo'],
];

const PALABRAS_VACIAS = new Set([
  'a', 'al', 'algo', 'ante', 'como', 'con', 'cual', 'cuales', 'cuando', 'cuanto', 'cuantos', 'de', 'del', 'desde', 'donde', 'el', 'ella', 'en', 'entre',
  'es', 'esta', 'este', 'esto', 'ha', 'hay', 'la', 'las', 'le', 'lo', 'los', 'me', 'mi', 'no', 'o', 'para', 'por', 'puedo', 'puede', 'que', 'se', 'si',
  'sin', 'su', 'sus', 'un', 'una', 'uno', 'y', 'ya', 'hace', 'hacer', 'debe', 'ser', 'son', 'tiene', 'tengo', 'hago', 'qué', 'cómo',
]);

export const esPalabraVacia = (t: string) => PALABRAS_VACIAS.has(t);

/** Término → conjunto de términos equivalentes (incluido él mismo). */
export function expandir(termino: string): string[] {
  const out = new Set<string>([termino]);
  for (const g of GRUPOS_SINONIMOS) if (g.includes(termino)) for (const x of g) out.add(x);
  return [...out];
}
