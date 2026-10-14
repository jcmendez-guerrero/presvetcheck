import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { findUp, loadRules } from '@mmx/shared/node';
import { createDb, runMigrations, type DbHandle } from '../src/client';
import { seed } from '../src/seed';

/** Integración contra PostgreSQL 16 real (Testcontainers). `pnpm test:int`. */
let container: StartedPostgreSqlContainer;
let h: DbHandle;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  h = await createDb(container.getConnectionUri(), { max: 2 });
  await runMigrations(h);
});
afterAll(async () => {
  await h?.close();
  await container?.stop();
});

describe('PostgreSQL 16', () => {
  it('aplica migraciones con pg_trgm, unaccent y pgcrypto', async () => {
    const res = await h.db.execute(sql`select extname from pg_extension order by extname`);
    const names = (res as unknown as Array<{ extname: string }>).map((r) => r.extname);
    expect(names).toEqual(expect.arrayContaining(['pg_trgm', 'unaccent', 'pgcrypto']));
  });

  it('el rol mmx_app no tiene UPDATE ni DELETE en las tablas de registro', async () => {
    const res = await h.db.execute(
      sql`select has_table_privilege('mmx_app', 'dispensacion', 'UPDATE') as upd,
                 has_table_privilege('mmx_app', 'dispensacion', 'DELETE') as del,
                 has_table_privilege('mmx_app', 'dispensacion', 'INSERT') as ins,
                 has_table_privilege('mmx_app', 'audit_event', 'UPDATE') as aupd`,
    );
    expect((res as unknown as Array<Record<string, boolean>>)[0]).toEqual({ upd: false, del: false, ins: true, aupd: false });
  });

  it('siembra todos los diccionarios del Nomenclátor', async () => {
    const fixtures = findUp('fixtures/nomenclator', process.cwd())!;
    const { maestras } = await seed(h.db, { fixturesDir: resolve(fixtures), rules: loadRules(), demo: true });
    expect(maestras['DICCIONARIO_ESPECIES_DESTINO.xml']?.leidos).toBe(371);
    expect(maestras['DICCIONARIO_PRINCIPIOS_ACTIVOS.xml']?.leidos).toBeGreaterThan(1000);
  });
});
