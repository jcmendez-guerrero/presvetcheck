import { textoError, type CodigoError } from '@mmx/shared';

/** Error de la API con `code` estable y mensaje en español (SPEC: la UI traduce el code). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detalles: Record<string, unknown> | null,
  ) {
    super(textoError(code as CodigoError));
  }
}

let cabeceras: () => Promise<Record<string, string>> = async () => ({});
export function configurarCabeceras(f: () => Promise<Record<string, string>>) {
  cabeceras = f;
}

export async function api<T = unknown>(metodo: string, url: string, cuerpo?: unknown): Promise<T> {
  const esForm = cuerpo instanceof FormData;
  const res = await fetch(url, {
    method: metodo,
    headers: { ...(await cabeceras()), ...(cuerpo !== undefined && !esForm ? { 'Content-Type': 'application/json' } : {}) },
    ...(cuerpo !== undefined ? { body: esForm ? cuerpo : JSON.stringify(cuerpo) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const tipo = res.headers.get('content-type') ?? '';
  const datos = tipo.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) {
    const e = (datos as { error?: { code?: string; detalles?: Record<string, unknown> } }).error;
    throw new ApiError(res.status, e?.code ?? 'ERROR_INTERNO', e?.detalles ?? null);
  }
  return datos as T;
}

/** Descarga un fichero de la API (exportaciones). */
export async function descargar(url: string, nombre: string) {
  const blob = await api<Blob>('GET', url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const get = <T>(u: string) => api<T>('GET', u);
export const post = <T>(u: string, b?: unknown) => api<T>('POST', u, b ?? {});
export const put = <T>(u: string, b: unknown) => api<T>('PUT', u, b);
