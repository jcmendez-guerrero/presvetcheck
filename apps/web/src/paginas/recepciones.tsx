import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FileText, Loader2, Pencil, Trash2 } from 'lucide-react';
import { ApiError, api, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AYUDA_RECEPCION as AY } from '../lib/ayudas';
import { CN, fecha, hoyIso, textoMotivo, type Motivo } from '../lib/textos';
import { CampoEscaneo } from '../componentes/escaner';
import { prepararPagina } from '../lib/imagen';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Cargando, Etiqueta, Info, Mensaje, Tarjeta } from '../componentes/ui';

interface LineaRecepcion {
  id: string;
  numero: number;
  tipo: string;
  cn: string | null;
  nombreFarmaco: string;
  principioActivoTxt: string | null;
  formaTxt: string | null;
  lote: string | null;
  caducidad: string | null;
  unidades: number;
  precioNetoCompra: string | null;
  ivaPct: string | null;
  precioCoste: string | null;
  estado: string;
  faltan: string[];
  avisos: Motivo[];
}
interface LineaLeida {
  descripcion: string | null;
  cantidad: number | null;
  precioUnitario: string | null;
  cn: string | null;
  lote: string | null;
  caducidad: string | null;
  candidato: { cn: string; nombre: string } | null;
}
interface Recepcion {
  id: string;
  estado: string;
  albaran: string | null;
  fechaCompra: string;
  fechaRecepcion: string | null;
  distribuidor: string | null;
  syncEstado: string | null;
  fechaCorte: string | null;
  escrituraStock: string;
  lectura: {
    proveedor: string | null;
    numero: string | null;
    fecha: string | null;
    lineas: LineaLeida[];
  } | null;
  /** Foto o PDF del albarán guardado (contenedor `albaranes`). */
  documento: { url: string; pdf: boolean } | null;
  lineas: LineaRecepcion[];
}

const NOMBRES_FALTAN: Record<string, string> = {
  unidades: 'unidades',
  nombreFarmaco: 'nombre',
  principioActivo: 'principio activo',
  forma: 'forma farmacéutica',
  caducidad: 'caducidad',
  lote: 'lote',
  cn: 'código nacional',
};
const IVAS = ['4', '10', '21'];
/** "11.2000" → "11,20" (como mínimo 2 decimales, sin ceros sobrantes). */
const importeLegible = (s: string | null) => (s ? s.replace(/(\.\d\d\d*?)0+$/, '$1').replace('.', ',') : '');
const RE_IMPORTE = /^\d+([.,]\d{1,4})?$/;

/** Validación en el navegador, antes de enviar: los mismos criterios que la API, campo a campo. */
function validarLinea(
  v: { lote: string; caducidad: string; unidades: number; precioNetoCompra: string },
  hoy: string,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!Number.isInteger(v.unidades) || v.unidades < 1) e.unidades = 'Indica un número de envases (1 o más)';
  if (v.caducidad && v.caducidad < hoy)
    e.caducidad = `Caducado el ${fecha(v.caducidad)}: no se puede dar entrada a un producto caducado`;
  if (v.precioNetoCompra && !RE_IMPORTE.test(v.precioNetoCompra.trim()))
    e.precioNetoCompra = 'Escribe un importe como 12,50 (hasta 4 decimales)';
  if (v.lote.length > 40) e.lote = 'Máximo 40 caracteres';
  return e;
}

/** Errores de la API por campo («caducidad», «precioNetoCompra»…) para marcarlos en el formulario. */
function erroresDe(e: unknown): { campos: Record<string, string>; mensaje: string } {
  if (!(e instanceof ApiError)) return { campos: {}, mensaje: 'No se ha podido guardar' };
  const campo = typeof e.detalles?.campo === 'string' ? { [e.detalles.campo]: e.message } : {};
  return { campos: { ...e.campos, ...campo }, mensaje: e.message };
}

interface Duplicado {
  id: string;
  albaran: string | null;
  fechaCompra: string;
  estado: string;
}
interface AlbaranLeido {
  documentoId: string;
  lectura: { proveedor: string | null; numero: string | null; fecha: string | null; lineas: LineaLeida[] };
  distribuidorSugerido: string | null;
  duplicados: Duplicado[];
  mismoFichero: { recepcionId: string } | null;
}

/** Recepciones del mismo albarán y distribuidor ya registradas (con enlace), para no duplicar la entrada. */
function AvisoDuplicados({ duplicados }: { duplicados: Duplicado[] }) {
  if (!duplicados.length) return null;
  return (
    <Mensaje tipo="aviso">
      Ya hay {duplicados.length === 1 ? 'una recepción' : `${duplicados.length} recepciones`} de este albarán
      y distribuidor:
      <ul className="mt-1 list-disc pl-5">
        {duplicados.map((x) => (
          <li key={x.id}>
            <Link to="/recepciones/$id" params={{ id: x.id }} className="text-marca underline">
              {x.albaran} · compra {fecha(x.fechaCompra)} · {x.estado}
            </Link>
          </li>
        ))}
      </ul>
    </Mensaje>
  );
}

