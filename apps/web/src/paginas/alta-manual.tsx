import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Etiqueta, Mensaje, Tarjeta } from '../componentes/ui';

/**
 * Alta manual de una receta sin imagen (specs/011): solo la veterinaria responsable, para recetas que se
 * dispensaron fuera de la aplicación. Aquí solo se indica el motivo y dónde está el papel; el resto de datos se
 * rellenan en la revisión, con el medicamento y la especie elegidos de CIMAVet.
 */
export function AltaManual() {
  const { config, tiene } = useAuth();
  const navigate = useNavigate();
  const [tipo, setTipo] = useState<'papel' | 'electronica'>('papel');
  const [motivo, setMotivo] = useState('');
  const [custodia, setCustodia] = useState('');
  const [plataformaId, setPlataformaId] = useState('');
  const [idPlataforma, setIdPlataforma] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const plataformas = useQuery({
    queryKey: ['plataformas'],
    queryFn: () => get<{ id: string; nombre: string }[]>('/api/admin/plataformas'),
    enabled: tipo === 'electronica',
  });

  if (!config?.altaManualHabilitada || !tiene('veterinaria_responsable'))
    return (
      <Pagina titulo="Alta manual de receta">
        <Mensaje tipo="aviso">
          El alta manual de recetas no está disponible para tu usuario o no está activada.
        </Mensaje>
      </Pagina>
    );

  const motivoCorto = motivo.trim().length < 15;
  const faltaDestino = tipo === 'papel' ? !custodia.trim() : !plataformaId || !idPlataforma.trim();

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await post<{ id: string }>('/api/recetas/manual', {
        tipo,
        motivo: motivo.trim(),
        custodiaPapel: tipo === 'papel' ? custodia.trim() : null,
        plataformaId: tipo === 'electronica' ? plataformaId : null,
        idPlataforma: tipo === 'electronica' ? idPlataforma.trim() : null,
      });
      await navigate({ to: '/recetas/$id/revision', params: { id: r.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se ha podido dar de alta la receta.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pagina titulo="Alta manual de receta">
      <Tarjeta
        titulo="Receta dispensada fuera de la aplicación"
        subtitulo="Úsalo solo para recetas que ya se entregaron y no se pudieron fotografiar. Guarda siempre el original."
      >
        <form className="flex flex-col gap-4" onSubmit={enviar}>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 font-medium">Tipo de receta</legend>
            {(['papel', 'electronica'] as const).map((t) => (
              <label key={t} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="tipo" checked={tipo === t} onChange={() => setTipo(t)} />
                {t === 'papel' ? 'En papel' : 'Electrónica'}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm">
            <Etiqueta texto="Motivo del alta manual" />
            <textarea
              data-testid="alta-motivo"
              className="min-h-20 rounded-lg border border-borde bg-superficie px-3 py-2"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por ejemplo: se dispensó con la aplicación caída"
            />
            <span className="text-xs text-texto-muted">
              Al menos 15 caracteres. No escribas nombres ni teléfonos.
            </span>
          </label>
          {tipo === 'papel' ? (
            <Campo
              data-testid="alta-custodia"
              etiqueta="Dónde está guardada la receta en papel"
              ayuda="Por ejemplo: archivador de recetas de octubre. Sin datos personales."
              value={custodia}
              onChange={(e) => setCustodia(e.target.value)}
            />
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <Etiqueta texto="Plataforma de receta electrónica" />
                <select
                  className="min-h-11 rounded-lg border px-2"
                  value={plataformaId}
                  onChange={(e) => setPlataformaId(e.target.value)}
                >
                  <option value="">Elige la plataforma</option>
                  {plataformas.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <Campo
                etiqueta="Identificador de la receta en la plataforma"
                value={idPlataforma}
                onChange={(e) => setIdPlataforma(e.target.value)}
              />
            </>
          )}
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          <div>
            <Boton
              type="submit"
              data-testid="alta-continuar"
              cargando={enviando}
              disabled={motivoCorto || faltaDestino}
            >
              Continuar con los datos de la receta
            </Boton>
          </div>
        </form>
      </Tarjeta>
    </Pagina>
  );
}
