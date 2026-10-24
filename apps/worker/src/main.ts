/**
 * Entrypoint de los jobs (Container Apps Jobs y `pnpm worker <job>` en local):
 *   cimavet-delta · cimavet-full [--descargar | --fichero] · outbox-dispatcher · sales-reconciliation [--fecha] ·
 *   weekly-reports [--desde --hasta] · nomenclator-import (--descargar | --fichero | --muestra) · retention-sweep [--anios]
 */
import { ConfigError } from '@mmx/shared';
import { loadConfigFromProcess } from '@mmx/shared/node';
import { crearContexto, logJson, type Contexto } from './contexto';
import { cimavetDelta, cimavetFull, nomenclatorImport } from './jobs/cimavet';
import { outboxDispatcher } from './jobs/outbox';
import { salesReconciliation } from './jobs/conciliacion';
import { cargarProcedimiento } from './jobs/procedimiento';
import { weeklyReports } from './jobs/reportes';
import { retentionSweep } from './jobs/retencion';
import { runMigrations } from '@mmx/db';

export const JOBS: Record<string, (ctx: Contexto, args: Record<string, string>) => Promise<unknown>> = {
  'cimavet-delta': cimavetDelta,
  'cimavet-full': cimavetFull,
  'nomenclator-import': nomenclatorImport,
  'outbox-dispatcher': outboxDispatcher,
  'sales-reconciliation': salesReconciliation,
  'weekly-reports': weeklyReports,
  'retention-sweep': retentionSweep,
  /** Se ejecuta antes de activar una nueva revisión (SPEC §10.3). */
  'procedimiento-cargar': cargarProcedimiento,
  'db-migrate': async (ctx) => {
    await runMigrations({ db: ctx.db, kind: ctx.config.DATABASE_URL.startsWith('pglite://') ? 'pglite' : 'postgres', close: async () => {} });
    return { ok: true };
  },
};

export function parsearArgs(argv: string[]): { job: string | undefined; args: Record<string, string> } {
  const limpios = argv.filter((a) => a !== '--');
  const args: Record<string, string> = {};
  for (let i = 1; i < limpios.length; i++) {
    const a = limpios[i] as string;
    if (!a.startsWith('--')) continue;
    const sig = limpios[i + 1];
    if (sig !== undefined && !sig.startsWith('--')) {
      args[a.slice(2)] = sig;
      i++;
    } else args[a.slice(2)] = '';
  }
  return { job: limpios[0], args };
}

async function main() {
  const { job, args } = parsearArgs(process.argv.slice(2));
  const fn = job ? JOBS[job] : undefined;
  if (!fn) {
    console.error(`Uso: pnpm worker <job> [--opciones]\nJobs: ${Object.keys(JOBS).join(', ')}`);
    process.exit(2);
  }
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
  const { ctx, handle } = await crearContexto(config);
  const inicio = Date.now();
  try {
    const r = await fn(ctx, args);
    logJson(`job ${job} terminado`, { job, ms: Date.now() - inicio, resultado: r as Record<string, unknown> });
  } catch (e) {
    logJson(`job ${job} fallido`, { job, error: (e as Error).message });
    process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('worker.js')) void main();
