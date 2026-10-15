import type { RecipeExtractor } from '@mmx/domain';
import { CAMPOS_EXTRAIDOS_LINEA, CAMPOS_EXTRAIDOS_RECETA, ExtractionResult, type CampoExtraido } from '@mmx/shared';
import { CAMPO_LINEAS, CAMPOS_FECHA, ESQUEMA_CAMPOS_VERSION, convertir } from '../campos';
import { confianzaCampo, type PalabraOcr } from '../confianza';
import { palabrasDe, type CampoDocIntel, type DocumentIntelligenceClient } from './docintel';
import { MODELO_LAYOUT, REGLAS_VERSION, camposDesdeLayout } from './reglas-layout';

/** Texto del campo tal como lo devuelve Document Intelligence según su tipo. */
function textoCampo(nombre: string, f: CampoDocIntel): string | null {
  if (f.valueSignature) return f.valueSignature;
  if (f.valueSelectionMark) return f.valueSelectionMark;
  if (CAMPOS_FECHA.has(nombre) && f.valueDate) return f.valueDate;
  const v = f.valueString ?? f.content ?? (f.valueNumber ?? f.valueInteger)?.toString() ?? null;
  return v === null || v.trim() === '' ? null : v.trim();
}

function campo(nombre: string, f: CampoDocIntel | undefined, pagina: number, palabras: PalabraOcr[]): CampoExtraido {
  if (!f) return { valor: null, confianza: 0, evidencia: null, fuente: 'ocr' };
  const valor = convertir(nombre, textoCampo(nombre, f));
  const region = f.boundingRegions?.[0] ?? null;
  return {
    valor,
    confianza: confianzaCampo(valor, f.confidence ?? 0, f.spans ?? [], region !== null, palabras),
    evidencia: valor === null ? null : { texto: f.content ?? null, pagina: region ? pagina : null, region: region?.polygon ?? null },
    fuente: 'ocr',
  };
}

/**
 * Extractor Azure (ADR-04 revisado, DUDA-27): un MODELO PERSONALIZADO de Document Intelligence entrenado
 * con las recetas de las clínicas (Document Intelligence Studio, datos en la UE) devuelve directamente los
 * campos con su confianza y su región en la página. No interviene ningún LLM: no hay texto inventado, cada
 * valor sale de una zona del documento. Cada página se analiza por separado; de cada campo se queda el de
 * mayor confianza y las líneas de medicamento se concatenan.
 */
export class AzureRecipeExtractor implements RecipeExtractor {
  readonly proveedor = 'azure' as const;

  constructor(
    private readonly di: DocumentIntelligenceClient,
    private readonly modelo: string,
  ) {}

  async extract(input: { pages: Uint8Array[]; mime: string }) {
    const receta: Record<string, CampoExtraido> = Object.fromEntries(CAMPOS_EXTRAIDOS_RECETA.map((c) => [c, campo(c, undefined, 1, [])]));
    const lineas: Record<string, CampoExtraido>[] = [];
    const textos: string[] = [];
    let modeloUsado = this.modelo;
    const reglas = this.modelo === MODELO_LAYOUT;
    for (let i = 0; i < input.pages.length; i++) {
      const pagina = i + 1;
      const r = await this.di.analizar(this.modelo, input.pages[i] as Uint8Array, input.mime, reglas ? ['keyValuePairs'] : []);
      modeloUsado = r.modelId ?? modeloUsado;
      textos.push(r.content ?? '');
      const palabras = palabrasDe(r, pagina);
      if (reglas) {
        // Sin modelo entrenado: etiquetas impresas → campos (reglas-layout.ts).
        const m = camposDesdeLayout(r, pagina, palabras);
        for (const [c, nuevo] of Object.entries(m.receta)) {
          const actual = receta[c] as CampoExtraido;
          if (actual.valor === null || nuevo.confianza > actual.confianza) receta[c] = nuevo;
        }
        lineas.push(...m.lineas);
        continue;
      }
      const fields = r.documents?.[0]?.fields ?? {};
      for (const c of CAMPOS_EXTRAIDOS_RECETA) {
        const nuevo = campo(c, fields[c], pagina, palabras);
        const actual = receta[c] as CampoExtraido;
        if (nuevo.valor !== null && (actual.valor === null || nuevo.confianza > actual.confianza)) receta[c] = nuevo;
      }
      for (const fila of fields[CAMPO_LINEAS]?.valueArray ?? []) {
        const o = fila.valueObject ?? {};
        const l = Object.fromEntries(CAMPOS_EXTRAIDOS_LINEA.map((c) => [c, campo(c, o[c], pagina, palabras)]));
        if (Object.values(l).some((x) => x.valor !== null)) lineas.push(l);
      }
    }
    return ExtractionResult.parse({
      receta,
      lineas,
      proveedor: 'azure',
      modelo: `docintel:${modeloUsado}${reglas ? ' + reglas' : ''} (api ${this.di.apiVersion})`,
      // En Document Intelligence no hay prompt: se guarda la versión del esquema de campos (o de las reglas).
      promptVersion: reglas ? REGLAS_VERSION : ESQUEMA_CAMPOS_VERSION,
      ocrTexto: textos.join('\n\n--- página ---\n\n'),
    });
  }
}
