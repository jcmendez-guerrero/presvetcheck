import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FileText, Loader2, Pencil, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
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
  precioBruto: string | null;
  descuentoPct: string | null;
  precioNetoCompra: string | null;
  ivaPct: string | null;
  rePct: string | null;
  precioCoste: string | null;
  actualizarStock: boolean;
  actualizarPrecio: boolean;
  siwebVariantId: number | null;
  siwebSku: string | null;
  estado: string;
  faltan: string[];
  avisos: Motivo[];
}
interface LineaLeida {
  descripcion: string | null;
  cantidad: number | null;
  precioUnitario: string | null;
  descuentoPct?: string | null;
  cn: string | null;
  lote: string | null;
  caducidad: string | null;
  candidato: { cn: string; nombre: string } | null;
}
interface Totales {
  base: string;
  iva: string;
  recargo: string;
  total: string;
}
interface Recepcion {
  id: string;
  estado: string;
  albaran: string | null;
  fechaCompra: string;
  fechaRecepcion: string | null;
  distribuidor: string | null;
  regimen: 'recargo_equivalencia' | 'nacional';
  totales: Totales;
  syncEstado: string | null;
  fechaCorte: string | null;
  escrituraStock: string;
  lectura: {
    proveedor: string | null;
    numero: string | null;
    fecha: string | null;
    totales?: { base: string | null; impuestos: string | null; total: string | null };
    lineas: LineaLeida[];
  } | null;
  /** Foto o PDF del albarán guardado (contenedor `albaranes`). */
  documento: { url: string; pdf: boolean } | null;
  /** Correcciones de la cabecera hechas tras finalizar (la más reciente primero). */
  correcciones: Correccion[];
  lineas: LineaRecepcion[];
}

type CampoCabecera = 'distribuidor' | 'albaran' | 'fechaCompra' | 'fechaRecepcion';
interface Correccion {
  at: string;
  motivo: string | null;
  antes: Partial<Record<CampoCabecera, string | null>>;
  despues: Partial<Record<CampoCabecera, string | null>>;
}

