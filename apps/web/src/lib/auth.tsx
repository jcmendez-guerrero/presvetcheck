import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, configurarCabeceras, configurarNoAutorizado, get } from './api';
import {
  CLAVE_CERRADA,
  CLAVE_REINTENTO,
  LIMITE_COMPROBACION_MS,
  puedeRedirigir,
  rutaRetorno,
  urlLogin,
  urlLogout,
  type EstadoSesion,
} from './sesion';

export interface Usuario {
  id: string;
  nombre: string;
  roles: string[];
  mfa: boolean;
}
export interface ConfigPublica {
  authMode: 'dev' | 'entra';
  extractor: string;
  umbralConfianza: number;
  scannerGsSubstitute: string | null;
  modoSustitucion: 'PRE' | 'POST';
  permitirParcial: boolean;
  stock: 'siweb' | 'demo';
  ventas?: 'siweb' | 'demo' | 'off';
  escrituraStock: string;
  modoRetrospectivoHabilitado?: boolean;
  fechaCorteEntradas: string | null;
  telefonoFarmacia: string;
}

export const USUARIOS_DEV = [
  { id: 'dev-empleado', etiqueta: 'Empleada' },
  { id: 'dev-veterinaria', etiqueta: 'Veterinaria responsable' },
  { id: 'dev-admin', etiqueta: 'Administración' },
];

interface Ctx {
  config: ConfigPublica | null;
  usuario: Usuario | null;
  estado: EstadoSesion;
  /** Inicio de sesión pedido por el usuario (ignora la protección contra bucles). */
  iniciarSesion: () => void;
  /** Cierra sesión; en modo entra no se vuelve a entrar sin que el usuario lo pida. */
  cerrarSesion: () => void;
  cambiarUsuarioDev: (id: string) => void;
  mfaDev: boolean;
  cambiarMfaDev: (v: boolean) => void;
  tiene: (...roles: string[]) => boolean;
}
const AuthCtx = createContext<Ctx | null>(null);

const leer = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const escribir = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* almacenamiento no disponible */
  }
};
const borrar = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* almacenamiento no disponible */
  }
};

/** Respuesta de /api/me con forma de usuario (la plataforma puede devolver HTML con estado 200). */
function esUsuario(u: unknown): u is Usuario {
  return (
    typeof u === 'object' &&
    u !== null &&
    typeof (u as Usuario).id === 'string' &&
    Array.isArray((u as Usuario).roles)
  );
}

const irALogin = () => {
  escribir(CLAVE_REINTENTO, String(Date.now()));
  window.location.href = urlLogin(rutaRetorno(location.pathname, location.search, location.hash));
};

/**
 * Autenticación. Modo dev: selector de usuario/rol (cabecera x-dev-user; la API lo prohíbe en producción).
 * Modo entra: autenticación integrada de Container Apps; se usa el id_token de /.auth/me como Bearer.
 *
 * La sesión perdida la detecta el cliente: el service worker sirve la aplicación al recargar (la plataforma no
 * llega a redirigir), /.auth/me puede entregar un id_token ya caducado (la API responde 401) y, sin la cabecera
 * X-Requested-With, la plataforma respondería con un 302 a Microsoft en vez de 401. Un 401 se intenta resolver
 * renovando la sesión una vez; si no, se redirige a Microsoft (como mucho una vez por minuto) o se muestra la página
 * de acceso. Un fallo de red, un 5xx o la falta de respuesta significan «servidor no disponible», nunca «sin sesión».
 * Ver specs/009-fix-session-expiry-sso/research.md.
 */
