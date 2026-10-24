/**
 * Normalización de páginas en el navegador (SPEC §4.1.1): orientación EXIF corregida, PNG por página,
 * hash perceptual (dHash 64 bits → 16 hex) y un indicador simple de calidad (desenfoque y brillo).
 */
export interface PaginaPreparada {
  blob: Blob;
  mime: string;
  phash: string | null;
  calidad: { brillo: number; nitidez: number; aviso: string | null } | null;
  vista: string;
}

/** Tamaño máximo de cada página enviada (margen bajo el límite de 4 MB de Document Intelligence F0). */
export const MAX_BYTES = 3_500_000;

export async function prepararPagina(f: File): Promise<PaginaPreparada> {
  if (f.type === 'application/pdf' || f.type === 'image/heic') {
    return { blob: f, mime: f.type, phash: null, calidad: null, vista: '' };
  }
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
  const max = 2400;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  // JPEG y por debajo de MAX_BYTES: Document Intelligence (plan F0) rechaza ficheros de más de 4 MB, y una
  // foto de móvil en PNG los supera. Calidad 0,9 basta para leer la letra; se baja si aún es grande.
  let blob: Blob | null = null;
  for (const q of [0.9, 0.8, 0.7, 0.6]) {
    blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b as Blob), 'image/jpeg', q));
    if (blob.size <= MAX_BYTES) break;
  }
  return {
    blob: blob!,
    mime: 'image/jpeg',
    phash: dHash(bmp),
    calidad: calidad(bmp),
    vista: URL.createObjectURL(blob!),
  };
}

function gris(bmp: ImageBitmap, w: number, h: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  return out;
}

export function dHash(bmp: ImageBitmap): string {
  const g = gris(bmp, 9, 8);
  let bits = '';
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) bits += g[y * 9 + x]! > g[y * 9 + x + 1]! ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

function calidad(bmp: ImageBitmap) {
  const w = 256;
  const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
  const g = gris(bmp, w, h);
  const brillo = g.reduce((a, v) => a + v, 0) / g.length;
  // Varianza del laplaciano: valores bajos = foto movida o desenfocada.
  let suma = 0;
  let suma2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const l =
        4 * g[y * w + x]! - g[y * w + x - 1]! - g[y * w + x + 1]! - g[(y - 1) * w + x]! - g[(y + 1) * w + x]!;
      suma += l;
      suma2 += l * l;
      n++;
    }
  const nitidez = n ? suma2 / n - (suma / n) ** 2 : 0;
  const aviso =
    brillo < 60
      ? 'La foto está muy oscura'
      : brillo > 235
        ? 'La foto está demasiado clara'
        : nitidez < 40
          ? 'La foto parece movida o desenfocada'
          : null;
  return { brillo: Math.round(brillo), nitidez: Math.round(nitidez), aviso };
}
