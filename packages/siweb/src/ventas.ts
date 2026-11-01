import type { MovimientoVenta } from '@mmx/domain';
import type { SiwebClient } from './client';

/**
 * Puerto de movimientos de venta (tickets del TPV) para la conciliación ticket ↔ dispensación
 * (SPEC §5.2.4).
 */
export interface SalesMovementsSource {
  readonly configurado: boolean;
  /** Movimientos de salida por venta entre dos fechas (AAAA-MM-DD, Europe/Madrid). */
  movimientos(desde: string, hasta: string): Promise<MovimientoVenta[]>;
}

export class NotConfiguredSalesMovementsSource implements SalesMovementsSource {
  readonly configurado = false;
  constructor(
    readonly motivo = 'Conciliación con tickets desactivada (SIWEB_SALES_SOURCE=off o sin token de Siweb360)',
  ) {}
  async movimientos(): Promise<MovimientoVenta[]> {
    throw new Error(this.motivo);
  }
}

export class LecturaTicketsIncompleta extends Error {
  constructor(desde: string, hasta: string, n: number) {
    super(
      `Siweb360 devolvió ${n} tickets entre ${desde} y ${hasta} (el máximo pedido): la lectura puede estar incompleta`,
    );
    this.name = 'LecturaTicketsIncompleta';
  }
}

/**
 * Adaptador sobre la API de tickets (docs/ref/siweb360-openapi.json: `GET tickets`, `GET tickets/{id}`).
 * Las líneas del ticket solo traen `nombre` y `cantidad` (ni variante ni lote), así que:
 * - el CN se extrae del nombre de la línea con `SIWEB_TICKET_CN_REGEX` (convención de nombre del
 *   producto `… CN570016`); las líneas sin CN no son medicamentos de la farmacia y se ignoran;
 * - el lote no se puede verificar (`lote: null`).
 * Solo se leen tickets `Pagado`. TODO(decision D-02b): confirmar con tickets reales que el nombre de la
 * línea conserva el nombre del producto con el CN; si no, la conciliación queda sin CN y avisa.
 */
export class TicketsSalesMovementsSource implements SalesMovementsSource {
  readonly configurado = true;
  private readonly re: RegExp;

  constructor(
    private readonly client: SiwebClient,
    cnRegex: string,
  ) {
    this.re = new RegExp(cnRegex, 'i');
  }

  cnDeLinea(nombre: string | null | undefined): string | null {
    const m = nombre ? this.re.exec(nombre) : null;
    return m?.[1] ?? null;
  }

  async movimientos(desde: string, hasta: string): Promise<MovimientoVenta[]> {
    const { tickets, posiblementeIncompleto } = await this.client.tickets({
      fecha_desde: desde,
      fecha_hasta: hasta,
      estado: 'Pagado',
    });
    if (posiblementeIncompleto) throw new LecturaTicketsIncompleta(desde, hasta, tickets.length);
    const out: MovimientoVenta[] = [];
    for (const t of tickets) {
      const det = t.items ? t : await this.client.ticket(t.id);
      for (const [i, item] of (det.items ?? []).entries()) {
        const cn = this.cnDeLinea(item.nombre);
        if (!cn) continue;
        out.push({
          id: `${t.id}:${item.id ?? i}`,
          variantId: null,
          cn,
          lote: null,
          unidades: item.cantidad ?? 0,
          fecha: (det.fecha ?? t.fecha ?? desde).slice(0, 10),
          ticket: det.numero ?? t.numero ?? String(t.id),
        });
      }
    }
    return out;
  }
}
