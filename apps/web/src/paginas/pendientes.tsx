import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, get, post } from '../lib/api';
import { CN, fecha } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Cargando, Campo, Mensaje, Tarjeta } from '../componentes/ui';
import { TicketMultiRxModal } from '../componentes/ticket-multi-rx';

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
                className="min-h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm"
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
                  <div key={t.id} className="flex flex-col gap-2 rounded-lg border bg-white p-3 text-sm">
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
