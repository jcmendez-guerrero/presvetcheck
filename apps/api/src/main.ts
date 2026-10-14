import { ConfigError } from '@mmx/shared';
import { loadConfigFromProcess } from '@mmx/shared/node';
import { buildApp } from './app';

async function main() {
  let config;
  try {
    config = loadConfigFromProcess();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const app = await buildApp({ config });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

void main();
