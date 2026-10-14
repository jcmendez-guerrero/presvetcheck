import type { PalabraOcr } from '../confianza';

/**
 * Azure AI Document Intelligence `prebuilt-layout` (SPEC §5.3 etapa 1): texto impreso y manuscrito
 * en español, palabras con confianza y polígonos, y marcas de estilo manuscrito. Autenticación con
 * Entra ID (identidad gestionada): sin claves en la configuración.
 */
export interface ResultadoOcr {
  texto: string;
  palabras: PalabraOcr[];
  /** Proporción del texto marcado como manuscrito. */
  manuscrito: number;
  paginas: number;
}

export interface DocIntelOptions {
  endpoint: string;
  getToken: () => Promise<string>;
  apiVersion?: string;
  pollMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface AnalyzeResult {
  content?: string;
  pages?: { pageNumber: number; words?: { content: string; confidence: number; polygon?: number[] }[] }[];
  styles?: { isHandwritten?: boolean; spans?: { offset: number; length: number }[] }[];
}

export class DocumentIntelligenceClient {
  constructor(private readonly o: DocIntelOptions) {}

  private async headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${await this.o.getToken()}`, ...extra };
  }

  async analizarPagina(bytes: Uint8Array, mime: string): Promise<AnalyzeResult> {
    const base = this.o.endpoint.replace(/\/$/, '');
    const version = this.o.apiVersion ?? '2024-11-30';
    const res = await fetch(`${base}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${version}&locale=es-ES`, {
      method: 'POST',
      headers: await this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ base64Source: Buffer.from(bytes).toString('base64') }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 202) throw new Error(`Document Intelligence respondió ${res.status} (${mime})`);
    const op = res.headers.get('operation-location');
    if (!op) throw new Error('Document Intelligence no devolvió Operation-Location');
    const sleep = this.o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let i = 0; i < (this.o.maxPolls ?? 60); i++) {
      await sleep(this.o.pollMs ?? 1000);
      const r = await fetch(op, { headers: await this.headers(), signal: AbortSignal.timeout(15_000) });
      const body = (await r.json()) as { status: string; analyzeResult?: AnalyzeResult; error?: { message?: string } };
      if (body.status === 'succeeded') return body.analyzeResult ?? {};
      if (body.status === 'failed') throw new Error(`Document Intelligence falló: ${body.error?.message ?? 'sin detalle'}`);
    }
    throw new Error('Document Intelligence: tiempo de espera agotado');
  }

  async ocr(pages: Uint8Array[], mime: string): Promise<ResultadoOcr> {
    const textos: string[] = [];
    const palabras: PalabraOcr[] = [];
    let manuscrito = 0;
    let total = 0;
    for (let i = 0; i < pages.length; i++) {
      const r = await this.analizarPagina(pages[i] as Uint8Array, mime);
      const contenido = r.content ?? '';
      textos.push(contenido);
      total += contenido.length;
      for (const s of r.styles ?? []) if (s.isHandwritten) manuscrito += (s.spans ?? []).reduce((a, sp) => a + sp.length, 0);
      for (const p of r.pages ?? []) {
        for (const w of p.words ?? []) palabras.push({ texto: w.content, confianza: w.confidence, pagina: i + 1, poligono: w.polygon ?? null });
      }
    }
    return { texto: textos.join('\n\n--- página ---\n\n'), palabras, manuscrito: total ? manuscrito / total : 0, paginas: pages.length };
  }
}
