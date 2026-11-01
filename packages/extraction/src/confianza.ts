/** Palabra OCR con su confianza y su posición en el contenido (Document Intelligence). */
export interface PalabraOcr {
  texto: string;
  confianza: number;
  pagina: number;
  poligono: number[] | null;
  /** Posición en `content` (spans), para cruzarla con los campos. */
  offset?: number;
  length?: number;
}

/**
 * Confianza final de un campo del modelo personalizado (SPEC §5.3): el MÍNIMO entre la confianza del campo
 * y la media de la confianza OCR de las palabras que lo forman. Un campo con valor pero sin región en el
 * documento (no se puede mostrar la evidencia) queda en 0,5 como máximo.
 */
export function confianzaCampo(
  valor: unknown,
  confianzaCampoModelo: number,
  spans: { offset: number; length: number }[],
  tieneRegion: boolean,
  palabras: PalabraOcr[],
): number {
  const c = Math.max(0, Math.min(1, confianzaCampoModelo));
  if (valor === null) return c;
  if (!tieneRegion) return Math.min(c, 0.5);
  const dentro = palabras.filter(
    (p) =>
      p.offset !== undefined &&
      spans.some((s) => (p.offset as number) >= s.offset && (p.offset as number) < s.offset + s.length),
  );
  if (!dentro.length) return c;
  const ocr = dentro.reduce((s, p) => s + p.confianza, 0) / dentro.length;
  return Math.min(c, ocr);
}
