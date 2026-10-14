import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CN, fecha } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Cargando, Mensaje, Tarjeta } from '../componentes/ui';

interface Bandeja {
  sustituciones: Array<{ id: string; estado: string; modo: string; cnPrescrito: string | null; cnPropuesto: string; indicacion: string | null; antiguedadDias: number; alerta: boolean }>;
  dispensacionesARevisar: Array<{ id: string; fechaVenta: string; nombre: string; cn: string; lote: string; forzado: boolean; defectos: string[]; motivo: string | null; cambioFormato: boolean; cambioConcentracion: boolean; empleado: string; productoNoValido: boolean }>;
  recetasNoConformes: Array<{ id: string; numero: string | null; createdAt: string; motivos: string[] }>;
  discrepancias: Array<{ id: string; tipo: string; fecha: string }>;
}

/** Bandeja del garante (SPEC §8.9): pendientes por tipo, aprobación/rechazo y MFA obligatorio. */
export function Garante() {
  const { usuario } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bandeja'], queryFn: () => get<Bandeja>('/api/garante/bandeja') });
  const [msg, setMsg] = useState<string | null>(null);
  if (!q.data) return <Cargando />;
  const revisar = async (entidad: string, entidadId: string, resultado: 'conforme' | 'no_conforme') => {
    try {
      await post('/api/garante/revisiones', { entidad, entidadId, resultado, comentario: null });
      await qc.invalidateQueries({ queryKey: ['bandeja'] });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error');
    }
  };
  const b = q.data;
  return (
    <Pagina titulo="Bandeja del garante">
      {!usuario?.mfa && <Mensaje tipo="aviso">Tu sesión no tiene MFA: no podrás firmar ni revisar hasta iniciar sesión con autenticación multifactor.</Mensaje>}
      {msg && <Mensaje tipo="error">{msg}</Mensaje>}
      <Tarjeta titulo={`Sustituciones (${b.sustituciones.length})`}>
        <ul className="divide-y">
          {b.sustituciones.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {s.estado.replaceAll('_', ' ').toLowerCase()} · {CN} {s.cnPrescrito} → {s.cnPropuesto} · {s.antiguedadDias} días
                {s.alerta && <strong className="ml-2 text-noconforme">Supera el plazo de firma</strong>}
                {s.indicacion === 'PROBABLE' && <strong className="ml-2 text-sustituir">Indicación probable</strong>}
              </span>
              <Link to="/sustituciones/$id" params={{ id: s.id }} className="font-semibold text-marca underline">
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      </Tarjeta>
      <Tarjeta titulo={`Dispensaciones forzadas y cambios de formato (${b.dispensacionesARevisar.length})`}>
        <ul className="divide-y">
          {b.dispensacionesARevisar.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {fecha(d.fechaVenta)} · {d.nombre} · lote {d.lote} · {d.empleado}
                {d.forzado && <strong className="ml-2 text-noconforme">Forzado: {d.defectos.join(', ')}</strong>}
                {d.productoNoValido && <strong className="ml-2">(producto no válido)</strong>}
                {d.motivo && <span className="block text-sm">Motivo: {d.motivo}</span>}
                {(d.cambioFormato || d.cambioConcentracion) && <span className="block text-sm">Cambio de {d.cambioConcentracion ? 'concentración' : 'formato'}</span>}
              </span>
              <span className="flex gap-2">
                <Boton onClick={() => void revisar('dispensacion', d.id, 'conforme')}>Conforme</Boton>
                <Boton variante="peligro" onClick={() => void revisar('dispensacion', d.id, 'no_conforme')}>
                  No conforme
                </Boton>
              </span>
            </li>
          ))}
        </ul>
      </Tarjeta>
      <Tarjeta titulo={`Recetas no conformes (${b.recetasNoConformes.length})`}>
        <ul className="divide-y">
          {b.recetasNoConformes.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                Receta {r.numero ?? '—'} · {fecha(r.createdAt)} · {[...new Set(r.motivos)].join(', ')}
              </span>
              <Boton variante="secundario" onClick={() => void revisar('receta', r.id, 'conforme')}>
                Revisada
              </Boton>
            </li>
          ))}
        </ul>
      </Tarjeta>
      <Tarjeta titulo={`Discrepancias de conciliación (${b.discrepancias.length})`}>
        <ul>
          {b.discrepancias.map((d) => (
            <li key={d.id}>
              {fecha(d.fecha)} · {d.tipo}{' '}
              <Boton variante="texto" onClick={() => void revisar('discrepancia', d.id, 'conforme')}>
                Resolver
              </Boton>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </Pagina>
  );
}
