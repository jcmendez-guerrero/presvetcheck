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

export function calcularPrecioCoste(
  neto: Decimal.Value,
  ivaPct: Decimal.Value | null,
  rules: PreciosRules,
  o: { conRecargo?: boolean } = {},
): PrecioCoste {
  const n = new Decimal(neto);
  if (n.isNegative()) throw new Error('El precio neto no puede ser negativo');
  const iva = new Decimal(ivaPct ?? rules.iva_por_defecto_medicamento);
  const re = rules.recargo_equivalencia[iva.toString()];
  if (re === undefined) throw new Error(`Sin recargo de equivalencia configurado para IVA ${iva.toString()} %`);
  // Régimen solo IVA (proveedor que no aplica recargo): coste = neto.
  const rePct = o.conRecargo === false ? new Decimal(0) : new Decimal(re);
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

/** Precio neto unitario = precio × (1 − descuento %). Sin descuento, el mismo precio. 4 decimales. */
export function precioConDescuento(precio: Decimal.Value, descuentoPct: Decimal.Value | null): string {
  const p = new Decimal(precio);
  const d = new Decimal(descuentoPct ?? 0);
  if (p.isNegative()) throw new Error('El precio no puede ser negativo');
  if (d.isNegative() || d.gt(100)) throw new Error('El descuento tiene que estar entre 0 y 100 %');
  return p.mul(new Decimal(1).minus(d.div(100))).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export interface TotalesCompra {
  base: string;
  iva: string;
  recargo: string;
  total: string;
}

/**
 * Totales de una recepción como en la factura: por línea, base = neto × unidades (2 decimales), y cuota de IVA y
 * de recargo sobre esa base. Las líneas sin precio no cuentan.
 */
export function totalesCompra(lineas: { neto: Decimal.Value | null; unidades: number; ivaPct: Decimal.Value | null; rePct: Decimal.Value | null }[]): TotalesCompra {
  let base = new Decimal(0);
  let iva = new Decimal(0);
  let re = new Decimal(0);
  for (const l of lineas) {
    if (l.neto === null) continue;
    const b = new Decimal(l.neto).mul(l.unidades).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    base = base.plus(b);
    iva = iva.plus(b.mul(new Decimal(l.ivaPct ?? 0).div(100)));
    re = re.plus(b.mul(new Decimal(l.rePct ?? 0).div(100)));
  }
  const r = (x: Decimal) => x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { base: r(base).toFixed(2), iva: r(iva).toFixed(2), recargo: r(re).toFixed(2), total: r(base).plus(r(iva)).plus(r(re)).toFixed(2) };
}
