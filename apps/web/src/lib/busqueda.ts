import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get } from './api';

/** Pausa en la escritura antes de buscar: evita una búsqueda por cada letra. */
export const PAUSA_BUSQUEDA_MS = 300;
/** Pasado este tiempo sin respuesta, la búsqueda se da por fallida y se ofrece reintentar. */
export const TIEMPO_MAX_BUSQUEDA_MS = 10_000;
export const MIN_LETRAS_BUSQUEDA = 3;

export type EstadoBusqueda = 'corto' | 'buscando' | 'error' | 'vacio' | 'resultados';

/** Qué mensaje ve la persona bajo el buscador. El orden de las comprobaciones es la prioridad. */
export function estadoBusqueda(e: {
  letras: number;
  pendiente: boolean;
  error: boolean;
  n: number;
}): EstadoBusqueda {
  if (e.letras < MIN_LETRAS_BUSQUEDA) return 'corto';
  if (e.pendiente) return 'buscando';
  if (e.error) return 'error';
  return e.n === 0 ? 'vacio' : 'resultados';
}

/**
 * Búsqueda de medicamentos compartida por todos los buscadores. Solo vale la última búsqueda: la petición anterior
 * se anula y, mientras llega la nueva, la lista anterior se marca como desfasada para que no se pueda elegir.
 */
export function useBusquedaMedicamentos<T>(
  texto: string,
  { especie = null, activo = true }: { especie?: string | number | null; activo?: boolean } = {},
) {
  const limpio = texto.trim();
  const [estable, setEstable] = useState(limpio);
  useEffect(() => {
    const t = setTimeout(() => setEstable(limpio), PAUSA_BUSQUEDA_MS);
    return () => clearTimeout(t);
  }, [limpio]);

  const q = useQuery({
    queryKey: ['buscar', estable, especie],
    queryFn: ({ signal }) =>
      get<T[]>(
        `/api/medicamentos/buscar?q=${encodeURIComponent(estable)}${especie !== null ? `&especie=${especie}` : ''}`,
        // shortcut: sin AbortSignal.any (iPadOS < 17.4) se pierde solo el corte de 10 s; quitar cuando no haya tablets así.
        AbortSignal.any?.([signal, AbortSignal.timeout(TIEMPO_MAX_BUSQUEDA_MS)]) ?? signal,
      ),
    // Solo con el texto ya asentado: al pulsar «Cambiar» no se busca el nombre anterior.
    enabled: activo && limpio === estable && estable.length >= MIN_LETRAS_BUSQUEDA,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const corto = limpio.length < MIN_LETRAS_BUSQUEDA;
  const desfasada = !corto && (limpio !== estable || q.isPlaceholderData || q.isFetching);
  return {
    estado: estadoBusqueda({
      letras: limpio.length,
      pendiente: desfasada,
      error: q.isError,
      n: q.data?.length ?? 0,
    }),
    resultados: corto ? [] : (q.data ?? []),
    desfasada,
    reintentar: () => void q.refetch(),
  };
}
