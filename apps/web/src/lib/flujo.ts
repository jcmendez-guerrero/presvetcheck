import type { SolicitudForzado } from '../componentes/forzado';

/** Estado efímero del flujo (forzado aceptado en Resultado → Dispensación). La API lo revalida todo. */
const forzados = new Map<string, SolicitudForzado>();
export const guardarForzado = (recetaId: string, linea: number, s: SolicitudForzado) => forzados.set(`${recetaId}:${linea}`, s);
export const leerForzado = (recetaId: string, linea: number) => forzados.get(`${recetaId}:${linea}`) ?? null;
