import { useEffect, useRef, type RefObject } from 'react';

const SELECTOR_ELEMENTOS_ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Hook accesible de atrapamiento de foco para modales, cajones y diálogos emergentes (WAI-ARIA Dialog).
 * - Mantiene el foco dentro del contenedor al pulsar Tab y Shift+Tab.
 * - Cierra el diálogo al pulsar la tecla Escape.
 * - Restaura automáticamente el foco en el elemento que abrió el diálogo al desmontarse/cerrarse.
 */
export function useFocusTrap(
  contenedorRef: RefObject<HTMLElement | null>,
  activo: boolean,
  alCerrar?: () => void,
) {
  const elementoPrevioRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!activo || !contenedorRef.current) return;

    // Almacenar el elemento que tenía el foco antes de abrir
    elementoPrevioRef.current = document.activeElement as HTMLElement | null;

    const contenedor = contenedorRef.current;
    const enfocarPrimero = () => {
      const elementos = contenedor.querySelectorAll<HTMLElement>(SELECTOR_ELEMENTOS_ENFOCABLES);
      if (elementos.length > 0) {
        elementos[0]?.focus();
      } else {
        contenedor.setAttribute('tabindex', '-1');
        contenedor.focus();
      }
    };

    // Enfocar con pequeño retardo para permitir la renderización completa
    const timer = setTimeout(enfocarPrimero, 10);

    const manejarTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && alCerrar) {
        e.preventDefault();
        alCerrar();
        return;
      }

      if (e.key === 'Tab') {
        const elementos = Array.from(contenedor.querySelectorAll<HTMLElement>(SELECTOR_ELEMENTOS_ENFOCABLES));
        if (elementos.length === 0) {
          e.preventDefault();
          return;
        }

        const primero = elementos[0]!;
        const ultimo = elementos[elementos.length - 1]!;

        if (e.shiftKey && document.activeElement === primero) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    };

    document.addEventListener('keydown', manejarTeclado);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', manejarTeclado);
      // Restituir el foco de forma limpia
      elementoPrevioRef.current?.focus?.();
    };
  }, [activo, alCerrar, contenedorRef]);
}
