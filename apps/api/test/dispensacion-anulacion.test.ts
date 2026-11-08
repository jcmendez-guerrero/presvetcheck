import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { conciliacion, dispensacion, receta, recetaLinea } from '@mmx/db';
import { api, confirmar, crearReceta, entorno, recetaCorrecta, type Entorno } from './entorno';

let E: Entorno;
beforeAll(async () => {
  E = await entorno();
}, 180_000);
afterAll(async () => {
  await E.app.close();
});

const envase = {
  lote: 'CLV-2611',
  caducidad: '2026-11-30',
  unidades: 1,
  metodoCaptura: 'manual',
  cnEscaneado: '570016',
};
const dispensar = (recetaId: string, envases = [envase]) =>
  api(E.app, 'dev-empleado', 'POST', '/api/dispensaciones', {
    conReceta: true,
    recetaId,
    lineaOrden: 1,
    cn: '570016',
    envases,
  });
const anular = (id: string) =>
  api(E.app, 'dev-empleado', 'POST', `/api/dispensaciones/${id}/anular`, {
    motivo: 'Lote mal capturado al escanear',
  });

/** Receta evaluada de una línea con `envases` cajas de 570016. */
async function recetaLista(envases: number) {
  const id = await crearReceta(E.app);
  await confirmar(E.app, id, (r) => {
    const c = recetaCorrecta()(r);
    return { ...c, lineas: c.lineas?.map((l) => ({ ...l, cantidadEnvases: envases })) };
  });
  await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
  return id;
}

async function estados(recetaId: string) {
  const [r] = await E.h.db.select().from(receta).where(eq(receta.id, recetaId));
  const [l] = await E.h.db.select().from(recetaLinea).where(eq(recetaLinea.recetaId, recetaId));
  return { receta: r!.estado, linea: l!.estado };
}

describe('dispensación concurrente y anulación', () => {
  it('otra salida entre las comprobaciones y el guardado (doble clic) → CONFLICTO, sin pasar de lo prescrito', async () => {
    const id = await recetaLista(1);
    // PGlite ejecuta una consulta cada vez: se fuerza el cruce colando la otra petición justo al abrir la
    // transacción de la primera (la primera transacción de una dispensación es la de guardado).
    const db = E.deps.db;
    const original = db.transaction;
    let colada: Awaited<ReturnType<typeof dispensar>> | null = null;
    db.transaction = (async (...args: Parameters<typeof original>) => {
      db.transaction = original;
      colada = await dispensar(id);
      return original.apply(db, args);
    }) as typeof original;
    let r: Awaited<ReturnType<typeof dispensar>>;
    try {
      r = await dispensar(id);
    } finally {
      db.transaction = original;
    }
    expect(colada!.status).toBe(201);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('CONFLICTO');
    expect(await E.h.db.select().from(dispensacion).where(eq(dispensacion.recetaId, id))).toHaveLength(1);
  });

  it('anular recalcula la línea y la receta: parcial, luego pendiente y editable', async () => {
    const id = await recetaLista(2);
    const r = await dispensar(id, [envase, envase]);
    expect(r.status).toBe(201);
    expect(await estados(id)).toEqual({ receta: 'DISPENSADA', linea: 'DISPENSADA' });
    const [a, b] = r.json.dispensaciones as string[];

    expect((await anular(a!)).status).toBe(200);
    expect(await estados(id)).toEqual({ receta: 'DISPENSADA_PARCIAL', linea: 'PENDIENTE_ENTREGA' });

    expect((await anular(b!)).status).toBe(200);
    expect(await estados(id)).toEqual({ receta: 'EVALUADA', linea: 'PENDIENTE' });
    // Ya no consta como dispensada: se puede corregir y volver a dispensar.
    const c = await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`);
    expect(c.json.estado).toBe('EVALUADA');
    expect((await dispensar(id)).status).toBe(201);
  });

  it('el ticket multi-receta no cuenta las salidas anuladas', async () => {
    const t = await api(E.app, 'dev-empleado', 'POST', '/api/demo/tpv', { cn: '570016', unidades: 1 });
    const numero = (t.json as { numero: string }).numero;
    const busq = await api(E.app, 'dev-empleado', 'GET', `/api/conciliacion/tickets?search=${numero}`);
    const ticketId = String((busq.json as { tickets: { id: number }[] }).tickets[0]!.id);

    const id = await recetaLista(2);
    const r = await dispensar(id, [envase, envase]);
    const [anulada, vigente] = r.json.dispensaciones as string[];
    expect((await anular(anulada!)).status).toBe(200);
    await api(E.app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId,
      ticketNumero: numero,
      recetaId: id,
    });

    const det = await api(E.app, 'dev-empleado', 'GET', `/api/conciliacion/tickets/${ticketId}`);
    expect(det.json.puedeConfirmar).toBe(true);
    expect(det.json.conciliacionLineas.find((l: { cn: string }) => l.cn === '570016')).toMatchObject({
      unidadesTicket: 1,
      unidadesDispensadasTotal: 1,
    });
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/conciliacion/tickets/${ticketId}/confirmar`)).status,
    ).toBe(200);
    const conc = await E.h.db.select().from(conciliacion).where(eq(conciliacion.ticket, numero));
    expect(conc.map((c) => c.dispensacionId)).toEqual([vigente]);
  });
});
