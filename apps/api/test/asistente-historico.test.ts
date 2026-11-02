import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { asistenteValoracion } from '@mmx/db';
import { FakeAssistantModel, guionesDemo } from '@mmx/assistant';
import { api, entorno, type Entorno } from './entorno';

type U = 'dev-empleado' | 'dev-veterinaria' | 'dev-admin';
let E: Entorno;
beforeAll(async () => {
  E = await entorno({ asistente: new FakeAssistantModel(guionesDemo(2026)) });
}, 180_000);
afterAll(async () => {
  await E.app.close();
});

async function consulta(u: U, pregunta = '¿Cuántos días vale una receta con antibiótico?') {
  const c = await api(E.app, u, 'POST', '/api/asistente/conversaciones', { contexto: { tipo: 'general' } });
  const r = await api(E.app, u, 'POST', `/api/asistente/conversaciones/${c.json.id}/mensajes`, { pregunta });
  return { conv: c.json.id as string, intercambio: r.json.intercambio.id as string };
}
const valorar = (u: U, intercambio: string, body: unknown) =>
  api(E.app, u, 'PUT', `/api/asistente/intercambios/${intercambio}/valoracion`, body);
const ids = (r: { json: { items: { id: string }[] } }) => r.json.items.map((i) => i.id);

describe('valoraciones (FR-024)', () => {
  it('el dueño valora y volver a valorar sustituye la anterior', async () => {
    const { intercambio } = await consulta('dev-empleado');
    expect((await valorar('dev-empleado', intercambio, { valor: 'util' })).json).toMatchObject({
      valor: 'util',
      comentario: null,
    });
    const r = await valorar('dev-empleado', intercambio, {
      valor: 'incorrecta',
      comentario: 'El plazo no es ese',
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ valor: 'incorrecta', comentario: 'El plazo no es ese' });
    expect(
      await E.h.db
        .select()
        .from(asistenteValoracion)
        .where(eq(asistenteValoracion.intercambioId, intercambio)),
    ).toHaveLength(1);
  });

  it('otra persona no puede valorar → 403; un intercambio que no existe → 404; valor no válido → 400', async () => {
    const { intercambio } = await consulta('dev-empleado');
    expect((await valorar('dev-veterinaria', intercambio, { valor: 'util' })).status).toBe(403);
    expect(
      (await valorar('dev-empleado', '00000000-0000-4000-8000-000000000000', { valor: 'util' })).status,
    ).toBe(404);
    expect((await valorar('dev-empleado', intercambio, { valor: 'regular' })).status).toBe(400);
  });

  it('el comentario se sanea: nunca se guardan datos personales', async () => {
    const { intercambio } = await consulta('dev-empleado');
    const r = await valorar('dev-empleado', intercambio, {
      valor: 'incorrecta',
      comentario: 'Llamé al 612345678 y me dijeron otra cosa',
    });
    expect(r.json.comentario).not.toContain('612345678');
    expect(r.json.comentario).toContain('[dato eliminado]');
  });
});

