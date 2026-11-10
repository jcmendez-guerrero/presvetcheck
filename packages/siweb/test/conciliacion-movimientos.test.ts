import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { eq } from 'drizzle-orm';
import {
  conciliacion,
  dispensacion,
  distribuidor,
  movimientoJustificacion,
  recepcion,
  recepcionLinea,
  siwebMovimiento,
  siwebVariantMap,
  type DbHandle,
} from '@mmx/db';
import { createTestDb } from '@mmx/db/testing';
import { SiwebClient } from '../src/client';
import {
  conciliarMovimientosDia,
  justificarMovimiento,
  listarMovimientos,
} from '../src/conciliacion-movimientos';

const BASE = 'https://siweb.test/api/public/';
const fx = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/siweb', f), 'utf8'));
const server = setupServer();
const client = new SiwebClient({ baseUrl: BASE, token: 't', rps: 1000, sleep: async () => {}, pageLimit: 3 });
const AHORA = new Date('2026-11-04T20:00:00Z');
const CORTE = '2026-11-01';

let h: DbHandle;
let lineaId = '';
let dispId = '';
let clave = '';
let consultas: URLSearchParams[] = [];

/** Historial derivado de fixtures/siweb/movements-conciliacion.json, servido en páginas de 3. */
function historial() {
  const doc = fx('movements-conciliacion.json');
  const data = doc.data.map((m: { notes: string | null }) =>
    m.notes?.startsWith('MMX-REC-') ? { ...m, notes: clave } : m,
  );
  return http.get(`${BASE}inventory/movements`, ({ request }) => {
    const u = new URL(request.url);
    consultas.push(u.searchParams);
    const page = Number(u.searchParams.get('page') ?? 1);
    return HttpResponse.json({
      success: true,
      data: data.slice((page - 1) * 3, page * 3),
      pagination: { page, limit: 3, total: data.length, pages: Math.ceil(data.length / 3) },
    });
  });
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  h = await createTestDb({ seed: true });
  await h.db.insert(siwebVariantMap).values({ cn: '570016', variantId: 9001, metodo: 'manual' });
  const [d] = await h.db.select().from(distribuidor).limit(1);
  const [r] = await h.db
    .insert(recepcion)
    .values({ distribuidorId: d!.id, fechaCompra: '2026-11-03', empleado: 'dev-empleado' })
    .returning();
  const [l] = await h.db
    .insert(recepcionLinea)
    .values({
      recepcionId: r!.id,
      numero: 1,
      cn: '570016',
      nombreFarmaco: 'CLAVUBAY',
      lote: 'B2026',
      caducidad: '2027-06-30',
      unidades: 5,
      origenDatos: 'cimavet',
      siwebVariantId: 9001,
      empleado: 'dev-empleado',
    })
    .returning();
  lineaId = l!.id;
  clave = `MMX-REC-${r!.id}-L1`;
  const [disp] = await h.db
    .insert(dispensacion)
    .values({
      canal: 'presencial',
      conReceta: true,
      cn: '570016',
      nombreFarmaco: 'CLAVUBAY',
      lote: 'B2026',
      unidades: 1,
      metodoCaptura: 'manual',
      empleado: 'dev-empleado',
      fechaVenta: new Date('2026-11-03T11:30:00Z'),
    })
    .returning();
  dispId = disp!.id;
  await h.db.insert(conciliacion).values({
    dispensacionId: dispId,
    movimientoId: '7001:1',
    ticket: 'T-2026-000101',
    loteVerificado: false,
    origen: 'sales-reconciliation',
    at: AHORA,
  });
}, 60_000);
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await h.close();
});

