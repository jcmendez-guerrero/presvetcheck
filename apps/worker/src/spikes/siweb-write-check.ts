/**
 * Spike de escritura en Siweb360 (SPEC §12.3). Uso (lo ejecuta una persona, nunca el CI):
 *
 *   pnpm --filter @mmx/worker spike:siweb -- --sku TEST-0000-CN000000
 *
 * Requiere SIWEB_BASE_URL y SIWEB_TOKEN (local). Pide confirmación antes de escribir.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfigFromProcess } from '@mmx/shared/node';
import { SiwebClient } from '@mmx/siweb';
import { ejecutarSpike } from './spike-siweb';

const args = process.argv.slice(2);
const sku = args[args.indexOf('--sku') + 1] ?? '';
const config = loadConfigFromProcess();
if (!config.SIWEB_TOKEN) {
  console.error('Falta SIWEB_TOKEN');
  process.exit(1);
}
const rl = createInterface({ input: stdin, output: stdout });
const res = await ejecutarSpike({
  client: new SiwebClient({ baseUrl: config.SIWEB_BASE_URL, token: config.SIWEB_TOKEN }),
  sku,
  almacen: { nombre: config.SIWEB_WAREHOUSE_NAME, id: config.SIWEB_WAREHOUSE_ID },
  preguntar: (t) => rl.question(t),
  log: (t, d) => console.log(t, d === undefined ? '' : JSON.stringify(d, null, 2)),
  hoy: new Date(),
});
rl.close();
process.exit(res.ok ? 0 : 2);
