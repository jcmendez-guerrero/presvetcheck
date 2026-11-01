import { Temporal } from '@js-temporal/polyfill';
import type { Plazo } from '@mmx/shared';

/** Fechas de negocio como texto ISO `AAAA-MM-DD` (fecha civil, sin hora). */
export type FechaIso = string;

export function fecha(iso: FechaIso): Temporal.PlainDate {
  return Temporal.PlainDate.from(iso);
}

/**
 * Suma un plazo. "Mes" = mes natural: `emisión + 1 mes`, ajustando a fin de mes
 * (31/01 + 1 mes = 28/02 o 29/02). SPEC §4.1.3.
 */
export function sumarPlazo(iso: FechaIso, plazo: Plazo): FechaIso {
  const d = fecha(iso);
  return (
    plazo.meses !== undefined ? d.add({ months: plazo.meses }) : d.add({ days: plazo.dias ?? 0 })
  ).toString();
}

export function sumarDias(iso: FechaIso, dias: number): FechaIso {
  return fecha(iso).add({ days: dias }).toString();
}

/** -1 si a < b, 0 si iguales, 1 si a > b. */
export function comparar(a: FechaIso, b: FechaIso): number {
  return Temporal.PlainDate.compare(fecha(a), fecha(b));
}

export function minFecha(a: FechaIso, b: FechaIso): FechaIso {
  return comparar(a, b) <= 0 ? a : b;
}

export function diasEntre(desde: FechaIso, hasta: FechaIso): number {
  return fecha(desde).until(fecha(hasta), { largestUnit: 'days' }).days;
}

/** dd/mm/aaaa para mensajes. */
export function fechaEs(iso: FechaIso): string {
  const d = fecha(iso);
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`;
}

/** Último día del mes (para caducidades GS1 con día 00). */
export function ultimoDiaMes(year: number, month: number): FechaIso {
  return Temporal.PlainDate.from({ year, month, day: 1 }).add({ months: 1 }).subtract({ days: 1 }).toString();
}
