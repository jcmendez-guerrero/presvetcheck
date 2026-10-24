import type { PalabraOcr } from '../confianza';

/**
 * Cliente REST de Azure AI Document Intelligence (SPEC §5.3; DUDA-27 resuelta: modelo personalizado de
 * Document Intelligence, sin LLM). Autenticación con Entra ID (identidad gestionada): sin claves.
 */
export interface DocIntelOptions {
  endpoint: string;
  getToken: () => Promise<string>;
  apiVersion?: string;
  pollMs?: number;
  maxPolls?: number;
  /** Espera máxima por página. En el nivel gratuito (F0) una página puede tardar más de un minuto. */
  maxEsperaMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CampoDocIntel {
  type?: string;
  content?: string;
  valueString?: string;
  valueNumber?: number;
  valueInteger?: number;
  valueDate?: string;
  valueSelectionMark?: 'selected' | 'unselected';
  valueSignature?: 'signed' | 'unsigned';
  valueArray?: CampoDocIntel[];
  valueObject?: Record<string, CampoDocIntel>;
  confidence?: number;
  boundingRegions?: { pageNumber: number; polygon?: number[] }[];
  spans?: { offset: number; length: number }[];
}

export interface AnalyzeResult {
  modelId?: string;
  apiVersion?: string;
  content?: string;
  pages?: {
    pageNumber: number;
    words?: {
      content: string;
      confidence: number;
      polygon?: number[];
      span?: { offset: number; length: number };
    }[];
  }[];
  documents?: { docType?: string; confidence?: number; fields?: Record<string, CampoDocIntel> }[];
  /** Solo con `features=keyValuePairs` (modelo `prebuilt-layout`). */
  keyValuePairs?: {
    key: { content: string };
    value?: {
      content?: string;
      boundingRegions?: { pageNumber: number; polygon?: number[] }[];
      spans?: { offset: number; length: number }[];
    };
    confidence?: number;
  }[];
}

export class DocumentIntelligenceClient {
  constructor(private readonly o: DocIntelOptions) {}

  get apiVersion() {
    return this.o.apiVersion ?? '2024-11-30';
  }

  private async headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${await this.o.getToken()}`, ...extra };
  }

  /** `documentModels/{modelo}:analyze` + sondeo de la operación. */
  async analizar(
    modelo: string,
    bytes: Uint8Array,
    mime: string,
    features: string[] = [],
  ): Promise<AnalyzeResult> {
    const base = this.o.endpoint.replace(/\/$/, '');
    const extra = features.length ? `&features=${features.join(',')}` : '';
    const res = await fetch(
      `${base}/documentintelligence/documentModels/${encodeURIComponent(modelo)}:analyze?api-version=${this.apiVersion}&locale=es-ES${extra}`,
      {
        method: 'POST',
        headers: await this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ base64Source: Buffer.from(bytes).toString('base64') }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (res.status !== 202) {
      // Solo el código de error del servicio (p. ej. InvalidContentLength): nunca contenido del documento.
      const cuerpo = (await res.json().catch(() => null)) as {
        error?: { code?: string; innererror?: { code?: string } };
      } | null;
      const codigo = cuerpo?.error?.innererror?.code ?? cuerpo?.error?.code;
      throw new Error(
        `Document Intelligence respondió ${res.status} (${mime}, ${bytes.byteLength} bytes${codigo ? `, ${codigo}` : ''})`,
      );
    }
    const op = res.headers.get('operation-location');
    if (!op) throw new Error('Document Intelligence no devolvió Operation-Location');
    const sleep = this.o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const now = this.o.now ?? Date.now;
    const limite = now() + (this.o.maxEsperaMs ?? 180_000);
    // El servicio indica cada cuánto consultar (Retry-After); si no, cada `pollMs`.
    let espera = Number(res.headers.get('retry-after')) * 1000 || (this.o.pollMs ?? 1000);
    for (let i = 0; i < (this.o.maxPolls ?? 300) && now() < limite; i++) {
      await sleep(espera);
      const r = await fetch(op, { headers: await this.headers(), signal: AbortSignal.timeout(15_000) });
      if (r.status === 429) {
        espera = Math.min(espera * 2, 10_000);
        continue;
      }
      const body = (await r.json()) as {
        status: string;
        analyzeResult?: AnalyzeResult;
        error?: { message?: string };
      };
      if (body.status === 'succeeded') return body.analyzeResult ?? {};
      if (body.status === 'failed')
        throw new Error(`Document Intelligence falló: ${body.error?.message ?? 'sin detalle'}`);
      espera = Number(r.headers.get('retry-after')) * 1000 || (this.o.pollMs ?? 1000);
    }
    throw new Error('Document Intelligence: tiempo de espera agotado');
  }
}

/** Palabras OCR de un resultado (con su posición en `content` para cruzarlas con los campos). */
export function palabrasDe(r: AnalyzeResult, pagina: number): PalabraOcr[] {
  return (r.pages ?? []).flatMap((p) =>
    (p.words ?? []).map((w) => ({
      texto: w.content,
      confianza: w.confidence,
      pagina,
      poligono: w.polygon ?? null,
      ...(w.span ? { offset: w.span.offset, length: w.span.length } : {}),
    })),
  );
}
