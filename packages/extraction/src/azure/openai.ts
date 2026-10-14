/**
 * Azure OpenAI (despliegue en Data Zone UE) con structured outputs (SPEC §5.3 etapa 2).
 * Autenticación con Entra ID (scope cognitiveservices), sin claves.
 */
export interface OpenAiOptions {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  getToken: () => Promise<string>;
}

export interface RespuestaLlm {
  json: unknown;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
  modelo: string | null;
}

export class AzureOpenAiClient {
  constructor(private readonly o: OpenAiOptions) {}

  async completarJson(d: { sistema: string; texto: string; imagenes: { mime: string; base64: string }[]; schema: Record<string, unknown> }): Promise<RespuestaLlm> {
    const url = `${this.o.endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(this.o.deployment)}/chat/completions?api-version=${this.o.apiVersion}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.o.getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        temperature: 0,
        messages: [
          { role: 'system', content: d.sistema },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Texto OCR de la receta:\n\n${d.texto}` },
              ...d.imagenes.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}`, detail: 'high' } })),
            ],
          },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'receta_veterinaria', strict: true, schema: d.schema } },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Azure OpenAI respondió ${res.status}`);
    const body = (await res.json()) as {
      model?: string;
      usage?: RespuestaLlm['usage'];
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    };
    const msg = body.choices?.[0]?.message;
    if (msg?.refusal) throw new Error('El modelo rechazó la petición');
    if (!msg?.content) throw new Error('Respuesta vacía del modelo');
    return { json: JSON.parse(msg.content), usage: body.usage ?? null, modelo: body.model ?? null };
  }
}
