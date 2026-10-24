/** zxing-wasm (ya usado por el escáner de cámara) cargado bajo demanda: lectura de códigos y QR del móvil. */
export const FORMATOS_ENVASE = ['DataMatrix', 'QRCode', 'EAN-13', 'Code128'] as const;

export async function lector() {
  const z = await import('zxing-wasm/reader');
  const wasm = (await import('zxing-wasm/reader/zxing_reader.wasm?url')).default;
  z.prepareZXingModule({ overrides: { locateFile: (p: string, pref: string) => (p.endsWith('.wasm') ? wasm : pref + p) } });
  return z.readBarcodes;
}

/** Lee el código de un envase en una foto (para móviles sin cámara en vivo, p. ej. web sin HTTPS). */
export async function leerCodigoDeFoto(f: Blob): Promise<string | null> {
  const leer = await lector();
  const r = await leer(f, { formats: [...FORMATOS_ENVASE], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1 });
  return r.find((x) => x.isValid)?.text ?? null;
}

/** SVG de un código QR (enlace de emparejamiento del móvil). */
export async function qrSvg(texto: string): Promise<string> {
  const z = await import('zxing-wasm/writer');
  const wasm = (await import('zxing-wasm/writer/zxing_writer.wasm?url')).default;
  z.prepareZXingModule({ overrides: { locateFile: (p: string, pref: string) => (p.endsWith('.wasm') ? wasm : pref + p) } });
  const r = await z.writeBarcode(texto, { format: 'QRCode', ecLevel: 'M', scale: 6 });
  if (r.error) throw new Error(r.error);
  return conMargen(r.svg);
}

/**
 * El SVG de zxing trae ancho y alto fijos, sin viewBox ni margen: al encajarlo en un hueco más pequeño se
 * recortaba (y los móviles no lo leían). Se añade un viewBox con 4 módulos de margen blanco (zona de silencio).
 */
export function conMargen(svg: string, escala = 6): string {
  const m = /<svg\b[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"/.exec(svg);
  if (!m) return svg;
  const [ancho, alto] = [Number(m[1]), Number(m[2])];
  const z = 4 * escala;
  const caja = `${-z} ${-z} ${ancho + 2 * z} ${alto + 2 * z}`;
  return svg
    .replace(/<\?xml[^>]*>\s*|<!DOCTYPE[^>]*>\s*/g, '')
    .replace(/<svg\b[^>]*>/, (t) =>
      t
        .replace(/\s(width|height)="[^"]*"/g, '')
        .replace('<svg', `<svg viewBox="${caja}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" style="background:#fff"`),
    );
}
