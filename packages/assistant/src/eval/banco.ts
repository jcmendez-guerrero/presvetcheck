import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { BancoEvaluacion } from '@mmx/shared';

/** Carga y valida el banco de evaluación (`fixtures/asistente/banco.v1.yaml`). */
export function cargarBanco(ruta: string): BancoEvaluacion {
  const parsed = BancoEvaluacion.safeParse(parse(readFileSync(ruta, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `Banco de evaluación no válido: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}
