import type { Guion } from '../fake';
import { guionesUs1 } from './us1';
import { guionesUs2 } from './us2';
import { guionesUs3 } from './us3';

export { guionesUs1, primeraFuente } from './us1';
export { guionesUs2 } from './us2';
export { guionesUs3 } from './us3';

/** Guiones del modelo falso con ASSISTANT=fake (demo y smoke test). */
export function guionesDemo(anio?: number): Guion[] {
  return [...guionesUs2(), ...guionesUs3(), ...guionesUs1(anio)];
}
