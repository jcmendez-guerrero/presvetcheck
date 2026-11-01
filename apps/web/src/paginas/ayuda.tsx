import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { SECCIONES_AYUDA, type Bloque, type Inline } from '@mmx/shared';
import { Pagina } from '../componentes/layout';

/**
 * Documentación para quien usa la app: qué hace cada función y cómo usarla. El contenido está en
 * `packages/shared/src/ayuda` (datos), para que también lo use el asistente de consultas. Describe el
 * comportamiento de la app; las reglas legales están en el motor de reglas, no aquí.
 */
const inline = (xs: Inline[]): ReactNode[] => xs.map((x, i) => (typeof x === 'string' ? x : <strong key={i}>{x.b}</strong>));

const bloque = (b: Bloque, i: number): ReactNode =>
  'p' in b ? (
    <p key={i} className="mt-2 text-slate-800">
      {inline(b.p)}
    </p>
  ) : (
    <ul key={i} className="mt-2 list-disc space-y-1 pl-6 text-slate-800">
      {b.lista.map((item, j) => (
        <li key={j}>{inline(item)}</li>
      ))}
    </ul>
  );

const SECCIONES = SECCIONES_AYUDA.map((s) => ({ id: s.id, titulo: s.titulo, contenido: <>{s.bloques.map(bloque)}</> }));

export function Ayuda() {
  const [q, setQ] = useState('');
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const visibles = SECCIONES.filter(
    (s) =>
      !q.trim() ||
      norm(s.titulo).includes(norm(q)) ||
      norm(document.getElementById(s.id)?.textContent ?? '').includes(norm(q)),
  );
  return (
    <Pagina titulo="Ayuda">
      <p className="text-slate-700">
        Cómo funciona cada parte de la app. Pulsa una sección o busca una palabra.
      </p>
      <label className="flex max-w-md items-center gap-2 rounded-lg border bg-white px-3">
        <Search aria-hidden className="h-5 w-5 text-marca" />
        <input
          aria-label="Buscar en la ayuda"
          className="min-h-11 flex-1 outline-none"
          placeholder="Por ejemplo: albarán, sustitución, importar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <nav aria-label="Índice de la ayuda" className="flex flex-wrap gap-2">
        {SECCIONES.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full bg-white px-3 py-1 text-sm text-marca ring-1 ring-marca/30 hover:bg-fondo"
          >
            {s.titulo}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-4">
        {SECCIONES.map((s) => (
          <section
            key={s.id}
            id={s.id}
            hidden={!visibles.includes(s)}
            className="scroll-mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
          >
            <h2 className="text-xl font-bold text-marca-2">{s.titulo}</h2>
            {s.contenido}
          </section>
        ))}
        {!visibles.length && <p className="text-slate-600">No hay ninguna sección con «{q}».</p>}
      </div>
    </Pagina>
  );
}
