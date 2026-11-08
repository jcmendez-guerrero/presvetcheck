import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer, Trash2 } from 'lucide-react';
import type { CodigoIncidencia } from '@mmx/shared';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { leerForzado } from '../lib/flujo';
import { pitido } from '../lib/sonido';
import { CN, fecha } from '../lib/textos';
import type { Evaluacion } from '../lib/tipos';
import { BandaPsicotropo, BandaSustitucion, RecordatorioTpv } from '../componentes/bandas';
import { BotonPreguntarLinea } from '../componentes/asistente';
import { CampoEscaneo } from '../componentes/escaner';
import { TrasDispensar } from '../componentes/tras-dispensar';
import { ConReceta } from '../componentes/visor-receta';
import { EstadoDecision, ListaMotivos } from '../componentes/estado';
import { ModalForzado, type SolicitudForzado } from '../componentes/forzado';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Cargando, Mensaje, Tarjeta } from '../componentes/ui';

export interface Envase {
  lote: string;
  caducidad: string | null;
  unidades: number;
  gtin: string | null;
  cnEscaneado: string | null;
  serie: string | null;
  metodoCaptura: 'scanner' | 'camara' | 'manual';
}

interface ResultadoScan {
  ok: boolean;
  error?: string;
  detalle?: string;
  gtin: string | null;
  cn: string | null;
  lote: string | null;
  caducidad: string | null;
  serie: string | null;
}

interface RespuestaDispensacion {
  dispensaciones: string[];
  recordatorioTpv: { cn: string; lote: string; unidades: number }[];
  avisos: string[];
  forzado: string[];
  apartarReceta: { motivo: string; etiqueta: string | null } | null;
  notaAdministracion: string | null;
  resguardo: string | null;
}

/** Hook de escaneo común (receta y venta sin receta). */
export function useEnvases() {
  const { config } = useAuth();
  const [envases, setEnvases] = useState<Envase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const leer = async (raw: string, metodo: Envase['metodoCaptura']) => {
    setError(null);
    try {
      const r = await post<ResultadoScan>('/api/scan/parse', { raw });
      if (!r.ok) {
        pitido(false);
        setError(`No se ha podido leer el código (${r.detalle ?? r.error}). Introduce los datos a mano.`);
        return;
      }
      pitido(true);
      setEnvases((e) => [
        ...e,
        {
          lote: r.lote ?? '',
          caducidad: r.caducidad,
          unidades: 1,
          gtin: r.gtin,
          cnEscaneado: r.cn,
          serie: r.serie,
          metodoCaptura: metodo,
        },
      ]);
    } catch (e) {
      pitido(false);
      setError(e instanceof ApiError ? e.message : 'Error al leer el código');
    }
  };
  return { envases, setEnvases, leer, error, gs: config?.scannerGsSubstitute ?? null };
}

