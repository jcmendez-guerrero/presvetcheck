import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CimavetClient, CimavetRepository, jobNomenclatorImport, verificarEnVivo } from '@mmx/cimavet';
import { ColumnCipher, createDb, runMigrations, seed, importarMaestras, MAESTRA, type DbHandle } from '@mmx/db';
import { hoy, type Clock } from '@mmx/domain';
import { Temporal } from '@js-temporal/polyfill';
import { crearExtractor, crearLectorAlbaranes } from '@mmx/extraction';
import { IndiceFuentes, ToolRegistry, crearHerramientas, crearModeloAsistente } from '@mmx/assistant';
import type { AppConfig } from '@mmx/shared';
import { findUp, loadRules, secretoKeyVault, tokenPostgresEntra } from '@mmx/shared/node';
import {
  IndiceCatalogo,
  BandejaSiweb,
  DemoSalesMovementsSource,
  NotConfiguredSalesMovementsSource,
  OutboxService,
  SiwebClient,
  SkuReservas,
  StockService,
  TicketsSalesMovementsSource,
  VariantResolver,
  crearCatalogWriter,
  resolverAlmacen,
} from '@mmx/siweb';
import { politica, type AppDeps } from './deps';
import { AcsMailer, AzureBlobStore, ConsoleMailer, MemoryBlobStore, SmtpMailer, type Mailer } from '@mmx/reports';
import { DemoStockPort, SiwebStockPort } from './puertos/stock';
import { procedimientoVigente } from './servicios/sustituciones';
import { ContextoLineaService, type DepsContexto } from './servicios/asistente-contexto';

export const relojSistema: Clock = { now: () => Temporal.Now.instant() };

/**
 * Construye las dependencias reales desde la configuración y comprueba los requisitos de arranque
 * en producción: almacén "Farmacia" único (D-12) y procedimiento de sustitución aprobado (D-01).
 */
