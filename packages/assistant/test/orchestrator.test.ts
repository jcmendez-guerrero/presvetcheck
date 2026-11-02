import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ChatOrchestrator, MAX_RONDAS } from '../src/orchestrator';
import { FakeAssistantModel, type Guion } from '../src/fake';
import { ToolRegistry, type Herramienta } from '../src/tools/registry';
import { TEXTO_SIN_INFORMACION } from '../src/textos';
import type { AssistantModel, PeticionModelo, RespuestaModelo } from '../src/model';

const herramientaReglas: Herramienta<{ tema: string }> = {
  nombre: 'consultar_reglas',
  descripcion: 'Reglas',
  args: z.object({ tema: z.string() }),
  async ejecutar({ tema }) {
    const f = {
      fuenteId: `regla:${tema}`,
      tipo: 'regla' as const,
      titulo: tema,
      version: 'validez.v1@abcd1234',
    };
    return { datos: { ...f, contenido: { antimicrobiano: 'x' } }, fuentes: [f] };
  },
};
const herramientaSim: Herramienta<{ fecha: string }> = {
  nombre: 'simular_validez',
  descripcion: 'Sim',
  args: z.object({ fecha: z.string() }),
  async ejecutar({ fecha }) {
    const sim = {
      simulacionId: 'sim1',
      herramienta: 'simular_validez',
      decision: 'VALIDA_HASTA' as const,
      motivos: [],
      evidencias: { hasta: '2026-10-08' },
      supuestos: { fecha },
      reglaVersion: 'validez.v1@abcd1234',
    };
    return { datos: sim, simulacion: sim };
  },
};
const registro = () => new ToolRegistry([herramientaReglas as never, herramientaSim as never]);
const salida = (o: Record<string, unknown> = {}) => ({
  tipo: 'respondida',
  texto: 'Cinco días.',
  fuentes: ['regla:validez'],
  simulaciones: [],
  usaContextoLinea: false,
  ...o,
});
const orq = (guiones: Guion[]) =>
  new ChatOrchestrator({
    modelo: new FakeAssistantModel(guiones),
    herramientas: registro(),
    instrucciones: 'x',
  });
const entrada = (pregunta: string) => ({ pregunta, historial: [], contexto: { tipo: 'general' as const } });

