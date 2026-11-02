import { DomainError } from '@mmx/shared';
import type {
  AssistantModel,
  LlamadaHerramienta,
  MensajeModelo,
  PeticionModelo,
  RespuestaModelo,
} from '../model';

/**
 * Cliente de la API de *chat completions* de Azure OpenAI (también la de un despliegue dentro de Azure AI
 * Foundry: mismo endpoint). Con *tool calling* y salida estructurada. Autenticación con Entra ID: sin claves.
 * Nunca registra el cuerpo de la petición ni de la respuesta (pueden contener texto del empleado).
 */
export interface ChatClientOptions {
  endpoint: string;
  deployment: string;
  /** Token de Entra (Azure) o clave de la API (Gemini): se envía como `Bearer`. */
  getToken: () => Promise<string>;
  /** `azure` (por defecto): `/openai/deployments/{despliegue}/…`; `compatible`: `{endpoint}/chat/completions` con `model`. */
  protocolo?: 'azure' | 'compatible';
  apiVersion?: string;
  timeoutMs?: number;
  /** Máxima espera (ms) de `retry-after` para reintentar una vez ante 429/5xx. */
  maxReintentoMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchFn?: typeof fetch;
}

interface RespuestaApi {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: {
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
        extra_content?: unknown;
      }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Salida fija cuando el filtro de contenido del proveedor bloquea la pregunta. */
export const SALIDA_FILTRADA = JSON.stringify({
  tipo: 'fuera_de_ambito',
  texto:
    'No puedo ayudar con esa pregunta. Puedo explicarte las reglas de prescripción, sustitución y dispensación.',
  fuentes: [],
  simulaciones: [],
  usaContextoLinea: false,
});

const noDisponible = (motivo: string, details?: Record<string, unknown>) =>
  new DomainError('ASISTENTE_NO_DISPONIBLE', `Asistente no disponible: ${motivo}`, details);

export class AzureChatClient implements AssistantModel {
  readonly nombre: string;
  constructor(private readonly o: ChatClientOptions) {
    this.nombre = o.deployment;
  }

  private url() {
    const base = this.o.endpoint.replace(/\/+$/, '');
    if (this.o.protocolo === 'compatible') return `${base}/chat/completions`;
    const v = encodeURIComponent(this.o.apiVersion ?? '2024-10-21');
    return `${base}/openai/deployments/${encodeURIComponent(this.o.deployment)}/chat/completions?api-version=${v}`;
  }

  private cuerpo(p: PeticionModelo) {
    const mensajes = p.mensajes.map((m) => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.llamadaId, content: m.content };
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          content: m.content,
          ...(m.llamadas?.length
            ? {
                tool_calls: m.llamadas.map((l) => ({
                  id: l.id,
                  type: 'function',
                  function: { name: l.nombre, arguments: l.argumentos },
                  ...(l.extra !== undefined ? { extra_content: l.extra } : {}),
                })),
              }
            : {}),
        };
      }
      return { role: m.role, content: m.content };
    });
    return {
      ...(this.o.protocolo === 'compatible' ? { model: this.o.deployment } : {}),
      messages: mensajes,
      temperature: 0,
      ...(p.permitirHerramientas && p.herramientas.length
        ? {
            tools: p.herramientas.map((h) => ({
              type: 'function',
              function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
            })),
            tool_choice: 'auto',
          }
        : {}),
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'salida_asistente', strict: true, schema: p.schemaSalida },
      },
    };
  }

  async chat(p: PeticionModelo): Promise<RespuestaModelo> {
    const timeoutMs = this.o.timeoutMs ?? 20_000;
    const f = this.o.fetchFn ?? fetch;
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const inicio = Date.now();
    let token: string;
    try {
      token = await this.o.getToken();
    } catch {
      throw noDisponible('no se pudo obtener el token');
    }
    const body = JSON.stringify(this.cuerpo(p));

    for (let intento = 0; intento < 2; intento++) {
      const restante = timeoutMs - (Date.now() - inicio);
      if (restante <= 0) throw noDisponible('tiempo agotado');
      let res: Response;
      try {
        res = await f(this.url(), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(restante),
        });
      } catch (e) {
        const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        throw noDisponible(timeout ? 'tiempo agotado' : 'error de red');
      }

      if (res.ok) return this.interpretar((await res.json().catch(() => null)) as RespuestaApi | null);

      if (res.status === 400) {
        const err = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        if (err?.error?.code === 'content_filter')
          return { tipo: 'final', contenido: SALIDA_FILTRADA, uso: { entrada: 0, salida: 0 } };
        throw noDisponible('petición rechazada', { status: 400 });
      }
      const reintentable = res.status === 429 || res.status >= 500;
      if (reintentable && intento === 0) {
        const espera = esperaMs(res);
        if (espera !== null && espera <= (this.o.maxReintentoMs ?? 3000)) {
          await sleep(espera);
          continue;
        }
      }
      throw noDisponible(`HTTP ${res.status}`, { status: res.status });
    }
    throw noDisponible('sin respuesta');
  }

  private interpretar(r: RespuestaApi | null): RespuestaModelo {
    const eleccion = r?.choices?.[0];
    if (!eleccion) throw noDisponible('respuesta sin contenido');
    const uso = { entrada: r?.usage?.prompt_tokens ?? 0, salida: r?.usage?.completion_tokens ?? 0 };
    if (eleccion.finish_reason === 'content_filter')
      return { tipo: 'final', contenido: SALIDA_FILTRADA, uso };
    const llamadas: LlamadaHerramienta[] = (eleccion.message?.tool_calls ?? []).flatMap((c) =>
      c.id && c.function?.name
        ? [
            {
              id: c.id,
              nombre: c.function.name,
              argumentos: c.function.arguments ?? '{}',
              ...(c.extra_content !== undefined ? { extra: c.extra_content } : {}),
            },
          ]
        : [],
    );
    if (llamadas.length) return { tipo: 'herramientas', llamadas, uso };
    const contenido = eleccion.message?.content;
    if (typeof contenido !== 'string' || !contenido) throw noDisponible('respuesta vacía');
    return { tipo: 'final', contenido, uso };
  }
}

/** Espera pedida por el servicio (`retry-after-ms` o `retry-after` en segundos); null si no la indica. */
function esperaMs(res: Response): number | null {
  const ms = res.headers.get('retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Number(ms);
  const s = res.headers.get('retry-after');
  if (s && Number.isFinite(Number(s))) return Number(s) * 1000;
  return 0;
}

export type { MensajeModelo };
