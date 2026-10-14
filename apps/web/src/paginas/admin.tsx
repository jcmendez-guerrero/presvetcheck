import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fecha } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Mensaje, Tarjeta } from '../componentes/ui';

const PESTANAS = ['Probar lector', 'Distribuidores', 'Reglas', 'Plataformas', 'Exclusiones', 'Siweb360', 'Outbox', 'CIMAVet'] as const;

/** Administración (SPEC §8.11). */
export function Admin() {
  const [p, setP] = useState<(typeof PESTANAS)[number]>('Probar lector');
  return (
    <Pagina titulo="Administración">
      <div className="flex flex-wrap gap-2" role="tablist">
        {PESTANAS.map((x) => (
          <Boton key={x} role="tab" aria-selected={p === x} variante={p === x ? 'principal' : 'secundario'} onClick={() => setP(x)}>
            {x}
          </Boton>
        ))}
      </div>
      {p === 'Probar lector' && <ProbarLector />}
      {p === 'Distribuidores' && <Distribuidores />}
      {p === 'Reglas' && <Reglas />}
      {p === 'Plataformas' && <Plataformas />}
      {p === 'Exclusiones' && <Exclusiones />}
      {p === 'Siweb360' && <Siweb />}
      {p === 'Outbox' && <Outbox />}
      {p === 'CIMAVet' && <Cimavet />}
    </Pagina>
  );
}

function useAccion() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const run = async (f: () => Promise<unknown>, ok = 'Hecho') => {
    try {
      await f();
      setMsg({ t: 'ok', m: ok });
      await qc.invalidateQueries();
    } catch (e) {
      setMsg({ t: 'error', m: e instanceof ApiError ? e.message : 'Error' });
    }
  };
  return { run, aviso: msg ? <Mensaje tipo={msg.t}>{msg.m}</Mensaje> : null };
}

/** "Probar lector" (SPEC §4.6): bytes recibidos y resultado del parseo GS1. */
function ProbarLector() {
  const [raw, setRaw] = useState('');
  const [r, setR] = useState<unknown>(null);
  const { config } = useAuth();
  return (
    <Tarjeta titulo="Probar lector">
      <p>Sustituto de GS configurado: {config?.scannerGsSubstitute ?? '(ninguno)'}. Escanea un DataMatrix GS1 con el foco en el campo.</p>
      <input
        aria-label="Lectura del lector"
        className="mt-2 min-h-14 w-full rounded-xl border-2 border-marca px-3 font-mono"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void post('/api/scan/parse', { raw }).then(setR);
        }}
      />
      {r !== null && <pre className="mt-3 overflow-auto rounded-xl bg-fondo p-3 text-sm">{JSON.stringify(r, null, 2)}</pre>}
    </Tarjeta>
  );
}

