import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { findUp } from '@mmx/shared/node';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Schema = typeof schema;
/** Base de datos Drizzle independiente del driver (postgres-js en local/Azure, PGlite en tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/** Filas de `db.execute`: postgres-js devuelve un array; PGlite, `{ rows }`. */
export function filas<T>(r: unknown): T[] {
  return (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
}

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

const migracionesJunto = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
/** Carpeta de migraciones: junto al código fuente o, en la imagen empaquetada, buscada desde el cwd. */
export const MIGRATIONS_DIR = existsSync(migracionesJunto)
  ? migracionesJunto
  : (findUp('packages/db/migrations', process.cwd()) ?? migracionesJunto);

/**
 * Crea la conexión. `pglite://memory` o `pglite://<directorio>` usan PGlite (PostgreSQL en
 * WASM, sin Docker) para tests y demos; cualquier otra URL usa postgres-js.
 */
export async function createDb(
  url: string,
  opts: { max?: number; password?: () => Promise<string> } = {},
): Promise<DbHandle> {
  if (url.startsWith('pglite://')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    const { drizzle } = await import('drizzle-orm/pglite');
    const target = url.slice('pglite://'.length);
    const client = await PGlite.create(
      target === 'memory' ? { extensions: { pg_trgm } } : { dataDir: target, extensions: { pg_trgm } },
    );
    const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    return { db, kind: 'pglite', close: () => client.close() };
  }
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  // Con `password` (token de Entra de la identidad gestionada) cada conexión pide un token vigente.
  const client = postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    ...(opts.password ? { password: opts.password } : {}),
  });
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  return { db, kind: 'postgres', close: () => client.end() };
}

export async function runMigrations(handle: DbHandle): Promise<void> {
  if (handle.kind === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_DIR });
  }
}
