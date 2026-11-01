/** Rango [desde 00:00, hasta+1 00:00) en Europe/Madrid → instantes UTC. */
export function rangoMadrid(desde: string, hasta: string): [Date, Date] {
  const aUtc = (iso: string) => {
    // Desfase de Madrid ese día (CET/CEST), calculado con Intl.
    const guess = new Date(`${iso}T00:00:00Z`);
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' }).formatToParts(guess).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
    const h = Number(/GMT([+-]\d+)/.exec(offset)?.[1] ?? 1);
    return new Date(guess.getTime() - h * 3600_000);
  };
  const fin = new Date(`${hasta}T00:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return [aUtc(desde), aUtc(fin.toISOString().slice(0, 10))];
}

/** Mes natural `YYYY-MM` de un instante en Europe/Madrid (consumo mensual del asistente). */
export function mesMadrid(instante: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).formatToParts(instante);
  return `${partes.find((p) => p.type === 'year')?.value}-${partes.find((p) => p.type === 'month')?.value}`;
}
