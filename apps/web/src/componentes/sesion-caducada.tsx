import { useId, useRef } from 'react';
import { useFocusTrap } from '../lib/a11y';
import { useAuth } from '../lib/auth';
import { Boton } from './ui';

/** Aviso bloqueante cuando la sesión caduca mientras se trabaja; no se redirige sin avisar (FR-007). */
export function SesionCaducada() {
  const { iniciarSesion } = useAuth();
  const dialogo = useRef<HTMLDivElement>(null);
  const titulo = useId();
  // Sin alCerrar: Escape no cierra el aviso.
  useFocusTrap(dialogo, true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div
        ref={dialogo}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titulo}
        className="flex max-w-md flex-col gap-4 rounded-2xl bg-white p-6 text-texto shadow-xl dark:bg-superficie"
      >
        <h2 id={titulo} className="text-xl font-extrabold text-marca dark:text-acento">
          Tu sesión ha caducado
        </h2>
        <p>Los cambios sin guardar de esta pantalla se pueden perder.</p>
        <Boton onClick={iniciarSesion}>Volver a iniciar sesión</Boton>
      </div>
    </div>
  );
}
