import { createHash } from 'node:crypto';
import { normalizeText, SECCIONES_AYUDA, textoPlanoAyuda, type FuenteCitada, type SeccionAyuda } from '@mmx/shared';
import { esPalabraVacia, expandir } from './sinonimos';
import type { FuentesReferencia } from './tipos';

/**
 * Índice léxico en memoria de la guía de la receta veterinaria y de la Ayuda, por secciones (research R2). No hay
 * índice vectorial: el corpus es pequeño y estable. Cada fragmento tiene un `fuenteId` estable que el asistente
 * puede citar y la web abrir.
 */
export interface Fragmento {
  fuenteId: string;
  tipo: 'guia' | 'ayuda';
  titulo: string;
  ancla: string;
  texto: string;
  /** Texto normalizado (para buscar). */
  norm: string;
  tituloNorm: string;
}

export interface ResultadoBusqueda {
  fuenteId: string;
  tipo: 'guia' | 'ayuda';
  version: string;
  titulo: string;
  texto: string;
  puntuacion: number;
}

export const MAX_FRAGMENTO = 1800;

const hash8 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);

/** Trozos de como mucho `max` caracteres, cortando por líneas en blanco o por línea. */
function trocear(texto: string, max: number): string[] {
  const out: string[] = [];
  let actual = '';
  for (const parrafo of texto.split(/\n{2,}/)) {
    const p = parrafo.trim();
    if (!p) continue;
    if ((actual + '\n\n' + p).length > max && actual) {
      out.push(actual);
      actual = '';
    }
    if (p.length > max) {
      for (const linea of p.split('\n')) {
        if ((actual + '\n' + linea).length > max && actual) {
          out.push(actual);
          actual = '';
        }
        actual = actual ? `${actual}\n${linea}` : linea;
      }
    } else {
      actual = actual ? `${actual}\n\n${p}` : p;
    }
  }
  if (actual) out.push(actual);
  return out;
}

/** Quita guiones de final de línea de la maquetación (`pres-\ncripción`) y los marcadores de viñeta sueltos. */
function limpiarGuia(t: string): string {
  return t
    .replace(/([a-záéíóúñ])-\n([a-záéíóúñ])/g, '$1$2')
    .replace(/^[ \t]*›[ \t]*$/gm, '')
    .replace(/[ \t]+›[ \t]*/g, ' › ');
}

const ENCABEZADO = /^(\d+(?:\.\d+)*)\.?\s+([A-ZÁÉÍÓÚÑ¿][^\n]{2,120})$/;

/**
 * La guía no tiene encabezados Markdown (viene de un PDF): se reconocen las líneas «4.2. Receta veterinaria» del
 * cuerpo, descartando el índice (líneas con puntos de relleno y número de página) y lo anterior a la primera
 * sección real.
 */
export function seccionesGuia(texto: string): { num: string; titulo: string; texto: string }[] {
  // El PDF pega la cabecera de página al comienzo de la línea siguiente («PáginaGUÍA PRÁCTICA …5.3. Título»):
  // se separa, y se quitan los números de página sueltos.
  const limpio = texto
    .replace(/Página\s*GUÍA PRÁCTICA\s+DE MEDICAMENTOS\s+VETERINARIOS EN LA\s+OFICINA DE FARMACIA/g, '\n')
    .replace(/^[ \t]*\d{1,3}[ \t]*$/gm, '');
  const lineas = limpio.split('\n');
  const esIndice = (l: string) => /\.{4,}/.test(l) || /\s\d{1,3}$/.test(l.trim()) && /\.{2,}/.test(l);
  const heads: { i: number; num: string; titulo: string }[] = [];
  lineas.forEach((l, i) => {
    const m = ENCABEZADO.exec(l.trim());
    if (m && !esIndice(l)) heads.push({ i, num: m[1] as string, titulo: (m[2] as string).trim() });
  });
  // El índice usa los mismos números: solo cuentan las apariciones posteriores a la primera línea de cuerpo
  // «1. Introducción» (la segunda con ese número); si no hay duplicado, se aceptan todas.
  // Lo anterior a la sección «1» es el índice (con líneas partidas que parecen encabezados).
  const primera = heads.findIndex((h) => h.num === '1');
  const reales = primera >= 0 ? heads.slice(primera) : heads;
  const out: { num: string; titulo: string; texto: string }[] = [];
  reales.forEach((h, k) => {
    const fin = reales[k + 1]?.i ?? lineas.length;
    let inicio = h.i + 1;
    let titulo = h.titulo;
    // Títulos en dos líneas: «5.3. Dispensación de medicamentos veterinarios» + «psicótropos».
    const sig = (lineas[inicio] ?? '').trim();
    if (sig && sig.length < 70 && /^[a-záéíóúñ]/.test(sig) && !/[.:;]$/.test(sig) && inicio < fin) {
      titulo = `${titulo} ${sig}`;
      inicio++;
    }
    const cuerpo = limpiarGuia(lineas.slice(inicio, fin).join('\n')).trim();
    if (cuerpo.length >= 40) out.push({ num: h.num, titulo, texto: cuerpo });
  });
  return out;
}

