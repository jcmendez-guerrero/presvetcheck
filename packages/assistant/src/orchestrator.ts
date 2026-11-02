import {
  SalidaModelo,
  type CandidatoMedicamento,
  type ContextoConversacion,
  type ContextoLineaDto,
  type FuenteCitada,
  type SimulacionGuardada,
} from '@mmx/shared';
import { validarSalida, type EstadoTurno, type ErrorValidacion } from './citas';
import {
  NOTA_LINEA,
  PREFIJO_CORRECCION,
  type AssistantModel,
  type MensajeModelo,
  type UsoTokens,
} from './model';
import { jsonSchema, type ResultadoHerramienta, type ToolRegistry } from './tools/registry';
import { TEXTO_SIN_INFORMACION } from './textos';

export const MAX_RONDAS = 4;
export const MAX_LLAMADAS = 8;
export const MAX_CARACTERES_RESULTADO = 6000;
export const MAX_HISTORIAL = 10;

export interface EntradaTurno {
  /** Pregunta ya saneada de datos personales. */
  pregunta: string;
  historial: { pregunta: string; respuesta: string | null }[];
  contexto: ContextoConversacion;
  /** Valores del titular y del veterinario que no pueden aparecer en el texto de la respuesta (solo en memoria). */
  conocidos?: readonly string[];
  /** Fecha de hoy en Madrid (AAAA-MM-DD): el modelo no sabe qué día es y la necesita si la pregunta no indica el año. */
  hoy?: string;
}

export interface ResultadoTurno {
  salida: SalidaModelo;
  /** Fuentes citadas, con título y versión. */
  fuentes: FuenteCitada[];
  simulaciones: SimulacionGuardada[];
  contextoLinea: ContextoLineaDto | null;
  /** Candidatos de `buscar_medicamento` cuando la respuesta pide que la persona elija (no se guardan). */
  candidatos: CandidatoMedicamento[];
  uso: UsoTokens;
  rondas: number;
  duracionMs: number;
  /** La respuesta del modelo no se pudo validar y se sustituyó por «sin información». */
  degradada: boolean;
}

export interface OpcionesOrquestador {
  modelo: AssistantModel;
  herramientas: ToolRegistry;
  instrucciones: string;
  ahora?: () => number;
}

const SCHEMA_SALIDA = jsonSchema(SalidaModelo);

/**
 * Bucle de un turno: el modelo pide herramientas (solo lectura), el orquestador las ejecuta y registra qué
 * fuentes y simulaciones han salido de ellas, y la salida final se valida (contracts/salida-modelo.md).
 */
export class ChatOrchestrator {
  constructor(private readonly o: OpcionesOrquestador) {}

  async responder(e: EntradaTurno): Promise<ResultadoTurno> {
    const ahora = this.o.ahora ?? Date.now;
    const inicio = ahora();
    const ctx = { contexto: e.contexto };
    const turno = {
      fuentes: new Map<string, FuenteCitada>(),
      simulaciones: new Map<string, SimulacionGuardada>(),
      llamoContextoLinea: false,
    };
    let contextoLinea: ContextoLineaDto | null = null;
    let candidatos: CandidatoMedicamento[] = [];
    const uso: UsoTokens = { entrada: 0, salida: 0 };
    let rondas = 0;
    let llamadas = 0;
    let reintentado = false;

    const mensajes: MensajeModelo[] = [{ role: 'system', content: this.o.instrucciones }];
    if (e.hoy) {
      const [a, m, d] = e.hoy.split('-');
      mensajes.push({
        role: 'system',
        content: `La fecha de hoy es ${d}/${m}/${a}. Úsala si la pregunta menciona una fecha sin indicar el año.`,
      });
    }
    if (e.contexto.tipo === 'linea') {
      mensajes.push({
        role: 'system',
        content: NOTA_LINEA,
      });
    }
    for (const h of e.historial.slice(-MAX_HISTORIAL)) {
      mensajes.push({ role: 'user', content: h.pregunta });
      if (h.respuesta) mensajes.push({ role: 'assistant', content: h.respuesta });
    }
    mensajes.push({ role: 'user', content: e.pregunta });
    const definiciones = this.o.herramientas.definiciones(ctx);

    // Cada iteración es una llamada al modelo; las rondas de herramientas están acotadas.
    for (let vuelta = 0; vuelta < MAX_RONDAS + 3; vuelta++) {
      const permitir = rondas < MAX_RONDAS && llamadas < MAX_LLAMADAS && !reintentado;
      const r = await this.o.modelo.chat({
        mensajes,
        herramientas: definiciones,
        schemaSalida: SCHEMA_SALIDA,
        permitirHerramientas: permitir,
      });
      uso.entrada += r.uso.entrada;
      uso.salida += r.uso.salida;

      if (r.tipo === 'herramientas' && permitir) {
        rondas++;
        mensajes.push({ role: 'assistant', content: null, llamadas: r.llamadas });
        for (const l of r.llamadas) {
          llamadas++;
          const res = llamadas > MAX_LLAMADAS ? null : await this.ejecutar(l.nombre, l.argumentos, ctx);
          if (res?.contextoLinea) {
            contextoLinea = res.contextoLinea;
            turno.llamoContextoLinea = true;
          }
          if (l.nombre === 'buscar_medicamento') candidatos = candidatosDe(res?.datos);
          for (const f of res?.fuentes ?? []) turno.fuentes.set(f.fuenteId, f);
          if (res?.simulacion) turno.simulaciones.set(res.simulacion.simulacionId, res.simulacion);
          mensajes.push({
            role: 'tool',
            llamadaId: l.id,
            content: res ? serializar(res.datos) : JSON.stringify({ error: 'LIMITE_HERRAMIENTAS' }),
          });
        }
        continue;
      }

      const contenido = r.tipo === 'final' ? r.contenido : '';
      const v = validarSalida(contenido, turno as EstadoTurno, e.conocidos);
      if (v.ok && v.salida)
        return this.cerrar(v.salida, turno, contextoLinea, candidatos, uso, rondas, ahora() - inicio, false);

      // Solo simulaciones inexistentes: se descartan y se acepta.
      if (v.salida && v.errores.every((x) => x.codigo === 'V4')) {
        const s = {
          ...v.salida,
          simulaciones: v.salida.simulaciones.filter((id) => turno.simulaciones.has(id)),
        };
        return this.cerrar(s, turno, contextoLinea, candidatos, uso, rondas, ahora() - inicio, false);
      }
      if (!reintentado) {
        reintentado = true;
        mensajes.push({ role: 'assistant', content: contenido || null });
        mensajes.push({ role: 'user', content: mensajeCorreccion(v.errores) });
        continue;
      }
      break;
    }

    const degradada: SalidaModelo = {
      tipo: 'sin_informacion',
      texto: TEXTO_SIN_INFORMACION,
      fuentes: [],
      simulaciones: [...turno.simulaciones.keys()],
      usaContextoLinea: false,
    };
    return this.cerrar(degradada, turno, contextoLinea, candidatos, uso, rondas, ahora() - inicio, true);
  }

