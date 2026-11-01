import { normalizeText, type CampoExtraido } from '@mmx/shared';
import { convertir } from '../campos';
import { confianzaCampo, type PalabraOcr } from '../confianza';
import type { AnalyzeResult } from './docintel';

/**
 * Modo sin entrenamiento (DUDA-27): `prebuilt-layout` de Document Intelligence con pares clave-valor y unas
 * reglas que llevan cada etiqueta impresa de la receta ("Nº Colegiado", "Fármaco", "Cód.nac."…) a su campo.
 * Sirve mientras no hay modelo personalizado y para pre-etiquetar recetas para entrenarlo. Es conservador:
 * - solo se mapean etiquetas inequívocas. Los datos del propietario (nombre, NIF, teléfono, dirección) solo se
 *   toman dentro de su bloque («CLIENTE:», «PROPIETARIO:», «TITULAR:»), porque fuera de él «Nombre:» es ambiguo
 *   (mascota, veterinario), y siempre con confianza baja para que se revisen;
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
  [/^(contiene antibiotico|contiene antimicrobianos?|receta de antimicrobianos|antimicrobianos?)$/, { ambito: 'receta', campo: 'antimicrobianos' }],
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

/** Etiquetas del formato en una sola línea (Medivet y similares): delimitan el valor de la anterior. */
const ETIQUETAS_LINEA = [
  'cantidad', 'f[aá]rmaco', 'dosis', 'unidades', 'frecuencia', 'duraci[oó]n\\s*\\(d[ií]as\\)', 'v[ií]a\\s+admin\\w*\\s*\\.?',
  'c\\.\\s*tratamiento', 'principios?\\s+activos?', 'tipo\\s+dispensaci[oó]n', '%\\s*env\\.?\\s*total', 'c[oó]d\\.?\\s*nac\\w*\\s*\\.?', 'n[º°o]\\s*envases',
].join('|');

/**
 * Datos del titular leídos de su bloque de la receta. Con confianza baja (se marcan «Revisar»): la persona
 * los confirma al completar el registro.
 */
const CONF_TITULAR = 0.7;
const INICIO_TITULAR = /(?:^|\n|\s)(?:cliente|propietario|titular|due[nñ]o)\s*:/i;
const FIN_TITULAR = /(?:^|\n|\s)(?:mascota|paciente|animal|especie|tipo de receta|n[uú]mero de receta|veterinari[oa]|diagn[oó]stico|fecha)\s*:/i;
const ETIQUETAS_TITULAR = 'nombre|nif|dni|nie|tel[eé]fono|tlf|m[oó]vil|direcci[oó]n|domicilio|provincia|poblaci[oó]n|e-?mail|correo';

export function titularDesdeTexto(contenido: string): Partial<Record<'titularNombre' | 'titularTelefono' | 'titularDireccion' | 'titularDni', string>> {
  const ini = INICIO_TITULAR.exec(contenido);
  if (!ini) return {};
  const resto = contenido.slice(ini.index + ini[0].length);
  const fin = FIN_TITULAR.exec(resto);
  const bloque = (fin ? resto.slice(0, fin.index) : resto.slice(0, 400)).replace(/\n/g, ' ');
  const valor = (etiqueta: string) =>
    limpiarValor(new RegExp(`(?:^|\\s)(?:${etiqueta})\\s*\\.?\\s*:\\s*(.*?)\\s*(?=\\s(?:${ETIQUETAS_TITULAR})\\s*\\.?\\s*:|$)`, 'i').exec(bloque)?.[1] ?? null);
  const out: Partial<Record<'titularNombre' | 'titularTelefono' | 'titularDireccion' | 'titularDni', string>> = {};
  const nombre = valor('nombre');
  if (nombre) out.titularNombre = nombre;
  const dni = valor('nif|dni|nie')?.replace(/[\s.-]/g, '').toUpperCase();
  if (dni && /^[XYZ0-9]\d{7}[A-Z]$/.test(dni)) out.titularDni = dni;
  // El OCR a veces junta dos teléfonos ("912615417630543870"): se separan en grupos de 9 cifras.
  const tel = valor('tel[eé]fono|tlf|m[oó]vil')?.replace(/[^\d+]/g, '');
  if (tel && tel.length >= 9) out.titularTelefono = tel.length % 9 === 0 && !tel.startsWith('+') ? (tel.match(/\d{9}/g) ?? [tel]).join(' / ') : tel;
  const dir = [valor('direcci[oó]n|domicilio'), valor('poblaci[oó]n'), valor('provincia')].filter(Boolean).join(', ');
  if (dir) out.titularDireccion = dir;
  return out;
}

