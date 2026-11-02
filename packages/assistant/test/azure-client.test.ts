import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { AzureChatClient, SALIDA_FILTRADA } from '../src/azure/chat-client';
import { crearModeloAsistente, DisabledAssistantModel } from '../src/factory';

/**
 * El cuerpo de las respuestas sigue el formato documentado de la API de *chat completions*. TODO: grabar respuestas
 * reales anonimizadas en fixtures/asistente/chat/ (ver el README de esa carpeta) y sustituir estos cuerpos mínimos.
 */
const URL_CHAT = 'https://recurso.openai.azure.com/openai/deployments/chat-eu/chat/completions';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const cliente = (o: Partial<ConstructorParameters<typeof AzureChatClient>[0]> = {}) =>
  new AzureChatClient({
    endpoint: 'https://recurso.openai.azure.com/',
    deployment: 'chat-eu',
    getToken: async () => 'token-de-prueba',
    sleep: async () => undefined,
    ...o,
  });
const peticion = {
  mensajes: [{ role: 'user' as const, content: 'hola' }],
  herramientas: [],
  schemaSalida: { type: 'object' },
  permitirHerramientas: true,
};

describe('AzureChatClient', () => {
  it('interpreta una ronda de herramientas y una respuesta final, con el uso de tokens', async () => {
    let cuerpo: Record<string, unknown> | undefined;
    let auth = '';
    server.use(
      http.post(URL_CHAT, async ({ request }) => {
        cuerpo = (await request.json()) as Record<string, unknown>;
        auth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'consultar_reglas', arguments: '{"tema":"validez"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 15 },
          campo_nuevo_desconocido: true,
        });
      }),
    );
    const r = await cliente().chat({
      ...peticion,
      herramientas: [{ nombre: 'consultar_reglas', descripcion: 'x', parametros: { type: 'object' } }],
    });
    expect(r).toEqual({
      tipo: 'herramientas',
      llamadas: [{ id: 'c1', nombre: 'consultar_reglas', argumentos: '{"tema":"validez"}' }],
      uso: { entrada: 120, salida: 15 },
    });
    expect(auth).toBe('Bearer token-de-prueba');
    expect(cuerpo?.['tools']).toHaveLength(1);
    expect(cuerpo?.['response_format']).toMatchObject({ type: 'json_schema' });

    server.use(
      http.post(URL_CHAT, () =>
        HttpResponse.json({
          choices: [{ finish_reason: 'stop', message: { content: '{"tipo":"sin_informacion"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      ),
    );
    expect(await cliente().chat(peticion)).toEqual({
      tipo: 'final',
      contenido: '{"tipo":"sin_informacion"}',
      uso: { entrada: 10, salida: 5 },
    });
  });

  it('sin herramientas permitidas no envía tools', async () => {
    let cuerpo: Record<string, unknown> | undefined;
    server.use(
      http.post(URL_CHAT, async ({ request }) => {
        cuerpo = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
      }),
    );
    await cliente().chat({
      ...peticion,
      herramientas: [{ nombre: 'a', descripcion: 'x', parametros: {} }],
      permitirHerramientas: false,
    });
    expect(cuerpo).not.toHaveProperty('tools');
  });

  it('reintenta una vez ante 429 con retry-after corto', async () => {
    let n = 0;
    server.use(
      http.post(URL_CHAT, () => {
        n++;
        return n === 1
          ? new HttpResponse(null, { status: 429, headers: { 'retry-after': '1' } })
          : HttpResponse.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
      }),
    );
    expect((await cliente().chat(peticion)).tipo).toBe('final');
    expect(n).toBe(2);
  });

  it.each([
    [
      '429 con retry-after largo',
      () => new HttpResponse(null, { status: 429, headers: { 'retry-after': '30' } }),
    ],
    ['5xx', () => new HttpResponse(null, { status: 503 })],
    ['respuesta sin choices', () => HttpResponse.json({ choices: [] })],
    [
      'respuesta vacía',
      () => HttpResponse.json({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }),
    ],
    [
      '400 que no es de filtro',
      () => HttpResponse.json({ error: { code: 'invalid_request' } }, { status: 400 }),
    ],
  ])('%s → ASISTENTE_NO_DISPONIBLE', async (_n, resp) => {
    server.use(http.post(URL_CHAT, resp));
    await expect(cliente().chat(peticion)).rejects.toMatchObject({ code: 'ASISTENTE_NO_DISPONIBLE' });
  });

  it('el 5xx solo se reintenta una vez', async () => {
    let n = 0;
    server.use(
      http.post(URL_CHAT, () => {
        n++;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await expect(cliente().chat(peticion)).rejects.toMatchObject({ code: 'ASISTENTE_NO_DISPONIBLE' });
    expect(n).toBe(2);
  });

  it('timeout → ASISTENTE_NO_DISPONIBLE', async () => {
    server.use(
      http.post(URL_CHAT, async () => {
        await new Promise((r) => setTimeout(r, 400));
        return HttpResponse.json({});
      }),
    );
    await expect(cliente({ timeoutMs: 50 }).chat(peticion)).rejects.toMatchObject({
      code: 'ASISTENTE_NO_DISPONIBLE',
    });
  });

  it('un fallo al obtener el token → ASISTENTE_NO_DISPONIBLE', async () => {
    await expect(
      cliente({
        getToken: async () => {
          throw new Error('sin credencial');
        },
      }).chat(peticion),
    ).rejects.toMatchObject({ code: 'ASISTENTE_NO_DISPONIBLE' });
  });

  it('el filtro de contenido (finish_reason o 400) devuelve una salida fuera_de_ambito', async () => {
    server.use(
      http.post(URL_CHAT, () =>
        HttpResponse.json({ choices: [{ finish_reason: 'content_filter', message: { content: null } }] }),
      ),
    );
    expect(await cliente().chat(peticion)).toMatchObject({ tipo: 'final', contenido: SALIDA_FILTRADA });
    server.use(
      http.post(URL_CHAT, () => HttpResponse.json({ error: { code: 'content_filter' } }, { status: 400 })),
    );
    expect(await cliente().chat(peticion)).toMatchObject({ tipo: 'final', contenido: SALIDA_FILTRADA });
  });

  it.todo(
    'respuesta real grabada: falta fixtures/asistente/chat/herramientas.json (llamada real anonimizada)',
  );
  it.todo('respuesta real grabada: falta fixtures/asistente/chat/final.json (llamada real anonimizada)');
});

describe('crearModeloAsistente', () => {
  const base = {
    ASSISTANT: 'off' as const,
    ASSISTANT_ENDPOINT: undefined,
    ASSISTANT_DEPLOYMENT: undefined,
    ASSISTANT_API_VERSION: '2024-10-21',
    ASSISTANT_TIMEOUT_MS: 20000,
  };
  it('off → null; fake → modelo falso; azure sin configuración → desactivado', async () => {
    expect(await crearModeloAsistente(base)).toBeNull();
    expect((await crearModeloAsistente({ ...base, ASSISTANT: 'fake' }))?.nombre).toBe('fake');
    const m = await crearModeloAsistente({ ...base, ASSISTANT: 'azure' }, { getToken: async () => 't' });
    expect(m).toBeInstanceOf(DisabledAssistantModel);
    await expect(m?.chat(peticion)).rejects.toMatchObject({ code: 'ASISTENTE_NO_DISPONIBLE' });
  });
  it('azure con configuración → cliente con el nombre del despliegue', async () => {
    const m = await crearModeloAsistente(
      {
        ...base,
        ASSISTANT: 'azure',
        ASSISTANT_ENDPOINT: 'https://x.openai.azure.com',
        ASSISTANT_DEPLOYMENT: 'chat-eu',
      },
      { getToken: async () => 't' },
    );
    expect(m?.nombre).toBe('chat-eu');
  });
});

describe('AzureChatClient con protocolo compatible (Gemini)', () => {
  const URL_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

  it('usa la ruta compatible, envía el modelo y devuelve la firma del proveedor con la llamada', async () => {
    const cuerpos: Record<string, unknown>[] = [];
    server.use(
      http.post(URL_GEMINI, async ({ request }) => {
        cuerpos.push((await request.json()) as Record<string, unknown>);
        if (cuerpos.length === 1)
          return HttpResponse.json({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'buscar_regla', arguments: '{"consulta":"x"}' },
                      extra_content: { google: { thought_signature: 'firma' } },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          });
        return HttpResponse.json({
          choices: [{ finish_reason: 'stop', message: { content: '{"texto":"ok"}' } }],
          usage: { prompt_tokens: 20, completion_tokens: 3 },
        });
      }),
    );
    const c = cliente({
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
      deployment: 'gemini-3.1-flash-lite',
      protocolo: 'compatible',
    });
    const r1 = await c.chat(peticion);
    expect(r1.tipo).toBe('herramientas');
    if (r1.tipo !== 'herramientas') return;
    expect(r1.llamadas[0]?.extra).toEqual({ google: { thought_signature: 'firma' } });
    expect(cuerpos[0]?.model).toBe('gemini-3.1-flash-lite');

    await c.chat({
      ...peticion,
      mensajes: [...peticion.mensajes, { role: 'assistant', content: null, llamadas: r1.llamadas }],
    });
    const enviado = JSON.stringify(cuerpos[1]);
    expect(enviado).toContain('"thought_signature":"firma"');
  });

  it('el modelo de Gemini se crea con la clave recibida y sin ella queda desactivado', async () => {
    const config = {
      ASSISTANT: 'gemini' as const,
      ASSISTANT_ENDPOINT: undefined,
      ASSISTANT_DEPLOYMENT: 'gemini-3.1-flash-lite',
      ASSISTANT_API_VERSION: '2024-10-21',
      ASSISTANT_TIMEOUT_MS: 20000,
    };
    expect(await crearModeloAsistente(config, { getToken: async () => 'k' })).toBeInstanceOf(AzureChatClient);
    expect(await crearModeloAsistente(config)).toBeInstanceOf(DisabledAssistantModel);
  });
});
