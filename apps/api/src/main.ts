import { ConfigError } from '@mmx/shared';
import { loadConfigFromProcess } from '@mmx/shared/node';
import { buildApp } from './app';
import { crearDeps } from './crear-deps';

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
  const { deps, handle } = await crearDeps(config, (m) => console.warn(m));
  const app = await buildApp({ deps });
  const cerrar = async () => {
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((e) => {
  console.error('No se pudo arrancar la API:', (e as Error).message);
  process.exit(1);
});
