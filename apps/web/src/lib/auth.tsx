import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { configurarCabeceras, get } from './api';

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
  /** Alta manual de recetas sin imagen (specs/011). */
  altaManualHabilitada?: boolean;
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
const REINTENTO_LOGIN = 'mmx.reintentoLogin';

/** Respuesta de /api/me con forma de usuario (la plataforma puede devolver HTML con estado 200). */
function esUsuario(u: unknown): u is Usuario {
  return (
    typeof u === 'object' &&
    u !== null &&
    typeof (u as Usuario).id === 'string' &&
    Array.isArray((u as Usuario).roles)
  );
}

const escribir = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* almacenamiento no disponible */
  }
};

/**
 * Autenticación. Modo dev: selector de usuario/rol (cabecera x-dev-user; la API lo prohíbe en producción).
 * Modo entra: autenticación integrada de Container Apps; se usa el id_token de /.auth/me como Bearer.
 */
export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConfigPublica | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
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
        .then((c) => activo && setConfig(c))
        .catch(() => {
          if (!activo) return;
          setTimeout(cargar, espera);
          espera = Math.min(espera * 2, 5000);
        });
    void cargar();
    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    if (config.authMode === 'dev') {
      configurarCabeceras(async () => ({ 'x-dev-user': devId, ...(mfaDev ? { 'x-dev-mfa': '1' } : {}) }));
    } else {
      configurarCabeceras(async () => {
        const r = await fetch('/.auth/me');
        if (!r.ok) {
          window.location.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(location.pathname)}`;
          return {};
        }
        // Con token store se envía el id_token. Sin él, /.auth/me no lo atiende la plataforma (llega a la app y
        // devuelve HTML) y basta la cabecera X-MS-CLIENT-PRINCIPAL que inyecta en cada petición a la API.
        if (!(r.headers.get('content-type') ?? '').includes('json')) return {};
        const [s] = ((await r.json().catch(() => [])) as Array<{ id_token?: string }>) ?? [];
        return s?.id_token ? { Authorization: `Bearer ${s.id_token}` } : {};
      });
    }
    void get<unknown>('/api/me')
      .then((u) => {
        if (esUsuario(u)) return setUsuario(u);
        // No es el usuario (p. ej. la página HTML de la plataforma con la sesión de Entra caducada): se vuelve a
        // iniciar sesión, como mucho una vez por minuto para no entrar en bucle.
        setUsuario(null);
        if (config.authMode === 'entra' && Date.now() - Number(leer(REINTENTO_LOGIN) ?? 0) > 60_000) {
          escribir(REINTENTO_LOGIN, String(Date.now()));
          window.location.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(location.pathname)}`;
        }
      })
      .catch(() => setUsuario(null));
  }, [config, devId, mfaDev]);

  const value: Ctx = {
    config,
    usuario,
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
