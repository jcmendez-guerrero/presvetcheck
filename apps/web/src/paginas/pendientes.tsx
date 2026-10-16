import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, get, post } from '../lib/api';
import { CN, fecha } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Cargando, Campo, Mensaje, Tarjeta } from '../componentes/ui';

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
  if (!q.data) return <Cargando />;
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
            <li key={s.id} className="py-2 text-sm">
              {fecha(s.fecha.slice(0, 10))} · {s.nombre} · {CN} {s.cn} · lote {s.lote} ·{' '}
              {s.fraccion ? 'fracción: compruébala a mano con el ticket' : `${s.unidades} envase(s)`}
            </li>
          ))}
        </ul>
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
    </Pagina>
  );
}
