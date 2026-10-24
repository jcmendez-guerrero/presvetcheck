import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Camera, Loader2, Upload } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { prepararPagina, type PaginaPreparada } from '../lib/imagen';
import { Pagina } from '../componentes/layout';
import { Boton, Mensaje, Tarjeta } from '../componentes/ui';

const DEMOS = ['demo-compania-papel', 'demo-solo-principio-activo', 'demo-produccion-electronica'];

/** Captura multipágina (cámara o fichero), guía de encuadre e indicador de calidad (SPEC §8.2). */
export function NuevaReceta() {
  const nav = useNavigate();
  const { config } = useAuth();
  const [paginas, setPaginas] = useState<PaginaPreparada[]>([]);
  const [fixture, setFixture] = useState(DEMOS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [preparando, setPreparando] = useState(0);

  const anadir = async (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    setPreparando((n) => n + files.length);
    for (const f of files) {
      try {
        const p = await prepararPagina(f);
        setPaginas((x) => [...x, p]);
      } catch {
        setError(`No se ha podido leer ${f.name}`);
      } finally {
        setPreparando((n) => n - 1);
      }
    }
  };

  const enviar = async () => {
    setEnviando(true);
    setError(null);
    const fd = new FormData();
    if (config?.extractor === 'fake') fd.append('fixture', fixture);
    paginas.forEach((p) => fd.append('phash', p.phash ?? ''));
    paginas.forEach((p, i) => fd.append('pagina', p.blob, `pagina-${i + 1}.${p.mime === 'application/pdf' ? 'pdf' : p.mime === 'image/jpeg' ? 'jpg' : 'png'}`));
    try {
      const r = await api<{ id: string; aviso: string | null }>('POST', '/api/recetas', fd);
      await nav({ to: '/recetas/$id/revision', params: { id: r.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se ha podido enviar la receta');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Pagina titulo="Nueva receta">
      <Tarjeta titulo="Fotografía o escanea la receta">
        <p className="mb-3 text-slate-700">Coloca la receta entera dentro del encuadre, sobre fondo liso y con buena luz. Puedes añadir varias páginas.</p>
        <div className="flex flex-wrap gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-marca px-5 py-3 font-semibold text-white">
            <Camera aria-hidden className="h-5 w-5" /> Hacer foto
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void anadir(e.currentTarget)} />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-marca px-5 py-3 font-semibold text-marca">
            <Upload aria-hidden className="h-5 w-5" /> Subir fichero (PDF, JPEG, PNG, HEIC)
            <input data-testid="subir-receta" type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => void anadir(e.currentTarget)} />
          </label>
        </div>
        {config?.extractor === 'fake' && (
          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span className="font-medium">Datos de demostración (EXTRACTOR=fake)</span>
            <select className="min-h-11 rounded-lg border px-2" value={fixture} onChange={(e) => setFixture(e.target.value)}>
              {DEMOS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        )}
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {paginas.map((p, i) => (
            <li key={i} className="rounded-xl bg-fondo p-2">
              {p.vista ? <img src={p.vista} alt={`Página ${i + 1}`} className="max-h-48 w-full rounded object-contain" /> : <p className="p-6 text-center">Página {i + 1} ({p.mime})</p>}
              {p.calidad?.aviso && <p className="mt-1 text-sm font-semibold text-sustituir">{p.calidad.aviso}: repite la foto</p>}
              <Boton variante="texto" onClick={() => setPaginas((x) => x.filter((_, j) => j !== i))}>
                Quitar
              </Boton>
            </li>
          ))}
        </ol>
        {preparando > 0 && (
          <p role="status" className="mt-3 flex items-center gap-2 font-semibold text-pedir">
            <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> Procesando la foto…
          </p>
        )}
        {error && <Mensaje tipo="error">{error}</Mensaje>}
        <div className="mt-4">
          <Boton data-testid="enviar-receta" disabled={!paginas.length || enviando || preparando > 0} onClick={() => void enviar()}>
            {enviando ? 'Leyendo la receta…' : 'Continuar a la revisión'}
          </Boton>
        </div>
      </Tarjeta>
    </Pagina>
  );
}
