import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { albaranDesdeFactura, caducidadDeTexto, importeDeTexto } from '../src/albaran';
import type { AnalyzeResult } from '../src/azure/docintel';

const real = JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/albaranes/sintetico-1.invoice.json'), 'utf8')) as AnalyzeResult;

describe('albarán leído con prebuilt-invoice (respuesta real)', () => {
  it('cabecera y líneas: código nacional, cantidad (deducida si falta), precio, lote y caducidad', () => {
    const a = albaranDesdeFactura(real);
    expect(a).toMatchObject({ proveedor: 'DISTRIBUIDORA VETERINARIA DE PRUEBA S.L.', numero: 'ALB-2026-00417', fecha: '2026-10-15' });
    expect(a.lineas).toEqual([
      { descripcion: 'AMODIP 1,25 MG 30 COMP MASTICABLES', codigo: '584159', cn: '584159', cantidad: 3, precioUnitario: '11.20', lote: 'AMD-2801', caducidad: '2028-01-31' },
      // El modelo no leyó la cantidad: 13,70 / 6,85 = 2.
      { descripcion: 'CLAVUBAY 400/100 MG 10 COMP', codigo: '570016', cn: '570016', cantidad: 2, precioUnitario: '6.85', lote: 'CLV-2805', caducidad: '2028-05-31' },
      { descripcion: 'COLLAR ANTIPARASITARIO PERRO GRANDE', codigo: '999999', cn: '999999', cantidad: 1, precioUnitario: '9.90', lote: null, caducidad: null },
    ]);
  });

  it('documento sin líneas ni cabecera', () => {
    expect(albaranDesdeFactura({ content: '' })).toMatchObject({ proveedor: null, numero: null, fecha: null, lineas: [] });
  });
});

describe('importes y caducidades escritos en el documento', () => {
  it.each([
    ['11,20', '11.20'],
    ['1.234,50', '1234.50'],
    ['11.2', '11.20'],
    ['0,1234', '0.1234'],
    ['abc', null],
    [null, null],
  ])('importe %s → %s', (t, v) => expect(importeDeTexto(t)).toBe(v));

  it.each([
    ['15/01/2028', '2028-01-15'],
    ['01/2028', '2028-01-31'],
    ['02/2028', '2028-02-29'],
    ['2027-02', '2027-02-28'],
    ['31.12.27', '2027-12-31'],
    ['13/2028', null],
    ['', null],
  ])('caducidad %s → %s', (t, v) => expect(caducidadDeTexto(t)).toBe(v));
});
