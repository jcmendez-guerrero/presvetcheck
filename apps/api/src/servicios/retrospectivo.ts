import { eq } from 'drizzle-orm';
import { siwebVariantMap } from '@mmx/db';
import { evaluarMovimientosRetrospectivos } from '@mmx/domain';
import { DomainError, type ConsultaStockRetrospectivoBody } from '@mmx/shared';
import { hoyDe, politica, type AppDeps } from '../deps';

/**
 * Comprobación del modo formación (D-14): ventas del día original en Siweb360 frente a las unidades a dispensar.
 * La comparten la evaluación de la receta y la dispensación, para que ambas juzguen igual (specs/016).
 */
export class RetrospectivoService {
  constructor(private readonly d: AppDeps) {}

  /** Con la evidencia que sale de aquí, nunca de lo que diga el cliente. */
  async revisar(body: ConsultaStockRetrospectivoBody) {
    const [mapa] = await this.d.db
      .select({ variantId: siwebVariantMap.variantId })
      .from(siwebVariantMap)
      .where(eq(siwebVariantMap.cn, body.cn))
      .limit(1);

    const variantId = mapa?.variantId ?? null;
    let movimientosRaw: Array<{
      id: number;
      variant_id: number;
      quantity: number;
      reason: string;
      reference_number?: string | null;
    }> = [];

    if (this.d.siweb?.client && variantId) {
      try {
        const res = await this.d.siweb.client.movements({
          variant_id: variantId,
          date_from: body.fechaOriginal,
          date_to: body.fechaOriginal,
          reason: 'sale_shipment',
        });
        movimientosRaw = res.map((m) => ({
          id: m.id,
          variant_id: m.variant_id,
          quantity: m.quantity,
          reason: m.reason,
          reference_number: m.reference_number ?? m.reference_id,
        }));
      } catch {
        // Sin respuesta no se sabe si hubo venta: no se presenta como «sin movimientos».
        throw new DomainError('SIWEB_NO_DISPONIBLE');
      }
    }

    const simple = movimientosRaw.map((m) => ({
      id: m.id,
      variantId: m.variant_id,
      quantity: m.quantity,
      reason: m.reason,
      date: body.fechaOriginal,
    }));

    const resEvaluacion = evaluarMovimientosRetrospectivos({
      cn: body.cn,
      fechaOriginal: body.fechaOriginal,
      hoy: hoyDe(this.d),
      maxAgeDays: this.d.config.RETROSPECTIVE_MAX_AGE_DAYS,
      unidadesRequeridas: body.unidadesRequeridas,
      movimientos: simple,
      pol: politica(this.d),
    });

    return { ...resEvaluacion, variantId, movimientos: movimientosRaw };
  }
}
