import type { Contexto } from '../contexto';

/**
 * Despacho del outbox (cada 5 min en horario comercial y tras finalizar una recepción). Solo entradas;
 * con SIWEB_STOCK_WRITE_MODE=off no envía nada, y sin prueba de escritura vigente tampoco. Antes de enviar,
 * comprueba los envíos dudosos contra el historial de movimientos de Siweb360.
 */
export async function outboxDispatcher(ctx: Contexto) {
  if (!ctx.siweb) return { inactivo: 'Siweb360 no configurado' };
  if (ctx.config.SIWEB_STOCK_WRITE_MODE === 'off') return { inactivo: 'SIWEB_STOCK_WRITE_MODE=off' };
  // Primero se comprueban los envíos dudosos contra el historial de Siweb360 (solo lectura, specs/011).
  const verificacion = await ctx.siweb.outbox.verificarDudosos();
  const total = { sent: 0, failed: 0, needs_reconciliation: 0 };
  for (let i = 0; i < 20; i++) {
    const r = await ctx.siweb.outbox.despachar(20);
    total.sent += r.sent;
    total.failed += r.failed;
    total.needs_reconciliation += r.needs_reconciliation;
    if (r.sent + r.failed + r.needs_reconciliation === 0) break;
  }
  // Alerta (SPEC §11): needs_reconciliation > 0.
  if (total.needs_reconciliation) ctx.log('ALERTA: operaciones del outbox en reconciliación', { n: total.needs_reconciliation });
  return { ...total, verificacion };
}
