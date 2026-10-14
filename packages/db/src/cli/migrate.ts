import { loadConfigFromProcess } from '@mmx/shared/node';
import { createDb, runMigrations } from '../client';

const config = loadConfigFromProcess();
const handle = await createDb(config.DATABASE_URL, { max: 1 });
await runMigrations(handle);
await handle.close();
console.log('Migraciones aplicadas');
