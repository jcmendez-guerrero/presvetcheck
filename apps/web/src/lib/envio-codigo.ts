import { MAX_CODIGO_MOVIL } from '@mmx/shared';

/**
 * Envío de un código leído con el móvil al ordenador (spec 016). Lógica pura (sin React) para probarla: cada lectura
 * tiene un `id`, pasa por `enviando` y acaba en uno de los estados finales; solo `enviada` significa que el sistema
 * aceptó el código (204 de la API). Reenviar la misma lectura con el mismo `id` no la duplica en el servidor.
 */
export type EstadoLectura = 'enviando' | 'enviada' | 'por-reintentar' | 'sin-emparejamiento' | 'rechazada';

export interface Lectura {
  id: string;
  raw: string;
  /** Momento de la lectura (ISO). */
  leidoAt: string;
  estado: EstadoLectura;
  /** Texto en español claro del último fallo. */
  motivo: string | null;
}

export type ResultadoEnvio = { estado: Exclude<EstadoLectura, 'enviando'>; motivo: string | null };

export const TEXTO_SIN_RED = 'No se ha enviado: comprueba la conexión del móvil';
export const TEXTO_CADUCADO = 'El emparejamiento ha caducado: vuelve a leer el código QR del ordenador';
export const TEXTO_LARGO = 'El código es demasiado largo para enviarlo';
export const TEXTO_INVALIDO = 'El código no es válido';

/** Solo la «por reintentar» se puede volver a enviar; en las demás reintentar no puede funcionar. */
export const sePuedeReintentar = (l: Lectura) => l.estado === 'por-reintentar';

/** UUID v4 con `getRandomValues`: `crypto.randomUUID` no existe sin HTTPS (el móvil puede abrir la web por HTTP). */
export function nuevoId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Envía la lectura. Solo un 204 es éxito: una redirección o una página de la plataforma (200 con HTML, 403…)
 * no es la API y se trata como fallo temporal reintentable. El 401 y el 400 cuentan solo si traen el cuerpo de error
 * propio de la API.
 */
export async function enviarCodigo(
  token: string,
  l: Pick<Lectura, 'id' | 'raw'>,
  enviar: typeof fetch = fetch,
): Promise<ResultadoEnvio> {
  if (!l.raw.trim()) return { estado: 'rechazada', motivo: TEXTO_INVALIDO };
  if (l.raw.length > MAX_CODIGO_MOVIL) return { estado: 'rechazada', motivo: TEXTO_LARGO };
  let r: Response;
  try {
    r = await enviar('/api/movil/m/codigos', {
      method: 'POST',
      headers: { 'x-movil-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: l.raw, id: l.id }),
    });
  } catch {
    return { estado: 'por-reintentar', motivo: TEXTO_SIN_RED };
  }
  if (r.status === 204) return { estado: 'enviada', motivo: null };
  const deLaApi = await r
    .json()
    .then((j: { error?: { code?: unknown } }) => typeof j?.error?.code === 'string')
    .catch(() => false);
  if (deLaApi && r.status === 401) return { estado: 'sin-emparejamiento', motivo: TEXTO_CADUCADO };
  if (deLaApi && r.status === 400) return { estado: 'rechazada', motivo: TEXTO_INVALIDO };
  return { estado: 'por-reintentar', motivo: TEXTO_SIN_RED };
}

/** Lecturas que se conservan: las no enviadas (nunca se pierden) y las 5 últimas enviadas; la más nueva primero. */
export const MAX_ENVIADAS = 5;
export function recortar(ls: Lectura[]): Lectura[] {
  let enviadas = 0;
  return ls.filter((l) => l.estado !== 'enviada' || ++enviadas <= MAX_ENVIADAS);
}

const CLAVE = 'mmx.movil.lecturas';
type Almacen = Pick<Storage, 'getItem' | 'setItem'>;

export function guardarLecturas(ls: Lectura[], a: Almacen = sessionStorage): void {
  try {
    a.setItem(CLAVE, JSON.stringify(recortar(ls)));
  } catch {
    /* sin almacenamiento: el estado dura lo que la página */
  }
}

/**
 * Lecturas guardadas. Una que seguía `enviando` al cerrarse la página no se sabe si llegó: pasa a `por-reintentar`
 * (reenviarla es seguro porque el servidor ignora un `id` ya publicado).
 */
export function cargarLecturas(a: Almacen = sessionStorage): Lectura[] {
  try {
    const ls = JSON.parse(a.getItem(CLAVE) ?? '[]') as Lectura[];
    if (!Array.isArray(ls)) return [];
    return ls.map((l) =>
      l.estado === 'enviando' ? { ...l, estado: 'por-reintentar', motivo: TEXTO_SIN_RED } : l,
    );
  } catch {
    return [];
  }
}
