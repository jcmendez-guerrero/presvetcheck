/**
 * `Promise.all` con un máximo de tareas a la vez (llamadas a servicios externos sin saturarlos).
 * Devuelve los resultados en el mismo orden que la entrada.
 */
export async function enParalelo<T, R>(items: readonly T[], limite: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limite), items.length) }, trabajador));
  return out;
}