export function Recepciones() {
  const nav = useNavigate();
  const { config } = useAuth();
  const lista = useQuery({
    queryKey: ['recepciones'],
    queryFn: () =>
      get<
        Array<{
          id: string;
          estado: string;
          fechaCompra: string;
          fechaRecepcion: string | null;
          albaran: string | null;
        }>
      >('/api/recepciones'),
  });
  const prov = useQuery({
    queryKey: ['proveedores'],
    queryFn: () =>
      get<{ proveedores: { nombre: string; origen: 'app' | 'siweb' }[]; siwebDisponible: boolean }>(
        '/api/recepciones/proveedores',
      ),
  });
  const [modo, setModo] = useState<'elegir' | 'albaran' | 'manual'>('elegir');
  const [leido, setLeido] = useState<AlbaranLeido | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [duplicados, setDuplicados] = useState<Duplicado[]>([]);
  const [confirmar, setConfirmar] = useState(false);
  const [d, setD] = useState({
    distribuidor: '',
    albaran: '',
    fechaCompra: hoyIso(),
    fechaRecepcion: hoyIso(),
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const validar = () => {
    const e: Record<string, string> = {};
    if (d.distribuidor.trim().length < 2) e.distribuidor = 'Indica el distribuidor';
    if (!d.fechaCompra) e.fechaCompra = 'Indica la fecha de compra';
    else if (d.fechaCompra > hoyIso()) e.fechaCompra = 'La fecha de compra no puede ser futura';
    if (!d.fechaRecepcion) e.fechaRecepcion = 'Indica la fecha de recepción';
    else if (d.fechaRecepcion > hoyIso()) e.fechaRecepcion = 'La fecha de recepción no puede ser futura';
    else if (d.fechaCompra && d.fechaRecepcion < d.fechaCompra)
      e.fechaRecepcion = 'La mercancía no puede llegar antes de comprarla';
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  /** Lee el albarán: rellena la cabecera con lo leído y enseña los posibles duplicados. */
  const leer = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setLeyendo(true);
    setMsg(null);
    setConfirmar(false);
    try {
      const fd = new FormData();
      const p = f.type.startsWith('image/') ? await prepararPagina(f) : null;
      fd.append('documento', p?.blob ?? f, p ? 'albaran.jpg' : f.name);
      const r = await post<AlbaranLeido>('/api/recepciones/albaranes', fd);
      setLeido(r);
      setDuplicados(r.duplicados);
      setD({
        distribuidor: r.distribuidorSugerido ?? r.lectura.proveedor ?? '',
        albaran: r.lectura.numero ?? '',
        fechaCompra: r.lectura.fecha && r.lectura.fecha <= hoyIso() ? r.lectura.fecha : hoyIso(),
        fechaRecepcion: hoyIso(),
      });
      setErrores({});
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se ha podido leer el documento');
    } finally {
      setLeyendo(false);
    }
  };

  const crear = async () => {
    setMsg(null);
    if (!validar()) return;
    try {
      const r = await post<{ id: string }>('/api/recepciones', {
        distribuidor: d.distribuidor.trim(),
        albaran: d.albaran.trim() || null,
        fechaCompra: d.fechaCompra,
        fechaRecepcion: d.fechaRecepcion,
        documentoId: leido?.documentoId ?? null,
        confirmarDuplicado: confirmar,
      });
      await nav({ to: '/recepciones/$id', params: { id: r.id } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.detalles?.duplicados)) {
        setDuplicados(e.detalles.duplicados as Duplicado[]);
        setMsg(
          'Este albarán ya está registrado para ese distribuidor. Si es otro albarán distinto, márcalo abajo.',
        );
        return;
      }
      const x = erroresDe(e);
      setErrores(x.campos);
      setMsg(x.mensaje);
    }
  };

  const conLote = leido?.lectura.lineas.filter((x) => x.lote || x.caducidad).length ?? 0;
  const sinLector = config?.extractor === 'desactivado';

  return (
    <Pagina titulo="Recepción de mercancía">
      <Tarjeta titulo="Nueva recepción">
        {modo === 'elegir' && (
          <div className="flex flex-col gap-3">
            <p className="text-slate-700">
              Lee el albarán o la factura para rellenar los datos y proponer las líneas con su lote y
              caducidad, o regístrala a mano.
            </p>
            <div className="flex flex-wrap gap-3">
              <Boton disabled={sinLector} onClick={() => setModo('albaran')}>
                <FileText aria-hidden className="h-5 w-5" /> Leer el albarán o la factura
              </Boton>
              <Boton variante="secundario" onClick={() => setModo('manual')}>
                <Pencil aria-hidden className="h-5 w-5" /> Registrar a mano
              </Boton>
            </div>
            {sinLector && (
              <p className="text-sm text-slate-600">
                La lectura de documentos no está configurada: registra la recepción a mano.
              </p>
            )}
          </div>
        )}
        {modo !== 'elegir' && (
          <div className="flex flex-col gap-3">
            {modo === 'albaran' && (
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className={`inline-flex items-center gap-2 rounded-xl bg-marca px-5 py-3 font-semibold text-white ${leyendo ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
                >
                  {leyendo ? (
                    <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                  ) : (
                    <Camera aria-hidden className="h-5 w-5" />
                  )}
                  {leyendo
                    ? 'Leyendo el documento… (hasta un minuto)'
                    : leido
                      ? 'Leer otro documento'
                      : 'Foto o PDF del albarán'}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="sr-only"
                    disabled={leyendo}
                    onChange={(e) => void leer(e.currentTarget)}
                  />
                </label>
                <Info texto={AY.documento} />
              </div>
            )}
            {leido && (
              <Mensaje tipo="info">
                Leído: nº <strong>{leido.lectura.numero ?? '—'}</strong> · proveedor{' '}
                <strong>{leido.lectura.proveedor ?? '—'}</strong> · fecha{' '}
                <strong>{leido.lectura.fecha ? fecha(leido.lectura.fecha) : '—'}</strong> ·{' '}
                {leido.lectura.lineas.length} línea(s)
                {leido.lectura.lineas.length ? `, ${conLote} con lote o caducidad` : ''}. Revisa la cabecera:
                las líneas se revisan una a una con el envase en el siguiente paso.
              </Mensaje>
            )}
            {leido?.mismoFichero && (
              <Mensaje tipo="error">
                Este mismo documento ya se registró en{' '}
                <Link
                  to="/recepciones/$id"
                  params={{ id: leido.mismoFichero.recepcionId }}
                  className="underline"
                >
                  otra recepción
                </Link>
                . Comprueba que no estás repitiendo la entrada.
              </Mensaje>
            )}
            {(modo === 'manual' || leido) && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Campo
                    etiqueta="Distribuidor"
                    info={AY.distribuidor}
                    list="distribuidores"
                    autoComplete="off"
                    value={d.distribuidor}
                    error={errores.distribuidor}
                    onChange={(e) => {
                      setD({ ...d, distribuidor: e.target.value });
                      setDuplicados([]);
                      setConfirmar(false);
                    }}
                  />
                  <datalist id="distribuidores">
                    {prov.data?.proveedores.map((x) => (
                      <option key={x.nombre} value={x.nombre}>
                        {x.origen === 'siweb' ? 'Siweb360' : ''}
                      </option>
                    ))}
                  </datalist>
                  <Campo
                    etiqueta="Nº de albarán o factura"
                    info={AY.albaran}
                    value={d.albaran}
                    error={errores.albaran}
                    onChange={(e) => {
                      setD({ ...d, albaran: e.target.value });
                      setDuplicados([]);
                      setConfirmar(false);
                    }}
                  />
                  <Campo
                    etiqueta="Fecha de compra"
                    info={AY.fechaCompra}
                    type="date"
                    max={hoyIso()}
                    value={d.fechaCompra}
                    error={errores.fechaCompra}
                    onChange={(e) => setD({ ...d, fechaCompra: e.target.value })}
                  />
                  <Campo
                    etiqueta="Fecha de recepción"
                    info={AY.fechaRecepcion}
                    type="date"
                    max={hoyIso()}
                    value={d.fechaRecepcion}
                    error={errores.fechaRecepcion}
                    onChange={(e) => setD({ ...d, fechaRecepcion: e.target.value })}
                  />
                </div>
                {prov.data && !prov.data.siwebDisponible && (
                  <p className="text-xs text-slate-600">
                    Proveedores de Siweb360 no disponibles ahora: se proponen los ya usados en la app.
                  </p>
                )}
                <AvisoDuplicados duplicados={duplicados} />
                {duplicados.length > 0 && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={confirmar}
                      onChange={(e) => setConfirmar(e.target.checked)}
                    />
                    Es otro albarán distinto (mismo número por casualidad): crear la recepción igualmente
                  </label>
                )}
                {msg && <Mensaje tipo="error">{msg}</Mensaje>}
                <div className="flex flex-wrap gap-3">
                  <Boton disabled={duplicados.length > 0 && !confirmar} onClick={() => void crear()}>
                    Empezar recepción
                  </Boton>
                  <Boton
                    variante="texto"
                    onClick={() => {
                      setModo('elegir');
                      setLeido(null);
                      setDuplicados([]);
                      setMsg(null);
                    }}
                  >
                    Volver
                  </Boton>
                </div>
              </>
            )}
            {modo === 'albaran' && !leido && msg && <Mensaje tipo="error">{msg}</Mensaje>}
          </div>
        )}
      </Tarjeta>
      <Tarjeta titulo="Recepciones recientes">
        <ul className="divide-y">
          {lista.data?.map((r) => (
            <li key={r.id} className="py-2">
              <Link to="/recepciones/$id" params={{ id: r.id }} className="text-marca underline">
                Compra {fecha(r.fechaCompra)}
                {r.fechaRecepcion ? ` · recibida ${fecha(r.fechaRecepcion)}` : ''} ·{' '}
                {r.albaran ?? 'sin albarán'} · {r.estado}
              </Link>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </Pagina>
  );
}

const LINEA_VACIA = {
  lote: '',
  caducidad: '',
  unidades: 1,
  serie: '',
  gtin: '',
  cnEscaneado: '',
  precioNetoCompra: '',
  ivaPct: '10',
  tipo: 'medicamento',
  nombre: '',
};

export function RecepcionDetalle() {
  const { id } = useParams({ from: '/recepciones/$id' });
  const qc = useQueryClient();
  const { config } = useAuth();
  const q = useQuery({
    queryKey: ['recepcion', id],
    queryFn: () => get<Recepcion>(`/api/recepciones/${id}`),
  });
  const [busqueda, setBusqueda] = useState('');
  const [sel, setSel] = useState<{ cn: string; nombre: string } | null>(null);
  const [l, setL] = useState(LINEA_VACIA);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ t: 'ok' | 'error' | 'aviso'; m: string } | null>(null);
  const [usadas, setUsadas] = useState<Set<number>>(new Set());
  const cand = useQuery({
    queryKey: ['buscar', busqueda],
    queryFn: () =>
      get<Array<{ cn: string; nombre: string; labtitular: string | null }>>(
        `/api/medicamentos/buscar?q=${encodeURIComponent(busqueda)}`,
      ),
    enabled: busqueda.trim().length >= 3 && !sel,
  });
  if (!q.data) return <Cargando />;
  const r = q.data;
  const abierta = r.estado === 'ABIERTA';
  const refrescar = () => qc.invalidateQueries({ queryKey: ['recepcion', id] });
  const hoy = hoyIso();

  const anadir = async () => {
    setMsg(null);
    const e = validarLinea(l, hoy);
    if (l.tipo === 'medicamento' && !sel)
      e.cn = 'Elige el medicamento: búscalo por nombre o escanea su código';
    if (l.tipo === 'producto' && !l.nombre.trim()) e.nombre = 'Indica el nombre del producto';
    setErrores(e);
    if (Object.keys(e).length) {
      setMsg({ t: 'error', m: 'Revisa los campos marcados en rojo.' });
      return;
    }
    try {
      await post(`/api/recepciones/${id}/lineas`, {
        tipo: l.tipo,
        cn: l.tipo === 'medicamento' ? (sel?.cn ?? null) : null,
        nombre: l.tipo === 'producto' ? l.nombre.trim() : null,
        lote: l.lote.trim() || null,
        caducidad: l.caducidad || null,
        unidades: l.unidades,
        serie: l.serie || null,
        gtin: l.gtin || null,
        cnEscaneado: l.cnEscaneado || null,
        precioNetoCompra: l.precioNetoCompra.trim() || null,
        ivaPct: l.precioNetoCompra ? Number(l.ivaPct) : null,
      });
      setL({ ...LINEA_VACIA, tipo: l.tipo, precioNetoCompra: '', ivaPct: l.ivaPct });
      setSel(null);
      setBusqueda('');
      setMsg({ t: 'ok', m: 'Línea añadida' });
      await refrescar();
    } catch (err) {
      const x = erroresDe(err);
      setErrores(x.campos);
      const det =
        err instanceof ApiError && err.detalles?.cnEscaneado
          ? ` (escaneado ${String(err.detalles.cnEscaneado)}, seleccionado ${String(err.detalles.cnSeleccionado)})`
          : '';
      setMsg({ t: 'error', m: x.mensaje + det });
    }
  };

  /** Propuesta leída del albarán → formulario, para revisarla y completarla (lote, caducidad) antes de añadir. */
  const usarLeida = (x: LineaLeida, i: number) => {
    setL({
      ...LINEA_VACIA,
      tipo: x.candidato ? 'medicamento' : 'producto',
      nombre: x.candidato ? '' : (x.descripcion ?? ''),
      lote: x.lote ?? '',
      caducidad: x.caducidad ?? '',
      unidades: x.cantidad && x.cantidad > 0 ? Math.round(x.cantidad) : 1,
      precioNetoCompra: x.precioUnitario?.replace('.', ',') ?? '',
      ivaPct: l.ivaPct,
    });
    setSel(x.candidato);
    setBusqueda(x.candidato ? '' : (x.descripcion ?? ''));
    setErrores({});
    setUsadas((u) => new Set(u).add(i));
    setMsg({
      t: 'aviso',
      m: 'Línea del documento copiada al formulario: compruébala con el envase (escanéalo para el lote y la caducidad) y pulsa «Añadir línea».',
    });
  };

  const sinResultados =
    l.tipo === 'medicamento' && !sel && busqueda.trim().length >= 3 && cand.data && cand.data.length === 0;

  return (
    <Pagina titulo={`Recepción · ${r.distribuidor ?? ''}`}>
      <p>
        Albarán/factura {r.albaran ?? '—'} · Compra {fecha(r.fechaCompra)}
        {r.fechaRecepcion ? ` · Recepción ${fecha(r.fechaRecepcion)}` : ''} · Estado{' '}
        <strong>{r.estado}</strong>
        {r.syncEstado && ` · Siweb360: ${r.syncEstado}`}
      </p>
      {(r.fechaCorte ?? config?.fechaCorteEntradas) && (
        <Mensaje tipo="aviso">
          Desde el {fecha(r.fechaCorte ?? config?.fechaCorteEntradas)} las entradas de medicamentos se
          registran solo aquí: no las des de alta a mano en Siweb360.
        </Mensaje>
      )}
      {r.escrituraStock === 'off' && (
        <Mensaje tipo="info">
          La escritura de stock en Siweb360 está desactivada: esta recepción no actualiza el stock.
        </Mensaje>
      )}
      {abierta && (
        <LeerDocumento recepcion={r} usadas={usadas} onUsar={usarLeida} onLeido={() => void refrescar()} />
      )}
      {abierta && (
        <Tarjeta titulo="Añadir producto">
          <div className="mb-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={l.tipo === 'medicamento'}
                onChange={() => setL({ ...l, tipo: 'medicamento' })}
              />{' '}
              Medicamento <Info texto={AY.medicamento} />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={l.tipo === 'producto'}
                onChange={() => setL({ ...l, tipo: 'producto' })}
              />{' '}
              Otro producto (sin CIMAVet) <Info texto={AY.producto} />
            </label>
          </div>
          {l.tipo === 'medicamento' ? (
            sel ? (
              <p>
                <strong>{sel.nombre}</strong> · {CN} {sel.cn}{' '}
                <Boton variante="texto" onClick={() => setSel(null)}>
                  Cambiar
                </Boton>
              </p>
            ) : (
              <>
                <Campo
                  etiqueta="Nombre del medicamento"
                  info={AY.medicamento}
                  value={busqueda}
                  error={errores.cn}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
                {sinResultados && (
                  <Mensaje tipo="aviso">
                    No se ha encontrado ningún medicamento con «{busqueda.trim()}» en CIMAVet. Prueba con otra
                    parte del nombre, escanea el envase o regístralo como «Otro producto».
                  </Mensaje>
                )}
                <ul className="mt-2 flex flex-col gap-1">
                  {cand.data?.map((c) => (
                    <li key={c.cn}>
                      <button
                        type="button"
                        className="w-full rounded-lg bg-fondo p-2 text-left hover:bg-pedir-bg"
                        onClick={() => setSel({ cn: c.cn, nombre: c.nombre })}
                      >
                        {c.nombre} · {CN} {c.cn} · {c.labtitular}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : (
            <Campo
              etiqueta="Nombre del producto"
              info={AY.producto}
              value={l.nombre}
              error={errores.nombre}
              onChange={(e) => setL({ ...l, nombre: e.target.value })}
            />
          )}
          <div className="mt-3">
            <Etiqueta texto="Código del envase" info={AY.escaneo} />
            <CampoEscaneo
              autoFoco={false}
              etiqueta=""
              gsSubstitute={config?.scannerGsSubstitute}
              onLectura={async (raw) => {
                const s = await post<{
                  ok: boolean;
                  cn: string | null;
                  lote: string | null;
                  caducidad: string | null;
                  serie: string | null;
                  gtin: string | null;
                  presentacion: { cn: string; nombre: string } | null;
                }>('/api/scan/parse', { raw });
                if (!s.ok) return setMsg({ t: 'error', m: 'No se ha podido leer el código' });
                if (s.cn && !s.presentacion)
                  setMsg({
                    t: 'aviso',
                    m: `No se ha encontrado el medicamento con ${CN.toLowerCase()} ${s.cn} en CIMAVet. Búscalo por nombre o regístralo como «Otro producto».`,
                  });
                if (!sel && s.presentacion) setSel({ cn: s.presentacion.cn, nombre: s.presentacion.nombre });
                setL((x) => ({
                  ...x,
                  lote: s.lote ?? x.lote,
                  caducidad: s.caducidad ?? x.caducidad,
                  serie: s.serie ?? '',
                  gtin: s.gtin ?? '',
                  cnEscaneado: s.cn ?? '',
                }));
                // La caducidad del código también se comprueba en el momento.
                if (s.caducidad && s.caducidad < hoy)
                  setErrores((e) => ({
                    ...e,
                    caducidad: `Caducado el ${fecha(s.caducidad)}: no se puede dar entrada a un producto caducado`,
                  }));
              }}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Campo
              etiqueta="Lote"
              info={AY.lote}
              value={l.lote}
              error={errores.lote}
              onChange={(e) => setL({ ...l, lote: e.target.value })}
            />
            <Campo
              etiqueta="Caducidad"
              info={AY.caducidad}
              type="date"
              min={hoy}
              value={l.caducidad}
              error={errores.caducidad}
              onChange={(e) => {
                setL({ ...l, caducidad: e.target.value });
                setErrores(({ caducidad: _c, ...resto }) => ({
                  ...resto,
                  ...validarLinea({ ...l, caducidad: e.target.value }, hoy),
                }));
              }}
            />
            <Campo
              etiqueta="Unidades (envases)"
              info={AY.unidades}
              type="number"
              min={1}
              value={l.unidades}
              error={errores.unidades}
              onChange={(e) => setL({ ...l, unidades: Number(e.target.value) })}
            />
            <Campo
              etiqueta="Precio neto unitario (sin IVA ni recargo de equivalencia, opcional)"
              info={AY.precioNeto}
              inputMode="decimal"
              placeholder="12,50"
              value={l.precioNetoCompra}
              error={errores.precioNetoCompra}
              onChange={(e) => setL({ ...l, precioNetoCompra: e.target.value })}
            />
            <label className="flex flex-col gap-1 text-sm">
              <Etiqueta texto="IVA" info={AY.iva} />
              <select
                className="min-h-11 rounded-lg border px-2"
                value={l.ivaPct}
                onChange={(e) => setL({ ...l, ivaPct: e.target.value })}
              >
                {IVAS.map((v) => (
                  <option key={v} value={v}>
                    {v} %
                  </option>
                ))}
              </select>
            </label>
          </div>
          {msg && <Mensaje tipo={msg.t}>{msg.m}</Mensaje>}
          <Boton className="mt-3" onClick={() => void anadir()}>
            Añadir línea
          </Boton>
        </Tarjeta>
      )}
      <Tarjeta titulo={`Líneas (${r.lineas.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-2">Producto</th>
                <th>{CN}</th>
                <th>Lote</th>
                <th>Caducidad</th>
                <th>Uds.</th>
                <th>Coste</th>
                <th>Faltan / avisos</th>
                {abierta && <th />}
              </tr>
            </thead>
            <tbody>
              {r.lineas.map((x) => (
                <FilaLinea
                  key={x.id}
                  x={x}
                  recepcionId={id}
                  editable={abierta}
                  onCambio={() => void refrescar()}
                />
              ))}
            </tbody>
          </table>
        </div>
        {abierta && (
          <Boton
            className="mt-4"
            disabled={!r.lineas.length || r.lineas.some((x) => x.faltan.length)}
            onClick={async () => {
              try {
                await post(`/api/recepciones/${id}/finalizar`);
                await refrescar();
                setMsg({ t: 'ok', m: 'Recepción finalizada' });
              } catch (e) {
                setMsg({ t: 'error', m: e instanceof ApiError ? e.message : 'Error' });
              }
            }}
          >
            Finalizar recepción
          </Boton>
        )}
        {abierta && r.lineas.some((x) => x.faltan.length) && (
          <p className="mt-2 text-sm text-slate-600">
            Para finalizar, completa lo que falta en las líneas (pulsa el lápiz para modificarlas).
          </p>
        )}
      </Tarjeta>
    </Pagina>
  );
}

/** Línea de la recepción, con edición en el sitio mientras la recepción está abierta. */
function FilaLinea({
  x,
  recepcionId,
  editable,
  onCambio,
}: {
  x: LineaRecepcion;
  recepcionId: string;
  editable: boolean;
  onCambio: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState({
    lote: x.lote ?? '',
    caducidad: x.caducidad ?? '',
    unidades: x.unidades,
    precioNetoCompra: importeLegible(x.precioNetoCompra),
    ivaPct: x.ivaPct ? String(Number(x.ivaPct)) : '10',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const hoy = hoyIso();

  const guardar = async () => {
    const e = validarLinea(v, hoy);
    setErrores(e);
    if (Object.keys(e).length) return;
    try {
      await put(`/api/recepciones/${recepcionId}/lineas/${x.id}`, {
        lote: v.lote.trim() || null,
        caducidad: v.caducidad || null,
        unidades: v.unidades,
        precioNetoCompra: v.precioNetoCompra.trim() || null,
        ivaPct: v.precioNetoCompra.trim() ? Number(v.ivaPct) : null,
      });
      setEditando(false);
      setMsg(null);
      onCambio();
    } catch (err) {
      const r = erroresDe(err);
      setErrores(r.campos);
      setMsg(r.mensaje);
    }
  };

  if (editando) {
    return (
      <tr className="border-t bg-fondo align-top">
        <td className="p-2" colSpan={8}>
          <p className="mb-2 font-semibold">
            Modificar línea {x.numero}: {x.nombreFarmaco}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Campo
              etiqueta="Lote"
              info={AY.lote}
              value={v.lote}
              error={errores.lote}
              onChange={(e) => setV({ ...v, lote: e.target.value })}
            />
            <Campo
              etiqueta="Caducidad"
              info={AY.caducidad}
              type="date"
              min={hoy}
              value={v.caducidad}
              error={errores.caducidad}
              onChange={(e) => setV({ ...v, caducidad: e.target.value })}
            />
            <Campo
              etiqueta="Unidades (envases)"
              info={AY.unidades}
              type="number"
              min={1}
              value={v.unidades}
              error={errores.unidades}
              onChange={(e) => setV({ ...v, unidades: Number(e.target.value) })}
            />
            <Campo
              etiqueta="Precio neto (sin IVA ni recargo)"
              info={AY.precioNeto}
              inputMode="decimal"
              value={v.precioNetoCompra}
              error={errores.precioNetoCompra}
              onChange={(e) => setV({ ...v, precioNetoCompra: e.target.value })}
            />
            <label className="flex flex-col gap-1 text-sm">
              <Etiqueta texto="IVA" info={AY.iva} />
              <select
                className="min-h-11 rounded-lg border px-2"
                value={v.ivaPct}
                onChange={(e) => setV({ ...v, ivaPct: e.target.value })}
              >
                {IVAS.map((i) => (
                  <option key={i} value={i}>
                    {i} %
                  </option>
                ))}
              </select>
            </label>
          </div>
          {msg && <Mensaje tipo="error">{msg}</Mensaje>}
          <div className="mt-2 flex gap-3">
            <Boton onClick={() => void guardar()}>Guardar cambios</Boton>
            <Boton variante="secundario" onClick={() => setEditando(false)}>
              Cancelar
            </Boton>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t align-top">
      <td className="p-2">
        {x.nombreFarmaco}
        <br />
        <span className="text-slate-600">
          {[x.principioActivoTxt, x.formaTxt].filter(Boolean).join(' · ')}
        </span>
      </td>
      <td>{x.cn ?? '—'}</td>
      <td className="font-mono">{x.lote ?? '—'}</td>
      <td>{fecha(x.caducidad)}</td>
      <td>{x.unidades}</td>
      <td>{x.precioCoste ? `${Number(x.precioCoste).toFixed(2).replace('.', ',')} €` : '—'}</td>
      <td>
        {x.faltan.length > 0 && (
          <span className="text-noconforme">
            Falta: {x.faltan.map((f) => NOMBRES_FALTAN[f] ?? f).join(', ')}
          </span>
        )}
        {x.avisos.map((a) => (
          <span key={a.code} className="block text-sustituir">
            {textoMotivo(a).titulo}
          </span>
        ))}
        {x.estado === 'PENDIENTE_ALTA_SIWEB' && (
          <span className="block text-sustituir">Pendiente de alta en Siweb360</span>
        )}
      </td>
      {editable && (
        <td className="whitespace-nowrap">
          <Boton
            variante="texto"
            aria-label={`Modificar la línea ${x.numero}`}
            onClick={() => setEditando(true)}
          >
            <Pencil aria-hidden className="h-4 w-4" />
          </Boton>
          <Boton
            variante="texto"
            aria-label={`Quitar la línea ${x.numero}`}
            onClick={async () => {
              if (!window.confirm(`¿Quitar la línea ${x.numero} (${x.nombreFarmaco})?`)) return;
              await api('DELETE', `/api/recepciones/${recepcionId}/lineas/${x.id}`);
              onCambio();
            }}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </Boton>
        </td>
      )}
    </tr>
  );
}

/**
 * Lectura del albarán o la factura con Document Intelligence: propone proveedor, número, fecha y líneas. Cada
 * línea se copia al formulario para revisarla con el envase antes de añadirla (nada se añade solo).
 */
function LeerDocumento({
  recepcion,
  usadas,
  onUsar,
  onLeido,
}: {
  recepcion: Recepcion;
  usadas: Set<number>;
  onUsar: (x: LineaLeida, i: number) => void;
  onLeido: () => void;
}) {
  const [leyendo, setLeyendo] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const lec = recepcion.lectura;
  const leer = async (f: File | undefined) => {
    if (!f) return;
    setLeyendo(true);
    setMsg(null);
    const fd = new FormData();
    fd.append('documento', f, f.name);
    try {
      await post(`/api/recepciones/${recepcion.id}/documento`, fd);
      onLeido();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'No se ha podido leer el documento');
    } finally {
      setLeyendo(false);
    }
  };
  return (
    <Tarjeta
      titulo={
        <span className="flex items-center gap-2">
          Albarán o factura <Info texto={AY.documento} />
        </span>
      }
    >
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-marca px-4 py-2 font-semibold text-marca">
        <FileText aria-hidden className="h-5 w-5" />{' '}
        {leyendo
          ? 'Leyendo el documento… (hasta un minuto)'
          : lec
            ? 'Leer otro documento'
            : 'Leer el albarán o la factura (foto o PDF)'}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          disabled={leyendo}
          onChange={(e) => void leer(e.target.files?.[0])}
        />
      </label>
      {msg && <Mensaje tipo="error">{msg}</Mensaje>}
      {recepcion.documento && <VerDocumento documento={recepcion.documento} />}
      {lec && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">
            Leído: proveedor <strong>{lec.proveedor ?? '—'}</strong> · nº <strong>{lec.numero ?? '—'}</strong>{' '}
            · fecha <strong>{lec.fecha ? fecha(lec.fecha) : '—'}</strong>
          </p>
          {lec.proveedor &&
            recepcion.distribuidor &&
            !lec.proveedor
              .toLowerCase()
              .includes(recepcion.distribuidor.toLowerCase().split(' ')[0] ?? '') && (
              <Mensaje tipo="aviso">
                El proveedor del documento («{lec.proveedor}») no parece el de esta recepción («
                {recepcion.distribuidor}»). Compruébalo.
              </Mensaje>
            )}
          {lec.lineas.length === 0 && (
            <p className="text-sm text-slate-600">No se han encontrado líneas de producto en el documento.</p>
          )}
          <ul className="flex flex-col gap-2">
            {lec.lineas.map((x, i) => (
              <li
                key={i}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg p-2 ring-1 ${usadas.has(i) ? 'bg-dispensar-bg ring-dispensar' : 'bg-white ring-slate-200'}`}
              >
                <span className="text-sm">
                  <strong>{x.descripcion ?? '(sin descripción)'}</strong>
                  <br />
                  {x.cantidad ?? '—'} uds. ·{' '}
                  {x.precioUnitario ? `${x.precioUnitario.replace('.', ',')} €` : 'sin precio'}
                  {x.lote ? ` · lote ${x.lote}` : ''}
                  {x.caducidad ? ` · cad. ${fecha(x.caducidad)}` : ''}
                  <br />
                  {x.candidato ? (
                    <span className="text-dispensar">
                      CIMAVet: {x.candidato.nombre} ({CN} {x.candidato.cn})
                    </span>
                  ) : (
                    <span className="text-sustituir">No se ha encontrado el medicamento en CIMAVet</span>
                  )}
                </span>
                <Boton variante={usadas.has(i) ? 'secundario' : 'principal'} onClick={() => onUsar(x, i)}>
                  {usadas.has(i) ? 'Copiar de nuevo' : 'Revisar y añadir'}
                </Boton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tarjeta>
  );
}

/** Foto o PDF del albarán guardado, para comprobar lo leído (se carga con la sesión, como las recetas). */
function VerDocumento({ documento }: { documento: { url: string; pdf: boolean } }) {
  const [abierto, setAbierto] = useState(true);
  const q = useQuery({
    queryKey: ['albaran-doc', documento.url],
    queryFn: async () => URL.createObjectURL(await get<Blob>(documento.url)),
    staleTime: Infinity,
  });
  return (
    <div className="mt-3">
      <Boton variante="texto" onClick={() => setAbierto((x) => !x)}>
        {abierto ? 'Ocultar el documento' : 'Ver el documento'}
      </Boton>
      {abierto &&
        (q.data ? (
          documento.pdf ? (
            <iframe title="Albarán" src={q.data} className="mt-2 h-[32rem] w-full rounded-lg border" />
          ) : (
            <img src={q.data} alt="Albarán" className="mt-2 max-h-[32rem] w-auto rounded-lg border" />
          )
        ) : (
          <p className="mt-2 animate-pulse text-sm text-slate-600">Cargando el documento…</p>
        ))}
    </div>
  );
}
