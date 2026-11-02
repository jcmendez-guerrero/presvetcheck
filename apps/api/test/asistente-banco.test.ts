import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { FakeAssistantModel, cargarBanco, guionesDemo } from '@mmx/assistant';
import type { RecetaConfirmadaInput } from '@mmx/shared';
import { api, confirmar, crearReceta, entorno, recetaCorrecta, ROOT, type Entorno } from './entorno';

/**
 * El banco de evaluación v1 se ejecuta con el modelo falso (guiones) contra la API, las herramientas y las fuentes
 * reales: comprueba el andamiaje (herramientas, validación de citas, saneado de datos personales), no al modelo.
 * Contra el servicio real se lanza a mano: `pnpm eval:asistente`.
 */
const banco = cargarBanco(resolve(ROOT, 'fixtures/asistente/banco.v1.yaml'));
let E: Entorno;
beforeAll(async () => {
  E = await entorno({ asistente: new FakeAssistantModel(guionesDemo(2026)) });
}, 180_000);
afterAll(async () => {
  await E.app.close();
});

/** Prepara la receta de cada caso de US2 y devuelve el id de su primera línea (ya evaluada por el motor). */
async function lineaDe(seed: string): Promise<string> {
  const evaluar = async (id: string) => {
    expect((await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {})).status).toBe(200);
    return (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.lineas[0].id as string;
  };
  if (seed === 'solo-principio-activo') {
    const id = await crearReceta(E.app, 'demo-solo-principio-activo');
    await confirmar(E.app, id, (r) => ({
      ...r,
      firmaConfirmada: true,
      comprobadoConOriginal: true,
      especie: { texto: 'Perro', especieId: 14 },
      veterinario: { ...r.veterinario!, numColegiado: '28/0001' },
      lineas: (r.lineas ?? []).map((l) => ({ ...l, cn: '570016', nregistro: '1868 ESP' })),
    }));
    return evaluar(id);
  }
  const id = await crearReceta(E.app);
  const antigua =
    seed === 'caducada'
      ? (r: RecetaConfirmadaInput): RecetaConfirmadaInput => ({ ...r, fechaEmision: '2026-08-01' })
      : (r: RecetaConfirmadaInput) => r;
  await confirmar(E.app, id, (r) => antigua(recetaCorrecta(`R-BANCO-${seed}`)(r)));
  return evaluar(id);
}

describe('banco de evaluación v1 con el modelo falso', () => {
  it('tiene casos de todas las clases de US1 y de US2', () => {
    expect(banco.casos.length).toBeGreaterThanOrEqual(10);
    const tipos = new Set(banco.casos.map((c) => c.esperado.tipo));
    expect([...tipos]).toEqual(
      expect.arrayContaining(['respondida', 'sin_informacion', 'fuera_de_ambito', 'rechazo_reglas']),
    );
  });

  const casosConGuion = banco.casos.filter((c) => c.contexto === 'general' || c.contexto === 'linea');
  it.each(casosConGuion.map((c) => [c.id, c] as const))('%s', async (_id, caso) => {
    const contexto =
      caso.contexto === 'linea'
        ? { tipo: 'linea', recetaLineaId: await lineaDe(caso.lineaSeed ?? 'dispensar') }
        : { tipo: 'general' };
    const conv = await api(E.app, 'dev-empleado', 'POST', '/api/asistente/conversaciones', { contexto });
    expect(conv.status).toBe(201);
    const r = await api(
      E.app,
      'dev-empleado',
      'POST',
      `/api/asistente/conversaciones/${conv.json.id}/mensajes`,
      { pregunta: caso.pregunta },
    );
    expect(r.status).toBe(200);
    const i = r.json.intercambio;
    expect(i.tipo).toBe(caso.esperado.tipo);
    for (const t of caso.esperado.contiene) {
      const alternativas = Array.isArray(t) ? t : [t];
      expect(alternativas.some((a) => i.texto.toLowerCase().includes(a.toLowerCase()))).toBe(true);
    }
    for (const prefijo of caso.esperado.fuentes)
      expect(i.fuentes.some((f: { fuenteId: string }) => f.fuenteId.startsWith(prefijo))).toBe(true);
    if (caso.esperado.tipo === 'respondida') expect(i.fuentes.length).toBeGreaterThan(0);
    expect(i.simulaciones.length > 0).toBe(caso.esperado.simulacion);
    expect(i.piiEliminada).toBe(caso.esperado.piiEliminada);
    expect(JSON.stringify(i)).not.toMatch(/12345678|612345678|Titular de demostración|600 000 000/);
    if (caso.contexto === 'linea') expect(i.resultadoMotor).not.toBeNull();
    // Con varios candidatos la respuesta los lleva para que la persona elija (FR-017).
    // (solo cuando la aclaración es por una búsqueda de medicamento; una pregunta ambigua no lleva candidatos)
    if (caso.esperado.fuentes.includes('cimavet:busqueda')) expect(i.candidatos.length).toBeGreaterThan(1);
    else expect(i.candidatos).toBeUndefined();
  });
});
