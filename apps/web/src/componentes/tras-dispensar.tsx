import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecetaConfirmadaInput } from '@mmx/shared';
import { ApiError, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CN } from '../lib/textos';
import { DatosRegistro } from '../paginas/revision';
import { Boton, Campo, Mensaje, Tarjeta } from './ui';

type EstadoSalida = 'conciliada' | 'pendiente' | 'discrepancia';
interface RecetaRegistro {
  confirmacion: RecetaConfirmadaInput | null;
  dudosos: string[];
  registroCompletadoAt: string | null;
}

const TEXTO_ESTADO: Record<EstadoSalida, { t: string; c: string }> = {
  conciliada: { t: 'Conciliada con el ticket del TPV', c: 'bg-dispensar-bg text-dispensar' },
  pendiente: {
    t: 'Pendiente de conciliar: aún no hay ticket con este medicamento',
    c: 'bg-pedir-bg text-pedir',
  },
  discrepancia: {
    t: 'Discrepancia con el ticket: revísala en Pendientes',
    c: 'bg-noconforme-bg text-noconforme',
  },
};

/**
 * Tras confirmar la dispensación: datos para el registro de salidas (ahora o «Dejar pendiente») y estado de la
 * conciliación con el ticket del TPV. En la demo, «Simular cobro en TPV» crea el ticket.
 */
export function TrasDispensar({
  recetaId,
  cobro,
}: {
  recetaId: string;
  cobro: { cn: string; lote: string; unidades: number }[];
}) {
  const { config } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['receta-tras', recetaId],
    queryFn: () => get<RecetaRegistro>(`/api/recetas/${recetaId}`),
    staleTime: 0,
    gcTime: 0,
  });
  const conc = useQuery({
    queryKey: ['conciliacion', recetaId],
    queryFn: () =>
      get<{ configurado: boolean; salidas: { dispensacionId: string; estado: EstadoSalida }[] }>(
        `/api/recetas/${recetaId}/conciliacion`,
      ),
  });
  const [r, setR] = useState<RecetaConfirmadaInput | null>(null);
  const [estado, setEstado] = useState<'editando' | 'guardado' | 'pendiente'>('editando');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (q.data?.confirmacion && q.isFetchedAfterMount && !r) setR(q.data.confirmacion);
  }, [q.data, q.isFetchedAfterMount, r]);

  const pendienteRegistro =
    !!q.data?.confirmacion?.registroDiferido && !q.data.registroCompletadoAt && estado === 'editando';
  const guardar = async () => {
    setMsg(null);
    try {
      await put(`/api/recetas/${recetaId}/registro`, r);
      setEstado('guardado');
      await qc.invalidateQueries({ queryKey: ['conciliacion', recetaId] });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se ha podido guardar');
    }
  };

  return (
    <>
      {config?.ventas === 'demo' && (
        <CobroDemo
          cobro={cobro}
          onCobrado={() => void qc.invalidateQueries({ queryKey: ['conciliacion', recetaId] })}
        />
      )}
      {pendienteRegistro && r && (
        <Tarjeta titulo="Datos para el registro de salidas">
          <p className="mb-3 text-slate-700">
            Ya está dispensado. Transcribe ahora los datos de la receta o déjalo pendiente para más tarde.
          </p>
          <DatosRegistro
            r={r}
            set={(f) => setR((x) => (x ? f(x) : x))}
            dud={(k) => q.data?.dudosos.includes(k) ?? false}
          />
          {msg && <Mensaje tipo="error">{msg}</Mensaje>}
          <div className="mt-4 flex flex-wrap gap-3">
            <Boton data-testid="guardar-registro" onClick={() => void guardar()}>
              Guardar el registro
            </Boton>
            <Boton variante="secundario" data-testid="dejar-pendiente" onClick={() => setEstado('pendiente')}>
              Dejar pendiente
            </Boton>
          </div>
        </Tarjeta>
      )}
      {estado === 'guardado' && <Mensaje tipo="ok">Registro guardado.</Mensaje>}
      {estado === 'pendiente' && (
        <Mensaje tipo="aviso">
          Registro pendiente: lo tienes en{' '}
          <Link to="/pendientes" className="font-semibold underline">
            Pendientes
          </Link>
          .
        </Mensaje>
      )}
      {conc.data?.configurado && (
        <Tarjeta titulo="Conciliación con el TPV">
          <ul className="flex flex-col gap-2">
            {conc.data.salidas.map((s, i) => (
              <li
                key={s.dispensacionId}
                data-testid="estado-conciliacion"
                className={`rounded-lg px-3 py-2 font-semibold ${TEXTO_ESTADO[s.estado].c}`}
              >
                Salida {i + 1}: {TEXTO_ESTADO[s.estado].t}
              </li>
            ))}
          </ul>
          <Boton
            className="mt-3"
            variante="secundario"
            onClick={() =>
              void post('/api/conciliacion', {}).then(() =>
                qc.invalidateQueries({ queryKey: ['conciliacion', recetaId] }),
              )
            }
          >
            Comprobar ahora
          </Boton>
        </Tarjeta>
      )}
    </>
  );
}

/** Demo: simula el cobro en el TPV (crea el ticket) para ver la conciliación. Las unidades se pueden cambiar. */
function CobroDemo({
  cobro,
  onCobrado,
}: {
  cobro: { cn: string; unidades: number }[];
  onCobrado: () => void;
}) {
  const [uds, setUds] = useState(() => cobro.map((c) => c.unidades));
  const [hecho, setHecho] = useState<string | null>(null);
  return (
    <Tarjeta titulo="Demo: cobro en el TPV" className="border-2 border-dashed border-dorado">
      <p className="mb-2 text-sm text-slate-700">
        En la tienda esto lo hace el TPV de Siweb360. Aquí puedes simular el ticket (cambia las unidades para
        provocar una discrepancia).
      </p>
      {cobro.map((c, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3">
          <span className="pb-3">
            {CN} {c.cn}
          </span>
          <Campo
            etiqueta="Unidades cobradas"
            type="number"
            min={1}
            value={uds[i] ?? 1}
            onChange={(e) => setUds((u) => u.map((x, j) => (j === i ? Number(e.target.value) || 1 : x)))}
          />
        </div>
      ))}
      <Boton
        className="mt-3"
        data-testid="simular-cobro"
        disabled={!!hecho}
        onClick={async () => {
          const tickets = [];
          for (const [i, c] of cobro.entries())
            tickets.push(
              (await post<{ numero: string }>('/api/demo/tpv', { cn: c.cn, unidades: uds[i] ?? c.unidades }))
                .numero,
            );
          setHecho(tickets.join(', '));
          // Con el ticket ya creado se intenta conciliar (como haría el job o «Comprobar ahora»).
          await post('/api/conciliacion', {});
          onCobrado();
        }}
      >
        Simular cobro en TPV
      </Boton>
      {hecho && <p className="mt-2 text-sm">Ticket simulado: {hecho}</p>}
    </Tarjeta>
  );
}
