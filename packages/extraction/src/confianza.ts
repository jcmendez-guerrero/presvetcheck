import { normalizeText } from '@mmx/shared';

/** Palabra OCR con su confianza (Document Intelligence). */
export interface PalabraOcr {
  texto: string;
  confianza: number;
  pagina: number;
  poligono: number[] | null;
}

/**
 * Confianza final de un campo (SPEC §5.3): combinación (mínimo) de la confianza OCR de las palabras de
 * la evidencia y la autoevaluación del modelo; si la evidencia citada no aparece en el OCR → máximo 0,5.
 */
export function confianzaCampo(
  valor: unknown,
  evidencia: string | null,
  confianzaLlm: number,
  ocrTexto: string,
  palabras: PalabraOcr[],
): { confianza: number; pagina: number | null; region: number[] | null } {
  const llm = Math.max(0, Math.min(1, confianzaLlm));
  if (valor === null) return { confianza: llm, pagina: null, region: null };
  if (!evidencia) return { confianza: Math.min(llm, 0.5), pagina: null, region: null };
  const ev = normalizeText(evidencia);
  if (!ev || !normalizeText(ocrTexto).includes(ev)) return { confianza: Math.min(llm, 0.5), pagina: null, region: null };
  const tokens = new Set(ev.split(' '));
  const usadas = palabras.filter((p) => tokens.has(normalizeText(p.texto)));
  if (!usadas.length) return { confianza: Math.min(llm, 0.5), pagina: null, region: null };
  const ocr = usadas.reduce((s, p) => s + p.confianza, 0) / usadas.length;
  const primera = usadas[0]!;
  return { confianza: Math.min(llm, ocr), pagina: primera.pagina, region: primera.poligono };
}
