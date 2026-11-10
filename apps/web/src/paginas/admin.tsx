import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fecha } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import type { ConsumoMesDto } from '@mmx/shared';
import { Boton, Campo, Mensaje, Tarjeta } from '../componentes/ui';

const PESTANAS = [
  'Probar lector',
  'Distribuidores',
  'Reglas',
  'Plataformas',
  'Exclusiones',
  'Siweb360',
  'Stock en Siweb360',
  'Outbox',
  'CIMAVet',
  'Asistente',
] as const;

/** Administración (SPEC §8.11). */
export function Admin() {
  const [p, setP] = useState<(typeof PESTANAS)[number]>('Probar lector');
  return (
    <Pagina titulo="Administración">
      <div className="flex flex-wrap gap-2" role="tablist">
        {PESTANAS.map((x) => (
          <Boton
            key={x}
            role="tab"
            aria-selected={p === x}
            variante={p === x ? 'principal' : 'secundario'}
            onClick={() => setP(x)}
          >
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
      {p === 'Stock en Siweb360' && <StockSiweb />}
      {p === 'Outbox' && <Outbox />}
      {p === 'CIMAVet' && <Cimavet />}
      {p === 'Asistente' && <ConsumoAsistente />}
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
      <p>
        Sustituto de GS configurado: {config?.scannerGsSubstitute ?? '(ninguno)'}. Escanea un DataMatrix GS1
        con el foco en el campo.
      </p>
      <input
        aria-label="Lectura del lector"
        className="mt-2 min-h-14 w-full rounded-xl border-2 border-marca px-3 font-mono"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void post('/api/scan/parse', { raw }).then(setR);
        }}
      />
      {r !== null && (
        <pre className="mt-3 overflow-auto rounded-xl bg-fondo p-3 text-sm">{JSON.stringify(r, null, 2)}</pre>
      )}
    </Tarjeta>
  );
}

function Distribuidores() {
  const q = useQuery({
    queryKey: ['dist'],
    queryFn: () =>
      get<Array<{ id: string; nombre: string; cif: string | null; activo: boolean }>>(
        '/api/admin/distribuidores',
      ),
  });
  const [n, setN] = useState({ nombre: '', cif: '' });
  const { run, aviso } = useAccion();
  return (
    <Tarjeta titulo="Distribuidores">
      <ul className="divide-y">
        {q.data?.map((d) => (
          <li key={d.id} className="flex items-center justify-between py-2">
            {d.nombre} {d.cif && `· ${d.cif}`} {!d.activo && '(inactivo)'}
            <Boton
              variante="texto"
              onClick={() =>
                void run(() =>
                  put(`/api/admin/distribuidores/${d.id}`, {
                    nombre: d.nombre,
                    cif: d.cif,
                    activo: !d.activo,
                  }),
                )
              }
            >
              {d.activo ? 'Desactivar' : 'Activar'}
            </Boton>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Nombre" value={n.nombre} onChange={(e) => setN({ ...n, nombre: e.target.value })} />
        <Campo etiqueta="CIF" value={n.cif} onChange={(e) => setN({ ...n, cif: e.target.value })} />
        <Boton
          className="self-end"
          onClick={() =>
            void run(() => post('/api/admin/distribuidores', { nombre: n.nombre, cif: n.cif || null }))
          }
        >
          Añadir
        </Boton>
      </div>
      {aviso}
    </Tarjeta>
  );
}

function Reglas() {
  const { tiene } = useAuth();
  const q = useQuery({
    queryKey: ['reglas'],
    queryFn: () =>
      get<{
        version: string;
        ficheros: Array<{
          id: string;
          nombreFichero: string;
          hash: string;
          aprobadaPor: string | null;
          aprobadaAt: string | null;
        }>;
      }>('/api/admin/reglas'),
  });
  const { run, aviso } = useAccion();
  return (
    <Tarjeta titulo="Reglas activas (solo lectura)">
      <p className="text-sm">Versión: {q.data?.version}</p>
      <ul className="mt-2 divide-y">
        {q.data?.ficheros.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {f.nombreFichero} · {f.hash.slice(0, 8)} ·{' '}
              {f.aprobadaPor ? (
                `aprobada por ${f.aprobadaPor} el ${fecha(f.aprobadaAt)}`
              ) : (
                <strong className="text-sustituir">pendiente de aprobación del garante</strong>
              )}
            </span>
            {tiene('admin') && !f.aprobadaPor && (
              <Boton onClick={() => void run(() => post(`/api/admin/reglas/${f.id}/aprobar`))}>
                Registrar aprobación (MFA)
              </Boton>
            )}
          </li>
        ))}
      </ul>
      {aviso}
    </Tarjeta>
  );
}

function Plataformas() {
  const q = useQuery({
    queryKey: ['plataformas'],
    queryFn: () =>
      get<
        Array<{ id: string; nombre: string; reconocidaMapa: boolean | null; urlVerificacion: string | null }>
      >('/api/admin/plataformas'),
  });
  const { run, aviso } = useAccion();
  return (
    <Tarjeta titulo="Plataformas de receta electrónica (contrastar con el listado del MAPA)">
      <ul className="divide-y">
        {q.data?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {p.nombre} ·{' '}
              {p.reconocidaMapa === null
                ? 'pendiente de verificar'
                : p.reconocidaMapa
                  ? 'reconocida'
                  : 'NO reconocida'}
            </span>
            <span className="flex gap-2">
              <Boton
                variante="secundario"
                onClick={() =>
                  void run(() =>
                    put(`/api/admin/plataformas/${p.id}`, {
                      reconocidaMapa: true,
                      urlVerificacion: p.urlVerificacion,
                    }),
                  )
                }
              >
                Reconocida
              </Boton>
              <Boton
                variante="peligro"
                onClick={() =>
                  void run(() =>
                    put(`/api/admin/plataformas/${p.id}`, {
                      reconocidaMapa: false,
                      urlVerificacion: p.urlVerificacion,
                    }),
                  )
                }
              >
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
  const q = useQuery({
    queryKey: ['excl'],
    queryFn: () =>
      get<
        Array<{ id: string; nregistro: string | null; paId: number | null; motivo: string; fuente: string }>
      >('/api/admin/exclusiones'),
  });
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
        <Campo
          etiqueta="Nº de registro"
          value={n.nregistro}
          onChange={(e) => setN({ ...n, nregistro: e.target.value })}
        />
        <Campo etiqueta="Motivo" value={n.motivo} onChange={(e) => setN({ ...n, motivo: e.target.value })} />
        <Campo etiqueta="Fuente" value={n.fuente} onChange={(e) => setN({ ...n, fuente: e.target.value })} />
        <Boton
          className="self-end"
          onClick={() =>
            void run(() =>
              post('/api/admin/exclusiones', { nregistro: n.nregistro, motivo: n.motivo, fuente: n.fuente }),
            )
          }
        >
          Añadir
        </Boton>
      </div>
      {aviso}
    </Tarjeta>
  );
}

function Siweb() {
  const q = useQuery({
    queryKey: ['tareas'],
    queryFn: () =>
      get<Array<{ id: string; tipo: string; cn: string; propuesta: Record<string, string> }>>(
        '/api/admin/tareas-siweb',
      ),
  });
  const [cn, setCn] = useState('');
  const [sku, setSku] = useState('');
  const [res, setRes] = useState<unknown>(null);
  const { run, aviso } = useAccion();
  return (
    <>
      <Tarjeta titulo="Mapeo código nacional ↔ Siweb360">
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo etiqueta="Código nacional" value={cn} onChange={(e) => setCn(e.target.value)} />
          <Boton
            className="self-end"
            variante="secundario"
            onClick={() =>
              void run(async () => setRes(await post('/api/admin/mapeo-siweb/resolver', { cn })))
            }
          >
            Buscar en Siweb360
          </Boton>
          <Campo etiqueta="SKU en Siweb360" value={sku} onChange={(e) => setSku(e.target.value)} />
          <Boton
            className="self-end"
            onClick={() => void run(async () => setRes(await put('/api/admin/mapeo-siweb', { cn, sku })))}
          >
            Mapear por SKU
          </Boton>
        </div>
        <Boton
          className="mt-3"
          variante="secundario"
          onClick={() =>
            void run(async () => setRes(await post('/api/admin/mapeo-siweb/tareas', { tipo: 'crear', cn })))
          }
        >
          Hay que crearlo en Siweb360
        </Boton>
        {res !== null && (
          <pre className="mt-3 overflow-auto rounded-xl bg-fondo p-3 text-xs">
            {JSON.stringify(res, null, 2)}
          </pre>
        )}
        {aviso}
      </Tarjeta>
      <Tarjeta titulo="Pendiente en Siweb360">
        <ul className="divide-y">
          {q.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {t.tipo === 'crear' ? 'Crear' : 'Renombrar'} · CN {t.cn} · SKU{' '}
                <strong>{t.propuesta.sku ?? t.propuesta.skuNuevo}</strong> ·{' '}
                {t.propuesta.nombre ?? t.propuesta.nombreNuevo}
              </span>
              <span className="flex gap-2">
                <Boton
                  variante="secundario"
                  onClick={() =>
                    void navigator.clipboard?.writeText(t.propuesta.sku ?? t.propuesta.skuNuevo ?? '')
                  }
                >
                  Copiar SKU
                </Boton>
                <Boton onClick={() => void run(() => post(`/api/admin/mapeo-siweb/tareas/${t.id}/hecha`))}>
                  Hecho
                </Boton>
              </span>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </>
  );
}

interface EstadoStockDto {
  escrituraStock: 'off' | 'entries_only';
  fechaCorte: string | null;
  almacenStock: string;
  ultimaPruebaEscritura: string | null;
  pruebaEscrituraVigente: boolean;
  outbox: { pendientes: number; fallidos: number; enRevision: number };
  movimientosSinJustificar: number;
}

/** Escritura de stock en Siweb360 (specs/011): estado y prueba de escritura previa a encenderla. */
function StockSiweb() {
  const q = useQuery({
    queryKey: ['estado-stock'],
    queryFn: () => get<EstadoStockDto>('/api/admin/estado-stock'),
    retry: false,
  });
  const [sku, setSku] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [resultado, setResultado] = useState<{
    ok: boolean;
    coherente?: boolean;
    historialOk?: boolean;
  } | null>(null);
  const { run, aviso } = useAccion();
  if (q.error) return <Mensaje tipo="info">{(q.error as Error).message}</Mensaje>;
  const e = q.data;
  const superada = resultado?.ok && resultado.coherente && resultado.historialOk;
  return (
    <div className="space-y-4">
      <Tarjeta titulo="Estado de la escritura de stock">
        {e && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <dt className="font-medium">Escritura de entradas</dt>
            <dd>
              {e.escrituraStock === 'entries_only'
                ? `Activa desde el ${fecha(e.fechaCorte)}`
                : 'Apagada: las entradas se dan de alta a mano en Siweb360'}
            </dd>
            <dt className="font-medium">Almacén</dt>
            <dd>{e.almacenStock}</dd>
            <dt className="font-medium">Última prueba de escritura superada</dt>
            <dd>{e.ultimaPruebaEscritura ? fecha(e.ultimaPruebaEscritura) : 'Ninguna'}</dd>
            <dt className="font-medium">Envíos pendientes / fallidos / en revisión</dt>
            <dd>
              {e.outbox.pendientes} / {e.outbox.fallidos} / {e.outbox.enRevision}
            </dd>
            <dt className="font-medium">Movimientos de Siweb360 sin justificar</dt>
            <dd>{e.fechaCorte ? e.movimientosSinJustificar : 'Sin fecha de corte'}</dd>
          </dl>
        )}
        {e && e.escrituraStock === 'entries_only' && !e.pruebaEscrituraVigente && (
          <Mensaje tipo="aviso">
            Falta la prueba de escritura (o tiene más de 30 días). Hasta hacerla no se envía stock a Siweb360.
          </Mensaje>
        )}
      </Tarjeta>
      <Tarjeta
        titulo="Prueba de escritura"
        subtitulo="Suma 1 unidad a un producto de prueba en Siweb360, la resta después y comprueba que todo se ve bien. Hazla antes de encender la escritura y repítela cada 30 días."
      >
        <form
          className="space-y-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            void run(async () => {
              setResultado(
                await post('/api/admin/siweb/prueba-escritura', { sku: sku.trim(), confirmacion }),
              );
              setConfirmacion('');
            }, 'Prueba terminada');
          }}
        >
          <Campo
            etiqueta="SKU del producto de prueba"
            ayuda="Debe empezar por TEST- y no estar publicado en el TPV ni en la web."
            value={sku}
            onChange={(ev) => setSku(ev.target.value)}
            required
          />
          <Campo
            etiqueta="Escribe SI para confirmar que se va a escribir en Siweb360"
            value={confirmacion}
            onChange={(ev) => setConfirmacion(ev.target.value)}
            required
          />
          <Boton type="submit" disabled={!sku.trim().startsWith('TEST-') || confirmacion !== 'SI'}>
            Hacer la prueba
          </Boton>
        </form>
        {resultado && (
          <Mensaje tipo={superada ? 'ok' : 'error'}>
            {superada
              ? 'Prueba superada: se puede enviar stock a Siweb360 durante 30 días.'
              : !resultado.ok
                ? 'La prueba no se ha hecho. Revisa que el producto exista, que su SKU sea exacto y que no tenga stock ilimitado.'
                : !resultado.historialOk
                  ? 'Siweb360 no devuelve la nota de los ajustes en su historial: no se puede activar la escritura. Avisa a soporte.'
                  : 'No se ve el lote o la caducidad tras el ajuste: revisa el producto en Siweb360.'}
          </Mensaje>
        )}
        {aviso}
      </Tarjeta>
    </div>
  );
}