export async function crearDeps(config: AppConfig, log: (m: string) => void): Promise<{ deps: AppDeps; handle: DbHandle }> {
  const prod = config.NODE_ENV === 'production';
  const handle = await createDb(config.DATABASE_URL, config.DATABASE_AUTH === 'entra' ? { password: tokenPostgresEntra() } : {});
  const db = handle.db;
  const rules = loadRules();
  if (process.env.DEV_BOOTSTRAP === '1') {
    if (prod) throw new Error('DEV_BOOTSTRAP no se admite en producción');
    await arranqueDesarrollo(handle, rules, log);
  }
  const clock = relojSistema;
  const claveCifrado = config.COLUMN_ENCRYPTION_KEY ?? (config.KEY_VAULT_URL ? await secretoKeyVault(config.KEY_VAULT_URL, config.KV_SECRETO_CIFRADO) : undefined);
  if (!claveCifrado) throw new Error('Falta la clave de cifrado de columnas (COLUMN_ENCRYPTION_KEY o Key Vault)');
  const cimavet = new CimavetRepository(db);
  const client = new CimavetClient({ baseUrl: config.CIMAVET_BASE_URL, rps: config.CIMAVET_RPS });

  const tokenSiweb = config.SIWEB_TOKEN ?? (config.KEY_VAULT_URL ? await secretoKeyVault(config.KEY_VAULT_URL, config.KV_SECRETO_SIWEB_TOKEN).catch(() => undefined) : undefined);
  let siweb: AppDeps['siweb'] = null;
  let stock: AppDeps['stock'];
  let ventas: AppDeps['ventas'] = new NotConfiguredSalesMovementsSource();
  const deps0 = { config, rules: { bundle: rules.bundle, files: rules.files } };
  if (tokenSiweb) {
    const sc = new SiwebClient({ baseUrl: config.SIWEB_BASE_URL, token: tokenSiweb });
    let almacen: number | null = null;
    const almacenId = async () => (almacen ??= (await resolverAlmacen(sc, { nombre: config.SIWEB_WAREHOUSE_NAME, id: config.SIWEB_WAREHOUSE_ID })).id);
    if (prod) await almacenId(); // En producción la app no arranca sin almacén "Farmacia" único.
    // Índice del catálogo por CN: se carga al arrancar (en segundo plano) y se refresca cada 15 min.
    const indice = new IndiceCatalogo(sc, config.SIWEB_SKU_CN_REGEX, { log: (m, d) => log(`${m} ${JSON.stringify(d ?? {})}`) });
    indice.precargar();
    const resolver = new VariantResolver(db, sc, config.SIWEB_SKU_CN_REGEX, indice);
    const reservas = new SkuReservas(db, sc);
    siweb = {
      resolver,
      bandeja: new BandejaSiweb(db, sc, resolver),
      catalogo: crearCatalogWriter({ catalogWrite: config.SIWEB_CATALOG_WRITE }, db, reservas),
      outbox: new OutboxService(db, sc, { modo: config.SIWEB_STOCK_WRITE_MODE, almacenId }),
      stockActual: (id) => sc.stock(id),
      proveedores: async () => (await sc.proveedores()).map((c) => c.nombre_empresa?.trim() ?? '').filter(Boolean),
    };
    stock = new SiwebStockPort(resolver, new StockService(sc, almacenId), () => politica(deps0));
    // TODO(decision D-02b): validar con tickets reales que las líneas llevan el CN en el nombre.
    if (config.SIWEB_SALES_SOURCE === 'tickets') ventas = new TicketsSalesMovementsSource(sc, config.SIWEB_TICKET_CN_REGEX);
  } else {
    if (prod) throw new Error('Falta el token de Siweb360 en producción');
    const demo = findUp('fixtures/siweb/demo-stock.json', process.cwd());
    if (!demo) throw new Error('Sin token de Siweb360 y sin stock de demostración');
    stock = new DemoStockPort(demo);
    ventas = new DemoSalesMovementsSource(db);
    log('Siweb360 sin token: se usa el stock SINTÉTICO de fixtures/siweb/demo-stock.json');
  }

  if (prod && config.SUBSTITUTION_APPROVAL_MODE === 'POST') {
    const p = await procedimientoVigente({ db });
    if (!p || p.soloDesarrollo) throw new Error('Modo POST sin procedimiento de sustitución aprobado cargado (D-01): la app no arranca');
  }

  const cipher = new ColumnCipher(claveCifrado);
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
    ventas,
    extractor: await crearExtractor(config, { fixturesDir: fixturesRecetas, hoy: () => hoy(clock) }),
    lectorAlbaranes: await crearLectorAlbaranes(config, { fixturesDir: resolve(fixturesRecetas, '..') }),
    blob:
      !prod && config.BLOB_CONNECTION_STRING === 'memory'
        ? new MemoryBlobStore()
        : await AzureBlobStore.crear({ connectionString: config.BLOB_CONNECTION_STRING, accountUrl: config.BLOB_ACCOUNT_URL }),
    cipher,
    telefonoFarmacia: config.FARMACIA_TELEFONO,
    nombreFarmacia: 'Mundo Mascotix · Medicamentos Veterinarios',
    asistente: await crearAsistente(config, { db, cipher, cimavet, rules: { bundle: rules.bundle, files: rules.files }, clock, log }, await crearMailer(config, log)),
  };
  return { deps, handle };
}

/** Correo para los avisos a administración (mismo criterio que el worker: SMTP, ACS o consola). */
async function crearMailer(config: AppConfig, log: (m: string) => void): Promise<Mailer> {
  if (config.MAILER === 'smtp') {
    const password = config.SMTP_PASSWORD ?? (config.KEY_VAULT_URL ? await secretoKeyVault(config.KEY_VAULT_URL, config.KV_SECRETO_SMTP).catch(() => undefined) : undefined);
    return new SmtpMailer({ host: config.SMTP_HOST as string, port: config.SMTP_PORT, user: config.SMTP_USER, password, from: config.SMTP_FROM as string });
  }
  if (config.MAILER === 'acs') return new AcsMailer({ endpoint: config.ACS_ENDPOINT as string, remitente: config.ACS_SENDER as string });
  return new ConsoleMailer((m) => log(m));
}

