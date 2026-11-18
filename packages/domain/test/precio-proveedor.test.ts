import { describe, expect, it } from 'vitest';
import { costeProveedorCents } from '../src/precio';

const conRE = { coste_proveedor_base: 'precio_coste' as const };
const neto = { coste_proveedor_base: 'precio_neto' as const };

describe('costeProveedorCents (specs/016, D-15)', () => {
  it.each([
    [
      'precio_coste usa el precio de coste',
      { precioCoste: '10.1400', precioNetoCompra: '10.0000' },
      conRE,
      1014,
    ],
    ['sin precio de coste usa el neto', { precioCoste: null, precioNetoCompra: '10.0000' }, conRE, 1000],
    ['precio_neto usa el neto', { precioCoste: '10.1400', precioNetoCompra: '10.0000' }, neto, 1000],
    ['precio_neto sin neto usa el coste', { precioCoste: '10.1400', precioNetoCompra: null }, neto, 1014],
    ['redondea a céntimos', { precioCoste: '10.14567', precioNetoCompra: null }, conRE, 1014.57],
    ['acepta números', { precioCoste: 1850.5, precioNetoCompra: null }, conRE, 185050],
    ['cero no es un coste', { precioCoste: '0.0000', precioNetoCompra: '0' }, conRE, null],
    ['coste cero pasa al neto', { precioCoste: '0', precioNetoCompra: '5.00' }, conRE, 500],
    ['sin ningún precio', { precioCoste: null, precioNetoCompra: null }, conRE, null],
    ['cadena vacía', { precioCoste: '', precioNetoCompra: '' }, conRE, null],
    ['negativo no es un coste', { precioCoste: '-1', precioNetoCompra: null }, conRE, null],
  ])('%s', (_n, linea, rules, esperado) => {
    expect(costeProveedorCents(linea, rules)).toBe(esperado);
  });
});