const TEXTO_ENVIO: Record<string, string> = {
  pending: 'Pendiente de enviar',
  sent: 'Enviado',
  failed: 'Fallido',
  needs_reconciliation: 'En revisión: no se sabe si llegó',
  resolved_manually: 'Resuelto a mano en Siweb360',
};

function Outbox() {
  const q = useQuery({
    queryKey: ['outbox'],
    queryFn: () =>
      get<
        Array<{
          id: string;
          idempotencyKey: string;
          status: string;
          lastError: string | null;
          stockActual: { total_on_hand?: number } | null;
          proximaComprobacion: string | null;
        }>
      >('/api/admin/outbox'),
    retry: false,
  });
  const { run, aviso } = useAccion();
  if (q.error) return <Mensaje tipo="info">{(q.error as Error).message}</Mensaje>;
  return (
    <Tarjeta titulo="Outbox y reconciliación">
      <ul className="divide-y">
        {q.data?.map((o) => (
          <li key={o.id} className="py-2">
            <p>
              {o.idempotencyKey} · <strong>{TEXTO_ENVIO[o.status] ?? o.status}</strong>{' '}
              {o.lastError && `· ${o.lastError}`}
            </p>
            {o.status === 'needs_reconciliation' && (
              <>
                <p className="text-sm text-texto-muted">
                  {o.proximaComprobacion
                    ? `Se volverá a comprobar en Siweb360 el ${fecha(o.proximaComprobacion)}.`
                    : 'Ya no se comprueba solo: decide tú.'}
                </p>
                <p className="text-sm">
                  {typeof o.stockActual?.total_on_hand === 'number'
                    ? `Stock que tiene ahora Siweb360: ${o.stockActual.total_on_hand}`
                    : 'No se ha podido leer el stock actual en Siweb360.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Boton
                    onClick={() =>
                      void run(() =>
                        post(`/api/admin/outbox/${o.id}/resolver`, {
                          accion: 'confirmar_aplicada',
                          nota: 'Comprobado en Siweb360',
                        }),
                      )
                    }
                  >
                    Sí se aplicó
                  </Boton>
                  <Boton
                    variante="secundario"
                    onClick={() =>
                      void run(() =>
                        post(`/api/admin/outbox/${o.id}/resolver`, {
                          accion: 'reenviar',
                          nota: 'Comprobado: no se aplicó',
                        }),
                      )
                    }
                  >
                    No se aplicó: reenviar
                  </Boton>
                  <Boton
                    variante="peligro"
                    onClick={() =>
                      void run(() =>
                        post(`/api/admin/outbox/${o.id}/resolver`, {
                          accion: 'descartar',
                          nota: 'Descartado',
                        }),
                      )
                    }
                  >
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
  const q = useQuery({
    queryKey: ['cimavet'],
    queryFn: () =>
      get<{
        ultimas: Array<{
          id: string;
          tipo: string;
          inicio: string;
          fin: string | null;
          error: string | null;
          contadores: unknown;
        }>;
      }>('/api/admin/cimavet'),
  });
  return (
    <Tarjeta titulo="Sincronización con CIMAVet">
      <ul className="divide-y text-sm">
        {q.data?.ultimas.map((s) => (
          <li key={s.id} className="py-2">
            {s.tipo} · {fecha(s.inicio)} ·{' '}
            {s.error ? <strong className="text-noconforme">{s.error}</strong> : 'correcta'} ·{' '}
            {JSON.stringify(s.contadores)}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

const ESTADO_CONSUMO: Record<ConsumoMesDto['estado'], { texto: string; clase: string }> = {
  normal: { texto: 'Normal', clase: 'bg-dispensar-bg text-dispensar' },
  aviso: { texto: 'Cerca del límite (80 % o más)', clase: 'bg-sustituir-bg text-sustituir' },
  en_pausa: { texto: 'En pausa: límite alcanzado', clase: 'bg-noconforme-bg text-noconforme' },
};
const num = (n: number) => n.toLocaleString('es-ES');

/** Consumo del asistente de consultas por mes y ampliación del límite (FR-027a, FR-027b). */
function ConsumoAsistente() {
  const q = useQuery({
    queryKey: ['asistente-consumo'],
    queryFn: () => get<{ actual: ConsumoMesDto; historico: ConsumoMesDto[] }>('/api/admin/asistente/consumo'),
  });
  const { run, aviso } = useAccion();
  const [limite, setLimite] = useState('');
  if (q.isLoading) return <Mensaje tipo="info">Cargando…</Mensaje>;
  if (!q.data)
    return (
      <Mensaje tipo="error">
        {(q.error as Error | null)?.message ?? 'No se ha podido cargar el consumo.'}
      </Mensaje>
    );
  const a = q.data.actual;
  const est = ESTADO_CONSUMO[a.estado];
  return (
    <div className="flex flex-col gap-4">
      <Tarjeta titulo={`Asistente de consultas · ${a.mes}`}>
        <p
          className={`inline-block rounded-full px-3 py-1 font-semibold ${est.clase}`}
          data-testid="consumo-estado"
        >
          {est.texto}
        </p>
        <div
          className="mt-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, a.porcentaje)}
          aria-label="Consumo del mes"
        >
          <div className="h-4 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-4 ${a.estado === 'normal' ? 'bg-marca' : a.estado === 'aviso' ? 'bg-sustituir' : 'bg-noconforme'}`}
              style={{ width: `${Math.min(100, a.porcentaje)}%` }}
            />
          </div>
        </div>
        <p className="mt-2">
          {num(a.tokensEntrada + a.tokensSalida)} de {num(a.limiteEfectivo)} tokens ({a.porcentaje} %) ·{' '}
          {num(a.preguntas)} pregunta(s)
          {a.costeEstimadoEur !== null && <> · coste estimado {a.costeEstimadoEur} €</>}
        </p>
        {a.ampliadoPor && (
          <p className="text-sm text-slate-600">
            Límite ampliado por {a.ampliadoPor}
            {a.ampliadoAt ? ` el ${fecha(a.ampliadoAt)}` : ''}.
          </p>
        )}
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => put('/api/admin/asistente/consumo/limite', { limiteTokens: Number(limite) }),
              'Límite ampliado',
            );
          }}
        >
          <Campo
            etiqueta="Nuevo límite de este mes (tokens)"
            type="number"
            min={a.tokensEntrada + a.tokensSalida + 1}
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            info="Tiene que ser mayor que lo ya consumido. Exige haber iniciado sesión con MFA."
          />
          <Boton type="submit" disabled={!limite}>
            Ampliar el límite
          </Boton>
        </form>
        {aviso}
      </Tarjeta>
      {q.data.historico.length > 0 && (
        <Tarjeta titulo="Meses anteriores">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-1">Mes</th>
                <th>Tokens</th>
                <th>Preguntas</th>
                <th>Límite</th>
                <th>Coste estimado</th>
              </tr>
            </thead>
            <tbody>
              {q.data.historico.map((m) => (
                <tr key={m.mes} className="border-t">
                  <td className="py-1">{m.mes}</td>
                  <td>{num(m.tokensEntrada + m.tokensSalida)}</td>
                  <td>{num(m.preguntas)}</td>
                  <td>{num(m.limiteEfectivo)}</td>
                  <td>{m.costeEstimadoEur !== null ? `${m.costeEstimadoEur} €` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </div>
  );
}
