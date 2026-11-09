import { useState } from 'react';
import { CheckCircle2, Copy, Pill, Repeat } from 'lucide-react';
import { copiarAlPortapapeles } from '../lib/portapapeles';

/** Banda ámbar fija de sustitución (SPEC §4.4.3). */
export function BandaSustitucion({ prescrito, sustituto }: { prescrito: string; sustituto: string }) {
  return (
    <div
      role="status"
      data-banda="sustitucion"
      className="sticky top-2 z-30 mb-4 rounded-2xl border-2 border-sustituir bg-sustituir-bg/95 p-4 text-sustituir shadow-md backdrop-blur-md transition-all"
    >
      <p className="flex items-center gap-2 text-lg font-bold">
        <Repeat aria-hidden className="h-6 w-6 shrink-0" />
        <span>SUSTITUCIÓN — avisar al tutor y al veterinario prescriptor</span>
      </p>
      <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-white/70 dark:bg-black/20 p-2.5">
          <strong className="block text-xs uppercase tracking-wide opacity-80">Prescrito:</strong>
          <span className="font-semibold text-base">{prescrito}</span>
        </div>
        <div className="rounded-xl bg-white/70 dark:bg-black/20 p-2.5">
          <strong className="block text-xs uppercase tracking-wide opacity-80">Se dispensa:</strong>
          <span className="font-semibold text-base text-marca-apoyo dark:text-acento">{sustituto}</span>
        </div>
      </div>
    </div>
  );
}

/** Banda morada de psicótropo (SPEC §4.1.5). */
export function BandaPsicotropo() {
  return (
    <div
      role="status"
      data-banda="psicotropo"
      className="sticky top-2 z-30 mb-4 rounded-2xl border-2 border-psicotropo bg-psicotropo-bg/95 p-4 font-bold text-psicotropo shadow-md backdrop-blur-md transition-all"
    >
      <p className="flex items-center gap-2 text-lg">
        <Pill aria-hidden className="h-6 w-6 shrink-0" />
        <span>
          PSICÓTROPO — un único envase por receta. Comprueba la identidad de quien lo retira y anota su DNI.
          La receta queda apartada.
        </span>
      </p>
    </div>
  );
}

/** Recordatorio fijo de cobro en el TPV con el lote (SPEC §5.2.4, D-02). */
export function RecordatorioTpv({ items }: { items: { cn: string; lote: string; unidades: number }[] }) {
  const [copiados, setCopiados] = useState<Record<string, boolean>>({});

  const copiar = async (lote: string) => {
    const ok = await copiarAlPortapapeles(lote);
    if (ok) {
      setCopiados((prev) => ({ ...prev, [lote]: true }));
      setTimeout(() => {
        setCopiados((prev) => ({ ...prev, [lote]: false }));
      }, 2000);
    }
  };

  return (
    <div
      className="rounded-2xl border-3 border-marca bg-pedir-bg/70 dark:bg-superficie p-5 shadow-sm transition-all"
      data-recordatorio="tpv"
    >
      <p className="text-xl font-bold text-marca dark:text-acento">Cobrar en el TPV seleccionando el lote</p>
      <p className="text-sm text-texto dark:text-slate-300 mt-0.5">
        El decremento de stock se realiza desde el ticket de Siweb360 con este número exacto.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {items.map((i) => {
          const copiado = !!copiados[i.lote];
          return (
            <div
              key={`${i.cn}-${i.lote}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white dark:bg-superficie-borde/20 p-3.5 shadow-xs ring-1 ring-black/5"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-3xl font-extrabold text-marca dark:text-acento">
                  {i.lote}
                </span>
                <span className="text-sm text-texto dark:text-slate-300">
                  Código nacional {i.cn} · <strong>{i.unidades}</strong> envase(s)
                </span>
              </div>

              <button
                type="button"
                onClick={() => void copiar(i.lote)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 font-semibold transition-all cursor-pointer ${
                  copiado
                    ? 'bg-dispensar-bg text-dispensar ring-2 ring-dispensar shadow-xs scale-102'
                    : 'bg-white text-marca ring-2 ring-marca hover:bg-pedir-bg dark:bg-superficie dark:text-acento dark:ring-acento'
                }`}
              >
                {copiado ? (
                  <>
                    <CheckCircle2 aria-hidden className="h-5 w-5 text-dispensar" />
                    <span>¡Lote copiado!</span>
                    <span role="status" aria-live="polite" className="sr-only">
                      Lote {i.lote} copiado al portapapeles para el TPV
                    </span>
                  </>
                ) : (
                  <>
                    <Copy aria-hidden className="h-4 w-4" />
                    <span>Copiar lote</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