export function ListaEnvases({
  envases,
  setEnvases,
  recomendado,
}: {
  envases: Envase[];
  setEnvases: (f: (e: Envase[]) => Envase[]) => void;
  recomendado: string | null;
}) {
  const upd = (i: number, p: Partial<Envase>) =>
    setEnvases((e) => e.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <ul className="flex flex-col gap-2">
      {envases.map((e, i) => (
        <li
          key={i}
          className={`grid items-end gap-2 rounded-xl p-3 sm:grid-cols-6 ${recomendado && e.lote && e.lote !== recomendado ? 'bg-sustituir-bg' : 'bg-fondo'}`}
        >
          <Campo
            etiqueta="Lote"
            placeholder="Lote del envase"
            autoFocus={e.metodoCaptura === 'manual' && !e.lote}
            value={e.lote}
            onChange={(x) => upd(i, { lote: x.target.value })}
          />
          <Campo
            etiqueta="Caducidad"
            type="date"
            value={e.caducidad ?? ''}
            onChange={(x) => upd(i, { caducidad: x.target.value || null })}
          />
          {/* Se puede corregir o escribir el código nacional del envase para cruzarlo con el prescrito. */}
          <Campo
            etiqueta={CN}
            placeholder="Código nacional"
            inputMode="numeric"
            maxLength={7}
            value={e.cnEscaneado ?? ''}
            onChange={(x) => upd(i, { cnEscaneado: x.target.value.replace(/\D/g, '') || null })}
          />
          <Campo
            etiqueta="Nº serie"
            placeholder="Opcional"
            value={e.serie ?? ''}
            onChange={(x) => upd(i, { serie: x.target.value.trim() || null })}
          />
          <Campo
            etiqueta="Envases"
            type="number"
            min={1}
            value={e.unidades}
            onChange={(x) => upd(i, { unidades: Number(x.target.value) || 1 })}
          />
          <Boton
            variante="texto"
            aria-label="Quitar envase"
            onClick={() => setEnvases((x) => x.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-5 w-5" /> Quitar
          </Boton>
        </li>
      ))}
    </ul>
  );
}

export function Imprimible({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-400 bg-superficie p-4 text-texto">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{titulo}</p>
        <Boton
          variante="secundario"
          onClick={() => {
            const w = window.open('', '_blank', 'width=420,height=600');
            if (!w) return;
            w.document.write(
              `<pre style="font:14px/1.4 sans-serif;white-space:pre-wrap">${texto.replace(/</g, '&lt;')}</pre>`,
            );
            w.print();
          }}
        >
          <Printer aria-hidden className="h-5 w-5" /> Imprimir
        </Boton>
      </div>
      <pre className="mt-2 whitespace-pre-wrap text-sm">{texto}</pre>
    </div>
  );
}

/** Dispensación con receta (SPEC §4.6, §8.5). */
export function Dispensacion() {
  const { id, linea } = useParams({ from: '/recetas/$id/dispensar/$linea' });
  const s = useSearch({ from: '/recetas/$id/dispensar/$linea' });
  const orden = Number(linea);
  const { usuario } = useAuth();
  // Forzado aceptado en Resultado (solo defectos de la receta) y forzado del envío (receta + escaneo).
  const [forzadoReceta] = useState<SolicitudForzado | null>(s.forzado ? leerForzado(id, orden) : null);
  const [forzado, setForzado] = useState<SolicitudForzado | null>(forzadoReceta);
  const ev = useQuery({
    queryKey: ['eval-disp', id, orden, !!forzadoReceta],
    queryFn: () =>
      post<Evaluacion>(
        `/api/recetas/${id}/evaluar`,
        forzadoReceta ? { forzados: { [orden]: forzadoReceta } } : {},
      ),
    refetchOnWindowFocus: false,
  });
  const sust = useQuery({
    queryKey: ['sustitucion', s.sustitucion],
    queryFn: () =>
      get<{
        cnPropuesto: string;
        prescrito: { nombre: string } | null;
        sustituto: { nombre: string; laboratorio: string | null } | null;
      }>(`/api/sustituciones/${s.sustitucion}`),
    enabled: !!s.sustitucion,
  });
  // Envases que pide la receta, para compararlos con los que se escanean.
  const receta = useQuery({
    queryKey: ['receta-disp', id],
    queryFn: () =>
      get<{
        confirmacion: {
          lineas: { orden: number; cantidadEnvases: number | null }[];
          modo?: 'en_vivo' | 'retrospectivo';
          fechaOriginal?: string | null;
        } | null;
      }>(`/api/recetas/${id}`),
  });
  const pedidos = receta.data?.confirmacion?.lineas.find((x) => x.orden === orden)?.cantidadEnvases ?? null;
  const { envases, setEnvases, leer, error, gs } = useEnvases();
  const [motivoLote, setMotivoLote] = useState('');
  const [conf, setConf] = useState({ formato: false, nota: false, dosis: false });
  const [fraccion, setFraccion] = useState<number | null>(null);
  const [dniRetira, setDniRetira] = useState('');
  const [dejarPendientes, setDejarPendientes] = useState(false);
  const [contacto, setContacto] = useState('');
  const [modal, setModal] = useState<CodigoIncidencia[] | null>(null);
  const [modoRetrospectivo, setModoRetrospectivo] = useState(false);
  const [fechaOriginal, setFechaOriginal] = useState('');

  useEffect(() => {
    if (receta.data?.confirmacion) {
      if (receta.data.confirmacion.modo === 'retrospectivo') {
        setModoRetrospectivo(true);
      }
      if (receta.data.confirmacion.fechaOriginal) {
        setFechaOriginal(receta.data.confirmacion.fechaOriginal);
      }
    }
  }, [receta.data?.confirmacion]);
  const [res, setRes] = useState<RespuestaDispensacion | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const l = ev.data?.lineas.find((x) => x.orden === orden);
  const evd = l?.resultado.evidencias;
  const objetivo = useMemo(() => {
    if (!l || !evd) return null;
    if (s.sustitucion && sust.data)
      return {
        cn: sust.data.cnPropuesto,
        lote: null as string | null,
        nombre: sust.data.sustituto?.nombre ?? '',
      };
    if (l.resultado.decision === 'DISPENSAR_CON_AVISO' && evd.alternativaFormato) {
      const a = evd.alternativaFormato;
      return {
        cn: a.cn,
        lote: a.lotes.recomendado?.lote ?? null,
        nombre: a.nombre,
        caducidad: a.lotes.recomendado?.caducidad ?? null,
      };
    }
    return {
      cn: evd.cn ?? '',
      lote: evd.lotes?.recomendado?.lote ?? null,
      nombre: '',
      caducidad: evd.lotes?.recomendado?.caducidad ?? null,
    };
  }, [l, evd, s.sustitucion, sust.data]);
  const pendientes = (s.pendientes ?? '').split(',').filter(Boolean).map(Number);

  if (ev.isLoading) return <Cargando />;
  if (!l || !evd || !objetivo) return <Mensaje tipo="error">No se encuentra la línea</Mensaje>;
  const loteDistinto = objetivo.lote !== null && envases.some((e) => e.lote && e.lote !== objetivo.lote);
  const alt = l.resultado.decision === 'DISPENSAR_CON_AVISO' ? evd.alternativaFormato : undefined;

  const enviar = async (f: SolicitudForzado | null) => {
    setEnviando(true);
    setMsg(null);
    try {
      const r = await post<RespuestaDispensacion>('/api/dispensaciones', {
        conReceta: true,
        recetaId: id,
        lineaOrden: orden,
        cn: objetivo.cn,
        envases,
        motivoLoteDistinto: loteDistinto ? motivoLote : null,
        forzado: f,
        sustitucionId: s.sustitucion ?? null,
        confirmaCambioFormato: conf.formato,
        notaEntregadaTutor: conf.nota,
        confirmaDosisNoAjustable: conf.dosis,
        fraccion: fraccion !== null ? { unidadesForma: fraccion } : null,
        dniRetira: evd.psicotropo ? dniRetira.trim() || null : null,
        pendientes:
          dejarPendientes && pendientes.length
            ? { lineas: pendientes, contactoTutor: contacto || null }
            : null,
        modo: modoRetrospectivo ? 'retrospectivo' : 'en_vivo',
        fechaOriginal: modoRetrospectivo && fechaOriginal ? fechaOriginal : null,
      });
      pitido(true);
      setRes(r);
    } catch (e) {
      pitido(false);
      if (
        e instanceof ApiError &&
        e.code === 'DISPENSACION_BLOQUEADA' &&
        Array.isArray(e.detalles?.forzables) &&
        (e.detalles.forzables as string[]).length
      ) {
        setModal(e.detalles.forzables as CodigoIncidencia[]);
      } else {
        setMsg(
          e instanceof ApiError
            ? `${e.message}${e.detalles?.codigos ? ` (${(e.detalles.codigos as string[]).join(', ')})` : ''}`
            : 'Error',
        );
      }
    } finally {
      setEnviando(false);
    }
  };

  if (res) {
    return (
      <Pagina titulo="Dispensación registrada">
        <ConReceta recetaId={id}>
          <RecordatorioTpv items={res.recordatorioTpv} />
          {res.apartarReceta && <Mensaje tipo="aviso">{res.apartarReceta.motivo}</Mensaje>}
          {res.apartarReceta?.etiqueta && (
            <Imprimible titulo="Etiqueta para el dorso de la receta" texto={res.apartarReceta.etiqueta} />
          )}
          {res.notaAdministracion && (
            <Imprimible
              titulo="Nota de administración para el tutor (obligatoria)"
              texto={res.notaAdministracion}
            />
          )}
          {res.resguardo && <Imprimible titulo="Resguardo para el tutor" texto={res.resguardo} />}
          <TrasDispensar recetaId={id} cobro={res.recordatorioTpv} />
          <div className="flex gap-3">
            <Link
              to="/recetas/$id/resultado"
              params={{ id }}
              className="boton rounded-xl bg-marca px-5 py-3 font-semibold text-white"
            >
              Volver a la receta
            </Link>
            <Link
              to="/"
              className="boton rounded-xl border-2 border-marca px-5 py-3 font-semibold text-marca"
            >
              Inicio
            </Link>
          </div>
        </ConReceta>
      </Pagina>
    );
  }

  return (
    <>
      {evd.psicotropo && <BandaPsicotropo />}
      {s.sustitucion && sust.data && (
        <BandaSustitucion
          prescrito={sust.data.prescrito?.nombre ?? '—'}
          sustituto={`${sust.data.sustituto?.nombre ?? ''} (${sust.data.sustituto?.laboratorio ?? ''})`}
        />
      )}
      <Pagina titulo={`Dispensar · medicamento ${orden}`}>
        <ConReceta recetaId={id}>
          <div className="flex flex-wrap items-center gap-3">
            <EstadoDecision decision={s.sustitucion ? 'SUSTITUIR' : l.resultado.decision} grande />
            {forzado && (
              <span className="rounded-full bg-noconforme-bg px-3 py-1 font-semibold text-noconforme">
                Forzado: {forzado.codigos.join(', ')}
              </span>
            )}
          </div>
          <ListaMotivos motivos={l.resultado.motivos.filter((m) => m.severidad === 'AVISO')} />
          {l.lineaId && (
            <BotonPreguntarLinea recetaLineaId={l.lineaId} etiqueta={`el medicamento ${orden}`} />
          )}
          <Tarjeta
            titulo="Lote recomendado FEFO (caduca antes)"
            destacada={!!objetivo.lote}
            className="border-2 border-marca/30 dark:border-acento/40"
          >
            {objetivo.lote ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p
                    data-testid="lote-recomendado"
                    className="font-mono text-4xl font-extrabold tracking-wide text-marca dark:text-acento"
                  >
                    {objetivo.lote}
                  </p>
                  {'caducidad' in objetivo && objetivo.caducidad && (
                    <span className="inline-flex items-center rounded-lg bg-dispensar-bg px-2.5 py-1 text-sm font-bold text-dispensar">
                      Caduca: {fecha(objetivo.caducidad as string)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-texto dark:text-slate-300">
                  {CN} <span className="font-semibold text-marca dark:text-acento">{objetivo.cn}</span>
                </p>
              </div>
            ) : (
              <p className="text-slate-600 dark:text-slate-400">
                Sin propuesta automática de lote: consulta las existencias en mostrador.
              </p>
            )}
            {evd.lotes?.alternativaQueCubre && (
              <p className="mt-2 text-sm font-semibold text-sustituir">
                Lote que cubre todo el tratamiento: {evd.lotes.alternativaQueCubre.lote}
              </p>
            )}
          </Tarjeta>

          <Tarjeta titulo="Escanea el envase">
            <ComparaEnvases
              pedidos={pedidos}
              escaneados={envases.reduce((a, e) => a + (e.unidades || 0), 0)}
            />
            <CampoEscaneo onLectura={(raw, m) => void leer(raw, m)} gsSubstitute={gs} />
            {error && <Mensaje tipo="error">{error}</Mensaje>}
            <Boton
              variante="texto"
              onClick={() =>
                setEnvases((e) => [
                  ...e,
                  {
                    lote: '',
                    caducidad: null,
                    unidades: 1,
                    gtin: null,
                    cnEscaneado: null,
                    serie: null,
                    metodoCaptura: 'manual',
                  },
                ])
              }
            >
              Introducir los datos a mano
            </Boton>
            <ListaEnvases envases={envases} setEnvases={setEnvases} recomendado={objetivo.lote} />
            {loteDistinto && (
              <Campo
                etiqueta="Motivo para no dispensar el lote recomendado (obligatorio)"
                value={motivoLote}
                onChange={(e) => setMotivoLote(e.target.value)}
              />
            )}
          </Tarjeta>

          {evd.psicotropo && (
            <Tarjeta titulo="Psicótropo: identidad de quien lo retira">
              <p>
                Comprueba el documento de identidad de la persona que retira el medicamento y anota su DNI o
                NIE.
              </p>
              <Campo
                etiqueta="DNI / NIE de quien retira (obligatorio)"
                autoComplete="off"
                value={dniRetira}
                onChange={(e) => setDniRetira(e.target.value)}
              />
            </Tarjeta>
          )}

          {l.fraccion && l.resultado.decision === 'DISPENSAR' && (
            <Tarjeta titulo="Dispensación fraccionada">
              <p>
                Presentación autorizada para fraccionar: <strong>{l.fraccion.texto}</strong>. Nunca se corta
                el blíster; entrega siempre un prospecto con la fracción.
              </p>
              {l.fraccion.unidades === null || l.fraccion.prescritas === null ? (
                <Mensaje tipo="aviso">
                  {l.fraccion.prescritas === null
                    ? 'La receta no indica unidades a dispensar: dispensa el envase completo.'
                    : 'No se reconoce la fracción autorizada: dispensa el envase completo.'}
                </Mensaje>
              ) : (
                <>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={fraccion !== null}
                      onChange={(e) =>
                        setFraccion(
                          e.target.checked ? Math.min(l.fraccion!.unidades!, l.fraccion!.prescritas!) : null,
                        )
                      }
                    />
                    Dispensar una fracción en lugar del envase completo (receta: {l.fraccion.prescritas}{' '}
                    {l.fraccion.unidad})
                  </label>
                  {fraccion !== null && (
                    <Campo
                      etiqueta={`Unidades a entregar (múltiplos de ${l.fraccion.unidades})`}
                      type="number"
                      min={l.fraccion.unidades}
                      step={l.fraccion.unidades}
                      value={fraccion}
                      onChange={(e) => setFraccion(Number(e.target.value) || l.fraccion!.unidades)}
                    />
                  )}
                </>
              )}
            </Tarjeta>
          )}

          {alt && (
            <Tarjeta titulo="Cambio de formato o concentración">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={conf.formato}
                  onChange={(e) => setConf({ ...conf, formato: e.target.checked })}
                />
                He explicado al cliente que se dispensa otra presentación ({alt.envases} envase/s)
              </label>
              {alt.nota && (
                <>
                  <Imprimible titulo="Nota de administración para el tutor" texto={alt.nota} />
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={conf.nota}
                      onChange={(e) => setConf({ ...conf, nota: e.target.checked })}
                    />
                    He entregado y explicado la nota al tutor
                  </label>
                </>
              )}
              {alt.formato.avisos.includes('DOSIS_NO_AJUSTABLE') && (
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    checked={conf.dosis}
                    onChange={(e) => setConf({ ...conf, dosis: e.target.checked })}
                  />
                  Confirmo expresamente que la dosis no se ajusta con unidades enteras
                </label>
              )}
            </Tarjeta>
          )}

          {pendientes.length > 0 && (
            <Tarjeta titulo="Dispensación parcial">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={dejarPendientes}
                  onChange={(e) => setDejarPendientes(e.target.checked)}
                />
                Dejar pendientes de entrega los medicamentos {pendientes.join(', ')} (la receta se retiene y
                se entrega un resguardo)
              </label>
              {dejarPendientes && (
                <Campo
                  etiqueta="Teléfono del tutor para avisarle (opcional)"
                  value={contacto}
                  onChange={(e) => setContacto(e.target.value)}
                />
              )}
            </Tarjeta>
          )}

          <Tarjeta titulo="Modo formación (retrospectivo)">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={modoRetrospectivo}
                onChange={(e) => setModoRetrospectivo(e.target.checked)}
              />
              <span>
                Activar modo formación con transacciones del pasado
                <span className="block text-xs text-slate-600">
                  Valida contra los movimientos de stock históricos en lugar del stock actual de la farmacia.
                </span>
              </span>
            </label>
            {modoRetrospectivo && (
              <Campo
                etiqueta="Fecha original de la dispensación (AAAA-MM-DD)"
                type="date"
                value={fechaOriginal}
                onChange={(e) => setFechaOriginal(e.target.value)}
              />
            )}
          </Tarjeta>

          {msg && <Mensaje tipo="error">{msg}</Mensaje>}
          <div className="pt-2">
            <Boton
              data-testid="confirmar-dispensacion"
              tamano="lg"
              cargando={enviando}
              className="text-lg w-full sm:w-auto shadow-md"
              disabled={
                !envases.length ||
                enviando ||
                (evd.psicotropo && !dniRetira.trim()) ||
                (modoRetrospectivo && !fechaOriginal)
              }
              onClick={() => void enviar(forzado)}
            >
              Confirmar dispensación
            </Boton>
          </div>
        </ConReceta>
      </Pagina>
      {modal && (
        <ModalForzado
          codigos={[...new Set([...(forzado?.codigos ?? []), ...modal])]}
          usuario={usuario?.nombre ?? ''}
          onCancelar={() => setModal(null)}
          onConfirmar={(f) => {
            setModal(null);
            setForzado(f);
            void enviar(f);
          }}
        />
      )}
    </>
  );
}

/** Envases que pide la receta frente a los que se van a dispensar (escaneados o introducidos a mano). */
function ComparaEnvases({ pedidos, escaneados }: { pedidos: number | null; escaneados: number }) {
  const estado =
    pedidos === null ? 'neutro' : escaneados > pedidos ? 'exceso' : escaneados === pedidos ? 'ok' : 'falta';
  const color = {
    neutro: 'bg-fondo',
    ok: 'bg-dispensar-bg text-dispensar',
    falta: 'bg-pedir-bg text-pedir',
    exceso: 'bg-noconforme-bg text-noconforme',
  }[estado];
  return (
    <div
      data-testid="compara-envases"
      className={`mb-3 grid grid-cols-2 gap-2 rounded-xl p-3 text-center ${color}`}
    >
      <div>
        <p className="text-sm">La receta pide</p>
        <p className="text-3xl font-bold">{pedidos ?? '—'}</p>
      </div>
      <div>
        <p className="text-sm">Vas a dispensar</p>
        <p className="text-3xl font-bold">{escaneados}</p>
      </div>
      {estado === 'exceso' && (
        <p className="col-span-2 font-semibold">
          Más envases de los que pide la receta: quita los que sobran
        </p>
      )}
      {estado === 'falta' && escaneados > 0 && (
        <p className="col-span-2 text-sm">Dispensación parcial: faltan {(pedidos ?? 0) - escaneados}</p>
      )}
    </div>
  );
}
