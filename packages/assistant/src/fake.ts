import {
  NOTA_LINEA,
  PREFIJO_CORRECCION,
  type AssistantModel,
  type LlamadaHerramienta,
  type MensajeModelo,
  type PeticionModelo,
  type RespuestaModelo,
} from './model';

/**
 * Modelo falso para la demo y los tests: ejecuta guiones (rondas de llamadas a herramientas y una salida final)
 * elegidos por coincidencia con la última pregunta. Sin guion, responde «sin información». Las salidas finales
 * pueden construirse a partir de lo que devolvieron las herramientas.
 */
export interface ContextoGuion {
  pregunta: string;
  /** Resultados de las herramientas de esta pregunta, en orden de llamada. */
  resultados: { nombre: string; datos: unknown }[];
}

export interface LlamadaGuion {
  nombre: string;
  args: unknown;
}

export interface Guion {
  /** Coincidencia con la pregunta (sin distinguir mayúsculas). */
  cuando: RegExp;
  /** Solo se aplica en conversaciones sobre una línea de receta (y, si es false/omitido, no se aplica en ellas antes que los de línea). */
  enLinea?: boolean;
  /** Llamadas a herramientas, por rondas (una ronda puede depender de lo que devolvieron las anteriores). */
  rondas: (LlamadaGuion[] | ((ctx: ContextoGuion) => LlamadaGuion[]))[];
  /** Salida final (objeto que se serializa como JSON). */
  final: (ctx: ContextoGuion) => Record<string, unknown>;
}

const SIN_INFO = {
  tipo: 'sin_informacion',
  texto: 'No tengo información en las fuentes de referencia para responder a esto.',
  fuentes: [],
  simulaciones: [],
  usaContextoLinea: false,
};

export class FakeAssistantModel implements AssistantModel {
  readonly nombre = 'fake';
  constructor(private readonly guiones: Guion[] = []) {}

  async chat(p: PeticionModelo): Promise<RespuestaModelo> {
    const uso = { entrada: 10, salida: 5 };
    const idxPregunta = indicePregunta(p.mensajes);
    const pregunta = (p.mensajes[idxPregunta] as { content?: string } | undefined)?.content ?? '';
    const enLinea = p.mensajes.some((m) => m.role === 'system' && m.content === NOTA_LINEA);
    const guion = enLinea
      ? (this.guiones.find((g) => g.enLinea && g.cuando.test(pregunta)) ??
        this.guiones.find((g) => !g.enLinea && g.cuando.test(pregunta)))
      : this.guiones.find((g) => !g.enLinea && g.cuando.test(pregunta));
    if (!guion) return { tipo: 'final', contenido: JSON.stringify(SIN_INFO), uso };

    const desdePregunta = p.mensajes.slice(idxPregunta + 1);
    const resultados = desdePregunta.flatMap((m, i) => {
      if (m.role !== 'tool') return [];
      const llamada = desdePregunta
        .slice(0, i)
        .flatMap((x) => (x.role === 'assistant' ? (x.llamadas ?? []) : []))
        .find((l) => l.id === m.llamadaId);
      return [{ nombre: llamada?.nombre ?? '?', datos: seguro(m.content) }];
    });
    const rondasHechas = desdePregunta.filter((m) => m.role === 'assistant' && m.llamadas?.length).length;
    if (p.permitirHerramientas && rondasHechas < guion.rondas.length) {
      const ronda = guion.rondas[rondasHechas];
      const pedidas = typeof ronda === 'function' ? ronda({ pregunta, resultados }) : (ronda ?? []);
      if (pedidas.length) {
        const llamadas: LlamadaHerramienta[] = pedidas.map((c, i) => ({
          id: `fake-${rondasHechas}-${i}`,
          nombre: c.nombre,
          argumentos: JSON.stringify(c.args),
        }));
        return { tipo: 'herramientas', llamadas, uso };
      }
    }
    return { tipo: 'final', contenido: JSON.stringify(guion.final({ pregunta, resultados })), uso };
  }
}

/** Índice de la última pregunta real (se ignoran los mensajes de corrección del orquestador). */
function indicePregunta(mensajes: MensajeModelo[]): number {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m?.role === 'user' && !m.content.startsWith(PREFIJO_CORRECCION)) return i;
  }
  return -1;
}

function seguro(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
