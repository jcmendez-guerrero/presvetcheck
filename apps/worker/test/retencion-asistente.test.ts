import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { CimavetClient, CimavetRepository } from '@mmx/cimavet';
import {
  asistenteConsumoMes,
  asistenteConversacion,
  asistenteIntercambio,
  asistenteValoracion,
  ColumnCipher,
  type DbHandle,
} from '@mmx/db';
import { createTestDb } from '@mmx/db/testing';
import { fixedClock } from '@mmx/domain';
import { ConsoleMailer, MemoryBlobStore } from '@mmx/reports';
import { loadConfig } from '@mmx/shared';
import { loadRules } from '@mmx/shared/node';
import { NotConfiguredSalesMovementsSource } from '@mmx/siweb';
import type { Contexto } from '../src/contexto';
import { JOBS } from '../src/main';

const ROOT = resolve(__dirname, '../../..');
let h: DbHandle;
let ctx: Contexto;
const AHORA = new Date();
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

beforeAll(async () => {
  h = await createTestDb({ seed: false });
  ctx = {
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'x',
      BLOB_CONNECTION_STRING: 'memory',
      AUTH_MODE: 'dev',
    }),
    db: h.db,
    clock: fixedClock(AHORA.toISOString()),
    rules: loadRules(resolve(ROOT, 'config/rules')).bundle,
    cipher: new ColumnCipher(Buffer.alloc(32, 9).toString('base64')),
    cimavet: {
      client: new CimavetClient({ baseUrl: 'https://cimavet.test/' }),
      repo: new CimavetRepository(h.db),
    },
    siweb: null,
    ventas: new NotConfiguredSalesMovementsSource(),
    blob: new MemoryBlobStore(),
    mailer: new ConsoleMailer(),
    log: () => {},
  } as unknown as Contexto;
}, 120_000);
afterAll(async () => {
  await h.close();
});

const intercambio = (conversacionId: string, orden: number, createdAt: Date) => ({
  conversacionId,
  orden,
  pregunta: '¿Cuánto vale una receta?',
  estado: 'respondida',
  respuesta: 'Un mes.',
  reglaVersion: 'validez.v1@abcd1234',
  fuentesVersion: 'guia@1+ayuda@2',
  modelo: 'fake',
  instruccionesVersion: 'instrucciones.v1@abcd1234',
  createdAt,
});
async function conversacion(creada: Date, intercambios: Date[]) {
  const [c] = await h.db
    .insert(asistenteConversacion)
    .values({ usuarioOid: 'u1', usuarioNombre: 'Empleada', contextoTipo: 'general', createdAt: creada })
    .returning();
  const filas = [];
  for (const [i, f] of intercambios.entries())
    filas.push(
      (
        await h.db
          .insert(asistenteIntercambio)
          .values(intercambio(c!.id, i + 1, f))
          .returning()
      )[0]!,
    );
  return { c: c!, filas };
}

describe('retention-sweep · asistente de consultas (FR-023a)', () => {
  it('elimina las conversaciones de más de 1 año con sus intercambios y valoraciones; conserva lo reciente y aplaza lo mixto', async () => {
    const vieja = await conversacion(hace(400), [hace(400), hace(399)]);
    await h.db
      .insert(asistenteValoracion)
      .values({ intercambioId: vieja.filas[0]!.id, usuarioOid: 'u1', valor: 'incorrecta' });
    const reciente = await conversacion(hace(364), [hace(364)]);
    const mixta = await conversacion(hace(370), [hace(370), hace(10)]);

    const r = (await JOBS['retention-sweep']!(ctx, {})) as { conversacionesAsistente: number };
    expect(r.conversacionesAsistente).toBe(1);

    expect(
      await h.db.select().from(asistenteConversacion).where(eq(asistenteConversacion.id, vieja.c.id)),
    ).toEqual([]);
    expect(
      await h.db
        .select()
        .from(asistenteIntercambio)
        .where(eq(asistenteIntercambio.conversacionId, vieja.c.id)),
    ).toEqual([]);
    expect(
      await h.db
        .select()
        .from(asistenteValoracion)
        .where(eq(asistenteValoracion.intercambioId, vieja.filas[0]!.id)),
    ).toEqual([]);
    expect(
      await h.db.select().from(asistenteConversacion).where(eq(asistenteConversacion.id, reciente.c.id)),
    ).toHaveLength(1);
    // La conversación con un intercambio reciente se aplaza entera (el siguiente barrido la eliminará).
    expect(
      await h.db
        .select()
        .from(asistenteIntercambio)
        .where(eq(asistenteIntercambio.conversacionId, mixta.c.id)),
    ).toHaveLength(2);
  });

  it('nunca borra con menos de 1 año, aunque se pida', async () => {
    const [x] = await h.db.select().from(asistenteIntercambio).limit(1);
    expect(x).toBeDefined();
    const r = (await JOBS['retention-sweep']!(ctx, {})) as { conversacionesAsistente: number };
    expect(r.conversacionesAsistente).toBe(0);
    expect(
      (await h.db.select().from(asistenteIntercambio).where(eq(asistenteIntercambio.id, x!.id))).length,
    ).toBe(1);
  });
});

describe('weekly-reports · consumo del asistente (FR-027b)', () => {
  it('el correo semanal incluye el consumo acumulado del mes, y nada si el asistente no se ha usado', async () => {
    const mailer = new ConsoleMailer();
    const c = {
      ...ctx,
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'x',
        BLOB_CONNECTION_STRING: 'memory',
        AUTH_MODE: 'dev',
        REPORT_RECIPIENTS: 'admin@example.org',
        ASSISTANT_PRICE_IN_PER_1K_EUR: '0.0025',
        ASSISTANT_PRICE_OUT_PER_1K_EUR: '0.01',
      }),
      clock: fixedClock('2026-10-19T05:00:00Z'),
      mailer,
      blob: new MemoryBlobStore(),
    } as unknown as Contexto;
    await JOBS['weekly-reports']!(c, {});
    expect(mailer.enviados[0]?.texto).not.toContain('Asistente de consultas');

    await h.db.insert(asistenteConsumoMes).values({
      mes: '2026-10',
      limiteTokens: 3_000_000,
      tokensEntrada: 2_000_000,
      tokensSalida: 500_000,
      preguntas: 120,
    });
    await JOBS['weekly-reports']!(c, {});
    expect(mailer.enviados[1]?.texto).toContain(
      'Asistente de consultas (2026-10): 2500000 tokens, 83.3 % del límite, 120 pregunta(s), coste estimado 10.00 € · cerca del límite.',
    );
  });
});