export class IndiceFuentes implements FuentesReferencia {
  private readonly fragmentos: Fragmento[] = [];
  private readonly porId = new Map<string, Fragmento>();
  private readonly versionGuia: string;
  private readonly versionAyuda: string;

  constructor(guiaTexto: string | null, ayuda: readonly SeccionAyuda[] = SECCIONES_AYUDA) {
    this.versionGuia = `guia@${hash8(guiaTexto ?? '')}`;
    this.versionAyuda = `ayuda@${hash8(JSON.stringify(ayuda))}`;
    if (guiaTexto) {
      for (const s of seccionesGuia(guiaTexto)) {
        const partes = trocear(s.texto, MAX_FRAGMENTO);
        partes.forEach((p, k) => this.anadir('guia', `${s.num}${partes.length > 1 ? `#${k + 1}` : ''}`, `${s.num}. ${s.titulo}`, p));
      }
    }
    for (const s of ayuda) {
      const partes = trocear(textoPlanoAyuda(s), MAX_FRAGMENTO);
      partes.forEach((p, k) => this.anadir('ayuda', `${s.id}${partes.length > 1 ? `#${k + 1}` : ''}`, s.titulo, p));
    }
  }

  private anadir(tipo: 'guia' | 'ayuda', ancla: string, titulo: string, texto: string) {
    const f: Fragmento = { fuenteId: `${tipo}:${ancla}`, tipo, titulo, ancla, texto, norm: normalizeText(texto), tituloNorm: normalizeText(titulo) };
    this.fragmentos.push(f);
    this.porId.set(f.fuenteId, f);
  }

  get total(): number {
    return this.fragmentos.length;
  }

  version(): string {
    return `${this.versionGuia}+${this.versionAyuda}`;
  }

  private versionDe(f: Fragmento): string {
    return f.tipo === 'guia' ? this.versionGuia : this.versionAyuda;
  }

  private cita(f: Fragmento): FuenteCitada {
    return { fuenteId: f.fuenteId, tipo: f.tipo, titulo: f.titulo, version: this.versionDe(f), ancla: f.ancla };
  }

  abrir(fuenteId: string): { fuente: FuenteCitada; contenido: string } | null {
    const f = this.porId.get(fuenteId);
    return f ? { fuente: this.cita(f), contenido: f.texto } : null;
  }

  /** Búsqueda léxica con sinónimos. Lista vacía = no hay fuente que cubra la consulta. */
  buscar(consulta: string, tipo: 'guia' | 'ayuda', max = 3): ResultadoBusqueda[] {
    const terminos = [...new Set(normalizeText(consulta).split(' ').filter((t) => t.length > 2 && !esPalabraVacia(t)))];
    if (!terminos.length) return [];
    const grupos = terminos.map((t) => expandir(t));
    const candidatos = this.fragmentos.filter((f) => f.tipo === tipo);
    // Peso de cada término de la consulta: los poco frecuentes (psicótropo) pesan más que los comunes (receta).
    const pesos = grupos.map((g) => {
      const df = candidatos.filter((f) => g.some((t) => ocurrencias(f.norm, t) > 0 || ocurrencias(f.tituloNorm, t) > 0)).length;
      return Math.log(1 + candidatos.length / Math.max(df, 1)) ** 2;
    });
    const puntuados = candidatos
      .map((f) => {
        let p = 0;
        let cubiertos = 0;
        grupos.forEach((g, gi) => {
          let mejor = 0;
          for (const t of g) {
            const enTexto = ocurrencias(f.norm, t);
            const enTitulo = ocurrencias(f.tituloNorm, t);
            mejor = Math.max(mejor, Math.min(enTexto, 5) + enTitulo * 3);
          }
          if (mejor > 0) cubiertos++;
          p += mejor * (pesos[gi] ?? 1);
        });
        // Premia que se cubran varios términos de la consulta.
        return { f, p: p * (0.5 + cubiertos / grupos.length) };
      })
      .filter((x) => x.p > 0)
      .sort((a, b) => b.p - a.p || a.f.fuenteId.localeCompare(b.f.fuenteId))
      .slice(0, max);
    return puntuados.map(({ f, p }) => ({
      fuenteId: f.fuenteId,
      tipo: f.tipo,
      version: this.versionDe(f),
      titulo: f.titulo,
      texto: f.texto,
      puntuacion: Math.round(p * 10) / 10,
    }));
  }

  fuenteCitable(r: Pick<ResultadoBusqueda, 'fuenteId'>): FuenteCitada | null {
    const f = this.porId.get(r.fuenteId);
    return f ? this.cita(f) : null;
  }
}

/** Ocurrencias de una palabra (por prefijo de 5 letras como mínimo, para plurales y conjugaciones). */
function ocurrencias(texto: string, termino: string): number {
  const base = termino.length > 6 ? termino.slice(0, Math.max(5, termino.length - 2)) : termino;
  let n = 0;
  let i = texto.indexOf(base);
  while (i !== -1) {
    const antes = i === 0 ? ' ' : texto[i - 1];
    if (antes === ' ' || antes === '-' || antes === '/') n++;
    i = texto.indexOf(base, i + base.length);
  }
  return n;
}
