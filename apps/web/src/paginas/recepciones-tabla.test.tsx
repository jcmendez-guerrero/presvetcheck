import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { TablaRecepciones, type ListaRecepciones } from './recepciones-tabla';

let mockSearch: Record<string, unknown> = {};
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: ReactNode; to: string; params?: { id: string } }) => (
    <a href={params ? to.replace('$id', params.id) : to}>{children}</a>
  ),
  useSearch: () => mockSearch,
  useNavigate: () => vi.fn(),
}));

let mockData: ListaRecepciones | undefined;
vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: (x: unknown) => x,
  useQuery: () => ({ data: mockData, isLoading: false, isError: false, refetch: vi.fn() }),
}));

const UUID = '0b6f2c1e-1111-4222-8333-944455556666';
const dosFilas: ListaRecepciones = {
  filas: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      albaran: 'A-1234',
      proveedor: 'Distribuidora Norte',
      fechaRecepcion: '2026-11-12',
      fechaCompra: '2026-11-10',
      registradaAt: '2026-11-12T23:30:00.000Z',
      estado: 'FINALIZADA',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      albaran: null,
      proveedor: 'Farma Sur',
      fechaRecepcion: null,
      fechaCompra: '2026-11-01',
      registradaAt: '2026-11-01T09:00:00.000Z',
      estado: 'ERROR_SINCRONIZACION',
    },
  ],
  total: 2,
  pagina: 1,
  porPagina: 25,
  proveedores: [
    { id: UUID, nombre: 'Distribuidora Norte' },
    { id: '33333333-3333-4333-8333-333333333333', nombre: 'Farma Sur' },
  ],
};
const vacia: ListaRecepciones = { filas: [], total: 0, pagina: 1, porPagina: 25, proveedores: [] };

/** Texto visible sin etiquetas (para buscar frases que cruzan elementos). */
const texto = (html: string) => {
  // Se repite hasta que no quede ninguna etiqueta (una sola pasada puede dejar restos; aviso de CodeQL).
  let t = html;
  for (let antes = ''; antes !== t;) {
    antes = t;
    t = t.replace(/<[^>]*>/g, '');
  }
  return t.replace(/&quot;/g, '"');
};

beforeEach(() => {
  mockSearch = {};
  mockData = dosFilas;
});

describe('Tabla de recepciones (US1)', () => {
  it('muestra las seis columnas en orden, textos claros y el total', () => {
    const html = renderToString(<TablaRecepciones />);
    const cabeceras = [...html.matchAll(/<th[^>]*scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => texto(m[1]!));
    expect(cabeceras.map((c) => c.replace(/[↑↓↕]/g, '').trim())).toEqual([
      'Nº de albarán o factura',
      'Proveedor',
      'Fecha de recepción',
      'Fecha de compra',
      'Fecha de registro',
      'Estado',
    ]);
    const t = texto(html);
    expect(t).toContain('A-1234');
    expect(t).toContain('Sin albarán');
    expect(t).toContain('—');
    expect(t).toContain('12/11/2026');
    expect(t).toContain('10/11/2026');
    // Registrada a las 00:30 del 13/11 en Madrid (23:30 UTC del 12): se muestra el día de Madrid.
    expect(t).toContain('13/11/2026');
    expect(t).toContain('Error al enviar');
    expect(t).not.toContain('ERROR_SINCRONIZACION');
    expect(t).toContain('Finalizada');
    expect(t).toContain('2 recepciones');
    expect(html).toContain('href="/recepciones/11111111-1111-4111-8111-111111111111"');
  });
});

describe('Filtros (US2)', () => {
  it('muestra los controles con su etiqueta y los valores de la dirección', () => {
    mockSearch = { numero: '0099', estado: 'ABIERTA' };
    const html = renderToString(<TablaRecepciones />);
    const t = texto(html);
    for (const e of [
      'Buscar por número de albarán o factura',
      'Proveedor',
      'Estado',
      'Fecha de recepción desde',
      'Fecha de recepción hasta',
      'Fecha de compra desde',
      'Fecha de registro hasta',
    ]) {
      expect(t).toContain(e);
    }
    expect(html).toMatch(/value="0099"/);
    expect(html).toMatch(
      /<input[^>]*value="ABIERTA"[^>]*checked=""|<input[^>]*checked=""[^>]*value="ABIERTA"/,
    );
    expect(t).toContain('Quitar filtros');
  });

  it('sin resultados con filtros: mensaje y opción de quitarlos', () => {
    mockSearch = { numero: 'nada' };
    mockData = vacia;
    const t = texto(renderToString(<TablaRecepciones />));
    expect(t).toContain('No hay recepciones con estos filtros');
    expect(t).toContain('Quitar filtros');
  });

  it('sin recepciones y sin filtros', () => {
    mockData = vacia;
    const t = texto(renderToString(<TablaRecepciones />));
    expect(t).toContain('Todavía no hay recepciones');
    expect(t).not.toContain('Quitar filtros');
  });

  it('avisa de un rango con «desde» posterior a «hasta»', () => {
    mockSearch = { compraDesde: '2026-11-10', compraHasta: '2026-11-01' };
    const t = texto(renderToString(<TablaRecepciones />));
    expect(t).toContain('La fecha "hasta" no puede ser anterior a "desde"');
  });
});

describe('Orden (US3)', () => {
  const ordenDe = (html: string) =>
    Object.fromEntries(
      [...html.matchAll(/<th[^>]*aria-sort="([a-z]+)"[^>]*>(.*?)<\/th>/g)].map((m) => [
        texto(m[2]!).replace(/[↑↓↕]/g, '').trim(),
        m[1],
      ]),
    );

  it('marca la columna ordenada con aria-sort', () => {
    mockSearch = { orden: 'compra', dir: 'asc' };
    const o = ordenDe(renderToString(<TablaRecepciones />));
    expect(o['Fecha de compra']).toBe('ascending');
    expect(o['Fecha de registro']).toBe('none');
    expect(o.Proveedor).toBe('none');
  });

  it('sin orden elegido: fecha de registro descendente', () => {
    const o = ordenDe(renderToString(<TablaRecepciones />));
    expect(o['Fecha de registro']).toBe('descending');
    expect(o['Fecha de compra']).toBe('none');
  });
});
