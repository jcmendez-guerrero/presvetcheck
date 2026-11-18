import { and, eq, ne } from 'drizzle-orm';
import { appendAudit, distribuidor, type Db } from '@mmx/db';
import { normalizarCif } from '@mmx/domain';
import { DomainError } from '@mmx/shared';
import { HttpError } from '@mmx/shared/node';
import type { SiwebClient } from './client';

/**
 * Resolución del contacto proveedor de Siweb360 que corresponde al distribuidor de una recepción (specs/016,
 * research D3). La lista de contactos de Siweb360 no devuelve CIF ni filtra por CIF; solo el detalle del contacto
 * y la lista de proveedores de un producto lo traen. Por eso, en este orden:
 *  1. el contacto ya recordado en el distribuidor;
 *  2. entre los proveedores ya vinculados al producto, el de mismo CIF;
 *  3. los proveedores con nombre parecido (máx. 10), comparando el CIF de su detalle.
 * Con exactamente una coincidencia se recuerda en el distribuidor. Nunca se adivina ni se crea un proveedor.
 */
export type MotivoProveedor =
  'SIN_CIF' | 'SIN_COINCIDENCIA' | 'VARIAS_COINCIDENCIAS' | 'PROVEEDOR_INEXISTENTE';

export type ResultadoProveedor =
  { contactId: number; origen: 'recordado' | 'producto' | 'busqueda' } | { motivo: MotivoProveedor };

export const MAX_CANDIDATOS_PROVEEDOR = 10;

export async function resolverProveedor(
  deps: { db: Db; client: SiwebClient },
  distribuidorId: string,
  productId: number,
): Promise<ResultadoProveedor> {
  const [d] = await deps.db.select().from(distribuidor).where(eq(distribuidor.id, distribuidorId));
  if (!d) return { motivo: 'SIN_COINCIDENCIA' };
  if (d.siwebContactId !== null) return { contactId: d.siwebContactId, origen: 'recordado' };

  const cif = normalizarCif(d.cif);
  if (!cif) return { motivo: 'SIN_CIF' };

  const recordar = async (
    contactId: number,
    origen: 'producto' | 'busqueda',
  ): Promise<ResultadoProveedor> => {
    await deps.db
      .update(distribuidor)
      .set({ siwebContactId: contactId })
      .where(eq(distribuidor.id, distribuidorId));
    return { contactId, origen };
  };

  // 2. Proveedores ya vinculados a este producto (devuelven `supplier_cif`).
  const vinculados = await deps.client.proveedoresDeProducto(productId);
  const delProducto = [
    ...new Set(vinculados.filter((p) => normalizarCif(p.supplier_cif) === cif).map((p) => p.contact_id)),
  ];
  if (delProducto.length === 1) return recordar(delProducto[0] as number, 'producto');
  if (delProducto.length > 1) return { motivo: 'VARIAS_COINCIDENCIAS' };

  // 3. Búsqueda por nombre y comparación del CIF del detalle de cada candidato.
  const candidatos = (await deps.client.buscarProveedoresPorNombre(d.nombre, MAX_CANDIDATOS_PROVEEDOR)).slice(
    0,
    MAX_CANDIDATOS_PROVEEDOR,
  );
  const coinciden: number[] = [];
  for (const c of candidatos) {
    const detalle = await deps.client.contacto(c.id);
    if (normalizarCif(detalle.cif) === cif) coinciden.push(c.id);
  }
  if (coinciden.length === 1) return recordar(coinciden[0] as number, 'busqueda');
  return { motivo: coinciden.length === 0 ? 'SIN_COINCIDENCIA' : 'VARIAS_COINCIDENCIAS' };
}

export interface VincularProveedorDeps {
  db: Db;
  client: SiwebClient;
  /** Reactiva los costes de proveedor pendientes del distribuidor (`OutboxService.reactivarCosteProveedor`). */
  reactivar: (distribuidorId: string, actor: string) => Promise<number>;
}

/**
 * Vincula a mano el contacto proveedor de Siweb360 a un distribuidor (administración, specs/016): comprueba que el
 * contacto existe, que su CIF coincide con el del distribuidor (si no, hace falta confirmarlo) y que no está ya
 * vinculado a otro distribuidor; lo guarda, deja auditoría y reactiva los costes pendientes de ese distribuidor.
 */
export async function vincularProveedorSiweb(
  deps: VincularProveedorDeps,
  p: { distribuidorId: string; contactId: number; confirmarCifDistinto?: boolean; actor: string },
): Promise<{ reactivadas: number }> {
  const [d] = await deps.db.select().from(distribuidor).where(eq(distribuidor.id, p.distribuidorId));
  if (!d) throw new DomainError('NO_ENCONTRADO', 'Distribuidor no encontrado');
  let contacto;
  try {
    contacto = await deps.client.contacto(p.contactId);
  } catch (e) {
    if (e instanceof HttpError && e.kind === 'HTTP' && e.status === 404)
      throw new DomainError('SIWEB_PROVEEDOR_NO_EXISTE');
    throw e;
  }
  const cifDistribuidor = normalizarCif(d.cif);
  const cifContacto = normalizarCif(contacto.cif);
  if (cifDistribuidor !== cifContacto && !p.confirmarCifDistinto)
    throw new DomainError('SIWEB_PROVEEDOR_CIF_DISTINTO', undefined, {
      cifDistribuidor: d.cif ?? null,
      cifProveedor: contacto.cif ?? null,
    });
  const [otro] = await deps.db
    .select({ id: distribuidor.id })
    .from(distribuidor)
    .where(and(eq(distribuidor.siwebContactId, p.contactId), ne(distribuidor.id, d.id)))
    .limit(1);
  if (otro) throw new DomainError('SIWEB_PROVEEDOR_YA_VINCULADO');
  await deps.db.transaction(async (tx) => {
    await tx.update(distribuidor).set({ siwebContactId: p.contactId }).where(eq(distribuidor.id, d.id));
    await appendAudit(tx, {
      actor: p.actor,
      accion: 'distribuidor_vincular_siweb',
      entidad: 'distribuidor',
      entidadId: d.id,
      antes: { siwebContactId: d.siwebContactId },
      despues: { siwebContactId: p.contactId, cifConfirmado: cifDistribuidor !== cifContacto },
    });
  });
  return { reactivadas: await deps.reactivar(d.id, p.actor) };
}
