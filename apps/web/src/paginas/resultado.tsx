import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { CodigoIncidencia } from '@mmx/shared';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { guardarForzado } from '../lib/flujo';
import { CN, fecha } from '../lib/textos';
import type { Evaluacion, LineaEvaluada } from '../lib/tipos';
import { EstadoDecision, ListaMotivos } from '../componentes/estado';
import { ModalForzado } from '../componentes/forzado';
import { Pagina } from '../componentes/layout';
import { Boton, Cargando, Mensaje, Tarjeta } from '../componentes/ui';

/** Resultado por línea (SPEC §8.4): estado con icono y texto, motivos legibles y acción principal. */
export function Resultado() {
  const { id } = useParams({ from: '/recetas/$id/resultado' });
  const q = useQuery({ queryKey: ['evaluacion', id], queryFn: () => post<Evaluacion>(`/api/recetas/${id}/evaluar`), refetchOnWindowFocus: false });
  if (q.isLoading) return <Cargando texto="Comprobando la receta…" />;
  if (q.error) return <Mensaje tipo="error">{(q.error as Error).message}</Mensaje>;
  const e = q.data!;
  return (
    <Pagina titulo="Resultado" acciones={<Link to="/recetas/$id/revision" params={{ id }} className="font-semibold text-marca underline">Volver a la revisión</Link>}>
      <div className="flex flex-wrap items-center gap-3">
        {e.resumen && <EstadoDecision decision={e.resumen} grande />}
        {e.validez && <span>Válida hasta el {fecha(e.validez.efectiva)}</span>}
      </div>
      {e.lineas.map((l) => (
        <TarjetaLinea key={l.orden} l={l} recetaId={id} todas={e.lineas} />
      ))}
    </Pagina>
  );
}