describe('histórico (FR-025, US4)', () => {
  let ajena: Awaited<ReturnType<typeof consulta>>;
  let incorrecta: Awaited<ReturnType<typeof consulta>>;
  beforeAll(async () => {
    ajena = await consulta('dev-veterinaria');
    incorrecta = await consulta('dev-empleado', '¿Se puede sustituir una vacuna?');
    await valorar('dev-empleado', incorrecta.intercambio, {
      valor: 'incorrecta',
      comentario: 'No lo explica bien',
    });
  });

  it('el empleado solo ve las suyas y no puede pedir las de otros', async () => {
    const r = await api(E.app, 'dev-empleado', 'GET', '/api/asistente/conversaciones');
    expect(r.status).toBe(200);
    expect(ids(r)).toContain(incorrecta.conv);
    expect(ids(r)).not.toContain(ajena.conv);
    expect(r.json.items.every((i: { usuario: { id: string } }) => i.usuario.id === 'dev-empleado')).toBe(
      true,
    );
    expect(
      (await api(E.app, 'dev-empleado', 'GET', '/api/asistente/conversaciones?usuario=dev-veterinaria'))
        .status,
    ).toBe(403);
    expect(
      (await api(E.app, 'dev-empleado', 'GET', `/api/asistente/conversaciones/${ajena.conv}`)).status,
    ).toBe(403);
  });

  it('veterinaria responsable y administración ven las de todos', async () => {
    for (const u of ['dev-veterinaria', 'dev-admin'] as const) {
      const r = await api(E.app, u, 'GET', '/api/asistente/conversaciones?tamano=100');
      expect(ids(r)).toEqual(expect.arrayContaining([ajena.conv, incorrecta.conv]));
    }
  });

  it('filtra por valoración «incorrecta» y muestra el comentario en el detalle (US4-AS1)', async () => {
    const r = await api(
      E.app,
      'dev-veterinaria',
      'GET',
      '/api/asistente/conversaciones?valoracion=incorrecta',
    );
    expect(ids(r)).toContain(incorrecta.conv);
    expect(ids(r)).not.toContain(ajena.conv);
    expect(r.json.items.find((i: { id: string }) => i.id === incorrecta.conv)).toMatchObject({
      incorrectas: 1,
      intercambios: 1,
      primeraPregunta: '¿Se puede sustituir una vacuna?',
    });
    const d = await api(E.app, 'dev-veterinaria', 'GET', `/api/asistente/conversaciones/${incorrecta.conv}`);
    expect(d.json.intercambios[0].valoracion).toEqual({
      valor: 'incorrecta',
      comentario: 'No lo explica bien',
    });
  });

  it('filtra por sin valorar, por usuario, por fechas y por receta asociada', async () => {
    const sin = await api(
      E.app,
      'dev-veterinaria',
      'GET',
      '/api/asistente/conversaciones?valoracion=sin_valorar&tamano=100',
    );
    expect(ids(sin)).toContain(ajena.conv);
    expect(ids(sin)).not.toContain(incorrecta.conv);
    const usuario = await api(
      E.app,
      'dev-admin',
      'GET',
      '/api/asistente/conversaciones?usuario=dev-veterinaria&tamano=100',
    );
    expect(
      usuario.json.items.every((i: { usuario: { id: string } }) => i.usuario.id === 'dev-veterinaria'),
    ).toBe(true);
    const hoy = new Date(E.deps.clock.now().epochMilliseconds).toISOString().slice(0, 10);
    expect(
      ids(
        await api(
          E.app,
          'dev-admin',
          'GET',
          `/api/asistente/conversaciones?desde=${hoy}&hasta=${hoy}&tamano=100`,
        ),
      ),
    ).toContain(ajena.conv);
    expect(
      ids(await api(E.app, 'dev-admin', 'GET', '/api/asistente/conversaciones?hasta=2020-01-01')),
    ).toEqual([]);
    expect(
      (
        await api(E.app, 'dev-admin', 'GET', '/api/asistente/conversaciones?conReceta=true&tamano=100')
      ).json.items.some((i: { id: string }) => i.id === ajena.conv),
    ).toBe(false);
    expect(
      ids(await api(E.app, 'dev-admin', 'GET', '/api/asistente/conversaciones?conReceta=false&tamano=100')),
    ).toContain(ajena.conv);
  });

  it('pagina el listado', async () => {
    const p1 = await api(E.app, 'dev-admin', 'GET', '/api/asistente/conversaciones?tamano=1&pagina=1');
    const p2 = await api(E.app, 'dev-admin', 'GET', '/api/asistente/conversaciones?tamano=1&pagina=2');
    expect(p1.json.items).toHaveLength(1);
    expect(p1.json.total).toBeGreaterThan(1);
    expect(ids(p1)).not.toEqual(ids(p2));
  });

  it('el detalle conserva la versión de las reglas del momento aunque las reglas cambien después (US4-AS2)', async () => {
    const antes = (await api(E.app, 'dev-veterinaria', 'GET', `/api/asistente/conversaciones/${ajena.conv}`))
      .json.intercambios[0];
    expect(antes.reglaVersion).toBe(E.deps.rules.bundle.version);
    const original = E.deps.rules.bundle.version;
    (E.deps.rules.bundle as { version: string }).version = 'validez.v1@cambiada';
    try {
      const despues = (
        await api(E.app, 'dev-veterinaria', 'GET', `/api/asistente/conversaciones/${ajena.conv}`)
      ).json.intercambios[0];
      expect(despues.reglaVersion).toBe(original);
      expect(despues.fuentes[0].version).toMatch(/^validez\.v1@/);
      expect(despues.fuentesVersion).toMatch(/^guia@/);
    } finally {
      (E.deps.rules.bundle as { version: string }).version = original;
    }
  });
});
