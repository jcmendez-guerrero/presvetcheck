import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Cog,
  MessageCircleQuestion,
  Send,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import {
  MAX_PREGUNTA,
  type CandidatoMedicamento,
  type ConsumoMesDto,
  type CriterioComparativaSustitucion,
  type FuenteCitada,
  type IntercambioDto,
  type SimulacionGuardada,
} from '@mmx/shared';
import { ApiError, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Boton } from './ui';

/**
 * Asistente de consultas (specs/002-prescription-chat-assistant): botón «Preguntar» y panel lateral. Solo informa:
 * no autoriza ni modifica nada. El detalle de las simulaciones y del resultado del motor se pinta desde los datos
 * del motor, nunca desde el texto del modelo.
 */
export type ContextoAsistente =
  | { tipo: 'general' }
  | { tipo: 'linea'; recetaLineaId: string; etiqueta?: string }
  | { tipo: 'medicamento'; nregistro?: string };

interface EstadoAsistente {
  activo: boolean;
  estadoConsumo: ConsumoMesDto['estado'];
  preguntasEjemplo: string[];
}

interface Ctx {
  activo: boolean;
  abrir: (c?: ContextoAsistente) => void;
}
const AsistenteCtx = createContext<Ctx>({ activo: false, abrir: () => {} });
export const useAsistente = () => useContext(AsistenteCtx);

export function ProveedorAsistente({ children }: { children: ReactNode }) {
  const { usuario, tiene } = useAuth();
  const [estado, setEstado] = useState<EstadoAsistente | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [contexto, setContexto] = useState<ContextoAsistente>({ tipo: 'general' });
  const previo = useRef<HTMLElement | null>(null);
  const puede = !!usuario && tiene('empleado', 'veterinaria_responsable', 'admin');

  useEffect(() => {
    if (!puede) return;
    let vivo = true;
    get<EstadoAsistente>('/api/asistente/estado')
      .then((e) => vivo && setEstado(e))
      .catch(() => vivo && setEstado(null));
    return () => {
      vivo = false;
    };
  }, [puede, usuario?.id]);

  const abrir = useCallback((c: ContextoAsistente = { tipo: 'general' }) => {
    previo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setContexto(c);
    setAbierto(true);
  }, []);
  const cerrar = useCallback(() => {
    setAbierto(false);
    // En la dispensación el foco vuelve siempre al campo de escaneo; en el resto, a donde estaba.
    setTimeout(() => (document.getElementById('campo-escaneo') ?? previo.current)?.focus(), 0);
  }, []);

  const activo = puede && !!estado?.activo;
  const valor = useMemo(() => ({ activo, abrir }), [activo, abrir]);
  return (
    <AsistenteCtx.Provider value={valor}>
      {children}
      {activo && !abierto && (
        <button
          type="button"
          data-testid="asistente-abrir"
          onClick={() => abrir({ tipo: 'general' })}
          className="fixed bottom-4 right-4 z-40 flex min-h-12 items-center gap-2 rounded-full bg-marca px-5 font-semibold text-white shadow-lg hover:bg-marca-2"
        >
          <MessageCircleQuestion aria-hidden className="h-5 w-5" />
          Preguntar
        </button>
      )}
      {activo && abierto && (
        <PanelAsistente
          key={JSON.stringify(contexto)}
          contexto={contexto}
          estado={estado as EstadoAsistente}
          onCerrar={cerrar}
        />
      )}
    </AsistenteCtx.Provider>
  );
}

