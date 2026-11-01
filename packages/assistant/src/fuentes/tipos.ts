import type { FuenteCitada } from '@mmx/shared';

/** Acceso a las fuentes de referencia (guía de la receta, Ayuda) para abrir lo que el asistente cita (FR-007). */
export interface FuentesReferencia {
  /** Versión conjunta (`guia@hash8+ayuda@hash8`) que se guarda en cada intercambio. */
  version(): string;
  /** Fragmento actual de una fuente `guia:` o `ayuda:`; null si no existe. */
  abrir(fuenteId: string): { fuente: FuenteCitada; contenido: string } | null;
}
