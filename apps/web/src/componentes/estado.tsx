import { AlertTriangle, CheckCircle2, Clock, Package, Repeat, XCircle } from 'lucide-react';
import { DECISION, textoMotivo, type Motivo } from '../lib/textos';

const ICONO = {
  DISPENSAR: CheckCircle2,
  DISPENSAR_CON_AVISO: AlertTriangle,
  SUSTITUIR: Repeat,
  PEDIR: Package,
  NO_CONFORME: XCircle,
  PENDIENTE_STOCK: Clock,
} as const;

/** Estado de una línea: color + icono + texto (nunca solo color). */
export function EstadoDecision({ decision, grande }: { decision: string; grande?: boolean }) {
  const d = DECISION[decision] ?? { texto: decision, clase: 'bg-slate-100' };
  const I = ICONO[decision as keyof typeof ICONO] ?? AlertTriangle;
  return (
    <span data-decision={decision} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-semibold ${d.clase} ${grande ? 'text-lg' : 'text-sm'}`}>
      <I aria-hidden className={grande ? 'h-6 w-6' : 'h-4 w-4'} />
      {d.texto}
    </span>
  );
}

/** Tarjeta de defecto (SPEC §4.1.6.1): qué falla, dónde mirar y qué hacer. */
export function TarjetaDefecto({ m }: { m: Motivo }) {
  const t = textoMotivo(m);
  const bloquea = m.severidad !== 'AVISO';
  return (
    <div className={`rounded-xl border-l-4 p-3 ${bloquea ? 'border-noconforme bg-noconforme-bg' : 'border-sustituir bg-sustituir-bg'}`}>
      <p className={`flex items-start gap-2 font-semibold ${bloquea ? 'text-noconforme' : 'text-sustituir'}`}>
        {bloquea ? <XCircle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />}
        {t.titulo}
      </p>
      {t.donde && <p className="ml-7 text-sm">Dónde mirar: {t.donde}</p>}
      {t.accion && <p className="ml-7 text-sm">Qué hacer: {t.accion}</p>}
      {m.severidad === 'BLOQUEANTE_DURO' && <p className="ml-7 text-xs font-semibold">No se puede forzar.</p>}
    </div>
  );
}

export function ListaMotivos({ motivos }: { motivos: Motivo[] }) {
  if (!motivos.length) return null;
  const orden = [...motivos].sort((a, b) => (a.severidad === 'AVISO' ? 1 : 0) - (b.severidad === 'AVISO' ? 1 : 0));
  return (
    <div className="flex flex-col gap-2">
      {orden.map((m, i) => (
        <TarjetaDefecto key={`${m.code}-${i}`} m={m} />
      ))}
    </div>
  );
}
