import type { AppConfig } from '@mmx/shared';
import { DomainError } from '@mmx/shared';
import { AzureChatClient } from './azure/chat-client';
import { FakeAssistantModel, type Guion } from './fake';
import { guionesDemo } from './guiones';
import type { AssistantModel, PeticionModelo, RespuestaModelo } from './model';

const SCOPE_COGNITIVE = 'https://cognitiveservices.azure.com/.default';

/** Proveedor de tokens de Entra con la credencial de la app (identidad gestionada en Azure). */
export async function tokenProviderAzure(): Promise<() => Promise<string>> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const cred = new DefaultAzureCredential();
  return async () => {
    const t = await cred.getToken(SCOPE_COGNITIVE);
    if (!t) throw new Error('No se pudo obtener un token de Entra para el asistente');
    return t.token;
  };
}

/** Modelo desactivado: la app arranca igual, pero cualquier pregunta responde «no disponible» (FR-026). */
export class DisabledAssistantModel implements AssistantModel {
  readonly nombre = 'desactivado';
  constructor(public readonly motivo: string) {}
  async chat(_p: PeticionModelo): Promise<RespuestaModelo> {
    throw new DomainError('ASISTENTE_NO_DISPONIBLE', this.motivo);
  }
}

export type ConfigAsistente = Pick<
  AppConfig,
  | 'ASSISTANT'
  | 'ASSISTANT_ENDPOINT'
  | 'ASSISTANT_DEPLOYMENT'
  | 'ASSISTANT_API_VERSION'
  | 'ASSISTANT_TIMEOUT_MS'
>;

/** API de Gemini con el formato de chat de OpenAI (herramientas y salida estructurada incluidas). */
export const ENDPOINT_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * `off` → null (sin asistente); `fake` → modelo con guiones; `azure` → despliegue de chat de Azure OpenAI o
 * Foundry. Si falta configuración fuera de producción, el modelo queda desactivado sin impedir el arranque.
 */
export async function crearModeloAsistente(
  config: ConfigAsistente,
  deps: { guiones?: Guion[]; getToken?: () => Promise<string>; fetchFn?: typeof fetch } = {},
): Promise<AssistantModel | null> {
  if (config.ASSISTANT === 'off') return null;
  if (config.ASSISTANT === 'fake') return new FakeAssistantModel(deps.guiones ?? guionesDemo());
  if (config.ASSISTANT === 'gemini') {
    if (!config.ASSISTANT_DEPLOYMENT)
      return new DisabledAssistantModel('Falta configuración del asistente: ASSISTANT_DEPLOYMENT');
    if (!deps.getToken) return new DisabledAssistantModel('Falta la clave de la API del asistente');
    return new AzureChatClient({
      endpoint: config.ASSISTANT_ENDPOINT || ENDPOINT_GEMINI,
      deployment: config.ASSISTANT_DEPLOYMENT,
      protocolo: 'compatible',
      timeoutMs: config.ASSISTANT_TIMEOUT_MS,
      getToken: deps.getToken,
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
    });
  }
  const faltan = (['ASSISTANT_ENDPOINT', 'ASSISTANT_DEPLOYMENT'] as const).filter((k) => !config[k]);
  if (faltan.length)
    return new DisabledAssistantModel(`Falta configuración del asistente: ${faltan.join(', ')}`);
  const getToken = deps.getToken ?? (await tokenProviderAzure());
  return new AzureChatClient({
    endpoint: config.ASSISTANT_ENDPOINT as string,
    deployment: config.ASSISTANT_DEPLOYMENT as string,
    apiVersion: config.ASSISTANT_API_VERSION,
    timeoutMs: config.ASSISTANT_TIMEOUT_MS,
    getToken,
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
  });
}