  private async ejecutar(
    nombre: string,
    argumentos: string,
    ctx: { contexto: ContextoConversacion },
  ): Promise<ResultadoHerramienta> {
    const h = this.o.herramientas.obtener(nombre, ctx);
    if (!h) return { datos: { error: 'HERRAMIENTA_DESCONOCIDA', nombre } };
    let crudo: unknown;
    try {
      crudo = argumentos.trim() ? JSON.parse(argumentos) : {};
    } catch {
      return { datos: { error: 'ARGUMENTOS_NO_VALIDOS', detalle: 'JSON no válido' } };
    }
    const parsed = (
      h.args as unknown as {
        safeParse(v: unknown): {
          success: boolean;
          data?: unknown;
          error?: { issues: { path: PropertyKey[]; message: string }[] };
        };
      }
    ).safeParse(crudo);
    if (!parsed.success) {
      const detalle = parsed.error?.issues
        .map((i) => `${i.path.map(String).join('.')}: ${i.message}`)
        .join('; ');
      return { datos: { error: 'ARGUMENTOS_NO_VALIDOS', detalle } };
    }
    try {
      return await (
        h as unknown as { ejecutar(a: unknown, c: unknown): Promise<ResultadoHerramienta> }
      ).ejecutar(parsed.data, ctx);
    } catch {
      // El detalle puede contener datos internos: el modelo solo sabe que la herramienta falló.
      return { datos: { error: 'ERROR_HERRAMIENTA', nombre } };
    }
  }

  private cerrar(
    salida: SalidaModelo,
    turno: { fuentes: Map<string, FuenteCitada>; simulaciones: Map<string, SimulacionGuardada> },
    contextoLinea: ContextoLineaDto | null,
    candidatos: CandidatoMedicamento[],
    uso: UsoTokens,
    rondas: number,
    duracionMs: number,
    degradada: boolean,
  ): ResultadoTurno {
    // Una simulación que el motor calculó en este turno se muestra siempre en una respuesta: no depende de que el
    // modelo se acuerde de listarla. Se añade también su fuente (`motor:`).
    const simIds = salida.tipo === 'respondida' ? [...turno.simulaciones.keys()] : salida.simulaciones;
    const simulaciones = [...new Set([...salida.simulaciones, ...simIds])];
    const fuenteIds = [
      ...new Set([
        ...salida.fuentes,
        ...(salida.tipo === 'respondida' ? simulaciones.map((id) => `motor:${id}`) : []),
      ]),
    ];
    return {
      salida: { ...salida, simulaciones, fuentes: fuenteIds.filter((id) => turno.fuentes.has(id)) },
      fuentes: fuenteIds.flatMap((id) => turno.fuentes.get(id) ?? []),
      simulaciones: simulaciones.flatMap((id) => turno.simulaciones.get(id) ?? []),
      contextoLinea: salida.usaContextoLinea ? contextoLinea : null,
      candidatos: salida.tipo === 'aclaracion' ? candidatos : [],
      uso,
      rondas,
      duracionMs,
      degradada,
    };
  }
}

function serializar(datos: unknown): string {
  const s = JSON.stringify(datos) ?? 'null';
  if (s.length <= MAX_CARACTERES_RESULTADO) return s;
  return JSON.stringify({ truncado: true, parcial: s.slice(0, MAX_CARACTERES_RESULTADO - 80) });
}

function mensajeCorreccion(errores: ErrorValidacion[]): string {
  return `${PREFIJO_CORRECCION} ${errores.map((x) => `${x.codigo} ${x.detalle}`).join('; ')}. Corrígela con el objeto estructurado, citando solo fuentes y simulaciones devueltas por las herramientas en esta pregunta.`;
}

function candidatosDe(datos: unknown): CandidatoMedicamento[] {
  const cs = (
    datos as {
      candidatos?: {
        nregistro: string;
        nombre: string;
        laboratorio: string | null;
        presentaciones?: { cn: string }[];
      }[];
    } | null
  )?.candidatos;
  if (!Array.isArray(cs) || cs.length < 2) return [];
  return cs.map((c) => ({
    nregistro: c.nregistro,
    nombre: c.nombre,
    laboratorio: c.laboratorio ?? null,
    cn: c.presentaciones?.[0]?.cn ?? null,
  }));
}
