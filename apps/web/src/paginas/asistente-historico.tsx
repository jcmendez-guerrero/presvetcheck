import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContextoConversacion, IntercambioDto } from '@mmx/shared';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Respuesta } from '../componentes/asistente';
import { Pagina } from '../componentes/layout';
import { Boton, Cargando, Mensaje, Tarjeta } from '../componentes/ui';

/**
 * Consultas al asistente (specs/001-prescription-chat-assistant, US4): cada persona ve las suyas; veterinaria
 * responsable y administración, las de todos. Muestra las fuentes y la versión de las reglas del momento en que se
 * respondió, aunque las reglas hayan cambiado después. Las conversaciones se eliminan al año.
 */
interface Fila {
  id: string;
  usuario: { id: string; nombre: string };
  contexto: ContextoConversacion;
  primeraPregunta: string | null;
  intercambios: number;
  incorrectas: number;
  createdAt: string;
}
interface Listado {
  total: number;
  items: Fila[];
}
interface Detalle {
  id: string;
  usuario: { id: string; nombre: string };
  contexto: ContextoConversacion;
  createdAt: string;
  intercambios: IntercambioDto[];
}

const CONTEXTO: Record<ContextoConversacion['tipo'], string> = {
  general: 'Duda general',
  linea: 'Línea de receta',
  medicamento: 'Medicamento',
};
const TAMANO = 25;
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    dateStyle: 'short',
    timeStyle: 'short',
  });

export function AsistenteHistorico() {
  const { tiene } = useAuth();
  const veTodo = tiene('veterinaria_responsable', 'admin');
  const [f, setF] = useState({ desde: '', hasta: '', valoracion: '', usuario: '', conReceta: '' });
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState<string | null>(null);
  const qs = new URLSearchParams({ pagina: String(pagina), tamano: String(TAMANO) });
  for (const [k, v] of Object.entries(f)) if (v && (veTodo || k !== 'usuario')) qs.set(k, v);
  const lista = useQuery({
    queryKey: ['asistente-historico', qs.toString()],
    queryFn: () => get<Listado>(`/api/asistente/conversaciones?${qs}`),
  });
  const detalle = useQuery({
    queryKey: ['asistente-detalle', abierta],
    queryFn: () => get<Detalle>(`/api/asistente/conversaciones/${abierta}`),
    enabled: !!abierta,
  });
  const cambiar = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPagina(1);
  };
  const paginas = Math.max(1, Math.ceil((lista.data?.total ?? 0) / TAMANO));

  return (
    <Pagina titulo="Consultas al asistente">
      <p className="text-slate-700">
        {veTodo ? 'Las consultas de todo el equipo.' : 'Tus consultas.'} Se eliminan al año. Las valoradas
        como «incorrecta» ayudan a mejorar la documentación.
      </p>
      <Tarjeta titulo="Filtros">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1">
            Desde
            <input
              type="date"
              className="min-h-11 rounded-lg border px-2"
              value={f.desde}
              onChange={(e) => cambiar('desde', e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input
              type="date"
              className="min-h-11 rounded-lg border px-2"
              value={f.hasta}
              onChange={(e) => cambiar('hasta', e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            Valoración
            <select
              className="min-h-11 rounded-lg border px-2"
              value={f.valoracion}
              onChange={(e) => cambiar('valoracion', e.target.value)}
            >
              <option value="">Todas</option>
              <option value="incorrecta">Incorrecta</option>
              <option value="util">Útil</option>
              <option value="sin_valorar">Sin valorar</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Con receta
            <select
              className="min-h-11 rounded-lg border px-2"
              value={f.conReceta}
              onChange={(e) => cambiar('conReceta', e.target.value)}
            >
              <option value="">Todas</option>
              <option value="true">Sobre una receta</option>
              <option value="false">Sin receta</option>
            </select>
          </label>
          {veTodo && (
            <label className="flex flex-col gap-1">
              Persona
              <select
                className="min-h-11 rounded-lg border px-2"
                value={f.usuario}
                onChange={(e) => cambiar('usuario', e.target.value)}
              >
                <option value="">Todas</option>
                {[
                  ...new Map(
                    (lista.data?.items ?? []).map((i) => [i.usuario.id, i.usuario.nombre]),
                  ).entries(),
                ].map(([id, nombre]) => (
                  <option key={id} value={id}>
                    {nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Tarjeta>

      {lista.isLoading && <Cargando />}
      {lista.error && <Mensaje tipo="error">{(lista.error as Error).message}</Mensaje>}
      {lista.data && lista.data.items.length === 0 && (
        <Mensaje tipo="info">No hay consultas con esos filtros.</Mensaje>
      )}
      {lista.data && lista.data.items.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="asistente-lista">
          {lista.data.items.map((i) => (
            <li key={i.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <button
                type="button"
                className="flex min-h-11 w-full flex-wrap items-center gap-x-4 gap-y-1 text-left"
                aria-expanded={abierta === i.id}
                onClick={() => setAbierta(abierta === i.id ? null : i.id)}
              >
                <span className="font-semibold">{fechaHora(i.createdAt)}</span>
                <span>{i.usuario.nombre}</span>
                <span className="rounded-full bg-fondo px-2 text-sm">{CONTEXTO[i.contexto.tipo]}</span>
                <span className="flex-1 truncate">{i.primeraPregunta ?? '(sin preguntas)'}</span>
                <span className="text-sm text-slate-600">{i.intercambios} resp.</span>
                {i.incorrectas > 0 && (
                  <span className="rounded-full bg-noconforme-bg px-2 text-sm font-semibold text-noconforme">
                    {i.incorrectas} incorrecta(s)
                  </span>
                )}
              </button>
              {abierta === i.id && (
                <div className="mt-3 space-y-4 border-t pt-3">
                  {detalle.isLoading && <Cargando />}
                  {detalle.data?.intercambios.map((x) => (
                    <div key={x.id} className="space-y-2">
                      <p className="rounded-2xl bg-marca px-3 py-2 text-white">{x.pregunta}</p>
                      {x.estado === 'respondida' ? (
                        <Respuesta i={x} />
                      ) : (
                        <p className="text-sm text-noconforme">
                          No hubo respuesta (
                          {x.estado === 'limite'
                            ? 'límite mensual alcanzado'
                            : 'el asistente no estaba disponible'}
                          ).
                        </p>
                      )}
                      <p className="text-xs text-slate-600">
                        Reglas <span className="break-all">{x.reglaVersion}</span> · Fuentes{' '}
                        <span className="break-all">{x.fuentesVersion}</span> · {fechaHora(x.createdAt)}
                      </p>
                      {x.valoracion && (
                        <p
                          className={`rounded-lg p-2 text-sm ${x.valoracion.valor === 'incorrecta' ? 'bg-noconforme-bg' : 'bg-dispensar-bg'}`}
                        >
                          Valoración:{' '}
                          <strong>{x.valoracion.valor === 'incorrecta' ? 'incorrecta' : 'útil'}</strong>
                          {x.valoracion.comentario ? ` · «${x.valoracion.comentario}»` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {paginas > 1 && (
        <div className="flex items-center gap-3">
          <Boton variante="secundario" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </Boton>
          <span>
            Página {pagina} de {paginas}
          </span>
          <Boton variante="secundario" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
            Siguiente
          </Boton>
        </div>
      )}
    </Pagina>
  );
}
