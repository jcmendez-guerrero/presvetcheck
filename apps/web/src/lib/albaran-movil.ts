/**
 * Lógica pura del albarán que llega del móvil (spec 013), separada de React para poder probarla.
 * La usan `lib/movil.tsx` (el reparto de lo que llega) y `paginas/recepciones.tsx` (la pregunta al sustituir).
 */

/**
 * Reparte los albaranes que llegan del móvil: si hay una pantalla de recepción abierta (suscriptor) se le entrega
 * el id; si no, queda pendiente y se entrega a la primera que se abra (así no se pierde si la persona llega por el
 * menú y no por el botón del aviso).
 */
export class BuzonAlbaranes {
  private readonly oyentes = new Set<(documentoId: string) => void>();
  private pendiente: string | null = null;

  /** Devuelve `entregado` si algún suscriptor lo recibió, o `pendiente` si queda esperando. */
  recibir(documentoId: string): 'entregado' | 'pendiente' {
    if (this.oyentes.size) {
      this.oyentes.forEach((f) => f(documentoId));
      return 'entregado';
    }
    this.pendiente = documentoId;
    return 'pendiente';
  }

  /** Suscribe una pantalla; si había un albarán esperando, se le entrega ya. Devuelve la baja. */
  suscribir(fn: (documentoId: string) => void): () => void {
    this.oyentes.add(fn);
    const esperando = this.pendiente;
    this.pendiente = null;
    if (esperando) fn(esperando);
    return () => void this.oyentes.delete(fn);
  }

  descartar(): void {
    this.pendiente = null;
  }
}

/**
 * Qué preguntar antes de cargar un albarán del móvil en la pantalla de nueva recepción: `null` si se puede cargar
 * sin preguntar. Pregunta si ya hay un albarán leído sin guardar o si la persona está escribiendo a mano la
 * cabecera (no se le pisa lo escrito sin avisar).
 */
export function preguntaAlSustituir(c: {
  hayLectura: boolean;
  modo: 'elegir' | 'albaran' | 'manual';
  distribuidor: string;
  albaran: string;
}): string | null {
  if (c.hayLectura) return '¿Sustituir el albarán leído por el que acaba de llegar del móvil?';
  if (c.modo === 'manual' && (c.distribuidor.trim() !== '' || c.albaran.trim() !== ''))
    return '¿Sustituir lo que has escrito por el albarán que acaba de llegar del móvil?';
  return null;
}
