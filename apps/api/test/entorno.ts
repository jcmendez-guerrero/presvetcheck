import { DemoSalesMovementsSource } from '@mmx/siweb';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { CimavetRepository, jobNomenclatorImport, type RegistroCache } from '@mmx/cimavet';
import { ColumnCipher, importarMaestras, MAESTRA, type DbHandle } from '@mmx/db';
import { createTestDb } from '@mmx/db/testing';
import { fixedClock, hoy, type LoteStock } from '@mmx/domain';
import { FakeRecipeExtractor } from '@mmx/extraction';
import { loadConfig, normalizeText, type RecetaConfirmadaInput } from '@mmx/shared';
import { loadRules } from '@mmx/shared/node';
import { buildApp } from '../src/app';
import type { AppDeps } from '../src/deps';
import { MemoryBlobStore } from '@mmx/reports';
import type { StockPort } from '../src/puertos/stock';

export const ROOT = resolve(__dirname, '../../..');
export const CLOCK = fixedClock('2026-10-14T10:00:00Z');

/** Stock en memoria configurable por test. */
export class MapStockPort implements StockPort {
  readonly tipo = 'demo' as const;
  noDisponible = new Set<string>();
  constructor(public datos: Record<string, Partial<LoteStock>[]> = {}) {}
  async lotes(cn: string) {
    if (this.noDisponible.has(cn)) return { estado: 'NO_DISPONIBLE' as const, lotes: [], avisos: [] };
    return {
      estado: 'OK' as const,
      lotes: (this.datos[cn] ?? []).map((l, i) => ({ lote: `L${i}`, caducidad: '2027-06-30', disponible: 5, creadoAt: '2026-01-01T00:00:00Z', variantId: 1, ...l })),
      avisos: [],
    };
  }
}

export interface Entorno {
  app: FastifyInstance;
  deps: AppDeps;
  h: DbHandle;
  stock: MapStockPort;
}

let compartido: { h: DbHandle } | null = null;

/** BD con maestros y la muestra real del Nomenclátor (una vez por fichero de test). */
export async function bd(): Promise<DbHandle> {
  if (compartido) return compartido.h;
  const h = await createTestDb({ seed: true });
  await importarMaestras(h.db, resolve(ROOT, 'fixtures/nomenclator'), { solo: [MAESTRA.PRINCIPIOS_ACTIVOS, MAESTRA.LABORATORIOS, MAESTRA.INDICACIONES] });
  const repo = new CimavetRepository(h.db);
  await jobNomenclatorImport({ repo, path: resolve(ROOT, 'fixtures/nomenclator/PrescripcionVET.sample.xml'), now: () => new Date('2026-10-14T06:00:00Z') });
  await insertarGenericoClavubay(repo);
  compartido = { h };
  return h;
}

/**
 * Medicamento SINTÉTICO equivalente a CLAVUBAY (misma composición, forma, vía, especie e
 * indicaciones) de otro laboratorio, para probar el flujo de sustitución.
 */
async function insertarGenericoClavubay(repo: CimavetRepository) {
  const m = (await repo.medicamento('1868 ESP'))!;
  const nombre = 'GENERICLAV 400 mg / 100 mg COMPRIMIDOS (SINTÉTICO DE PRUEBA)';
  const reg: RegistroCache = {
    medicamento: {
      nregistro: '9999 TEST',
      nombre,
      nombreNorm: normalizeText(nombre),
      labtitular: 'LABORATORIO DE PRUEBA',
      receta: true,
      antibiotico: true,
      estupefaciente: false,
      psicotropo: false,
      formaId: m.formaId,
      estadoCodigo: 'autorizado',
      comerc: true,
      cantidadConcentracion: m.composicion.porCantidad,
      unidadConcentracion: m.composicion.porUnidad,
      source: 'nomenclator',
      fetchedAt: new Date('2026-10-14T06:00:00Z'),
    },
    presentaciones: [{ cn: '999901', nregistro: '9999 TEST', nombre: `${nombre}, 10 comprimidos`, nombreNorm: normalizeText(nombre), comerc: true, estadoCodigo: 'autorizado', contenido: '10', unidadContenido: 'Comprimido', source: 'nomenclator', fetchedAt: new Date('2026-10-14T06:00:00Z') }],
    principiosActivos: m.composicion.pas.map((p, i) => ({ orden: i + 1, paId: p.paId, nombre: p.nombre, cantidadRaw: p.cantidad, cantidadValor: null, unidadRaw: p.unidad, unidadCanonica: null, normalizable: true })),
    especies: m.especieIds,
    vias: m.viaIds,
    atc: m.atc,
    indicaciones: m.indicaciones.map((x, i) => ({ indicacionId: 100000 + i, nombre: x.texto, especieId: x.especieId })),
    tiemposEspera: [],
  };
  await repo.upsert([reg]);
}

