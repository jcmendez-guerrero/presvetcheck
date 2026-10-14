import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { descargarNomenclator, jobCimavetDelta, jobCimavetFull, jobNomenclatorImport } from '@mmx/cimavet';
import { importarMaestras } from '@mmx/db';
import { findUp } from '@mmx/shared/node';
import type { Contexto } from '../contexto';

export const cimavetDelta = (ctx: Contexto) => jobCimavetDelta({ client: ctx.cimavet.client, repo: ctx.cimavet.repo, log: ctx.log });

/** Descarga el Nomenclátor de CIMAVet a un directorio temporal, ejecuta `fn` y lo borra. */
async function conNomenclatorDescargado<T>(ctx: Contexto, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mmx-nomenclator-'));
  try {
    const d = await descargarNomenclator({ url: ctx.config.NOMENCLATOR_URL, destino: dir });
    ctx.log('Nomenclátor descargado', { ficheros: d.ficheros.length, bytesZip: d.bytesZip, ultimaModificacion: d.ultimaModificacion });
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Refresco completo semanal. `--descargar` usa el Nomenclátor recién publicado en lugar de la API. */
export const cimavetFull = (ctx: Contexto, args: Record<string, string>) => {
  if (args.descargar !== undefined) return conNomenclatorDescargado(ctx, (dir) => importar(ctx, resolve(dir, 'PrescripcionVET.xml'), dir));
  return jobCimavetFull({ client: ctx.cimavet.client, repo: ctx.cimavet.repo, log: ctx.log, ...(args.fichero ? { nomenclatorPath: resolve(args.fichero) } : {}) });
};

async function importar(ctx: Contexto, fichero: string, diccionarios: string) {
  const maestras = await importarMaestras(ctx.db, diccionarios);
  const informe = await jobNomenclatorImport({ repo: ctx.cimavet.repo, path: fichero });
  return { maestras: Object.fromEntries(Object.entries(maestras).map(([k, v]) => [k, v.leidos])), ...informe };
}

/**
 * Carga del Nomenclátor (job manual). `--descargar` (lo obtiene de CIMAVet: NOMENCLATOR_URL),
 * `--fichero <ruta>` o `--muestra` (fixtures/nomenclator, descargado antes con `pnpm nomenclator:fetch`).
 * Importa antes los diccionarios de la misma carpeta (principios activos, laboratorios, unidades…).
 */
export async function nomenclatorImport(ctx: Contexto, args: Record<string, string>) {
  if (args.descargar !== undefined) return conNomenclatorDescargado(ctx, (dir) => importar(ctx, resolve(dir, 'PrescripcionVET.xml'), dir));
  const dirFixtures = findUp('fixtures/nomenclator', process.cwd());
  const fichero = args.fichero ? resolve(args.fichero) : args.muestra !== undefined && dirFixtures ? resolve(dirFixtures, 'PrescripcionVET.sample.xml') : null;
  if (!fichero) throw new Error('Indica --descargar, --fichero <PrescripcionVET.xml> o --muestra');
  return importar(ctx, fichero, args.diccionarios ? resolve(args.diccionarios) : resolve(fichero, '..'));
}
