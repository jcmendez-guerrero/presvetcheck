/**
 * Saneado de datos personales de lo que escribe el empleado, antes de enviarlo al modelo y de guardarlo
 * (FR-018 a FR-021a). Elimina DNI/NIE (con o sin letra de control válida: ante la duda, se quita), teléfonos,
 * correos y direcciones, y las coincidencias (sin distinguir mayúsculas ni acentos) con los datos conocidos del
 * titular y del veterinario de la receta en contexto. Esos valores solo existen en memoria durante la llamada.
 */
export const MARCA_DATO_ELIMINADO = '[dato eliminado]';

const ACENTOS: Record<string, string> = {
  a: 'aáàäâã',
  e: 'eéèëê',
  i: 'iíìïî',
  o: 'oóòöôõ',
  u: 'uúùüû',
  n: 'nñ',
  c: 'cç',
};

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Patrón que ignora mayúsculas, acentos y la cantidad de espacios. */
function patronTolerante(valor: string): string {
  const base = valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return [...base]
    .map((ch) => {
      if (/\s/.test(ch)) return '\\s+';
      const grupo = ACENTOS[ch];
      return grupo ? `[${grupo}]` : escapar(ch);
    })
    .join('');
}

/** Patrón de un teléfono: los mismos dígitos con cualquier separador entre ellos. */
function patronTelefono(valor: string): string | null {
  const digitos = valor.replace(/\D/g, '').replace(/^(?:0034|34)(?=\d{9}$)/, '');
  if (digitos.length < 7) return null;
  return `(?<!\\d)(?:\\+?34[\\s.-]?|0034[\\s.-]?)?${[...digitos].join('[\\s.-]?')}(?!\\d)`;
}

const FIJOS: RegExp[] = [
  // Correo electrónico
  /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/giu,
  // NIE (X/Y/Z + 7 cifras + letra) y DNI (8 cifras + letra), con separadores opcionales
  /(?<![\p{L}\d])[XYZxyz][\s.-]?\d{7}[\s.-]?[A-Za-z](?![\p{L}\d])/gu,
  /(?<![\p{L}\d])\d{2}[.\s]?\d{3}[.\s]?\d{3}[\s.-]?[A-Za-z](?![\p{L}\d])/gu,
  // Teléfono español: 9 cifras que empiezan por 6, 7, 8 o 9, con prefijo y separadores opcionales
  /(?<![\d])(?:\+34[\s.-]?|0034[\s.-]?)?[6-9]\d{2}(?:[\s.-]?\d){6}(?![\d])/g,
  // Dirección: tipo de vía + nombre + número
  /\b(?:c\/|calle|avda\.?|avenida|plaza|pza\.?|paseo|camino|carretera|ctra\.?|travesía|urbanización)\s+[^,\d\n]{2,40}?[,\s]+(?:n[ºo°.]?\s*)?\d{1,4}\b[^\n,.;]{0,15}/giu,
];

export interface ResultadoSaneado {
  texto: string;
  eliminada: boolean;
}

/**
 * @param conocidos valores exactos (nombres, teléfonos…) del titular y del veterinario de la receta en contexto.
 */
/**
 * Palabras corrientes que forman parte de valores como «Veterinario de demostración» o «Clínica Veterinaria X»:
 * sueltas no identifican a nadie y borrarlas estropea la respuesta («el [dato eliminado] prescriptor»).
 */
const PALABRAS_COMUNES = new Set(
  [
    'veterinario',
    'veterinaria',
    'veterinarios',
    'clinica',
    'hospital',
    'centro',
    'titular',
    'propietario',
    'propietaria',
    'demostracion',
    'doctor',
    'doctora',
    'calle',
    'avenida',
    'plaza',
  ].map((w) => w.normalize('NFD').replace(/\p{M}/gu, '')),
);
const esComun = (p: string) => PALABRAS_COMUNES.has(p.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''));

export function limpiarDatosPersonales(texto: string, conocidos: readonly string[] = []): ResultadoSaneado {
  let out = texto;
  let eliminada = false;
  const sustituir = (re: RegExp) => {
    out = out.replace(re, () => {
      eliminada = true;
      return MARCA_DATO_ELIMINADO;
    });
  };
  for (const re of FIJOS) sustituir(new RegExp(re.source, re.flags));

  for (const valor of conocidos) {
    const v = valor.trim();
    if (!v) continue;
    const tel = /^[\d\s+().-]+$/.test(v) ? patronTelefono(v) : null;
    if (tel) {
      sustituir(new RegExp(tel, 'g'));
      continue;
    }
    // Valor completo y, por separado, cada palabra de 4 letras o más (nombre o apellido sueltos).
    const partes = new Set<string>([v, ...v.split(/\s+/).filter((p) => p.length >= 4 && !esComun(p))]);
    for (const p of [...partes].sort((a, b) => b.length - a.length)) {
      sustituir(new RegExp(`(?<![\\p{L}\\d])${patronTolerante(p)}(?![\\p{L}\\d])`, 'giu'));
    }
  }
  return { texto: out, eliminada };
}
