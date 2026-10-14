import { describe, expect, it } from 'vitest';
import { loadConfig } from '@mmx/shared';
import { buildApp } from '../src/app';

describe('sondas', () => {
  it('GET /api/health responde ok', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'x', BLOB_CONNECTION_STRING: 'x', AUTH_MODE: 'dev' });
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
