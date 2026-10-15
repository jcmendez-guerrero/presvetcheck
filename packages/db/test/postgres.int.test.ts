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
    // Los recuentos dependen de la versión del Nomenclátor descargada de CIMAVet.
    expect(maestras['DICCIONARIO_ESPECIES_DESTINO.xml']?.leidos).toBeGreaterThan(100);
    expect(maestras['DICCIONARIO_PRINCIPIOS_ACTIVOS.xml']?.leidos).toBeGreaterThan(1000);
  });

  it('retención: mmx_app no puede borrar salidas; la función de purga solo elimina las de más de 5 años', async () => {
    const ins = (creado: string) => sql`insert into dispensacion (id, canal, con_receta, cn, nombre_farmaco, lote, unidades, metodo_captura, empleado, fecha_venta, created_at)
      values (gen_random_uuid(), 'presencial', false, '570016', 'X', 'L', 1, 'manual', 'e', ${creado}::timestamptz, ${creado}::timestamptz) returning id`;
    const filas = (r: unknown) => r as Array<{ id: string }>;
    const viejo = filas(await h.db.execute(ins('2019-01-01T00:00:00Z')))[0]!.id;
    const nuevo = filas(await h.db.execute(ins(new Date().toISOString())))[0]!.id;
    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`set local role mmx_app`);
        await tx.execute(sql`set local mmx.purga_retencion = 'on'`);
        await tx.execute(sql`delete from dispensacion where id = ${viejo}`);
      }),
    ).rejects.toThrow();
    const r = await h.db.transaction(async (tx) => {
      await tx.execute(sql`set local role mmx_app`);
      // Aunque pida "ahora" como límite, la función nunca baja de 5 años.
      return tx.execute(sql`select mmx_purgar_registros(now()) as r`);
    });
    expect((r as unknown as Array<{ r: { dispensaciones: number } }>)[0]!.r.dispensaciones).toBe(1);
    const quedan = filas(await h.db.execute(sql`select id from dispensacion where id in (${viejo}, ${nuevo})`)).map((x) => x.id);
    expect(quedan).toEqual([nuevo]);
  });
});