function Distribuidores() {
  const q = useQuery({ queryKey: ['dist'], queryFn: () => get<Array<{ id: string; nombre: string; cif: string | null; activo: boolean }>>('/api/admin/distribuidores') });
  const [n, setN] = useState({ nombre: '', cif: '' });
  const { run, aviso } = useAccion();
  return (
    <Tarjeta titulo="Distribuidores">
      <ul className="divide-y">
        {q.data?.map((d) => (
          <li key={d.id} className="flex items-center justify-between py-2">
            {d.nombre} {d.cif && `· ${d.cif}`} {!d.activo && '(inactivo)'}
            <Boton variante="texto" onClick={() => void run(() => put(`/api/admin/distribuidores/${d.id}`, { nombre: d.nombre, cif: d.cif, activo: !d.activo }))}>
              {d.activo ? 'Desactivar' : 'Activar'}
            </Boton>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Nombre" value={n.nombre} onChange={(e) => setN({ ...n, nombre: e.target.value })} />
        <Campo etiqueta="CIF" value={n.cif} onChange={(e) => setN({ ...n, cif: e.target.value })} />
        <Boton className="self-end" onClick={() => void run(() => post('/api/admin/distribuidores', { nombre: n.nombre, cif: n.cif || null }))}>
          Añadir
        </Boton>
      </div>
      {aviso}
    </Tarjeta>
  );
}

function Reglas() {
  const { tiene } = useAuth();
  const q = useQuery({ queryKey: ['reglas'], queryFn: () => get<{ version: string; ficheros: Array<{ id: string; nombreFichero: string; hash: string; aprobadaPor: string | null; aprobadaAt: string | null }> }>('/api/admin/reglas') });
  const { run, aviso } = useAccion();
  return (
    <Tarjeta titulo="Reglas activas (solo lectura)">
      <p className="text-sm">Versión: {q.data?.version}</p>
      <ul className="mt-2 divide-y">
        {q.data?.ficheros.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {f.nombreFichero} · {f.hash.slice(0, 8)} · {f.aprobadaPor ? `aprobada por ${f.aprobadaPor} el ${fecha(f.aprobadaAt)}` : <strong className="text-sustituir">pendiente de aprobación del garante</strong>}
            </span>
            {tiene('farmaceutico_garante') && !f.aprobadaPor && <Boton onClick={() => void run(() => post(`/api/admin/reglas/${f.id}/aprobar`))}>Aprobar</Boton>}
          </li>
        ))}
      </ul>
      {aviso}
    </Tarjeta>
  );
}

function Plataformas() {
  const q = useQuery({ queryKey: ['plataformas'], queryFn: () => get<Array<{ id: string; nombre: string; reconocidaMapa: boolean | null; urlVerificacion: string | null }>>('/api/admin/plataformas') });
  const { run, aviso } = useAccion();
  return (
    <Tarjeta titulo="Plataformas de receta electrónica (contrastar con el listado del MAPA)">
      <ul className="divide-y">
        {q.data?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {p.nombre} · {p.reconocidaMapa === null ? 'pendiente de verificar' : p.reconocidaMapa ? 'reconocida' : 'NO reconocida'}
            </span>
            <span className="flex gap-2">
              <Boton variante="secundario" onClick={() => void run(() => put(`/api/admin/plataformas/${p.id}`, { reconocidaMapa: true, urlVerificacion: p.urlVerificacion }))}>
                Reconocida
              </Boton>
              <Boton variante="peligro" onClick={() => void run(() => put(`/api/admin/plataformas/${p.id}`, { reconocidaMapa: false, urlVerificacion: p.urlVerificacion }))}>
                No reconocida
              </Boton>
            </span>
          </li>
        ))}
      </ul>
      {aviso}
    </Tarjeta>
  );
}

