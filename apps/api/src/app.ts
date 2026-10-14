import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from '@mmx/shared';

export interface BuildAppOptions {
  config: AppConfig;
}

export async function buildApp({ config }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async () => ({ status: 'ready' }));
  return app;
}
