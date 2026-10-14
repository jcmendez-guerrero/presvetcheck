import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, type AppConfig } from '../config';

/** Lee `.env` (si existe, sin sobrescribir el entorno real) y valida la configuración. */
export function loadConfigFromProcess(cwd = process.cwd()): AppConfig {
  const fileVars = readDotEnv(findUp('.env', cwd));
  return loadConfig({ ...fileVars, ...process.env });
}

export function findUp(name: string, from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function readDotEnv(path: string | undefined): Record<string, string> {
  if (!path) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}
