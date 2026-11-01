import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { asistenteIntercambio } from '@mmx/db';
import { ContextoLineaDto } from '@mmx/shared';
import { FakeAssistantModel, type Guion } from '@mmx/assistant';
import { ContextoLineaService } from '../src/servicios/asistente-contexto';
import { api, confirmar, crearReceta, entorno, recetaCorrecta, type Entorno } from './entorno';

/** Valores de la fixture demo-compania-papel: nada de esto puede llegar al asistente (FR-014, FR-018, FR-021a). */
const PERSONALES = [
  'Titular de demostración',
  '600 000 000',
  'Veterinaria de demostración',
  '910 000 000',
  'demo@example.org',
  '28/0000',
  'Clínica de demostración',
  'Calle de demostración',
];

const GUIONES: Guion[] = [
  {
    cuando: /por qu[eé]|alternativas|vale|titular|tel[eé]fono/i,
    rondas: [[{ nombre: 'contexto_linea', args: {} }]],
    final: (ctx) => {
      const d = ctx.resultados.find((r) => r.nombre === 'contexto_linea')?.datos as {
        fuenteId: string;
        resultado: { decision: string };
      } | null;
      return {
        tipo: 'respondida',
        texto: `El resultado de la aplicación es ${d?.resultado.decision}. Pregunta a Titular de demostración si hace falta.`,
        fuentes: [d?.fuenteId],
        simulaciones: [],
        usaContextoLinea: true,
      };
    },
  },
];

let E: Entorno;
let lineaId: string;
let sinEvaluarId: string;
let recetaId: string;

beforeAll(async () => {
  E = await entorno({ asistente: new FakeAssistantModel(GUIONES) });
  recetaId = await crearReceta(E.app);
  await confirmar(E.app, recetaId, recetaCorrecta('R-ASISTENTE'));
  expect((await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${recetaId}/evaluar`, {})).status).toBe(200);
  lineaId = (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${recetaId}`)).json.lineas[0].id;
  sinEvaluarId = await crearReceta(E.app);
  const g = await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${sinEvaluarId}`);
  sinEvaluarId = g.json.lineas[0].id;
}, 180_000);
afterAll(async () => {
  await E.app.close();
});

describe('contexto de una línea: lista blanca sin datos personales', () => {
  it('es el resultado del motor más campos no personales, y no contiene nada del titular ni del veterinario', async () => {
    const svc = new ContextoLineaService(E.deps);
    const dto = await svc.cargar(lineaId);
    expect(dto).not.toBeNull();
    expect(ContextoLineaDto.safeParse(dto).success).toBe(true);
    expect(dto?.resultado.decision).toBe('DISPENSAR');
    expect(dto?.receta).toMatchObject({
      especie: 'Perros',
      tipoReceta: 'papel',
      fechaEmision: expect.any(String),
    });
    expect(dto?.resultado.validez).toMatchObject({ caso: 'antimicrobiano' });
    const texto = JSON.stringify(dto);
    for (const p of PERSONALES) expect(texto).not.toContain(p);
    expect(Object.keys(dto!.receta).sort()).toEqual([
      'cantidad',
      'clasePrescripcion',
      'concentracion',
      'especie',
      'fechaEmision',
      'forma',
      'indicacion',
      'numeroAnimales',
      'posologia',
      'tipoReceta',
      'tipoTratamiento',
    ]);
  });

  it('una línea sin evaluar o inexistente no tiene contexto', async () => {
    const svc = new ContextoLineaService(E.deps);
    expect(await svc.cargar(sinEvaluarId)).toBeNull();
    expect(await svc.existe(sinEvaluarId)).toBe(false);
    expect(await svc.cargar('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('descifra en memoria los datos del titular y del veterinario para poder eliminarlos', async () => {
    const conocidos = await new ContextoLineaService(E.deps).conocidos(lineaId);
    expect(conocidos).toEqual(
      expect.arrayContaining([
        'Titular de demostración',
        '600 000 000',
        'Veterinaria de demostración',
        'demo@example.org',
      ]),
    );
  });

  it('el texto libre de la receta con un dato personal dentro se limpia', async () => {
    await confirmar(E.app, recetaId, (r) => ({
      ...recetaCorrecta('R-ASISTENTE')(r),
      indicacion: 'Infección cutánea; avisar a Titular de demostración al 600 000 000',
    }));
    await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${recetaId}/evaluar`, {});
    const dto = await new ContextoLineaService(E.deps).cargar(lineaId);
    expect(dto?.receta.indicacion).not.toMatch(/Titular|600/);
    expect(dto?.receta.indicacion).toContain('Infección cutánea');
  });
});

describe('conversación sobre una línea (US2)', () => {
  const abrir = (id: string) =>
    api(E.app, 'dev-empleado', 'POST', '/api/asistente/conversaciones', {
      contexto: { tipo: 'linea', recetaLineaId: id },
    });

  it('una línea sin evaluar → 404', async () => {
    const r = await abrir(sinEvaluarId);
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('RECETA_LINEA_NO_ENCONTRADA');
  });

  it('explica el resultado del motor, lo guarda y pinta lo mismo que la línea (US2-AS1)', async () => {
    const c = await abrir(lineaId);
    expect(c.status).toBe(201);
    expect(c.json.preguntasEjemplo.length).toBeGreaterThan(0);
    const r = await api(
      E.app,
      'dev-empleado',
      'POST',
      `/api/asistente/conversaciones/${c.json.id}/mensajes`,
      { pregunta: '¿Por qué no puedo dispensar esto? El teléfono del titular es 600 000 000' },
    );
    expect(r.status).toBe(200);
    const i = r.json.intercambio;
    expect(i.tipo).toBe('respondida');
    expect(i.piiEliminada).toBe(true);
    expect(i.pregunta).not.toContain('600');
    expect(i.texto).not.toContain('Titular de demostración'); // eliminado también del texto del modelo
    expect(i.fuentes[0].fuenteId).toBe(`motor:linea/${lineaId}`);
    const dto = await new ContextoLineaService(E.deps).cargar(lineaId);
    expect(i.resultadoMotor).toEqual(dto?.resultado);
    const [fila] = await E.h.db.select().from(asistenteIntercambio).where(eq(asistenteIntercambio.id, i.id));
    expect(fila?.contextoMotor).toEqual(dto?.resultado);
    for (const p of PERSONALES) expect(JSON.stringify(fila)).not.toContain(p);
  });

  it('la fuente «resultado de la línea» se puede abrir', async () => {
    const r = await api(
      E.app,
      'dev-empleado',
      'GET',
      `/api/asistente/fuentes/${encodeURIComponent(`motor:linea/${lineaId}`)}`,
    );
    expect(r.status).toBe(200);
    expect(r.json.contenido).toContain('DISPENSAR');
    for (const p of PERSONALES) expect(r.json.contenido).not.toContain(p);
  });
});
