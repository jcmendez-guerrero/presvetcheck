import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Info as IconoInfo } from 'lucide-react';

export function Boton({ variante = 'principal', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'principal' | 'secundario' | 'peligro' | 'texto' }) {
  const v = {
    principal: 'bg-marca text-white hover:bg-marca-2',
    secundario: 'bg-white text-marca border-2 border-marca hover:bg-pedir-bg',
    peligro: 'bg-white text-noconforme border-2 border-noconforme hover:bg-noconforme-bg',
    texto: 'text-marca underline',
  }[variante];
  return <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 font-semibold disabled:opacity-40 ${v} ${className}`} {...p} />;
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
      <span tabIndex={0} aria-describedby={id} aria-label="Ayuda" className="cursor-help rounded-full text-marca-2 outline-none focus-visible:ring-2 focus-visible:ring-dorado" onClick={(e) => e.preventDefault()}>
        <IconoInfo aria-hidden className="h-4 w-4" />
      </span>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-40 mb-2 hidden w-64 max-w-[80vw] rounded-lg bg-texto px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg group-focus-within:block group-hover:block ${pos}`}
      >
        {texto}
      </span>
    </span>
  );
}

/** Etiqueta de un campo con su ayuda y la marca «Revisar» (también para select y casillas). */
export function Etiqueta({ texto, info, dudoso }: { texto: ReactNode; info?: string | undefined; dudoso?: boolean | undefined }) {
  return (
    <span className="font-medium">
      {texto}
      {info && <Info texto={info} />}
      {dudoso && <span className="ml-2 rounded bg-dorado/30 px-1.5 text-xs font-semibold">Revisar</span>}
    </span>
  );
}

export function Campo({
  etiqueta,
  dudoso,
  ayuda,
  info,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; dudoso?: boolean | undefined; ayuda?: string | undefined; info?: string | undefined }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <Etiqueta texto={etiqueta} info={info} dudoso={dudoso} />
      <input className={`min-h-11 rounded-lg border px-3 text-base ${dudoso ? 'border-dorado bg-dorado/10' : 'border-slate-300 bg-white'}`} {...p} />
      {ayuda && <span className="text-xs text-slate-600">{ayuda}</span>}
    </label>
  );
}

export function Tarjeta({ titulo, children, acciones, className = '' }: { titulo?: ReactNode; children: ReactNode; acciones?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${className}`}>
      {titulo && <h2 className="mb-3 text-xl font-semibold">{titulo}</h2>}
      {children}
      {acciones && <div className="mt-4 flex flex-wrap gap-3">{acciones}</div>}
    </section>
  );
}

export function Mensaje({ tipo, children }: { tipo: 'error' | 'aviso' | 'ok' | 'info'; children: ReactNode }) {
  const c = { error: 'bg-noconforme-bg text-noconforme', aviso: 'bg-sustituir-bg text-sustituir', ok: 'bg-dispensar-bg text-dispensar', info: 'bg-pedir-bg text-pedir' }[tipo];
  return (
    <div role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 font-medium ${c}`}>
      {children}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <p className="animate-pulse text-slate-600">{texto}</p>;
}
