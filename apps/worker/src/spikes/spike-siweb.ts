import type { SiwebClient, Variant } from '@mmx/siweb';
import { leerNivel, resolverAlmacen } from '@mmx/siweb';

/**
 * Spike previo a escribir stock en real (SPEC §12.3). NO lo ejecuta el agente: lo lanza una persona.
 * Sobre una variante de prueba creada a mano (SKU `TEST-…`, sin publicar en TPV ni web):
 *   1. lee el stock por lote; 2. aplica +1 con lote `TEST-AAAAMMDD` y caducidad; 3. vuelve a leer;
 *   4. revierte con −1 del mismo lote; 5. muestra los resultados y el `movement` devuelto.
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
  | { ok: true; lote: string; antes: unknown; despues: unknown; final: unknown; movimientos: unknown[]; coherente: boolean };

const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');

export async function ejecutarSpike(d: DepsSpike): Promise<ResultadoSpike> {
  if (!d.sku.startsWith('TEST-')) {
    d.log(`Me niego a ejecutar: el SKU "${d.sku}" no empieza por TEST-. Usa una variante de prueba creada a mano.`);
    return { ok: false, motivo: 'SKU_NO_TEST' };
  }
  const variante: Variant | undefined = (await d.client.variants({ search: d.sku })).find((v) => v.sku === d.sku);
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
      niveles: (v.stock_levels ?? []).filter((l) => l.warehouse_id === almacen.id).map((l) => ({ ...leerNivel(l), raw: l })),
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
  const coherente = nivelLote !== undefined && despues.lotes.some((l) => l.lot_code === lote && l.expiry_date?.slice(0, 10) === caducidad);
  d.log(coherente ? 'RESULTADO: la entrada por lote con caducidad funciona.' : 'RESULTADO: revisar — no se ve el lote o la caducidad tras el ajuste.');
  return { ok: true, lote, antes, despues, final, movimientos: [mas.result.movement, menos.result.movement], coherente };
}