/**
 * Datos del veterinario leídos del bloque del prescriptor («DATOS DEL PRESCRIPTOR», «PRESCRIPTOR:»), hasta el
 * bloque del cliente o de la mascota. Solo dentro del bloque: fuera, «Nombre:» o «Dirección:» son ambiguos.
 */
const INICIO_PRESCRIPTOR = /(?:^|\n|\s)(?:datos\s+del\s+(?:prescriptor|veterinario)|prescriptor)\s*:?/i;
const FIN_PRESCRIPTOR = /(?:^|\n|\s)(?:datos\s+del\s+(?:cliente|propietario|titular)|datos\s+de\s+la\s+mascota|cliente|propietario|titular|mascota|paciente|diagn[oó]stico)\s*:?(?=\s|$)/i;
const ETIQUETAS_PRESCRIPTOR = `nombre|n[º°o]\\.?\\s*col\\w*|direcci[oó]n|domicilio|c\\.?\\s?p|c[oó]digo postal|poblaci[oó]n|localidad|provincia|tel[eé]fono|tlf|m[oó]vil|e-?mail|correo`;

export function prescriptorDesdeTexto(contenido: string): Partial<Record<'veterinarioNombre' | 'veterinarioDireccion' | 'veterinarioTelefono' | 'veterinarioEmail', string>> {
  const ini = INICIO_PRESCRIPTOR.exec(contenido);
  if (!ini) return {};
  const resto = contenido.slice(ini.index + ini[0].length);
  const fin = FIN_PRESCRIPTOR.exec(resto);
  const bloque = (fin ? resto.slice(0, fin.index) : resto.slice(0, 400)).replace(/\n/g, ' ');
  const valor = (etiqueta: string) =>
    limpiarValor(new RegExp(`(?:^|\\s)(?:${etiqueta})\\s*\\.?\\s*:\\s*(.*?)\\s*(?=\\s(?:${ETIQUETAS_PRESCRIPTOR})\\s*\\.?\\s*:|$)`, 'i').exec(bloque)?.[1] ?? null);
  const out: Partial<Record<'veterinarioNombre' | 'veterinarioDireccion' | 'veterinarioTelefono' | 'veterinarioEmail', string>> = {};
  const nombre = valor('nombre');
  if (nombre) out.veterinarioNombre = nombre;
  const cp = valor('c\\.?\\s?p|c[oó]digo postal');
  const dir = [valor('direcci[oó]n|domicilio'), [cp, valor('poblaci[oó]n|localidad')].filter(Boolean).join(' '), valor('provincia')].filter(Boolean).join(', ');
  if (dir) out.veterinarioDireccion = dir;
  const tel = valor('tel[eé]fono|tlf|m[oó]vil');
  if (tel && /\d{9}/.test(tel.replace(/\s/g, ''))) out.veterinarioTelefono = tel;
  const email = valor('e-?mail|correo');
  if (email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) out.veterinarioEmail = email.toLowerCase();
  return out;
}

