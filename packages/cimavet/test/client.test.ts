import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { CimavetClient } from '../src/client';
import { HttpError, RateLimiter } from '../src/http';
import { registroDesdeApi } from '../src/normalizar';
import { extraerLista, fechaCimavet, lowerKeys } from '../src/schemas';

const BASE = 'https://cimavet.test/cimavet/rest/';
const fx = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/cimavet', f), 'utf8'));
const MED_1868 = fx('medicamento_1868_ESP.json');
const MED_1077 = fx('medicamento_1077_ESP.json');

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const noSleep = vi.fn(async () => {});
const client = (o: Partial<ConstructorParameters<typeof CimavetClient>[0]> = {}) =>
  new CimavetClient({ baseUrl: BASE, rps: 1000, sleep: noSleep, random: () => 0, baseDelayMs: 1, ...o });

describe('CimavetClient (SPEC §5.1.1)', () => {
  it('normaliza mayúsculas inconsistentes (Comerc/comerc, Id/id) y acepta campos nuevos', async () => {
    server.use(http.get(`${BASE}medicamento`, () => HttpResponse.json(MED_1868)));
    const r = await client().medicamento({ nregistro: '1868 ESP' });
    expect(r?.data.comerc).toBe(false);
    expect(r?.data.forma?.id).toBe(40);
    expect(r?.data.principiosactivos?.[0]?.id).toBe(161);
    expect(r?.data.presentaciones?.[0]?.comerc).toBe(false);
    expect((r?.raw as Record<string, unknown>).Comerc).toBe(false); // el crudo se guarda tal cual
    expect((r?.data as Record<string, unknown>).camponuevodesconocido).toEqual({ aceptado: true });
  });

  it('interpreta booleanos "S" y claves en mayúsculas', async () => {
    server.use(http.get(`${BASE}medicamento`, () => HttpResponse.json(MED_1077)));
    const r = await client().medicamento({ nregistro: '1077 ESP' });
    expect(r?.data.nregistro).toBe('1077 ESP');
    expect(r?.data.comerc).toBe(true);
    expect(r?.data.presentaciones?.[0]?.cn).toBe('570004');
  });

  it('envía User-Agent identificable y Accept JSON', async () => {
    let ua: string | null = null;
    server.use(
      http.get(`${BASE}presentacion/:cn`, ({ request }) => {
        ua = request.headers.get('user-agent');
        return HttpResponse.json({ cn: '570016', nregistro: '1868 ESP', nombre: 'X', Comerc: true });
      }),
    );
    const p = await client().presentacion('570016');
    expect(p?.data.comerc).toBe(true);
    expect(ua).toMatch(/MundoMascotix/);
  });

  it.each([
    ['array directo', (items: unknown[]) => items],
    ['objeto con lista', (items: unknown[]) => ({ totalFilas: 3, resultados: items })],
  ])('pagina de forma transparente con `pagina` (%s)', async (_n, envolver) => {
    const paginas: Record<string, unknown[]> = {
      '1': [{ nregistro: 'A', nombre: 'a' }, { nregistro: 'B', nombre: 'b' }],
      '2': [{ nregistro: 'C', nombre: 'c' }],
      '3': [],
    };
    const vistas: string[] = [];
    server.use(
      http.get(`${BASE}medicamentos`, ({ request }) => {
        const u = new URL(request.url);
        vistas.push(`${u.searchParams.get('pagina')}:${u.searchParams.get('nombre')}`);
        return HttpResponse.json(envolver(paginas[u.searchParams.get('pagina') ?? ''] ?? []));
      }),
    );
    const r = await client().medicamentos({ nombre: 'amoxicilina' });
    expect(r.map((x) => x.data.nregistro)).toEqual(['A', 'B', 'C']);
    expect(vistas).toEqual(['1:amoxicilina', '2:amoxicilina', '3:amoxicilina']);
  });

  it('se detiene si la API repite la misma página (no paginada)', async () => {
    let n = 0;
    server.use(
      http.get(`${BASE}registroCambios`, ({ request }) => {
        n++;
        const u = new URL(request.url);
        expect(u.searchParams.get('fecha')).toBe('13/10/2026');
        expect(u.searchParams.getAll('nregistro')).toEqual(['1868 ESP', '1077 ESP']);
        return HttpResponse.json(fx('registroCambios.json'));
      }),
    );
    const r = await client().registroCambios('2026-10-13', ['1868 ESP', '1077 ESP']);
    expect(r.map((c) => [c.data.nregistro, c.data.tipocambio])).toEqual([
      ['1868 ESP', 3],
      ['1077 ESP', 2],
    ]);
    expect(n).toBe(2);
  });

  it('reintenta en 5xx con backoff exponencial y jitter', async () => {
    let n = 0;
    server.use(
      http.get(`${BASE}maestras`, () => {
        n++;
        if (n < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json(n === 3 ? fx('maestras_7_especies.json') : []);
      }),
    );
    const sleep = vi.fn(async (_ms: number) => {});
    const r = await client({ sleep, random: () => 0.5, baseDelayMs: 100 }).maestras(7);
    expect(r.map((x) => x.data.nombre)).toEqual(['Bovino', 'Perros', 'Gatos']);
    // (las esperas de pocos ms son del limitador de peticiones)
    expect(sleep.mock.calls.map((c) => c[0]).filter((ms) => ms >= 50)).toEqual([150, 300]);
  });

  it('no reintenta errores 4xx deterministas', async () => {
    let n = 0;
    server.use(
      http.get(`${BASE}medicamentos`, () => {
        n++;
        return HttpResponse.json({ error: 'parámetro' }, { status: 400 });
      }),
    );
    await expect(client().medicamentos({ nombre: 'x' })).rejects.toMatchObject({ kind: 'HTTP', status: 400 });
    expect(n).toBe(1);
  });

  it('timeout → reintenta y acaba con error TIMEOUT', async () => {
    server.use(
      http.get(`${BASE}medicamento`, async () => {
        await delay(200);
        return HttpResponse.json(MED_1868);
      }),
    );
    await expect(client({ timeoutMs: 20, maxRetries: 1 }).medicamento({ nregistro: '1868 ESP' })).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('error de red → reintenta', async () => {
    let n = 0;
    server.use(
      http.get(`${BASE}notas/:nreg`, () => {
        n++;
        if (n === 1) return HttpResponse.error();
        return HttpResponse.json([{ tipo: 1, num: 7, ref: 'MUH', asunto: 'Nota', fecha: '01/02/2026', url: 'https://x' }]);
      }),
    );
    const r = await client().notas('1868 ESP');
    expect(r[0]?.data.num).toBe('7');
  });

  it('404 en medicamento/presentación → null', async () => {
    server.use(
      http.get(`${BASE}medicamento`, () => new HttpResponse(null, { status: 404 })),
      http.get(`${BASE}presentacion/:cn`, () => new HttpResponse(null, { status: 404 })),
    );
    expect(await client().medicamento({ cn: '999999' })).toBeNull();
    expect(await client().presentacion('999999')).toBeNull();
  });

  it('respuesta vacía → null; respuesta inválida → error de validación', async () => {
    server.use(http.get(`${BASE}medicamento`, () => HttpResponse.json([])));
    expect(await client().medicamento({ nregistro: 'x' })).toBeNull();
    server.use(http.get(`${BASE}medicamento`, () => HttpResponse.json({ nombre: 'sin nregistro' })));
    await expect(client().medicamento({ nregistro: 'x' })).rejects.toThrow(/no válida/);
    server.use(http.get(`${BASE}presentacion/:cn`, () => HttpResponse.json(null)));
    expect(await client().presentacion('1')).toBeNull();
  });

  it('error 500 persistente agota los reintentos', async () => {
    server.use(http.get(`${BASE}presentaciones`, () => new HttpResponse('boom', { status: 500 })));
    const err = await client({ maxRetries: 2 }).presentaciones({ nregistro: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).body).toBe('boom');
  });

  it.todo('validar el envoltorio de paginación y los formatos de fecha con respuestas reales en fixtures/cimavet/ (ver README)');
});

describe('RateLimiter', () => {
  it('espacia las peticiones a 1000/rps ms', async () => {
    let t = 0;
    const esperas: number[] = [];
    const rl = new RateLimiter(3, () => t, async (ms) => {
      esperas.push(Math.round(ms));
      t += ms;
    });
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(esperas).toEqual([333, 333]);
  });
});

describe('normalización a la caché', () => {
  it('registroDesdeApi', () => {
    const r = registroDesdeApi(
      lowerKeys(MED_1868) as never,
      MED_1868,
      new Date('2026-10-14T00:00:00Z'),
    );
    expect(r.medicamento).toMatchObject({ nregistro: '1868 ESP', formaId: 40, antibiotico: true, estadoCodigo: 'autorizado', source: 'api', primeraAutorizacion: '2008-04-10' });
    expect(r.presentaciones[0]).toMatchObject({ cn: '570016', comerc: false });
    // Sin base de concentración en la API: no normalizable (conservador).
    expect(r.principiosActivos?.[0]).toMatchObject({ paId: 161, normalizable: false });
    expect(r.especies).toEqual([14]);
    expect(r.vias).toEqual([54]);
    expect(r.atc).toEqual(['QJ01CR02']);
  });

  it('suspendido/revocado y tiempos de espera', () => {
    const r = registroDesdeApi(lowerKeys(MED_1077) as never, MED_1077, new Date());
    expect(r.medicamento.estadoCodigo).toBe('suspendido');
    expect(r.medicamento.primeraAutorizacion).toBeNull();
    expect(r.principiosActivos?.[0]).toMatchObject({ normalizable: true, unidadCanonica: 'mg/mg' });
    expect(r.tiemposEspera).toEqual([{ especieId: 1, tejido: 'Carne', cantidad: '0', unidad: 'Días', formaViaAdmin: null, noAplicaTejido: false }]);
    expect(registroDesdeApi({ nregistro: 'X', nombre: 'Y', estado: { rev: 1 } } as never, {}, new Date()).medicamento.estadoCodigo).toBe('revocado');
  });

  it('fechas y listas', () => {
    expect(fechaCimavet(1207785600)).toBe('2008-04-10');
    expect(fechaCimavet('1207785600000')).toBe('2008-04-10');
    expect(fechaCimavet('27/03/1996')).toBe('1996-03-27');
    expect(fechaCimavet('2026-10-14T00:00:00')).toBe('2026-10-14');
    expect(fechaCimavet('ayer')).toBeNull();
    expect(fechaCimavet(null)).toBeNull();
    expect(extraerLista('texto')).toEqual([]);
    expect(extraerLista({ a: 1 })).toEqual([]);
  });
});
