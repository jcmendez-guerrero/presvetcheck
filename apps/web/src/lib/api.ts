import { textoError, type CodigoError } from '@mmx/shared';

/** Nombres legibles de los campos que devuelve la validación de la API (`/precioNetoCompra` → «Precio neto»). */
const NOMBRES_CAMPO: Record<string, string> = {
  cn: 'Código nacional',
  cnEscaneado: 'Código nacional escaneado',
  nombre: 'Nombre del producto',
  lote: 'Lote',
  caducidad: 'Caducidad',
  unidades: 'Unidades',
  serie: 'Nº de serie',
  gtin: 'Código de barras (GTIN)',
  precioNetoCompra: 'Precio neto',
  ivaPct: 'IVA',
  distribuidor: 'Distribuidor',
  albaran: 'Nº de albarán',
  fechaCompra: 'Fecha de compra',
  fechaRecepcion: 'Fecha de recepción',
};
const nombreCampo = (ruta: string) => {
  const partes = ruta.split('/').filter(Boolean);
  const ultimo = [...partes].reverse().find((p) => !/^\d+$/.test(p)) ?? '';
  return NOMBRES_CAMPO[ultimo] ?? ultimo;
};

/**
 * Error de la API con `code` estable y mensaje en español (SPEC: la UI traduce el code). Si la API indica qué
 * campos fallan, el mensaje los enumera («Precio neto: …») en lugar de solo «Revisa el formulario».
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detalles: Record<string, unknown> | null,
    mensaje?: string | null,
  ) {
    const campos = Array.isArray(detalles)
      ? (detalles as { campo?: string; mensaje?: string }[]).map(
          (d) => `${nombreCampo(d.campo ?? '')}: ${d.mensaje ?? 'no es válido'}`,
        )
      : [];
    const base = mensaje ?? textoError(code as CodigoError);
    super(campos.length ? `${base.replace(/ Revisa el formulario\.?$/, '')} ${campos.join(' · ')}` : base);
  }
  /** Errores por campo (para marcarlos en el formulario). */
  get campos(): Record<string, string> {
    if (!Array.isArray(this.detalles)) return {};
    return Object.fromEntries(
      (this.detalles as { campo?: string; mensaje?: string }[]).map((d) => [
        (d.campo ?? '').split('/').filter(Boolean).pop() ?? '',
        d.mensaje ?? 'no es válido',
      ]),
    );
  }
}

let cabeceras: () => Promise<Record<string, string>> = async () => ({});
export function configurarCabeceras(f: () => Promise<Record<string, string>>) {
  cabeceras = f;
}

/**
 * Se llama ante un 401: renueva la sesión y responde si merece la pena repetir la petición. Con `reintento` la
 * petición ya se repitió tras renovar y sigue rechazada: la sesión no tiene arreglo.
 */
type NoAutorizado = (reintento: boolean) => Promise<boolean>;
let alNoAutorizado: NoAutorizado | null = null;
export function configurarNoAutorizado(f: NoAutorizado | null) {
  alNoAutorizado = f;
}

// La API nunca redirige: una redirección es la plataforma mandando a Microsoft (sesión perdida).
const rechazada = (r: Response) => r.status === 401 || r.type === 'opaqueredirect';

export async function api<T = unknown>(metodo: string, url: string, cuerpo?: unknown): Promise<T> {
  const esForm = cuerpo instanceof FormData;
  const pedir = async () =>
    fetch(url, {
      method: metodo,
      headers: {
        ...(await cabeceras()),
        // Así la autenticación de la plataforma responde 401 en lugar de redirigir a Microsoft.
        'X-Requested-With': 'XMLHttpRequest',
        ...(cuerpo !== undefined && !esForm ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(cuerpo !== undefined ? { body: esForm ? cuerpo : JSON.stringify(cuerpo) } : {}),
      // Si la plataforma no respeta X-Requested-With y responde 302, no se sigue (fallaría por CORS como «sin red»).
      redirect: 'manual',
    });
  let res = await pedir();
  // Repetir es seguro también en escrituras: la API rechaza un 401 antes de hacer nada.
  if (rechazada(res) && alNoAutorizado && (await alNoAutorizado(false))) {
    res = await pedir();
    if (rechazada(res)) await alNoAutorizado(true);
  }
  if (res.type === 'opaqueredirect') throw new ApiError(401, 'NO_AUTORIZADO', null, null);
  if (res.status === 204) return undefined as T;
  const tipo = res.headers.get('content-type') ?? '';
  const datos = tipo.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) {
    const e = (datos as { error?: { code?: string; mensaje?: string; detalles?: Record<string, unknown> } })
      .error;
    throw new ApiError(res.status, e?.code ?? 'ERROR_INTERNO', e?.detalles ?? null, e?.mensaje ?? null);
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
