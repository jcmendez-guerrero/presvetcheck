import { resolve } from 'node:path';
import { jobCimavetDelta, jobCimavetFull, jobNomenclatorImport } from '@mmx/cimavet';
import { importarMaestras } from '@mmx/db';
import { findUp } from '@mmx/shared/node';
import type { Contexto } from '../contexto';

export const cimavetDelta = (ctx: Contexto) => jobCimavetDelta({ client: ctx.cimavet.client, repo: ctx.cimavet.repo, log: ctx.log });

export const cimavetFull = (ctx: Contexto, args: Record<string, string>) =>
  jobCimavetFull({ client: ctx.cimavet.client, repo: ctx.cimavet.repo, log: ctx.log, ...(args.fichero ? { nomenclatorPath: resolve(args.fichero) } : {}) });

/**
 * Carga inicial del Nomenclátor (job manual). `--fichero <ruta>` o `--muestra` (fixtures). Importa antes los
 * diccionarios de la misma carpeta (principios activos, laboratorios, unidades…).
 */
export async function nomenclatorImport(ctx: Contexto, args: Record<string, string>) {
  const dirFixtures = findUp('fixtures/nomenclator', process.cwd());
  const fichero = args.fichero ? resolve(args.fichero) : args.muestra !== undefined && dirFixtures ? resolve(dirFixtures, 'PrescripcionVET.sample.xml') : null;
  if (!fichero) throw new Error('Indica --fichero <PrescripcionVET.xml> o --muestra');
  const maestras = await importarMaestras(ctx.db, args.diccionarios ? resolve(args.diccionarios) : resolve(fichero, '..'));
  const informe = await jobNomenclatorImport({ repo: ctx.cimavet.repo, path: fichero });
  return { maestras: Object.fromEntries(Object.entries(maestras).map(([k, v]) => [k, v.leidos])), ...informe };
}
