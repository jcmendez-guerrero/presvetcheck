import { describe, expect, it, vi } from 'vitest';
import { auditEvent, dispensacion, outbox, pedidoPendiente, siwebVariantMap, ticketDemo } from '@mmx/db';
import { eq } from 'drizzle-orm';
import {
  ACTIVA,
  altaManual,
  api,
  confirmar,
  crearReceta,
  datosManuales,
  entorno,
  recetaCorrecta,
} from './entorno';

/**
 * specs/016: la evaluación respeta el modo formación guardado en la revisión. La venta ya ocurrió y el TPV
 * descontó el stock, así que la línea se juzga con las ventas del día original, no con el stock de hoy.
 * Siweb360 se simula siempre (nunca se llama al servicio real).
 */
const FECHA = '2026-09-15';

const venta = (cantidad: number) => ({
  id: 1,
  variant_id: 9001,
  quantity: -cantidad,
  reason: 'sale_shipment',
  reference_number: 'T-0001',
});

async function recetaEnFormacion(app: Parameters<typeof api>[0], fechaOriginal: string | null = FECHA) {
  const id = await crearReceta(app);
  await confirmar(app, id, (base) => ({
    ...recetaCorrecta('R-COMPLETA')(base),
    modo: 'retrospectivo',
    fechaOriginal,
  }));
  return id;
}

async function conSiweb(
  config: Record<string, string>,
  movements: () => Promise<unknown[]>,
  stock: Record<string, never[]> = { '570016': [] },
) {
  const env = await entorno({ config, stock });
  // La BD se comparte por fichero: el mapa de variantes se siembra una sola vez.
  await env.h.db
    .insert(siwebVariantMap)
    .values({ cn: '570016', variantId: 9001, metodo: 'manual' })
    .onConflictDoNothing();
  env.deps.siweb = { ...(env.deps.siweb ?? {}), client: { movements } } as never;
  return env;
}

describe('Evaluación en modo formación (specs/016)', () => {
  it('con la venta del día original y sin stock hoy, la línea se puede dispensar y no se propone pedir', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => [venta(1)]);
    const id = await recetaEnFormacion(app);
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(r.status).toBe(200);
    const linea = r.json.lineas[0];
    expect(linea.resultado.decision).toBe('DISPENSAR');
    expect(linea.resultado.evidencias.pedido ?? null).toBeNull();
    await app.close();
  });

  it('sin venta ese día la línea queda bloqueada pero forzable con motivo', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => []);
    const id = await recetaEnFormacion(app);
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    const linea = r.json.lineas[0];
    expect(linea.resultado.decision).toBe('NO_CONFORME');
    expect(linea.resultado.evidencias.forzable).toBe(true);
    expect(linea.incidencias.map((i: { code: string }) => i.code)).toContain(
      'SIN_MOVIMIENTO_STOCK_RETROSPECTIVO',
    );
    await app.close();
  });

  it('si Siweb360 no responde, no se da la venta por inexistente (503)', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, () =>
      Promise.reject(new Error('ECONNRESET')),
    );
    const id = await recetaEnFormacion(app);
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('SIWEB_NO_DISPONIBLE');
    await app.close();
  });

  it('con el modo formación desactivado la API lo rechaza (403)', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'disabled' }, async () => [venta(1)]);
    const id = await recetaEnFormacion(app);
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('MODO_RETROSPECTIVO_DESHABILITADO');
    await app.close();
  });

  it('una fecha original futura se rechaza', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => [venta(1)]);
    const id = await recetaEnFormacion(app, '2099-01-01');
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('FECHA_ORIGINAL_INVALIDA');
    await app.close();
  });

  it('una receta en vivo sin stock sigue sin dispensarse (regresión)', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => [venta(1)]);
    const id = await crearReceta(app);
    await confirmar(app, id, recetaCorrecta('R-COMPLETA'));
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(r.status).toBe(200);
    expect(r.json.lineas[0].resultado.decision).not.toBe('DISPENSAR');
    await app.close();
  });
});

const SIN_VENTA = 'SIN_MOVIMIENTO_STOCK_RETROSPECTIVO';
const FORZAR = {
  codigos: [SIN_VENTA],
  motivo: 'Venta de formación sin ticket en Siweb360',
  aceptaRiesgos: true,
};

