import { describe, expect, it } from 'vitest';
import { TicketsSalesMovementsSource } from '../src/ventas';
import type { SiwebClient } from '../src/client';

describe('TicketsSalesMovementsSource - resolución de CN en líneas', () => {
  const fakeClient = {} as SiwebClient;
  const source = new TicketsSalesMovementsSource(fakeClient, 'CN\\s?(\\d{6,7})');

  it('extrae el CN cuando la línea tiene el formato estándar CN123456', () => {
    expect(source.cnDeLinea('CLAVUBAY 400 mg/100 mg comprimidos CN570016')).toBe('570016');
    expect(source.cnDeLinea('BONQAT solución oral CN 590948')).toBe('590948');
  });

  it('extrae el CN si aparece como número de 6 dígitos aislado', () => {
    expect(source.cnDeLinea('BONQAT 50 mg/ml (590948) 2 ml')).toBe('590948');
    expect(source.cnDeLinea('Ref 590948 BONQAT gato')).toBe('590948');
  });

  it('resuelve el CN por nombre de variante en el mapa si la línea carece de CN explícito', () => {
    const mapaVariantes = new Map<string, string>([
      ['BONQAT 50 mg/ml SOLUCION ORAL PARA GATOS', '590948'],
      ['CLAVUBAY 400 mg', '570016'],
    ]);
    const lineaTicket =
      'BONQAT 50 mg/ml SOLUCION ORAL PARA GATOS, Caja con 1 Frasco de 2 ml y una jeringa - EU/2/21/273/001';
    expect(source.cnDeLinea(lineaTicket, mapaVariantes)).toBe('590948');
  });

  it('devuelve null si no es un medicamento identificable', () => {
    const mapaVariantes = new Map<string, string>([['BONQAT 50 mg/ml', '590948']]);
    expect(source.cnDeLinea('Pienso perro adulto 3 kg', mapaVariantes)).toBeNull();
    expect(source.cnDeLinea('', mapaVariantes)).toBeNull();
    expect(source.cnDeLinea(null, mapaVariantes)).toBeNull();
  });
});