/** Botón «Preguntar sobre esta línea» para las pantallas de resultado y de dispensación. */
export function BotonPreguntarLinea({
  recetaLineaId,
  etiqueta,
}: {
  recetaLineaId: string;
  etiqueta?: string;
}) {
  const { activo, abrir } = useAsistente();
  if (!activo) return null;
  return (
    <Boton
      variante="secundario"
      data-testid="asistente-linea"
      onClick={() => abrir({ tipo: 'linea', recetaLineaId, ...(etiqueta ? { etiqueta } : {}) })}
    >
      <MessageCircleQuestion aria-hidden className="h-5 w-5" />
      Preguntar sobre esta línea
    </Boton>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

interface Mensaje {
  pregunta: string;
  estado: 'cargando' | 'ok' | 'error';
  intercambio?: IntercambioDto;
  error?: { code: string; mensaje: string };
}

function PanelAsistente({
  contexto,
  estado,
  onCerrar,
}: {
  contexto: ContextoAsistente;
  estado: EstadoAsistente;
  onCerrar: () => void;
}) {
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [ejemplos, setEjemplos] = useState<string[]>(estado.preguntasEjemplo);
  const fin = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    campo.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onCerrar]);
  useEffect(() => {
    fin.current?.scrollIntoView?.({ block: 'end' });
  }, [mensajes]);

  const enviar = async (pregunta: string) => {
    const p = pregunta.trim();
    if (!p || mensajes.some((m) => m.estado === 'cargando')) return;
    setTexto('');
    setMensajes((ms) => [...ms, { pregunta: p, estado: 'cargando' }]);
    const poner = (m: Partial<Mensaje>) =>
      setMensajes((ms) => ms.map((x, i) => (i === ms.length - 1 ? { ...x, ...m } : x)));
    try {
      let id = conversacionId;
      if (!id) {
        const c = await post<{ id: string; preguntasEjemplo: string[] }>('/api/asistente/conversaciones', {
          contexto:
            contexto.tipo === 'linea' ? { tipo: 'linea', recetaLineaId: contexto.recetaLineaId } : contexto,
        });
        id = c.id;
        setConversacionId(id);
        setEjemplos(c.preguntasEjemplo);
      }
      const r = await post<{ intercambio: IntercambioDto }>(`/api/asistente/conversaciones/${id}/mensajes`, {
        pregunta: p,
      });
      poner({ estado: 'ok', intercambio: r.intercambio });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      poner({
        estado: 'error',
        error: {
          code: err?.code ?? 'ASISTENTE_NO_DISPONIBLE',
          mensaje: err?.message ?? 'El asistente no está disponible ahora; consulta la Ayuda.',
        },
      });
    }
  };

  const nueva = () => {
    if (conversacionId) void post(`/api/asistente/conversaciones/${conversacionId}/cerrar`).catch(() => {});
    setConversacionId(null);
    setMensajes([]);
    setEjemplos(estado.preguntasEjemplo);
  };

  return (
    <div
      role="dialog"
      aria-label="Asistente de consultas"
      data-testid="asistente-panel"
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl ring-1 ring-slate-300 sm:w-[28rem]"
    >
      <header className="flex items-center gap-2 bg-marca px-4 py-3 text-white">
        <MessageCircleQuestion aria-hidden className="h-6 w-6" />
        <h2 className="flex-1 text-lg font-bold">Asistente de consultas</h2>
        <Link
          to="/asistente/historico"
          onClick={onCerrar}
          className="flex min-h-11 items-center rounded-lg px-3 text-sm underline hover:bg-marca-2"
        >
          Historial
        </Link>
        {mensajes.length > 0 && (
          <button
            type="button"
            className="min-h-11 rounded-lg px-3 text-sm underline hover:bg-marca-2"
            onClick={nueva}
          >
            Nueva conversación
          </button>
        )}
        <button
          type="button"
          aria-label="Cerrar el asistente"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-marca-2"
          onClick={onCerrar}
        >
          <X aria-hidden className="h-5 w-5" />
        </button>
      </header>
      {contexto.tipo === 'linea' && (
        <p className="border-b bg-pedir-bg px-4 py-2 text-sm text-marca-2">
          Preguntas sobre {contexto.etiqueta ?? 'una línea de la receta'}.
        </p>
      )}
      <p className="border-b bg-sustituir-bg px-4 py-2 text-sm">
        Solo explica las reglas: no decide ni autoriza nada. <strong>No escribas datos del cliente</strong>{' '}
        (nombre, teléfono, DNI o dirección).
      </p>

      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {mensajes.length === 0 && (
          <div>
            <p className="font-semibold">¿Qué quieres saber?</p>
            <ul className="mt-2 flex flex-col gap-2">
              {ejemplos.map((e) => (
                <li key={e}>
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-xl bg-fondo px-3 py-2 text-left ring-1 ring-marca/30 hover:bg-pedir-bg"
                    onClick={() => void enviar(e)}
                  >
                    {e}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-8 rounded-2xl rounded-tr-sm bg-marca px-3 py-2 text-white">{m.pregunta}</p>
            {m.estado === 'cargando' && (
              <p className="animate-pulse text-slate-600">Buscando en las reglas…</p>
            )}
            {m.estado === 'error' && (
              <ErrorAsistente code={m.error?.code ?? ''} mensaje={m.error?.mensaje ?? ''} />
            )}
            {m.estado === 'ok' && m.intercambio && (
              <Respuesta
                valorable
                i={m.intercambio}
                onElegir={(c) =>
                  void enviar(`Me refiero a ${c.nombre}${c.cn ? ` (código nacional ${c.cn})` : ''}`)
                }
              />
            )}
          </div>
        ))}
        {mensajes.at(-1)?.intercambio?.piiEliminada && (
          <p role="alert" className="rounded-lg bg-sustituir-bg p-2 text-sm">
            Hemos eliminado datos personales de tu pregunta. Por favor, no los escribas.
          </p>
        )}
        <div ref={fin} />
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(texto);
        }}
      >
        <label className="sr-only" htmlFor="asistente-pregunta">
          Tu pregunta
        </label>
        <textarea
          id="asistente-pregunta"
          ref={campo}
          data-testid="asistente-pregunta"
          value={texto}
          maxLength={MAX_PREGUNTA}
          rows={2}
          placeholder="Escribe tu pregunta…"
          className="min-h-11 flex-1 resize-none rounded-lg border px-3 py-2"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void enviar(texto);
            }
          }}
        />
        <Boton
          type="submit"
          data-testid="asistente-enviar"
          disabled={!texto.trim()}
          aria-label="Enviar la pregunta"
        >
          <Send aria-hidden className="h-5 w-5" />
        </Boton>
      </form>
    </div>
  );
}

