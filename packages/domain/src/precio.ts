import Decimal from 'decimal.js';
import type { PreciosRules } from '@mmx/shared';

/**
 * Precio de coste (SPEC §4.10, D-11): `precio_coste = precio_neto_compra × (1 + RE%)`, con el RE
 * según el IVA del producto. Decimal exacto; 4 decimales en almacenamiento y 2 en pantalla.
 */
export interface PrecioCoste {
  neto: Decimal;
  ivaPct: Decimal;
  rePct: Decimal;
  coste: Decimal;
  costeAlmacen: string;
  costePantalla: string;
}

export function calcularPrecioCoste(neto: Decimal.Value, ivaPct: Decimal.Value | null, rules: PreciosRules): PrecioCoste {
  const n = new Decimal(neto);
  if (n.isNegative()) throw new Error('El precio neto no puede ser negativo');
  const iva = new Decimal(ivaPct ?? rules.iva_por_defecto_medicamento);
  const re = rules.recargo_equivalencia[iva.toString()];
  if (re === undefined) throw new Error(`Sin recargo de equivalencia configurado para IVA ${iva.toString()} %`);
  const rePct = new Decimal(re);
  const coste = n.mul(new Decimal(1).plus(rePct.div(100)));
  return {
    neto: n,
    ivaPct: iva,
    rePct,
    coste,
    costeAlmacen: coste.toDecimalPlaces(rules.decimales_almacen, Decimal.ROUND_HALF_UP).toFixed(rules.decimales_almacen),
    costePantalla: coste.toDecimalPlaces(rules.decimales_pantalla, Decimal.ROUND_HALF_UP).toFixed(rules.decimales_pantalla),
  };
}

/** Variación porcentual respecto al coste anterior (informe "Precios de coste de la semana"). */
export function variacionCoste(anterior: Decimal.Value | null, actual: Decimal.Value): string | null {
  if (anterior === null) return null;
  const a = new Decimal(anterior);
  if (a.isZero()) return null;
  return new Decimal(actual).minus(a).div(a).mul(100).toDecimalPlaces(2).toFixed(2);
}
