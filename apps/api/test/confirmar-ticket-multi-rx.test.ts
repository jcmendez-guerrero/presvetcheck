import { describe, expect, it } from 'vitest';
import { api, confirmar, crearReceta, entorno, recetaCorrecta } from './entorno';
import { conciliacion, ticketReceta } from '@mmx/db';
import { eq } from 'drizzle-orm';

describe('Conciliación y confirmación de ticket multi-receta (D-11, US3)', () => {
  it('obtiene detalle consolidado y confirma el ticket cuando las unidades coinciden', async () => {
    const { app, h } = await entorno();

    // 1. Crear un ticket simulado en el TPV con 2 unidades de CN 570016
    const cobroRes = await api(app, 'dev-empleado', 'POST', '/api/demo/tpv', {
      cn: '570016',
      unidades: 2,
    });
    expect(cobroRes.status).toBe(201);
    const ticketNumero = (cobroRes.json as { numero: string }).numero;

    // Buscar el ticket para conocer su id
    const busq = await api(app, 'dev-empleado', 'GET', `/api/conciliacion/tickets?search=${ticketNumero}`);
    expect(busq.status).toBe(200);
    const tickets = (busq.json as { tickets: { id: number; numero: string }[] }).tickets;
    expect(tickets.length).toBeGreaterThan(0);
    const ticketId = String(tickets[0]!.id);

    // 2. Crear receta 1 y dispensar 1 unidad
    const rx1 = await crearReceta(app);
    await confirmar(app, rx1, recetaCorrecta('R-COMPLETA-1'));
    await api(app, 'dev-empleado', 'POST', `/api/recetas/${rx1}/evaluar`, {});
    const d1 = await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: rx1,
      lineaOrden: 1,
      cn: '570016',
      envases: [
        {
          lote: 'CLV-2611',
          caducidad: '2026-11-30',
          unidades: 1,
          metodoCaptura: 'manual',
          cnEscaneado: '570016',
        },
      ],
    });
    expect(d1.status).toBe(201);

    // 3. Crear receta 2 y dispensar 1 unidad
    const rx2 = await crearReceta(app);
    await confirmar(app, rx2, recetaCorrecta('R-COMPLETA-2'));
    await api(app, 'dev-empleado', 'POST', `/api/recetas/${rx2}/evaluar`, {});
    const d2 = await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: rx2,
      lineaOrden: 1,
      cn: '570016',
      envases: [
        {
          lote: 'CLV-2611',
          caducidad: '2026-11-30',
          unidades: 1,
          metodoCaptura: 'manual',
          cnEscaneado: '570016',
        },
      ],
    });
    expect(d2.status).toBe(201);

    // 4. Vincular ambas recetas al mismo ticket
    const v1 = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId,
      ticketNumero,
      recetaId: rx1,
    });
    expect(v1.status).toBe(200);

    const v2 = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId,
      ticketNumero,
      recetaId: rx2,
    });
    expect(v2.status).toBe(200);

    // 5. Consultar detalle consolidado del ticket
    const detRes = await api(app, 'dev-empleado', 'GET', `/api/conciliacion/tickets/${ticketId}`);
    expect(detRes.status).toBe(200);
    const detalle = detRes.json as {
      ticketId: string;
      ticketNumero: string;
      estado: string;
      recetas: { recetaId: string }[];
      conciliacionLineas: {
        cn: string;
        unidadesTicket: number;
        unidadesDispensadasTotal: number;
        estadoLinea: string;
      }[];
      puedeConfirmar: boolean;
      bloqueos: string[];
    };

    expect(detalle.ticketId).toBe(ticketId);
    expect(detalle.ticketNumero).toBe(ticketNumero);
    expect(detalle.estado).toBe('vinculado');
    expect(detalle.recetas.map((r) => r.recetaId)).toContain(rx1);
    expect(detalle.recetas.map((r) => r.recetaId)).toContain(rx2);
    expect(detalle.puedeConfirmar).toBe(true);
    expect(detalle.bloqueos).toHaveLength(0);

    const linea570016 = detalle.conciliacionLineas.find((l) => l.cn === '570016');
    expect(linea570016).toBeDefined();
    expect(linea570016?.unidadesTicket).toBe(2);
    expect(linea570016?.unidadesDispensadasTotal).toBe(2);
    expect(linea570016?.estadoLinea).toBe('COINCIDE');

    // 6. Confirmar el ticket
    const confRes = await api(app, 'dev-empleado', 'POST', `/api/conciliacion/tickets/${ticketId}/confirmar`);
    expect(confRes.status).toBe(200);
    expect(confRes.json).toMatchObject({
      ok: true,
      ticketId,
      ticketNumero,
    });

    // 7. Verificar estado 'confirmado' en la base de datos
    const filasTicketReceta = await h.db
      .select()
      .from(ticketReceta)
      .where(eq(ticketReceta.ticketId, ticketId));
    expect(filasTicketReceta.every((r) => r.estado === 'confirmado')).toBe(true);

    // Verificar que se crearon filas en conciliacion
    const concRows = await h.db.select().from(conciliacion).where(eq(conciliacion.ticket, ticketNumero));
    expect(concRows.length).toBe(2);

    // 8. Intentar confirmar de nuevo debe arrojar TICKET_YA_FINALIZADO (409)
    const confDup = await api(app, 'dev-empleado', 'POST', `/api/conciliacion/tickets/${ticketId}/confirmar`);
    expect(confDup.status).toBe(409);
    expect((confDup.json as { error: { code: string } }).error.code).toBe('TICKET_YA_FINALIZADO');

    await app.close();
  }, 30_000);

  it('bloquea la confirmación si las unidades dispensadas exceden las del ticket', async () => {
    const { app } = await entorno();

    // 1. Cobro en TPV de solo 1 unidad
    const cobroRes = await api(app, 'dev-empleado', 'POST', '/api/demo/tpv', {
      cn: '570016',
      unidades: 1,
    });
    const ticketNumero = (cobroRes.json as { numero: string }).numero;

    const busq = await api(app, 'dev-empleado', 'GET', `/api/conciliacion/tickets?search=${ticketNumero}`);
    const ticketId = String((busq.json as { tickets: { id: number }[] }).tickets[0]!.id);

    // 2. Dispensar 2 unidades (o dos recetas de 1 unidad cada una)
    const rx1 = await crearReceta(app);
    await confirmar(app, rx1, recetaCorrecta('R-EXCESO-1'));
    await api(app, 'dev-empleado', 'POST', `/api/recetas/${rx1}/evaluar`, {});
    await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: rx1,
      lineaOrden: 1,
      cn: '570016',
      envases: [
        {
          lote: 'CLV-2611',
          caducidad: '2026-11-30',
          unidades: 1,
          metodoCaptura: 'manual',
          cnEscaneado: '570016',
        },
      ],
    });

    const rx2 = await crearReceta(app);
    await confirmar(app, rx2, recetaCorrecta('R-EXCESO-2'));
    await api(app, 'dev-empleado', 'POST', `/api/recetas/${rx2}/evaluar`, {});
    await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: rx2,
      lineaOrden: 1,
      cn: '570016',
      envases: [
        {
          lote: 'CLV-2611',
          caducidad: '2026-11-30',
          unidades: 1,
          metodoCaptura: 'manual',
          cnEscaneado: '570016',
        },
      ],
    });

    // Vincular ambas (total dispensado = 2 > 1 del ticket)
    const v1 = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId,
      ticketNumero,
      recetaId: rx1,
    });
    expect(v1.status).toBe(200);
    const v2 = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId,
      ticketNumero,
      recetaId: rx2,
    });
    expect(v2.status).toBe(200);

    // 3. Confirmar debe fallar con 422 TICKET_CANTIDAD_INSUFICIENTE
    const confFail = await api(
      app,
      'dev-empleado',
      'POST',
      `/api/conciliacion/tickets/${ticketId}/confirmar`,
    );
    expect(confFail.status).toBe(422);
    expect((confFail.json as { error: { code: string } }).error.code).toBe('TICKET_CANTIDAD_INSUFICIENTE');

    await app.close();
  }, 30_000);
});
