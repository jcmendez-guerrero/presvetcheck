import { describe, expect, it } from 'vitest';
import {
  conciliarTicketMultiReceta,
  type DispensacionMultiRx,
  type LineaTicketItem,
} from '../src/conciliacion';

describe('Conciliación de ticket multi-receta (D-11)', () => {
  it('valida coincidencia exacta agrupando múltiples recetas con el mismo CN', () => {
    const ticketItems: LineaTicketItem[] = [
      { cn: '570016', nombre: 'Clavubay 250mg', unidades: 4 },
      { cn: '654321', nombre: 'Meloxicam 1.5mg', unidades: 1 },
    ];

    const dispensaciones: DispensacionMultiRx[] = [
      { id: 'd1', recetaId: 'rx-1', cn: '570016', nombreFarmaco: 'Clavubay', unidades: 2 },
      { id: 'd2', recetaId: 'rx-2', cn: '570016', nombreFarmaco: 'Clavubay', unidades: 2 },
      { id: 'd3', recetaId: 'rx-2', cn: '654321', nombreFarmaco: 'Meloxicam', unidades: 1 },
    ];

    const resultado = conciliarTicketMultiReceta({ ticketItems, dispensaciones });

    expect(resultado.puedeConfirmar).toBe(true);
    expect(resultado.bloqueos).toHaveLength(0);
    expect(resultado.lineas).toHaveLength(2);

    const clav = resultado.lineas.find((l) => l.cn === '570016');
    expect(clav).toBeDefined();
    expect(clav?.unidadesTicket).toBe(4);
    expect(clav?.unidadesDispensadasTotal).toBe(4);
    expect(clav?.estadoLinea).toBe('COINCIDE');

    const mel = resultado.lineas.find((l) => l.cn === '654321');
    expect(mel).toBeDefined();
    expect(mel?.unidadesTicket).toBe(1);
    expect(mel?.unidadesDispensadasTotal).toBe(1);
    expect(mel?.estadoLinea).toBe('COINCIDE');
  });

  it('bloquea la confirmación si las unidades dispensadas superan las del ticket (EXCESO_DISPENSADO)', () => {
    const ticketItems: LineaTicketItem[] = [{ cn: '570016', nombre: 'Clavubay 250mg', unidades: 4 }];

    const dispensaciones: DispensacionMultiRx[] = [
      { id: 'd1', recetaId: 'rx-1', cn: '570016', nombreFarmaco: 'Clavubay', unidades: 3 },
      { id: 'd2', recetaId: 'rx-2', cn: '570016', nombreFarmaco: 'Clavubay', unidades: 2 }, // Total 5 > 4
    ];

    const resultado = conciliarTicketMultiReceta({ ticketItems, dispensaciones });

    expect(resultado.puedeConfirmar).toBe(false);
    expect(resultado.bloqueos.length).toBeGreaterThan(0);
    expect(resultado.bloqueos[0]).toContain('570016');

    const clav = resultado.lineas.find((l) => l.cn === '570016');
    expect(clav?.estadoLinea).toBe('EXCESO_DISPENSADO');
    expect(clav?.unidadesTicket).toBe(4);
    expect(clav?.unidadesDispensadasTotal).toBe(5);
  });

  it('permite confirmar con advertencia si el ticket contiene más unidades o artículos sin receta', () => {
    const ticketItems: LineaTicketItem[] = [
      { cn: '570016', nombre: 'Clavubay 250mg', unidades: 4 },
      { cn: '999999', nombre: 'Pienso dietético', unidades: 1 },
    ];

    const dispensaciones: DispensacionMultiRx[] = [
      { id: 'd1', recetaId: 'rx-1', cn: '570016', nombreFarmaco: 'Clavubay', unidades: 2 }, // 2 de 4 en ticket
    ];

    const resultado = conciliarTicketMultiReceta({ ticketItems, dispensaciones });

    expect(resultado.puedeConfirmar).toBe(true);
    expect(resultado.bloqueos).toHaveLength(0);

    const clav = resultado.lineas.find((l) => l.cn === '570016');
    expect(clav?.estadoLinea).toBe('DEFICIT_TICKET');

    const pienso = resultado.lineas.find((l) => l.cn === '999999');
    expect(pienso?.estadoLinea).toBe('SIN_DISPENSACION');
  });

  it('no permite confirmar si no hay ninguna dispensación', () => {
    const ticketItems: LineaTicketItem[] = [{ cn: '570016', nombre: 'Clavubay 250mg', unidades: 2 }];

    const resultado = conciliarTicketMultiReceta({ ticketItems, dispensaciones: [] });

    expect(resultado.puedeConfirmar).toBe(false);
    expect(resultado.bloqueos).toContain('No hay dispensaciones vinculadas al ticket');
  });
});