describe('Casos límite de la evaluación en formación (specs/016)', () => {
  it('una venta parcial no basta: incidencia forzable y sin pedido', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => [venta(1)]);
    const id = await crearReceta(app);
    await confirmar(app, id, (base) => {
      const r = recetaCorrecta('R-PARCIAL')(base);
      return {
        ...r,
        modo: 'retrospectivo',
        fechaOriginal: FECHA,
        lineas: r.lineas.map((l) => ({ ...l, cantidadEnvases: 2 })),
      };
    });
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    const linea = r.json.lineas[0];
    expect(linea.resultado.decision).toBe('NO_CONFORME');
    expect(linea.incidencias.map((i: { code: string }) => i.code)).toContain(SIN_VENTA);
    expect(linea.resultado.evidencias.forzable).toBe(true);
    expect(linea.resultado.evidencias.pedido ?? null).toBeNull();
    await app.close();
  });

  it('una fecha original anterior al plazo avisa, sin bloquear', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => [venta(1)]);
    const id = await recetaEnFormacion(app, '2026-06-01'); // el reloj de pruebas marca 2026-10-14; plazo 90 días
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(r.status).toBe(200);
    const linea = r.json.lineas[0];
    expect(linea.incidencias.map((i: { code: string }) => i.code)).toContain(
      'AVISO_FECHA_RETROSPECTIVA_ANTIGUA',
    );
    // El aviso es una incidencia más: la decisión sigue siendo DISPENSAR (DISPENSAR_CON_AVISO es la de stock alternativo).
    expect(linea.resultado.decision).toBe('DISPENSAR');
    await app.close();
  });

  it('el forzado con motivo se acepta; un bloqueo duro sigue sin poder forzarse', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => []);
    const id = await recetaEnFormacion(app);
    const forzada = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {
      forzados: { '1': FORZAR },
    });
    expect(forzada.status).toBe(200);
    expect(forzada.json.lineas[0].resultado.decision).not.toBe('NO_CONFORME');

    // Receta caducada en la fecha de referencia: bloqueo duro, ni con motivo se puede forzar.
    const dura = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {
      fechaReferencia: '2027-12-31',
      forzados: { '1': { ...FORZAR, codigos: [SIN_VENTA, 'RECETA_CADUCADA'] } },
    });
    expect(dura.status).toBe(422);
    await app.close();
  });
});

describe('Regresión: recetas que no son de formación (specs/016, US3)', () => {
  it('el alta manual conserva su camino: no consulta movimientos de Siweb360', async () => {
    const movements = vi.fn(async () => []);
    const { app } = await conSiweb(
      { ...ACTIVA.config, RETROSPECTIVE_DISPENSATION_MODE: 'enabled' },
      movements,
    );
    const id = await altaManual(app);
    await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datosManuales('RM-FORM-016'));
    const r = await api(app, 'dev-veterinaria', 'POST', `/api/recetas/${id}/evaluar`, {
      fechaReferencia: '2026-10-04',
    });
    expect(r.status).toBe(200);
    expect(r.json.lineas[0].resultado.decision).toBe('DISPENSAR');
    expect(movements).not.toHaveBeenCalled();
    await app.close();
  });

  it('con el modo formación desactivado, una receta en vivo se evalúa como siempre', async () => {
    const movements = vi.fn(async () => []);
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'disabled' }, movements, undefined);
    const id = await crearReceta(app);
    await confirmar(app, id, recetaCorrecta('R-VIVO-OFF'));
    const r = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(r.status).toBe(200);
    expect(movements).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('Ticket ya emitido en formación (specs/016, FR-005 y FR-010)', () => {
  it('evaluar, dispensar y vincular un ticket «Pagado» no crea pedido, venta ni salida de stock', async () => {
    const { app, h } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => []);
    // Ticket ya cobrado en el TPV (simulado, estado «Pagado»).
    const t = await api(app, 'dev-empleado', 'POST', '/api/demo/tpv', { cn: '570016', unidades: 1 });
    const numero = (t.json as { numero: string }).numero;
    const busq = await api(app, 'dev-empleado', 'GET', `/api/conciliacion/tickets?search=${numero}`);
    const ticketId = String((busq.json as { tickets: { id: number }[] }).tickets[0]!.id);
    const antes = {
      pedidos: (await h.db.select().from(pedidoPendiente)).length,
      ventas: (await h.db.select().from(ticketDemo)).length,
      salidas: (await h.db.select().from(outbox)).length,
    };

    const id = await recetaEnFormacion(app);
    const ev = await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.json.lineas[0].resultado.decision).toBe('NO_CONFORME'); // sin venta ese día

    const cuerpo = {
      conReceta: true,
      recetaId: id,
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
      modo: 'retrospectivo',
      fechaOriginal: FECHA,
    };
    const sinForzar = await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', cuerpo);
    expect(sinForzar.status).toBe(422);
    const disp = await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      ...cuerpo,
      forzado: FORZAR,
    });
    expect(disp.status).toBe(201);
    const dispId = (disp.json as { dispensaciones: string[] }).dispensaciones[0]!;
    const [d] = await h.db.select().from(dispensacion).where(eq(dispensacion.id, dispId));
    expect(d).toMatchObject({ modo: 'retrospectivo', fechaOriginal: FECHA });

    const vincular = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId,
      ticketNumero: numero,
      recetaId: id,
    });
    expect(vincular.status).toBeLessThan(300);
    const detalle = await api(app, 'dev-empleado', 'GET', `/api/conciliacion/tickets/${ticketId}`);
    expect(detalle.status).toBe(200);
    expect(JSON.stringify(detalle.json)).toContain(id);

    expect(await h.db.select().from(pedidoPendiente)).toHaveLength(antes.pedidos);
    expect(await h.db.select().from(ticketDemo)).toHaveLength(antes.ventas);
    expect(await h.db.select().from(outbox)).toHaveLength(antes.salidas);
    const auditoria = await h.db.select().from(auditEvent).where(eq(auditEvent.accion, 'dispensar'));
    expect(JSON.stringify(auditoria.map((a) => a.despues))).toContain(SIN_VENTA);
    await app.close();
  });
});
