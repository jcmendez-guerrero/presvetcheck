import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecipeExtractor } from '@mmx/domain';
import { ExtractionResult, type CampoExtraido } from '@mmx/shared';
import { confianzaCampo } from '../confianza';
import { CAMPOS_BOOLEANOS, CAMPOS_NUMERICOS, LlmReceta, jsonSchemaReceta } from '../llm-schema';
import type { DocumentIntelligenceClient } from './docintel';
import type { AzureOpenAiClient } from './openai';

export const PROMPT_VERSION = 'receta.v1';

export function cargarPrompt(version = PROMPT_VERSION): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../../prompts/${version}.md`), 'utf8');
}

function convertir(campo: string, valor: string | null): string | number | boolean | null {
  if (valor === null) return null;
  if (CAMPOS_NUMERICOS.has(campo)) {
    const n = Number.parseInt(valor.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (CAMPOS_BOOLEANOS.has(campo)) return /^(true|s[ií]|1)$/i.test(valor.trim());
  return valor;
}

/**
 * Extractor Azure (ADR-04): OCR con Document Intelligence + estructuración con Azure OpenAI.
 * Guarda modelo y versión de prompt con cada extracción.
 */
export class AzureRecipeExtractor implements RecipeExtractor {
  readonly proveedor = 'azure' as const;

  constructor(
    private readonly ocr: DocumentIntelligenceClient,
    private readonly llm: AzureOpenAiClient,
    private readonly deployment: string,
    private readonly prompt: string = cargarPrompt(),
  ) {}

  async extract(input: { pages: Uint8Array[]; mime: string }) {
    const ocr = await this.ocr.ocr(input.pages, input.mime);
    const r = await this.llm.completarJson({
      sistema: this.prompt,
      texto: ocr.texto,
      imagenes: input.pages.map((p) => ({ mime: input.mime === 'application/pdf' ? 'image/png' : input.mime, base64: Buffer.from(p).toString('base64') })),
      schema: jsonSchemaReceta(),
    });
    const parsed = LlmReceta.parse(r.json);
    const campo = (nombre: string, c: { valor: string | null; evidencia: string | null; confianza: number }): CampoExtraido => {
      const valor = convertir(nombre, c.valor);
      const conf = confianzaCampo(valor, c.evidencia, c.confianza, ocr.texto, ocr.palabras);
      return {
        valor,
        confianza: conf.confianza,
        evidencia: c.evidencia === null ? null : { texto: c.evidencia, pagina: conf.pagina, region: conf.region },
        fuente: 'llm',
      };
    };
    return ExtractionResult.parse({
      receta: Object.fromEntries(Object.entries(parsed.receta).map(([k, v]) => [k, campo(k, v)])),
      lineas: parsed.lineas.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, campo(k, v)]))),
      proveedor: 'azure',
      modelo: `${this.deployment}${r.modelo ? ` (${r.modelo})` : ''}`,
      promptVersion: PROMPT_VERSION,
      ocrTexto: ocr.texto,
    });
  }
}