/**
 * Asistente de consultas: modelo según ASSISTANT, índice de la guía y la Ayuda, y herramientas de solo lectura.
 * Con ASSISTANT=off no se carga nada.
 */
async function crearAsistente(
  config: AppConfig,
  d: DepsContexto & { clock: Clock; log: (m: string) => void },
  mailer: Mailer | null,
): Promise<AppDeps['asistente']> {
  const clave =
    config.ASSISTANT === 'gemini'
      ? (config.ASSISTANT_API_KEY ??
        (config.KEY_VAULT_URL
          ? await secretoKeyVault(config.KEY_VAULT_URL, config.KV_SECRETO_ASISTENTE).catch(() => undefined)
          : undefined))
      : undefined;
  const modelo = await crearModeloAsistente(config, clave ? { getToken: async () => clave } : {});
  if (!modelo) return { modelo: null, herramientas: new ToolRegistry(), fuentes: null, mailer: null };
  const ruta = findUp('docs/ref/guia-receta-veterinaria.md', process.cwd());
  if (!ruta) d.log('Asistente: no se encuentra docs/ref/guia-receta-veterinaria.md; solo responderá con la Ayuda y las reglas');
  const indice = new IndiceFuentes(ruta ? readFileSync(ruta, 'utf8') : null);
  const contexto = new ContextoLineaService(d);
  const herramientas = crearHerramientas({
    rules: d.rules.bundle,
    clock: d.clock,
    indice,
    cimavet: d.cimavet,
    permitirCambioFormato: config.ALLOW_PACK_SIZE_CHANGE,
    maxEdadCimavetH: config.CIMAVET_LIVE_CHECK_MAX_AGE_H,
    cargarContextoLinea: (id) => contexto.cargar(id),
  });
  return { modelo, herramientas, fuentes: indice, mailer, existeLinea: (id) => contexto.existe(id), cargarLinea: (id) => contexto.cargar(id), conocidosLinea: (id) => contexto.conocidos(id) };
}

/**
 * Solo desarrollo y test de humo (DEV_BOOTSTRAP=1): migraciones, seed de maestros y muestra real del
 * Nomenclátor si la caché está vacía. Permite arrancar con DATABASE_URL=pglite://memory sin Docker.
 */
async function arranqueDesarrollo(handle: DbHandle, rules: ReturnType<typeof loadRules>, log: (m: string) => void) {
  await runMigrations(handle);
  const repo = new CimavetRepository(handle.db);
  if ((await repo.buscar('clavubay')).length) return;
  const fixtures = findUp('fixtures/nomenclator', process.cwd());
  if (!fixtures) throw new Error('No se encuentra fixtures/nomenclator');
  await seed(handle.db, { fixturesDir: resolve('/nonexistent'), rules, demo: true });
  await importarMaestras(handle.db, fixtures, {
    solo: [MAESTRA.FORMAS, MAESTRA.VIAS, MAESTRA.ESPECIES, MAESTRA.UNIDADES, MAESTRA.SITUACION_REGISTRO, MAESTRA.LABORATORIOS, MAESTRA.INDICACIONES, MAESTRA.PRINCIPIOS_ACTIVOS],
  });
  // DEV_NOMENCLATOR=completo (lo usa `pnpm demo`): el Nomenclátor entero (~14.000 presentaciones, ~20 s) para
  // poder identificar medicamentos de recetas reales; por defecto, la muestra de los tests.
  const completo = process.env.DEV_NOMENCLATOR === 'completo' && existsSync(resolve(fixtures, 'PrescripcionVET.xml'));
  const informe = await jobNomenclatorImport({ repo, path: resolve(fixtures, completo ? 'PrescripcionVET.xml' : 'PrescripcionVET.sample.xml') });
  log(`DEV_BOOTSTRAP: ${completo ? 'Nomenclátor completo' : 'muestra del Nomenclátor'} cargado (${informe.nuevos} presentaciones)`);
}