export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConfigPublica | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [estado, setEstado] = useState<EstadoSesion>('conectando');
  const estadoRef = useRef<EstadoSesion>('conectando');
  const fijar = useRef((e: EstadoSesion) => {
    estadoRef.current = e;
    setEstado(e);
  }).current;
  // Fuerza una nueva comprobación de sesión tras un fallo de conexión.
  const [intento, setIntento] = useState(0);
  const esperaRef = useRef(1000);
  const refrescoRef = useRef<Promise<boolean> | null>(null);
  // Un usuario dev guardado que ya no existe (p. ej. el antiguo garante) vuelve a la empleada.
  const [devId, setDevId] = useState(() => {
    const g = leer('mmx.devUser');
    return USUARIOS_DEV.some((u) => u.id === g) ? (g as string) : 'dev-empleado';
  });
  const [mfaDev, setMfaDev] = useState(leer('mmx.devMfa') === '1');

  useEffect(() => {
    // La API puede tardar en arrancar (p. ej. `pnpm demo` carga el Nomenclátor completo): se reintenta
    // hasta que responda en lugar de quedarse en "Iniciando sesión…".
    let activo = true;
    let espera = 1000;
    const cargar = () =>
      get<ConfigPublica>('/api/config/publica')
        .then((c) => {
          if (!activo) return;
          setConfig(c);
          fijar('comprobando');
        })
        .catch(() => {
          if (!activo) return;
          setTimeout(cargar, espera);
          espera = Math.min(espera * 2, 5000);
        });
    void cargar();
    return () => {
      activo = false;
    };
  }, [fijar]);

  useEffect(() => {
    if (!config) return;
    const entra = config.authMode === 'entra';
    if (entra) {
      configurarCabeceras(async () => {
        const r = await fetch('/.auth/me');
        // Sin sesión de plataforma no se envía token: la API responde 401 y lo resuelve un único camino.
        if (!r.ok) return {};
        // Con token store se envía el id_token. Sin él, /.auth/me no lo atiende la plataforma (llega a la app y
        // devuelve HTML) y basta la cabecera X-MS-CLIENT-PRINCIPAL que inyecta en cada petición a la API.
        if (!(r.headers.get('content-type') ?? '').includes('json')) return {};
        const [s] = ((await r.json().catch(() => [])) as Array<{ id_token?: string }>) ?? [];
        return s?.id_token ? { Authorization: `Bearer ${s.id_token}` } : {};
      });
      // Una sola renovación en curso aunque fallen varias peticiones a la vez.
      const refrescar = () =>
        (refrescoRef.current ??= fetch('/.auth/refresh', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
          .then(
            (r) => r.ok,
            () => false,
          )
          .finally(() => {
            refrescoRef.current = null;
          }));
      configurarNoAutorizado(async () => {
        // Ya caducada: no se renueva otra vez (react-query reintenta las consultas fallidas).
        if (estadoRef.current === 'caducada') return false;
        const ok = await refrescar();
        if (!ok && estadoRef.current === 'activa') fijar('caducada');
        return ok;
      });
    } else {
      configurarCabeceras(async () => ({ 'x-dev-user': devId, ...(mfaDev ? { 'x-dev-mfa': '1' } : {}) }));
      configurarNoAutorizado(null);
    }

    const sesionPerdida = () => {
      setUsuario(null);
      if (entra && puedeRedirigir(Date.now(), Number(leer(CLAVE_REINTENTO)) || null, leer(CLAVE_CERRADA) === '1')) {
        fijar('redirigiendo');
        irALogin();
      } else {
        fijar('sin-sesion');
      }
    };

    let activo = true;
    let limite: ReturnType<typeof setTimeout> | undefined;
    let reintento: ReturnType<typeof setTimeout> | undefined;
    const tiempoAgotado = new Promise<never>((_, rechazar) => {
      limite = setTimeout(() => rechazar(new Error('tiempo agotado')), LIMITE_COMPROBACION_MS);
    });
    Promise.race([get<unknown>('/api/me'), tiempoAgotado])
      .then((u) => {
        if (!activo) return;
        esperaRef.current = 1000;
        if (!esUsuario(u)) return sesionPerdida();
        setUsuario(u);
        if (u.roles.length === 0) return fijar('sin-acceso');
        borrar(CLAVE_REINTENTO);
        borrar(CLAVE_CERRADA);
        fijar('activa');
      })
      .catch((e: unknown) => {
        if (!activo) return;
        if (e instanceof ApiError && e.status === 401) return sesionPerdida();
        // Red caída, error del servidor o sin respuesta: se sigue intentando, nunca se manda a Microsoft.
        fijar('conectando');
        reintento = setTimeout(() => setIntento((n) => n + 1), esperaRef.current);
        esperaRef.current = Math.min(esperaRef.current * 2, 5000);
      })
      .finally(() => clearTimeout(limite));
    return () => {
      activo = false;
      clearTimeout(limite);
      clearTimeout(reintento);
    };
  }, [config, devId, mfaDev, intento, fijar]);

  const value: Ctx = {
    config,
    usuario,
    estado,
    iniciarSesion: () => {
      borrar(CLAVE_CERRADA);
      fijar('redirigiendo');
      irALogin();
    },
    cerrarSesion: () => {
      if (config?.authMode === 'entra') {
        escribir(CLAVE_CERRADA, '1');
        window.location.href = urlLogout();
      } else {
        window.location.reload();
      }
    },
    cambiarUsuarioDev: (id) => {
      escribir('mmx.devUser', id);
      setDevId(id);
    },
    mfaDev,
    cambiarMfaDev: (v) => {
      escribir('mmx.devMfa', v ? '1' : '0');
      setMfaDev(v);
    },
    tiene: (...roles) => !!usuario?.roles?.some((r) => roles.includes(r)),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('Sin ProveedorAuth');
  return c;
}
