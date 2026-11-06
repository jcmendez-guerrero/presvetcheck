import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DetalleTicketMultiReceta } from '@mmx/shared';
import { ApiError, get, post } from '../lib/api';
import { CN } from '../lib/textos';
import { Boton, Cargando, Mensaje } from './ui';

export function TicketMultiRxModal({
  ticketId,
  onCerrar,
  onConfirmado,
}: {
  ticketId: string;
  onCerrar: () => void;
  onConfirmado?: () => void;
}) {
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ticket-multi-rx', ticketId],
    queryFn: () => get<DetalleTicketMultiReceta>(`/api/conciliacion/tickets/${encodeURIComponent(ticketId)}`),
  });

  const confirmar = async () => {
    setConfirmando(true);
    setError(null);
    try {
      await post(`/api/conciliacion/tickets/${encodeURIComponent(ticketId)}/confirmar`, {});
      setExito(true);
      await qc.invalidateQueries({ queryKey: ['ticket-multi-rx', ticketId] });
      await qc.invalidateQueries({ queryKey: ['conciliacion'] });
      await qc.invalidateQueries({ queryKey: ['pendientes'] });
      onConfirmado?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al confirmar el ticket');
    } finally {
      setConfirmando(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-ticket-multi-rx"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between border-b pb-3">
          <div>
            <h2 id="titulo-ticket-multi-rx" className="text-xl font-bold text-slate-800">
              Conciliación consolidada de ticket
            </h2>
            <p className="text-sm text-slate-500">
              {data ? `Ticket ${data.ticketNumero} (ID: ${data.ticketId})` : 'Cargando ticket…'}
            </p>
          </div>
          {data && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                data.estado === 'confirmado' ? 'bg-dispensar-bg text-dispensar' : 'bg-pedir-bg text-pedir'
              }`}
            >
              {data.estado === 'confirmado' ? 'Confirmado' : 'Pendiente de confirmación'}
            </span>
          )}
        </div>

        {isLoading && <Cargando />}
        {isError && (
          <div className="mt-4">
            <Mensaje tipo="error">No se pudo cargar el detalle del ticket.</Mensaje>
          </div>
        )}

        {data && (
          <div className="mt-4 flex flex-col gap-4">
            {/* Recetas asociadas */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                Recetas asociadas ({data.recetas.length})
              </h3>
              <ul className="mt-1 divide-y rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm">
                {data.recetas.map((r) => (
                  <li key={r.recetaId} className="flex justify-between py-1 px-2">
                    <span className="font-medium text-slate-700">
                      Receta {r.numeroReceta ?? '(sin número)'}
                    </span>
                    <span className="text-xs text-slate-500">Emisión: {r.fecha}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Comparativa por líneas */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Líneas y unidades</h3>
              <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Medicamento / CN</th>
                      <th className="py-2 px-3 text-center">Unidades Ticket</th>
                      <th className="py-2 px-3 text-center">Dispensadas (Total)</th>
                      <th className="py-2 px-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {data.conciliacionLineas.map((l) => (
                      <tr key={l.cn}>
                        <td className="py-2 px-3">
                          <p className="font-medium text-slate-800">{l.nombre}</p>
                          <p className="text-xs text-slate-500">
                            {CN} {l.cn}
                          </p>
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-medium">{l.unidadesTicket}</td>
                        <td className="py-2 px-3 text-center font-mono font-medium">
                          {l.unidadesDispensadasTotal}
                        </td>
                        <td className="py-2 px-3">
                          {l.estadoLinea === 'COINCIDE' && (
                            <span className="rounded bg-dispensar-bg px-2 py-0.5 text-xs font-semibold text-dispensar">
                              Coincide
                            </span>
                          )}
                          {l.estadoLinea === 'DEFICIT_TICKET' && (
                            <span className="rounded bg-pedir-bg px-2 py-0.5 text-xs font-semibold text-pedir">
                              Ticket ampara más uds.
                            </span>
                          )}
                          {l.estadoLinea === 'SIN_DISPENSACION' && (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              Sin receta vinculada
                            </span>
                          )}
                          {l.estadoLinea === 'EXCESO_DISPENSADO' && (
                            <span className="rounded bg-noconforme-bg px-2 py-0.5 text-xs font-semibold text-noconforme">
                              Exceso dispensado (Bloqueo)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mensajes de bloqueo si los hay */}
            {data.bloqueos.length > 0 && (
              <div className="flex flex-col gap-1">
                {data.bloqueos.map((b, idx) => (
                  <Mensaje key={idx} tipo="error">
                    {b}
                  </Mensaje>
                ))}
              </div>
            )}

            {error && <Mensaje tipo="error">{error}</Mensaje>}
            {exito && <Mensaje tipo="ok">Ticket confirmado satisfactoriamente.</Mensaje>}
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-between gap-3 border-t pt-4">
          <Boton variante="secundario" onClick={onCerrar}>
            Cerrar
          </Boton>
          {data && data.estado !== 'confirmado' && (
            <Boton
              data-testid="confirmar-ticket-multi"
              disabled={!data.puedeConfirmar || confirmando || exito}
              onClick={() => void confirmar()}
            >
              {confirmando ? 'Confirmando…' : 'Confirmar ticket'}
            </Boton>
          )}
        </div>
      </div>
    </div>
  );
}
