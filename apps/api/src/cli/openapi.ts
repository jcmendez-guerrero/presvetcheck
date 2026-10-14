/** Genera apps/api/openapi.json a partir de las rutas (OpenAPI generado, SPEC §7). */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '@mmx/shared';
import { buildApp } from '../app';
import type { AppDeps } from '../deps';

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'pglite://memory', BLOB_CONNECTION_STRING: 'x', AUTH_MODE: 'dev' });
const deps = { config, extractor: { proveedor: 'fake' }, stock: { tipo: 'demo' }, rules: { bundle: { version: '' } } } as unknown as AppDeps;
const app = await buildApp({ deps, logger: false });
await app.ready();
writeFileSync(resolve(import.meta.dirname, '../../openapi.json'), `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log('openapi.json generado');
