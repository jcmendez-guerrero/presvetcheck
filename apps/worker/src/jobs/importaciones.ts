import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { aplicarDatosCimavet, datosCimavetImportacion } from '@mmx/cimavet';
import { appendAudit, entradaImportada, importacion, salidaImportada } from '@mmx/db';
import { normalizeText } from '@mmx/shared';
import type { Contexto } from '../contexto';

const ACTOR = 'importaciones-corregir';
const igual = (a: string | null, b: string | null) => normalizeText(a ?? '').replace(/\s+/g, ' ').trim() === normalizeText(b ?? '').replace(/\s+/g, ' ').trim();

/**
 * Pone de acuerdo con CIMAVet las filas importadas: nombre, principio activo y forma según su código nacional o,
 * sin él, según el nombre si CIMAVet lo reconoce sin dudas (lo mismo que hace ya la importación).
 *
 * Las filas importadas son de solo inserción (trigger `mmx_importado_solo_insercion`): no se modifican. Por cada
 * importación con diferencias se crea una importación CORREGIDA (mismas filas, con los datos de CIMAVet; los datos
 * del propietario se copian cifrados tal cual) y se ANULA la original con el motivo. Todo queda auditado y la
 * original sigue guardada. Sin `--aplicar` solo informa (no escribe nada).
 *
 *   importaciones-corregir [--importacion <id>] [--aplicar]
 */
export async function corregirImportaciones(ctx: Contexto, args: Record<string, string>) {
  const aplicar = 'aplicar' in args;
  const todas = await ctx.db
    .select()
    .from(importacion)
    .where(and(isNull(importacion.anuladaAt), ...(args.importacion ? [eq(importacion.id, args.importacion)] : [])))
    .orderBy(asc(importacion.createdAt));
  const cimavet = datosCimavetImportacion(ctx.cimavet.repo);
  const informe = [];
  for (const imp of todas) {
    const tabla = imp.tipo === 'entradas' ? entradaImportada : salidaImportada;
    const filas = await ctx.db.select().from(tabla).where(eq(tabla.importacionId, imp.id)).orderBy(asc(tabla.fila));
    const cambios = { nombre: 0, principioActivo: 0, forma: 0 };
    const sinCn: number[] = [];
    const cnDesconocido: number[] = [];
    const sinIdentificar: number[] = [];
    const ejemplos: { fila: number; antes: string; despues: string }[] = [];
    const corregidas: (typeof filas)[number][] = [];
    for (const f of filas) {
      const c = f.cn ? await cimavet.cn(f.cn) : await cimavet.nombre(f.nombreFarmaco);
      if (!f.cn) sinCn.push(f.fila);
      if (f.cn && !c) cnDesconocido.push(f.fila);
      if (!f.cn && !c) sinIdentificar.push(f.fila);
      if (!c) {
        corregidas.push(f);
        continue;
      }
      const nueva = aplicarDatosCimavet(f, c);
      if (!igual(f.nombreFarmaco, nueva.nombreFarmaco)) cambios.nombre++;
      if (!igual(f.principioActivo, nueva.principioActivo)) cambios.principioActivo++;
      if (!igual(f.forma, nueva.forma)) cambios.forma++;
      if (ejemplos.length < 5 && (!igual(f.nombreFarmaco, nueva.nombreFarmaco) || !igual(f.principioActivo, nueva.principioActivo) || !igual(f.forma, nueva.forma)))
        ejemplos.push({ fila: f.fila, antes: `${f.nombreFarmaco} | ${f.principioActivo ?? ''} | ${f.forma ?? ''}`, despues: `${nueva.nombreFarmaco} | ${nueva.principioActivo ?? ''} | ${nueva.forma ?? ''}` });
      corregidas.push(nueva);
    }
    const conCambios = cambios.nombre + cambios.principioActivo + cambios.forma > 0;
    let corregida: string | null = null;
    if (aplicar && conCambios) {
      const ahora = new Date(ctx.clock.now().epochMilliseconds);
      corregida = await ctx.db.transaction(async (tx) => {
        const [n] = await tx
          .insert(importacion)
          .values({
            tipo: imp.tipo,
            fichero: `${imp.fichero} · corregida con CIMAVet`.slice(0, 200),
            sha256: createHash('sha256').update(`correccion-cimavet:${imp.id}`).digest('hex'),
            filas: corregidas.length,
            creadaPor: ACTOR,
            createdAt: ahora,
          })
          .returning();
        const copia = corregidas.map(({ id: _id, createdAt: _c, importacionId: _i, ...resto }) => ({ ...resto, importacionId: n!.id }));
        for (let i = 0; i < copia.length; i += 500) await tx.insert(tabla).values(copia.slice(i, i + 500) as never);
        await tx
          .update(importacion)
          .set({ anuladaAt: ahora, anuladaPor: ACTOR, motivoAnulacion: `Sustituida por la corrección con CIMAVet (importación ${n!.id})` })
          .where(eq(importacion.id, imp.id));
        await appendAudit(tx, { actor: ACTOR, accion: 'importacion_corregir_cimavet', entidad: 'importacion', entidadId: n!.id, despues: { original: imp.id, filas: copia.length, cambios } });
        await appendAudit(tx, { actor: ACTOR, accion: 'anular_importacion', entidad: 'importacion', entidadId: imp.id, despues: { motivo: 'Corrección con CIMAVet', sustituidaPor: n!.id } });
        return n!.id;
      });
    }
    informe.push({ importacion: imp.id, tipo: imp.tipo, filas: filas.length, cambios, sinCn: sinCn.length, cnDesconocido: cnDesconocido.length, sinIdentificar: sinIdentificar.length, ejemplos, corregida });
  }
  const r = { aplicado: aplicar, importaciones: informe };
  ctx.log('importaciones-corregir', r);
  return r;
}
