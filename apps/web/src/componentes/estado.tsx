import { AlertTriangle, CheckCircle2, Clock, Package, Repeat, ShieldAlert, XCircle } from 'lucide-react';
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
  const d = DECISION[decision] ?? {
    texto: decision,
    clase: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  };
  const I = ICONO[decision as keyof typeof ICONO] ?? AlertTriangle;
  return (
    <span
      data-decision={decision}
      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-bold shadow-xs ring-1 ring-black/5 dark:ring-white/10 ${d.clase} ${
        grande ? 'text-lg px-4 py-2' : 'text-sm'
      }`}
    >
      <I aria-hidden className={grande ? 'h-6 w-6' : 'h-4 w-4'} />
      <span>{d.texto}</span>
    </span>
  );
}

/** Tarjeta de defecto (SPEC §4.1.6.1): qué falla, dónde mirar y qué hacer. */
export function TarjetaDefecto({ m }: { m: Motivo }) {
  const t = textoMotivo(m);
  const esDuro = m.severidad === 'BLOQUEANTE_DURO';
  const bloquea = m.severidad !== 'AVISO';

  return (
    <div
      role="alert"
      className={`rounded-xl border-l-4 p-4 shadow-xs transition-all dark:bg-superficie ${
        esDuro
          ? 'border-noconforme bg-noconforme-bg/80 dark:bg-noconforme-bg/20 ring-1 ring-noconforme/30'
          : bloquea
            ? 'border-noconforme bg-noconforme-bg dark:bg-noconforme-bg/20'
            : 'border-sustituir bg-sustituir-bg dark:bg-sustituir-bg/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={`flex items-start gap-2 text-base font-bold ${
            bloquea ? 'text-noconforme' : 'text-sustituir'
          }`}
        >
          {esDuro ? (
            <ShieldAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
          ) : bloquea ? (
            <XCircle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <span>{t.titulo}</span>
        </p>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide ${
            esDuro
              ? 'bg-noconforme text-white'
              : bloquea
                ? 'bg-noconforme/20 text-noconforme'
                : 'bg-sustituir/20 text-sustituir'
          }`}
        >
          {esDuro ? 'Bloqueante Duro' : bloquea ? 'Bloqueante' : 'Aviso'}
        </span>
      </div>

      <div className="mt-2 space-y-1 text-sm text-texto dark:text-slate-200 pl-7">
        {t.donde && (
          <p>
            <strong className="text-marca-apoyo dark:text-acento">Dónde mirar:</strong> {t.donde}
          </p>
        )}
        {t.accion && (
          <p>
            <strong className="text-marca-apoyo dark:text-acento">Qué hacer:</strong> {t.accion}
          </p>
        )}
        {esDuro && (
          <p className="text-xs font-bold text-noconforme mt-1">
            ⚠️ No se puede forzar bajo ninguna circunstancia (Principio III de la Constitución).
          </p>
        )}
      </div>
    </div>
  );
}

export function ListaMotivos({ motivos }: { motivos: Motivo[] }) {
  if (!motivos.length) return null;
  const orden = [...motivos].sort(
    (a, b) => (a.severidad === 'AVISO' ? 1 : 0) - (b.severidad === 'AVISO' ? 1 : 0),
  );
  return (
    <div className="flex flex-col gap-2.5">
      {orden.map((m, i) => (
        <TarjetaDefecto key={`${m.code}-${i}`} m={m} />
      ))}
    </div>
  );
}
