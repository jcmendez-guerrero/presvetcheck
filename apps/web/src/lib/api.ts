import { textoError, type CodigoError } from '@mmx/shared';
import { esRechazoDePlataforma } from './sesion';

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
 * Se llama ante un rechazo de la plataforma (401, o 403 sin código de la API): renueva la sesión y responde si merece la pena repetir la petición. Con `reintento` la
 * petición ya se repitió tras renovar y sigue rechazada: la sesión no tiene arreglo.
 */
type NoAutorizado = (reintento: boolean) => Promise<boolean>;
let alNoAutorizado: NoAutorizado | null = null;
export function configurarNoAutorizado(f: NoAutorizado | null) {
  alNoAutorizado = f;
}

// La API nunca redirige: una redirección es la plataforma mandando a Microsoft (sesión perdida). Con el token
// caducado la plataforma puede responder 403 en vez de 401; se distingue del 403 de la API por su cuerpo (spec 015).
const rechazada = async (r: Response) => {
  if (r.type === 'opaqueredirect' || r.status === 401) return true;
  if (r.status !== 403) return false;
  const tipo = r.headers.get('content-type') ?? '';
  const cuerpo: unknown = await (tipo.includes('json') ? r.clone().json() : r.clone().text()).catch(
    () => null,
  );
  return esRechazoDePlataforma(r.status, cuerpo);
};

export async function api<T = unknown>(
  metodo: string,
  url: string,
  cuerpo?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const esForm = cuerpo instanceof FormData;
  const pedir = async () =>
    fetch(url, {
      method: metodo,
      ...(signal ? { signal } : {}),
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
  // Repetir es seguro también en escrituras: tanto la plataforma como la API rechazan antes de hacer nada.
  if ((await rechazada(res)) && alNoAutorizado && (await alNoAutorizado(false))) {
    res = await pedir();
    if (await rechazada(res)) await alNoAutorizado(true);
  }
  // Redirección o 403 de la plataforma: el resto de la aplicación solo conoce el 401 (sesión perdida).
  if (res.status !== 401 && (await rechazada(res))) throw new ApiError(401, 'NO_AUTORIZADO', null, null);
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

export const get = <T>(u: string, signal?: AbortSignal) => api<T>('GET', u, undefined, signal);
export const post = <T>(u: string, b?: unknown) => api<T>('POST', u, b ?? {});
export const put = <T>(u: string, b: unknown) => api<T>('PUT', u, b);
