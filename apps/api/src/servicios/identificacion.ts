import type { ResultadoBusqueda } from '@mmx/cimavet';
import { nombreComercial } from '@mmx/domain';
import { normalizeText, type RecetaConfirmadaInput } from '@mmx/shared';

/**
 * Identificación del medicamento de cada línea contra la caché de CIMAVet (SPEC §4.2.1). El código
 * nacional NO es obligatorio en la receta: si viene se comprueba, y si no se busca por nombre. Si la
 * extracción no encontró ninguna línea, se buscan nombres de medicamento en el texto de la receta.
 * Todo lo identificado así es una PROPUESTA: queda marcado como dudoso y la persona lo confirma.
 */
export const UMBRAL_NOMBRE = 0.5;
export const UMBRAL_TEXTO = 0.6;
const MAX_LINEAS_TEXTO = 3;

type Buscar = (q: string) => Promise<ResultadoBusqueda[]>;

/**
 * La similitud de texto sola da falsos positivos ("% del envase: 100" → un spray). Se exige además que la
 * marca del candidato (primera palabra de su nombre comercial: PROPALIN, APOQUEL…) aparezca en lo leído.
 */
export function marcaPresente(leido: string, candidato: ResultadoBusqueda): boolean {
  const marca = normalizeText(nombreComercial(candidato.medicamento)).split(' ')[0] ?? '';
  if (marca.length < 3) return false;
  return normalizeText(leido).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).includes(marca);
}

async function mejorCandidato(buscar: Buscar, leido: string, umbral: number): Promise<ResultadoBusqueda | null> {
  const directo = (await buscar(leido)).find((c) => c.puntuacion >= umbral && marcaPresente(leido, c));
  if (directo) return directo;
  // Segundo intento solo con la primera palabra larga (la marca): "PROPALIN 100 ML" → "PROPALIN".
  const marca = normalizeText(leido).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).find((w) => w.length >= 5 && !/\d/.test(w));
  if (!marca || marca === normalizeText(leido)) return null;
  return (await buscar(marca)).find((c) => c.puntuacion >= umbral && marcaPresente(leido, c)) ?? null;
}

type Linea = NonNullable<RecetaConfirmadaInput['lineas']>[number];

/**
 * Fragmentos del texto que pueden ser un nombre de medicamento: cada línea se parte por ". ", "|" y ";",
 * y se quita la etiqueta inicial ("TRATAMIENTO: PREDNICORTONE 5 MG COMP." → "PREDNICORTONE 5 MG COMP").
 * Deben tener una palabra de 4+ letras y una cifra o una forma farmacéutica.
 */
export function lineasCandidatas(texto: string): string[] {
  const vistas = new Set<string>();
  return texto
    .split(/\n+/)
    .flatMap((l) => l.split(/\.\s|\s\|\s|;/))
    .map((l) => l.replace(/^[^:]{2,30}:\s*/, '').replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 6 && l.length <= 80 && /[A-Za-zÁÉÍÓÚÑ]{4,}/.test(l) && /(\d|comprimid|jarabe|suspensi|soluci|pipeta|inyectable|crema|pomada|c[aá]psula)/i.test(l))
    .filter((l) => {
      const k = normalizeText(l);
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
    .slice(0, 60);
}

export async function identificarMedicamentos(
  receta: RecetaConfirmadaInput,
  ocrTexto: string | null,
  buscar: Buscar,
): Promise<{ receta: RecetaConfirmadaInput; dudosos: string[]; propuestas: number }> {
  const dudosos: string[] = [];
  let propuestas = 0;
  const lineas: Linea[] = [];
  for (const [i, l] of (receta.lineas ?? []).entries()) {
    let { cn, nregistro } = l;
    if (cn) {
      // Código nacional leído: solo vale si existe en CIMAVet veterinario.
      const r = (await buscar(cn)).find((x) => x.cn === cn);
      if (r) nregistro = r.nregistro;
      else {
        cn = null;
        dudosos.push(`lineas.${i}.cn`);
      }
    }
    // Solo por el nombre del medicamento: una receta que solo da el principio activo sigue el flujo de
    // "prescripción por principio activo" (la persona elige entre los que lo contienen); no se propone marca.
    const texto = l.medicamentoTexto;
    if (!cn && texto) {
      const mejor = await mejorCandidato(buscar, texto, UMBRAL_NOMBRE);
      if (mejor) {
        cn = mejor.cn;
        nregistro = mejor.nregistro;
        propuestas++;
        dudosos.push(`lineas.${i}.medicamento`);
      }
    }
    lineas.push({ ...l, cn: cn ?? null, nregistro: nregistro ?? null });
  }

  const sinMedicamento = !lineas.some((l) => l.cn || l.medicamentoTexto);
  if (sinMedicamento && ocrTexto) {
    const halladas = new Map<string, ResultadoBusqueda & { texto: string }>();
    for (const t of lineasCandidatas(ocrTexto)) {
      const mejor = await mejorCandidato(buscar, t, UMBRAL_TEXTO);
      if (mejor && !halladas.has(mejor.nregistro)) halladas.set(mejor.nregistro, { ...mejor, texto: t });
      if (halladas.size >= MAX_LINEAS_TEXTO) break;
    }
    if (halladas.size) {
      const base = lineas[0];
      lineas.length = 0;
      [...halladas.values()].forEach((h, i) => {
        lineas.push({ ...(base ?? {}), orden: i + 1, medicamentoTexto: h.texto, cn: h.cn, nregistro: h.nregistro } as Linea);
        dudosos.push(`lineas.${i}.medicamento`);
        propuestas++;
      });
    }
  }
  return { receta: { ...receta, lineas }, dudosos, propuestas };
}
