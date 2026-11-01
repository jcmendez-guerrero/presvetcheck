/**
 * Convención de SKU y nombre de Siweb360 (SPEC §5.2.2, D-04/D-04c): `LABORATORIO-XXXX-CN{cn}`
 * con correlativo de 4 dígitos por laboratorio, y `CN{cn}` en el nombre.
 */

/** CN de 7 dígitos (con dígito de control) → 6. */
export function normalizarCn(cn: string): string {
  const d = cn.replace(/\D/g, '');
  return d.length === 7 ? d.slice(0, 6) : d;
}

/**
 * CN escrito a mano en un nombre: «CN 584187.8», «CN: 584187», «C.N. 5841878», «CN584187-8»… El 7.º dígito
 * (control) es opcional y se descarta.
 */
const CN_AL_FINAL = /C\.?N[\s.:#-]*(\d{6})(?:[.-]?\d)?$/i;
// Separador tras «CN»: espacios, un «:», «#» o «-» opcional y más espacios. Se escribe con el separador dentro del
// grupo opcional para que dos `\s*` seguidos no se repartan los mismos espacios (coste cuadrático).
const CN_EN_NOMBRE = /\bC\.?\s?N\.?(?:\s*[:#-])?\s*(\d{6})(?:[.\-\s]?\d)?(?!\d)/i;

/**
 * Extrae el CN de un SKU (patrón configurado, anclado al final) o de un nombre (sin anclar). Si no cumple el
 * patrón, se acepta también el CN escrito con espacios, puntos, guiones o dígito de control
 * (p. ej. SKU «DECHRA-00002-CN-584187.8», nombre «… CN 584187.8»).
 */
export function extraerCn(texto: string | null | undefined, patron: string, anclado: boolean): string | null {
  if (!texto) return null;
  const src = anclado ? patron : patron.replace(/\$$/, '');
  const m = new RegExp(src, 'i').exec(texto.trim());
  if (m?.[1]) return normalizarCn(m[1]);
  const n = (anclado ? CN_AL_FINAL : CN_EN_NOMBRE).exec(texto.trim());
  return n?.[1] ?? null;
}

/** ¿La variante corresponde a este CN por SKU o por nombre? */
export function varianteCoincideCn(v: { sku: string | null; name: string | null; productName?: string | null }, cn: string, patron: string): boolean {
  const objetivo = normalizarCn(cn);
  return (
    extraerCn(v.sku, patron, true) === objetivo ||
    extraerCn(v.name, patron, false) === objetivo ||
    extraerCn(v.productName ?? null, patron, false) === objetivo
  );
}

export function skuCumpleConvencion(sku: string, cn: string, patron: string): boolean {
  return /^[A-Z0-9]+-\d{4}-CN\d{6,7}$/.test(sku) && extraerCn(sku, patron, true) === normalizarCn(cn);
}

export function nombreCumpleConvencion(nombre: string, cn: string, patron: string): boolean {
  return extraerCn(nombre, patron, false) === normalizarCn(cn);
}

/** Máximo correlativo usado en Siweb360 para un prefijo (`^{PREFIJO}-(\d{4})-`). */
export function maxCorrelativo(skus: string[], prefijo: string): number {
  const re = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4})-`, 'i');
  return skus.reduce((max, s) => {
    const m = re.exec(s);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}

/** Siguiente = max(usado en Siweb360, reservado en tareas pendientes, último reservado) + 1. */
export function siguienteCorrelativo(skusSiweb: string[], prefijo: string, reservados: number[]): number {
  const n = Math.max(maxCorrelativo(skusSiweb, prefijo), ...reservados, 0) + 1;
  if (n > 9999) throw new Error(`Correlativo agotado para el prefijo ${prefijo}`);
  return n;
}

export function proponerSku(prefijo: string, correlativo: number, cn: string): string {
  return `${prefijo.toUpperCase()}-${String(correlativo).padStart(4, '0')}-CN${normalizarCn(cn)}`;
}

export function proponerNombre(nombre: string, cn: string): string {
  const c = normalizarCn(cn);
  return /CN\d{6,7}/i.test(nombre) ? nombre.replace(/CN\d{6,7}/i, `CN${c}`) : `${nombre.trim()} CN${c}`;
}

/** Prefijo sugerido a partir del laboratorio titular (la persona lo confirma la primera vez). */
export function sugerirPrefijo(labtitular: string): string {
  const limpio = labtitular
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(S\.?A\.?U?|S\.?L\.?U?|GMBH|B\.?V\.?|LTD|LIMITED|INC|SPA|S\.?P\.?A\.?|SAS|NV|AG|LABORATORIOS?|LAB)\b\.?/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .trim();
  return (limpio.split(/\s+/)[0] ?? 'LAB').slice(0, 10) || 'LAB';
}
