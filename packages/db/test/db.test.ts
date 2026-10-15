import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../src/testing';
import type { DbHandle } from '../src/client';
import { appendAudit, verifyAuditChain } from '../src/audit';
import { ColumnCipher, maskDni } from '../src/crypto';
import {
  auditEvent,
  cimavetMaestra,
  dispensacion,
  distribuidor,
  plataformaRecetaElectronica,
  recepcion,
  recepcionLinea,
  reglaVersion,
  MAESTRA,
} from '../src/schema';

let h: DbHandle;

/** Drizzle envuelve el error de PostgreSQL: se busca el mensaje en la cadena de `cause`. */
async function expectPgError(p: PromiseLike<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    const msgs: string[] = [];
    for (let c: unknown = e; c; c = (c as { cause?: unknown }).cause) msgs.push(String((c as Error).message));
    expect(msgs.join(' | ')).toMatch(re);
    return;
  }
  expect.fail('se esperaba un error');
}
beforeAll(async () => {
  h = await createTestDb({ seed: true });
}, 60_000);
afterAll(async () => {
  await h.close();
});

const baseDisp = {
  canal: 'presencial',
  conReceta: true,
  cn: '570016',
  nombreFarmaco: 'CLAVUBAY',
  lote: 'L1',
  unidades: 1,
  metodoCaptura: 'manual',
  empleado: 'dev-empleado',
  fechaVenta: new Date('2026-10-14T10:00:00Z'),
};

describe('seed de maestros', () => {
  it('carga especies, formas, vías y unidades desde los diccionarios reales', async () => {
    const [esp] = await h.db.select().from(cimavetMaestra).where(sql`tipo = ${MAESTRA.ESPECIES} and clave = '14'`);
    expect(esp?.nombre).toBe('Perros');
    const [uni] = await h.db.select().from(cimavetMaestra).where(sql`tipo = ${MAESTRA.UNIDADES} and clave = '25'`);
    expect(uni?.nombre).toBe('Comprimido');
    const formas = await h.db.select().from(cimavetMaestra).where(eq(cimavetMaestra.tipo, MAESTRA.FORMAS));
    expect(formas.length).toBeGreaterThan(100);
  });

  it('siembra las plataformas de receta electrónica sin verificar (D-14) y las reglas activas', async () => {
    const plats = await h.db.select().from(plataformaRecetaElectronica);
    expect(plats.map((p) => p.nombre).sort()).toEqual(['GeneraRecetas', 'Prescrivet', 'Recevet', 'recetas.vet']);
    expect(plats.every((p) => p.reconocidaMapa === null)).toBe(true);
    const reglas = await h.db.select().from(reglaVersion).where(eq(reglaVersion.activa, true));
    expect(reglas).toHaveLength(5);
  });
});

describe('dispensacion es append-only', () => {
  it('permite INSERT y rechaza UPDATE y DELETE', async () => {
    const [d] = await h.db.insert(dispensacion).values(baseDisp).returning();
    await expectPgError(h.db.update(dispensacion).set({ unidades: 2 }).where(eq(dispensacion.id, d!.id)), /solo inserción/);
    await expectPgError(h.db.delete(dispensacion).where(eq(dispensacion.id, d!.id)), /solo inserción/);
  });

  it('la anulación es un contramovimiento y la vista deriva anulada_por', async () => {
    const [d] = await h.db.insert(dispensacion).values({ ...baseDisp, lote: 'L2' }).returning();
    const [a] = await h.db
      .insert(dispensacion)
      .values({ ...baseDisp, lote: 'L2', anulaDispensacionId: d!.id, motivoAnulacion: 'error de captura' })
      .returning();
    const res = await h.db.execute(sql`select anulada_por from v_dispensacion where id = ${d!.id}`);
    const rows = (res as unknown as { rows: Array<{ anulada_por: string }> }).rows;
    expect(rows[0]?.anulada_por).toBe(a!.id);
    // Una dispensación no se anula dos veces.
    await expectPgError(
      h.db.insert(dispensacion).values({ ...baseDisp, anulaDispensacionId: d!.id, motivoAnulacion: 'otra vez' }),
      /duplicate key|unique/,
    );
  });
});

