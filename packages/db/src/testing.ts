import { resolve } from 'node:path';
import { findUp, loadRules } from '@mmx/shared/node';
import { createDb, runMigrations, type DbHandle } from './client';
import { seed } from './seed';
import { MAESTRA } from './schema';

/** BD en memoria (PGlite) con migraciones aplicadas. Para tests sin Docker. */
export async function createTestDb(opts: { seed?: boolean } = {}): Promise<DbHandle> {
  const handle = await createDb('pglite://memory');
  await runMigrations(handle);
  if (opts.seed) {
    const fixtures = findUp('fixtures/nomenclator', process.cwd());
    if (!fixtures) throw new Error('No se encuentra fixtures/nomenclator');
    const rules = loadRules();
    // En tests solo los diccionarios pequeños para ir rápido.
    const { importarMaestras } = await import('./seed/maestras');
    await seed(handle.db, { fixturesDir: resolve('/nonexistent'), rules, demo: true });
    await importarMaestras(handle.db, resolve(fixtures), {
      solo: [MAESTRA.FORMAS, MAESTRA.VIAS, MAESTRA.ESPECIES, MAESTRA.UNIDADES, MAESTRA.SITUACION_REGISTRO],
    });
  }
  return handle;
}
