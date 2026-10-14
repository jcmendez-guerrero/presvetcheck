import { Temporal } from '@js-temporal/polyfill';

/** Zona horaria de todas las reglas de negocio (AGENTS.md). */
export const ZONA_NEGOCIO = 'Europe/Madrid';

/** Reloj inyectado: el dominio nunca lee la hora del sistema. */
export interface Clock {
  now(): Temporal.Instant;
}

/** Reloj fijo para tests y reevaluaciones. */
export function fixedClock(iso: string): Clock {
  const instant = Temporal.Instant.from(iso);
  return { now: () => instant };
}

/** Fecha de hoy (AAAA-MM-DD) en Europe/Madrid. */
export function hoy(clock: Clock): string {
  return clock.now().toZonedDateTimeISO(ZONA_NEGOCIO).toPlainDate().toString();
}

/** Instante actual como ISO UTC. */
export function ahoraIso(clock: Clock): string {
  return clock.now().toString();
}
