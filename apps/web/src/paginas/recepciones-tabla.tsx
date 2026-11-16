import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { get } from '../lib/api';
import { PAUSA_BUSQUEDA_MS } from '../lib/busqueda';
import { fecha } from '../lib/textos';
import {
  ESTADO_RECEPCION,
  RANGOS,
  aConsulta,
  diaMadrid,
  hayFiltros,
  rangoInvalido,
  type CampoFecha,
  type EstadoRecepcion,
  type FiltrosRecepciones,
  type Orden,
} from '../lib/recepciones-filtros';
import { Boton, Campo, Cargando, Etiqueta, Mensaje, Tarjeta } from '../componentes/ui';

/** Respuesta de `GET /api/recepciones` (contracts/api-recepciones-lista.md). */
export type ListaRecepciones = {
  filas: {
    id: string;
    albaran: string | null;
    proveedor: string;
    fechaRecepcion: string | null;
    fechaCompra: string;
    registradaAt: string;
    estado: EstadoRecepcion;
  }[];
  total: number;
  pagina: number;
  porPagina: number;
  proveedores: { id: string; nombre: string }[];
};

const COLUMNAS: [Orden, string][] = [
  ['albaran', 'Nº de albarán o factura'],
  ['proveedor', 'Proveedor'],
  ['recibida', 'Fecha de recepción'],
  ['compra', 'Fecha de compra'],
  ['registrada', 'Fecha de registro'],
  ['estado', 'Estado'],
];

const NOMBRE_RANGO: Record<(typeof RANGOS)[number][0], string> = {
  recibidaDesde: 'Fecha de recepción',
  compraDesde: 'Fecha de compra',
  registradaDesde: 'Fecha de registro',
};

const AVISO_RANGO = 'La fecha "hasta" no puede ser anterior a "desde"';
const CLASE_CONTROL =
  'min-h-11 rounded-xl border border-borde bg-superficie px-3 text-base text-texto dark:bg-superficie dark:border-borde dark:text-texto';

/** Cambios en la dirección: `undefined` quita el parámetro. */
type Cambios = { [K in keyof FiltrosRecepciones]?: FiltrosRecepciones[K] | undefined };
type BusquedaRecepciones = FiltrosRecepciones & { albaran?: string };
const sinVacios = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as BusquedaRecepciones;

const fechasDe = (f: FiltrosRecepciones) =>
  Object.fromEntries(RANGOS.flat().map((c) => [c, f[c] ?? ''])) as Record<CampoFecha, string>;

