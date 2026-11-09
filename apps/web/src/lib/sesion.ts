/**
 * Utilidades puras de la sesión (sin reloj implícito ni acceso al navegador): estados, dirección de vuelta tras
 * iniciar sesión y protección contra bucles de redirección. Ver specs/009-fix-session-expiry-sso/data-model.md.
 */

export type EstadoSesion =
  'conectando' | 'comprobando' | 'activa' | 'sin-acceso' | 'redirigiendo' | 'sin-sesion' | 'caducada';

/** Ventana en la que no se repite la redirección automática a Microsoft. */
export const VENTANA_REINTENTO_MS = 60_000;
/** Tiempo máximo de la comprobación de sesión; pasado, se trata como servidor no disponible. */
export const LIMITE_COMPROBACION_MS = 15_000;
/** Momento de la última redirección automática (compartido entre pestañas). */
export const CLAVE_REINTENTO = 'mmx.reintentoLogin';
/** Marca de «el usuario cerró sesión»: no se vuelve a entrar sin que lo pida. */
export const CLAVE_CERRADA = 'mmx.sesionCerrada';

/** Dirección de vuelta: solo rutas de esta aplicación; cualquier otra cosa vuelve al inicio. */
export function rutaRetorno(pathname: string, search: string, hash: string): string {
  const ruta = `${pathname}${search}${hash}`;
  if (
    !ruta.startsWith('/') ||
    ruta.startsWith('//') ||
    ruta.startsWith('/\\') ||
    ruta.startsWith('/.auth/')
  ) {
    return '/';
  }
  return ruta;
}

/** Se puede redirigir automáticamente si el usuario no cerró sesión y no se intentó hace menos de un minuto. */
export function puedeRedirigir(
  ahora: number,
  ultimoIntento: number | null,
  cerradaPorUsuario: boolean,
): boolean {
  if (cerradaPorUsuario) return false;
  return ultimoIntento === null || ahora - ultimoIntento > VENTANA_REINTENTO_MS;
}

export const urlLogin = (retorno: string) =>
  `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(retorno)}`;

export const urlLogout = () => `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent('/')}`;
