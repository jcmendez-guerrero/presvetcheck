import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { get, post } from './api';

/**
 * Lado del PC del emparejamiento con el móvil. Se guarda la sesión de esta pestaña (sessionStorage) y se
 * consultan los eventos cada 1,5 s: una receta subida desde el móvil abre su revisión; un código leído se
 * entrega al campo de escaneo que esté abierto (como si se hubiera leído con la cámara del PC).
 */
export interface SesionMovil {
  id: string;
  token: string;
  urlBase: string | null;
  expiraAt: string;
}
type Evento = { seq: number } & ({ tipo: 'leyendo' } | { tipo: 'receta'; recetaId: string; aviso: string | null } | { tipo: 'codigo'; raw: string });

interface Ctx {
  sesion: SesionMovil | null;
  conectado: boolean;
  leyendo: boolean;
  /** Código recibido sin ningún campo de escaneo abierto. */
  codigoSinDestino: string | null;
  abrir: () => Promise<SesionMovil>;
  cerrar: () => Promise<void>;
  suscribir: (fn: (raw: string) => void) => () => void;
}
const MovilCtx = createContext<Ctx | null>(null);
const CLAVE = 'mmx.movil';

const leerSesion = (): SesionMovil | null => {
  try {
    const s = JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null') as SesionMovil | null;
    return s && new Date(s.expiraAt) > new Date() ? s : null;
  } catch {
    return null;
  }
};
const guardarSesion = (s: SesionMovil | null) => {
  try {
    if (s) sessionStorage.setItem(CLAVE, JSON.stringify(s));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: la sesión dura lo que la página */
  }
};

/** Enlace que abre el móvil (el token va en el fragmento: no llega a los logs del servidor). */
export const enlaceMovil = (s: SesionMovil) => `${s.urlBase ?? location.origin}/movil#t=${s.token}`;

export function ProveedorMovil({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const [sesion, setSesion] = useState<SesionMovil | null>(leerSesion);
  const [conectado, setConectado] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [codigoSinDestino, setCodigoSinDestino] = useState<string | null>(null);
  const oyentes = useRef(new Set<(raw: string) => void>());
  const cursor = useRef(0);

  useEffect(() => {
    if (!sesion) return;
    let activo = true;
    let t: ReturnType<typeof setTimeout>;
    const consultar = async () => {
      try {
        const r = await get<{ activa: boolean; movilConectado: boolean; eventos: Evento[] }>(`/api/movil/sesiones/${sesion.id}/eventos?desde=${cursor.current}`);
        if (!activo) return;
        if (!r.activa) {
          guardarSesion(null);
          setSesion(null);
          return;
        }
        setConectado(r.movilConectado);
        for (const e of r.eventos) {
          cursor.current = e.seq;
          if (e.tipo === 'leyendo') setLeyendo(true);
          else if (e.tipo === 'receta') {
            setLeyendo(false);
            void nav({ to: '/recetas/$id/revision', params: { id: e.recetaId } });
          } else if (oyentes.current.size) oyentes.current.forEach((f) => f(e.raw));
          else setCodigoSinDestino(e.raw);
        }
      } catch {
        /* sin conexión: se reintenta */
      }
      if (activo) t = setTimeout(() => void consultar(), 1500);
    };
    void consultar();
    return () => {
      activo = false;
      clearTimeout(t);
    };
  }, [sesion, nav]);

  const abrir = useCallback(async () => {
    const s = await post<SesionMovil>('/api/movil/sesiones');
    cursor.current = 0;
    guardarSesion(s);
    setSesion(s);
    setConectado(false);
    return s;
  }, []);
  const cerrar = useCallback(async () => {
    if (sesion) await post(`/api/movil/sesiones/${sesion.id}/cerrar`).catch(() => {});
    guardarSesion(null);
    setSesion(null);
    setConectado(false);
    setLeyendo(false);
  }, [sesion]);
  const suscribir = useCallback((fn: (raw: string) => void) => {
    oyentes.current.add(fn);
    setCodigoSinDestino(null);
    return () => void oyentes.current.delete(fn);
  }, []);

  return <MovilCtx.Provider value={{ sesion, conectado, leyendo, codigoSinDestino, abrir, cerrar, suscribir }}>{children}</MovilCtx.Provider>;
}

export const useMovil = () => useContext(MovilCtx);

/** Recibe los códigos leídos con el móvil mientras el componente esté montado. */
export function useCodigosMovil(fn: (raw: string) => void) {
  const m = useMovil();
  const ref = useRef(fn);
  ref.current = fn;
  const suscribir = m?.suscribir;
  useEffect(() => (suscribir ? suscribir((raw) => ref.current(raw)) : undefined), [suscribir]);
}
