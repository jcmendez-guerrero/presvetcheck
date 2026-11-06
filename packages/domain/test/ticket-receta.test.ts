import { describe, expect, it } from 'vitest';
import {
  validarDesvinculacionTicket,
  validarVinculacionTicket,
  type VinculacionTicketExistente,
} from '../src/conciliacion';

describe('validarVinculacionTicket', () => {
  const vinculacionesExistentes: VinculacionTicketExistente[] = [
    {
      ticketId: 'TKT-001',
      ticketNumero: 'TKT-2026-000001',
      recetaId: 'receta-1',
      estado: 'vinculado',
    },
    {
      ticketId: 'TKT-002',
      ticketNumero: 'TKT-2026-000002',
      recetaId: 'receta-2',
      estado: 'confirmado',
    },
  ];

  it('permite vincular una receta nueva a un ticket existente o nuevo', () => {
    const res = validarVinculacionTicket({
      ticketId: 'TKT-001',
      recetaId: 'receta-3',
      existentes: vinculacionesExistentes,
    });
    expect(res.valido).toBe(true);
  });

  it('rechaza si la receta ya está vinculada a otro ticket (RECETA_YA_VINCULADA)', () => {
    const res = validarVinculacionTicket({
      ticketId: 'TKT-003',
      recetaId: 'receta-1',
      existentes: vinculacionesExistentes,
    });
    expect(res.valido).toBe(false);
    expect(res.error).toBe('RECETA_YA_VINCULADA');
  });

  it('detecta duplicado si la receta ya está en el mismo ticket', () => {
    const res = validarVinculacionTicket({
      ticketId: 'TKT-001',
      recetaId: 'receta-1',
      existentes: vinculacionesExistentes,
    });
    expect(res.valido).toBe(false);
    expect(res.error).toBe('RECETA_YA_VINCULADA');
  });

  it('rechaza vincular a un ticket ya confirmado (TICKET_YA_FINALIZADO)', () => {
    const res = validarVinculacionTicket({
      ticketId: 'TKT-002',
      recetaId: 'receta-3',
      existentes: vinculacionesExistentes,
    });
    expect(res.valido).toBe(false);
    expect(res.error).toBe('TICKET_YA_FINALIZADO');
  });
});

describe('validarDesvinculacionTicket', () => {
  const vinculacionesExistentes: VinculacionTicketExistente[] = [
    {
      ticketId: 'TKT-001',
      ticketNumero: 'TKT-2026-000001',
      recetaId: 'receta-1',
      estado: 'vinculado',
    },
    {
      ticketId: 'TKT-002',
      ticketNumero: 'TKT-2026-000002',
      recetaId: 'receta-2',
      estado: 'confirmado',
    },
  ];

  it('permite desvincular una receta si el ticket no está confirmado', () => {
    const res = validarDesvinculacionTicket({
      ticketId: 'TKT-001',
      recetaId: 'receta-1',
      existentes: vinculacionesExistentes,
    });
    expect(res.valido).toBe(true);
  });

  it('rechaza desvincular si el ticket ya está confirmado (TICKET_YA_FINALIZADO)', () => {
    const res = validarDesvinculacionTicket({
      ticketId: 'TKT-002',
      recetaId: 'receta-2',
      existentes: vinculacionesExistentes,
    });
    expect(res.valido).toBe(false);
    expect(res.error).toBe('TICKET_YA_FINALIZADO');
  });

  it('rechaza desvincular si no existe la vinculación (NO_ENCONTRADO)', () => {
    const res = validarDesvinculacionTicket({
      ticketId: 'TKT-001',
      recetaId: 'receta-inexistente',
      existentes: vinculacionesExistentes,
    });
    expect(res.valido).toBe(false);
    expect(res.error).toBe('NO_ENCONTRADO');
  });
});
