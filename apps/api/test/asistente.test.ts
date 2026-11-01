import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { asistenteConsumoMes, asistenteIntercambio, auditEvent } from '@mmx/db';
import { DomainError } from '@mmx/shared';
import { ConsoleMailer } from '@mmx/reports';
import { FakeAssistantModel, mesMadrid, type AssistantModel, type Guion } from '@mmx/assistant';
import { api, CLOCK, entorno, type Entorno } from './entorno';

const respuesta = (o: Record<string, unknown> = {}) => ({
  tipo: 'fuera_de_ambito',
  texto: 'Respuesta de prueba.',
  fuentes: [],
  simulaciones: [],
  usaContextoLinea: false,
  ...o,
});
const GUIONES: Guion[] = [{ cuando: /hola|ejemplo|dni|tel/i, rondas: [], final: () => respuesta() }];
const caido: AssistantModel = {
  nombre: 'caido',
  chat: async () => {
    throw new DomainError('ASISTENTE_NO_DISPONIBLE', 'secreto interno');
  },
};

let E: Entorno;
beforeAll(async () => {
  E = await entorno({ asistente: new FakeAssistantModel(GUIONES) });
}, 180_000);
afterAll(async () => {
  await E.app.close();
});

const abrir = async (u: 'dev-empleado' | 'dev-veterinaria' | 'dev-admin' = 'dev-empleado') => {
  const r = await api(E.app, u, 'POST', '/api/asistente/conversaciones', { contexto: { tipo: 'general' } });
  expect(r.status).toBe(201);
  return r.json.id as string;
};
const preguntar = (
  id: string,
  pregunta: string,
  u: 'dev-empleado' | 'dev-veterinaria' | 'dev-admin' = 'dev-empleado',
) => api(E.app, u, 'POST', `/api/asistente/conversaciones/${id}/mensajes`, { pregunta });

describe('estado y conversación', () => {
  it('exige usuario identificado', async () => {
    expect((await api(E.app, null, 'GET', '/api/asistente/estado')).status).toBe(401);
  });

  it('con modelo activo devuelve activo, estado normal y preguntas de ejemplo', async () => {
    const r = await api(E.app, 'dev-empleado', 'GET', '/api/asistente/estado');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ activo: true, estadoConsumo: 'normal' });
    expect(r.json.preguntasEjemplo.length).toBeGreaterThan(0);
  });

  it('una pregunta se responde y se guarda con versiones y consumo', async () => {
    const id = await abrir();
    const r = await preguntar(id, 'hola, esto es un ejemplo');
    expect(r.status).toBe(200);
    expect(r.json.intercambio).toMatchObject({
      orden: 1,
      tipo: 'fuera_de_ambito',
      texto: 'Respuesta de prueba.',
      piiEliminada: false,
      estado: 'respondida',
    });
    expect(r.json.intercambio.reglaVersion).toMatch(/validez\.v1@/);
    const [fila] = await E.h.db
      .select()
      .from(asistenteIntercambio)
      .where(eq(asistenteIntercambio.id, r.json.intercambio.id));
    expect(fila).toMatchObject({ modelo: 'fake', tokensEntrada: 10, tokensSalida: 5 });
    expect(fila?.instruccionesVersion).toMatch(/^instrucciones\.v1@/);
    const [mes] = await E.h.db
      .select()
      .from(asistenteConsumoMes)
      .where(
        eq(
          asistenteConsumoMes.mes,
          mesMadrid(CLOCK.now() ? new Date(CLOCK.now().epochMilliseconds) : new Date()),
        ),
      );
    expect(mes?.preguntas).toBeGreaterThan(0);
  });

  it('el orden de los intercambios es correlativo', async () => {
    const id = await abrir();
    expect((await preguntar(id, 'hola 1')).json.intercambio.orden).toBe(1);
    expect((await preguntar(id, 'hola 2')).json.intercambio.orden).toBe(2);
  });
});