describe('ChatOrchestrator', () => {
  it('ejecuta las herramientas y devuelve la respuesta con la fuente citada', async () => {
    const r = await orq([
      {
        cuando: /validez/i,
        rondas: [[{ nombre: 'consultar_reglas', args: { tema: 'validez' } }]],
        final: () => salida(),
      },
    ]).responder(entrada('¿Validez?'));
    expect(r.degradada).toBe(false);
    expect(r.salida.tipo).toBe('respondida');
    expect(r.fuentes.map((f) => f.fuenteId)).toEqual(['regla:validez']);
    expect(r.rondas).toBe(1);
    expect(r.uso.entrada).toBeGreaterThan(0);
  });

  it('añade las simulaciones del turno aunque el modelo las omita', async () => {
    const r = await orq([
      {
        cuando: /octubre/i,
        rondas: [
          [
            { nombre: 'consultar_reglas', args: { tema: 'validez' } },
            { nombre: 'simular_validez', args: { fecha: '2026-10-03' } },
          ],
        ],
        final: () => salida(),
      },
    ]).responder(entrada('Receta del 3 de octubre'));
    expect(r.simulaciones.map((s) => s.simulacionId)).toEqual(['sim1']);
  });

  it('una cita inventada se corrige con un reintento', async () => {
    let n = 0;
    const r = await orq([
      {
        cuando: /validez/i,
        rondas: [[{ nombre: 'consultar_reglas', args: { tema: 'validez' } }]],
        final: () => (n++ === 0 ? salida({ fuentes: ['regla:inventada'] }) : salida()),
      },
    ]).responder(entrada('validez'));
    expect(r.degradada).toBe(false);
    expect(r.fuentes.map((f) => f.fuenteId)).toEqual(['regla:validez']);
  });

  it('si sigue sin ser válida, responde «sin información»', async () => {
    const r = await orq([
      { cuando: /validez/i, rondas: [], final: () => salida({ fuentes: ['regla:inventada'] }) },
    ]).responder(entrada('validez'));
    expect(r.degradada).toBe(true);
    expect(r.salida).toMatchObject({ tipo: 'sin_informacion', texto: TEXTO_SIN_INFORMACION, fuentes: [] });
  });

  it('una herramienta desconocida o con argumentos no válidos devuelve error al modelo, sin lanzar', async () => {
    const vistos: string[] = [];
    const modelo: AssistantModel = {
      nombre: 'm',
      async chat(p: PeticionModelo): Promise<RespuestaModelo> {
        const tools = p.mensajes.filter((m) => m.role === 'tool');
        vistos.push(...tools.map((t) => (t as { content: string }).content));
        if (!tools.length) {
          return {
            tipo: 'herramientas',
            uso: { entrada: 1, salida: 1 },
            llamadas: [
              { id: 'a', nombre: 'no_existe', argumentos: '{}' },
              { id: 'b', nombre: 'consultar_reglas', argumentos: '{"mal":1}' },
              { id: 'c', nombre: 'consultar_reglas', argumentos: 'no json' },
            ],
          };
        }
        return {
          tipo: 'final',
          contenido: JSON.stringify(salida({ tipo: 'sin_informacion', fuentes: [] })),
          uso: { entrada: 1, salida: 1 },
        };
      },
    };
    const r = await new ChatOrchestrator({ modelo, herramientas: registro(), instrucciones: 'x' }).responder(
      entrada('x'),
    );
    expect(r.salida.tipo).toBe('sin_informacion');
    expect(vistos.join('|')).toMatch(/HERRAMIENTA_DESCONOCIDA.*ARGUMENTOS_NO_VALIDOS.*ARGUMENTOS_NO_VALIDOS/);
  });

  it('limita las rondas de herramientas', async () => {
    let llamadasConHerramientas = 0;
    const modelo: AssistantModel = {
      nombre: 'm',
      async chat(p) {
        if (p.permitirHerramientas) {
          llamadasConHerramientas++;
          return {
            tipo: 'herramientas',
            uso: { entrada: 1, salida: 1 },
            llamadas: [
              {
                id: String(llamadasConHerramientas),
                nombre: 'consultar_reglas',
                argumentos: '{"tema":"validez"}',
              },
            ],
          };
        }
        return { tipo: 'final', contenido: JSON.stringify(salida()), uso: { entrada: 1, salida: 1 } };
      },
    };
    const r = await new ChatOrchestrator({ modelo, herramientas: registro(), instrucciones: 'x' }).responder(
      entrada('x'),
    );
    expect(llamadasConHerramientas).toBe(MAX_RONDAS);
    expect(r.rondas).toBe(MAX_RONDAS);
  });

  it('el texto final no puede incluir datos personales conocidos', async () => {
    const r = await orq([
      {
        cuando: /hola/i,
        rondas: [[{ nombre: 'consultar_reglas', args: { tema: 'validez' } }]],
        final: () => salida({ texto: 'Pregunta a María López.' }),
      },
    ]).responder({ ...entrada('hola'), conocidos: ['María López'] });
    expect(r.salida.texto).not.toMatch(/María|López/);
  });

  it('da al modelo la fecha de hoy cuando se la pasan', async () => {
    let sistema = '';
    const modelo: AssistantModel = {
      nombre: 't',
      async chat(p: PeticionModelo): Promise<RespuestaModelo> {
        sistema = p.mensajes
          .filter((m) => m.role === 'system')
          .map((m) => m.content)
          .join('|');
        return {
          tipo: 'final',
          contenido: JSON.stringify(salida({ tipo: 'sin_informacion', fuentes: [] })),
          uso: { entrada: 1, salida: 1 },
        };
      },
    };
    await new ChatOrchestrator({ modelo, herramientas: registro(), instrucciones: 'x' }).responder({
      ...entrada('x'),
      hoy: '2026-11-02',
    });
    expect(sistema).toContain('02/11/2026');
  });

  it('muestra la simulación calculada en el turno aunque el modelo no la liste', async () => {
    const r = await orq([
      {
        cuando: /octubre/i,
        rondas: [[{ nombre: 'simular_validez', args: { fecha: '2026-10-03' } }]],
        final: () => salida({ fuentes: [], simulaciones: [] }),
      },
    ]).responder(entrada('Receta del 3 de octubre'));
    expect(r.simulaciones.map((x) => x.simulacionId)).toEqual(['sim1']);
    expect(r.salida.simulaciones).toEqual(['sim1']);
  });
});