function TarjetaLinea({ l, recetaId, todas }: { l: LineaEvaluada; recetaId: string; todas: LineaEvaluada[] }) {
  const nav = useNavigate();
  const { usuario } = useAuth();
  const [forzar, setForzar] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const ev = l.resultado.evidencias;
  const decision = l.resultado.decision;
  const forzables = [...new Set(l.incidencias.filter((i) => i.severidad === 'BLOQUEANTE_FORMA').map((i) => i.code))] as CodigoIncidencia[];
  const pendientes = todas.filter((x) => x.orden !== l.orden && !['DISPENSAR', 'DISPENSAR_CON_AVISO', 'SUSTITUIR'].includes(x.resultado.decision)).map((x) => x.orden);

  const irADispensar = (extra: Record<string, unknown> = {}) =>
    nav({ to: '/recetas/$id/dispensar/$linea', params: { id: recetaId, linea: String(l.orden) }, search: { pendientes: pendientes.join(','), ...extra } });

  const sustituir = async (cn: string) => {
    try {
      const s = await post<{ id: string }>('/api/sustituciones', { recetaId, lineaOrden: l.orden, cn });
      await nav({ to: '/sustituciones/$id', params: { id: s.id } });
    } catch (e) {
      setMsg({ t: 'error', m: e instanceof ApiError ? e.message : 'Error' });
    }
  };

  return (
    <Tarjeta titulo={<span className="flex flex-wrap items-center gap-3">Medicamento {l.orden} <EstadoDecision decision={decision} /></span>}>
      {ev.psicotropo && <p className="mb-2 font-semibold text-psicotropo">Psicótropo: un envase por receta, DNI de quien lo retira y receta apartada.</p>}
      <ListaMotivos motivos={l.resultado.motivos} />

      {decision === 'DISPENSAR' && ev.lotes?.recomendado && (
        <p className="mt-3">
          Lote recomendado <strong className="font-mono">{ev.lotes.recomendado.lote}</strong> (caduca el {fecha(ev.lotes.recomendado.caducidad)})
        </p>
      )}
      {decision === 'DISPENSAR_CON_AVISO' && ev.alternativaFormato && (
        <div className="mt-3 rounded-xl bg-dispensar-bg p-3">
          <p>
            Se puede dispensar <strong>{ev.alternativaFormato.envases}</strong> envase(s) de {ev.alternativaFormato.nombre} ({CN} {ev.alternativaFormato.cn}).
          </p>
          {ev.alternativaFormato.nota && <p className="mt-1 font-semibold">{ev.alternativaFormato.nota}</p>}
        </div>
      )}
      {decision === 'SUSTITUIR' && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="font-semibold">El prescrito no está disponible. Sustitutos equivalentes con stock:</p>
          {ev.sustitutos.map((s) => (
            <div key={s.cn} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sustituir-bg p-3">
              <span>
                {s.nombre} · {s.labtitular} · {CN} {s.cn} · caduca {fecha(s.caducidadFefo)}
                {s.modo === 'PRE' && <strong className="ml-2">Necesita aprobación previa del garante (consúltale y regístrala)</strong>}
              </span>
              <Boton onClick={() => void sustituir(s.cn)}>Iniciar sustitución</Boton>
            </div>
          ))}
        </div>
      )}
      {decision === 'PEDIR' && ev.pedido && (
        <div className="mt-3 rounded-xl bg-pedir-bg p-3">
          <p>
            Pedir {ev.pedido.nombre} ({CN} {ev.pedido.cn}, {ev.pedido.labtitular ?? '—'}){ev.pedido.psum && ' · con problemas de suministro'}
          </p>
          {ev.pedido.equivalentes.length > 0 && <p className="mt-1 text-sm">Equivalentes sin stock: {ev.pedido.equivalentes.map((x) => `${x.nombre} (${x.cn})`).join(', ')}</p>}
          {ev.sustitucionBloqueada.length > 0 && <p className="mt-1 text-sm">No se puede sustituir (ver motivos).</p>}
          <Boton
            className="mt-2"
            variante="secundario"
            onClick={() => void post('/api/pedidos', { cn: ev.pedido!.cn, unidades: 1 }).then(() => setMsg({ t: 'ok', m: 'Añadido a la lista de pedido' }))}
          >
            Añadir a lista de pedido
          </Boton>
        </div>
      )}
      {decision === 'PENDIENTE_STOCK' && <p className="mt-3">No se ha podido confirmar el stock en Siweb360. Vuelve a comprobar en unos segundos.</p>}
      {l.opcionesSoloPA && (
        <div className="mt-3">
          <p className="font-semibold">Opciones con ese principio activo (para llamar al veterinario):</p>
          <ul className="list-disc pl-6 text-sm">
            {l.opcionesSoloPA.map((o) => (
              <li key={o.cn}>
                {o.nombre} · {o.labtitular} · {CN} {o.cn} {o.enStock ? '· en stock' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg && <Mensaje tipo={msg.t}>{msg.m}</Mensaje>}
      <div className="mt-4 flex flex-wrap gap-3">
        {(decision === 'DISPENSAR' || decision === 'DISPENSAR_CON_AVISO') && (
          <Boton data-testid={`dispensar-${l.orden}`} onClick={() => void irADispensar()}>
            Dispensar
          </Boton>
        )}
        {decision === 'NO_CONFORME' && ev.forzable && (
          <Boton variante="peligro" onClick={() => setForzar(true)}>
            Dispensar igualmente
          </Boton>
        )}
      </div>
      {forzar && (
        <ModalForzado
          codigos={forzables}
          usuario={usuario?.nombre ?? ''}
          onCancelar={() => setForzar(false)}
          onConfirmar={async (s) => {
            setForzar(false);
            try {
              const r = await post<Evaluacion>(`/api/recetas/${recetaId}/evaluar`, { forzados: { [l.orden]: s } });
              const nueva = r.lineas.find((x) => x.orden === l.orden)!;
              if (!['DISPENSAR', 'DISPENSAR_CON_AVISO'].includes(nueva.resultado.decision)) {
                setMsg({ t: 'error', m: `Tras forzar, la línea queda en «${nueva.resultado.decision}»: no hay stock para dispensar.` });
                return;
              }
              guardarForzado(recetaId, l.orden, s);
              await irADispensar({ forzado: '1' });
            } catch (e) {
              setMsg({ t: 'error', m: e instanceof ApiError ? e.message : 'Error' });
            }
          }}
        />
      )}
    </Tarjeta>
  );
}
