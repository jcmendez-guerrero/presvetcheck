import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { MIN_LETRAS_BUSQUEDA, type EstadoBusqueda as Estado } from '../lib/busqueda';
import { Boton } from './ui';

/**
 * Mensaje bajo un buscador de medicamentos: «Buscando…», sin resultados o error con reintento. Es una única zona
 * `role="status"` que no se desmonta, para que el lector de pantalla anuncie cada cambio.
 */
export function EstadoBusqueda({
  estado,
  texto,
  resultados = 0,
  onReintentar,
}: {
  estado: Estado;
  texto: string;
  resultados?: number;
  onReintentar: () => void;
}) {
  const t = texto.trim();
  return (
    <div role="status" aria-live="polite" data-testid="estado-busqueda" className="mt-2 text-sm">
      {estado === 'corto' && (
        <p className="text-slate-600 dark:text-slate-300">
          Escribe al menos {MIN_LETRAS_BUSQUEDA} letras del nombre o del principio activo.
        </p>
      )}
      {estado === 'buscando' && (
        <p className="flex items-center gap-2 font-semibold text-marca dark:text-acento">
          <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
          Buscando «{t}»…
        </p>
      )}
      {estado === 'error' && (
        <p className="flex flex-wrap items-center gap-2 font-semibold text-red-800 dark:text-red-300">
          No se ha podido consultar el catálogo ahora.
          <Boton variante="texto" tamano="sm" data-testid="reintentar-busqueda" onClick={onReintentar}>
            Volver a intentar
          </Boton>
        </p>
      )}
      {estado === 'vacio' && (
        <p className="font-semibold text-sustituir">
          No se ha encontrado ningún medicamento con «{t}». Prueba con otra parte del nombre o con el
          principio activo.
        </p>
      )}
      {estado === 'resultados' && (
        <p className="sr-only">
          {resultados} {resultados === 1 ? 'resultado' : 'resultados'}
        </p>
      )}
    </div>
  );
}

/** Lista de resultados: mientras llega la búsqueda nueva, la anterior se atenúa y no se puede elegir. */
export function ListaResultados({ desfasada, children }: { desfasada: boolean; children: ReactNode }) {
  return (
    <div
      data-testid="lista-resultados"
      aria-busy={desfasada}
      inert={desfasada}
      className={`transition-opacity ${desfasada ? 'opacity-50' : ''}`}
    >
      {children}
    </div>
  );
}
