import { normalizeText, type CampoExtraido } from '@mmx/shared';
import { convertir } from '../campos';
import { confianzaCampo, type PalabraOcr } from '../confianza';
import type { AnalyzeResult } from './docintel';

/**
 * Modo sin entrenamiento (DUDA-27): `prebuilt-layout` de Document Intelligence con pares clave-valor y unas
 * reglas que llevan cada etiqueta impresa de la receta ("Nº Colegiado", "Fármaco", "Cód.nac."…) a su campo.
 * Sirve mientras no hay modelo personalizado y para pre-etiquetar recetas para entrenarlo. Es conservador:
 * - solo se mapean etiquetas inequívocas; los datos del propietario (nombre, NIF, teléfono, dirección) no se
 *   toman nunca porque las etiquetas son ambiguas entre propietario y veterinario;
 * - la confianza se rebaja (factor 0,9) para que la persona confirme más campos que con un modelo entrenado.
 */
export const MODELO_LAYOUT = 'prebuilt-layout';
export const FACTOR_REGLAS = 0.9;
export const REGLAS_VERSION = 'layout-reglas.v1';

type Destino = { ambito: 'receta' | 'linea'; campo: string };

/** Etiqueta normalizada (sin tildes ni signos) → campo. El orden importa: gana la primera que encaja. */
const REGLAS: [RegExp, Destino][] = [
  [/^(numero de receta|n receta|receta n|receta numero|numero receta)$/, { ambito: 'receta', campo: 'numero' }],
  [/^(fecha|fecha prescripcion|fecha de prescripcion|fecha emision|fecha de emision)$/, { ambito: 'receta', campo: 'fechaEmision' }],
  [/^especie\b/, { ambito: 'receta', campo: 'especie' }],
  [/^(n colegiado|n de colegiado|numero de colegiado|colegiado|provincia y numero de colegiado)$/, { ambito: 'receta', campo: 'veterinarioNumColegiado' }],
  [/^(responsable|veterinario|veterinario prescriptor|nombre del veterinario)$/, { ambito: 'receta', campo: 'veterinarioNombre' }],
  [/^(diagnostico|afeccion a tratar|indicacion|indicacion para la que se prescribe)$/, { ambito: 'receta', campo: 'indicacion' }],
  [/^(vigencia|validez|plazo de validez)$/, { ambito: 'receta', campo: 'plazoValidez' }],
  [/^(tipo de dispensacion|tipo dispensacion)$/, { ambito: 'receta', campo: 'tipoDispensacion' }],
  [/^(tipo tratamiento|tipo de tratamiento|naturaleza del tratamiento|c tratamiento)$/, { ambito: 'receta', campo: 'tipoTratamiento' }],
  [/^(n de animales|numero de animales)$/, { ambito: 'receta', campo: 'numAnimales' }],
  [/^(identificacion de los animales|n identificacion|chip|microchip)$/, { ambito: 'receta', campo: 'animalIdentificacion' }],
  [/^(advertencias|advertencias e instrucciones para el propietario)$/, { ambito: 'receta', campo: 'advertencias' }],
  [/^(rega|codigo rega)$/, { ambito: 'receta', campo: 'rega' }],
  // Líneas de medicamento: cada etiqueta de medicamento abre una línea nueva.
  [/^(farmaco|medicamento|denominacion y presentacion del medicamento|denominacion y concentracion|denominacion)$/, { ambito: 'linea', campo: 'medicamento' }],
  [/^principios? activos?$/, { ambito: 'linea', campo: 'principioActivo' }],
  [/^forma farmaceutica$/, { ambito: 'linea', campo: 'forma' }],
  [/^concentracion$/, { ambito: 'linea', campo: 'concentracion' }],
  [/^(n envases|n de envases|numero de envases|cantidad a dispensar)$/, { ambito: 'linea', campo: 'cantidadEnvases' }],
  [/^presentacion$/, { ambito: 'linea', campo: 'formato' }],
  [/^(via|via admin|via administracion|via de administracion)$/, { ambito: 'linea', campo: 'via' }],
  [/^(dosis|dosis frecuencia|pautas dosis duracion frecuencia|posologia)$/, { ambito: 'linea', campo: 'dosis' }],
  [/^(duracion|duracion dias|duracion tratamiento|duracion del tratamiento)$/, { ambito: 'linea', campo: 'duracionDias' }],
  [/^tiempo de espera$/, { ambito: 'linea', campo: 'tiempoEspera' }],
  [/^(cod nac|codigo nacional|c n|cn)$/, { ambito: 'linea', campo: 'cn' }],
];

