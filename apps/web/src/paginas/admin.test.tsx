import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Outbox } from './admin';

/** Pantalla de administración del outbox con un coste de proveedor pendiente (specs/016). */
vi.mock('../lib/auth', () => ({ useAuth: () => ({ config: null }) }));
vi.mock('../componentes/layout', () => ({ Pagina: ({ children }: { children: unknown }) => children }));
vi.mock('../lib/api', () => ({
  ApiError: class extends Error {},
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

let datos: Record<string, unknown> = {};
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: datos[queryKey[0] ?? ''], error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const fila = (o: Record<string, unknown>) => ({
  id: 'o1',
  idempotencyKey: 'MMX-PRV-abc-L1',
  status: 'needs_supplier',
  lastError: 'SIN_COINCIDENCIA',
  operation: 'siweb_actualizar_coste_proveedor',
  distribuidor: { id: 'd1', nombre: 'Distribuidora Norte', cif: 'B12345678' },
  stockActual: null,
  proximaComprobacion: null,
  ...o,
});

beforeEach(() => {
  datos = {
    'siweb-proveedores': [
      { id: 41, nombre: 'Distribuidora Norte S.L.' },
      { id: 42, nombre: 'Cooperativa Sur' },
    ],
  };
});

describe('Outbox: coste de proveedor pendiente (specs/016)', () => {
  it('muestra el distribuidor, el motivo en español y el selector para vincular el proveedor', () => {
    datos['outbox'] = [fila({})];
    const html = renderToString(<Outbox />);
    expect(html).toContain('Falta vincular el proveedor en Siweb360');
    expect(html).toContain('Distribuidora Norte');
    expect(html).toContain('CIF B12345678');
    expect(html).toContain('No se ha encontrado en Siweb360 ningún proveedor con el CIF de este distribuidor.');
    expect(html).toContain('aria-label="Proveedor de Siweb360"');
    expect(html).toContain('Cooperativa Sur');
    expect(html).toContain('Vincular proveedor');
    // El motivo es un código interno: no se enseña tal cual.
    expect(html).not.toContain('SIN_COINCIDENCIA');
    // La confirmación por CIF distinto solo aparece tras el aviso del servidor.
    expect(html).not.toContain('vincular de todos modos');
  });

  it.each([
    ['SIN_CIF', 'no tiene CIF'],
    ['VARIAS_COINCIDENCIAS', 'varios proveedores'],
    ['PROVEEDOR_INEXISTENTE', 'ya no existe'],
    ['SIWEB_NO_DISPONIBLE', 'no respondió'],
  ])('traduce el motivo %s', (codigo, texto) => {
    datos['outbox'] = [fila({ lastError: codigo })];
    expect(renderToString(<Outbox />)).toContain(texto);
  });

  it('indica «sin CIF» si el distribuidor no lo tiene', () => {
    datos['outbox'] = [fila({ distribuidor: { id: 'd1', nombre: 'Sin CIF S.L.', cif: null } })];
    expect(renderToString(<Outbox />)).toContain('(sin CIF)');
  });

  it('una operación en revisión del coste de proveedor no habla de stock', () => {
    datos['outbox'] = [fila({ status: 'needs_reconciliation', lastError: 'Timeout', proximaComprobacion: null })];
    const html = renderToString(<Outbox />);
    expect(html).toContain('Comprueba en Siweb360 el coste de este proveedor');
    expect(html).not.toContain('Stock que tiene ahora');
  });
});
