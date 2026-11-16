import { describe, expect, it } from 'vitest';
import {
  ESTADO_RECEPCION,
  aConsulta,
  diaMadrid,
  hayFiltros,
  leerFiltros,
  rangoInvalido,
} from './recepciones-filtros';

const UUID = '0b6f2c1e-1111-4222-8333-944455556666';

describe('leerFiltros', () => {
  it.each([
    [{ numero: ' A-12 ' }, { numero: 'A-12' }],
    [{ numero: '   ' }, {}],
    [{ proveedor: UUID }, { proveedor: UUID }],
    [{ proveedor: 'Farma Sur' }, {}],
    [{ estado: 'ABIERTA,ERROR_SINCRONIZACION' }, { estado: 'ABIERTA,ERROR_SINCRONIZACION' }],
    [{ estado: 'ABIERTA,OTRO' }, { estado: 'ABIERTA' }],
    [{ estado: 'OTRO' }, {}],
    [
      { compraDesde: '2026-11-01', compraHasta: '2026-11-30' },
      { compraDesde: '2026-11-01', compraHasta: '2026-11-30' },
    ],
    [{ recibidaDesde: '01/11/2026' }, {}],
    [{ registradaHasta: '2026-13-01' }, {}],
    [
      { orden: 'compra', dir: 'asc' },
      { orden: 'compra', dir: 'asc' },
    ],
    [{ orden: 'x', dir: 'arriba' }, {}],
    [{ pagina: 3 }, { pagina: 3 }],
    [{ pagina: '2' }, { pagina: 2 }],
    [{ pagina: 0 }, {}],
    [{ pagina: 1.5 }, {}],
    // `albaran` es el id del documento del móvil: lo lee la ruta, no los filtros.
    [{ albaran: UUID }, {}],
  ] as const)('%j → %j', (entrada, salida) => {
    expect(leerFiltros(entrada as Record<string, unknown>)).toEqual(salida);
  });
});

describe('aConsulta', () => {
  it('traduce proveedor a distribuidorId y omite vacíos', () => {
    const q = aConsulta({
      proveedor: UUID,
      numero: 'A-1',
      estado: 'ABIERTA',
      pagina: 2,
      orden: 'compra',
      dir: 'asc',
    });
    expect(Object.fromEntries(q)).toEqual({
      distribuidorId: UUID,
      numero: 'A-1',
      estado: 'ABIERTA',
      pagina: '2',
      orden: 'compra',
      dir: 'asc',
    });
    expect(aConsulta({}).toString()).toBe('');
  });
});

describe('rangoInvalido', () => {
  it.each([
    [{}, []],
    [{ compraDesde: '2026-11-10', compraHasta: '2026-11-01' }, ['compraHasta']],
    [{ compraDesde: '2026-11-01', compraHasta: '2026-11-01' }, []],
    [{ recibidaDesde: '2026-11-10' }, []],
    // El borrador del formulario usa '' para un campo vacío: no es un rango al revés.
    [{ compraDesde: '2026-11-10', compraHasta: '' }, []],
    [{ compraDesde: '', compraHasta: '2026-11-01' }, []],
    [
      {
        recibidaDesde: '2026-11-10',
        recibidaHasta: '2026-11-01',
        registradaDesde: '2026-11-02',
        registradaHasta: '2026-11-01',
      },
      ['recibidaHasta', 'registradaHasta'],
    ],
  ] as const)('%j → %j', (f, campos) => {
    expect(rangoInvalido(f)).toEqual(campos);
  });
});

describe('hayFiltros', () => {
  it.each([
    [{}, false],
    [{ orden: 'compra', dir: 'asc', pagina: 2 }, false],
    [{ numero: 'A' }, true],
    [{ proveedor: UUID }, true],
    [{ estado: 'ABIERTA' }, true],
    [{ registradaHasta: '2026-11-01' }, true],
  ] as const)('%j → %s', (f, hay) => {
    expect(hayFiltros(f)).toBe(hay);
  });
});

describe('ESTADO_RECEPCION', () => {
  it.each([
    ['ABIERTA', 'Abierta', true],
    ['FINALIZADA', 'Finalizada', false],
    ['SINCRONIZADA', 'Enviada', false],
    ['ERROR_SINCRONIZACION', 'Error al enviar', true],
    ['DESCARTADA', 'Descartada', false],
  ] as const)('%s → «%s»', (codigo, texto, atencion) => {
    expect(ESTADO_RECEPCION[codigo]).toEqual({ texto, atencion });
  });
});

describe('diaMadrid', () => {
  it.each([
    ['2026-11-15T23:30:00Z', '2026-11-16'], // invierno (CET)
    ['2026-11-15T22:30:00Z', '2026-11-15'],
    ['2026-07-15T22:30:00Z', '2026-07-16'], // verano (CEST)
    ['2026-07-15T21:30:00Z', '2026-07-15'],
    ['2026-03-29T00:30:00Z', '2026-03-29'], // día del cambio a verano
    ['2026-10-25T00:30:00Z', '2026-10-25'], // día del cambio a invierno
  ])('%s → %s', (iso, dia) => {
    expect(diaMadrid(iso)).toBe(dia);
  });
});