const normEtiqueta = (s: string) => normalizeText(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function destinoDeEtiqueta(etiqueta: string): Destino | null {
  const k = normEtiqueta(etiqueta);
  return REGLAS.find(([re]) => re.test(k))?.[1] ?? null;
}

/** Etiquetas de una palabra que a veces vienen pegadas a su valor ("Especie:CANINA", "Via TOPICA"). */
const PEGADAS: [RegExp, string][] = [
  [/^(especie)\s*:?\s*(.+)$/i, 'especie'],
  [/^(diagn[oó]stico)\s*:?\s*(.+)$/i, 'diagnostico'],
  [/^(v[ií]a)\s*:?\s*(.+)$/i, 'via'],
  [/^(fecha)\s*:?\s*(\d.+)$/i, 'fecha'],
  [/^(f[aá]rmaco)\s*:?\s*(.+)$/i, 'farmaco'],
];

/**
 * Separa etiqueta y valor cuando Document Intelligence los devuelve juntos en la clave. Las claves con
 * varias líneas ("Fecha:\nResponsable:") son ambiguas y se descartan.
 */
export function separarEtiqueta(clave: string, valor: string | null | undefined): { etiqueta: string; valor: string | null } | null {
  if (clave.includes('\n')) return null;
  if (valor && valor.trim()) return { etiqueta: clave, valor };
  for (const [re, etiqueta] of PEGADAS) {
    const m = re.exec(clave.trim());
    if (m) return { etiqueta, valor: m[2] as string };
  }
  return { etiqueta: clave, valor: valor ?? null };
}

/**
 * Limpia el valor: Document Intelligence a veces pega la etiqueta siguiente ("21 Vía admin .: VÍA ORAL")
 * y las casillas vacías salen como "-".
 */
export function limpiarValor(v: string | null | undefined): string | null {
  if (!v) return null;
  const corte = /\s[A-Za-zÁÉÍÓÚÑáéíóúñº°.][A-Za-zÁÉÍÓÚÑáéíóúñº°. ]{1,25}\s?\.?:/.exec(v);
  const s = (corte ? v.slice(0, corte.index) : v).replace(/\s+/g, ' ').trim().replace(/[,;]$/, '');
  if (!s || /^[-–—_.:]+(\s|$)/.test(s)) return null;
  // Restos de la etiqueta siguiente ("admin .:") en lugar de un valor.
  if (/^[A-Za-zÁÉÍÓÚáéíóú ]{1,12}\s?\.?:$/.test(s)) return null;
  return s;
}

const RE_CN = /c[oó]d(?:igo)?\.?\s*nac(?:ional)?\.?\s*:?\s*(\d{6})/i;
const RE_COLEGIADO = /n[º°o.]?\s*(?:de\s+)?colegiado\s*:?\s*(\d{3,})/i;

/** Pares clave-valor de una página → campos de receta y líneas (solo los encontrados). */
export function camposDesdeLayout(
  r: AnalyzeResult & { keyValuePairs?: { key: { content: string }; value?: { content?: string; boundingRegions?: { pageNumber: number; polygon?: number[] }[]; spans?: { offset: number; length: number }[] }; confidence?: number }[] },
  pagina: number,
  palabras: PalabraOcr[],
): { receta: Record<string, CampoExtraido>; lineas: Record<string, CampoExtraido>[] } {
  const receta: Record<string, CampoExtraido> = {};
  const lineas: Record<string, CampoExtraido>[] = [];
  const campo = (nombre: string, texto: string | null, conf: number, region: { polygon?: number[] } | null, spans: { offset: number; length: number }[]): CampoExtraido | null => {
    const valor = convertir(nombre, texto);
    if (valor === null) return null;
    return {
      valor,
      confianza: confianzaCampo(valor, conf * FACTOR_REGLAS, spans, region !== null, palabras),
      evidencia: { texto, pagina: region ? pagina : null, region: region?.polygon ?? null },
      fuente: 'ocr',
    };
  };
  for (const kv of r.keyValuePairs ?? []) {
    const par = separarEtiqueta(kv.key.content, kv.value?.content);
    if (!par) continue;
    const d = destinoDeEtiqueta(par.etiqueta);
    if (!d) continue;
    const texto = limpiarValor(par.valor);
    const c = campo(d.campo, texto, kv.confidence ?? 0, kv.value?.boundingRegions?.[0] ?? null, kv.value?.spans ?? []);
    if (!c) continue;
    if (d.ambito === 'receta') {
      const actual = receta[d.campo];
      if (!actual || c.confianza > actual.confianza) receta[d.campo] = c;
      continue;
    }
    // Una etiqueta de medicamento abre línea; el resto se añade a la última línea (o abre una si no hay).
    const ultima = lineas.at(-1);
    if (d.campo === 'medicamento' || !ultima || ultima[d.campo]) lineas.push({ [d.campo]: c });
    else ultima[d.campo] = c;
  }
  // Respaldo por texto para lo que los pares no recogen bien.
  const contenido = r.content ?? '';
  const cn = RE_CN.exec(contenido);
  if (cn && lineas.length <= 1 && !lineas[0]?.cn) {
    const c = campo('cn', cn[1] as string, 0.8, null, []);
    if (c) (lineas[0] ??= {}).cn = c;
  }
  const col = RE_COLEGIADO.exec(contenido);
  if (col && !receta.veterinarioNumColegiado) {
    const c = campo('veterinarioNumColegiado', col[1] as string, 0.8, null, []);
    if (c) receta.veterinarioNumColegiado = c;
  }
  return { receta, lineas };
}
