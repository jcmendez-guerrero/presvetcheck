import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  COLUMNAS_A,
  COLUMNAS_B,
  COLUMNAS_INTERNAS,
  COLUMNAS_PROPIETARIO,
  aCsv,
  aXlsx,
  fechaEs,
  plantillaDe,
  tablaEntradas,
  tablaPsicotropos,
  tablasSalidas,
  type Salida,
} from '../src';

const salida = (o: Partial<Salida> = {}): Salida => ({
  id: 'd1',
  canal: 'presencial',
  conReceta: true,
  nombreFarmaco: 'CLAVUBAY 400 mg/100 mg',
  principioActivo: 'amoxicilina 400 mg; ácido clavulánico 100 mg',
  forma: 'COMPRIMIDO',
  especie: 'Perros',
  fechaVenta: new Date('2026-10-14T21:30:00Z'),
  caducidad: '2027-05-31',
  lote: 'B2027',
  cn: '570016',
  unidades: 1,
  fechaReceta: '2026-10-13',
  numeroReceta: 'R-1',
  veterinario: 'Vet',
  numColegiado: '28/1',
  clinica: 'Clínica',
  direccionVeterinario: 'Calle 1',
  propietario: { nombre: 'Titular', movil: '600', dni: '****5678Z', direccion: 'Calle 2' },
  tipoReceta: 'papel',
  plataforma: null,
  esSustitucion: false,
  forzado: false,
  defectosForzados: [],
  medicamentoPrescrito: null,
  autorizadoPor: null,
  empleado: 'dev-empleado',
  metodoCaptura: 'camara',
  anulada: false,
  ...o,
});

