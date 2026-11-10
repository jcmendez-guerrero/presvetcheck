import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, get, post } from '../lib/api';
import { CN, fecha } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Cargando, Campo, Mensaje, Tarjeta } from '../componentes/ui';
import { TicketMultiRxModal } from '../componentes/ticket-multi-rx';
import {
  MOTIVOS_JUSTIFICACION,
  TEXTO_MOTIVO,
  motivoEncaja,
  textoError,
  type CodigoError,
  type MotivoJustificacion,
} from '@mmx/shared';

interface Pendientes {
  registros: Array<{ id: string; numero: string | null; fecha: string | null; estado: string }>;
  sinConciliar: {
    configurado: boolean;
    salidas: Array<{
      id: string;
      cn: string;
      nombre: string;
      lote: string;
      unidades: number;
      fecha: string;
      recetaId: string | null;
      fraccion: boolean;
    }>;
  };
  sustituciones: Array<{
    id: string;
    estado: string;
    modo: string;
    cnPrescrito: string | null;
    cnPropuesto: string;
    indicacion: string | null;
    antiguedadDias: number;
    alerta: boolean;
  }>;
  discrepancias: Array<{ id: string; tipo: string; fecha: string; datos: Record<string, unknown> }>;
}

const ESTADO: Record<string, string> = {
  PENDIENTE_AUTORIZACION_PREVIA: 'Falta registrar la autorización previa del garante',
  DISPENSADA: 'Falta apartar la receta con la etiqueta',
  RECETA_APARTADA: 'Falta registrar la firma del garante',
};

const TIPO: Record<string, string> = {
  DISPENSACION_SIN_TICKET: 'Dispensación sin ticket en el TPV',
  TICKET_SIN_DISPENSACION: 'Ticket del TPV sin dispensación registrada',
  LOTE_DISTINTO: 'Lote distinto entre el ticket y la dispensación',
  UNIDADES_DISTINTAS: 'Unidades distintas entre el ticket y la dispensación',
};

/**
 * Pendientes de la operativa (SPEC §8.9). El farmacéutico garante no usa la app: lo que hace fuera
 * (autorizar, firmar en papel) lo registra aquí el empleado. Lo forzado le llega en el reporte semanal.
 */
