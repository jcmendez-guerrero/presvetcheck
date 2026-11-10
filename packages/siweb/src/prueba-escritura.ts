import { and, desc, eq } from 'drizzle-orm';
import { auditEvent, type Db } from '@mmx/db';
import type { SiwebClient } from './client';
import { leerNivel, type Variant } from './schemas';
import { resolverAlmacen } from './warehouse';

/**
 * Prueba de escritura previa a escribir stock en real (SPEC §12.3, specs/011). La lanza una persona desde
 * Administración (o con el script de `apps/worker` para depurar).
 * Sobre una variante de prueba creada a mano (SKU `TEST-…`, sin publicar en TPV ni web):
 *   1. lee el stock por lote; 2. aplica +1 con lote `TEST-AAAAMMDD` y caducidad; 3. vuelve a leer;
 *   4. revierte con −1 del mismo lote; 5. comprueba que los dos ajustes aparecen en el historial de
 *   movimientos con su nota (sin eso no funcionan ni la verificación de envíos dudosos ni la conciliación).
 * Pide confirmación interactiva antes de escribir y se niega si el SKU no empieza por `TEST-`.
 */
export interface DepsSpike {
  client: SiwebClient;
  sku: string;
  almacen: { nombre: string; id?: number | undefined };
  preguntar: (texto: string) => Promise<string>;
  log: (texto: string, datos?: unknown) => void;
  hoy: Date;
}

export type ResultadoSpike =
  | { ok: false; motivo: 'SKU_NO_TEST' | 'VARIANTE_NO_ENCONTRADA' | 'CANCELADO' | 'STOCK_ILIMITADO' }
  | {
      ok: true;
      lote: string;
      variantId: number;
      antes: unknown;
      despues: unknown;
      final: unknown;
      movimientos: unknown[];
      coherente: boolean;
      historialOk: boolean;
    };

const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');

export async function ejecutarSpike(d: DepsSpike): Promise<ResultadoSpike> {
  if (!d.sku.startsWith('TEST-')) {
    d.log(
      `Me niego a ejecutar: el SKU "${d.sku}" no empieza por TEST-. Usa una variante de prueba creada a mano.`,
    );
    return { ok: false, motivo: 'SKU_NO_TEST' };
  }
  const variante: Variant | undefined = (await d.client.variants({ search: d.sku })).find(
    (v) => v.sku === d.sku,
  );
  if (!variante) {
    d.log(`No existe ninguna variante con SKU exacto ${d.sku}`);
    return { ok: false, motivo: 'VARIANTE_NO_ENCONTRADA' };
  }
  const almacen = await resolverAlmacen(d.client, d.almacen);
  const leer = async () => {
    const [v, lots] = await Promise.all([d.client.variant(variante.id), d.client.lots(variante.id)]);
    return {
      infinito: v.is_infinite_stock ?? false,
      total: v.total_on_hand,
      niveles: (v.stock_levels ?? [])
        .filter((l) => l.warehouse_id === almacen.id)
        .map((l) => ({ ...leerNivel(l), raw: l })),
      lotes: lots,
    };
  };
  const antes = await leer();
  d.log('Stock actual (almacén ' + almacen.nombre + ')', antes);
  if (antes.infinito) {
    d.log('La variante tiene stock ilimitado: Siweb360 devolverá 409. Corrígelo antes del spike.');
    return { ok: false, motivo: 'STOCK_ILIMITADO' };
  }
  const lote = `TEST-${yyyymmdd(d.hoy)}`;
  const caducidad = new Date(d.hoy.getTime() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const r = await d.preguntar(
    `Se va a ESCRIBIR en Siweb360: +1 unidad de ${d.sku} (variante ${variante.id}) en "${almacen.nombre}", lote ${lote}, caducidad ${caducidad}, y después −1 para revertir.\nEscribe SI para continuar: `,
  );
  if (r.trim() !== 'SI') {
    d.log('Cancelado: no se ha escrito nada.');
    return { ok: false, motivo: 'CANCELADO' };
  }
  const notas = `MMX-SPIKE-${yyyymmdd(d.hoy)}`;
  const mas = await d.client.ajustarStock({
    variant_id: variante.id,
    warehouse_id: almacen.id,
    quantity: 1,
    mode: 'delta',
    reason: 'purchase_receipt',
    batch_number: lote,
    expiry_date: caducidad,
    notes: `${notas}-ENTRADA`,
  });
  d.log('Ajuste +1 aplicado', mas.raw);
  const despues = await leer();
  d.log('Stock tras +1', despues);
  const menos = await d.client.ajustarStock({
    variant_id: variante.id,
    warehouse_id: almacen.id,
    quantity: -1,
    mode: 'delta',
    reason: 'adjustment_negative',
    batch_number: lote,
    notes: `${notas}-REVERSION`,
  });
  d.log('Reversión −1 aplicada', menos.raw);
  const final = await leer();
  d.log('Stock final', final);
  const nivelLote = despues.niveles.find((n) => n.lote === lote);
  const coherente =
    nivelLote !== undefined &&
    despues.lotes.some((l) => l.lot_code === lote && l.expiry_date?.slice(0, 10) === caducidad);
  d.log(
    coherente
      ? 'RESULTADO: la entrada por lote con caducidad funciona.'
      : 'RESULTADO: revisar — no se ve el lote o la caducidad tras el ajuste.',
  );
  let historialOk = false;
  try {
    const movs = await d.client.movements({
      variant_id: variante.id,
      date_from: d.hoy.toISOString().slice(0, 10),
    });
    const notasVistas = new Set(movs.map((m) => m.notes ?? ''));
    historialOk = notasVistas.has(`${notas}-ENTRADA`) && notasVistas.has(`${notas}-REVERSION`);
  } catch (e) {
    d.log('No se pudo leer el historial de movimientos', String(e));
  }
  d.log(
    historialOk
      ? 'RESULTADO: el historial de movimientos devuelve la nota de los ajustes.'
      : 'RESULTADO: revisar — el historial no devuelve los ajustes con su nota.',
  );
  return {
    ok: true,
    lote,
    variantId: variante.id,
    antes,
    despues,
    final,
    movimientos: [mas.result.movement, menos.result.movement],
    coherente,
    historialOk,
  };
}

export const ACCION_PRUEBA_ESCRITURA = 'siweb_prueba_escritura';
export const DIAS_VIGENCIA_PRUEBA = 30;

/** Fecha de la última prueba de escritura superada (ok, coherente e historial con notas), o null. */
export async function ultimaPruebaEscritura(db: Db): Promise<Date | null> {
  const filas = await db
    .select({ at: auditEvent.at, despues: auditEvent.despues })
    .from(auditEvent)
    .where(and(eq(auditEvent.accion, ACCION_PRUEBA_ESCRITURA), eq(auditEvent.entidad, 'siweb')))
    .orderBy(desc(auditEvent.seq))
    .limit(50);
  const ok = filas.find((f) => {
    const r = f.despues as { ok?: boolean; coherente?: boolean; historialOk?: boolean } | null;
    return r?.ok === true && r.coherente === true && r.historialOk === true;
  });
  return ok?.at ?? null;
}

/** ¿Está vigente una prueba hecha en `fecha`? (vale 30 días). */
export function esPruebaVigente(fecha: Date | null, ahora: Date): boolean {
  return fecha !== null && ahora.getTime() - fecha.getTime() <= DIAS_VIGENCIA_PRUEBA * 24 * 3600 * 1000;
}