describe('permisos y estado de la conversación', () => {
  it('una conversación ajena → 403', async () => {
    const id = await abrir('dev-empleado');
    const r = await preguntar(id, 'hola', 'dev-veterinaria');
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('ASISTENTE_CONVERSACION_AJENA');
    expect(
      (await api(E.app, 'dev-veterinaria', 'POST', `/api/asistente/conversaciones/${id}/cerrar`)).status,
    ).toBe(403);
  });

  it('una conversación cerrada → 409 y cerrar es idempotente', async () => {
    const id = await abrir();
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/asistente/conversaciones/${id}/cerrar`)).status,
    ).toBe(204);
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/asistente/conversaciones/${id}/cerrar`)).status,
    ).toBe(204);
    const r = await preguntar(id, 'hola');
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('ASISTENTE_CONVERSACION_CERRADA');
  });

  it('una conversación que no existe → 404 y una pregunta vacía → 400', async () => {
    expect((await preguntar('00000000-0000-4000-8000-000000000000', 'hola')).status).toBe(404);
    const id = await abrir();
    expect((await preguntar(id, '   ')).status).toBe(400);
  });

  it('una línea inexistente → 404', async () => {
    const r = await api(E.app, 'dev-empleado', 'POST', '/api/asistente/conversaciones', {
      contexto: { tipo: 'linea', recetaLineaId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('RECETA_LINEA_NO_ENCONTRADA');
  });
});

describe('datos personales (FR-019)', () => {
  it('la pregunta se guarda saneada y se avisa de que se han eliminado datos', async () => {
    const id = await abrir();
    const r = await preguntar(id, 'hola, el dni del cliente es 12345678Z y su tel 612345678');
    expect(r.json.intercambio.piiEliminada).toBe(true);
    expect(r.json.intercambio.pregunta).not.toMatch(/12345678|612/);
    const [fila] = await E.h.db
      .select()
      .from(asistenteIntercambio)
      .where(eq(asistenteIntercambio.id, r.json.intercambio.id));
    expect(fila?.pregunta).not.toMatch(/12345678|612/);
  });
});

describe('fallos y límite mensual', () => {
  it('el modelo falla → 503 y queda un intercambio de error sin detalle', async () => {
    const E2 = await entorno({ asistente: caido });
    const r0 = await api(E2.app, 'dev-empleado', 'POST', '/api/asistente/conversaciones', {
      contexto: { tipo: 'general' },
    });
    const r = await api(
      E2.app,
      'dev-empleado',
      'POST',
      `/api/asistente/conversaciones/${r0.json.id}/mensajes`,
      { pregunta: 'hola' },
    );
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('ASISTENTE_NO_DISPONIBLE');
    const filas = await E2.h.db
      .select()
      .from(asistenteIntercambio)
      .where(eq(asistenteIntercambio.conversacionId, r0.json.id));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      estado: 'error',
      errorCode: 'ASISTENTE_NO_DISPONIBLE',
      respuesta: null,
    });
    expect(JSON.stringify(filas[0])).not.toContain('secreto interno');
    await E2.app.close();
  });

  it('consumo en pausa → 429, sin llamar al modelo, y queda constancia', async () => {
    let llamadas = 0;
    const contador: AssistantModel = {
      nombre: 'c',
      chat: async () => {
        llamadas++;
        throw new Error('no debería llamarse');
      },
    };
    const E3 = await entorno({ asistente: contador, config: { ASSISTANT_MONTHLY_TOKEN_LIMIT: '1000' } });
    const mes = mesMadrid(new Date(CLOCK.now().epochMilliseconds));
    await E3.h.db
      .insert(asistenteConsumoMes)
      .values({ mes, limiteTokens: 1000, tokensEntrada: 900, tokensSalida: 200 })
      .onConflictDoUpdate({
        target: asistenteConsumoMes.mes,
        set: { limiteTokens: 1000, tokensEntrada: 900, tokensSalida: 200, limiteAmpliado: null },
      });
    const est = await api(E3.app, 'dev-empleado', 'GET', '/api/asistente/estado');
    expect(est.json.estadoConsumo).toBe('en_pausa');
    const c = await api(E3.app, 'dev-empleado', 'POST', '/api/asistente/conversaciones', {
      contexto: { tipo: 'general' },
    });
    const r = await api(
      E3.app,
      'dev-empleado',
      'POST',
      `/api/asistente/conversaciones/${c.json.id}/mensajes`,
      { pregunta: 'hola' },
    );
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('ASISTENTE_LIMITE_MENSUAL');
    expect(llamadas).toBe(0);
    const filas = await E3.h.db
      .select()
      .from(asistenteIntercambio)
      .where(eq(asistenteIntercambio.conversacionId, c.json.id));
    expect(filas[0]).toMatchObject({ estado: 'limite' });
    await E3.h.db.delete(asistenteConsumoMes).where(eq(asistenteConsumoMes.mes, mes));
    await E3.app.close();
  });

  it('con ASSISTANT=off (sin modelo) no hay asistente', async () => {
    const E4 = await entorno({ asistente: null });
    expect((await api(E4.app, 'dev-empleado', 'GET', '/api/asistente/estado')).json).toMatchObject({
      activo: false,
      preguntasEjemplo: [],
    });
    const r = await api(E4.app, 'dev-empleado', 'POST', '/api/asistente/conversaciones', {
      contexto: { tipo: 'general' },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('ASISTENTE_DESACTIVADO');
    await E4.app.close();
  });
});

describe('fuentes citadas (FR-007)', () => {
  it('abre una regla, un fragmento de la guía y de la Ayuda, y avisa si la versión ya no es la vigente', async () => {
    const regla = await api(
      E.app,
      'dev-empleado',
      'GET',
      `/api/asistente/fuentes/${encodeURIComponent('regla:validez')}`,
    );
    expect(regla.status).toBe(200);
    expect(regla.json).toMatchObject({ fuenteId: 'regla:validez', tipo: 'regla', versionVigente: true });
    expect(regla.json.contenido).toContain('antimicrobiano');

    const vieja = await api(
      E.app,
      'dev-empleado',
      'GET',
      `/api/asistente/fuentes/${encodeURIComponent('regla:validez')}?version=validez.v1@00000000`,
    );
    expect(vieja.json.versionVigente).toBe(false);

    const guia = await api(
      E.app,
      'dev-empleado',
      'GET',
      `/api/asistente/fuentes/${encodeURIComponent('guia:5.3')}`,
    );
    expect(guia.json).toMatchObject({ tipo: 'guia' });
    expect(guia.json.contenido).toMatch(/un envase por receta/);

    const ayuda = await api(
      E.app,
      'dev-empleado',
      'GET',
      `/api/asistente/fuentes/${encodeURIComponent('ayuda:sustitucion')}`,
    );
    expect(ayuda.status).toBe(200);
  });

  it('una fuente que no existe → 404', async () => {
    expect(
      (await api(E.app, 'dev-empleado', 'GET', `/api/asistente/fuentes/${encodeURIComponent('guia:9.9.9')}`))
        .status,
    ).toBe(404);
    expect(
      (await api(E.app, 'dev-empleado', 'GET', `/api/asistente/fuentes/${encodeURIComponent('otra:cosa')}`))
        .status,
    ).toBe(404);
  });
});

describe('consumo mensual: aviso del 80 % y administración (FR-027a, FR-027b)', () => {
  const mes = () => mesMadrid(new Date(CLOCK.now().epochMilliseconds));
  async function preparar(tokens: number) {
    const mailer = new ConsoleMailer();
    const X = await entorno({
      asistente: new FakeAssistantModel(GUIONES),
      config: { ASSISTANT_MONTHLY_TOKEN_LIMIT: '1000', REPORT_RECIPIENTS: 'admin@example.org' },
    });
    X.deps.asistente.mailer = mailer;
    await X.h.db.delete(asistenteConsumoMes).where(eq(asistenteConsumoMes.mes, mes()));
    await X.h.db
      .insert(asistenteConsumoMes)
      .values({ mes: mes(), limiteTokens: 1000, tokensEntrada: tokens, tokensSalida: 0 });
    const c = await api(X.app, 'dev-empleado', 'POST', '/api/asistente/conversaciones', {
      contexto: { tipo: 'general' },
    });
    const preguntar = () =>
      api(X.app, 'dev-empleado', 'POST', `/api/asistente/conversaciones/${c.json.id}/mensajes`, {
        pregunta: 'hola',
      });
    return { X, mailer, preguntar };
  }

  it('avisa a administración una sola vez al cruzar el 80 % y sigue respondiendo', async () => {
    const { X, mailer, preguntar } = await preparar(790);
    expect((await preguntar()).status).toBe(200); // 805 tokens: 80,5 %
    expect(mailer.enviados).toHaveLength(1);
    expect(mailer.enviados[0]).toMatchObject({ para: ['admin@example.org'] });
    expect(mailer.enviados[0]?.asunto).toMatch(/80 %/);
    expect((await api(X.app, 'dev-empleado', 'GET', '/api/asistente/estado')).json.estadoConsumo).toBe(
      'aviso',
    );
    expect((await preguntar()).status).toBe(200);
    expect(mailer.enviados).toHaveLength(1);
    await X.app.close();
  });

  it('al llegar al 100 % pausa el asistente y administración puede ampliar el límite', async () => {
    const { X, preguntar } = await preparar(985);
    expect((await preguntar()).status).toBe(200); // 1000 tokens
    const pausado = await preguntar();
    expect(pausado.status).toBe(429);

    const lectura = await api(X.app, 'dev-admin', 'GET', '/api/admin/asistente/consumo');
    expect(lectura.status).toBe(200);
    expect(lectura.json.actual).toMatchObject({
      mes: mes(),
      estado: 'en_pausa',
      limiteEfectivo: 1000,
      tokensEntrada: 995,
      tokensSalida: 5,
      porcentaje: 100,
    });
    expect(lectura.json.historico).toEqual([]);

    // Solo administración, con MFA, y por encima de lo ya consumido.
    expect(
      (
        await api(
          X.app,
          'dev-empleado',
          'PUT',
          '/api/admin/asistente/consumo/limite',
          { limiteTokens: 5000 },
          { mfa: true },
        )
      ).status,
    ).toBe(403);
    expect(
      (await api(X.app, 'dev-admin', 'PUT', '/api/admin/asistente/consumo/limite', { limiteTokens: 5000 }))
        .status,
    ).toBe(403);
    expect(
      (
        await api(
          X.app,
          'dev-admin',
          'PUT',
          '/api/admin/asistente/consumo/limite',
          { limiteTokens: 900 },
          { mfa: true },
        )
      ).status,
    ).toBe(400);

    const ok = await api(
      X.app,
      'dev-admin',
      'PUT',
      '/api/admin/asistente/consumo/limite',
      { limiteTokens: 5000 },
      { mfa: true },
    );
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ estado: 'normal', limiteEfectivo: 5000, ampliadoPor: 'dev-admin' });
    expect((await preguntar()).status).toBe(200);
    const auditoria = await X.h.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.accion, 'asistente_ampliar_limite'));
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor: 'dev-admin',
      antes: { limiteEfectivo: 1000 },
      despues: { limiteEfectivo: 5000 },
    });
    await X.app.close();
  });

  it('el coste estimado usa los precios configurados (decimal.js)', async () => {
    const X = await entorno({
      asistente: new FakeAssistantModel(GUIONES),
      config: { ASSISTANT_PRICE_IN_PER_1K_EUR: '0.0025', ASSISTANT_PRICE_OUT_PER_1K_EUR: '0.01' },
    });
    await X.h.db.delete(asistenteConsumoMes).where(eq(asistenteConsumoMes.mes, mes()));
    await X.h.db
      .insert(asistenteConsumoMes)
      .values({ mes: mes(), limiteTokens: 3_000_000, tokensEntrada: 1_000_000, tokensSalida: 500_000 });
    const r = await api(X.app, 'dev-admin', 'GET', '/api/admin/asistente/consumo');
    expect(r.json.actual.costeEstimadoEur).toBe('7.50');
    await X.app.close();
  });

  it('solo administración ve el consumo', async () => {
    expect((await api(E.app, 'dev-empleado', 'GET', '/api/admin/asistente/consumo')).status).toBe(403);
    expect((await api(E.app, 'dev-veterinaria', 'GET', '/api/admin/asistente/consumo')).status).toBe(403);
  });
});
