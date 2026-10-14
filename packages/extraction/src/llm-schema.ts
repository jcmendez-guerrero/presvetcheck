import { z } from 'zod';
import { CAMPOS_EXTRAIDOS_LINEA, CAMPOS_EXTRAIDOS_RECETA } from '@mmx/shared';

/**
 * Esquema que se exige al modelo con structured outputs (strict): todos los campos obligatorios,
 * `valor` como texto o null, evidencia literal y autoevaluación de confianza.
 */
const Campo = z.strictObject({
  valor: z.string().nullable(),
  evidencia: z.string().nullable(),
  confianza: z.number(),
});

export const LlmReceta = z.strictObject({
  receta: z.strictObject(Object.fromEntries(CAMPOS_EXTRAIDOS_RECETA.map((c) => [c, Campo])) as Record<(typeof CAMPOS_EXTRAIDOS_RECETA)[number], typeof Campo>),
  lineas: z.array(
    z.strictObject(Object.fromEntries(CAMPOS_EXTRAIDOS_LINEA.map((c) => [c, Campo])) as Record<(typeof CAMPOS_EXTRAIDOS_LINEA)[number], typeof Campo>),
  ),
});
export type LlmReceta = z.infer<typeof LlmReceta>;

/** JSON Schema para `response_format: { type: 'json_schema', strict: true }`. */
export function jsonSchemaReceta(): Record<string, unknown> {
  const s = z.toJSONSchema(LlmReceta, { target: 'draft-7' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

export const CAMPOS_NUMERICOS = new Set(['numAnimales', 'cantidadEnvases', 'duracionDias']);
export const CAMPOS_BOOLEANOS = new Set(['firmaDetectada', 'selloDetectado', 'qrDetectado', 'declaracionAntimicrobiano']);
