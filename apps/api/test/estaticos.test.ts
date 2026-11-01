import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, entorno, type Entorno } from './entorno';

// La SPA se sirve desde la misma API (SPEC §1.1). Ninguna ruta puede entregar un fichero fuera de la carpeta pública
// (alertas de @fastify/static: rutas con «..», separadores codificados y rutas no canónicas).
const SECRETO = 'CONTENIDO-QUE-NUNCA-DEBE-SALIR';

describe('SPA estática desde la API', () => {
  let E: Entorno;
  let base: string;
  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'mmx-web-'));
    const web = join(base, 'web');
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>SPA</title>');
    writeFileSync(join(web, 'assets', 'app.js'), 'console.info("app")');
    writeFileSync(join(base, 'secreto.txt'), SECRETO);
    E = await entorno({ config: { WEB_DIST_DIR: web } });
  });
  afterAll(async () => {
    await E.app.close();
    rmSync(base, { recursive: true, force: true });
  });

  const get = (url: string) => E.app.inject({ method: 'GET', url });

  it('sirve los ficheros de la carpeta pública', async () => {
    const r = await get('/assets/app.js');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('console.info');
  });

  it('una ruta de la SPA devuelve index.html', async () => {
    const r = await get('/recetas/123');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<title>SPA</title>');
  });

  it('una ruta /api/ desconocida devuelve 404 NO_ENCONTRADO', async () => {
    const r = await api(E.app, 'dev-empleado', 'GET', '/api/no-existe');
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: { code: 'NO_ENCONTRADO' } });
  });

  it.each([
    '/../secreto.txt',
    '/assets/../../secreto.txt',
    '/%2e%2e/secreto.txt',
    '/%2e%2e%2fsecreto.txt',
    '/assets%2f..%2f..%2fsecreto.txt',
    '/assets/%2e%2e/%2e%2e/secreto.txt',
    '/assets/..%5c..%5csecreto.txt',
    '//secreto.txt',
    '/%2fsecreto.txt',
  ])('no entrega ficheros fuera de la carpeta pública: %s', async (url) => {
    const r = await get(url);
    expect(r.body).not.toContain(SECRETO);
  });

  it('no ofrece listados de directorio', async () => {
    const r = await get('/assets/');
    expect(r.body).not.toContain('app.js');
  });
});
