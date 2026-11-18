import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  RotateCw,
  ScanLine,
  Send,
} from 'lucide-react';
import { MAX_PAGINAS_DOCUMENTO, textoError, type CodigoError } from '@mmx/shared';
import { EscanerCamara } from '../componentes/escaner';
import { Boton, Mensaje, Tarjeta } from '../componentes/ui';
import {
  cargarLecturas,
  enviarCodigo,
  guardarLecturas,
  nuevoId,
  sePuedeReintentar,
  type Lectura,
} from '../lib/envio-codigo';
import { prepararPagina, type PaginaPreparada } from '../lib/imagen';
import { pitido } from '../lib/sonido';
import { leerCodigoDeFoto } from '../lib/zxing';

/**
 * Página del móvil emparejado (se abre con el QR del PC; sin iniciar sesión). Solo ENVÍA: fotos de la receta y
 * lecturas de códigos; no muestra datos de recetas. El token llega en el fragmento (#t=…) y se guarda en la
 * pestaña.
 */
const CLAVE = 'mmx.movil.token';

function tokenInicial(): string | null {
  const m = /[#&]t=([A-Za-z0-9_-]{20,})/.exec(location.hash);
  try {
    if (m) {
      sessionStorage.setItem(CLAVE, m[1]!);
      history.replaceState(null, '', location.pathname);
      return m[1]!;
    }
    return sessionStorage.getItem(CLAVE);
  } catch {
    return m?.[1] ?? null;
  }
}

async function llamar(token: string, metodo: string, url: string, cuerpo?: FormData | object) {
  const esForm = cuerpo instanceof FormData;
  const r = await fetch(url, {
    method: metodo,
    headers: { 'x-movil-token': token, ...(cuerpo && !esForm ? { 'Content-Type': 'application/json' } : {}) },
    ...(cuerpo ? { body: esForm ? cuerpo : JSON.stringify(cuerpo) } : {}),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new Error(
      r.status === 401
        ? 'El emparejamiento ha caducado: vuelve a leer el código QR del ordenador'
        : textoError((e.error?.code ?? 'ERROR_INTERNO') as CodigoError),
    );
  }
  return r.status === 204 ? null : r.json();
}

export function PaginaMovil() {
  const [token] = useState(tokenInicial);
  const [usuario, setUsuario] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  // Si no hay lector de albaranes configurado en la API, la tarjeta del albarán no se puede usar.
  const [albaranes, setAlbaranes] = useState(true);

  useEffect(() => {
    if (!token) return;
    llamar(token, 'GET', '/api/movil/m/sesion').then(
      (s: { usuario: string; albaranes?: boolean }) => {
        setUsuario(s.usuario);
        setAlbaranes(s.albaranes !== false);
      },
      (e: Error) => setError(e.message),
    );
    fetch('/api/config/publica')
      .then((r) => r.json())
      .then((c: { extractor?: string }) => setDemo(c.extractor === 'fake'))
      .catch(() => {});
  }, [token]);

  return (
    <div className="min-h-screen bg-fondo">
      <header>
        <div className="flex items-center gap-2 border-b border-acento/40 bg-superficie dark:bg-superficie-elevada px-4 py-2">
          <img src="/logo-horizontal.png" alt="Mundo Mascotix" className="h-8 w-auto" />
          <span className="font-titulo font-semibold text-marca dark:text-acento">Móvil</span>
        </div>
        {usuario && (
          <p className="bg-marca px-4 py-2 text-sm text-white dark:text-mmx-noche font-medium">
            Conectado al ordenador de {usuario}
          </p>
        )}
      </header>
      <main className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        {!token && (
          <Mensaje tipo="aviso">
            Abre esta página leyendo el código QR que aparece en el ordenador al pulsar «Móvil».
          </Mensaje>
        )}
        {error && <Mensaje tipo="error">{error}</Mensaje>}
        {token && usuario && (
          <>
            <EnviarReceta token={token} demo={demo} />
            {albaranes ? (
              <EnviarAlbaran token={token} />
            ) : (
              <Tarjeta titulo="Albarán o factura">
                <p className="text-slate-700">
                  La lectura de albaranes no está configurada: regístralo en el ordenador.
                </p>
              </Tarjeta>
            )}
            <EnviarCodigo token={token} />
          </>
        )}
      </main>
    </div>
  );
}

function EnviarReceta({ token, demo }: { token: string; demo: boolean }) {
  return (
    <EnviarPaginas
      token={token}
      titulo="Receta"
      explicacion="Fotografía la receta entera, sobre fondo liso y con buena luz. Si tiene varias páginas, añádelas todas."
      ruta="/api/movil/m/recetas"
      textoEnviando="Enviando y leyendo la receta… puede tardar hasta un minuto. No la envíes de nuevo."
      textoBoton="Leyendo la receta… (hasta un minuto)"
      textoEnviada="Receta enviada. Revisa los datos en el ordenador."
      extras={(fd, paginas) => {
        if (demo) fd.append('fixture', 'demo-compania-papel');
        paginas.forEach((p) => fd.append('phash', p.phash ?? ''));
      }}
    />
  );
}

/** Albarán o factura del proveedor (spec 013): de 1 a 10 páginas, fotos o PDF; el PC recibe lo leído. */
function EnviarAlbaran({ token }: { token: string }) {
  return (
    <EnviarPaginas
      token={token}
      titulo="Albarán o factura"
      explicacion="Fotografía el albarán o la factura del proveedor, sobre fondo liso y con buena luz. Si tiene varias páginas, añádelas todas, o elige el PDF."
      ruta="/api/movil/m/albaranes"
      textoEnviando="Enviando y leyendo el albarán… puede tardar hasta un minuto. No lo envíes de nuevo."
      textoBoton="Leyendo el albarán… (hasta un minuto)"
      textoEnviada="Enviado al ordenador."
      maxPaginas={MAX_PAGINAS_DOCUMENTO}
      textoMaximo={`Un albarán admite hasta ${MAX_PAGINAS_DOCUMENTO} páginas`}
    />
  );
}

interface PropsPaginas {
  token: string;
  titulo: string;
  explicacion: string;
  /** Ruta de la API del móvil que recibe las páginas (campo `pagina`). */
  ruta: string;
  textoEnviando: string;
  textoBoton: string;
  textoEnviada: string;
  maxPaginas?: number;
  textoMaximo?: string;
  /** Campos extra del formulario (solo la receta: huella de la foto y la fixture de la demo). */
  extras?: (fd: FormData, paginas: PaginaPreparada[]) => void;
}

function EnviarPaginas({
  token,
  titulo,
  explicacion,
  ruta,
  textoEnviando,
  textoBoton,
  textoEnviada,
  maxPaginas = Infinity,
  textoMaximo = '',
  extras,
}: PropsPaginas) {
  const [paginas, setPaginas] = useState<PaginaPreparada[]>([]);
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'enviada'>('listo');
  const [preparando, setPreparando] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ocupado = preparando > 0 || estado === 'enviando';
  // Con el máximo de páginas ya no se puede añadir otra (pero sí enviar o quitar).
  const sinSitio = ocupado || paginas.length >= maxPaginas;

  // Preparar la foto (girarla, reducirla y comprimirla) tarda unos segundos en el móvil: se muestra
  // «Procesando la foto…» y se bloquean los botones para que no se añada ni se envíe dos veces.
  const anadir = async (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = ''; // permite volver a elegir la misma foto si se quitó
    if (!files.length) return;
    setEstado('listo');
    setError(null);
    const aceptadas = files.slice(0, Math.max(0, maxPaginas - paginas.length));
    if (aceptadas.length < files.length) setError(textoMaximo);
    setPreparando(aceptadas.length);
    for (const f of aceptadas) {
      try {
        const p = await prepararPagina(f);
        setPaginas((x) => [...x, p]);
        navigator.vibrate?.(60);
      } catch {
        setError('No se ha podido leer la foto. Vuelve a hacerla.');
      } finally {
        setPreparando((n) => n - 1);
      }
    }
  };
  const enviar = async () => {
    if (ocupado) return;
    setEstado('enviando');
    setError(null);
    const fd = new FormData();
    extras?.(fd, paginas);
    paginas.forEach((p, i) =>
      fd.append(
        'pagina',
        p.blob,
        `pagina-${i + 1}.${p.mime === 'application/pdf' ? 'pdf' : p.mime === 'image/jpeg' ? 'jpg' : 'png'}`,
      ),
    );
    try {
      await llamar(token, 'POST', ruta, fd);
      setPaginas([]);
      setEstado('enviada');
    } catch (e) {
      setError((e as Error).message);
      setEstado('listo');
    }
  };

  return (
    <Tarjeta titulo={titulo}>
      <p className="mb-3 text-slate-700">{explicacion}</p>
      <div className="flex flex-wrap gap-3">
        <label
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-marca px-5 py-4 font-semibold text-white ${sinSitio ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
        >
          <Camera aria-hidden className="h-5 w-5" /> {paginas.length ? 'Otra página' : 'Hacer foto'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={sinSitio}
            onChange={(e) => void anadir(e.currentTarget)}
          />
        </label>
        <label
          className={`inline-flex items-center gap-2 rounded-xl border-2 border-marca px-4 py-4 font-semibold text-marca ${sinSitio ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
        >
          <ImageIcon aria-hidden className="h-5 w-5" /> Galería
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="sr-only"
            disabled={sinSitio}
            onChange={(e) => void anadir(e.currentTarget)}
          />
        </label>
      </div>
      {preparando > 0 && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 rounded-xl bg-pedir-bg px-3 py-3 font-semibold text-pedir"
        >
          <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> Procesando la foto… espera antes de hacer
          otra
        </p>
      )}
      {paginas.length > 0 && preparando === 0 && estado !== 'enviando' && (
        <p role="status" className="mt-3 font-semibold text-dispensar">
          <Check aria-hidden className="inline h-4 w-4" />{' '}
          {paginas.length === 1 ? '1 página lista' : `${paginas.length} páginas listas`}. Pulsa «Enviar al
          ordenador».
        </p>
      )}
      {estado === 'enviando' && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 rounded-xl bg-pedir-bg px-3 py-3 font-semibold text-pedir"
        >
          <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> {textoEnviando}
        </p>
      )}
      {paginas.length > 0 && (
        <ol className="mt-3 grid grid-cols-3 gap-2">
          {paginas.map((p, i) => (
            <li key={i} className="rounded-lg bg-fondo p-1 text-center text-xs">
              {p.vista ? (
                <img
                  src={p.vista}
                  alt={`Página ${i + 1}`}
                  className="max-h-28 w-full rounded object-contain"
                />
              ) : (
                `Página ${i + 1}`
              )}
              {p.calidad?.aviso && <p className="font-semibold text-sustituir">{p.calidad.aviso}</p>}
              <button
                type="button"
                className="underline"
                disabled={ocupado}
                onClick={() => setPaginas((x) => x.filter((_, j) => j !== i))}
              >
                Quitar
              </button>
            </li>
          ))}
        </ol>
      )}
      {error && <Mensaje tipo="error">{error}</Mensaje>}
      {estado === 'enviada' && (
        <Mensaje tipo="ok">
          <Check aria-hidden className="inline h-4 w-4" /> {textoEnviada}
        </Mensaje>
      )}
      <div className="mt-3">
        <Boton className="w-full" disabled={!paginas.length || ocupado} onClick={() => void enviar()}>
          <Send aria-hidden className="h-5 w-5" />{' '}
          {estado === 'enviando' ? textoBoton : 'Enviar al ordenador'}
        </Boton>
      </div>
    </Tarjeta>
  );
}

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Código del envase (spec 016). Cada lectura tiene su estado: «Enviado» solo cuando el sistema la ha aceptado; si
 * falla, un aviso grande con el motivo, vibración y sonido de error y, si tiene sentido, «Reintentar» con el mismo
 * código (sin volver a escanear). El estado se guarda en la pestaña: sobrevive a bloquear la pantalla.
 */
function EnviarCodigo({ token }: { token: string }) {
  const [camara, setCamara] = useState(false);
  const [lecturas, setLecturas] = useState<Lectura[]>(cargarLecturas);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  // La cámara en vivo exige HTTPS; sin él (p. ej. en local por la red) se lee el código de una foto.
  const enVivo = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => guardarLecturas(lecturas), [lecturas]);
  const cambiar = (id: string, c: Partial<Lectura>) =>
    setLecturas((ls) => ls.map((l) => (l.id === id ? { ...l, ...c } : l)));

  const lanzar = async (l: Lectura) => {
    cambiar(l.id, { estado: 'enviando', motivo: null });
    const r = await enviarCodigo(token, l);
    cambiar(l.id, r);
    // Éxito y fallo suenan y vibran distinto: la persona mira el ordenador, no el móvil.
    if (r.estado === 'enviada') {
      navigator.vibrate?.(80);
      pitido(true);
    } else {
      navigator.vibrate?.([200, 100, 200]);
      pitido(false);
    }
  };
  const enviar = (raw: string) => {
    setError(null);
    const l: Lectura = {
      id: nuevoId(),
      raw,
      leidoAt: new Date().toISOString(),
      estado: 'enviando',
      motivo: null,
    };
    setLecturas((ls) => [l, ...ls]);
    void lanzar(l);
  };
  const deFoto = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setLeyendo(true);
    setError(null);
    try {
      const raw = await leerCodigoDeFoto(f);
      if (raw) enviar(raw);
      else setError('No se ha encontrado ningún código en la foto: acércate más y enfoca el código');
    } catch {
      setError('No se ha podido leer el código de la foto: comprueba la conexión del móvil e inténtalo de nuevo');
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <Tarjeta titulo="Código del envase">
      <p className="mb-3 text-slate-700">
        Lee el código del envase (DataMatrix, código QR o código de barras). Llega a la pantalla de escaneo
        abierta en el ordenador.
      </p>
      <div className="flex flex-wrap gap-3">
        {enVivo && (
          <Boton className="flex-1" onClick={() => setCamara(true)}>
            <ScanLine aria-hidden className="h-5 w-5" /> Escanear
          </Boton>
        )}
        <label
          className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-4 font-semibold ${enVivo ? 'border-2 border-marca text-marca' : 'bg-marca text-white'}`}
        >
          <Camera aria-hidden className="h-5 w-5" /> {leyendo ? 'Buscando el código…' : 'Foto del código'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => void deFoto(e.target.files)}
          />
        </label>
      </div>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
      {lecturas.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {lecturas.map((l) =>
            l.estado === 'enviada' || l.estado === 'enviando' ? (
              <li key={l.id} className="flex items-center gap-2 text-base">
                {l.estado === 'enviada' ? (
                  <Check aria-hidden className="h-5 w-5 text-green-700" />
                ) : (
                  <Loader2 aria-hidden className="h-5 w-5 animate-spin text-pedir" />
                )}
                <span className="font-semibold">{l.estado === 'enviada' ? 'Enviado' : 'Enviando…'}</span>
                <span className="font-mono text-sm">{l.raw.slice(0, 24)}</span>
                <span className="text-sm text-slate-500">{horaDe(l.leidoAt)}</span>
              </li>
            ) : (
              <li
                key={l.id}
                role="alert"
                className="rounded-xl bg-noconforme-bg p-4 text-noconforme ring-2 ring-noconforme dark:bg-noconforme-bg/30"
              >
                <p className="flex items-center gap-2 text-xl font-bold">
                  <AlertTriangle aria-hidden className="h-6 w-6" /> No se ha enviado
                </p>
                <p className="mt-1 font-semibold">{l.motivo}</p>
                <p className="mt-1 font-mono text-sm">
                  {l.raw.slice(0, 32)} · {horaDe(l.leidoAt)}
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {sePuedeReintentar(l) && (
                    <Boton className="flex-1" onClick={() => void lanzar(l)}>
                      <RotateCw aria-hidden className="h-5 w-5" /> Reintentar
                    </Boton>
                  )}
                  <button
                    type="button"
                    className="rounded-xl border-2 border-current px-4 py-3 font-semibold"
                    onClick={() => setLecturas((ls) => ls.filter((x) => x.id !== l.id))}
                  >
                    Descartar
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {camara && (
        <EscanerCamara
          onLectura={(raw) => {
            setCamara(false);
            enviar(raw);
          }}
          onCerrar={() => setCamara(false)}
        />
      )}
    </Tarjeta>
  );
}
