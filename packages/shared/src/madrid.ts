/** Rango [desde 00:00, hasta+1 00:00) en Europe/Madrid → instantes UTC. */
export function rangoMadrid(desde: string, hasta: string): [Date, Date] {
  const aUtc = (iso: string) => {
    // Desfase de Madrid ese día (CET/CEST), calculado con Intl.
    const guess = new Date(`${iso}T00:00:00Z`);
    const offset =
      new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' })
        .formatToParts(guess)
        .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
    const h = Number(/GMT([+-]\d+)/.exec(offset)?.[1] ?? 1);
    return new Date(guess.getTime() - h * 3600_000);
  };
  const fin = new Date(`${hasta}T00:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return [aUtc(desde), aUtc(fin.toISOString().slice(0, 10))];
}

/** Mes natural `YYYY-MM` de un instante en Europe/Madrid (consumo mensual del asistente). */
export function mesMadrid(instante: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instante);
  return `${partes.find((p) => p.type === 'year')?.value}-${partes.find((p) => p.type === 'month')?.value}`;
}

/** Día natural `YYYY-MM-DD` de un instante en Europe/Madrid. */
export function diaMadrid(instante: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(instante);
}

function desfaseMadridH(instante: Date): number {
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' })
      .formatToParts(instante)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  return Number(/GMT([+-]\d+)/.exec(offset)?.[1] ?? 1);
}

/**
 * Hora local de Madrid sin zona horaria (como la devuelve Siweb360: "2026-10-28T09:41:12.000") → instante UTC.
 * Si el texto ya trae zona (`Z`, `+01:00`), se respeta.
 */
export function horaMadridAUtc(local: string): Date {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(local)) return new Date(local);
  const comoUtc = new Date(`${local.length === 10 ? `${local}T00:00:00` : local}Z`);
  // Dos pasadas para acertar el desfase cerca del cambio de hora.
  const primera = new Date(comoUtc.getTime() - desfaseMadridH(comoUtc) * 3600_000);
  return new Date(comoUtc.getTime() - desfaseMadridH(primera) * 3600_000);
}
