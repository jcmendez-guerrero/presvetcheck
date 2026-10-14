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
  escrituraStock: string;
  fechaCorteEntradas: string | null;
  telefonoFarmacia: string;
}

export const USUARIOS_DEV = [
  { id: 'dev-empleado', etiqueta: 'Empleada' },
  { id: 'dev-garante', etiqueta: 'Farmacéutico garante' },
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
  const [devId, setDevId] = useState(leer('mmx.devUser') ?? 'dev-empleado');
  const [mfaDev, setMfaDev] = useState(leer('mmx.devMfa') === '1');

  useEffect(() => {
    void get<ConfigPublica>('/api/config/publica').then(setConfig);
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
        const [s] = (await r.json()) as Array<{ id_token?: string }>;
        return s?.id_token ? { Authorization: `Bearer ${s.id_token}` } : {};
      });
    }
    void get<Usuario>('/api/me').then(setUsuario).catch(() => setUsuario(null));
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
    tiene: (...roles) => !!usuario?.roles.some((r) => roles.includes(r)),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('Sin ProveedorAuth');
  return c;
}
