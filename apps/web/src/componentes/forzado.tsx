import { useState } from 'react';
import type { CodigoIncidencia } from '@mmx/shared';
import { textoDefecto } from '@mmx/shared';
import { Boton } from './ui';

export interface SolicitudForzado {
  codigos: CodigoIncidencia[];
  motivo: string;
  aceptaRiesgos: boolean;
}

/**
 * Ventana de forzado (SPEC §4.1.6.3): lista los defectos, exige la casilla de responsabilidad y un motivo
 * de al menos 15 caracteres. El botón de confirmar no es el principal. La API vuelve a validarlo todo.
 */
export function ModalForzado({ codigos, onCancelar, onConfirmar, usuario }: { codigos: CodigoIncidencia[]; onCancelar: () => void; onConfirmar: (s: SolicitudForzado) => void; usuario: string }) {
  const [acepta, setAcepta] = useState(false);
  const [motivo, setMotivo] = useState('');
  const ok = acepta && motivo.trim().length >= 15;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="titulo-forzado" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6">
        <h2 id="titulo-forzado" className="text-2xl font-bold text-noconforme">
          Dispensar igualmente
        </h2>
        <p className="mt-2">La receta no cumple estos requisitos:</p>
        <ul className="mt-2 list-disc pl-6">
          {codigos.map((c) => (
            <li key={c} className="font-semibold text-noconforme">
              {textoDefecto(c, { fecha: '(ver envase)', linea: '' }).titulo}
            </li>
          ))}
        </ul>
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-6 w-6" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
          <span>Entiendo los riesgos de dispensar una receta que no cumple los requisitos y asumo la responsabilidad</span>
        </label>
        <label className="mt-4 flex flex-col gap-1">
          <span className="font-medium">Motivo (mínimo 15 caracteres)</span>
          <textarea className="min-h-24 rounded-lg border border-slate-300 p-2" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <span className="text-xs text-slate-600">{motivo.trim().length}/15 · Se registrará a nombre de {usuario} y lo revisará el farmacéutico garante.</span>
        </label>
        <div className="mt-6 flex flex-wrap justify-between gap-3">
          <Boton onClick={onCancelar}>Cancelar y no dispensar</Boton>
          <Boton variante="peligro" disabled={!ok} onClick={() => onConfirmar({ codigos, motivo, aceptaRiesgos: acepta })}>
            Confirmar el forzado
          </Boton>
        </div>
      </div>
    </div>
  );
}
