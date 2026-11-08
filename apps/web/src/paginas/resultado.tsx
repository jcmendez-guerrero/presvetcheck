import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CodigoIncidencia, RespuestaCompararMedicamentos } from '@mmx/shared';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { guardarForzado } from '../lib/flujo';
import { CN, fecha } from '../lib/textos';
import type { Evaluacion, LineaEvaluada } from '../lib/tipos';
import { EstadoDecision, ListaMotivos } from '../componentes/estado';
import { ModalForzado } from '../componentes/forzado';
import { Pagina } from '../componentes/layout';
import { RelacionarSiweb } from '../componentes/relacionar-siweb';
import { ConReceta } from '../componentes/visor-receta';
import { Boton, Cargando, Mensaje, Tarjeta } from '../componentes/ui';
import { BotonPreguntarLinea, TablaComparativaCriterios } from '../componentes/asistente';

/** Resultado por línea (SPEC §8.4): estado con icono y texto, motivos legibles y acción principal. */
export function Resultado() {
  const { id } = useParams({ from: '/recetas/$id/resultado' });
  const q = useQuery({
    queryKey: ['evaluacion', id],
    queryFn: () => post<Evaluacion>(`/api/recetas/${id}/evaluar`),
    refetchOnWindowFocus: false,
  });
  const qReceta = useQuery({
    queryKey: ['receta', id],
    queryFn: () =>
      get<{ confirmacion?: { especie?: { texto?: string | null }; indicacion?: string | null } }>(
        `/api/recetas/${id}`,
      ),
    refetchOnWindowFocus: false,
  });
  if (q.isLoading) return <Cargando texto="Comprobando la receta…" />;
  if (q.error) return <Mensaje tipo="error">{(q.error as Error).message}</Mensaje>;
  const e = q.data!;
  return (
    <Pagina
      titulo="Resultado"
      acciones={
        <Link to="/recetas/$id/revision" params={{ id }} className="font-semibold text-marca underline">
          Volver a la revisión
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        {e.resumen && <EstadoDecision decision={e.resumen} grande />}
        {e.validez && <span>Válida hasta el {fecha(e.validez.efectiva)}</span>}
      </div>
      <ConReceta recetaId={id}>
        {e.lineas.map((l) => (
          <TarjetaLinea
            key={l.orden}
            l={l}
            recetaId={id}
            todas={e.lineas}
            especieTexto={qReceta.data?.confirmacion?.especie?.texto ?? undefined}
            indicacionTexto={qReceta.data?.confirmacion?.indicacion ?? undefined}
          />
        ))}
      </ConReceta>
    </Pagina>
  );
}

function TarjetaLinea({
  l,
  recetaId,
  todas,
  especieTexto,
  indicacionTexto,
}: {
  l: LineaEvaluada;
  recetaId: string;
  todas: LineaEvaluada[];
  especieTexto?: string | undefined;
  indicacionTexto?: string | undefined;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const [forzar, setForzar] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const ev = l.resultado.evidencias;
  const decision = l.resultado.decision;
  const forzables = [
    ...new Set(l.incidencias.filter((i) => i.severidad === 'BLOQUEANTE_FORMA').map((i) => i.code)),
  ] as CodigoIncidencia[];
  const pendientes = todas
    .filter(
      (x) =>
        x.orden !== l.orden &&
        !['DISPENSAR', 'DISPENSAR_CON_AVISO', 'SUSTITUIR'].includes(x.resultado.decision),
    )
    .map((x) => x.orden);

  const irADispensar = (extra: Record<string, unknown> = {}) =>
    nav({
      to: '/recetas/$id/dispensar/$linea',
      params: { id: recetaId, linea: String(l.orden) },
      search: { pendientes: pendientes.join(','), ...extra },
    });

  const sustituir = async (cn: string) => {
    try {
      const s = await post<{ id: string }>('/api/sustituciones', { recetaId, lineaOrden: l.orden, cn });
      await nav({ to: '/sustituciones/$id', params: { id: s.id } });
    } catch (e) {
      setMsg({ t: 'error', m: e instanceof ApiError ? e.message : 'Error' });
    }
  };

  return (
    <Tarjeta
      titulo={
        <span className="flex flex-wrap items-center gap-3">
          Medicamento {l.orden} <EstadoDecision decision={decision} />
        </span>
      }
    >
      <AvisoSuministro motivos={l.resultado.motivos.map((m) => m.code)} />
      {ev.psicotropo && (
        <p className="mb-2 font-semibold text-psicotropo">
          Psicótropo: un envase por receta, DNI de quien lo retira y receta apartada.
        </p>
      )}
      <ListaMotivos motivos={l.resultado.motivos} />
      {l.lineaId && (
        <div className="mt-3">
          <BotonPreguntarLinea recetaLineaId={l.lineaId} etiqueta={`el medicamento ${l.orden}`} />
        </div>
      )}

      {decision === 'DISPENSAR' && ev.lotes?.recomendado && (
        <p className="mt-3">
          Lote recomendado <strong className="font-mono">{ev.lotes.recomendado.lote}</strong> (caduca el{' '}
          {fecha(ev.lotes.recomendado.caducidad)})
        </p>
      )}
      {decision === 'DISPENSAR_CON_AVISO' && ev.alternativaFormato && (
        <div className="mt-3 rounded-xl bg-dispensar-bg p-3">
          <p>
            Se puede dispensar <strong>{ev.alternativaFormato.envases}</strong> envase(s) de{' '}
            {ev.alternativaFormato.nombre} ({CN} {ev.alternativaFormato.cn}).
          </p>
          {ev.alternativaFormato.nota && <p className="mt-1 font-semibold">{ev.alternativaFormato.nota}</p>}
        </div>
      )}
      {decision === 'SUSTITUIR' && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="font-semibold">El prescrito no está disponible. Sustitutos equivalentes con stock:</p>
          {ev.sustitutos.map((s) => (
            <div
              key={s.cn}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sustituir-bg p-3"
            >
              <span>
                {s.nombre} · {s.labtitular} · {CN} {s.cn} · caduca {fecha(s.caducidadFefo)}
                {s.psum && <strong className="ml-2 text-noconforme">Problemas de suministro</strong>}
                {s.modo === 'PRE' && (
                  <strong className="ml-2">
                    Necesita aprobación previa del garante (consúltale y regístrala)
                  </strong>
                )}
              </span>
              <Boton onClick={() => void sustituir(s.cn)}>Iniciar sustitución</Boton>
            </div>
          ))}
        </div>
      )}
      {decision === 'PEDIR' && ev.pedido && (
        <div className="mt-3 rounded-xl bg-pedir-bg p-3">
          <p>
            Pedir {ev.pedido.nombre} ({CN} {ev.pedido.cn}, {ev.pedido.labtitular ?? '—'})
            {ev.pedido.psum && ' · con problemas de suministro'}
          </p>
          {ev.pedido.equivalentes.length > 0 && (
            <p className="mt-1 text-sm">
              Equivalentes sin stock:{' '}
              {ev.pedido.equivalentes
                .map((x) => `${x.nombre} (${x.cn})${x.psum ? ' · problemas de suministro' : ''}`)
                .join(', ')}
            </p>
          )}
          {ev.sustitucionBloqueada.length > 0 && (
            <p className="mt-1 text-sm">No se puede sustituir (ver motivos).</p>
          )}
          <Boton
            className="mt-2"
            variante="secundario"
            onClick={() =>
              void post('/api/pedidos', { cn: ev.pedido!.cn, unidades: 1 }).then(() =>
                setMsg({ t: 'ok', m: 'Añadido a la lista de pedido' }),
              )
            }
          >
            Añadir a lista de pedido
          </Boton>
        </div>
      )}
      <BuscadorSustitutoLinea
        recetaId={recetaId}
        linea={l}
        prescritoNregistro={ev.cn ?? ev.pedido?.cn ?? null}
        especieTexto={especieTexto}
        indicacionTexto={indicacionTexto}
        onSustituido={async (sustitucionId) => {
          setMsg({
            t: 'ok',
            m: 'Sustitución registrada con éxito. Receta apartada en bandeja para firma del garante.',
          });
          await qc.invalidateQueries({ queryKey: ['evaluacion', recetaId] });
          void nav({
            to: '/recetas/$id/dispensar/$linea',
            params: { id: recetaId, linea: String(l.orden) },
            search: { sustitucion: sustitucionId },
          });
        }}
      />
      {decision === 'PENDIENTE_STOCK' && (
        <>
          <p className="mt-3">
            No se ha podido confirmar el stock en Siweb360. Si sabes qué producto de Siweb360 vas a dispensar,
            relaciónalo y se vuelve a comprobar.
          </p>
          {ev.cn && (
            <RelacionarSiweb
              cn={ev.cn}
              estado={null}
              onRelacionado={() => void qc.invalidateQueries({ queryKey: ['evaluacion', recetaId] })}
            />
          )}
        </>
      )}
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
              const r = await post<Evaluacion>(`/api/recetas/${recetaId}/evaluar`, {
                forzados: { [l.orden]: s },
              });
              const nueva = r.lineas.find((x) => x.orden === l.orden)!;
              if (!['DISPENSAR', 'DISPENSAR_CON_AVISO'].includes(nueva.resultado.decision)) {
                setMsg({
                  t: 'error',
                  m: `Tras forzar, la línea queda en «${nueva.resultado.decision}»: no hay stock para dispensar.`,
                });
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

/** Banda destacada con los problemas de suministro que informa CIMAVet (o que no se han podido comprobar). */
function AvisoSuministro({ motivos }: { motivos: string[] }) {
  if (motivos.includes('PROBLEMA_SUMINISTRO'))
    return (
      <p
        data-testid="aviso-suministro"
        className="mb-3 rounded-xl bg-noconforme-bg px-3 py-2 font-semibold text-noconforme"
      >
        Problemas de suministro según CIMAVet: si hay que pedirlo puede tardar o no llegar; valora sustituir.
      </p>
    );
  if (motivos.includes('SUMINISTRO_NO_COMPROBADO'))
    return (
      <p data-testid="aviso-suministro" className="mb-3 rounded-xl bg-fondo px-3 py-2 text-sm text-slate-700">
        No se ha podido comprobar en CIMAVet si hay problemas de suministro.
      </p>
    );
  return null;
}

interface ResultadoBusquedaItem {
  cn: string;
  nregistro: string;
  nombre: string;
  medicamento: string;
  labtitular: string | null;
  comerc?: boolean;
}

export function ModalSustitucionManual({
  candidatoNombre,
  candidatoCn,
  onCancelar,
  onConfirmar,
}: {
  candidatoNombre: string;
  candidatoCn: string;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const valido = motivo.trim().length >= 5;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-sustitucion-manual"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="titulo-sustitucion-manual" className="text-xl font-bold text-marca">
          Confirmar sustitución por falta de existencias
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          Vas a sustituir el medicamento prescrito por <strong>{candidatoNombre}</strong> (CN {candidatoCn}).
        </p>
        <p className="mt-2 text-xs text-slate-600">
          La receta quedará separada para la firma posterior del farmacéutico garante (modo POST). Recuerda
          recabar la conformidad del tutor del animal y notificar al veterinario prescriptor.
        </p>
        <label className="mt-4 flex flex-col gap-1">
          <span className="font-medium text-slate-800">
            Razón / Justificación de la sustitución <span className="text-noconforme">*</span>
          </span>
          <textarea
            className="min-h-20 rounded-lg border border-slate-300 p-2 text-sm"
            placeholder="Ej.: Sin existencias del prescrito; sustituido por equivalente con acuerdo del cliente..."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <span className="text-xs text-slate-500">Mínimo 5 caracteres ({motivo.trim().length}/5).</span>
        </label>
        <div className="mt-6 flex flex-wrap justify-between gap-3">
          <Boton variante="secundario" onClick={onCancelar}>
            Cancelar
          </Boton>
          <Boton variante="principal" disabled={!valido} onClick={() => onConfirmar(motivo.trim())}>
            Confirmar y sustituir
          </Boton>
        </div>
      </div>
    </div>
  );
}

export function BuscadorSustitutoLinea({
  recetaId,
  linea,
  prescritoNregistro,
  especieTexto,
  indicacionTexto,
  onSustituido,
}: {
  recetaId: string;
  linea: LineaEvaluada;
  prescritoNregistro?: string | null | undefined;
  especieTexto?: string | undefined;
  indicacionTexto?: string | undefined;
  onSustituido: (sustitucionId: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [candidatos, setCandidatos] = useState<ResultadoBusquedaItem[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [candidatoElegido, setCandidatoElegido] = useState<ResultadoBusquedaItem | null>(null);
  const [comparando, setComparando] = useState(false);
  const [comparacion, setComparacion] = useState<RespuestaCompararMedicamentos | null>(null);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [errorComp, setErrorComp] = useState<string | null>(null);

  const buscar = async (q: string) => {
    setBusqueda(q);
    if (q.trim().length < 2) {
      setCandidatos([]);
      return;
    }
    setBuscando(true);
    try {
      const items = await get<ResultadoBusquedaItem[]>(`/api/medicamentos/buscar?q=${encodeURIComponent(q)}`);
      setCandidatos(items.slice(0, 8));
    } catch {
      setCandidatos([]);
    } finally {
      setBuscando(false);
    }
  };

  const seleccionarCandidato = async (c: ResultadoBusquedaItem) => {
    setCandidatoElegido(c);
    setComparando(true);
    setErrorComp(null);
    try {
      const prescrito = prescritoNregistro || c.nregistro;
      const res = await post<RespuestaCompararMedicamentos>('/api/medicamentos/comparar', {
        prescritoNregistro: prescrito,
        candidatoNregistro: c.nregistro,
        especie: especieTexto || 'Perro',
        indicacion: indicacionTexto || undefined,
      });
      setComparacion(res);
    } catch (e) {
      setErrorComp(e instanceof ApiError ? e.message : 'Error al comparar medicamentos');
      setComparacion(null);
    } finally {
      setComparando(false);
    }
  };

  const confirmarSustitucion = async (motivo: string) => {
    if (!candidatoElegido) return;
    try {
      const r = await post<{ ok: boolean; sustitucionId: string }>(
        `/api/recetas/${recetaId}/lineas/${linea.orden}/sustituir-manual`,
        {
          cn: candidatoElegido.cn,
          nregistro: candidatoElegido.nregistro,
          motivo,
        },
      );
      setMostrarModal(false);
      onSustituido(r.sustitucionId);
    } catch (e) {
      setErrorComp(e instanceof ApiError ? e.message : 'Error al guardar la sustitución');
    }
  };

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      {!abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="text-sm font-semibold text-marca hover:underline flex items-center gap-1"
          data-testid={`btn-buscar-sustituto-${linea.orden}`}
        >
          🔍 Buscar sustituto en vademécum o almacén
        </button>
      ) : (
        <div className="rounded-xl border border-marca/30 bg-white p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm text-marca">
              Comparador y selección de sustituto (Línea {linea.orden})
            </h4>
            <button
              type="button"
              onClick={() => {
                setAbierto(false);
                setCandidatoElegido(null);
                setComparacion(null);
              }}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Cerrar
            </button>
          </div>
          <div>
            <label htmlFor={`busqueda-sust-${linea.orden}`} className="sr-only">
              Buscar medicamento sustituto
            </label>
            <input
              id={`busqueda-sust-${linea.orden}`}
              type="search"
              placeholder="Buscar por nombre, principio activo o Código nacional..."
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              value={busqueda}
              onChange={(e) => void buscar(e.target.value)}
              data-testid={`input-busqueda-sust-${linea.orden}`}
            />
            {buscando && <p className="text-xs text-slate-500 mt-1">Buscando en CIMAVet...</p>}
          </div>

          {candidatos.length > 0 && !candidatoElegido && (
            <ul className="divide-y divide-slate-100 max-h-48 overflow-y-auto border rounded-lg text-sm">
              {candidatos.map((c) => (
                <li key={c.cn} className="p-2 hover:bg-slate-50 flex items-center justify-between gap-2">
                  <div>
                    <strong className="block text-slate-800">{c.nombre}</strong>
                    <span className="text-xs text-slate-500">
                      CN {c.cn} · {c.labtitular ?? '—'}
                    </span>
                  </div>
                  <Boton
                    variante="secundario"
                    className="text-xs px-2 py-1"
                    onClick={() => void seleccionarCandidato(c)}
                    data-testid={`btn-seleccionar-${c.cn}`}
                  >
                    Evaluar
                  </Boton>
                </li>
              ))}
            </ul>
          )}

          {comparando && (
            <p className="text-sm text-slate-600 animate-pulse">Evaluando equivalencia con el motor...</p>
          )}
          {errorComp && <Mensaje tipo="error">{errorComp}</Mensaje>}

          {comparacion && candidatoElegido && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg">
                <div>
                  <span className="text-xs font-semibold uppercase text-slate-500">Candidato evaluado</span>
                  <p className="font-semibold text-slate-900">
                    {candidatoElegido.nombre} (CN {candidatoElegido.cn})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCandidatoElegido(null);
                    setComparacion(null);
                  }}
                  className="text-xs text-marca underline"
                >
                  Cambiar
                </button>
              </div>

              <div className="text-sm">
                <span className="font-semibold">Resultado de la evaluación: </span>
                <span
                  className={
                    comparacion.decision === 'EQUIVALENTE'
                      ? 'font-bold text-dispensar'
                      : 'font-bold text-noconforme'
                  }
                >
                  {comparacion.decision === 'EQUIVALENTE'
                    ? '✓ Equivalente reglamentario'
                    : '✗ No equivalente reglamentario'}
                </span>
                {comparacion.motivos.length > 0 && (
                  <p className="text-xs text-slate-600 mt-1">{comparacion.motivos.join(' · ')}</p>
                )}
              </div>

              <TablaComparativaCriterios comparativa={comparacion.evidencias.comparativa} />

              {comparacion.esBloqueanteDuro ? (
                <p className="rounded-lg bg-noconforme-bg p-2 text-xs font-semibold text-noconforme">
                  Bloqueo normativo estricto: este medicamento no admite sustitución por ley (medicamento
                  biológico, inmunológico o prescripción en cascada).
                </p>
              ) : (
                <div className="flex justify-end pt-1">
                  <Boton
                    variante="principal"
                    onClick={() => setMostrarModal(true)}
                    data-testid={`btn-sustituir-motivo-${linea.orden}`}
                  >
                    Sustituir con motivo
                  </Boton>
                </div>
              )}
            </div>
          )}

          {mostrarModal && candidatoElegido && (
            <ModalSustitucionManual
              candidatoNombre={candidatoElegido.nombre}
              candidatoCn={candidatoElegido.cn}
              onCancelar={() => setMostrarModal(false)}
              onConfirmar={(motivo) => void confirmarSustitucion(motivo)}
            />
          )}
        </div>
      )}
    </div>
  );
}
