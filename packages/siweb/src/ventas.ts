import type { MovimientoVenta } from '@mmx/domain';

/**
 * Puerto de movimientos de venta (tickets del TPV) para la conciliación ticket ↔ dispensación
 * (SPEC §5.2.4). La API de movimientos/tickets de Siweb360 no está en la documentación aportada
 * (solo Inventario). TODO(decision D-02b): implementar el adaptador real cuando JC aporte la doc en docs/ref/.
 */
export interface SalesMovementsSource {
  readonly configurado: boolean;
  /** Movimientos de salida por venta entre dos fechas (AAAA-MM-DD, Europe/Madrid). */
  movimientos(desde: string, hasta: string): Promise<MovimientoVenta[]>;
}

export class NotConfiguredSalesMovementsSource implements SalesMovementsSource {
  readonly configurado = false;
  readonly motivo = 'API de movimientos de Siweb360 no documentada (D-02b): conciliación inactiva';
  async movimientos(): Promise<MovimientoVenta[]> {
    throw new Error(this.motivo);
  }
}