function Exclusiones() {
  const q = useQuery({ queryKey: ['excl'], queryFn: () => get<Array<{ id: string; nregistro: string | null; paId: number | null; motivo: string; fuente: string }>>('/api/admin/exclusiones') });
  const [n, setN] = useState({ nregistro: '', motivo: '', fuente: '' });
  const { run, aviso } = useAccion();
  return (
    <Tarjeta titulo="No sustituibles (biodisponibilidad o estrecho margen)">
      <ul className="divide-y">
        {q.data?.map((x) => (
          <li key={x.id} className="py-2">
            {x.nregistro ?? `PA ${x.paId}`} · {x.motivo} · {x.fuente}
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Campo etiqueta="Nº de registro" value={n.nregistro} onChange={(e) => setN({ ...n, nregistro: e.target.value })} />
        <Campo etiqueta="Motivo" value={n.motivo} onChange={(e) => setN({ ...n, motivo: e.target.value })} />
        <Campo etiqueta="Fuente" value={n.fuente} onChange={(e) => setN({ ...n, fuente: e.target.value })} />
        <Boton className="self-end" onClick={() => void run(() => post('/api/admin/exclusiones', { nregistro: n.nregistro, motivo: n.motivo, fuente: n.fuente }))}>
          Añadir
        </Boton>
      </div>
      {aviso}
    </Tarjeta>
  );
}

function Siweb() {
  const q = useQuery({ queryKey: ['tareas'], queryFn: () => get<Array<{ id: string; tipo: string; cn: string; propuesta: Record<string, string> }>>('/api/admin/tareas-siweb') });
  const [cn, setCn] = useState('');
  const [sku, setSku] = useState('');
  const [res, setRes] = useState<unknown>(null);
  const { run, aviso } = useAccion();
  return (
    <>
      <Tarjeta titulo="Mapeo código nacional ↔ Siweb360">
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo etiqueta="Código nacional" value={cn} onChange={(e) => setCn(e.target.value)} />
          <Boton className="self-end" variante="secundario" onClick={() => void run(async () => setRes(await post('/api/admin/mapeo-siweb/resolver', { cn })))}>
            Buscar en Siweb360
          </Boton>
          <Campo etiqueta="SKU en Siweb360" value={sku} onChange={(e) => setSku(e.target.value)} />
          <Boton className="self-end" onClick={() => void run(async () => setRes(await put('/api/admin/mapeo-siweb', { cn, sku })))}>
            Mapear por SKU
          </Boton>
        </div>
        <Boton className="mt-3" variante="secundario" onClick={() => void run(async () => setRes(await post('/api/admin/mapeo-siweb/tareas', { tipo: 'crear', cn })))}>
          Hay que crearlo en Siweb360
        </Boton>
        {res !== null && <pre className="mt-3 overflow-auto rounded-xl bg-fondo p-3 text-xs">{JSON.stringify(res, null, 2)}</pre>}
        {aviso}
      </Tarjeta>
      <Tarjeta titulo="Pendiente en Siweb360">
        <ul className="divide-y">
          {q.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {t.tipo === 'crear' ? 'Crear' : 'Renombrar'} · CN {t.cn} · SKU <strong>{t.propuesta.sku ?? t.propuesta.skuNuevo}</strong> · {t.propuesta.nombre ?? t.propuesta.nombreNuevo}
              </span>
              <span className="flex gap-2">
                <Boton variante="secundario" onClick={() => void navigator.clipboard?.writeText(t.propuesta.sku ?? t.propuesta.skuNuevo ?? '')}>
                  Copiar SKU
                </Boton>
                <Boton onClick={() => void run(() => post(`/api/admin/mapeo-siweb/tareas/${t.id}/hecha`))}>Hecho</Boton>
              </span>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </>
  );
}

function Outbox() {
  const q = useQuery({ queryKey: ['outbox'], queryFn: () => get<Array<{ id: string; idempotencyKey: string; status: string; lastError: string | null; stockActual: unknown }>>('/api/admin/outbox'), retry: false });
  const { run, aviso } = useAccion();
  if (q.error) return <Mensaje tipo="info">{(q.error as Error).message}</Mensaje>;
  return (
    <Tarjeta titulo="Outbox y reconciliación">
      <ul className="divide-y">
        {q.data?.map((o) => (
          <li key={o.id} className="py-2">
            <p>
              {o.idempotencyKey} · <strong>{o.status}</strong> {o.lastError && `· ${o.lastError}`}
            </p>
            {o.status === 'needs_reconciliation' && (
              <>
                <pre className="text-xs">Stock actual: {JSON.stringify(o.stockActual)}</pre>
                <div className="flex flex-wrap gap-2">
                  <Boton onClick={() => void run(() => post(`/api/admin/outbox/${o.id}/resolver`, { accion: 'confirmar_aplicada', nota: 'Comprobado en Siweb360' }))}>Sí se aplicó</Boton>
                  <Boton variante="secundario" onClick={() => void run(() => post(`/api/admin/outbox/${o.id}/resolver`, { accion: 'reenviar', nota: 'Comprobado: no se aplicó' }))}>
                    No se aplicó: reenviar
                  </Boton>
                  <Boton variante="peligro" onClick={() => void run(() => post(`/api/admin/outbox/${o.id}/resolver`, { accion: 'descartar', nota: 'Descartado' }))}>
                    Descartar
                  </Boton>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {aviso}
    </Tarjeta>
  );
}

function Cimavet() {
  const q = useQuery({ queryKey: ['cimavet'], queryFn: () => get<{ ultimas: Array<{ id: string; tipo: string; inicio: string; fin: string | null; error: string | null; contadores: unknown }> }>('/api/admin/cimavet') });
  return (
    <Tarjeta titulo="Sincronización con CIMAVet">
      <ul className="divide-y text-sm">
        {q.data?.ultimas.map((s) => (
          <li key={s.id} className="py-2">
            {s.tipo} · {fecha(s.inicio)} · {s.error ? <strong className="text-noconforme">{s.error}</strong> : 'correcta'} · {JSON.stringify(s.contadores)}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