describe('registro de salidas (SPEC §4.8)', () => {
  it('plantilla A: columnas exactas, sin propietario por defecto, internas al final', () => {
    const [t] = tablasSalidas([salida()], 'A', { incluirPropietario: false, internas: 'final' });
    expect(t!.columnas).toEqual([...COLUMNAS_A, ...COLUMNAS_INTERNAS]);
    expect(t!.filas[0]!.slice(0, 15)).toEqual([
      'CLAVUBAY 400 mg/100 mg',
      'amoxicilina 400 mg; ácido clavulánico 100 mg',
      'COMPRIMIDO',
      'Perros',
      '14/10/2026',
      '31/05/2027',
      'B2027',
      '570016',
      1,
      '13/10/2026',
      'R-1',
      'Vet',
      '28/1',
      'Clínica',
      'Calle 1',
    ]);
    expect(t!.filas[0]!.slice(15)).toEqual([
      'd1',
      'presencial',
      'papel',
      '',
      'N',
      'N',
      '',
      '',
      '',
      'dev-empleado',
      'camara',
      'N',
    ]);
  });

  it('plantilla A con propietario pedido expresamente', () => {
    const [t] = tablasSalidas([salida()], 'A', { incluirPropietario: true, internas: 'ninguna' });
    expect(t!.columnas).toEqual([...COLUMNAS_A, ...COLUMNAS_PROPIETARIO]);
    expect(t!.filas[0]!.slice(-4)).toEqual(['Titular', '600', '****5678Z', 'Calle 2']);
  });

  it('plantillas B y C; columnas internas en hoja "trazabilidad"', () => {
    const datos = [
      salida(),
      salida({ id: 'b', conReceta: false }),
      salida({
        id: 'c',
        conReceta: false,
        canal: 'online',
        forzado: true,
        defectosForzados: ['ENVASE_CADUCADO'],
      }),
    ];
    const [b, tb] = tablasSalidas(datos, 'B', { incluirPropietario: false, internas: 'hoja' });
    expect(b!.columnas).toEqual([...COLUMNAS_B]);
    expect(b!.filas).toHaveLength(1);
    expect(tb!.nombre).toBe('trazabilidad');
    const [c] = tablasSalidas(datos, 'C', { incluirPropietario: false, internas: 'final' });
    expect(c!.columnas).toEqual([...COLUMNAS_B, ...COLUMNAS_PROPIETARIO, ...COLUMNAS_INTERNAS]);
    expect(c!.filas[0]!.slice(9, 13)).toEqual(['', '', '', '']);
    expect(c!.filas[0]!.slice(13 + 5, 13 + 7)).toEqual(['S', 'ENVASE_CADUCADO']);
    expect(plantillaDe({ conReceta: false, canal: 'online' })).toBe('C');
  });

  it('sustitución: medicamento prescrito en internas', () => {
    const [t] = tablasSalidas(
      [salida({ esSustitucion: true, medicamentoPrescrito: 'NOROCLAV', autorizadoPor: 'garante' })],
      'A',
      { incluirPropietario: false, internas: 'final' },
    );
    expect(t!.filas[0]!.slice(15 + 4, 15 + 9)).toEqual(['S', 'N', '', 'NOROCLAV', 'garante']);
  });

  it('CSV para Excel (BOM, ;) y XLSX', async () => {
    const [t] = tablasSalidas([salida({ nombreFarmaco: 'X; "Y"', conReceta: false })], 'B', {
      incluirPropietario: false,
      internas: 'ninguna',
    });
    const csv = aCsv(t!);
    expect(csv.startsWith('﻿NOMBRE DEL FÁRMACO;PRINCIPIO ACTIVO')).toBe(true);
    expect(csv).toContain('"X; ""Y"""');
    const buf = await aXlsx([t!]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(wb.worksheets[0]!.getRow(1).getCell(1).value).toBe('NOMBRE DEL FÁRMACO');
    expect(wb.worksheets[0]!.rowCount).toBe(2);
  });

  it('fechas en Europe/Madrid', () => {
    expect(fechaEs('2026-10-14T22:30:00Z')).toBe('15/10/2026');
    expect(fechaEs(null)).toBe('');
  });
});

describe('entradas y psicótropos', () => {
  it('tabla de entradas', () => {
    const t = tablaEntradas([
      {
        recepcionId: 'r',
        distribuidor: 'D',
        albaran: 'A1',
        fechaCompra: '2026-10-14',
        nombreFarmaco: 'X',
        principioActivo: 'pa',
        forma: 'f',
        cn: '1',
        lote: 'L',
        caducidad: '2027-01-31',
        unidades: 3,
        precioNetoCompra: '10.0000',
        ivaPct: '10',
        rePct: '1.4',
        precioCoste: '10.1400',
        seriales: ['s1'],
        origenDatos: 'cimavet',
        empleado: 'e',
        fechaRecepcion: '2026-10-15',
      },
    ]);
    expect(t.filas[0]).toEqual([
      'X',
      'pa',
      'f',
      '14/10/2026',
      '31/01/2027',
      'L',
      '1',
      3,
      'D',
      'A1',
      '10.0000',
      '10',
      '1.4',
      '10.1400',
      's1',
      'cimavet',
      'e',
      '15/10/2026',
    ]);
    expect(t.columnas.at(-1)).toBe('FECHA RECEPCIÓN');
    expect(t.columnas).toContain('PRECIO NETO COMPRA (sin IVA ni RE)');
  });
  it('registro de psicótropos con saldo por medicamento y lote', () => {
    const t = tablaPsicotropos([
      {
        fecha: '2026-10-01T10:00:00Z',
        tipo: 'ENTRADA',
        cn: '570681',
        nombre: 'DOLETHAL',
        lote: 'L1',
        unidades: 3,
        referencia: 'REC-1',
      },
      {
        fecha: '2026-10-02T10:00:00Z',
        tipo: 'SALIDA',
        cn: '570681',
        nombre: 'DOLETHAL',
        lote: 'L1',
        unidades: 1,
        referencia: 'DIS-1',
      },
      {
        fecha: '2026-10-03T10:00:00Z',
        tipo: 'ANULACIÓN SALIDA',
        cn: '570681',
        nombre: 'DOLETHAL',
        lote: 'L1',
        unidades: 1,
        referencia: 'DIS-1',
      },
    ]);
    expect(t.filas.map((f) => [f[4], f[7]])).toEqual([
      ['ENTRADA', 3],
      ['SALIDA', 2],
      ['ANULACIÓN SALIDA', 3],
    ]);
  });
});
