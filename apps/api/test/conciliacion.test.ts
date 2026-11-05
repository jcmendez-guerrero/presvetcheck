import { describe, expect, it } from 'vitest';
import { api, entorno } from './entorno';
import { auditEvent, conciliacion, dispensacion, receta } from '@mmx/db';
import { eq } from 'drizzle-orm';

describe('Conciliación asistida y búsqueda de tickets', () => {
  it('permite buscar tickets por número y asociar manualmente una salida', async () => {
    const { app, h } = await entorno();

    // 1. Simular un cobro en el TPV
    const cobro = await api(app, 'dev-empleado', 'POST', '/api/demo/tpv', {
      cn: '590948',
      unidades: 1,
    });
    expect(cobro.status).toBe(201);
    const numeroTicket = (cobro.json as { numero: string }).numero;

    // 2. Buscar tickets por número
    const busqueda = await api(
      app,
      'dev-empleado',
      'GET',
      `/api/conciliacion/tickets?search=${numeroTicket.slice(0, 8)}`,
    );
    expect(busqueda.status).toBe(200);
    const tickets = (busqueda.json as { tickets: Array<{ numero: string }> }).tickets;
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.some((t) => t.numero === numeroTicket)).toBe(true);

    // 3. Crear una receta y una dispensación de prueba
    const recetaId = '0192e212-3456-7890-abcd-ef0123456789';
    const dispId = '0192e212-3456-7890-abcd-ef012345678a';
    await h.db.insert(receta).values({
      id: recetaId,
      tipo: 'papel',
      estado: 'DISPENSADA',
      creadaPor: 'dev-empleado',
      fechaEmision: '2026-10-14',
      createdAt: new Date('2026-10-14T10:00:00Z'),
      updatedAt: new Date('2026-10-14T10:00:00Z'),
    });
    await h.db.insert(dispensacion).values({
      id: dispId,
      recetaId,
      canal: 'presencial',
      conReceta: true,
      metodoCaptura: 'manual',
      cn: '590948',
      nombreFarmaco: 'BONQAT 50 mg/ml SOLUCION ORAL PARA GATOS',
      lote: '3038691',
      caducidad: '2028-12-31',
      unidades: 1,
      fechaVenta: new Date('2026-10-14T10:05:00Z'),
      empleado: 'dev-empleado',
    });

    // 4. Asociar manualmente la salida al ticket
    const asoc = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/asociar', {
      dispensacionId: dispId,
      ticketId: 1,
      ticketNumero: numeroTicket,
      lineaId: 1,
      nota: 'Asociación manual de prueba',
    });
    expect(asoc.status).toBe(200);
    expect((asoc.json as { ok: boolean }).ok).toBe(true);

    // 5. Verificar que se registró en la tabla conciliacion con origen 'manual'
    const [c] = await h.db.select().from(conciliacion).where(eq(conciliacion.dispensacionId, dispId));
    expect(c).toBeDefined();
    expect(c?.ticket).toBe(numeroTicket);
    expect(c?.origen).toBe('manual');

    // 6. Verificar traza en audit_event
    const [audit] = await h.db.select().from(auditEvent).where(eq(auditEvent.entidadId, dispId));
    expect(audit).toBeDefined();
    expect(audit?.accion).toBe('conciliar');

    // 7. Intentar asociar nuevamente devuelve conflicto
    const reasoc = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/asociar', {
      dispensacionId: dispId,
      ticketId: 1,
      ticketNumero: numeroTicket,
    });
    expect(reasoc.status).toBe(409);
  });
});
