import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { RULE_FILES, type RulesBundle } from '../rules';
import { findUp } from './env';

export interface LoadedRuleFile {
  fichero: string;
  hash: string;
  contenido: unknown;
}

/** Localiza `config/rules` subiendo desde `from`. */
export function findRulesDir(from = process.cwd()): string {
  const dir = findUp('config/rules', from);
  if (!dir) throw new Error('No se encuentra config/rules');
  return dir;
}

/**
 * Carga y valida los ficheros de reglas. La versión resultante (`fichero@hash8` de cada
 * fichero) se guarda con cada evaluación (SPEC §0.2: reglas versionadas).
 */
export function loadRules(dir = findRulesDir()): { bundle: RulesBundle; files: LoadedRuleFile[] } {
  const files: LoadedRuleFile[] = [];
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(RULE_FILES)) {
    const raw = readFileSync(resolve(dir, def.fichero), 'utf8');
    const hash = createHash('sha256').update(raw).digest('hex');
    const parsed = def.schema.safeParse(parse(raw));
    if (!parsed.success) {
      throw new Error(
        `Reglas no válidas en ${def.fichero}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    out[key] = parsed.data;
    files.push({ fichero: def.fichero, hash, contenido: parsed.data });
  }
  const version = files.map((f) => `${f.fichero.replace(/\.yaml$/, '')}@${f.hash.slice(0, 8)}`).join('+');
  return { bundle: { ...(out as Omit<RulesBundle, 'version'>), version }, files };
}
