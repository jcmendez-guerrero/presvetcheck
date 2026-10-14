import { resolve } from 'node:path';
import { CimavetClient, CimavetRepository, verificarEnVivo } from '@mmx/cimavet';
import { ColumnCipher, createDb, type DbHandle } from '@mmx/db';
import { hoy, type Clock } from '@mmx/domain';
import { Temporal } from '@js-temporal/polyfill';
import { crearExtractor } from '@mmx/extraction';
import type { AppConfig } from '@mmx/shared';
import { findUp, loadRules } from '@mmx/shared/node';
import {
  BandejaSiweb,
  OutboxService,
  SiwebClient,
  SkuReservas,
  StockService,
  VariantResolver,
  crearCatalogWriter,
  resolverAlmacen,
} from '@mmx/siweb';
import { politica, type AppDeps } from './deps';
import { AzureBlobStore } from './puertos/blob';
import { DemoStockPort, SiwebStockPort } from './puertos/stock';
import { procedimientoVigente } from './servicios/sustituciones';

export const relojSistema: Clock = { now: () => Temporal.Now.instant() };

/** Lee un secreto de Key Vault con identidad gestionada (sin claves en la configuración). */
async function secretoKeyVault(url: string, nombre: string): Promise<string> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const cred = new DefaultAzureCredential();
  const token = await cred.getToken('https://vault.azure.net/.default');
  const res = await fetch(`${url.replace(/\/$/, '')}/secrets/${nombre}?api-version=7.4`, { headers: { Authorization: `Bearer ${token?.token}` } });
  if (!res.ok) throw new Error(`No se pudo leer el secreto ${nombre} de Key Vault (${res.status})`);
  return ((await res.json()) as { value: string }).value;
}

/**
 * Construye las dependencias reales desde la configuración y comprueba los requisitos de arranque
 * en producción: almacén "Farmacia" único (D-12) y procedimiento de sustitución aprobado (D-01).
 */
export async function crearDeps(config: AppConfig, log: (m: string) => void): Promise<{ deps: AppDeps; handle: DbHandle }> {
  const prod = config.NODE_ENV === 'production';
  const handle = await createDb(config.DATABASE_URL);
  const db = handle.db;
  const rules = loadRules();
  const clock = relojSistema;
  const claveCifrado = config.COLUMN_ENCRYPTION_KEY ?? (config.KEY_VAULT_URL ? await secretoKeyVault(config.KEY_VAULT_URL, 'column-encryption-key') : undefined);
  if (!claveCifrado) throw new Error('Falta la clave de cifrado de columnas (COLUMN_ENCRYPTION_KEY o Key Vault)');
  const cimavet = new CimavetRepository(db);
  const client = new CimavetClient({ baseUrl: config.CIMAVET_BASE_URL, rps: config.CIMAVET_RPS });

  const tokenSiweb = config.SIWEB_TOKEN ?? (config.KEY_VAULT_URL ? await secretoKeyVault(config.KEY_VAULT_URL, 'siweb-token').catch(() => undefined) : undefined);
  let siweb: AppDeps['siweb'] = null;
  let stock: AppDeps['stock'];
  const deps0 = { config, rules: { bundle: rules.bundle, files: rules.files } };
  if (tokenSiweb) {
    const sc = new SiwebClient({ baseUrl: config.SIWEB_BASE_URL, token: tokenSiweb });
    let almacen: number | null = null;
    const almacenId = async () => (almacen ??= (await resolverAlmacen(sc, { nombre: config.SIWEB_WAREHOUSE_NAME, id: config.SIWEB_WAREHOUSE_ID })).id);
    if (prod) await almacenId(); // En producción la app no arranca sin almacén "Farmacia" único.
    const resolver = new VariantResolver(db, sc, config.SIWEB_SKU_CN_REGEX);
    const reservas = new SkuReservas(db, sc);
    siweb = {
      resolver,
      bandeja: new BandejaSiweb(db, sc, resolver),
      catalogo: crearCatalogWriter({ catalogWrite: config.SIWEB_CATALOG_WRITE }, db, reservas),
      outbox: new OutboxService(db, sc, { modo: config.SIWEB_STOCK_WRITE_MODE, almacenId }),
      stockActual: (id) => sc.stock(id),
    };
    stock = new SiwebStockPort(resolver, new StockService(sc, almacenId), () => politica(deps0));
  } else {
    if (prod) throw new Error('Falta el token de Siweb360 en producción');
    const demo = findUp('fixtures/siweb/demo-stock.json', process.cwd());
    if (!demo) throw new Error('Sin token de Siweb360 y sin stock de demostración');
    stock = new DemoStockPort(demo);
    log('Siweb360 sin token: se usa el stock SINTÉTICO de fixtures/siweb/demo-stock.json');
  }

  if (prod && config.SUBSTITUTION_APPROVAL_MODE === 'POST') {
    const p = await procedimientoVigente({ db });
    if (!p || p.soloDesarrollo) throw new Error('Modo POST sin procedimiento de sustitución aprobado cargado (D-01): la app no arranca');
  }

  const fixturesRecetas = findUp('fixtures/recetas', process.cwd()) ?? resolve('fixtures/recetas');
  const deps: AppDeps = {
    config,
    db,
    clock,
    rules,
    cimavet,
    verificarEnVivo: (nregistro) => verificarEnVivo({ client, repo: cimavet }, nregistro, config.CIMAVET_LIVE_CHECK_MAX_AGE_H),
    stock,
    siweb,
    extractor: await crearExtractor(config, { fixturesDir: fixturesRecetas, hoy: () => hoy(clock) }),
    blob: await AzureBlobStore.crear({ connectionString: config.BLOB_CONNECTION_STRING, accountUrl: config.BLOB_ACCOUNT_URL }),
    cipher: new ColumnCipher(claveCifrado),
    telefonoFarmacia: process.env.FARMACIA_TELEFONO ?? '(teléfono de la farmacia)',
    nombreFarmacia: 'Mundo Mascotix · Medicamentos Veterinarios',
  };
  return { deps, handle };
}
