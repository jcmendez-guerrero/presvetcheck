import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { CimavetClient } from '../src/client';
import { HttpError, RateLimiter } from '../src/http';
import { registroDesdeApi } from '../src/normalizar';
import { extraerLista, fechaCimavet, lowerKeys, tamanioPagina } from '../src/schemas';
import {
  capitalizarClaves,
  listaApi,
  maestraEspeciesApi,
  medicamentoApi,
  muestra,
  registroCambiosApi,
} from './api-desde-xml';

const BASE = 'https://cimavet.test/cimavet/rest/';
// Respuestas derivadas del Nomenclátor XML con la forma de la API real (ver api-desde-xml.ts).
const MED_1868 = await medicamentoApi('1868 ESP');
const MED_1077 = await medicamentoApi('1077 ESP');

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const noSleep = vi.fn(async () => {});
const client = (o: Partial<ConstructorParameters<typeof CimavetClient>[0]> = {}) =>
  new CimavetClient({ baseUrl: BASE, rps: 1000, sleep: noSleep, random: () => 0, baseDelayMs: 1, ...o });

describe('CimavetClient (SPEC §5.1.1)', () => {
  it('lee la respuesta con la forma real (formasFarmaceuticas, principiosActivos, presentaciones)', async () => {
    server.use(http.get(`${BASE}medicamento`, () => HttpResponse.json(MED_1868)));
    const r = await client().medicamento({ nregistro: '1868 ESP' });
    expect(r?.data.comerc).toBe(false);
    expect(r?.data.formasfarmaceuticas?.[0]?.id).toBe(40);
    expect(r?.data.principiosactivos?.map((p) => p.id)).toEqual([161, 5419]);
    expect(r?.data.presentaciones?.[0]?.cn).toBe('570016');
  });

  it('normaliza mayúsculas inconsistentes (Comerc/comerc, Id/id), booleanos "S" y acepta campos nuevos', async () => {
    const variante = {
      ...(capitalizarClaves(MED_1077, ['comerc', 'id']) as object),
      receta: 'S',
      campoNuevoDesconocido: { aceptado: true },
    };
    server.use(http.get(`${BASE}medicamento`, () => HttpResponse.json(variante)));
    const r = await client().medicamento({ nregistro: '1077 ESP' });
    expect(r?.data.nregistro).toBe('1077 ESP');
    expect(r?.data.receta).toBe(true);
    expect(r?.data.comerc).toBe(MED_1077.comerc);
    expect(r?.data.especies?.[0]?.id).toBe((MED_1077.especies as { id: number }[])[0]?.id);
    expect((r?.raw as Record<string, unknown>).Comerc).toBe(MED_1077.comerc); // el crudo se guarda tal cual
    expect((r?.data as Record<string, unknown>).camponuevodesconocido).toEqual({ aceptado: true });
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

  it('pagina con el envoltorio real y se detiene en la página incompleta (sin pedir la siguiente)', async () => {
    const vistas: string[] = [];
    server.use(
      http.get(`${BASE}medicamentos`, ({ request }) => {
        const p = Number(new URL(request.url).searchParams.get('pagina'));
        vistas.push(String(p));
        return HttpResponse.json(p === 1 ? listaApi([MED_1868, MED_1077], 1, 2) : listaApi([MED_1868], p, 2));
      }),
    );
    const r = await client().medicamentos({ nombre: 'x' });
    expect(r).toHaveLength(3);
    expect(vistas).toEqual(['1', '2']);
    expect(tamanioPagina([])).toBeNull();
  });

  it('se detiene si la API repite la misma página', async () => {
    let n = 0;
    server.use(
      http.get(`${BASE}maestras`, () => {
        n++;
        return HttpResponse.json([{ id: 1, nombre: 'a' }]);
      }),
    );
    expect(await client().maestras(7)).toHaveLength(1);
    expect(n).toBe(2);
  });

  it.each([
    ['array directo', (items: unknown[]) => items],
    ['envoltorio real sin tamaño', (items: unknown[]) => ({ totalFilas: 3, resultados: items })],
  ])('pagina de forma transparente con `pagina` (%s)', async (_n, envolver) => {
    const paginas: Record<string, unknown[]> = {
      '1': [
        { nregistro: 'A', nombre: 'a' },
        { nregistro: 'B', nombre: 'b' },
      ],
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

  it('registroCambios: fecha dd/mm/aaaa, varios nregistro y envoltorio real (una sola página incompleta)', async () => {
    let n = 0;
    server.use(
      http.get(`${BASE}registroCambios`, ({ request }) => {
        n++;
        const u = new URL(request.url);
        expect(u.searchParams.get('fecha')).toBe('13/10/2026');
        expect(u.searchParams.getAll('nregistro')).toEqual(['1868 ESP', '1077 ESP']);
        return HttpResponse.json(
          registroCambiosApi([
            { nregistro: '1868 ESP', fecha: '2026-10-13', tipoCambio: 3, cambio: ['comerc'] },
            { nregistro: '1077 ESP', fecha: '2026-10-13', tipoCambio: 2 },
          ]),
        );
      }),
    );
    const r = await client().registroCambios('2026-10-13', ['1868 ESP', '1077 ESP']);
    expect(r.map((c) => [c.data.nregistro, c.data.tipocambio])).toEqual([
      ['1868 ESP', 3],
      ['1077 ESP', 2],
    ]);
    expect(r[0]?.data.cambio).toEqual(['comerc']);
    expect(fechaCimavet(r[0]?.data.fecha)).toBe('2026-10-13');
    expect(n).toBe(1);
  });

  it('reintenta en 5xx con backoff exponencial y jitter', async () => {
    const especies = await maestraEspeciesApi([1, 14, 15]);
    let n = 0;
    server.use(
      http.get(`${BASE}maestras`, () => {
        n++;
        if (n < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json(n === 3 ? especies : []);
      }),
    );
    const sleep = vi.fn(async (_ms: number) => {});
    const r = await client({ sleep, random: () => 0.5, baseDelayMs: 100 }).maestras(7);
    expect(r.map((x) => x.data.id)).toEqual([1, 14, 15]);
    expect(r.every((x) => !!x.data.nombre)).toBe(true);
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
    await expect(
      client({ timeoutMs: 20, maxRetries: 1 }).medicamento({ nregistro: '1868 ESP' }),
    ).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('error de red → reintenta', async () => {
    let n = 0;
    server.use(
      http.get(`${BASE}notas/:nreg`, () => {
        n++;
        if (n === 1) return HttpResponse.error();
        return HttpResponse.json([
          { tipo: 1, num: 7, ref: 'MUH', asunto: 'Nota', fecha: '01/02/2026', url: 'https://x' },
        ]);
      }),
    );
    const r = await client().notas('1868 ESP');
    expect(r[0]?.data.num).toBe('7');
  });

  it('404 en medicamento/presentación → null; 404 en notas (sin notas) → lista vacía', async () => {
    server.use(
      http.get(`${BASE}medicamento`, () => new HttpResponse(null, { status: 404 })),
      http.get(`${BASE}presentacion/:cn`, () => new HttpResponse(null, { status: 404 })),
      http.get(
        `${BASE}notas/:n`,
        () => new HttpResponse('<!DOCTYPE html>', { status: 404, headers: { 'content-type': 'text/html' } }),
      ),
    );
    expect(await client().medicamento({ cn: '999999' })).toBeNull();
    expect(await client().presentacion('999999')).toBeNull();
    expect(await client().notas('1868 ESP')).toEqual([]);
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
    const err = await client({ maxRetries: 2 })
      .presentaciones({ nregistro: 'x' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).body).toBe('boom');
  });
});

describe('RateLimiter', () => {
  it('espacia las peticiones a 1000/rps ms', async () => {
    let t = 0;
    const esperas: number[] = [];
    const rl = new RateLimiter(
      3,
      () => t,
      async (ms) => {
        esperas.push(Math.round(ms));
        t += ms;
      },
    );
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(esperas).toEqual([333, 333]);
  });
});

describe('normalización a la caché', () => {
  it('registroDesdeApi: la respuesta API de cada medicamento de la muestra reproduce los datos del Nomenclátor', async () => {
    const { registros } = await muestra();
    for (const [nreg, x] of registros) {
      const api = await medicamentoApi(nreg);
      const r = registroDesdeApi(lowerKeys(api) as never, api, new Date('2026-10-14T00:00:00Z'));
      expect(r.medicamento, nreg).toMatchObject({
        nregistro: nreg,
        formaId: x.medicamento.formaId,
        estadoCodigo: x.medicamento.estadoCodigo,
        primeraAutorizacion: x.medicamento.primeraAutorizacion,
        antibiotico: x.medicamento.antibiotico,
        psicotropo: x.medicamento.psicotropo,
        source: 'api',
      });
      expect(r.presentaciones.map((p) => p.cn).sort(), nreg).toEqual(
        x.presentaciones.map((p) => p.cn).sort(),
      );
      expect(r.especies, nreg).toEqual(x.especies);
      expect(r.vias, nreg).toEqual(x.vias);
      expect(r.atc, nreg).toEqual(x.atc);
      expect(
        r.tiemposEspera?.map((t) => [t.especieId, t.tejido, t.cantidad, t.unidad]),
        nreg,
      ).toEqual(x.tiemposEspera?.map((t) => [t.especieId, t.tejido, t.cantidad, t.unidad]));
    }
  });

  it('sin base de concentración en la API la composición no es normalizable (conservador)', () => {
    const r = registroDesdeApi(lowerKeys(MED_1868) as never, MED_1868, new Date());
    expect(r.principiosActivos?.[0]).toMatchObject({ paId: 161, normalizable: false });
    expect(
      registroDesdeApi({ nregistro: 'X', nombre: 'Y', estado: { rev: 1 } } as never, {}, new Date())
        .medicamento.estadoCodigo,
    ).toBe('revocado');
    expect(
      registroDesdeApi({ nregistro: 'X', nombre: 'Y', estado: { aut: 1, susp: 2 } } as never, {}, new Date())
        .medicamento.estadoCodigo,
    ).toBe('suspendido');
  });

  it('registroDesdeApi reconcilia vías de administración prefiriendo codigo canónico sobre id interno (FR-014)', () => {
    const r = registroDesdeApi(
      lowerKeys({
        nregistro: '3313 ESP',
        nombre: 'Prednicortone',
        viasAdministracion: [
          { id: 48, codigo: '54', nombre: 'VÍA ORAL' },
          { id: 12, nombre: 'VÍA TÓPICA' },
        ],
      }) as never,
      {},
      new Date(),
    );
    expect(r.vias).toEqual([54, 12]);
  });

  it('tiempos de espera con la forma real (objetos tejido/unidadTiempo/forma/vía)', () => {
    const r = registroDesdeApi(
      lowerKeys({
        nregistro: 'X',
        nombre: 'Y',
        tiemposEspera: [
          {
            especie: { id: 1 },
            tejido: { id: 1, nombre: 'Carne' },
            cantidad: '28',
            formaFarmaceutica: { id: 9, nombre: 'SOLUCIÓN INYECTABLE' },
            viaAdministracion: { id: 3, nombre: 'VÍA INTRAMUSCULAR' },
            unidadTiempo: { id: 1, nombre: 'Días' },
          },
        ],
      }) as never,
      {},
      new Date(),
    );
    expect(r.tiemposEspera).toEqual([
      {
        especieId: 1,
        tejido: 'Carne',
        cantidad: '28',
        unidad: 'Días',
        formaViaAdmin: 'SOLUCIÓN INYECTABLE / VÍA INTRAMUSCULAR',
        noAplicaTejido: false,
      },
    ]);
  });

  it('fechas y listas', () => {
    // ms epoch de la medianoche de Madrid (forma real): en UTC sería el día anterior.
    expect(fechaCimavet(1207778400000)).toBe('2008-04-10');
    expect(fechaCimavet('1207778400000')).toBe('2008-04-10');
    expect(fechaCimavet(1207778400)).toBe('2008-04-10');
    expect(fechaCimavet(1767222000000)).toBe('2026-01-01'); // invierno (UTC+1)
    expect(fechaCimavet('27/03/1996')).toBe('1996-03-27');
    expect(fechaCimavet('2026-10-14T00:00:00')).toBe('2026-10-14');
    expect(fechaCimavet('ayer')).toBeNull();
    expect(fechaCimavet(null)).toBeNull();
    expect(extraerLista('texto')).toEqual([]);
    expect(extraerLista({ a: 1 })).toEqual([]);
  });
});