function ErrorAsistente({ code, mensaje }: { code: string; mensaje: string }) {
  const conAyuda = code === 'ASISTENTE_NO_DISPONIBLE' || code === 'ASISTENTE_LIMITE_MENSUAL';
  return (
    <div role="alert" className="rounded-xl border-l-4 border-noconforme bg-noconforme-bg p-3">
      <p className="flex items-start gap-2 font-semibold text-noconforme">
        <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
        {mensaje}
      </p>
      {conAyuda && (
        <p className="ml-7 text-sm">
          <Link to="/ayuda" className="text-marca underline">
            Ir a la Ayuda
          </Link>
        </p>
      )}
    </div>
  );
}

export function Respuesta({
  i,
  onElegir,
  valorable = false,
}: {
  i: IntercambioDto;
  onElegir?: (c: CandidatoMedicamento) => void;
  valorable?: boolean;
}) {
  const estilo =
    i.tipo === 'fuera_de_ambito' || i.tipo === 'rechazo_reglas'
      ? 'bg-pedir-bg'
      : i.tipo === 'sin_informacion'
        ? 'bg-sustituir-bg'
        : 'bg-fondo';
  return (
    <div className="mr-4 space-y-2" data-testid="asistente-respuesta" data-tipo={i.tipo ?? ''}>
      <p
        className={`whitespace-pre-wrap rounded-2xl rounded-tl-sm px-3 py-2 ring-1 ring-slate-200 ${estilo}`}
      >
        {i.texto}
      </p>
      {onElegir && i.candidatos && i.candidatos.length > 0 && (
        <div>
          <p className="text-sm font-semibold">Elige el medicamento</p>
          <ul className="mt-1 flex flex-col gap-2">
            {i.candidatos.map((c) => (
              <li key={c.nregistro}>
                <button
                  type="button"
                  data-testid="asistente-candidato"
                  className="min-h-11 w-full rounded-xl bg-white px-3 py-2 text-left ring-1 ring-marca/30 hover:bg-pedir-bg"
                  onClick={() => onElegir?.(c)}
                >
                  {c.nombre}
                  {c.cn ? ` · código nacional ${c.cn}` : ''}
                  {c.laboratorio ? ` · ${c.laboratorio}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {i.resultadoMotor && <TarjetaMotor r={i.resultadoMotor} version={i.reglaVersion} />}
      {i.simulaciones.map((s) => (
        <TarjetaSimulacion key={s.simulacionId} s={s} />
      ))}
      {i.fuentes.length > 0 && <Fuentes fuentes={i.fuentes} />}
      {valorable && <Valoracion intercambioId={i.id} inicial={i.valoracion} />}
    </div>
  );
}

/** ¿Te ha servido la respuesta? «Incorrecta» admite un comentario (sin datos del cliente). */
function Valoracion({
  intercambioId,
  inicial,
}: {
  intercambioId: string;
  inicial: IntercambioDto['valoracion'];
}) {
  const [valor, setValor] = useState<'util' | 'incorrecta' | null>(inicial?.valor ?? null);
  const [comentando, setComentando] = useState(false);
  const [comentario, setComentario] = useState(inicial?.comentario ?? '');
  const [error, setError] = useState(false);
  const enviar = async (v: 'util' | 'incorrecta', c?: string) => {
    setError(false);
    try {
      await put(`/api/asistente/intercambios/${intercambioId}/valoracion`, {
        valor: v,
        ...(c ? { comentario: c } : {}),
      });
      setValor(v);
      setComentando(false);
    } catch {
      setError(true);
    }
  };
  return (
    <div className="text-sm" data-testid="asistente-valoracion">
      <div className="flex flex-wrap items-center gap-2">
        <span>¿Te ha servido?</span>
        <button
          type="button"
          aria-pressed={valor === 'util'}
          className={`inline-flex min-h-11 items-center gap-1 rounded-full px-3 ring-1 ring-slate-300 ${valor === 'util' ? 'bg-dispensar-bg font-semibold text-dispensar' : 'bg-white'}`}
          onClick={() => void enviar('util')}
        >
          <ThumbsUp aria-hidden className="h-4 w-4" /> Útil
        </button>
        <button
          type="button"
          aria-pressed={valor === 'incorrecta'}
          className={`inline-flex min-h-11 items-center gap-1 rounded-full px-3 ring-1 ring-slate-300 ${valor === 'incorrecta' ? 'bg-noconforme-bg font-semibold text-noconforme' : 'bg-white'}`}
          onClick={() => setComentando(true)}
        >
          <ThumbsDown aria-hidden className="h-4 w-4" /> Incorrecta
        </button>
      </div>
      {comentando && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar('incorrecta', comentario.trim());
          }}
        >
          <label htmlFor={`com-${intercambioId}`}>¿Qué está mal? (opcional, sin datos del cliente)</label>
          <textarea
            id={`com-${intercambioId}`}
            value={comentario}
            maxLength={500}
            rows={2}
            className="rounded-lg border px-3 py-2"
            onChange={(e) => setComentario(e.target.value)}
          />
          <Boton type="submit">Enviar valoración</Boton>
        </form>
      )}
      {valor && !comentando && (
        <p className="mt-1 text-xs text-slate-600">Gracias: tu valoración queda guardada.</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-noconforme">
          No se ha podido guardar la valoración.
        </p>
      )}
    </div>
  );
}

const DECISION_SIM: Record<string, string> = {
  VALIDA_HASTA: 'Receta válida',
  CADUCADA: 'Receta caducada',
  PERMITIDA: 'Se puede sustituir',
  NO_PERMITIDA: 'No se puede sustituir',
  EQUIVALENTE: 'Equivalente',
  NO_EQUIVALENTE: 'No equivalente',
  ALTERNATIVA_VALIDA: 'Alternativa válida',
  ALTERNATIVA_NO_VALIDA: 'Alternativa no válida',
  FALTAN_DATOS: 'Faltan datos',
};

export function TablaComparativaCriterios({
  comparativa,
}: {
  comparativa: CriterioComparativaSustitucion[];
}) {
  if (!comparativa || comparativa.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table
        className="w-full text-left text-xs text-slate-800"
        data-testid="tabla-comparativa-sustitucion"
        aria-label="Comparativa de criterios de sustitución"
      >
        <thead>
          <tr className="border-b border-slate-300 bg-white/60 font-semibold text-slate-700">
            <th scope="col" className="p-2">
              Criterio
            </th>
            <th scope="col" className="p-2">
              Prescrito
            </th>
            <th scope="col" className="p-2">
              Candidato
            </th>
            <th scope="col" className="p-2 text-center">
              Estado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {comparativa.map((c) => (
            <tr key={c.criterio} className={c.coincide ? 'bg-white/40' : 'bg-noconforme-bg/40'}>
              <td className="p-2 font-medium text-slate-900">{c.criterio}</td>
              <td className="p-2 text-slate-700">{c.prescrito}</td>
              <td className="p-2 text-slate-700">{c.candidato}</td>
              <td className="p-2 text-center">
                {c.coincide ? (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-dispensar-bg px-2 py-0.5 font-medium text-dispensar"
                    title={c.detalle ?? 'Cumple el requisito normativo'}
                  >
                    ✓ Coincide
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-noconforme-bg px-2 py-0.5 font-medium text-noconforme"
                    title={c.detalle ?? 'Discrepancia reglamentaria'}
                  >
                    ✗ Discrepancia
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TarjetaSimulacion({ s }: { s: SimulacionGuardada }) {
  const ev = (s.evidencias ?? {}) as Record<string, unknown>;
  const hasta = typeof ev['validezEfectiva'] === 'string' ? ev['validezEfectiva'] : null;
  const comparativa = Array.isArray(ev['comparativa'])
    ? (ev['comparativa'] as CriterioComparativaSustitucion[])
    : null;
  return (
    <section
      className="rounded-xl border-l-4 border-marca bg-pedir-bg p-3"
      aria-label="Simulación"
      data-testid="asistente-simulacion"
    >
      <p className="flex items-center gap-2 font-semibold text-marca">
        <Calculator aria-hidden className="h-5 w-5" /> Simulación: {DECISION_SIM[s.decision] ?? s.decision}
      </p>
      {hasta && (
        <p className="ml-7 text-sm">
          Válida hasta el <strong>{fechaEs(hasta)}</strong>
          {typeof ev['plazoMaximo'] === 'string' ? ` (plazo máximo: ${ev['plazoMaximo']})` : ''}.
        </p>
      )}
      {s.motivos.map((m) => (
        <p key={m.code} className="ml-7 text-sm">
          {m.mensaje}
        </p>
      ))}
      {comparativa && comparativa.length > 0 && (
        <div className="ml-7 mt-3">
          <TablaComparativaCriterios comparativa={comparativa} />
        </div>
      )}
      {Object.keys(s.supuestos).length > 0 && (
        <details className="ml-7 mt-1 text-sm">
          <summary className="cursor-pointer text-marca-2">Datos supuestos</summary>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-white p-2 text-xs">
            {JSON.stringify(s.supuestos, null, 2)}
          </pre>
        </details>
      )}
      <p className="ml-7 mt-1 text-xs text-slate-600">
        Simulación: no se ha guardado ninguna receta. Reglas {s.reglaVersion}.
      </p>
    </section>
  );
}

function TarjetaMotor({ r, version }: { r: NonNullable<IntercambioDto['resultadoMotor']>; version: string }) {
  return (
    <section
      className="rounded-xl border-l-4 border-marca-2 bg-white p-3 ring-1 ring-slate-200"
      aria-label="Resultado de la aplicación"
      data-testid="asistente-motor"
    >
      <p className="flex items-center gap-2 font-semibold text-marca">
        <Cog aria-hidden className="h-5 w-5" /> Resultado de la aplicación: {r.decision}
      </p>
      {r.motivos.map((m) => (
        <p key={m.code} className="ml-7 text-sm">
          {m.mensaje}
          {m.severidad === 'BLOQUEANTE_DURO' ? ' (no se puede forzar)' : ''}
        </p>
      ))}
      {r.equivalentes.length > 0 && (
        <ul className="ml-7 mt-1 list-disc pl-5 text-sm">
          {r.equivalentes.map((e) => (
            <li key={`${e.nregistro}-${e.cn ?? ''}`}>
              {e.nombre}
              {e.cn ? ` (código nacional ${e.cn})` : ''}
              {e.laboratorio ? ` · ${e.laboratorio}` : ''} · {e.stock ? 'hay stock' : 'sin stock'}
            </li>
          ))}
        </ul>
      )}
      <p className="ml-7 mt-1 text-xs text-slate-600">
        Reglas{' '}
        <span title={version} className="break-all">
          {versionCorta(version)}
        </span>
        .
      </p>
    </section>
  );
}

function Fuentes({ fuentes }: { fuentes: FuenteCitada[] }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [fragmento, setFragmento] = useState<{ contenido: string; versionVigente: boolean } | null>(null);
  const [fallo, setFallo] = useState(false);
  const abrir = async (f: FuenteCitada) => {
    if (abierta === f.fuenteId) return setAbierta(null);
    setAbierta(f.fuenteId);
    setFragmento(null);
    setFallo(false);
    try {
      setFragmento(
        await get(
          `/api/asistente/fuentes/${encodeURIComponent(f.fuenteId)}?version=${encodeURIComponent(f.version)}`,
        ),
      );
    } catch {
      setFallo(true);
    }
  };
  return (
    <div>
      <p className="text-sm font-semibold">Fuentes</p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {fuentes.map((f) => (
          <li key={f.fuenteId}>
            <button
              type="button"
              data-testid="asistente-fuente"
              aria-expanded={abierta === f.fuenteId}
              className="inline-flex min-h-11 items-center gap-1 rounded-full bg-white px-3 text-sm text-marca ring-1 ring-marca/30 hover:bg-fondo"
              onClick={() => void abrir(f)}
            >
              <BookOpen aria-hidden className="h-4 w-4" /> {f.titulo}{' '}
              <span className="text-xs text-slate-500">({f.version})</span>
            </button>
          </li>
        ))}
      </ul>
      {abierta && (
        <div className="mt-2 rounded-lg bg-white p-2 text-sm ring-1 ring-slate-200">
          {fallo && <p>No se ha podido abrir la fuente.</p>}
          {!fallo && !fragmento && <p className="animate-pulse">Abriendo la fuente…</p>}
          {fragmento && (
            <>
              {!fragmento.versionVigente && (
                <p className="mb-1 rounded bg-sustituir-bg p-1 text-xs font-semibold">
                  Esta fuente ha cambiado desde que se dio la respuesta: se muestra la versión actual.
                </p>
              )}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{fragmento.contenido}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const fechaEs = (iso: string) => iso.split('-').reverse().join('/');

/** Versión de las reglas abreviada para la pantalla (la completa queda en el atributo `title`). */
const versionCorta = (v: string) => (v.length > 36 ? `${v.slice(0, 14)}…${v.slice(-8)}` : v);
