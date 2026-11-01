import type { SiwebClient } from './client';

export class AlmacenError extends Error {
  constructor(
    message: string,
    public readonly encontrados: { id: number; name: string }[],
  ) {
    super(message);
    this.name = 'AlmacenError';
  }
}

/**
 * Resuelve el almacén de medicamentos (D-12): `SIWEB_WAREHOUSE_ID` si está fijado; si no, el único
 * almacén cuyo nombre coincide con `SIWEB_WAREHOUSE_NAME` (por defecto "Farmacia"). Si no lo
 * encuentra o encuentra más de uno, lanza: en producción la app no arranca.
 */
export async function resolverAlmacen(
  client: SiwebClient,
  cfg: { nombre: string; id?: number | undefined },
): Promise<{ id: number; nombre: string }> {
  const todos = await client.warehouses();
  if (cfg.id !== undefined) {
    const w = todos.find((x) => x.id === cfg.id);
    if (!w)
      throw new AlmacenError(
        `No existe el almacén con id ${cfg.id} en Siweb360`,
        todos.map((x) => ({ id: x.id, name: x.name })),
      );
    return { id: w.id, nombre: w.name };
  }
  const norm = (s: string) => s.trim().toLocaleLowerCase('es');
  const coinciden = todos.filter((w) => norm(w.name) === norm(cfg.nombre));
  if (coinciden.length !== 1) {
    throw new AlmacenError(
      coinciden.length === 0
        ? `No se encuentra el almacén "${cfg.nombre}" en Siweb360`
        : `Hay ${coinciden.length} almacenes llamados "${cfg.nombre}" en Siweb360`,
      coinciden.map((x) => ({ id: x.id, name: x.name })),
    );
  }
  const w = coinciden[0]!;
  return { id: w.id, nombre: w.name };
}
