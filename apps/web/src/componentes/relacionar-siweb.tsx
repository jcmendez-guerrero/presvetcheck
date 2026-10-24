import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { ApiError, post, put } from '../lib/api';
import { CN } from '../lib/textos';
import { Boton, Campo, Mensaje } from './ui';

interface Variante {
  id: number;
  sku?: string | null;
  name?: string | null;
  product_name?: string | null;
}
type Resolucion =
  | { estado: 'MAPEADO'; variantes: { variantId: number; sku: string | null }[] }
  | { estado: 'ELEGIR' | 'NO_ENCONTRADO'; candidatos: Variante[] };
interface Mapeo {
  variante: Variante;
  cumpleConvencion: boolean;
  preguntarRenombrado: boolean;
}
type Tarea =
  | { tareaId: string; propuesta: { skuNuevo: string; nombreNuevo: string } }
  | { requierePrefijo: true; sugerido: string };

const nombreDe = (v: Variante) => [v.product_name, v.name].filter(Boolean).join(' · ') || `Variante ${v.id}`;
const mensajeDe = (e: unknown) =>
  e instanceof ApiError ? e.message : 'No se ha podido conectar con Siweb360';

/**
 * Cuando no se puede validar el stock de un código nacional en Siweb360 (no está relacionado con ningún
 * producto o no se ha podido leer), la persona indica qué producto de Siweb360 va a dispensar: se guarda la
 * relación CN ↔ SKU y se vuelve a leer el stock. La API de Siweb360 no permite editar productos, así que si el
 * SKU o el nombre no llevan el CN se ofrece crear la tarea de renombrado (bandeja «Pendiente en Siweb360»).
 */
export function RelacionarSiweb({
  cn,
  estado,
  onRelacionado,
}: {
  cn: string;
  estado: 'SIN_MAPEO' | 'NO_DISPONIBLE' | null;
  onRelacionado: () => void;
}) {
  const [sku, setSku] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<Mapeo | null>(null);
  const [tarea, setTarea] = useState<Tarea | null>(null);
  const [prefijo, setPrefijo] = useState('');
  const cand = useQuery({
    queryKey: ['siweb-candidatos', cn],
    queryFn: () => post<Resolucion>('/api/admin/mapeo-siweb/resolver', { cn }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const candidatos = cand.data && cand.data.estado !== 'MAPEADO' ? cand.data.candidatos : [];

  const relacionar = async (cuerpo: { variantId: number } | { sku: string }) => {
    setOcupado(true);
    setError(null);
    try {
      const r = await put<Mapeo>('/api/admin/mapeo-siweb', { cn, ...cuerpo });
      setHecho(r);
      onRelacionado();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setOcupado(false);
    }
  };
  const pedirRenombrado = async (prefijoConfirmado?: string) => {
    if (!hecho) return;
    setOcupado(true);
    setError(null);
    try {
      setTarea(
        await post<Tarea>('/api/admin/mapeo-siweb/tareas', {
          tipo: 'renombrar',
          cn,
          variantId: hecho.variante.id,
          origen: 'dispensacion',
          ...(prefijoConfirmado?.trim() ? { prefijoConfirmado: prefijoConfirmado.trim().toUpperCase() } : {}),
        }),
      );
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setOcupado(false);
    }
  };

  if (hecho)
    return (
      <div
        data-testid="relacion-siweb"
        className="mt-2 flex flex-col gap-2 rounded-lg bg-white p-3 text-sm ring-1 ring-dispensar"
      >
        <p className="font-semibold text-dispensar">
          Relacionado: {CN} {cn} → SKU {hecho.variante.sku ?? '—'} ({nombreDe(hecho.variante)}). Se vuelve a
          leer el stock.
        </p>
        {hecho.preguntarRenombrado && !tarea && (
          <>
            <p>
              En Siweb360 el SKU o el nombre de este producto no incluyen el código nacional. Siweb360 no
              permite cambiarlo desde la app: se crea una tarea para renombrarlo a mano.
            </p>
            <Boton variante="secundario" disabled={ocupado} onClick={() => void pedirRenombrado()}>
              Crear tarea de renombrado en Siweb360
            </Boton>
          </>
        )}
        {tarea && 'requierePrefijo' in tarea && (
          <div className="flex flex-wrap items-end gap-2">
            <Campo
              etiqueta="Prefijo de SKU para este laboratorio (primera vez)"
              value={prefijo || tarea.sugerido}
              onChange={(e) => setPrefijo(e.target.value)}
            />
            <Boton disabled={ocupado} onClick={() => void pedirRenombrado(prefijo || tarea.sugerido)}>
              Confirmar prefijo
            </Boton>
          </div>
        )}
        {tarea && 'tareaId' in tarea && (
          <p className="font-semibold">
            Tarea creada en «Pendiente en Siweb360»: renombrar a SKU {tarea.propuesta.skuNuevo} ·{' '}
            {tarea.propuesta.nombreNuevo}
          </p>
        )}
        {error && <Mensaje tipo="error">{error}</Mensaje>}
      </div>
    );

  return (
    <div
      data-testid="relacionar-siweb"
      className="mt-2 flex flex-col gap-2 rounded-lg bg-white p-3 text-sm ring-1 ring-sustituir"
    >
      <p className="font-semibold">
        <Link2 aria-hidden className="mr-1 inline h-4 w-4" />
        {estado === 'SIN_MAPEO'
          ? `Este código nacional no está relacionado con ningún producto de Siweb360.`
          : estado === 'NO_DISPONIBLE'
            ? 'No se ha podido validar el stock en Siweb360.'
            : `${CN} ${cn}.`}{' '}
        Indica el producto de Siweb360 que vas a dispensar y quedará relacionado para las próximas veces.
      </p>
      {cand.isFetching && (
        <p className="animate-pulse text-slate-600">Buscando productos parecidos en Siweb360…</p>
      )}
      {candidatos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {candidatos.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-fondo p-2">
              <span>
                {nombreDe(v)}
                <br />
                <span className="text-slate-600">SKU {v.sku ?? '—'}</span>
              </span>
              <Boton
                variante="secundario"
                disabled={ocupado}
                onClick={() => void relacionar({ variantId: v.id })}
              >
                Es este
              </Boton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (sku.trim()) void relacionar({ sku: sku.trim() });
        }}
      >
        <Campo
          etiqueta="SKU en Siweb360 del envase que vas a dispensar"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
        />
        <Boton type="submit" disabled={ocupado || !sku.trim()}>
          {ocupado ? 'Comprobando en Siweb360…' : 'Relacionar'}
        </Boton>
      </form>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
    </div>
  );
}
