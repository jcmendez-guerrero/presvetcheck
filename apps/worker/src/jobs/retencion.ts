import { and, eq, inArray, isNull, lt, notExists, sql } from 'drizzle-orm';
import {
  appendAudit,
  asistenteConversacion,
  asistenteIntercambio,
  discrepancia,
  dispensacion,
  entradaImportada,
  importacion,
  salidaImportada,
  outbox,
  pedidoPendiente,
  propietario,
  receta,
  recetaImagen,
  recetaLinea,
  recepcion,
  recepcionAjuste,
  recepcionLinea,
  reportRun,
  sustitucion,
} from '@mmx/db';
import type { Contexto } from '../contexto';

/**
 * Retención (SPEC §9.2, job mensual `retention-sweep`; DUDA-24 resuelta): pasados 5 años los datos SE
 * ELIMINAN — dispensaciones (registro de salidas), recetas con sus líneas, imágenes y sustituciones,
 * propietarios, recepciones (registro de entradas), pedidos, outbox cerrado, discrepancias resueltas y
 * reportes. Las conversaciones del asistente de consultas se eliminan al año (FR-023a), antes y por separado.
 * El borrado en las tablas de solo inserción solo lo admite la base de datos con la marca de
 * purga de la sesión y para filas de más de 5 años (migración 0004). El rastro de auditoría no contiene
 * datos personales y se conserva. Nunca se borra con menos de 5 años, aunque se pida.
 */
