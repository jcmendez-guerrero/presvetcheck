import { describe, expect, it } from 'vitest';
import { enParalelo } from '../src/concurrencia';

describe('enParalelo', () => {
  it('respeta el límite de tareas simultáneas y conserva el orden', async () => {
    let activas = 0;
    let maximo = 0;
    const r = await enParalelo([5, 1, 4, 2, 3, 0], 2, async (n) => {
      activas++;
      maximo = Math.max(maximo, activas);
      await new Promise((ok) => setTimeout(ok, n));
      activas--;
      return n * 10;
    });
    expect(r).toEqual([50, 10, 40, 20, 30, 0]);
    expect(maximo).toBe(2);
  });
  it('lista vacía', async () => {
    expect(await enParalelo([], 4, async () => 1)).toEqual([]);
  });
});