describe('conciliación nocturna de movimientos de Siweb360 (specs/011, US3)', () => {
  it('sin fecha de corte no hace nada', async () => {
    expect(
      await conciliarMovimientosDia(h.db, client, { corte: undefined, almacenId: 21, ahora: AHORA }),
    ).toEqual({
      inactivo: 'sin fecha de corte (ENTRY_CUTOVER_DATE)',
    });
  });

  it('lee todas las páginas, guarda, vincula entrada y venta y deja en la bandeja la rotura y la entrada manual', async () => {
    consultas = [];
    server.use(historial());
    const r = await conciliarMovimientosDia(h.db, client, { corte: CORTE, almacenId: 21, ahora: AHORA });
    expect(r).toEqual({ leidos: 6, nuevos: 6, vinculados: 2, sinJustificar: 2 });
    expect(consultas.map((q) => q.get('page'))).toEqual(['1', '2']);
    expect(consultas[0]?.get('warehouse_id')).toBe('21');
    expect(consultas[0]?.get('date_from')).toBe(CORTE);
    expect(consultas[0]?.get('date_to')).toBe('2026-11-04');

    const j = await h.db.select().from(movimientoJustificacion);
    expect(
      j.map((x) => [x.movimientoId, x.tipo, x.recepcionLineaId ?? x.dispensacionId, x.actor]).sort(),
    ).toEqual([
      [80001, 'AUTO_RECEPCION', lineaId, 'sales-reconciliation'],
      [80002, 'AUTO_VENTA', dispId, 'sales-reconciliation'],
    ]);
    const bandeja = await listarMovimientos(h.db, { corte: CORTE, estado: 'sin_justificar' });
    // 80005 es de una variante no mapeada y 80006 es anterior al corte: no aparecen.
    expect(bandeja.map((b) => [b.id, b.unidades, b.motivoSiweb, b.lote])).toEqual([
      [80003, -1, 'damage', 'A2026'],
      [80004, 3, 'purchase_receipt', 'C2026'],
    ]);
    // La hora sin zona de Siweb360 se interpreta en Madrid (10:15 CET = 09:15 UTC).
    const [m] = await h.db.select().from(siwebMovimiento).where(eq(siwebMovimiento.id, 80001));
    expect(m?.createdAtSiweb.toISOString()).toBe('2026-11-03T09:15:00.000Z');
  });

  it('releer la misma noche no duplica movimientos ni vínculos', async () => {
    consultas = [];
    server.use(historial());
    const r = await conciliarMovimientosDia(h.db, client, { corte: CORTE, almacenId: 21, ahora: AHORA });
    expect(r).toEqual({ leidos: 6, nuevos: 0, vinculados: 0, sinJustificar: 2 });
    // Relee desde el día anterior al último guardado.
    expect(consultas[0]?.get('date_from')).toBe('2026-11-03');
    expect(await h.db.select().from(movimientoJustificacion)).toHaveLength(2);
  });

  it('justificar una rotura la saca de la bandeja; sustituirla deja las dos filas y no edita', async () => {
    const j1 = await justificarMovimiento(
      h.db,
      80003,
      { tipo: 'MOTIVO', motivo: 'ROTURA', nota: 'Caja rota en el almacén' },
      'dev-empleado',
      AHORA,
    );
    let bandeja = await listarMovimientos(h.db, { corte: CORTE, estado: 'sin_justificar' });
    expect(bandeja.map((b) => b.id)).toEqual([80004]);
    const j2 = await justificarMovimiento(
      h.db,
      80003,
      { tipo: 'MOTIVO', motivo: 'CADUCADO', nota: 'En realidad estaba caducado' },
      'dev-empleado',
      AHORA,
    );
    expect(j2.sustituyeA).toBe(j1.id);
    const justificados = await listarMovimientos(h.db, { corte: CORTE, estado: 'justificados' });
    expect(justificados.find((b) => b.id === 80003)?.justificacion?.motivo).toBe('CADUCADO');
    bandeja = await listarMovimientos(h.db, { corte: CORTE, estado: 'sin_justificar' });
    expect(bandeja.map((b) => b.id)).toEqual([80004]);
  });

  it('valida el motivo con el sentido del movimiento y que exista el registro vinculado', async () => {
    await expect(
      justificarMovimiento(
        h.db,
        80004,
        { tipo: 'MOTIVO', motivo: 'ROTURA', nota: 'No es una salida' },
        'u',
        AHORA,
      ),
    ).rejects.toMatchObject({ code: 'MOTIVO_INCOMPATIBLE' });
    const vincular = (recepcionLineaId: string) =>
      justificarMovimiento(
        h.db,
        80004,
        { tipo: 'VINCULO_RECEPCION', recepcionLineaId, nota: 'Dada de alta a mano por error' },
        'dev-empleado',
        AHORA,
      );
    await expect(vincular('00000000-0000-4000-8000-00000000abcd')).rejects.toMatchObject({
      code: 'CONFLICTO',
    });
    // La recepción sigue abierta y es del día anterior al movimiento: no se puede vincular (FR-009b).
    await expect(vincular(lineaId)).rejects.toMatchObject({ code: 'CONFLICTO' });
    await expect(
      justificarMovimiento(h.db, 123, { tipo: 'MOTIVO', motivo: 'OTRO', nota: 'No existe' }, 'u', AHORA),
    ).rejects.toMatchObject({ code: 'NO_ENCONTRADO' });
    // Finalizada y del mismo día, la entrada manual se vincula a mano a la línea de recepción.
    const [l] = await h.db.select().from(recepcionLinea).where(eq(recepcionLinea.id, lineaId));
    await h.db
      .update(recepcion)
      .set({ estado: 'FINALIZADA', fechaRecepcion: '2026-11-04' })
      .where(eq(recepcion.id, l!.recepcionId));
    await vincular(lineaId);
    expect(await listarMovimientos(h.db, { corte: CORTE, estado: 'sin_justificar' })).toEqual([]);
  });
});
