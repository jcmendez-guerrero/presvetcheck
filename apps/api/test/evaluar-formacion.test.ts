import { describe, expect, it } from 'vitest';
import { siwebVariantMap } from '@mmx/db';
import { api, confirmar, crearReceta, entorno, recetaCorrecta } from './entorno';

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
  await env.h.db.insert(siwebVariantMap).values({ cn: '570016', variantId: 9001, metodo: 'manual' });
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

describe('Ticket ya emitido en formación (specs/016, FR-005 y FR-010)', () => {
  it('la receta en formación se vincula al ticket ya cobrado y el operador puede consultarlo', async () => {
    const { app } = await conSiweb({ RETROSPECTIVE_DISPENSATION_MODE: 'enabled' }, async () => [venta(1)]);
    const id = await recetaEnFormacion(app);
    const vincular = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId: 'TKT-FORMACION-1',
      ticketNumero: 'TKT-FORMACION-1',
      recetaId: id,
    });
    expect(vincular.status).toBeLessThan(300);
    const detalle = await api(app, 'dev-empleado', 'GET', '/api/conciliacion/tickets/TKT-FORMACION-1');
    expect(detalle.status).toBe(200);
    expect(JSON.stringify(detalle.json)).toContain(id);
    await app.close();
  });
});
