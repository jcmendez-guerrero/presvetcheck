/** Normaliza un texto para búsquedas: minúsculas, sin acentos, espacios simples. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%/.,+\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Formatea una fecha ISO (AAAA-MM-DD) como dd/mm/aaaa. */
export function formatFechaEs(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
