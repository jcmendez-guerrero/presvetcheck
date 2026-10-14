import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CN } from '../lib/textos';
import { BandaSustitucion } from '../componentes/bandas';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Cargando, Mensaje, Tarjeta } from '../componentes/ui';
import { Imprimible } from './dispensacion';

interface Sust {
  id: string;
  estado: string;
  modo: 'PRE' | 'POST';
  cnPropuesto: string;
  puedeDispensar: boolean;
  prescrito: { cn: string; nombre: string } | null;
  sustituto: { cn: string; nombre: string; laboratorio: string | null } | null;
  plantillaAvisoVeterinario: string;
  etiqueta: string;
  recetaId: string;
  lineaOrden: number;
}

const PASOS = ['PENDIENTE_AUTORIZACION_PREVIA', 'AUTORIZADA_PREVIA', 'PROPUESTA', 'CONSENTIMIENTO_TUTOR', 'AVISO_VETERINARIO', 'DISPENSADA', 'RECETA_APARTADA', 'FIRMADA_GARANTE', 'VALIDADA'];

/** Asistente de sustitución (SPEC §4.4.3, §8.6). */
export function Sustitucion() {
  const { id } = useParams({ from: '/sustituciones/$id' });
  const nav = useNavigate();
  const qc = useQueryClient();
  const { tiene } = useAuth();
  const q = useQuery({ queryKey: ['sust', id], queryFn: () => get<Sust>(`/api/sustituciones/${id}`), refetchInterval: (d) => (d.state.data?.estado === 'PENDIENTE_AUTORIZACION_PREVIA' ? 5000 : false) });
  const [medio, setMedio] = useState('presencial');
  const [aviso, setAviso] = useState({ medio: 'teléfono', resultado: '', urgencia: false, justificacion: '' });
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!q.data) return <Cargando />;
  const s = q.data;
  const accion = async (a: string, body: Record<string, unknown> = {}) => {
    setMsg(null);
    try {
      await post(`/api/sustituciones/${id}/${a}`, body);
      await qc.invalidateQueries({ queryKey: ['sust', id] });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error');
    }
  };
  const paso = PASOS.indexOf(s.estado);
  return (
    <>
      <BandaSustitucion prescrito={`${s.prescrito?.nombre ?? '—'} (${CN} ${s.prescrito?.cn ?? '—'})`} sustituto={`${s.sustituto?.nombre ?? ''} · ${s.sustituto?.laboratorio ?? ''} (${CN} ${s.cnPropuesto})`} />
      <Pagina titulo="Sustitución">
        <p>
          Estado: <strong>{s.estado.replaceAll('_', ' ').toLowerCase()}</strong> · Modo {s.modo === 'POST' ? 'firma posterior del garante' : 'aprobación previa del garante'}
        </p>
        {s.estado === 'PENDIENTE_AUTORIZACION_PREVIA' && (
          <Mensaje tipo="info">Esperando la aprobación del farmacéutico garante. Si no responde, pide el medicamento prescrito.</Mensaje>
        )}
        {(s.estado === 'PROPUESTA' || s.estado === 'AUTORIZADA_PREVIA') && (
          <Tarjeta titulo="1. Consentimiento del tutor (obligatorio)">
            <Campo etiqueta="Medio" value={medio} onChange={(e) => setMedio(e.target.value)} />
            <div className="mt-3 flex gap-3">
              <Boton onClick={() => void accion('consentimiento', { consiente: true, medio })}>El tutor da su conformidad</Boton>
              <Boton variante="peligro" onClick={() => void accion('consentimiento', { consiente: false, medio })}>
                No da su conformidad
              </Boton>
            </div>
          </Tarjeta>
        )}
        {s.estado === 'CONSENTIMIENTO_TUTOR' && (
          <Tarjeta titulo="2. Aviso al veterinario prescriptor (obligatorio salvo urgencia)">
            <div className="relative">
              <Imprimible titulo="Texto para el veterinario (correo o WhatsApp)" texto={s.plantillaAvisoVeterinario} />
              <Boton variante="texto" onClick={() => void navigator.clipboard?.writeText(s.plantillaAvisoVeterinario)}>
                <Copy aria-hidden className="h-4 w-4" /> Copiar texto
              </Boton>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Medio del aviso" value={aviso.medio} onChange={(e) => setAviso({ ...aviso, medio: e.target.value })} />
              <Campo etiqueta="Resultado" value={aviso.resultado} onChange={(e) => setAviso({ ...aviso, resultado: e.target.value })} />
            </div>
            <label className="mt-3 flex items-center gap-3">
              <input type="checkbox" className="h-6 w-6" checked={aviso.urgencia} onChange={(e) => setAviso({ ...aviso, urgencia: e.target.checked })} />
              Urgencia: no se ha podido avisar al veterinario
            </label>
            {aviso.urgencia && <Campo etiqueta="Justificación de la urgencia" value={aviso.justificacion} onChange={(e) => setAviso({ ...aviso, justificacion: e.target.value })} />}
            <Boton className="mt-3" onClick={() => void accion('aviso-veterinario', aviso)}>
              Registrar
            </Boton>
          </Tarjeta>
        )}
        {s.puedeDispensar && (
          <Boton
            className="text-lg"
            onClick={() => void nav({ to: '/recetas/$id/dispensar/$linea', params: { id: s.recetaId, linea: String(s.lineaOrden) }, search: { sustitucion: s.id } })}
          >
            3. Ir a dispensar el sustituto
          </Boton>
        )}
        {s.estado === 'DISPENSADA' && (
          <Tarjeta titulo="4. Separar la receta en la bandeja de sustituciones">
            <Imprimible titulo="Etiqueta para el dorso (62 mm o A6)" texto={s.etiqueta} />
            <Boton className="mt-3" onClick={() => void accion('anotacion')}>
              La receta está en la bandeja física
            </Boton>
          </Tarjeta>
        )}
        {tiene('farmaceutico_garante') && ['PENDIENTE_AUTORIZACION_PREVIA', 'RECETA_APARTADA', 'FIRMADA_GARANTE'].includes(s.estado) && (
          <Tarjeta titulo="Farmacéutico garante">
            <div className="flex flex-wrap gap-3">
              {s.estado !== 'FIRMADA_GARANTE' ? (
                <Boton onClick={() => void accion('autorizar', { confirmaIndicacionProbable: true })}>{s.estado === 'RECETA_APARTADA' ? 'Firmar la anotación' : 'Autorizar'}</Boton>
              ) : (
                <Boton onClick={() => void accion('validar')}>Validar</Boton>
              )}
              <Campo etiqueta="Motivo del rechazo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              <Boton variante="peligro" onClick={() => void accion('rechazar', { motivo })}>
                {paso > PASOS.indexOf('AVISO_VETERINARIO') ? 'Sustitución no conforme' : 'Rechazar'}
              </Boton>
            </div>
          </Tarjeta>
        )}
        {msg && <Mensaje tipo="error">{msg}</Mensaje>}
      </Pagina>
    </>
  );
}
