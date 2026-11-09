import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { SECCIONES_AYUDA, type Bloque, type Inline } from '@mmx/shared';
import { Pagina } from '../componentes/layout';

/**
 * Documentación para quien usa la app: qué hace cada función y cómo usarla. El contenido está en
 * `packages/shared/src/ayuda` (datos), para que también lo use el asistente de consultas. Describe el
 * comportamiento de la app; las reglas legales están en el motor de reglas, no aquí.
 */
const inline = (xs: Inline[]): ReactNode[] =>
  xs.map((x, i) => (typeof x === 'string' ? x : <strong key={i}>{x.b}</strong>));

const bloque = (b: Bloque, i: number): ReactNode =>
  'p' in b ? (
    <p key={i} className="mt-2 text-texto leading-relaxed">
      {inline(b.p)}
    </p>
  ) : (
    <ul key={i} className="mt-2 list-disc space-y-1.5 pl-6 text-texto leading-relaxed">
      {b.lista.map((item, j) => (
        <li key={j}>{inline(item)}</li>
      ))}
    </ul>
  );

const SECCIONES = SECCIONES_AYUDA.map((s) => ({
  id: s.id,
  titulo: s.titulo,
  contenido: <>{s.bloques.map(bloque)}</>,
}));

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
      <p className="text-texto-muted dark:text-slate-300">
        Cómo funciona cada parte de la app. Pulsa una sección o busca una palabra.
      </p>
      <label className="flex max-w-md items-center gap-2 rounded-xl border border-borde bg-superficie px-3.5 text-texto shadow-2xs focus-within:ring-2 focus-within:ring-dorado">
        <Search aria-hidden className="h-5 w-5 text-marca dark:text-acento shrink-0" />
        <input
          aria-label="Buscar en la ayuda"
          className="min-h-11 flex-1 bg-transparent text-texto placeholder:text-texto-atenuado outline-none"
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
            className="rounded-full bg-superficie px-3.5 py-1.5 text-sm font-medium text-marca dark:text-acento border border-marca/30 dark:border-white/10 hover:bg-fondo transition-colors"
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
            className="scroll-mt-4 rounded-2xl bg-superficie p-6 shadow-xs border border-slate-200/90 dark:border-white/10 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)] text-texto"
          >
            <h2 className="text-xl font-bold text-marca dark:text-acento">{s.titulo}</h2>
            {s.contenido}
          </section>
        ))}
        {!visibles.length && (
          <p className="text-texto-muted dark:text-slate-400">No hay ninguna sección con «{q}».</p>
        )}
      </div>
    </Pagina>
  );
}
