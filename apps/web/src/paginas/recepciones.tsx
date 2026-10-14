import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CN, fecha, hoyIso, textoMotivo, type Motivo } from '../lib/textos';
import { CampoEscaneo } from '../componentes/escaner';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Cargando, Mensaje, Tarjeta } from '../componentes/ui';

interface Recepcion {
  id: string;
  estado: string;
  albaran: string | null;
  fechaCompra: string;
  distribuidor: string | null;
  syncEstado: string | null;
  fechaCorte: string | null;
  escrituraStock: string;
  lineas: Array<{ id: string; numero: number; tipo: string; cn: string | null; nombreFarmaco: string; principioActivoTxt: string | null; formaTxt: string | null; lote: string | null; caducidad: string | null; unidades: number; precioCoste: string | null; estado: string; faltan: string[]; avisos: Motivo[] }>;
}

export function Recepciones() {
  const nav = useNavigate();
  const lista = useQuery({ queryKey: ['recepciones'], queryFn: () => get<Array<{ id: string; estado: string; fechaCompra: string; albaran: string | null }>>('/api/recepciones') });
  const dist = useQuery({ queryKey: ['distribuidores'], queryFn: () => get<Array<{ id: string; nombre: string; activo: boolean }>>('/api/admin/distribuidores') });
  const [d, setD] = useState({ distribuidorId: '', albaran: '', fechaCompra: hoyIso() });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Pagina titulo="Recepción de mercancía">
      <Tarjeta titulo="Nueva recepción">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Distribuidor</span>
            <select className="min-h-11 rounded-lg border px-2" value={d.distribuidorId} onChange={(e) => setD({ ...d, distribuidorId: e.target.value })}>
              <option value="">(Elegir)</option>
              {dist.data?.filter((x) => x.activo).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre}
                </option>
              ))}
            </select>
          </label>
          <Campo etiqueta="Nº de albarán (recomendado)" value={d.albaran} onChange={(e) => setD({ ...d, albaran: e.target.value })} />
          <Campo etiqueta="Fecha de compra" type="date" value={d.fechaCompra} onChange={(e) => setD({ ...d, fechaCompra: e.target.value })} />
        </div>
        {msg && <Mensaje tipo="error">{msg}</Mensaje>}
        <Boton
          className="mt-3"
          disabled={!d.distribuidorId}
          onClick={async () => {
            try {
              const r = await post<{ id: string }>('/api/recepciones', { distribuidorId: d.distribuidorId, albaran: d.albaran || null, fechaCompra: d.fechaCompra });
              await nav({ to: '/recepciones/$id', params: { id: r.id } });
            } catch (e) {
              setMsg(e instanceof ApiError ? e.message : 'Error');
            }
          }}
        >
          Empezar recepción
        </Boton>
      </Tarjeta>
      <Tarjeta titulo="Recepciones recientes">
        <ul className="divide-y">
          {lista.data?.map((r) => (
            <li key={r.id} className="py-2">
              <Link to="/recepciones/$id" params={{ id: r.id }} className="text-marca underline">
                {fecha(r.fechaCompra)} · {r.albaran ?? 'sin albarán'} · {r.estado}
              </Link>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </Pagina>
  );
}

export function RecepcionDetalle() {
  const { id } = useParams({ from: '/recepciones/$id' });
  const qc = useQueryClient();
  const { config } = useAuth();
  const q = useQuery({ queryKey: ['recepcion', id], queryFn: () => get<Recepcion>(`/api/recepciones/${id}`) });
  const [busqueda, setBusqueda] = useState('');
  const [sel, setSel] = useState<{ cn: string; nombre: string } | null>(null);
  const [l, setL] = useState({ lote: '', caducidad: '', unidades: 1, serie: '', gtin: '', cnEscaneado: '', precioNetoCompra: '', ivaPct: '10', tipo: 'medicamento', nombre: '' });
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const cand = useQuery({ queryKey: ['buscar', busqueda], queryFn: () => get<Array<{ cn: string; nombre: string; labtitular: string | null }>>(`/api/medicamentos/buscar?q=${encodeURIComponent(busqueda)}`), enabled: busqueda.length >= 3 && !sel });
  if (!q.data) return <Cargando />;
  const r = q.data;
  const abierta = r.estado === 'ABIERTA';
  const refrescar = () => qc.invalidateQueries({ queryKey: ['recepcion', id] });

  const anadir = async () => {
    setMsg(null);
    try {
      await post(`/api/recepciones/${id}/lineas`, {
        tipo: l.tipo,
        cn: l.tipo === 'medicamento' ? (sel?.cn ?? null) : null,
        nombre: l.tipo === 'producto' ? l.nombre : null,
        lote: l.lote || null,
        caducidad: l.caducidad || null,
        unidades: l.unidades,
        serie: l.serie || null,
        gtin: l.gtin || null,
        cnEscaneado: l.cnEscaneado || null,
        precioNetoCompra: l.precioNetoCompra || null,
        ivaPct: l.precioNetoCompra ? Number(l.ivaPct) : null,
      });
      setL({ ...l, lote: '', caducidad: '', serie: '', gtin: '', cnEscaneado: '', unidades: 1 });
      await refrescar();
    } catch (e) {
      setMsg({ t: 'error', m: e instanceof ApiError ? `${e.message} ${e.detalles?.cnEscaneado ? `(escaneado ${e.detalles.cnEscaneado}, seleccionado ${e.detalles.cnSeleccionado})` : ''}` : 'Error' });
    }
  };

  return (
    <Pagina titulo={`Recepción · ${r.distribuidor ?? ''}`}>
      <p>
        Albarán {r.albaran ?? '—'} · Compra {fecha(r.fechaCompra)} · Estado <strong>{r.estado}</strong>
        {r.syncEstado && ` · Siweb360: ${r.syncEstado}`}
      </p>
      {(r.fechaCorte ?? config?.fechaCorteEntradas) && (
        <Mensaje tipo="aviso">Desde el {fecha(r.fechaCorte ?? config?.fechaCorteEntradas)} las entradas de medicamentos se registran solo aquí: no las des de alta a mano en Siweb360.</Mensaje>
      )}
      {r.escrituraStock === 'off' && <Mensaje tipo="info">La escritura de stock en Siweb360 está desactivada: esta recepción no actualiza el stock.</Mensaje>}
      {abierta && (
        <Tarjeta titulo="Añadir producto">
          <div className="mb-3 flex gap-3">
            <label className="flex items-center gap-2">
              <input type="radio" checked={l.tipo === 'medicamento'} onChange={() => setL({ ...l, tipo: 'medicamento' })} /> Medicamento
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={l.tipo === 'producto'} onChange={() => setL({ ...l, tipo: 'producto' })} /> Otro producto (sin CIMAVet)
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
                <Campo etiqueta="Nombre del medicamento" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                <ul className="mt-2 flex flex-col gap-1">
                  {cand.data?.map((c) => (
                    <li key={c.cn}>
                      <button type="button" className="w-full rounded-lg bg-fondo p-2 text-left hover:bg-pedir-bg" onClick={() => setSel({ cn: c.cn, nombre: c.nombre })}>
                        {c.nombre} · {CN} {c.cn} · {c.labtitular}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : (
            <Campo etiqueta="Nombre del producto" value={l.nombre} onChange={(e) => setL({ ...l, nombre: e.target.value })} />
          )}
          <div className="mt-3">
            <CampoEscaneo
              autoFoco={false}
              gsSubstitute={config?.scannerGsSubstitute}
              onLectura={async (raw) => {
                const s = await post<{ ok: boolean; cn: string | null; lote: string | null; caducidad: string | null; serie: string | null; gtin: string | null; presentacion: { cn: string; nombre: string } | null }>('/api/scan/parse', { raw });
                if (!s.ok) return setMsg({ t: 'error', m: 'No se ha podido leer el código' });
                if (!sel && s.presentacion) setSel({ cn: s.presentacion.cn, nombre: s.presentacion.nombre });
                setL((x) => ({ ...x, lote: s.lote ?? x.lote, caducidad: s.caducidad ?? x.caducidad, serie: s.serie ?? '', gtin: s.gtin ?? '', cnEscaneado: s.cn ?? '' }));
              }}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Campo etiqueta="Lote" value={l.lote} onChange={(e) => setL({ ...l, lote: e.target.value })} />
            <Campo etiqueta="Caducidad" type="date" value={l.caducidad} onChange={(e) => setL({ ...l, caducidad: e.target.value })} />
            <Campo etiqueta="Unidades" type="number" min={1} value={l.unidades} onChange={(e) => setL({ ...l, unidades: Number(e.target.value) || 1 })} />
            <Campo etiqueta="Precio neto unitario sin IVA (opcional)" value={l.precioNetoCompra} onChange={(e) => setL({ ...l, precioNetoCompra: e.target.value.replace(',', '.') })} />
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
              </tr>
            </thead>
            <tbody>
              {r.lineas.map((x) => (
                <tr key={x.id} className="border-t align-top">
                  <td className="p-2">
                    {x.nombreFarmaco}
                    <br />
                    <span className="text-slate-600">{[x.principioActivoTxt, x.formaTxt].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td>{x.cn ?? '—'}</td>
                  <td className="font-mono">{x.lote ?? '—'}</td>
                  <td>{fecha(x.caducidad)}</td>
                  <td>{x.unidades}</td>
                  <td>{x.precioCoste ? `${Number(x.precioCoste).toFixed(2)} €` : '—'}</td>
                  <td>
                    {x.faltan.length > 0 && <span className="text-noconforme">Faltan: {x.faltan.join(', ')}</span>}
                    {x.avisos.map((a) => (
                      <span key={a.code} className="block text-sustituir">
                        {textoMotivo(a).titulo}
                      </span>
                    ))}
                    {x.estado === 'PENDIENTE_ALTA_SIWEB' && <span className="block text-sustituir">Pendiente de alta en Siweb360</span>}
                  </td>
                </tr>
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
      </Tarjeta>
    </Pagina>
  );
}
