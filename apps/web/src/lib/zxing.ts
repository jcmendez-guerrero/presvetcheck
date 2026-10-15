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
  return r.svg;
}
