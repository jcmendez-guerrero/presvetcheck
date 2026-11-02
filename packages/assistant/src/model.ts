/** Puerto del modelo de lenguaje: lo único que el orquestador necesita de un proveedor. */

export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  /** JSON tal como lo envía el modelo (puede no ser válido: lo valida el orquestador). */
  argumentos: string;
  /** Datos del proveedor que hay que devolverle tal cual con la llamada (p. ej. la firma de pensamiento de Gemini). */
  extra?: unknown;
}

export type MensajeModelo =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; llamadas?: LlamadaHerramienta[] }
  | { role: 'tool'; llamadaId: string; content: string };

export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  /** JSON Schema de los argumentos. */
  parametros: Record<string, unknown>;
}

export interface UsoTokens {
  entrada: number;
  salida: number;
}

export type RespuestaModelo =
  | { tipo: 'herramientas'; llamadas: LlamadaHerramienta[]; uso: UsoTokens }
  /** `contenido`: JSON de la salida estructurada. */
  | { tipo: 'final'; contenido: string; uso: UsoTokens };

export interface PeticionModelo {
  mensajes: MensajeModelo[];
  herramientas: DefinicionHerramienta[];
  /** JSON Schema de la salida final. */
  schemaSalida: Record<string, unknown>;
  /** Con false el modelo no puede pedir más herramientas (última ronda). */
  permitirHerramientas: boolean;
}

export interface AssistantModel {
  /** Nombre que se guarda en cada intercambio (despliegue, o `fake`). */
  readonly nombre: string;
  chat(p: PeticionModelo): Promise<RespuestaModelo>;
}

/** Prefijo del mensaje con el que el orquestador pide corregir una salida no válida. */
export const PREFIJO_CORRECCION = 'Tu respuesta no es válida:';

/** Nota del orquestador al modelo cuando la conversación es sobre una línea de receta. */
export const NOTA_LINEA =
  'Esta conversación es sobre una línea concreta de una receta: usa la herramienta contexto_linea para conocer su resultado.';
