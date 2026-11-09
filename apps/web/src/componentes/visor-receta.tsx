import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { get } from '../lib/api';
import { copiarAlPortapapeles } from '../lib/portapapeles';
import { Boton, Tarjeta } from './ui';

export interface ImagenReceta {
  pagina: number;
  url: string;
  mime: string;
}

/**
 * La receta en pantalla (imagen con zoom fluido, rotación angular y texto reconocido para copiar y pegar).
 * Acompaña a todo el proceso: revisión, qué dispensar, dispensación y registro de salidas.
 * Con soporte de panel dividido contiguo (side-by-side) para no requerir scroll hacia el texto OCR.
 */
export function VisorReceta({
  imagenes,
  ocrTexto,
  dividido = true,
}: {
  imagenes: ImagenReceta[];
  ocrTexto: string | null | undefined;
  dividido?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [rotacion, setRotacion] = useState<number>(0);
  const [pagina, setPagina] = useState(0);
  const img = imagenes[pagina];

  // Las imágenes se piden con autenticación (cabecera) y se muestran como blob local.
  const imagen = useQuery({
    queryKey: ['imagen', img?.url],
    queryFn: async () => URL.createObjectURL(await get<Blob>(img!.url)),
    enabled: !!img,
    staleTime: Infinity,
  });

  const rotar = () => {
    setRotacion((r) => (r + 90) % 360);
  };

  const resetearVista = () => {
    setZoom(1);
    setRotacion(0);
  };

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start" data-testid="visor-receta">
      <div className={ocrTexto && dividido ? 'grid gap-4 xl:grid-cols-2' : 'flex flex-col gap-4'}>
        <Tarjeta className="overflow-hidden">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-superficie-borde">
            <div className="flex flex-wrap items-center gap-1.5">
              {imagenes.map((im, i) => (
                <Boton
                  key={im.pagina}
                  tamano="sm"
                  variante={i === pagina ? 'principal' : 'secundario'}
                  onClick={() => {
                    setPagina(i);
                    resetearVista();
                  }}
                  className="text-xs"
                >
                  Página {im.pagina}
                </Boton>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Rotar 90 grados"
                title="Rotar 90°"
                onClick={rotar}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-texto hover:bg-slate-50 dark:bg-superficie dark:border-superficie-borde dark:text-acento cursor-pointer"
              >
                <RotateCw className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Reducir zoom"
                title="Reducir"
                onClick={() => setZoom((z) => Math.max(0.6, z - 0.25))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-texto hover:bg-slate-50 dark:bg-superficie dark:border-superficie-borde dark:text-acento cursor-pointer"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="inline-flex h-9 px-2 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-semibold text-texto hover:bg-slate-50 dark:bg-superficie dark:border-superficie-borde dark:text-acento cursor-pointer"
                title="Restablecer tamaño original (100%)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Ampliar zoom"
                title="Ampliar"
                onClick={() => setZoom((z) => Math.min(3.5, z + 0.25))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-texto hover:bg-slate-50 dark:bg-superficie dark:border-superficie-borde dark:text-acento cursor-pointer"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative max-h-[75vh] min-h-[300px] overflow-auto rounded-xl bg-slate-100 p-2 dark:bg-black/30 flex items-center justify-center">
            {img && img.mime !== 'application/pdf' ? (
              <div
                className="transition-transform duration-150 origin-center flex items-center justify-center"
                style={{
                  transform: `scale(${zoom}) rotate(${rotacion}deg)`,
                }}
              >
                <img
                  src={imagen.data}
                  alt={`Receta, página ${img.pagina}`}
                  className="max-w-full rounded shadow-sm object-contain select-none"
                />
              </div>
            ) : img ? (
              <iframe title="Receta en PDF" src={imagen.data} className="h-[70vh] w-full rounded" />
            ) : (
              <p className="p-6 text-slate-500">Sin imagen disponible</p>
            )}
          </div>
        </Tarjeta>

        {ocrTexto && (
          <div className="flex flex-col">
            <TextoReconocido texto={ocrTexto} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Texto reconocido de la receta, seleccionable, para copiar y pegar en los campos. */
export function TextoReconocido({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    const ok = await copiarAlPortapapeles(texto);
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };

  return (
    <Tarjeta titulo="Texto reconocido (OCR)">
      <div className="flex flex-col gap-2">
        <pre className="max-h-[68vh] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs text-texto select-text dark:bg-black/20 dark:border-superficie-borde dark:text-slate-200">
          {texto.replaceAll('--- página ---', '— página siguiente —')}
        </pre>
        <div className="flex items-center justify-between pt-1">
          <Boton variante="secundario" tamano="sm" className="text-xs" onClick={() => void copiar()}>
            {copiado ? (
              <>
                <CheckCircle2 aria-hidden className="h-4 w-4 text-dispensar" />
                <span>¡Copiado!</span>
              </>
            ) : (
              <>
                <Copy aria-hidden className="h-4 w-4" />
                <span>Copiar todo</span>
              </>
            )}
          </Boton>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Selecciona cualquier palabra para copiarla al formulario
          </span>
        </div>
      </div>
    </Tarjeta>
  );
}

/** Página en dos columnas: la receta fija a la izquierda y el paso del proceso a la derecha. */
export function ConReceta({ recetaId, children }: { recetaId: string; children: ReactNode }) {
  const q = useQuery({
    queryKey: ['receta-visor', recetaId],
    queryFn: () =>
      get<{ imagenes: ImagenReceta[]; extraccion: { ocrTexto: string | null } | null }>(
        `/api/recetas/${recetaId}`,
      ),
    staleTime: 60_000,
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      {q.data ? <VisorReceta imagenes={q.data.imagenes} ocrTexto={q.data.extraccion?.ocrTexto} /> : <div />}
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </div>
  );
}
