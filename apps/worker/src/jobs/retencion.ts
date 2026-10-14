import { and, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import { appendAudit, dispensacion, pedidoPendiente, propietario, receta } from '@mmx/db';
import type { Contexto } from '../contexto';

/**
 * Retención (SPEC §9.2, job mensual `retention-sweep`): pasados 5 años se anonimizan los datos personales
 * de recetas y propietarios. Los registros de salidas/entradas son append-only y no contienen datos
 * personales directos (el propietario está en su tabla cifrada). Las imágenes de Blob las elimina la
 * política de ciclo de vida/inmutabilidad (infra/), no la app.
 */
export async function retentionSweep(ctx: Contexto, args: Record<string, string>) {
  const anios = Number(args.anios ?? 5);
  const limite = new Date(ctx.clock.now().epochMilliseconds);
  limite.setUTCFullYear(limite.getUTCFullYear() - anios);
  return ctx.db.transaction(async (tx) => {
    const recetas = await tx
      .update(receta)
      .set({ extraccion: null, confirmacion: sql`case when ${receta.confirmacion} is null then null else jsonb_set(${receta.confirmacion}, '{titular}', '{"nombre": null, "telefono": null}'::jsonb) end`, animalIdentificacion: null, rega: null })
      .where(and(lt(receta.createdAt, limite), isNotNull(receta.confirmacion)))
      .returning({ id: receta.id });
    // Propietarios sin dispensaciones recientes: se vacían sus datos (la fila se conserva por la FK).
    const recientes = tx.select({ id: dispensacion.propietarioId }).from(dispensacion).where(and(isNotNull(dispensacion.propietarioId), sql`${dispensacion.fechaVenta} >= ${limite.toISOString()}::timestamptz`));
    const props = await tx
      .update(propietario)
      .set({ nombreEnc: null, movilEnc: null, dniEnc: null, direccionEnc: null, dniHash: null })
      .where(and(lt(propietario.createdAt, limite), notInArray(propietario.id, sql`(${recientes})`), isNotNull(propietario.nombreEnc)))
      .returning({ id: propietario.id });
    await tx.update(pedidoPendiente).set({ contactoTutorEnc: null }).where(and(lt(pedidoPendiente.createdAt, limite), isNotNull(pedidoPendiente.contactoTutorEnc)));
    await appendAudit(tx, { actor: 'retention-sweep', accion: 'retencion_anonimizar', entidad: 'sistema', entidadId: null, despues: { recetas: recetas.length, propietarios: props.length, limite: limite.toISOString() } });
      return { recetasAnonimizadas: recetas.length, propietariosAnonimizados: props.length, limite: limite.toISOString().slice(0, 10) };
  });
}
