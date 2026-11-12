import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ApiError, get, post } from './api';
import { BuzonAlbaranes } from './albaran-movil';

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
type Evento = { seq: number } & (
  | { tipo: 'leyendo' }
  | { tipo: 'receta'; recetaId: string; aviso: string | null }
  | { tipo: 'codigo'; raw: string }
  // Albarán o factura enviado desde el móvil: el id de la lectura (nulo si no se pudo leer).
  | { tipo: 'albaran'; documentoId: string | null }
);

interface Ctx {
  sesion: SesionMovil | null;
  conectado: boolean;
  leyendo: boolean;
  /** Código recibido sin ningún campo de escaneo abierto. */
  codigoSinDestino: string | null;
  /** Albarán recibido del móvil sin la pantalla de nueva recepción abierta (id de la lectura). */
  albaranSinDestino: string | null;
  /** El último albarán enviado desde el móvil no se pudo leer. */
  errorAlbaran: boolean;
  descartarAvisoAlbaran: () => void;
  abrir: () => Promise<SesionMovil>;
  cerrar: () => Promise<void>;
  suscribir: (fn: (raw: string) => void) => () => void;
  suscribirAlbaran: (fn: (documentoId: string) => void) => () => void;
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
  const navegar = useNavigate();
  const nav = useRef(navegar);
  nav.current = navegar;
  const [sesion, setSesion] = useState<SesionMovil | null>(leerSesion);
  const [conectado, setConectado] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [codigoSinDestino, setCodigoSinDestino] = useState<string | null>(null);
  const [albaranSinDestino, setAlbaranSinDestino] = useState<string | null>(null);
  // Reparte los albaranes del móvil; guarda el pendiente para la primera pantalla de recepción que se abra.
  const [buzon] = useState(() => new BuzonAlbaranes());
  const [errorAlbaran, setErrorAlbaran] = useState(false);
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
            void nav.current({ to: '/recetas/$id/revision', params: { id: e.recetaId } });
          } else if (e.tipo === 'albaran') {
            setLeyendo(false);
            if (!e.documentoId) setErrorAlbaran(true);
            else if (buzon.recibir(e.documentoId) === 'pendiente') setAlbaranSinDestino(e.documentoId);
          } else if (oyentes.current.size) oyentes.current.forEach((f) => f(e.raw));
          else setCodigoSinDestino(e.raw);
        }
      } catch (e) {
        // La sesión ya no existe (caducada, cerrada o la API se reinició): se olvida en lugar de reintentar.
        if (e instanceof ApiError && (e.status === 404 || e.status === 401 || e.status === 403)) {
          guardarSesion(null);
          if (activo) setSesion(null);
          return;
        }
        /* sin conexión: se reintenta */
      }
      if (activo) t = setTimeout(() => void consultar(), 1500);
    };
    void consultar();
    return () => {
      activo = false;
      clearTimeout(t);
    };
  }, [sesion]);

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

  const suscribirAlbaran = useCallback((fn: (documentoId: string) => void) => {
    // Si había un albarán esperando, el buzón se lo entrega a esta pantalla (no se pierde si la persona llega
    // por el menú en vez de por el botón del aviso).
    const baja = buzon.suscribir(fn);
    setAlbaranSinDestino(null);
    return baja;
  }, [buzon]);
  const descartarAvisoAlbaran = useCallback(() => {
    buzon.descartar();
    setAlbaranSinDestino(null);
    setErrorAlbaran(false);
  }, [buzon]);

  return (
    <MovilCtx.Provider
      value={{ sesion, conectado, leyendo, codigoSinDestino, albaranSinDestino, errorAlbaran, descartarAvisoAlbaran, abrir, cerrar, suscribir, suscribirAlbaran }}
    >
      {children}
    </MovilCtx.Provider>
  );
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

/** Recibe el id de lo leído de un albarán enviado desde el móvil mientras el componente esté montado. */
export function useAlbaranesMovil(fn: (documentoId: string) => void) {
  const m = useMovil();
  const ref = useRef(fn);
  ref.current = fn;
  const suscribir = m?.suscribirAlbaran;
  useEffect(() => (suscribir ? suscribir((id) => ref.current(id)) : undefined), [suscribir]);
}