describe('recepcion_linea es append-only tras finalizar', () => {
  it('se edita en ABIERTA y se bloquea al finalizar, salvo campos de sincronización', async () => {
    const [dist] = await h.db.select().from(distribuidor).limit(1);
    const [r] = await h.db
      .insert(recepcion)
      .values({ distribuidorId: dist!.id, fechaCompra: '2026-10-14', empleado: 'dev-empleado' })
      .returning();
    const [l] = await h.db
      .insert(recepcionLinea)
      .values({
        recepcionId: r!.id,
        numero: 1,
        cn: '570016',
        nombreFarmaco: 'CLAVUBAY',
        lote: 'A1',
        caducidad: '2027-12-31',
        unidades: 3,
        origenDatos: 'cimavet',
        empleado: 'dev-empleado',
      })
      .returning();
    await h.db.update(recepcionLinea).set({ unidades: 4 }).where(eq(recepcionLinea.id, l!.id));
    await h.db.update(recepcion).set({ estado: 'FINALIZADA' }).where(eq(recepcion.id, r!.id));
    await expectPgError(h.db.update(recepcionLinea).set({ unidades: 5 }).where(eq(recepcionLinea.id, l!.id)), /no se pueden modificar/);
    await expectPgError(h.db.delete(recepcionLinea).where(eq(recepcionLinea.id, l!.id)), /no se puede borrar/);
    await h.db.update(recepcionLinea).set({ estado: 'ENCOLADA' }).where(eq(recepcionLinea.id, l!.id));
    await expectPgError(
      h.db.insert(recepcionLinea).values({
        recepcionId: r!.id,
        numero: 2,
        nombreFarmaco: 'X',
        unidades: 1,
        origenDatos: 'manual',
        empleado: 'dev-empleado',
      }),
      /no admite líneas nuevas/,
    );
    await expectPgError(h.db.update(recepcion).set({ estado: 'ABIERTA' }).where(eq(recepcion.id, r!.id)), /reabrir/);
  });
});

describe('auditoría con cadena de hashes', () => {
  it('encadena eventos y detecta manipulación', async () => {
    await h.db.transaction(async (tx) => {
      await appendAudit(tx, { actor: 'dev-empleado', accion: 'crear', entidad: 'receta', entidadId: 'r1', despues: { b: 1, a: [1, 'x'] } });
      await appendAudit(tx, { actor: 'dev-empleado', accion: 'firmar', entidad: 'sustitucion', entidadId: 's1', antes: { e: 'A' }, despues: { e: 'B' } });
    });
    expect(await verifyAuditChain(h.db)).toMatchObject({ ok: true, total: 2 });
    await expectPgError(h.db.update(auditEvent).set({ actor: 'x' }), /solo inserción/);
    // Manipulación saltándose el trigger (como haría un superusuario).
    await h.db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
    await h.db.execute(sql`update audit_event set actor = 'intruso' where seq = (select min(seq) from audit_event)`);
    await h.db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);
    const res = await verifyAuditChain(h.db);
    expect(res.ok).toBe(false);
    expect(res.roturaEn).toBeDefined();
  });
});

describe('cifrado de columnas', () => {
  const cipher = new ColumnCipher(Buffer.alloc(32, 7).toString('base64'));
  it('cifra y descifra, con IV aleatorio', () => {
    const a = cipher.encrypt('12345678Z');
    const b = cipher.encrypt('12345678Z');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('12345678Z');
    expect(cipher.encrypt(null)).toBeNull();
    expect(cipher.decrypt(null)).toBeNull();
    expect(() => cipher.decrypt('v0:xx')).toThrow();
  });
  it('índice ciego determinista y máscara de DNI', () => {
    expect(cipher.blindIndex('12345678z')).toBe(cipher.blindIndex(' 12345678Z '));
    expect(cipher.blindIndex(null)).toBeNull();
    expect(maskDni('12345678Z')).toBe('****5678Z');
    expect(maskDni(null)).toBeNull();
    expect(() => new ColumnCipher('corta')).toThrow();
  });
});