const NOMBRES_CABECERA: Record<CampoCabecera, string> = {
  distribuidor: 'Distribuidor',
  albaran: 'Nº de albarán o factura',
  fechaCompra: 'Fecha de compra',
  fechaRecepcion: 'Fecha de recepción',
};
const valorCabecera = (k: CampoCabecera, v: string | null | undefined) =>
  v ? (k.startsWith('fecha') ? fecha(v) : v) : '—';

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
/** "12,88" → 12.88 (null si no es un número). */
const numero = (s: string) => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() && Number.isFinite(n) ? n : null;
};
/** Importe en pantalla: "58.9541" → "58,95 €". */
const eur = (s: string | number | null | undefined) =>
  s === null || s === undefined || s === ''
    ? '—'
    : `${Number(s).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
/** Neto unitario que resulta del precio y el descuento (lo mismo que calcula la API). */
const netoDe = (precio: string, descuento: string) => {
  const p = numero(precio);
  if (p === null) return null;
  return p * (1 - (numero(descuento) ?? 0) / 100);
};

/** Validación en el navegador, antes de enviar: los mismos criterios que la API, campo a campo. */
function validarLinea(
  v: { lote: string; caducidad: string; unidades: number; precio: string; descuento: string },
  hoy: string,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!Number.isInteger(v.unidades) || v.unidades < 1) e.unidades = 'Indica un número de envases (1 o más)';
  if (v.caducidad && v.caducidad < hoy)
    e.caducidad = `Caducado el ${fecha(v.caducidad)}: no se puede dar entrada a un producto caducado`;
  if (v.precio && !RE_IMPORTE.test(v.precio.trim()))
    e.precioBruto = 'Escribe un importe como 12,50 (hasta 4 decimales)';
  const d = numero(v.descuento);
  if (v.descuento.trim() && (d === null || d < 0 || d > 100)) e.descuentoPct = 'Descuento entre 0 y 100 %';
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

/** Estado del envío de la recepción a Siweb360, en palabras del personal (specs/011). */
const TEXTO_SYNC: Record<string, string> = {
  ESCRITURA_DESACTIVADA: 'no se envía (da de alta el stock a mano en Siweb360)',
  ENCOLADA: 'pendiente de envío',
  PENDIENTE_ALTA_SIWEB: 'falta dar de alta algún producto',
  SINCRONIZADA: 'enviado',
  ERROR: 'error al enviar (revisa Pendientes)',
  SIN_MEDICAMENTOS: 'nada que enviar',
};
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
                  className={`inline-flex items-center gap-2 rounded-xl bg-marca px-5 py-3 font-semibold text-white dark:text-mmx-noche ${leyendo ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
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
  precio: '',
  descuento: '',
  ivaPct: '10',
  tipo: 'medicamento',
  nombre: '',
  actualizarStock: true,
  actualizarPrecio: true,
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
        precioBruto: l.precio.trim() || null,
        descuentoPct: numero(l.descuento),
        ivaPct: Number(l.ivaPct),
        actualizarStock: l.actualizarStock,
        actualizarPrecio: l.actualizarPrecio,
      });
      setL({ ...LINEA_VACIA, tipo: l.tipo, ivaPct: l.ivaPct, descuento: l.descuento });
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
      precio: x.precioUnitario?.replace('.', ',') ?? '',
      descuento: x.descuentoPct?.replace('.', ',') ?? '',
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
      <div
        className={
          r.documento
            ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]'
            : 'flex flex-col gap-4'
        }
      >
        {r.documento && <VisorDocumento documento={r.documento} />}
        <div className="flex min-w-0 flex-col gap-4">
          <CabeceraRecepcion r={r} onCambio={() => void refrescar()} />
          {(r.fechaCorte ?? config?.fechaCorteEntradas) && (
            <Mensaje tipo="aviso">
              Desde el {fecha(r.fechaCorte ?? config?.fechaCorteEntradas)} las entradas de medicamentos se
              registran solo aquí: no las des de alta a mano en Siweb360.
            </Mensaje>
          )}
          {r.escrituraStock === 'off' && (
            <Mensaje tipo="info">
              La escritura de stock en Siweb360 está desactivada: esta recepción no actualiza el stock. La
              casilla «Actualizar stock» de cada línea se tendrá en cuenta cuando se active.
            </Mensaje>
          )}
          {abierta && (
            <LeerDocumento
              recepcion={r}
              usadas={usadas}
              onUsar={usarLeida}
              onLeido={() => void refrescar()}
            />
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
                        No se ha encontrado ningún medicamento con «{busqueda.trim()}» en CIMAVet. Prueba con
                        otra parte del nombre, escanea el envase o regístralo como «Otro producto».
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
                    if (!sel && s.presentacion)
                      setSel({ cn: s.presentacion.cn, nombre: s.presentacion.nombre });
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
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                  etiqueta="Precio unitario (sin IVA, opcional)"
                  info={AY.precioNeto}
                  inputMode="decimal"
                  placeholder="12,50"
                  value={l.precio}
                  error={errores.precioBruto}
                  onChange={(e) => setL({ ...l, precio: e.target.value })}
                />
                <Campo
                  etiqueta="Descuento %"
                  info={AY.descuento}
                  inputMode="decimal"
                  placeholder="0"
                  value={l.descuento}
                  error={errores.descuentoPct}
                  onChange={(e) => setL({ ...l, descuento: e.target.value })}
                  ayuda={
                    netoDe(l.precio, l.descuento) !== null
                      ? `Neto: ${eur(netoDe(l.precio, l.descuento))}`
                      : undefined
                  }
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
              <Casillas
                stock={l.actualizarStock}
                precio={l.actualizarPrecio}
                onCambio={(c) => setL({ ...l, actualizarStock: c.stock, actualizarPrecio: c.precio })}
              />
              {msg && <Mensaje tipo={msg.t}>{msg.m}</Mensaje>}
              <Boton className="mt-3" onClick={() => void anadir()}>
                Añadir línea
              </Boton>
            </Tarjeta>
          )}
          <Tarjeta titulo={`Líneas (${r.lineas.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-slate-600">
                    <th className="p-2">Producto</th>
                    <th className="px-1">Lote · Cad.</th>
                    <th className="px-1 text-right">Uds.</th>
                    <th className="px-1 text-right">Precio</th>
                    <th className="px-1 text-right">Dto.</th>
                    <th className="px-1 text-right">Subtotal</th>
                    <th className="px-1 text-right">IVA · RE</th>
                    <th className="px-1 text-right">Total</th>
                    <th className="px-2">Stock · Precio</th>
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
            <TotalesRecepcion r={r} />
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
        </div>
      </div>
    </Pagina>
  );
}

/** Casillas de una línea: dar entrada de stock en Siweb360 y usar este precio como coste de referencia. */
function Casillas({
  stock,
  precio,
  onCambio,
  compacto = false,
  disabled = false,
}: {
  stock: boolean;
  precio: boolean;
  onCambio: (c: { stock: boolean; precio: boolean }) => void;
  compacto?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`flex ${compacto ? 'flex-col gap-1 text-xs' : 'mt-3 flex-wrap gap-4 text-sm'}`}>
      <label className="flex items-center gap-2" title={AY.actualizarStock}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={stock}
          onChange={(e) => onCambio({ stock: e.target.checked, precio })}
        />
        {compacto ? 'Stock' : 'Actualizar stock en Siweb360'}
        {!compacto && <Info texto={AY.actualizarStock} />}
      </label>
      <label className="flex items-center gap-2" title={AY.actualizarPrecio}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={precio}
          onChange={(e) => onCambio({ stock, precio: e.target.checked })}
        />
        {compacto ? 'Precio' : 'Actualizar precio de coste'}
        {!compacto && <Info texto={AY.actualizarPrecio} />}
      </label>
    </div>
  );
}

/**
 * SKU de Siweb360 de un medicamento de la línea: se ve el relacionado y se puede elegir otro escribiendo su SKU
 * (queda relacionado el código nacional con ese producto para las próximas veces).
 */
function SkuSiweb({
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
  const [abierto, setAbierto] = useState(false);
  const [sku, setSku] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (x.tipo !== 'medicamento' || !x.cn) return null;
  const relacionar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const r = await put<{ variante: { id: number; sku: string | null } }>('/api/admin/mapeo-siweb', {
        cn: x.cn,
        sku: sku.trim(),
      });
      await put(`/api/recepciones/${recepcionId}/lineas/${x.id}`, { siwebVariantId: r.variante.id });
      setAbierto(false);
      setSku('');
      onCambio();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se ha podido relacionar');
    } finally {
      setOcupado(false);
    }
  };
  return (
    <span className="mt-1 block text-xs">
      {x.siwebSku ? (
        <span className="text-slate-600">
          SKU Siweb360: <span className="font-mono">{x.siwebSku}</span>
        </span>
      ) : (
        <span className="text-sustituir">Sin SKU de Siweb360</span>
      )}
      {editable && !abierto && (
        <button type="button" className="ml-2 text-marca underline" onClick={() => setAbierto(true)}>
          {x.siwebSku ? 'Cambiar' : 'Elegir SKU'}
        </button>
      )}
      {abierto && (
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <input
            aria-label="SKU de Siweb360"
            className="min-h-9 rounded border px-2 font-mono"
            placeholder="SKU en Siweb360"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
          />
          <Boton variante="secundario" disabled={!sku.trim() || ocupado} onClick={() => void relacionar()}>
            Relacionar
          </Boton>
          <button type="button" className="underline" onClick={() => setAbierto(false)}>
            Cancelar
          </button>
          {error && <span className="block w-full text-noconforme">{error}</span>}
        </span>
      )}
    </span>
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
  const inicial = () => ({
    lote: x.lote ?? '',
    caducidad: x.caducidad ?? '',
    unidades: x.unidades,
    // Líneas antiguas sin precio bruto: el neto hace de precio sin descuento.
    precio: importeLegible(x.precioBruto ?? x.precioNetoCompra),
    descuento: x.descuentoPct ? importeLegible(x.descuentoPct) : '',
    ivaPct: x.ivaPct ? String(Number(x.ivaPct)) : '10',
  });
  const [v, setV] = useState(inicial);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const hoy = hoyIso();

  const guardar = async (extra: Record<string, unknown> = {}) => {
    const e = validarLinea(v, hoy);
    setErrores(e);
    if (Object.keys(e).length) return;
    try {
      await put(`/api/recepciones/${recepcionId}/lineas/${x.id}`, {
        lote: v.lote.trim() || null,
        caducidad: v.caducidad || null,
        unidades: v.unidades,
        precioBruto: v.precio.trim() || null,
        descuentoPct: numero(v.descuento),
        ivaPct: Number(v.ivaPct),
        ...extra,
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
  const cambiarCasillas = async (c: { stock: boolean; precio: boolean }) => {
    try {
      await put(`/api/recepciones/${recepcionId}/lineas/${x.id}`, {
        actualizarStock: c.stock,
        actualizarPrecio: c.precio,
      });
      onCambio();
    } catch (err) {
      setMsg(erroresDe(err).mensaje);
    }
  };

  const neto = x.precioNetoCompra !== null ? Number(x.precioNetoCompra) : null;
  const subtotal = neto !== null ? Math.round(neto * x.unidades * 100) / 100 : null;
  const total =
    subtotal !== null ? subtotal * (1 + Number(x.ivaPct ?? 0) / 100 + Number(x.rePct ?? 0) / 100) : null;

  if (editando) {
    return (
      <tr className="border-t bg-fondo align-top">
        <td className="p-2" colSpan={10}>
          <p className="mb-2 font-semibold">
            Modificar línea {x.numero}: {x.nombreFarmaco}
          </p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
              etiqueta="Unidades"
              info={AY.unidades}
              type="number"
              min={1}
              value={v.unidades}
              error={errores.unidades}
              onChange={(e) => setV({ ...v, unidades: Number(e.target.value) })}
            />
            <Campo
              etiqueta="Precio (sin IVA)"
              info={AY.precioNeto}
              inputMode="decimal"
              value={v.precio}
              error={errores.precioBruto}
              onChange={(e) => setV({ ...v, precio: e.target.value })}
            />
            <Campo
              etiqueta="Descuento %"
              info={AY.descuento}
              inputMode="decimal"
              value={v.descuento}
              error={errores.descuentoPct}
              onChange={(e) => setV({ ...v, descuento: e.target.value })}
              ayuda={
                netoDe(v.precio, v.descuento) !== null
                  ? `Neto: ${eur(netoDe(v.precio, v.descuento))}`
                  : undefined
              }
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
            <Boton
              variante="secundario"
              onClick={() => {
                setV(inicial());
                setEditando(false);
              }}
            >
              Cancelar
            </Boton>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t align-top">
      <td className="min-w-[12rem] max-w-[22rem] p-2">
        <span className="line-clamp-2 text-sm" title={x.nombreFarmaco}>
          {x.nombreFarmaco}
        </span>
        <span className="block text-xs text-slate-600">
          {[x.cn && `${CN} ${x.cn}`, x.principioActivoTxt, x.formaTxt].filter(Boolean).join(' · ')}
        </span>
        <SkuSiweb x={x} recepcionId={recepcionId} editable={editable} onCambio={onCambio} />
        {x.faltan.length > 0 && (
          <span className="block text-xs text-noconforme">
            Falta: {x.faltan.map((f) => NOMBRES_FALTAN[f] ?? f).join(', ')}
          </span>
        )}
        {x.avisos.map((a) => (
          <span key={a.code} className="block text-xs text-sustituir">
            {textoMotivo(a).titulo}
          </span>
        ))}
        {x.estado === 'PENDIENTE_ALTA_SIWEB' && (
          <span className="block text-xs text-sustituir">Pendiente de alta en Siweb360</span>
        )}
        {x.estado === 'ENCOLADA' && (
          <span className="block text-xs text-texto-muted">Pendiente de envío a Siweb360</span>
        )}
        {x.estado === 'SINCRONIZADA' && (
          <span className="block text-xs text-dispensar">Enviado a Siweb360</span>
        )}
        {x.estado === 'ERROR' && (
          <span className="block text-xs text-noconforme">
            No se ha podido enviar a Siweb360: revísalo en Pendientes, «Envíos a Siweb360 en revisión»
          </span>
        )}
        {msg && <span className="block text-xs text-noconforme">{msg}</span>}
      </td>
      <td className="whitespace-nowrap px-1">
        <span className="font-mono">{x.lote ?? '—'}</span>
        <span className="block text-xs">{fecha(x.caducidad)}</span>
      </td>
      <td className="px-1 text-right">{x.unidades}</td>
      <td className="whitespace-nowrap px-1 text-right">{eur(x.precioBruto ?? x.precioNetoCompra)}</td>
      <td className="px-1 text-right">
        {x.descuentoPct && Number(x.descuentoPct) > 0 ? `${importeLegible(x.descuentoPct)} %` : '—'}
      </td>
      <td className="whitespace-nowrap px-1 text-right">{eur(subtotal)}</td>
      <td className="whitespace-nowrap px-1 text-right text-xs">
        {x.ivaPct ? `${Number(x.ivaPct)} %` : '—'}
        {x.rePct && Number(x.rePct) > 0 ? (
          <span className="block">RE {importeLegible(x.rePct)} %</span>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-1 text-right font-semibold">{eur(total)}</td>
      <td className="px-2">
        <Casillas
          compacto
          disabled={!editable}
          stock={x.actualizarStock}
          precio={x.actualizarPrecio}
          onCambio={(c) => void cambiarCasillas(c)}
        />
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

/** Totales de la recepción y comparación con los del documento leído (si se ha leído). */
function TotalesRecepcion({ r }: { r: Recepcion }) {
  const t = r.totales;
  const doc = r.lectura?.totales?.total ?? null;
  const dif = doc !== null ? Math.round((Number(t.total) - Number(doc)) * 100) / 100 : null;
  const fila = (k: string, v: string, fuerte = false) => (
    <div className={`flex justify-between gap-6 ${fuerte ? 'text-lg font-bold' : ''}`}>
      <span>{k}</span>
      <span>{eur(v)}</span>
    </div>
  );
  return (
    <div
      className="mt-4 ml-auto flex w-full max-w-sm flex-col gap-1 rounded-xl bg-fondo p-3 text-sm"
      data-testid="totales-recepcion"
    >
      {fila('Base imponible', t.base)}
      {fila('IVA', t.iva)}
      {r.regimen !== 'nacional' && fila('Recargo de equivalencia', t.recargo)}
      {fila('Total', t.total, true)}
      {doc !== null && (
        <p className={`mt-1 font-semibold ${dif === 0 ? 'text-dispensar' : 'text-sustituir'}`}>
          {dif === 0
            ? `Cuadra con el total del documento (${eur(doc)})`
            : `Total del documento: ${eur(doc)} · diferencia ${eur(dif)}. Revisa las líneas, el descuento o el régimen.`}
        </p>
      )}
    </div>
  );
}

/**
 * Cabecera de la recepción: distribuidor, nº de albarán o factura, régimen y fechas. Mientras está abierta se puede
 * modificar o descartar (no se borra: queda con el motivo). Ya finalizada, se corrige con motivo (sin régimen).
 */
function CabeceraRecepcion({ r, onCambio }: { r: Recepcion; onCambio: () => void }) {
  const nav = useNavigate();
  const abierta = r.estado === 'ABIERTA';
  const prov = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => get<{ proveedores: { nombre: string }[] }>('/api/recepciones/proveedores'),
    enabled: r.estado !== 'DESCARTADA',
  });
  const inicial = () => ({
    distribuidor: r.distribuidor ?? '',
    albaran: r.albaran ?? '',
    fechaCompra: r.fechaCompra,
    fechaRecepcion: r.fechaRecepcion ?? '',
    regimen: r.regimen,
  });
  // Abierta → se modifica sin más; finalizada → se corrige con motivo (queda auditado). Descartada → nada.
  const corregible = !abierta && r.estado !== 'DESCARTADA';
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState(inicial);
  const [motivo, setMotivo] = useState('');
  const [duplicados, setDuplicados] = useState<Duplicado[]>([]);
  const [confirmar, setConfirmar] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const guardar = async () => {
    setMsg(null);
    if (!abierta && motivo.trim().length < 5) {
      setMsg('Indica por qué corriges los datos (5 caracteres como mínimo).');
      return;
    }
    try {
      if (!abierta) {
        await post(`/api/recepciones/${r.id}/correccion`, {
          ...(v.distribuidor.trim() !== (r.distribuidor ?? '')
            ? { distribuidor: v.distribuidor.trim() }
            : {}),
          albaran: v.albaran.trim() || null,
          fechaCompra: v.fechaCompra,
          fechaRecepcion: v.fechaRecepcion || null,
          motivo: motivo.trim(),
          confirmarDuplicado: confirmar,
        });
        setEditando(false);
        setDuplicados([]);
        setMotivo('');
        onCambio();
        return;
      }
      await put(`/api/recepciones/${r.id}`, {
        ...(v.distribuidor.trim() !== (r.distribuidor ?? '') ? { distribuidor: v.distribuidor.trim() } : {}),
        albaran: v.albaran.trim() || null,
        fechaCompra: v.fechaCompra,
        fechaRecepcion: v.fechaRecepcion || null,
        regimen: v.regimen,
        confirmarDuplicado: confirmar,
      });
      setEditando(false);
      setDuplicados([]);
      onCambio();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.detalles?.duplicados)) {
        setDuplicados(e.detalles.duplicados as Duplicado[]);
        return;
      }
      setMsg(erroresDe(e).mensaje);
    }
  };
  const descartar = async () => {
    const motivo = window.prompt(
      '¿Por qué se descarta esta recepción? (no se borra: queda guardada con el motivo)',
    );
    if (!motivo) return;
    try {
      await post(`/api/recepciones/${r.id}/descartar`, { motivo });
      await nav({ to: '/recepciones' });
    } catch (e) {
      setMsg(erroresDe(e).mensaje);
    }
  };
  if (!editando)
    return (
      <Tarjeta titulo="Datos del documento">
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-600">Distribuidor</dt>
            <dd className="font-semibold">{r.distribuidor ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Nº de albarán o factura</dt>
            <dd className="font-semibold">{r.albaran ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Régimen</dt>
            <dd className="font-semibold">
              {r.regimen === 'nacional' ? 'Solo IVA' : 'IVA + recargo de equivalencia'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Fecha de emisión (compra)</dt>
            <dd className="font-semibold">{fecha(r.fechaCompra)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Fecha de recepción</dt>
            <dd className="font-semibold">{fecha(r.fechaRecepcion)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Estado</dt>
            <dd className="font-semibold">
              {r.estado}
              {r.syncEstado && (
                <span className="block text-xs font-normal">
                  Siweb360: {TEXTO_SYNC[r.syncEstado] ?? r.syncEstado}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {r.correcciones.length > 0 && <HistorialCorrecciones correcciones={r.correcciones} />}
        {msg && <Mensaje tipo="error">{msg}</Mensaje>}
        {corregible && (
          <div className="mt-3 flex flex-wrap gap-3">
            <Boton
              variante="secundario"
              onClick={() => {
                setV(inicial());
                setMotivo('');
                setMsg(null);
                setEditando(true);
              }}
            >
              <Pencil aria-hidden className="h-4 w-4" /> Corregir datos
            </Boton>
          </div>
        )}
        {abierta && (
          <div className="mt-3 flex flex-wrap gap-3">
            <Boton
              variante="secundario"
              onClick={() => {
                setV(inicial());
                setEditando(true);
              }}
            >
              <Pencil aria-hidden className="h-4 w-4" /> Modificar
            </Boton>
            <Boton variante="peligro" onClick={() => void descartar()}>
              <Trash2 aria-hidden className="h-4 w-4" /> Descartar recepción
            </Boton>
          </div>
        )}
      </Tarjeta>
    );
  return (
    <Tarjeta titulo="Datos del documento">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Campo
          etiqueta="Distribuidor"
          info={AY.distribuidor}
          list="distribuidores-cab"
          autoComplete="off"
          value={v.distribuidor}
          onChange={(e) => setV({ ...v, distribuidor: e.target.value })}
        />
        <datalist id="distribuidores-cab">
          {prov.data?.proveedores.map((x) => (
            <option key={x.nombre} value={x.nombre} />
          ))}
        </datalist>
        <Campo
          etiqueta="Nº de albarán o factura"
          info={AY.albaran}
          value={v.albaran}
          onChange={(e) => setV({ ...v, albaran: e.target.value })}
        />
        {abierta && (
          <label className="flex flex-col gap-1 text-sm">
            <Etiqueta texto="Régimen" info={AY.regimen} />
            <select
              className="min-h-11 rounded-lg border px-2"
              value={v.regimen}
              onChange={(e) => setV({ ...v, regimen: e.target.value as Recepcion['regimen'] })}
            >
              <option value="recargo_equivalencia">IVA + recargo de equivalencia</option>
              <option value="nacional">Solo IVA</option>
            </select>
          </label>
        )}
        <Campo
          etiqueta="Fecha de emisión (compra)"
          info={AY.fechaCompra}
          type="date"
          max={hoyIso()}
          value={v.fechaCompra}
          onChange={(e) => setV({ ...v, fechaCompra: e.target.value })}
        />
        <Campo
          etiqueta="Fecha de recepción"
          info={AY.fechaRecepcion}
          type="date"
          max={hoyIso()}
          value={v.fechaRecepcion}
          onChange={(e) => setV({ ...v, fechaRecepcion: e.target.value })}
        />
      </div>
      {!abierta && (
        <>
          <Mensaje tipo="info">
            La recepción está finalizada: puedes corregir estos datos, pero las líneas y el régimen ya no
            cambian. La corrección queda registrada con el motivo, quién la hace y cuándo.
          </Mensaje>
          <div className="mt-3">
            <Campo
              etiqueta="Motivo de la corrección"
              placeholder="Por ejemplo: la mercancía llegó el 26/10, no el 02/11"
              maxLength={500}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </>
      )}
      <AvisoDuplicados duplicados={duplicados} />
      {duplicados.length > 0 && (
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />
          Es otro albarán distinto: guardar igualmente
        </label>
      )}
      {msg && <Mensaje tipo="error">{msg}</Mensaje>}
      <div className="mt-3 flex gap-3">
        <Boton disabled={duplicados.length > 0 && !confirmar} onClick={() => void guardar()}>
          {abierta ? 'Guardar' : 'Guardar corrección'}
        </Boton>
        <Boton
          variante="secundario"
          onClick={() => {
            setEditando(false);
            setDuplicados([]);
            setMsg(null);
          }}
        >
          Cancelar
        </Boton>
      </div>
    </Tarjeta>
  );
}

/** Correcciones de la cabecera hechas tras finalizar: qué cambió, cuándo y por qué. */
function HistorialCorrecciones({ correcciones }: { correcciones: Correccion[] }) {
  return (
    <details className="mt-3 text-sm" open>
      <summary className="cursor-pointer font-semibold">Correcciones ({correcciones.length})</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {correcciones.map((c) => (
          <li key={c.at} className="rounded-lg bg-fondo p-2">
            <span className="text-slate-600">
              {new Date(c.at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}
            </span>
            {c.motivo && <span> · {c.motivo}</span>}
            <ul className="mt-1">
              {(Object.keys(c.despues) as CampoCabecera[])
                .filter((k) => k in NOMBRES_CABECERA)
                .map((k) => (
                  <li key={k}>
                    {NOMBRES_CABECERA[k]}: <s>{valorCabecera(k, c.antes[k])}</s> →{' '}
                    <strong>{valorCabecera(k, c.despues[k])}</strong>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
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
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg p-2 ring-1 text-texto ${usadas.has(i) ? 'bg-dispensar-bg ring-dispensar dark:bg-dispensar-bg/40' : 'bg-superficie ring-slate-200 dark:ring-white/10'}`}
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

