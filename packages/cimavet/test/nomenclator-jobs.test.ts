import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { eq } from 'drizzle-orm';
import { cimavetMaestra, cimavetMedicamento, cimavetSyncRun, importarMaestras, MAESTRA, type DbHandle } from '@mmx/db';
import { createTestDb } from '@mmx/db/testing';
import { CimavetClient } from '../src/client';
import { jobCimavetDelta, jobCimavetFull, jobNomenclatorImport, verificarEnVivo } from '../src/jobs';
import { diasEspera } from '../src/normalizar';
import { estadoNomenclator, registroDesdeNomenclator } from '../src/nomenclator';
import { CimavetRepository } from '../src/repo';
import { readFileSync } from 'node:fs';
import { listaApi, maestraEspeciesApi, medicamentoApi, MUESTRA, registroCambiosApi } from './api-desde-xml';

const ROOT = resolve(__dirname, '../../..');
const BASE = 'https://cimavet.test/cimavet/rest/';

const med1868 = await medicamentoApi('1868 ESP');
const N = readFileSync(MUESTRA, 'utf8').split('<prescription>').length - 1;
let h: DbHandle;
let repo: CimavetRepository;
const server = setupServer();
const client = new CimavetClient({
  baseUrl: BASE,
  rps: 1000,
  sleep: async () => {},
  random: () => 0,
  baseDelayMs: 1,
  maxRetries: 1,
});

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  h = await createTestDb({ seed: true });
  await importarMaestras(h.db, resolve(ROOT, 'fixtures/nomenclator'), {
    solo: [MAESTRA.PRINCIPIOS_ACTIVOS, MAESTRA.LABORATORIOS, MAESTRA.INDICACIONES],
  });
  repo = new CimavetRepository(h.db);
}, 120_000);
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await h.close();
});

