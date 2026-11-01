import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../src/testing';
import type { DbHandle } from '../src/client';
import { asistenteConversacion, asistenteIntercambio, asistenteValoracion } from '../src/schema';

let h: DbHandle;

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
  h = await createTestDb({ seed: false });
}, 60_000);
afterAll(async () => {
  await h.close();
});

const intercambio = (conversacionId: string, orden: number, createdAt?: Date) => ({
  conversacionId,
  orden,
  pregunta: '¿Cuánto vale una receta?',
  estado: 'respondida',
  tipoRespuesta: 'respondida',
  respuesta: 'Un mes.',
  reglaVersion: 'validez.v1@abcd1234',
  fuentesVersion: 'guia@1+ayuda@2',
  modelo: 'fake',
  instruccionesVersion: 'instrucciones.v1@abcd1234',
  ...(createdAt ? { createdAt } : {}),
});

async function conversacion(createdAt?: Date) {
  const [c] = await h.db
    .insert(asistenteConversacion)
    .values({
      usuarioOid: 'u1',
      usuarioNombre: 'Empleada',
      contextoTipo: 'general',
      ...(createdAt ? { createdAt } : {}),
    })
    .returning();
  return c!;
}

describe('asistente_intercambio es de solo inserción', () => {
  it('permite INSERT y rechaza UPDATE y DELETE', async () => {
    const c = await conversacion();
    const [i] = await h.db.insert(asistenteIntercambio).values(intercambio(c.id, 1)).returning();
    await expectPgError(
      h.db.update(asistenteIntercambio).set({ respuesta: 'otra' }).where(eq(asistenteIntercambio.id, i!.id)),
      /solo inserción/,
    );
    await expectPgError(
      h.db.delete(asistenteIntercambio).where(eq(asistenteIntercambio.id, i!.id)),
      /solo inserción/,
    );
    await expectPgError(h.db.execute(sql`truncate asistente_intercambio cascade`), /solo inserción/);
  });

  it('el orden es único dentro de la conversación', async () => {
    const c = await conversacion();
    await h.db.insert(asistenteIntercambio).values(intercambio(c.id, 1));
    await expectPgError(
      h.db.insert(asistenteIntercambio).values(intercambio(c.id, 1)),
      /unique|duplicate|asistente_intercambio/i,
    );
  });
});

describe('purga por retención de 1 año', () => {
  const haceDias = (d: number) => new Date(Date.now() - d * 86_400_000);

  it('sin la marca de purga no se borra ni una conversación con más de 1 año', async () => {
    const c = await conversacion(haceDias(400));
    await h.db.insert(asistenteIntercambio).values(intercambio(c.id, 1, haceDias(400)));
    await expectPgError(
      h.db.delete(asistenteConversacion).where(eq(asistenteConversacion.id, c.id)),
      /solo inserción/,
    );
  });

  it('con la marca de purga borra lo de más de 1 año (en cascada) y conserva lo reciente', async () => {
    const vieja = await conversacion(haceDias(400));
    const [iv] = await h.db
      .insert(asistenteIntercambio)
      .values(intercambio(vieja.id, 1, haceDias(400)))
      .returning();
    await h.db
      .insert(asistenteValoracion)
      .values({ intercambioId: iv!.id, usuarioOid: 'u1', valor: 'incorrecta' });
    const reciente = await conversacion(haceDias(364));
    await h.db.insert(asistenteIntercambio).values(intercambio(reciente.id, 1, haceDias(364)));

    await h.db.transaction(async (tx) => {
      await tx.execute(sql`set local mmx.purga_retencion = 'on'`);
      await tx.delete(asistenteConversacion).where(eq(asistenteConversacion.id, vieja.id));
    });
    // Lo de menos de 1 año no se puede borrar aunque se active la purga (otra transacción: el error aborta la actual).
    await expectPgError(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`set local mmx.purga_retencion = 'on'`);
        await tx.execute(sql`delete from asistente_intercambio where conversacion_id = ${reciente.id}`);
      }),
      /solo inserción/,
    );

    const quedan = await h.db
      .select()
      .from(asistenteIntercambio)
      .where(eq(asistenteIntercambio.conversacionId, vieja.id));
    expect(quedan).toHaveLength(0);
    const val = await h.db
      .select()
      .from(asistenteValoracion)
      .where(eq(asistenteValoracion.intercambioId, iv!.id));
    expect(val).toHaveLength(0);
    const rec = await h.db
      .select()
      .from(asistenteIntercambio)
      .where(eq(asistenteIntercambio.conversacionId, reciente.id));
    expect(rec).toHaveLength(1);
  });
});
