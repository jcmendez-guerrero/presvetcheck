import { useEffect, useState } from 'react';
import { Camera, Check, Image as ImageIcon, Loader2, ScanLine, Send } from 'lucide-react';
import { textoError, type CodigoError } from '@mmx/shared';
import { EscanerCamara } from '../componentes/escaner';
import { Boton, Mensaje, Tarjeta } from '../componentes/ui';
import { prepararPagina, type PaginaPreparada } from '../lib/imagen';
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
    throw new Error(r.status === 401 ? 'El emparejamiento ha caducado: vuelve a leer el código QR del ordenador' : textoError((e.error?.code ?? 'ERROR_INTERNO') as CodigoError));
  }
  return r.status === 204 ? null : r.json();
}

export function PaginaMovil() {
  const [token] = useState(tokenInicial);
  const [usuario, setUsuario] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    if (!token) return;
    llamar(token, 'GET', '/api/movil/m/sesion').then((s: { usuario: string }) => setUsuario(s.usuario), (e: Error) => setError(e.message));
    fetch('/api/config/publica')
      .then((r) => r.json())
      .then((c: { extractor?: string }) => setDemo(c.extractor === 'fake'))
      .catch(() => {});
  }, [token]);

  return (
    <div className="min-h-screen bg-fondo">
      <header>
        <div className="flex items-center gap-2 border-b border-acento/40 bg-white px-4 py-2">
          <img src="/logo-horizontal.png" alt="Mundo Mascotix" className="h-8 w-auto" />
          <span className="font-titulo font-semibold text-marca-2">Móvil</span>
        </div>
        {usuario && <p className="bg-marca px-4 py-2 text-sm text-white">Conectado al ordenador de {usuario}</p>}
      </header>
      <main className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        {!token && <Mensaje tipo="aviso">Abre esta página leyendo el código QR que aparece en el ordenador al pulsar «Móvil».</Mensaje>}
        {error && <Mensaje tipo="error">{error}</Mensaje>}
        {token && usuario && (
          <>
            <EnviarReceta token={token} demo={demo} />
            <EnviarCodigo token={token} />
          </>
        )}
      </main>
    </div>
  );
}