export async function entorno(o: { config?: Record<string, string>; stock?: Record<string, Partial<LoteStock>[]> } = {}): Promise<Entorno> {
  const h = await bd();
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'pglite://memory', BLOB_CONNECTION_STRING: 'x', AUTH_MODE: 'dev', ...o.config });
  const stock = new MapStockPort(o.stock ?? { '570016': [{ lote: 'CLV-2611', caducidad: '2026-11-30', disponible: 2 }, { lote: 'CLV-2705', caducidad: '2027-05-31', disponible: 4 }] });
  const deps: AppDeps = {
    config,
    db: h.db,
    clock: CLOCK,
    rules: loadRules(resolve(ROOT, 'config/rules')),
    cimavet: new CimavetRepository(h.db),
    verificarEnVivo: null,
    stock,
    siweb: null,
    // Tickets simulados (como la demo): POST /api/demo/tpv.
    ventas: new DemoSalesMovementsSource(h.db),
    extractor: new FakeRecipeExtractor({ dir: resolve(ROOT, 'fixtures/recetas'), hoy: () => hoy(CLOCK) }),
    blob: new MemoryBlobStore(),
    cipher: new ColumnCipher(Buffer.alloc(32, 3).toString('base64')),
    telefonoFarmacia: '900 000 000',
    nombreFarmacia: 'Mundo Mascotix',
  };
  const app = await buildApp({ deps, logger: false });
  return { app, deps, h, stock };
}

type Usuario = 'dev-empleado' | 'dev-veterinaria' | 'dev-admin' | null;

export async function api(app: FastifyInstance, u: Usuario, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, extra: { mfa?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (u) headers['x-dev-user'] = u;
  if (extra.mfa) headers['x-dev-mfa'] = '1';
  const res = await app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.headers['content-type']?.toString().includes('json') ? res.json() : null, res };
}

/** Cuerpo multipart para `inject` (sin dependencias). */
export function multipart(campos: Record<string, string>, ficheros: { nombre: string; mime: string; bytes: Buffer }[]) {
  const b = `----mmx${Math.random().toString(16).slice(2)}`;
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) partes.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of ficheros) {
    partes.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="pagina"; filename="${f.nombre}"\r\nContent-Type: ${f.mime}\r\n\r\n`), f.bytes, Buffer.from('\r\n'));
  }
  partes.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

/** Crea una receta con la fixture indicada y devuelve su id. */
export async function crearReceta(app: FastifyInstance, fixture = 'demo-compania-papel'): Promise<string> {
  const m = multipart({ fixture, phash: 'a1b2c3d4e5f60718' }, [{ nombre: 'r.png', mime: 'image/png', bytes: Buffer.from(`imagen-${Math.random()}`) }]);
  const res = await app.inject({ method: 'POST', url: '/api/recetas', headers: { ...m.headers, 'x-dev-user': 'dev-empleado' }, payload: m.payload });
  if (res.statusCode !== 201) throw new Error(`crearReceta ${res.statusCode}: ${res.body}`);
  return res.json().id;
}

/** Confirma la receta con los datos extraídos y los cambios indicados (como haría la persona). */
export async function confirmar(app: FastifyInstance, id: string, cambios: (r: RecetaConfirmadaInput) => RecetaConfirmadaInput) {
  const g = await api(app, 'dev-empleado', 'GET', `/api/recetas/${id}`);
  const base = g.json.confirmacion as RecetaConfirmadaInput;
  const r = await api(app, 'dev-empleado', 'PUT', `/api/recetas/${id}/confirmacion`, cambios(base));
  if (r.status !== 200) throw new Error(`confirmar ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

/** Receta de compañía completa y correcta: CLAVUBAY 400/100 × 10 (CN 570016) para un perro. */
export const recetaCorrecta = (numero = `R-${Math.random().toString(36).slice(2, 8)}`) => (r: RecetaConfirmadaInput): RecetaConfirmadaInput => ({
  ...r,
  numero,
  firmaConfirmada: true,
  comprobadoConOriginal: true,
  especie: { texto: 'Perro', especieId: 14 },
  indicacion: 'Infección cutánea producida por Staphylococcus',
  lineas: (r.lineas ?? []).map((l) => ({ ...l, cn: '570016', nregistro: '1868 ESP', cantidadEnvases: 1 })),
});
