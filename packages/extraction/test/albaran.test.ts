import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { albaranDesdeFactura, caducidadDeTexto, importeDeTexto } from '../src/albaran';
import type { AnalyzeResult } from '../src/azure/docintel';

const real = JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/albaranes/sintetico-1.invoice.json'), 'utf8')) as AnalyzeResult;

describe('albarán leído con prebuilt-invoice (respuesta real)', () => {
  it('cabecera y líneas: código nacional, cantidad (deducida si falta), precio, lote y caducidad', () => {
    const a = albaranDesdeFactura(real);
    expect(a).toMatchObject({ proveedor: 'DISTRIBUIDORA VETERINARIA DE PRUEBA S.L.', numero: 'ALB-2026-00417', fecha: '2026-10-15', totales: { base: '57.20', impuestos: '5.72', total: '62.92' } });
    expect(a.lineas).toEqual([
      { descripcion: 'AMODIP 1,25 MG 30 COMP MASTICABLES', codigo: '584159', cn: '584159', cantidad: 3, precioUnitario: '11.20', descuentoPct: null, lote: 'AMD-2801', caducidad: '2028-01-31' },
      // El modelo no leyó la cantidad: 13,70 / 6,85 = 2.
      { descripcion: 'CLAVUBAY 400/100 MG 10 COMP', codigo: '570016', cn: '570016', cantidad: 2, precioUnitario: '6.85', descuentoPct: null, lote: 'CLV-2805', caducidad: '2028-05-31' },
      { descripcion: 'COLLAR ANTIPARASITARIO PERRO GRANDE', codigo: '999999', cn: '999999', cantidad: 1, precioUnitario: '9.90', descuentoPct: null, lote: null, caducidad: null },
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

describe('lote y caducidad en columnas de la tabla del albarán', () => {
  // Estructura de `tables` igual que en la respuesta real (fixtures/albaranes/sintetico-1.invoice.json); valores ficticios.
  const celda = (rowIndex: number, columnIndex: number, content: string, kind?: string) => ({ rowIndex, columnIndex, content, ...(kind ? { kind } : {}) });
  const r = {
    content: 'ALBARAN 77\nCodigo Descripcion Lote F. Cad. Cant.\n570016 CLAVUBAY 400/100 MG 10 COMP CLV-9 31/05/2028 2\n',
    tables: [
      {
        rowCount: 2,
        columnCount: 5,
        cells: [
          celda(0, 0, 'Código', 'columnHeader'),
          celda(0, 1, 'Descripción', 'columnHeader'),
          celda(0, 2, 'Lote', 'columnHeader'),
          celda(0, 3, 'F. Cad.', 'columnHeader'),
          celda(0, 4, 'Cant.', 'columnHeader'),
          celda(1, 0, '570016'),
          celda(1, 1, 'CLAVUBAY 400/100 MG 10 COMP'),
          celda(1, 2, 'CLV-9'),
          celda(1, 3, '05/2028'),
          celda(1, 4, '2'),
        ],
      },
    ],
    documents: [
      {
        fields: {
          InvoiceId: { valueString: '77' },
          Items: { valueArray: [{ valueObject: { ProductCode: { valueString: '570016', content: '570016' }, Description: { valueString: 'CLAVUBAY 400/100 MG 10 COMP' }, Quantity: { valueNumber: 2 }, UnitPrice: { content: '6,85' }, Amount: { content: '11,94' } } }] },
        },
      },
    ],
  } as unknown as AnalyzeResult;

  it('toma lote y caducidad de las columnas («Lote», «F. Cad.») emparejando la fila por el código', () => {
    const l = albaranDesdeFactura(r).lineas[0]!;
    expect(l).toMatchObject({ cn: '570016', lote: 'CLV-9', caducidad: '2028-05-31', cantidad: 2, precioUnitario: '6.85', descuentoPct: '12.85' });
  });
});

/** Milisegundos que tarda `f` (para comprobar que las expresiones tienen coste lineal con textos patológicos). */
const ms = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe('líneas de factura con textos patológicos: coste lineal (CodeQL js/polynomial-redos)', () => {
  const n = 100_000;
  const factura = (fila: string) => ({
    content: `ALBARAN 1\n570016 ${fila}\n`,
    documents: [{ fields: { Items: { valueArray: [{ valueObject: { ProductCode: { valueString: '570016', content: '570016', spans: [{ offset: 10, length: 6 }] }, Description: { valueString: 'X' } } }] } } }],
  });
  it.each([
    ['«Lote» y espacios', 'Lote' + ' '.repeat(n) + '!'],
    ['«Cad.» y espacios', 'Cad.' + ' '.repeat(n) + '!'],
    ['«CN» y espacios', 'CN' + ' '.repeat(n) + '!'],
  ])('%s: < 1 s con 100 000 caracteres', (_n, fila) => expect(ms(() => albaranDesdeFactura(factura(fila) as never))).toBeLessThan(1000));
});
