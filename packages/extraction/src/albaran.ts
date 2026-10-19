import Decimal from 'decimal.js';
import { ultimoDiaMes } from '@mmx/domain';
import type { AnalyzeResult, DocumentIntelligenceClient } from './azure/docintel';

/**
 * Lectura de albaranes y facturas de proveedor con Document Intelligence (`prebuilt-invoice`) para proponer las
 * líneas de una recepción. Es solo una PROPUESTA: la persona revisa cada línea con el envase antes de añadirla
 * (y la API valida lo de siempre: CIMAVet, caducidad…). Estructura comprobada con una respuesta real
 * (fixtures/albaranes/sintetico-1.invoice.json).
 */
export const MODELO_ALBARAN = 'prebuilt-invoice';

export interface LineaAlbaran {
  descripcion: string | null;
  codigo: string | null;
  /** Código nacional si el código del proveedor lo es (6 cifras, o 7 con el dígito de control). */
  cn: string | null;
  cantidad: number | null;
  /** Precio unitario con punto decimal ("11.20"), tal como figura en el documento. */
  precioUnitario: string | null;
  lote: string | null;
  caducidad: string | null;
}

export interface LecturaAlbaran {
  proveedor: string | null;
  numero: string | null;
  fecha: string | null;
  lineas: LineaAlbaran[];
  modelo: string;
}

type Campo = {
  type?: string;
  content?: string;
  valueString?: string;
  valueDate?: string;
  valueNumber?: number;
  valueCurrency?: { amount?: number };
  valueArray?: Campo[];
  valueObject?: Record<string, Campo>;
  spans?: { offset: number; length: number }[];
};

const texto = (c: Campo | undefined) => (c?.valueString ?? c?.content ?? '').trim() || null;

/** "11,20" / "1.234,50" / "11.20" → "11.20" (sin pasar por coma flotante). */
export function importeDeTexto(s: string | null | undefined): string | null {
  if (!s) return null;
  const limpio = s.replace(/[^\d,.-]/g, '');
  const normal = /,\d{1,4}$/.test(limpio)
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio.replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(normal)
    ? new Decimal(normal).toFixed(Math.min(4, Math.max(2, normal.split('.')[1]?.length ?? 2)))
    : null;
}

/**
 * Caducidad escrita en el albarán: "15/01/2028", "01/2028", "2028-01" (sin día → último día del mes, como el
 * día «00» de GS1).
 */
export function caducidadDeTexto(s: string | null | undefined): string | null {
  if (!s) return null;
  const dma = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(s);
  if (dma) {
    const a = dma[3]!.length === 2 ? `20${dma[3]}` : dma[3]!;
    const m = Number(dma[2]);
    if (m >= 1 && m <= 12) return `${a}-${String(m).padStart(2, '0')}-${dma[1]!.padStart(2, '0')}`;
  }
  const ma = /\b(\d{1,2})[/.-](\d{4})\b/.exec(s) ?? null;
  if (ma && Number(ma[1]) >= 1 && Number(ma[1]) <= 12) return ultimoDiaMes(Number(ma[2]), Number(ma[1]));
  const am = /\b(\d{4})[/.-](\d{1,2})\b/.exec(s);
  if (am && Number(am[2]) >= 1 && Number(am[2]) <= 12) return ultimoDiaMes(Number(am[1]), Number(am[2]));
  return null;
}

/** Línea de texto del documento donde está la fila (el lote y la caducidad no son campos del modelo). */
function lineaDeTexto(contenido: string, fila: Record<string, Campo>): string {
  const offsets = Object.values(fila).flatMap((c) => c.spans ?? []);
  if (!offsets.length) return '';
  const ini = Math.min(...offsets.map((s) => s.offset));
  const desde = contenido.lastIndexOf('\n', ini) + 1;
  const hasta = contenido.indexOf('\n', ini);
  return contenido.slice(desde, hasta < 0 ? undefined : hasta);
}

export function albaranDesdeFactura(r: AnalyzeResult): LecturaAlbaran {
  const f = (r.documents?.[0]?.fields ?? {}) as Record<string, Campo>;
  const contenido = r.content ?? '';
  const lineas = (f.Items?.valueArray ?? []).map((it): LineaAlbaran => {
    const o = it.valueObject ?? {};
    const fila = lineaDeTexto(contenido, o);
    const codigo = texto(o.ProductCode);
    const cnTexto = /\bC\.?\s?N\.?\s*:?\s*(\d{6,7})\b/i.exec(fila)?.[1];
    const cnBruto = codigo && /^\d{6,7}$/.test(codigo) ? codigo : (cnTexto ?? null);
    const precio =
      o.UnitPrice?.valueCurrency?.amount !== undefined
        ? importeDeTexto(o.UnitPrice.content ?? String(o.UnitPrice.valueCurrency.amount))
        : importeDeTexto(o.UnitPrice?.content);
    const importe = importeDeTexto(o.Amount?.content);
    let cantidad =
      o.Quantity?.valueNumber ?? (o.Quantity?.content ? Number(o.Quantity.content.replace(',', '.')) : null);
    // Sin cantidad leída: importe ÷ precio, si da un número entero de envases.
    if ((cantidad === null || Number.isNaN(cantidad)) && precio && importe && new Decimal(precio).gt(0)) {
      const q = new Decimal(importe).div(precio);
      cantidad = q.isInteger() ? q.toNumber() : null;
    }
    return {
      descripcion: texto(o.Description),
      codigo,
      cn: cnBruto ? cnBruto.slice(0, 6) : null,
      cantidad: cantidad !== null && Number.isFinite(cantidad) ? cantidad : null,
      precioUnitario: precio,
      lote: /\blote?\s*:?\s*([A-Z0-9][A-Z0-9-/.]{1,30})/i.exec(fila)?.[1] ?? null,
      caducidad: caducidadDeTexto(/\b(?:cad(?:ucidad)?|exp|vto)\.?\s*:?\s*([\d/.-]{6,10})/i.exec(fila)?.[1]),
    };
  });
  return {
    proveedor: texto(f.VendorName),
    numero: texto(f.InvoiceId),
    fecha: f.InvoiceDate?.valueDate ?? null,
    lineas,
    modelo: r.modelId ?? MODELO_ALBARAN,
  };
}

export class LectorAlbaranes {
  constructor(private readonly di: DocumentIntelligenceClient) {}
  async leer(bytes: Uint8Array, mime: string): Promise<LecturaAlbaran> {
    return albaranDesdeFactura(await this.di.analizar(MODELO_ALBARAN, bytes, mime));
  }
}