/** Tabla filtrable, ordenable y paginada de recepciones (specs/014). Filtros, orden y página viven en la dirección. */
export function TablaRecepciones() {
  const { albaran: _documentoMovil, ...f }: BusquedaRecepciones = useSearch({ from: '/recepciones' });
  const navegar = useNavigate({ from: '/recepciones' });
  const ir = (cambios: Cambios, replace = false) =>
    void navegar({ search: (s) => sinVacios({ ...s, ...cambios }), replace });
  const filtrar = (cambios: Cambios, replace = false) => ir({ ...cambios, pagina: undefined }, replace);

  // Caja de texto: se aplica tras una pausa al escribir (sin llenar el historial); si los filtros cambian desde
  // fuera (Quitar filtros, Atrás), se actualiza.
  const [numero, setNumero] = useState(f.numero ?? '');
  useEffect(() => setNumero(f.numero ?? ''), [f.numero]);
  useEffect(() => {
    const limpio = numero.trim();
    if (limpio === (f.numero ?? '')) return;
    const t = setTimeout(() => filtrar({ numero: limpio || undefined }, true), PAUSA_BUSQUEDA_MS);
    return () => clearTimeout(t);
    // Solo al escribir (`filtrar` y `f` cambian en cada render).
  }, [numero]);

  // Fechas: borrador local para avisar de un rango al revés sin aplicarlo.
  const [fechas, setFechas] = useState(() => fechasDe(f));
  const claveFechas = RANGOS.flat()
    .map((c) => f[c] ?? '')
    .join('|');
  useEffect(() => setFechas(fechasDe(f)), [claveFechas]);
  const invalidos = rangoInvalido(fechas);
  const cambiarFecha = (campo: CampoFecha, valor: string) => {
    const nuevas = { ...fechas, [campo]: valor };
    setFechas(nuevas);
    const par = RANGOS.find((p) => (p as readonly string[]).includes(campo))!;
    if (!rangoInvalido(nuevas).includes(par[1])) {
      filtrar({ [par[0]]: nuevas[par[0]] || undefined, [par[1]]: nuevas[par[1]] || undefined });
    }
  };

  // Un rango al revés que llegue en la dirección no se envía (la API lo rechazaría).
  const consulta: FiltrosRecepciones = { ...f };
  for (const [d, h] of RANGOS) {
    if (rangoInvalido(f).includes(h)) {
      delete consulta[d];
      delete consulta[h];
    }
  }
  const q = useQuery({
    queryKey: ['recepciones', consulta],
    queryFn: () => get<ListaRecepciones>(`/api/recepciones?${aConsulta(consulta).toString()}`),
    placeholderData: keepPreviousData,
  });

  const estados = f.estado ? f.estado.split(',') : [];
  const alternarEstado = (e: string) => {
    const nuevos = estados.includes(e) ? estados.filter((x) => x !== e) : [...estados, e];
    filtrar({ estado: nuevos.length ? nuevos.join(',') : undefined });
  };

  const orden = f.orden ?? 'registrada';
  const dir = f.dir ?? 'desc';
  const ordenar = (c: Orden) =>
    ir({
      orden: c,
      dir: c === orden ? (dir === 'asc' ? 'desc' : 'asc') : c === 'registrada' ? 'desc' : 'asc',
      pagina: undefined,
    });

  const d = q.data;
  const pagina = f.pagina ?? 1;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.porPagina)) : 1;
  // Página fuera de rango (p. ej. una dirección antigua): a la última que existe.
  useEffect(() => {
    if (d && d.filas.length === 0 && d.total > 0 && pagina > paginas) ir({ pagina: paginas }, true);
  }, [d, pagina, paginas]);

  const conFiltros = hayFiltros(f);
  const quitarFiltros = () =>
    void navegar({ search: (s: { albaran?: string }) => (s.albaran ? { albaran: s.albaran } : {}) });
  const botonQuitar = (
    <Boton variante="texto" onClick={quitarFiltros}>
      Quitar filtros
    </Boton>
  );

  return (
    <Tarjeta titulo="Recepciones">
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
        <Campo
          etiqueta="Nº de albarán o factura"
          type="search"
          value={numero}
          maxLength={60}
          onChange={(e) => setNumero(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm">
          <Etiqueta texto="Proveedor" />
          <select
            className={CLASE_CONTROL}
            value={f.proveedor ?? ''}
            onChange={(e) => filtrar({ proveedor: e.target.value || undefined })}
          >
            <option value="">Todos</option>
            {d?.proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1 text-sm lg:row-span-2">
          <legend className="mb-1">
            <Etiqueta texto="Estado" />
          </legend>
          {(Object.keys(ESTADO_RECEPCION) as EstadoRecepcion[]).map((e) => (
            <label key={e} className="flex min-h-8 items-center gap-2">
              <input
                type="checkbox"
                value={e}
                checked={estados.includes(e)}
                onChange={() => alternarEstado(e)}
              />
              {ESTADO_RECEPCION[e].texto}
            </label>
          ))}
          <span className="text-xs text-texto-atenuado dark:text-texto-muted">
            Sin marcar: todas menos las descartadas
          </span>
        </fieldset>
        {RANGOS.map(([desde, hasta]) => (
          <div key={desde} className="grid grid-cols-2 gap-2">
            <Campo
              etiqueta={`${NOMBRE_RANGO[desde]} desde`}
              type="date"
              value={fechas[desde]}
              onChange={(e) => cambiarFecha(desde, e.target.value)}
            />
            <Campo
              etiqueta={`${NOMBRE_RANGO[desde]} hasta`}
              type="date"
              value={fechas[hasta]}
              error={invalidos.includes(hasta) ? AVISO_RANGO : null}
              onChange={(e) => cambiarFecha(hasta, e.target.value)}
            />
          </div>
        ))}
      </form>
      {conFiltros && <div className="mb-3">{botonQuitar}</div>}

      {q.isError && (
        <Mensaje tipo="error">
          No se han podido cargar las recepciones.{' '}
          <Boton variante="texto" onClick={() => void q.refetch()}>
            Reintentar
          </Boton>
        </Mensaje>
      )}
      {!d && !q.isError && <Cargando />}
      {d && d.total === 0 && (
        <Mensaje tipo="info">
          {conFiltros ? <>No hay recepciones con estos filtros.</> : 'Todavía no hay recepciones.'}
        </Mensaje>
      )}
      {d && d.total > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Recepciones de mercancía. Pulsa una cabecera para ordenar; pulsa una fila para abrirla.
              </caption>
              <thead>
                <tr className="border-b border-borde text-left">
                  {COLUMNAS.map(([c, titulo]) => (
                    <th
                      key={c}
                      scope="col"
                      className="whitespace-nowrap py-2 pr-3"
                      aria-sort={c === orden ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button
                        type="button"
                        className="font-semibold hover:underline"
                        onClick={() => ordenar(c)}
                      >
                        {titulo} <span aria-hidden>{c === orden ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {d.filas.map((r) => {
                  const est = ESTADO_RECEPCION[r.estado];
                  return (
                    <tr
                      key={r.id}
                      className="cursor-pointer hover:bg-pedir-bg dark:hover:bg-pedir-bg/20"
                      onClick={() => void navegar({ to: '/recepciones/$id', params: { id: r.id } })}
                    >
                      <td className="py-2 pr-3">
                        <Link to="/recepciones/$id" params={{ id: r.id }} className="text-marca underline">
                          {r.albaran ?? 'Sin albarán'}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{r.proveedor}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{fecha(r.fechaRecepcion)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{fecha(r.fechaCompra)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{fecha(diaMadrid(r.registradaAt))}</td>
                      <td className={`whitespace-nowrap py-2 pr-3 ${est.atencion ? 'font-semibold' : ''}`}>
                        {est.atencion && (
                          <AlertTriangle aria-hidden className="mr-1 inline h-4 w-4 align-text-bottom" />
                        )}
                        {est.texto}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span>
              {d.total} {d.total === 1 ? 'recepción' : 'recepciones'} · Página {Math.min(pagina, paginas)} de{' '}
              {paginas}
            </span>
            <Boton variante="texto" disabled={pagina <= 1} onClick={() => ir({ pagina: pagina - 1 })}>
              Anterior
            </Boton>
            <Boton variante="texto" disabled={pagina >= paginas} onClick={() => ir({ pagina: pagina + 1 })}>
              Siguiente
            </Boton>
          </div>
        </>
      )}
    </Tarjeta>
  );
}