export async function retentionSweep(ctx: Contexto, args: Record<string, string>) {
  const anios = Math.max(5, Number(args.anios ?? 5));
  const limite = new Date(ctx.clock.now().epochMilliseconds);
  limite.setUTCFullYear(limite.getUTCFullYear() - anios);
  const lim = sql`${limite.toISOString()}::timestamptz`;
  const blobs: { c: 'recetas' | 'reportes'; path: string }[] = [];

  const res = await ctx.db.transaction(async (tx) => {
    // Marca de purga de la sesión (las tablas con guarda la exigen además de los 5 años).
    await tx.execute(sql`set local mmx.purga_retencion = 'on'`);

    // 0. Asistente de consultas: conversaciones de más de 1 año con sus intercambios y valoraciones (en cascada).
    // Se aplaza la conversación que aún tenga algún intercambio de menos de 1 año (el trigger de solo inserción
    // no deja borrarlo). Va antes que las recetas: una conversación sobre una línea impediría borrarla.
    const limiteAsistente = new Date(ctx.clock.now().epochMilliseconds);
    limiteAsistente.setUTCFullYear(limiteAsistente.getUTCFullYear() - 1);
    const recientes = tx
      .select({ x: sql`1` })
      .from(asistenteIntercambio)
      .where(and(eq(asistenteIntercambio.conversacionId, asistenteConversacion.id), sql`${asistenteIntercambio.createdAt} >= ${limiteAsistente.toISOString()}::timestamptz`));
    const conversaciones = await tx
      .delete(asistenteConversacion)
      .where(and(lt(asistenteConversacion.createdAt, limiteAsistente), notExists(recientes)))
      .returning({ id: asistenteConversacion.id });

    // 1. Registros de solo inserción (salidas y ajustes de entrada): función de la BD con permisos propios.
    const reg = await tx.execute(sql`select mmx_purgar_registros(${lim}) as r`);
    const filas = (Array.isArray(reg) ? reg : (reg as { rows: unknown[] }).rows) as Array<{ r: { dispensaciones: number; ajustes: number } }>;
    const purgados = filas[0]?.r ?? { dispensaciones: 0, ajustes: 0 };

    // 2. Recetas antiguas sin dispensaciones restantes, con todo lo que cuelga de ellas.
    const conDisp = tx.select({ x: sql`1` }).from(dispensacion).where(eq(dispensacion.recetaId, receta.id));
    // Y sin conversaciones del asistente sobre alguna de sus líneas (las de menos de 1 año se conservan).
    const conAsistente = tx
      .select({ x: sql`1` })
      .from(asistenteConversacion)
      .innerJoin(recetaLinea, eq(recetaLinea.id, asistenteConversacion.recetaLineaId))
      .where(eq(recetaLinea.recetaId, receta.id));
    const recetas = (await tx.select({ id: receta.id }).from(receta).where(and(lt(receta.createdAt, limite), notExists(conDisp), notExists(conAsistente)))).map((r) => r.id);
    if (recetas.length) {
      const lineas = (await tx.select({ id: recetaLinea.id }).from(recetaLinea).where(inArray(recetaLinea.recetaId, recetas))).map((l) => l.id);
      if (lineas.length) {
        await tx.delete(sustitucion).where(inArray(sustitucion.recetaLineaId, lineas));
        await tx.delete(pedidoPendiente).where(inArray(pedidoPendiente.recetaLineaId, lineas));
        await tx.delete(recetaLinea).where(inArray(recetaLinea.id, lineas));
      }
      const imgs = await tx.delete(recetaImagen).where(inArray(recetaImagen.recetaId, recetas)).returning({ path: recetaImagen.blobPath });
      blobs.push(...imgs.map((i) => ({ c: 'recetas' as const, path: i.path.replace(/^recetas\//, '') })));
      await tx.delete(receta).where(inArray(receta.id, recetas));
    }

    // 3. Propietarios antiguos ya sin dispensaciones ni recetas.
    const usadoD = tx.select({ x: sql`1` }).from(dispensacion).where(eq(dispensacion.propietarioId, propietario.id));
    const usadoR = tx.select({ x: sql`1` }).from(receta).where(eq(receta.propietarioId, propietario.id));
    const props = await tx
      .delete(propietario)
      .where(and(lt(propietario.createdAt, limite), notExists(usadoD), notExists(usadoR)))
      .returning({ id: propietario.id });

    // 4. Entradas: recepciones antiguas cuyas líneas ya no tienen ajustes (los recientes se conservan).
    const ajusteVivo = tx
      .select({ x: sql`1` })
      .from(recepcionAjuste)
      .innerJoin(recepcionLinea, eq(recepcionLinea.id, recepcionAjuste.recepcionLineaId))
      .where(eq(recepcionLinea.recepcionId, recepcion.id));
    const recs = (await tx.select({ id: recepcion.id }).from(recepcion).where(and(lt(recepcion.createdAt, limite), notExists(ajusteVivo)))).map((r) => r.id);
    if (recs.length) {
      await tx.delete(recepcionLinea).where(inArray(recepcionLinea.recepcionId, recs));
      await tx.delete(recepcion).where(inArray(recepcion.id, recs));
    }

    // 4b. Registros anteriores importados: por la fecha del movimiento (el trigger lo exige con la marca de
    // purga); después, las importaciones que se han quedado sin filas.
    const dia = limite.toISOString().slice(0, 10);
    const entImp = await tx.delete(entradaImportada).where(lt(entradaImportada.fecha, dia)).returning({ id: entradaImportada.id });
    const salImp = await tx.delete(salidaImportada).where(lt(salidaImportada.fecha, dia)).returning({ id: salidaImportada.id });
    const conFilas = sql`exists (select 1 from entrada_importada e where e.importacion_id = ${importacion.id}) or exists (select 1 from salida_importada s where s.importacion_id = ${importacion.id})`;
    await tx.delete(importacion).where(and(lt(importacion.createdAt, limite), sql`not (${conFilas})`));

    // 5. Resto: pedidos sin línea, outbox cerrado, discrepancias y reportes.
    await tx.delete(pedidoPendiente).where(and(lt(pedidoPendiente.createdAt, limite), isNull(pedidoPendiente.recetaLineaId)));
    await tx.delete(outbox).where(and(lt(outbox.createdAt, limite), inArray(outbox.status, ['sent', 'failed'])));
    await tx.delete(discrepancia).where(lt(discrepancia.createdAt, limite));
    const reps = await tx.delete(reportRun).where(lt(reportRun.generadoAt, limite)).returning({ path: reportRun.blobPath });
    blobs.push(...reps.filter((r) => r.path).map((r) => ({ c: 'reportes' as const, path: (r.path as string).replace(/^reportes\//, '') })));

    const resumen = { dispensaciones: purgados.dispensaciones, ajustesEntrada: purgados.ajustes, recetas: recetas.length, propietarios: props.length, recepciones: recs.length, reportes: reps.length, importadas: entImp.length + salImp.length, conversacionesAsistente: conversaciones.length };
    await appendAudit(tx, { actor: 'retention-sweep', accion: 'retencion_eliminar', entidad: 'sistema', entidadId: null, despues: { ...resumen, limite: limite.toISOString() } });
    return resumen;
  });

  // Ficheros en Blob tras confirmar el borrado en BD (el ciclo de vida de Blob los borra también).
  let blobsBorrados = 0;
  for (const b of blobs) {
    try {
      if (await ctx.blob.delete(b.c, b.path)) blobsBorrados++;
    } catch (e) {
      ctx.log('retention-sweep: no se pudo borrar un fichero (lo hará el ciclo de vida de Blob)', { contenedor: b.c, error: (e as Error).message });
    }
  }
  return { ...res, blobsBorrados, limite: limite.toISOString().slice(0, 10) };
}