/** Foto o PDF del albarán, a la izquierda de los datos, con zoom (se carga con la sesión, como las recetas). */
function VisorDocumento({ documento }: { documento: { url: string; pdf: boolean } }) {
  const [zoom, setZoom] = useState(100);
  const q = useQuery({
    queryKey: ['albaran-doc', documento.url],
    queryFn: async () => URL.createObjectURL(await get<Blob>(documento.url)),
    staleTime: Infinity,
  });
  const cambiar = (d: number) => setZoom((z) => Math.min(300, Math.max(50, z + d)));
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl bg-superficie p-3.5 shadow-sm border border-slate-200/90 dark:border-white/10 dark:shadow-md text-texto lg:sticky lg:top-4"
      data-testid="visor-albaran"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">Documento</span>
        <span className="ml-auto text-sm text-slate-600">{zoom} %</span>
        <Boton variante="secundario" aria-label="Alejar" onClick={() => cambiar(-25)}>
          <ZoomOut aria-hidden className="h-4 w-4" />
        </Boton>
        <Boton variante="secundario" aria-label="Acercar" onClick={() => cambiar(25)}>
          <ZoomIn aria-hidden className="h-4 w-4" />
        </Boton>
      </div>
      {q.data ? (
        documento.pdf ? (
          <iframe
            key={zoom}
            title="Albarán"
            src={`${q.data}#zoom=${zoom}`}
            className="h-[75vh] lg:h-[calc(100vh-6rem)] w-full rounded-lg border"
          />
        ) : (
          <div className="h-[75vh] lg:h-[calc(100vh-6rem)] overflow-auto rounded-lg border">
            <img src={q.data} alt="Albarán" style={{ width: `${zoom}%`, maxWidth: 'none' }} />
          </div>
        )
      ) : (
        <p className="animate-pulse text-sm text-slate-600">Cargando el documento…</p>
      )}
    </div>
  );
}
