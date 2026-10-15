import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { RecetaConfirmadaInput } from '@mmx/shared';
import { ApiError, get, put } from '../lib/api';
import { Pagina } from '../componentes/layout';
import { Boton, Cargando, Mensaje, Tarjeta } from '../componentes/ui';
import { DatosRegistro, TextoReconocido } from './revision';

/**
 * Completar el registro después de dispensar (dispensación ágil): datos del titular, del veterinario,
 * indicación y posología. Lo comprobado antes de dispensar no se puede cambiar aquí.
 */
export function Registro() {
  const { id } = useParams({ from: '/recetas/$id/registro' });
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['receta-registro', id],
    queryFn: () =>
      get<{
        confirmacion: RecetaConfirmadaInput | null;
        extraccion: { ocrTexto: string | null } | null;
        dudosos: string[];
        imagenes: { pagina: number; url: string; mime: string }[];
      }>(`/api/recetas/${id}`),
    staleTime: 0,
    gcTime: 0,
  });
  const urlImg = q.data?.imagenes[0]?.url;
  const imagen = useQuery({
    queryKey: ['imagen', urlImg],
    queryFn: async () => URL.createObjectURL(await get<Blob>(urlImg as string)),
    enabled: !!urlImg,
    staleTime: Infinity,
  });
  const [r, setR] = useState<RecetaConfirmadaInput | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (q.data?.confirmacion && q.isFetchedAfterMount && !r) setR(q.data.confirmacion);
  }, [q.data, q.isFetchedAfterMount, r]);

  if (!q.data || !r) return <Cargando />;
  const dud = (k: string) => q.data.dudosos.includes(k);
  const guardar = async () => {
    setGuardando(true);
    setMsg(null);
    try {
      await put(`/api/recetas/${id}/registro`, r);
      await nav({ to: '/pendientes' });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se ha podido guardar');
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Pagina
      titulo={`Completar el registro · receta ${r.numero ?? ''}`}
      acciones={
        <Link to="/pendientes" className="font-semibold text-marca underline">
          Volver a Pendientes
        </Link>
      }
    >
      <p className="text-slate-700">
        Transcribe de la receta los datos para el registro. Los campos marcados «Revisar» no se han podido
        leer bien.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
          <Tarjeta>
            <div className="max-h-[60vh] overflow-auto rounded-xl bg-slate-100">
              {imagen.data && <img src={imagen.data} alt="Receta" className="w-full" />}
            </div>
          </Tarjeta>
          {q.data.extraccion?.ocrTexto && <TextoReconocido texto={q.data.extraccion.ocrTexto} />}
        </div>
        <div className="flex flex-col gap-5">
          <Tarjeta titulo="Datos para el registro">
            <DatosRegistro r={r} set={(f) => setR((x) => (x ? f(x) : x))} dud={dud} />
          </Tarjeta>
          {msg && <Mensaje tipo="error">{msg}</Mensaje>}
          <Boton data-testid="guardar-registro" disabled={guardando} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Guardar el registro'}
          </Boton>
        </div>
      </div>
    </Pagina>
  );
}
