import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Boton({ variante = 'principal', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'principal' | 'secundario' | 'peligro' | 'texto' }) {
  const v = {
    principal: 'bg-marca text-white hover:bg-marca-2',
    secundario: 'bg-white text-marca border-2 border-marca hover:bg-pedir-bg',
    peligro: 'bg-white text-noconforme border-2 border-noconforme hover:bg-noconforme-bg',
    texto: 'text-marca underline',
  }[variante];
  return <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 font-semibold disabled:opacity-40 ${v} ${className}`} {...p} />;
}

export function Campo({ etiqueta, dudoso, ayuda, ...p }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; dudoso?: boolean | undefined; ayuda?: string | undefined }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">
        {etiqueta}
        {dudoso && <span className="ml-2 rounded bg-dorado/30 px-1.5 text-xs font-semibold">Revisar</span>}
      </span>
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
