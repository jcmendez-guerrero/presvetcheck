import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Info as IconoInfo, Loader2 } from 'lucide-react';

export type VarianteBoton = 'principal' | 'secundario' | 'contorno' | 'peligro' | 'texto';
export type TamanoBoton = 'sm' | 'md' | 'lg';

export function Boton({
  variante = 'principal',
  tamano = 'md',
  cargando = false,
  icono,
  className = '',
  disabled,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  cargando?: boolean;
  icono?: ReactNode;
}) {
  const v: Record<VarianteBoton, string> = {
    principal:
      'bg-marca text-white shadow-sm hover:bg-marca-apoyo dark:bg-marca dark:hover:bg-acento dark:text-texto active:scale-[0.98]',
    secundario:
      'bg-white text-marca border-2 border-marca hover:bg-pedir-bg dark:bg-superficie dark:text-acento dark:border-acento dark:hover:bg-pedir-bg/20 active:scale-[0.98]',
    contorno:
      'bg-transparent text-texto border border-acento/40 hover:bg-acento/10 dark:text-texto dark:border-acento/30 active:scale-[0.98]',
    peligro:
      'bg-white text-noconforme border-2 border-noconforme hover:bg-noconforme-bg dark:bg-superficie dark:hover:bg-noconforme-bg/20 active:scale-[0.98]',
    texto: 'text-marca underline hover:text-marca-apoyo dark:text-acento hover:no-underline px-2 py-1',
  };

  const t: Record<TamanoBoton, string> = {
    sm: 'min-h-10 px-3 py-1.5 text-sm rounded-lg',
    md: 'min-h-11 px-5 py-2.5 text-base rounded-xl',
    lg: 'min-h-12 px-6 py-3 text-lg rounded-2xl',
  };

  return (
    <button
      type="button"
      disabled={disabled || cargando}
      aria-busy={cargando ? true : undefined}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${v[variante]} ${t[tamano]} ${className}`}
      {...p}
    >
      {cargando ? (
        <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
      ) : icono ? (
        <span aria-hidden className="shrink-0">
          {icono}
        </span>
      ) : null}
      {children}
    </button>
  );
}

/** Explicación breve de un campo: icono «i» que la muestra al pasar el ratón, al enfocarlo o al tocarlo. */
export function Info({ texto }: { texto: string }) {
  const id = useId();
  // Se alinea según el hueco disponible para no salirse de la pantalla (ni provocar desplazamiento lateral).
  const [lado, setLado] = useState<'centro' | 'izq' | 'der'>('centro');
  const medir = (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mitad = 136;
    setLado(r.left < mitad ? 'izq' : window.innerWidth - r.right < mitad ? 'der' : 'centro');
  };
  const pos = { centro: 'left-1/2 -translate-x-1/2', izq: 'left-0', der: 'right-0' }[lado];
  return (
    <span className="group relative ml-1 inline-flex align-middle" onMouseEnter={medir} onFocus={medir}>
      <span
        tabIndex={0}
        aria-describedby={id}
        aria-label="Ayuda"
        className="cursor-help rounded-full text-marca-apoyo dark:text-acento outline-none focus-visible:ring-2 focus-visible:ring-dorado"
        onClick={(e) => e.preventDefault()}
      >
        <IconoInfo aria-hidden className="h-4 w-4" />
      </span>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-40 mb-2 hidden w-64 max-w-[80vw] rounded-lg bg-texto px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg ring-1 ring-white/10 group-focus-within:block group-hover:block ${pos}`}
      >
        {texto}
      </span>
    </span>
  );
}

/** Etiqueta de un campo con su ayuda y la marca «Revisar» (también para select y casillas). */
export function Etiqueta({
  texto,
  info,
  dudoso,
}: {
  texto: ReactNode;
  info?: string | undefined;
  dudoso?: boolean | undefined;
}) {
  return (
    <span className="font-medium text-texto dark:text-texto">
      {texto}
      {info && <Info texto={info} />}
      {dudoso && (
        <span className="ml-2 rounded-md bg-dorado/30 dark:bg-dorado/40 px-2 py-0.5 text-xs font-bold text-texto dark:text-white ring-1 ring-dorado/50">
          Revisar
        </span>
      )}
    </span>
  );
}

export function Campo({
  etiqueta,
  dudoso,
  ayuda,
  info,
  error,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string;
  dudoso?: boolean | undefined;
  ayuda?: string | undefined;
  info?: string | undefined;
  error?: string | null | undefined;
}) {
  const id = useId();
  return (
    <label className="flex flex-col gap-1 text-sm">
      <Etiqueta texto={etiqueta} info={info} dudoso={dudoso} />
      <input
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? id : undefined}
        className={`min-h-11 rounded-xl border px-3 text-base text-texto transition-all duration-150 ${
          error
            ? 'border-noconforme bg-noconforme-bg dark:bg-noconforme-bg/30 dark:border-noconforme'
            : dudoso
              ? 'border-dorado bg-dorado/10 dark:bg-dorado/20'
              : 'border-slate-300 bg-white dark:bg-superficie dark:border-superficie-borde dark:text-texto'
        }`}
        {...p}
      />
      {error && (
        <span id={id} className="text-xs font-semibold text-noconforme">
          {error}
        </span>
      )}
      {ayuda && <span className="text-xs text-slate-600 dark:text-slate-300">{ayuda}</span>}
    </label>
  );
}

export function Tarjeta({
  titulo,
  subtitulo,
  children,
  acciones,
  destacada = false,
  className = '',
}: {
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  children: ReactNode;
  acciones?: ReactNode;
  destacada?: boolean;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl bg-white p-5 shadow-sm ring-1 transition-all duration-200 dark:bg-superficie dark:text-texto ${
        destacada
          ? 'ring-2 ring-marca/40 dark:ring-acento/50 shadow-md'
          : 'ring-slate-200/80 dark:ring-superficie-borde'
      } ${className}`}
    >
      {(titulo || subtitulo) && (
        <div className="mb-3">
          {titulo && <h2 className="text-xl font-bold text-marca dark:text-acento">{titulo}</h2>}
          {subtitulo && <p className="text-sm text-marca-apoyo dark:text-slate-300">{subtitulo}</p>}
        </div>
      )}
      {children}
      {acciones && <div className="mt-4 flex flex-wrap items-center gap-3">{acciones}</div>}
    </section>
  );
}

export function Mensaje({
  tipo,
  children,
}: {
  tipo: 'error' | 'aviso' | 'ok' | 'info';
  children: ReactNode;
}) {
  const c = {
    error: 'bg-noconforme-bg text-noconforme dark:bg-noconforme-bg/40 dark:text-noconforme',
    aviso: 'bg-sustituir-bg text-sustituir dark:bg-sustituir-bg/40 dark:text-sustituir',
    ok: 'bg-dispensar-bg text-dispensar dark:bg-dispensar-bg/40 dark:text-dispensar',
    info: 'bg-pedir-bg text-pedir dark:bg-pedir-bg/40 dark:text-pedir',
  }[tipo];
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`rounded-xl px-4 py-3 font-medium ring-1 ring-black/5 dark:ring-white/10 ${c}`}
    >
      {children}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center gap-3 p-4 text-slate-600 dark:text-slate-300" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-marca dark:text-acento" />
      <span className="font-medium animate-pulse">{texto}</span>
    </div>
  );
}
