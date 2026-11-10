import { Temporal } from '@js-temporal/polyfill';
import { CimavetClient, CimavetRepository } from '@mmx/cimavet';
import { ColumnCipher, createDb, type Db, type DbHandle } from '@mmx/db';
import type { Clock } from '@mmx/domain';
import { AcsMailer, AzureBlobStore, ConsoleMailer, MemoryBlobStore, SmtpMailer, type BlobStore, type Mailer } from '@mmx/reports';
import type { AppConfig, RulesBundle } from '@mmx/shared';
import { loadRules, secretoKeyVault, tokenPostgresEntra } from '@mmx/shared/node';
import { NotConfiguredSalesMovementsSource,
  TicketsSalesMovementsSource, OutboxService, SiwebClient, StockService, VariantResolver, resolverAlmacen, ultimaPruebaEscritura, type SalesMovementsSource } from '@mmx/siweb';

export type Log = (mensaje: string, datos?: Record<string, unknown>) => void;

/** Dependencias de los jobs (inyectables en tests). */
export interface Contexto {
  config: AppConfig;
  db: Db;
  clock: Clock;
  rules: RulesBundle;
  cipher: ColumnCipher;
  cimavet: { client: CimavetClient; repo: CimavetRepository };
  siweb: {
    client: SiwebClient;
    outbox: OutboxService;
    resolver: VariantResolver;
    stock: StockService;
    almacenId: () => Promise<number>;
  } | null;
  ventas: SalesMovementsSource;
  blob: BlobStore;
  mailer: Mailer;
  log: Log;
}

export const relojSistema: Clock = { now: () => Temporal.Now.instant() };

/** Logs JSON estructurados sin datos personales (SPEC §11). */
export const logJson: Log = (mensaje, datos) => console.error(JSON.stringify({ t: new Date().toISOString(), nivel: 'info', mensaje, ...datos }));

export async function crearContexto(config: AppConfig, log: Log = logJson): Promise<{ ctx: Contexto; handle: DbHandle }> {
  const handle = await createDb(config.DATABASE_URL, { max: 2, ...(config.DATABASE_AUTH === 'entra' ? { password: tokenPostgresEntra() } : {}) });
  const kv = config.KEY_VAULT_URL;
  const clave = config.COLUMN_ENCRYPTION_KEY ?? (kv ? await secretoKeyVault(kv, config.KV_SECRETO_CIFRADO) : undefined);
  if (!clave) throw new Error('Falta la clave de cifrado de columnas');
  const token = config.SIWEB_TOKEN ?? (kv ? await secretoKeyVault(kv, config.KV_SECRETO_SIWEB_TOKEN).catch(() => undefined) : undefined);
  let siweb: Contexto['siweb'] = null;
  if (token) {
    const client = new SiwebClient({ baseUrl: config.SIWEB_BASE_URL, token });
    let almacen: number | null = null;
    const almacenId = async () => (almacen ??= (await resolverAlmacen(client, { nombre: config.SIWEB_WAREHOUSE_NAME, id: config.SIWEB_WAREHOUSE_ID })).id);
    siweb = {
      client,
      outbox: new OutboxService(
        handle.db,
        client,
        { modo: config.SIWEB_STOCK_WRITE_MODE, almacenId, pruebaVigente: () => ultimaPruebaEscritura(handle.db) },
        { log: (m, d) => log(m, d) },
      ),
      resolver: new VariantResolver(handle.db, client, config.SIWEB_SKU_CN_REGEX),
      stock: new StockService(client, almacenId),
      almacenId,
    };
  }
  let mailer: Mailer = new ConsoleMailer((m) => log(m));
  if (config.MAILER === 'smtp') {
    const password = config.SMTP_PASSWORD ?? (kv ? await secretoKeyVault(kv, config.KV_SECRETO_SMTP).catch(() => undefined) : undefined);
    mailer = new SmtpMailer({ host: config.SMTP_HOST as string, port: config.SMTP_PORT, user: config.SMTP_USER, password, from: config.SMTP_FROM as string });
  } else if (config.MAILER === 'acs') mailer = new AcsMailer({ endpoint: config.ACS_ENDPOINT as string, remitente: config.ACS_SENDER as string });
  const blob =
    config.NODE_ENV !== 'production' && config.BLOB_CONNECTION_STRING === 'memory'
      ? new MemoryBlobStore()
      : await AzureBlobStore.crear({ connectionString: config.BLOB_CONNECTION_STRING, accountUrl: config.BLOB_ACCOUNT_URL });
  return {
    handle,
    ctx: {
      config,
      db: handle.db,
      clock: relojSistema,
      rules: loadRules().bundle,
      cipher: new ColumnCipher(clave),
      cimavet: { client: new CimavetClient({ baseUrl: config.CIMAVET_BASE_URL, rps: config.CIMAVET_RPS }), repo: new CimavetRepository(handle.db) },
      siweb,
      // TODO(decision D-02b): validar con tickets reales que las líneas llevan el CN en el nombre.
      ventas:
        siweb && config.SIWEB_SALES_SOURCE === 'tickets'
          ? new TicketsSalesMovementsSource(siweb.client, config.SIWEB_TICKET_CN_REGEX)
          : new NotConfiguredSalesMovementsSource(),
      blob,
      mailer,
      log,
    },
  };
}
