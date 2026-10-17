import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, ZoomIn, ZoomOut } from 'lucide-react';
import { get } from '../lib/api';
import { Boton, Tarjeta } from './ui';

export interface ImagenReceta {
  pagina: number;
  url: string;
  mime: string;
}

/**
 * La receta en pantalla (imagen con zoom y texto reconocido para copiar y pegar). Acompaña a todo el proceso:
 * revisión, qué dispensar, dispensación y registro de salidas.
 */
export function VisorReceta({ imagenes, ocrTexto }: { imagenes: ImagenReceta[]; ocrTexto: string | null | undefined }) {
  const [zoom, setZoom] = useState(1);
  const [pagina, setPagina] = useState(0);
  const img = imagenes[pagina];
  // Las imágenes se piden con autenticación (cabecera) y se muestran como blob local.
  const imagen = useQuery({
    queryKey: ['imagen', img?.url],
    queryFn: async () => URL.createObjectURL(await get<Blob>(img!.url)),
    enabled: !!img,
    staleTime: Infinity,
  });
  return (
    <div className="flex flex-col gap-5 lg:sticky lg:top-4 lg:self-start" data-testid="visor-receta">
      <Tarjeta>
        <div className="mb-2 flex flex-wrap gap-2">
          {imagenes.map((im, i) => (
            <Boton key={im.pagina} variante={i === pagina ? 'principal' : 'secundario'} onClick={() => setPagina(i)}>
              Página {im.pagina}
            </Boton>
          ))}
          <Boton variante="secundario" aria-label="Ampliar" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>
            <ZoomIn className="h-5 w-5" />
          </Boton>
          <Boton variante="secundario" aria-label="Reducir" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
            <ZoomOut className="h-5 w-5" />
          </Boton>
        </div>
        <div className="max-h-[70vh] overflow-auto rounded-xl bg-slate-100">
          {img && img.mime !== 'application/pdf' ? (
            <img src={imagen.data} alt={`Receta, página ${img.pagina}`} style={{ width: `${zoom * 100}%` }} />
          ) : img ? (
            <iframe title="Receta en PDF" src={imagen.data} className="h-[65vh] w-full" />
          ) : (
            <p className="p-6">Sin imagen</p>
          )}
        </div>
      </Tarjeta>
      {ocrTexto && <TextoReconocido texto={ocrTexto} />}
    </div>
  );
}

/** Texto reconocido de la receta, seleccionable, para copiar y pegar en los campos. */
export function TextoReconocido({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Tarjeta titulo="Texto reconocido (puedes copiar y pegar)">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm select-text">
        {texto.replaceAll('--- página ---', '— página siguiente —')}
      </pre>
      <Boton
        variante="texto"
        onClick={() =>
          void navigator.clipboard?.writeText(texto).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          })
        }
      >
        <Copy aria-hidden className="h-4 w-4" /> {copiado ? 'Copiado' : 'Copiar todo'}
      </Boton>
    </Tarjeta>
  );
}

/** Página en dos columnas: la receta fija a la izquierda y el paso del proceso a la derecha. */
export function ConReceta({ recetaId, children }: { recetaId: string; children: ReactNode }) {
  const q = useQuery({
    queryKey: ['receta-visor', recetaId],
    queryFn: () => get<{ imagenes: ImagenReceta[]; extraccion: { ocrTexto: string | null } | null }>(`/api/recetas/${recetaId}`),
    staleTime: 60_000,
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {q.data ? <VisorReceta imagenes={q.data.imagenes} ocrTexto={q.data.extraccion?.ocrTexto} /> : <div />}
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </div>
  );
}