// Los separadores opcionales («.», «:») van dentro de grupos con sus espacios detrás, para que varios `\s*`
// seguidos no se repartan los mismos espacios (coste cúbico o cuadrático con textos de OCR anómalos).
const RE_CN = /c[oó]d(?:igo)?\.?\s*nac(?:ional)?\s*(?:\.\s*)?(?::\s*)?(\d{6})/i;
const RE_COLEGIADO = /n[º°o.]?\s*(?:de\s+)?colegiado\s*(?::\s*)?(\d{3,})/i;

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
  // Formato en una sola línea ("Fármaco: X Dosis: 1 Unidades: COMPRIMIDOS Frecuencia: 24 h Duración (días): 30
  // Vía admin.: VÍA ORAL…"): cada valor llega hasta la siguiente etiqueta conocida del formato.
  const unica = lineas.length === 1 ? lineas[0] : undefined;
  if (unica) {
    const enLinea = (etiqueta: string) => limpiarValor(new RegExp(`(?:^|\\s)${etiqueta}\\s*:\\s*(.*?)\\s*(?=\\s(?:${ETIQUETAS_LINEA})\\s*:|\\n|$)`, 'i').exec(contenido)?.[1] ?? null);
    const poner = (nombre: string, texto: string | null, reemplazar = false) => {
      if (!texto || (unica[nombre] && !reemplazar)) return;
      const c = campo(nombre, texto, 0.8, null, []);
      if (c) unica[nombre] = c;
    };
    // El nombre de los pares a veces se queda corto ("AMODIP 1,25 MG 30" sin "COMP."): gana el completo.
    const farmaco = enLinea('f[aá]rmaco');
    const actual = unica.medicamento?.evidencia?.texto ?? '';
    if (farmaco && farmaco.length > actual.length && normEtiqueta(farmaco).startsWith(normEtiqueta(actual))) poner('medicamento', farmaco.replace(/\.$/, ''), true);
    poner('duracionDias', enLinea('duraci[oó]n\\s*\\(d[ií]as\\)'));
    poner('via', enLinea('v[ií]a\\s+admin\\w*\\s*\\.?')?.replace(/^v[ií]a\s+/i, '') ?? null);
    const dosis = enLinea('dosis');
    if (dosis) {
      const unidades = enLinea('unidades');
      // La frecuencia de estos formatos va en horas ("24", "24 h", "24 ho" cortado por el OCR).
      const horas = /^(\d+)\s*(?:h\w*)?$/i.exec(enLinea('frecuencia') ?? '')?.[1];
      poner('dosis', unidades && horas ? `${dosis} ${unidades.toLowerCase()} cada ${horas} h` : dosis);
    }
    const tipo = enLinea('tipo\\s+dispensaci[oó]n');
    if (tipo && !receta.tipoDispensacion) {
      const c = campo('tipoDispensacion', tipo, 0.8, null, []);
      if (c) receta.tipoDispensacion = c;
    }
  }
  // Titular: solo dentro de su bloque («CLIENTE:», «PROPIETARIO:», «TITULAR:»), donde «Nombre:» no es ambiguo.
  for (const [nombre, texto] of Object.entries(titularDesdeTexto(contenido))) {
    if (receta[nombre] || !texto) continue;
    const c = campo(nombre, texto, CONF_TITULAR, null, []);
    if (c) receta[nombre] = c;
  }
  // Veterinario: dirección, teléfono y correo de su bloque (con confianza baja, como el titular).
  for (const [nombre, texto] of Object.entries(prescriptorDesdeTexto(contenido))) {
    if (receta[nombre] || !texto) continue;
    const c = campo(nombre, texto, CONF_TITULAR, null, []);
    if (c) receta[nombre] = c;
  }
  const col = RE_COLEGIADO.exec(contenido);
  if (col && !receta.veterinarioNumColegiado) {
    const c = campo('veterinarioNumColegiado', col[1] as string, 0.8, null, []);
    if (c) receta.veterinarioNumColegiado = c;
  }
  return { receta, lineas };
}
