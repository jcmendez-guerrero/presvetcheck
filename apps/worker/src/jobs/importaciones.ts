import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { MAESTRA, appendAudit, entradaImportada, importacion, salidaImportada } from '@mmx/db';
import { normalizeText } from '@mmx/shared';
import type { Contexto } from '../contexto';

const ACTOR = 'importaciones-corregir';
const igual = (a: string | null, b: string | null) => normalizeText(a ?? '').replace(/\s+/g, ' ').trim() === normalizeText(b ?? '').replace(/\s+/g, ' ').trim();

/** Datos de CIMAVet de una presentación: nombre, principio(s) activo(s) con su cantidad y forma farmacéutica. */
async function datosCimavet(ctx: Contexto, cn: string) {
  const pres = await ctx.cimavet.repo.presentacion(cn);
  const m = pres ? await ctx.cimavet.repo.medicamento(pres.nregistro) : null;
  if (!pres || !m) return null;
  const formas = m.formaId !== null ? await ctx.cimavet.repo.nombresMaestra(MAESTRA.FORMAS, [m.formaId]) : new Map<number, string>();
  return {
    nombre: pres.nombre,
    principioActivo: m.composicion.pas.map((p) => [p.nombre.toLowerCase(), p.cantidad, p.unidad].filter(Boolean).join(' ')).join('; ') || null,
    forma: m.formaId !== null ? (formas.get(m.formaId) ?? null) : null,
  };
}

/**
 * Pone de acuerdo con CIMAVet las filas importadas (nombre, principio activo y forma según su código nacional).
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
  const cache = new Map<string, Awaited<ReturnType<typeof datosCimavet>>>();
  const cimavet = async (cn: string) => {
    if (!cache.has(cn)) cache.set(cn, await datosCimavet(ctx, cn));
    return cache.get(cn) ?? null;
  };
  const informe = [];
  for (const imp of todas) {
    const tabla = imp.tipo === 'entradas' ? entradaImportada : salidaImportada;
    const filas = await ctx.db.select().from(tabla).where(eq(tabla.importacionId, imp.id)).orderBy(asc(tabla.fila));
    const cambios = { nombre: 0, principioActivo: 0, forma: 0 };
    const sinCn: number[] = [];
    const cnDesconocido: number[] = [];
    const ejemplos: { fila: number; antes: string; despues: string }[] = [];
    const corregidas: (typeof filas)[number][] = [];
    for (const f of filas) {
      const c = f.cn ? await cimavet(f.cn.replace(/\D/g, '').slice(0, 6)) : null;
      if (!f.cn) sinCn.push(f.fila);
      else if (!c) cnDesconocido.push(f.fila);
      if (!c) {
        corregidas.push(f);
        continue;
      }
      const nueva = { ...f, nombreFarmaco: c.nombre, principioActivo: c.principioActivo ?? f.principioActivo, forma: c.forma ?? f.forma };
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
    informe.push({ importacion: imp.id, tipo: imp.tipo, filas: filas.length, cambios, sinCn: sinCn.length, cnDesconocido: cnDesconocido.length, ejemplos, corregida });
  }
  const r = { aplicado: aplicar, importaciones: informe };
  ctx.log('importaciones-corregir', r);
  return r;
}