describe('importador del Nomenclátor (muestra real, streaming)', () => {
  it('carga la muestra con informe de nuevos/actualizados/descartados', async () => {
    const informe = await jobNomenclatorImport({
      repo,
      path: MUESTRA,
      now: () => new Date('2026-10-08T06:00:00Z'),
    });
    expect(informe).toMatchObject({
      leidos: N,
      nuevos: N,
      actualizados: 0,
      descartados: 0,
      listado: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('es idempotente: la segunda carga actualiza sin duplicar', async () => {
    const informe = await jobNomenclatorImport({ repo, path: MUESTRA });
    expect(informe).toMatchObject({ leidos: N, nuevos: 0, actualizados: N });
    const runs = await h.db.select().from(cimavetSyncRun).where(eq(cimavetSyncRun.tipo, 'nomenclator'));
    expect(runs).toHaveLength(2);
  });

  it('CLAVUBAY (1868 ESP): composición normalizable, contenido del envase, especie, vía, ATC y laboratorio', async () => {
    const m = await repo.medicamento('1868 ESP');
    expect(m).toMatchObject({
      nombre: expect.stringContaining('CLAVUBAY'),
      labtitular: 'NORBROOK LABORATORIES (IRELAND) LIMITED',
      antibiotico: true,
      receta: true,
      formaId: 40,
      especieIds: [14],
      viaIds: [54],
      atc: ['QJ01CR02'],
      estado: 'autorizado',
      inmunologico: false,
    });
    expect(m?.composicion).toEqual({
      pas: [
        { paId: 161, nombre: 'AMOXICILINA TRIHIDRATO', cantidad: '459', unidad: 'mg' },
        { paId: 5419, nombre: 'CLAVULANATO POTASIO', cantidad: '119', unidad: 'mg' },
      ],
      porCantidad: '1',
      porUnidad: 'Comprimido',
    });
    expect(await repo.presentacion('570016')).toMatchObject({
      contenido: '10',
      unidadContenido: 'Comprimido',
      comerc: false,
    });
    expect(m?.indicaciones.length).toBeGreaterThan(0);
  });

  it('tiempos de espera con forma/vía y "no aplica tejido" (estructura de julio de 2024)', async () => {
    const regs = await h.db.execute(
      (await import('drizzle-orm'))
        .sql`select count(*)::int as n from cimavet_med_tiempo_espera where no_aplica_tejido and forma_via_admin is not null`,
    );
    const n = ((regs as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0) as number;
    expect(n).toBeGreaterThan(0);
  });

  it('psicótropos, estupefacientes y suspendidos de la muestra', async () => {
    const meds = await h.db.select().from(cimavetMedicamento);
    expect(meds.some((m) => m.psicotropo)).toBe(true);
    expect(meds.some((m) => m.estupefaciente)).toBe(true);
    expect(meds.some((m) => m.estadoCodigo !== 'autorizado')).toBe(true);
  });

  it('búsqueda difusa por nombre y por CN; candidatos con el mismo principio activo', async () => {
    const r = await repo.buscar('clavubay');
    expect(r[0]).toMatchObject({ cn: '570016', nregistro: '1868 ESP' });
    expect(r[0]!.puntuacion).toBeGreaterThan(0.3);
    expect((await repo.buscar('570016'))[0]?.cn).toBe('570016');
    // La especie no filtra (cascada): solo ordena y marca si está autorizado.
    expect((await repo.buscar('clavubay', { especieId: 1 }))[0]).toMatchObject({
      cn: '570016',
      autorizadoEspecie: false,
    });
    expect((await repo.buscar('clavubay', { especieId: 14 }))[0]).toMatchObject({
      cn: '570016',
      autorizadoEspecie: true,
    });
    expect(r[0]!.autorizadoEspecie).toBeNull();
    expect(await repo.buscar('   ')).toEqual([]);
    // Por principio activo (CLAVUBAY lleva amoxicilina), por debajo de una coincidencia de marca.
    const pa = (await repo.buscar('amoxicilina', { limite: 50 })).find((x) => x.nregistro === '1868 ESP');
    expect(pa?.puntuacion).toBeGreaterThan(0.5);
    expect(pa!.puntuacion).toBeLessThan(1);
    expect(await repo.nregistrosMismosPa('1868 ESP')).toContain('1868 ESP');
    expect(await repo.nregistrosConPa([161])).toContain('1868 ESP');
    expect((await repo.presentacionesDe(['1868 ESP'])).map((p) => p.cn)).toContain('570016');
  });

  it('descarta registros sin CN o sin nº de registro', () => {
    const dic = {
      unidades: new Map(),
      principiosActivos: new Map(),
      laboratorios: new Map(),
      indicaciones: new Map(),
    };
    expect(registroDesdeNomenclator({ cod_nacion: ['1'] }, dic, new Date())).toMatchObject({
      ok: false,
      motivo: 'CN_AUSENTE_O_INVALIDO',
    });
    expect(registroDesdeNomenclator({ cod_nacion: ['123456'] }, dic, new Date())).toMatchObject({
      ok: false,
      motivo: 'NREGISTRO_AUSENTE',
    });
    expect(
      registroDesdeNomenclator({ cod_nacion: ['123456'], nro_definitivo: ['1 ESP'] }, dic, new Date()),
    ).toMatchObject({ ok: false, motivo: 'NOMBRE_AUSENTE' });
    expect(estadoNomenclator('3')).toBe('revocado');
    expect(estadoNomenclator('5')).toBe('suspendido');
    expect(estadoNomenclator(null)).toBe('autorizado');
  });

  it('unidad del principio activo: el código 3 es «µg» aunque el diccionario diga «l» (ADR-15)', () => {
    const dic = {
      unidades: new Map([
        [3, 'l'],
        [4, 'mg'],
      ]),
      principiosActivos: new Map([[1, 'LEVOTIROXINA SODICA']]),
      laboratorios: new Map(),
      indicaciones: new Map(),
    };
    const nodo = {
      cod_nacion: ['999995'],
      nro_definitivo: ['9999 ESP'],
      nombre_med: ['MEDICAMENTO DE PRUEBA 400 microgramos COMPRIMIDOS'],
      formafarmaceutica: [
        {
          principiosactivos: [
            { cod_principio_activo: ['1'], cantidad: ['400'], cod_unidad_cantidad: ['3'] },
            { cod_principio_activo: ['1'], cantidad: ['5'], cod_unidad_cantidad: ['4'] },
          ],
        },
      ],
    };
    const r = registroDesdeNomenclator(nodo as never, dic as never, new Date());
    expect(r.ok && r.registro.principiosActivos?.map((p) => p.unidadRaw)).toEqual(['µg', 'mg']);
  });

  it('conversión de tiempos de espera a días (conservadora)', () => {
    expect(diasEspera('28', 'Días')).toBe(28);
    expect(diasEspera('36', 'Horas')).toBe(2);
    expect(diasEspera('2', 'Semanas')).toBe(14);
    expect(diasEspera('1', 'Meses')).toBe(31);
    expect(diasEspera('100', 'Grados-día')).toBeNull();
    expect(diasEspera(null, 'Días')).toBeNull();
    expect(diasEspera('x', 'Días')).toBeNull();
  });
});

describe('jobs de sincronización', () => {
  it('cimavet-delta: actualiza los cambiados conservando la composición del Nomenclátor y marca las bajas', async () => {
    let fecha: string | null = null;
    server.use(
      http.get(`${BASE}registroCambios`, ({ request }) => {
        fecha = new URL(request.url).searchParams.get('fecha');
        return HttpResponse.json(
          registroCambiosApi([
            { nregistro: '1868 ESP', fecha: '2026-10-13', tipoCambio: 3, cambio: ['comerc'] },
            { nregistro: '1077 ESP', fecha: '2026-10-13', tipoCambio: 2 },
          ]),
        );
      }),
      http.get(`${BASE}medicamento`, ({ request }) => {
        const n = new URL(request.url).searchParams.get('nregistro');
        return n === '1868 ESP' ? HttpResponse.json(med1868) : new HttpResponse(null, { status: 404 });
      }),
    );
    const r = await jobCimavetDelta({ client, repo, now: () => new Date('2026-10-14T04:30:00Z') });
    expect(r).toMatchObject({ cambios: 2, actualizados: 1, bajas: 1, errores: 0 });
    expect(fecha).toMatch(/^\d{2}\/\d{2}\/2026$/);
    const m = await repo.medicamento('1868 ESP');
    expect(m?.composicion.porUnidad).toBe('Comprimido'); // no se pierde la base de la composición
    expect(m?.source).toBe('api');
    const baja = await repo.medicamento('1077 ESP');
    expect(baja?.estado).toBe('revocado');
  });

  it('cimavet-delta: un fallo en un medicamento no detiene el resto y queda registrado', async () => {
    server.use(
      http.get(`${BASE}registroCambios`, () =>
        HttpResponse.json(
          registroCambiosApi([{ nregistro: '1868 ESP', fecha: '2026-10-14', tipoCambio: 3 }]),
        ),
      ),
      http.get(`${BASE}medicamento`, () => new HttpResponse(null, { status: 500 })),
    );
    const r = await jobCimavetDelta({
      client,
      repo,
      now: () => new Date('2026-10-15T04:30:00Z'),
      log: () => {},
    });
    expect(r.errores).toBe(1);
  });

  it('cimavet-delta: si registroCambios falla, el job falla y se registra el error', async () => {
    server.use(http.get(`${BASE}registroCambios`, () => new HttpResponse(null, { status: 500 })));
    await expect(
      jobCimavetDelta({ client, repo, now: () => new Date('2026-10-16T04:30:00Z') }),
    ).rejects.toThrow();
    // Se busca la ejecución fallida (las demás pruebas registran ejecuciones con la fecha real).
    const fallida = (await repo.ultimasSync(50)).find((x) => x.error);
    expect(fallida?.error).toMatch(/HTTP 500/);
  });

  it('cimavet-full: reimporta maestras y refresca los registros con más de 7 días', async () => {
    const especies = await maestraEspeciesApi([1, 14, 15]);
    let medicamentos = 0;
    server.use(
      http.get(`${BASE}maestras`, ({ request }) => {
        const u = new URL(request.url);
        return HttpResponse.json(
          u.searchParams.get('maestra') === '7' && u.searchParams.get('pagina') === '1'
            ? especies
            : listaApi([], 2),
        );
      }),
      http.get(`${BASE}medicamento`, () => {
        medicamentos++;
        return new HttpResponse(null, { status: 404 });
      }),
    );
    const r = await jobCimavetFull({ client, repo, now: () => new Date('2026-11-30T02:00:00Z'), limite: 5 });
    expect(r).toMatchObject({ maestras: 3, refrescados: 0, noEncontrados: 5, errores: 0 });
    expect(medicamentos).toBe(5);
  });

  it('cimavet-full con Nomenclátor nuevo usa el importador', async () => {
    const r = await jobCimavetFull({ client, repo, nomenclatorPath: MUESTRA });
    expect(r).toMatchObject({ leidos: N });
  });

  it('verificación en vivo: suministro desconocido → consulta aunque la caché sea reciente; antigua y CIMAVet caído → aviso con la fecha de la caché', async () => {
    // Del Nomenclátor: sin `psum` → se consulta CIMAVet aunque la caché sea reciente.
    expect((await repo.medicamento('1868 ESP'))?.psum).toBeNull();
    server.use(
      http.get(`${BASE}medicamento`, () => HttpResponse.json({ ...med1868, psum: true })),
      http.get(`${BASE}notas/:n`, () => HttpResponse.json([])),
    );
    expect(await verificarEnVivo({ client, repo, now: () => new Date() }, '1868 ESP', 24)).toEqual({
      actualizado: true,
      cacheDesde: null,
    });
    expect((await repo.medicamento('1868 ESP'))?.psum).toBe(true);
    // Ya conocido y reciente: sin llamada.
    server.use(http.get(`${BASE}medicamento`, () => HttpResponse.error()));
    const reciente = await verificarEnVivo({ client, repo, now: () => new Date() }, '1868 ESP', 24);
    expect(reciente).toEqual({ actualizado: false, cacheDesde: null });
    const caido = await verificarEnVivo(
      { client, repo, now: () => new Date(Date.now() + 48 * 3600 * 1000), log: () => {} },
      '1868 ESP',
      24,
    );
    expect(caido.actualizado).toBe(false);
    expect(caido.cacheDesde).toBeInstanceOf(Date);
    server.use(
      http.get(`${BASE}medicamento`, () => HttpResponse.json(med1868)),
      http.get(`${BASE}notas/:n`, () => HttpResponse.json([])),
    );
    const ok = await verificarEnVivo(
      { client, repo, now: () => new Date(Date.now() + 48 * 3600 * 1000) },
      '1868 ESP',
      24,
    );
    expect(ok).toEqual({ actualizado: true, cacheDesde: null });
  });

  it('especiePorTexto descarta IDs sintéticos o negativos (id <= 0) ante duplicados y devuelve el canónico positivo (FR-013)', async () => {
    await h.db
      .insert(cimavetMaestra)
      .values([
        {
          tipo: MAESTRA.ESPECIES,
          clave: '-29',
          id: -29,
          codigo: '-29',
          nombre: 'Perros',
        },
      ])
      .onConflictDoNothing();

    const idSingular = await repo.especiePorTexto('perro');
    expect(idSingular).toBe(14);

    const idPlural = await repo.especiePorTexto('perros');
    expect(idPlural).toBe(14);
  });
});
