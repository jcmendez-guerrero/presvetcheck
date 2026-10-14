import { resolve } from 'node:path';
import { findUp, loadConfigFromProcess, loadRules } from '@mmx/shared/node';
import { createDb } from '../client';
import { seed } from '../seed';

const config = loadConfigFromProcess();
const fixturesDir = findUp('fixtures/nomenclator', process.cwd());
if (!fixturesDir) throw new Error('No se encuentra fixtures/nomenclator');
const handle = await createDb(config.DATABASE_URL, { max: 1 });
const res = await seed(handle.db, {
  fixturesDir: resolve(fixturesDir),
  rules: loadRules(),
  demo: config.NODE_ENV !== 'production',
});
await handle.close();
console.log('Seed completado', res.maestras);