function EnviarReceta({ token, demo }: { token: string; demo: boolean }) {
  const [paginas, setPaginas] = useState<PaginaPreparada[]>([]);
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'enviada'>('listo');
  const [preparando, setPreparando] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ocupado = preparando > 0 || estado === 'enviando';

  // Preparar la foto (girarla, reducirla y comprimirla) tarda unos segundos en el móvil: se muestra
  // «Procesando la foto…» y se bloquean los botones para que no se añada ni se envíe dos veces.
  const anadir = async (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = ''; // permite volver a elegir la misma foto si se quitó
    if (!files.length) return;
    setEstado('listo');
    setError(null);
    setPreparando(files.length);
    for (const f of files) {
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
    if (demo) fd.append('fixture', 'demo-compania-papel');
    paginas.forEach((p) => fd.append('phash', p.phash ?? ''));
    paginas.forEach((p, i) => fd.append('pagina', p.blob, `pagina-${i + 1}.${p.mime === 'application/pdf' ? 'pdf' : p.mime === 'image/jpeg' ? 'jpg' : 'png'}`));
    try {
      await llamar(token, 'POST', '/api/movil/m/recetas', fd);
      setPaginas([]);
      setEstado('enviada');
    } catch (e) {
      setError((e as Error).message);
      setEstado('listo');
    }
  };

  return (
    <Tarjeta titulo="Receta">
      <p className="mb-3 text-slate-700">Fotografía la receta entera, sobre fondo liso y con buena luz. Si tiene varias páginas, añádelas todas.</p>
      <div className="flex flex-wrap gap-3">
        <label className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-marca px-5 py-4 font-semibold text-white ${ocupado ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
          <Camera aria-hidden className="h-5 w-5" /> {paginas.length ? 'Otra página' : 'Hacer foto'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={ocupado} onChange={(e) => void anadir(e.currentTarget)} />
        </label>
        <label className={`inline-flex items-center gap-2 rounded-xl border-2 border-marca px-4 py-4 font-semibold text-marca ${ocupado ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
          <ImageIcon aria-hidden className="h-5 w-5" /> Galería
          <input type="file" accept="image/*,application/pdf" multiple className="sr-only" disabled={ocupado} onChange={(e) => void anadir(e.currentTarget)} />
        </label>
      </div>
      {preparando > 0 && (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-xl bg-pedir-bg px-3 py-3 font-semibold text-pedir">
          <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> Procesando la foto… espera antes de hacer otra
        </p>
      )}
      {paginas.length > 0 && preparando === 0 && estado !== 'enviando' && (
        <p role="status" className="mt-3 font-semibold text-dispensar">
          <Check aria-hidden className="inline h-4 w-4" /> {paginas.length === 1 ? '1 página lista' : `${paginas.length} páginas listas`}. Pulsa «Enviar al ordenador».
        </p>
      )}
      {estado === 'enviando' && (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-xl bg-pedir-bg px-3 py-3 font-semibold text-pedir">
          <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> Enviando y leyendo la receta… puede tardar hasta un minuto. No la envíes de nuevo.
        </p>
      )}
      {paginas.length > 0 && (
        <ol className="mt-3 grid grid-cols-3 gap-2">
          {paginas.map((p, i) => (
            <li key={i} className="rounded-lg bg-fondo p-1 text-center text-xs">
              {p.vista ? <img src={p.vista} alt={`Página ${i + 1}`} className="max-h-28 w-full rounded object-contain" /> : `Página ${i + 1}`}
              {p.calidad?.aviso && <p className="font-semibold text-sustituir">{p.calidad.aviso}</p>}
              <button type="button" className="underline" disabled={ocupado} onClick={() => setPaginas((x) => x.filter((_, j) => j !== i))}>
                Quitar
              </button>
            </li>
          ))}
        </ol>
      )}
      {error && <Mensaje tipo="error">{error}</Mensaje>}
      {estado === 'enviada' && (
        <Mensaje tipo="ok">
          <Check aria-hidden className="inline h-4 w-4" /> Receta enviada. Revisa los datos en el ordenador.
        </Mensaje>
      )}
      <div className="mt-3">
        <Boton className="w-full" disabled={!paginas.length || ocupado} onClick={() => void enviar()}>
          <Send aria-hidden className="h-5 w-5" /> {estado === 'enviando' ? 'Leyendo la receta… (hasta un minuto)' : 'Enviar al ordenador'}
        </Boton>
      </div>
    </Tarjeta>
  );
}

function EnviarCodigo({ token }: { token: string }) {
  const [camara, setCamara] = useState(false);
  const [enviados, setEnviados] = useState<{ raw: string; hora: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  // La cámara en vivo exige HTTPS; sin él (p. ej. en local por la red) se lee el código de una foto.
  const enVivo = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  const enviar = async (raw: string) => {
    setError(null);
    try {
      await llamar(token, 'POST', '/api/movil/m/codigos', { raw });
      setEnviados((x) => [{ raw, hora: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }, ...x].slice(0, 5));
      navigator.vibrate?.(80);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const deFoto = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setLeyendo(true);
    setError(null);
    try {
      const raw = await leerCodigoDeFoto(f);
      if (raw) await enviar(raw);
      else setError('No se ha encontrado ningún código en la foto: acércate más y enfoca el código');
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <Tarjeta titulo="Código del envase">
      <p className="mb-3 text-slate-700">Lee el código del envase (DataMatrix o código de barras). Llega a la pantalla de escaneo abierta en el ordenador.</p>
      <div className="flex flex-wrap gap-3">
        {enVivo && (
          <Boton className="flex-1" onClick={() => setCamara(true)}>
            <ScanLine aria-hidden className="h-5 w-5" /> Escanear
          </Boton>
        )}
        <label className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-4 font-semibold ${enVivo ? 'border-2 border-marca text-marca' : 'bg-marca text-white'}`}>
          <Camera aria-hidden className="h-5 w-5" /> {leyendo ? 'Buscando el código…' : 'Foto del código'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void deFoto(e.target.files)} />
        </label>
      </div>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
      {enviados.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {enviados.map((e, i) => (
            <li key={i} className="flex items-center gap-2">
              <Check aria-hidden className="h-4 w-4 text-green-700" /> <span className="font-mono">{e.raw.slice(0, 32)}</span> <span className="text-slate-500">{e.hora}</span>
            </li>
          ))}
        </ul>
      )}
      {camara && (
        <EscanerCamara
          onLectura={(raw) => {
            setCamara(false);
            void enviar(raw);
          }}
          onCerrar={() => setCamara(false)}
        />
      )}
    </Tarjeta>
  );
}