export function PaginaPendientes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pendientes'], queryFn: () => get<Pendientes>('/api/pendientes') });
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Estado para asociación manual con ticket TPV
  const [salidaAAsociar, setSalidaAAsociar] = useState<Pendientes['sinConciliar']['salidas'][number] | null>(
    null,
  );
  const [ticketSearch, setTicketSearch] = useState('');
  const [buscandoTickets, setBuscandoTickets] = useState(false);
  const [asociandoId, setAsociandoId] = useState<number | null>(null);
  const [asociarError, setAsociarError] = useState<string | null>(null);
  const [verTicketId, setVerTicketId] = useState<string | null>(null);
  const [ticketsResult, setTicketsResult] = useState<
    Array<{
      id: number;
      numero: string;
      fecha: string;
      hora?: string | null;
      estado: string;
      total: number;
      items?: Array<{
        id: number;
        nombre: string;
        cantidad: number;
        precioUnitario: number;
        subtotal: number;
      }>;
    }>
  >([]);

  if (!q.data) return <Cargando />;

  const buscarTickets = async () => {
    if (ticketSearch.trim().length < 3) return;
    setBuscandoTickets(true);
    setAsociarError(null);
    try {
      const res = await get<{ tickets: typeof ticketsResult }>(
        `/api/conciliacion/tickets?search=${encodeURIComponent(ticketSearch.trim())}`,
      );
      setTicketsResult(res.tickets);
      if (res.tickets.length === 0) {
        setAsociarError('No se encontraron tickets con ese número.');
      }
    } catch (e) {
      setAsociarError(e instanceof ApiError ? e.message : 'Error al buscar tickets');
    } finally {
      setBuscandoTickets(false);
    }
  };

  const asociarTicket = async (ticket: (typeof ticketsResult)[number]) => {
    if (!salidaAAsociar) return;
    setAsociandoId(ticket.id);
    setAsociarError(null);
    try {
      await post('/api/conciliacion/asociar', {
        dispensacionId: salidaAAsociar.id,
        ticketId: ticket.id,
        ticketNumero: ticket.numero,
        nota: `Asociación manual desde pantalla de pendientes (${ticket.numero})`,
      });
      setOk(`Salida asociada correctamente al ticket ${ticket.numero}`);
      setSalidaAAsociar(null);
      setTicketsResult([]);
      setTicketSearch('');
      await qc.invalidateQueries({ queryKey: ['pendientes'] });
    } catch (e) {
      setAsociarError(e instanceof ApiError ? e.message : 'Error al asociar ticket');
    } finally {
      setAsociandoId(null);
    }
  };
  const resolver = async (id: string) => {
    setMsg(null);
    try {
      await post(`/api/discrepancias/${id}/resolver`, { nota: notas[id] ?? '' });
      await qc.invalidateQueries({ queryKey: ['pendientes'] });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error');
    }
  };
  const conciliar = async (cierre: boolean) => {
    setMsg(null);
    try {
      const r = await post<{ configurado: boolean; conciliadas?: number; discrepancias?: number }>(
        '/api/conciliacion',
        { cierre },
      );
      setOk(
        r.configurado
          ? `Conciliadas: ${r.conciliadas ?? 0} · nuevas discrepancias: ${r.discrepancias ?? 0}`
          : 'No hay fuente de tickets configurada',
      );
      await qc.invalidateQueries({ queryKey: ['pendientes'] });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error');
    }
  };
  const p = q.data;
  return (
    <Pagina titulo="Pendientes">
      {msg && <Mensaje tipo="error">{msg}</Mensaje>}
      {ok && <Mensaje tipo="ok">{ok}</Mensaje>}
      <Tarjeta titulo={`Datos del registro por completar (${p.registros.length})`}>
        {p.registros.length === 0 && <p>No hay recetas con el registro pendiente.</p>}
        <ul className="divide-y">
          {p.registros.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                Receta {r.numero ?? '(sin número)'} · dispensada {r.fecha ? fecha(r.fecha.slice(0, 10)) : ''}
              </span>
              <Link
                to="/recetas/$id/registro"
                params={{ id: r.id }}
                className="font-semibold text-marca underline"
              >
                Completar el registro
              </Link>
            </li>
          ))}
        </ul>
      </Tarjeta>
      <Tarjeta titulo={`Salidas pendientes de conciliar con el TPV (${p.sinConciliar.salidas.length})`}>
        {!p.sinConciliar.configurado && (
          <p>No hay fuente de tickets configurada (Siweb360): la conciliación está desactivada.</p>
        )}
        {p.sinConciliar.configurado && p.sinConciliar.salidas.length === 0 && (
          <p>Todas las salidas recientes están conciliadas.</p>
        )}
        <ul className="divide-y">
          {p.sinConciliar.salidas.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-2 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                {fecha(s.fecha.slice(0, 10))} · {s.nombre} · {CN} {s.cn} · lote {s.lote} ·{' '}
                {s.fraccion ? 'fracción: compruébala a mano con el ticket' : `${s.unidades} envase(s)`}
              </div>
              <Boton
                variante="secundario"
                className="!px-3 !py-1 text-xs self-start sm:self-auto"
                onClick={() => {
                  setSalidaAAsociar(s);
                  setTicketSearch('');
                  setTicketsResult([]);
                  setAsociarError(null);
                }}
              >
                Indicar ticket
              </Boton>
            </li>
          ))}
        </ul>

        {salidaAAsociar && (
          <div className="mt-4 rounded-xl border-2 border-marca/30 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-marca">
                Asociar ticket del TPV para: {salidaAAsociar.nombre} ({CN} {salidaAAsociar.cn})
              </h3>
              <button
                type="button"
                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                onClick={() => setSalidaAAsociar(null)}
              >
                ✕ Cancelar
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Salida del {fecha(salidaAAsociar.fecha.slice(0, 10))} · Lote {salidaAAsociar.lote} ·{' '}
              {salidaAAsociar.unidades} envase(s)
            </p>

            {asociarError && <div className="mt-2 text-xs font-semibold text-noconforme">{asociarError}</div>}

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Buscar por nº de ticket (ej. XXX-2026-000458)"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void buscarTickets();
                  }
                }}
                className="min-h-10 flex-1 rounded-lg border border-borde bg-superficie px-3 text-sm text-texto"
              />
              <Boton
                disabled={buscandoTickets || ticketSearch.trim().length < 3}
                onClick={() => void buscarTickets()}
              >
                {buscandoTickets ? 'Buscando…' : 'Buscar ticket'}
              </Boton>
            </div>

            {ticketsResult.length > 0 && (
              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto">
                {ticketsResult.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-col gap-2 rounded-lg border border-borde bg-superficie p-3 text-sm text-texto"
                  >
                    <div className="flex items-center justify-between font-medium">
                      <span>
                        Ticket {t.numero} · {t.fecha} {t.hora ?? ''} ({t.estado})
                      </span>
                      <span>{t.total.toFixed(2)} €</span>
                    </div>
                    {t.items && t.items.length > 0 && (
                      <ul className="divide-y border-t pt-1 text-xs text-slate-600">
                        {t.items.map((it) => (
                          <li key={it.id} className="flex justify-between py-1">
                            <span>
                              {it.cantidad}x {it.nombre}
                            </span>
                            <span>{it.subtotal.toFixed(2)} €</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                      <Boton
                        variante="secundario"
                        className="!px-3 !py-1 text-xs"
                        onClick={() => setVerTicketId(String(t.id))}
                      >
                        Ver conciliación multi-receta
                      </Boton>
                      <Boton
                        variante="principal"
                        className="!px-3 !py-1 text-xs"
                        disabled={asociandoId === t.id}
                        onClick={() => void asociarTicket(t)}
                      >
                        {asociandoId === t.id ? 'Asociando…' : 'Asociar a este ticket'}
                      </Boton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {p.sinConciliar.configurado && (
          <div className="mt-3 flex flex-wrap gap-3">
            <Boton onClick={() => void conciliar(false)}>Conciliar ahora</Boton>
            <Boton
              variante="secundario"
              onClick={() => void conciliar(true)}
              title="Lo que quede sin ticket pasa a discrepancia (lo hace solo el cierre diario a las 21:00)"
            >
              Cerrar el día
            </Boton>
          </div>
        )}
      </Tarjeta>
      <Tarjeta titulo={`Sustituciones en curso (${p.sustituciones.length})`}>
        {p.sustituciones.length === 0 && <p>No hay sustituciones pendientes.</p>}
        <ul className="divide-y">
          {p.sustituciones.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {ESTADO[s.estado] ?? s.estado} · {CN} {s.cnPrescrito} → {s.cnPropuesto} · hace{' '}
                {s.antiguedadDias} días
                {s.alerta && (
                  <strong className="ml-2 text-noconforme">Supera el plazo para la firma del garante</strong>
                )}
                {s.indicacion === 'PROBABLE' && (
                  <strong className="ml-2 text-sustituir">Indicación probable</strong>
                )}
              </span>
              <Link
                to="/sustituciones/$id"
                params={{ id: s.id }}
                className="font-semibold text-marca underline"
              >
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      </Tarjeta>
      <Tarjeta titulo={`Discrepancias con el TPV (${p.discrepancias.length})`}>
        {p.discrepancias.length === 0 && <p>No hay discrepancias abiertas.</p>}
        <ul className="divide-y">
          {p.discrepancias.map((d) => (
            <li key={d.id} className="grid gap-2 py-3">
              <span>
                <strong>{TIPO[d.tipo] ?? d.tipo}</strong> · {fecha(d.fecha)}
                {typeof d.datos.cn === 'string' && ` · ${CN} ${d.datos.cn}`}
                {typeof d.datos.ticket === 'string' && ` · ticket ${d.datos.ticket}`}
              </span>
              <Campo
                etiqueta="Cómo se ha resuelto"
                value={notas[d.id] ?? ''}
                onChange={(e) => setNotas({ ...notas, [d.id]: e.target.value })}
              />
              <Boton variante="texto" onClick={() => void resolver(d.id)}>
                Marcar como resuelta
              </Boton>
            </li>
          ))}
        </ul>
      </Tarjeta>
      <EnviosSiwebEnRevision />
      <MovimientosSinJustificar />
      {verTicketId && (
        <TicketMultiRxModal
          ticketId={verTicketId}
          onCerrar={() => setVerTicketId(null)}
          onConfirmado={() => void qc.invalidateQueries({ queryKey: ['pendientes'] })}
        />
      )}
    </Pagina>
  );
}

interface EnvioEnRevision {
  id: string;
  estado: string;
  evidencia: string | null;
  proximaComprobacion: string | null;
  cn: string | null;
  nombre: string | null;
  lote: string | null;
  unidades: number | null;
  stockActual: { total_on_hand?: number } | null;
}

/** Texto de la evidencia de un envío: los códigos estables se traducen; el resto se muestra tal cual. */
function textoEvidencia(e: string | null): string {
  if (!e) return '';
  if (/^[A-Z_]+$/.test(e)) return textoError(e as CodigoError);
  return e;
}

/** Entradas de stock que no se sabe si llegaron a Siweb360 (specs/011, US2). Cualquier usuario las cierra. */
function EnviosSiwebEnRevision() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['outbox-revision'],
    queryFn: () => get<EnvioEnRevision[]>('/api/outbox/revision'),
  });
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const envios = q.data ?? [];
  const cerrar = async (id: string, accion: 'revisado' | 'resuelto_a_mano') => {
    setError(null);
    try {
      await post(`/api/outbox/${id}/cerrar`, { accion, nota: notas[id] ?? '' });
      await qc.invalidateQueries({ queryKey: ['outbox-revision'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se ha podido guardar');
    }
  };
  if (envios.length === 0) return null;
  return (
    <Tarjeta titulo={`Envíos a Siweb360 en revisión (${envios.length})`}>
      <p className="text-sm text-texto-muted">
        No sabemos si estas entradas de stock llegaron a Siweb360. Mira el producto en Siweb360 y elige qué ha
        pasado. Nunca se reenvían solas.
      </p>
      <ul className="divide-y">
        {envios.map((e) => (
          <li key={e.id} className="grid gap-2 py-3">
            <span>
              <strong>{e.nombre ?? 'Producto'}</strong>
              {e.cn && ` · ${CN} ${e.cn}`}
              {e.lote && ` · lote ${e.lote}`}
              {e.unidades !== null && ` · ${e.unidades} unidades`}
            </span>
            <span className="text-sm">{textoEvidencia(e.evidencia)}</span>
            {typeof e.stockActual?.total_on_hand === 'number' && (
              <span className="text-sm text-texto-muted">
                Stock que tiene ahora Siweb360: {e.stockActual.total_on_hand}
              </span>
            )}
            {e.proximaComprobacion && (
              <span className="text-sm text-texto-muted">
                Se vuelve a comprobar solo el {fecha(e.proximaComprobacion)}.
              </span>
            )}
            <Campo
              etiqueta="Qué has comprobado"
              value={notas[e.id] ?? ''}
              onChange={(ev) => setNotas({ ...notas, [e.id]: ev.target.value })}
            />
            <div className="flex flex-wrap gap-2">
              <Boton
                disabled={(notas[e.id] ?? '').trim().length < 5}
                onClick={() => void cerrar(e.id, 'revisado')}
              >
                Revisado: el stock está bien en Siweb360
              </Boton>
              <Boton
                variante="secundario"
                disabled={(notas[e.id] ?? '').trim().length < 5}
                onClick={() => void cerrar(e.id, 'resuelto_a_mano')}
              >
                Lo he dado de alta a mano en Siweb360
              </Boton>
            </div>
          </li>
        ))}
      </ul>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
    </Tarjeta>
  );
}

interface MovimientoSiweb {
  id: number;
  fecha: string;
  cn: string | null;
  nombre: string | null;
  lote: string | null;
  caducidad: string | null;
  unidades: number;
  motivoSiweb: string;
  referencia: string | null;
}

/**
 * Movimientos de medicamentos en Siweb360 sin pareja en la app desde la fecha de corte (specs/011, US3).
 * La API valida el motivo; aquí solo se ofrecen los que encajan con el sentido del movimiento.
 */
function MovimientosSinJustificar() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['movimientos-siweb'],
    queryFn: () => get<{ corte: string | null; movimientos: MovimientoSiweb[] }>('/api/movimientos-siweb'),
  });
  const [motivos, setMotivos] = useState<Record<number, MotivoJustificacion | ''>>({});
  const [notas, setNotas] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!q.data?.corte) return null;
  const movs = q.data.movimientos;
  const justificar = async (m: MovimientoSiweb) => {
    setError(null);
    try {
      await post(`/api/movimientos-siweb/${m.id}/justificar`, {
        tipo: 'MOTIVO',
        motivo: motivos[m.id],
        nota: notas[m.id] ?? '',
      });
      await qc.invalidateQueries({ queryKey: ['movimientos-siweb'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se ha podido guardar');
    }
  };
  return (
    <Tarjeta titulo={`Movimientos de Siweb360 sin justificar (${movs.length})`}>
      <p className="text-sm text-texto-muted">
        Desde el {fecha(q.data.corte)}, cada entrada o salida de un medicamento en Siweb360 tiene que estar en
        la app o explicada. Estos movimientos no se han podido emparejar solos.
      </p>
      {movs.length === 0 && <p>No hay movimientos por justificar.</p>}
      <ul className="divide-y">
        {movs.map((m) => {
          const opciones = MOTIVOS_JUSTIFICACION.filter((x) => motivoEncaja(x, m.unidades));
          const idMotivo = `motivo-mov-${m.id}`;
          return (
            <li key={m.id} className="grid gap-2 py-3">
              <span>
                <strong>{m.unidades > 0 ? `Entrada de ${m.unidades}` : `Salida de ${-m.unidades}`}</strong>
                {' · '}
                {m.nombre ?? 'Medicamento'}
                {m.cn && ` · ${CN} ${m.cn}`}
                {m.lote && ` · lote ${m.lote}`}
                {m.caducidad && ` · caduca ${fecha(m.caducidad)}`}
              </span>
              <span className="text-sm text-texto-muted">
                {fecha(m.fecha)} · en Siweb360: {m.motivoSiweb}
                {m.referencia && ` · ${m.referencia}`}
              </span>
              <label htmlFor={idMotivo} className="text-sm font-medium">
                Motivo
              </label>
              <select
                id={idMotivo}
                className="rounded border px-2 py-1"
                value={motivos[m.id] ?? ''}
                onChange={(ev) => setMotivos({ ...motivos, [m.id]: ev.target.value as MotivoJustificacion })}
              >
                <option value="">Elige un motivo</option>
                {opciones.map((x) => (
                  <option key={x} value={x}>
                    {TEXTO_MOTIVO[x]}
                  </option>
                ))}
              </select>
              <Campo
                etiqueta="Nota"
                value={notas[m.id] ?? ''}
                onChange={(ev) => setNotas({ ...notas, [m.id]: ev.target.value })}
              />
              <Boton
                variante="texto"
                disabled={!motivos[m.id] || (notas[m.id] ?? '').trim().length < 5}
                onClick={() => void justificar(m)}
              >
                Guardar justificación
              </Boton>
            </li>
          );
        })}
      </ul>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
    </Tarjeta>
  );
}
