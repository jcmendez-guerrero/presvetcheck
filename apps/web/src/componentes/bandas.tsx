import { Copy, Pill, Repeat } from 'lucide-react';

/** Banda ámbar fija de sustitución (SPEC §4.4.3). */
export function BandaSustitucion({ prescrito, sustituto }: { prescrito: string; sustituto: string }) {
  return (
    <div role="status" data-banda="sustitucion" className="sticky top-0 z-30 border-y-4 border-sustituir bg-sustituir-bg px-4 py-3 text-sustituir">
      <p className="flex items-center gap-2 text-lg font-bold">
        <Repeat aria-hidden className="h-6 w-6" /> SUSTITUCIÓN — avisar al tutor y al veterinario prescriptor
      </p>
      <div className="mt-1 grid gap-2 text-sm sm:grid-cols-2">
        <p>
          <strong>Prescrito:</strong> {prescrito}
        </p>
        <p>
          <strong>Se dispensa:</strong> <mark className="bg-dorado/40">{sustituto}</mark>
        </p>
      </div>
    </div>
  );
}

/** Banda morada de psicótropo (SPEC §4.1.5). */
export function BandaPsicotropo() {
  return (
    <div role="status" data-banda="psicotropo" className="sticky top-0 z-30 border-y-4 border-psicotropo bg-psicotropo-bg px-4 py-3 font-bold text-psicotropo">
      <p className="flex items-center gap-2 text-lg">
        <Pill aria-hidden className="h-6 w-6" /> PSICÓTROPO — un único envase por receta. Comprueba la identidad de quien lo retira y anota su DNI. La receta queda apartada.
      </p>
    </div>
  );
}

/** Recordatorio fijo de cobro en el TPV con el lote (SPEC §5.2.4, D-02). */
export function RecordatorioTpv({ items }: { items: { cn: string; lote: string; unidades: number }[] }) {
  return (
    <div className="rounded-2xl border-4 border-marca bg-pedir-bg p-5" data-recordatorio="tpv">
      <p className="text-xl font-bold text-marca">Cobrar en el TPV seleccionando el lote</p>
      {items.map((i) => (
        <div key={`${i.cn}-${i.lote}`} className="mt-3 flex flex-wrap items-center gap-4">
          <span className="font-mono text-3xl font-bold">{i.lote}</span>
          <span>Código nacional {i.cn} · {i.unidades} envase(s)</span>
          <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 font-semibold text-marca ring-1 ring-marca" onClick={() => void navigator.clipboard?.writeText(i.lote)}>
            <Copy aria-hidden className="h-4 w-4" /> Copiar lote
          </button>
        </div>
      ))}
    </div>
  );
}
