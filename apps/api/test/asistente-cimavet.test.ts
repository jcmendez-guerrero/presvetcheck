import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearHerramientas, type ResultadoHerramienta } from '@mmx/assistant';
import { CimavetRepository } from '@mmx/cimavet';
import { entorno, CLOCK, type Entorno } from './entorno';

const CTX = { contexto: { tipo: 'general' as const } };
let E: Entorno;
beforeAll(async () => {
  E = await entorno();
}, 180_000);
afterAll(async () => {
  await E.app.close();
});

const herramientas = (
  o: {
    maxEdadCimavetH?: number;
    exclusiones?: { nregistro: string | null; pa_id: number | null; motivo: string; fuente: string }[];
  } = {},
) =>
  crearHerramientas({
    rules: o.exclusiones
      ? {
          ...E.deps.rules.bundle,
          exclusiones: { ...E.deps.rules.bundle.exclusiones, exclusiones: o.exclusiones },
        }
      : E.deps.rules.bundle,
    clock: CLOCK,
    indice: null,
    cimavet: new CimavetRepository(E.h.db),
    permitirCambioFormato: true,
    maxEdadCimavetH: o.maxEdadCimavetH ?? 24,
  });
const llamar = async (t: ReturnType<typeof herramientas>, nombre: string, args: unknown) => {
  const h = t.obtener(nombre, CTX)!;
  const parsed = (h.args as unknown as { parse(v: unknown): unknown }).parse(args);
  return (h as unknown as { ejecutar(a: unknown, c: unknown): Promise<ResultadoHerramienta> }).ejecutar(
    parsed,
    CTX,
  );
};

describe('buscar_medicamento (FR-017)', () => {
  it('devuelve candidatos con sus presentaciones y la versión de los datos', async () => {
    const r = await llamar(herramientas(), 'buscar_medicamento', { nombre: 'clavubay' });
    const d = r.datos as {
      candidatos: { nregistro: string; presentaciones: { cn: string }[] }[];
      version: string;
    };
    expect(d.candidatos.length).toBeGreaterThan(0);
    expect(d.candidatos[0]?.nregistro).toBe('1868 ESP');
    expect(d.candidatos[0]?.presentaciones.map((p) => p.cn)).toContain('570016');
    expect(r.fuentes?.[0]).toMatchObject({ tipo: 'cimavet', fuenteId: 'cimavet:busqueda' });
  });

  it('con varios medicamentos posibles avisa de que la persona debe elegir y no devuelve más de 10', async () => {
    const r = await llamar(herramientas(), 'buscar_medicamento', { nombre: 'comprimidos' });
    const d = r.datos as { candidatos: unknown[]; aviso?: string };
    expect(d.candidatos.length).toBeGreaterThan(1);
    expect(d.candidatos.length).toBeLessThanOrEqual(10);
    expect(d.aviso).toMatch(/elija/);
  });

  it('un nombre que no existe no devuelve candidatos', async () => {
    const r = await llamar(herramientas(), 'buscar_medicamento', { nombre: 'zzzxxqq' });
    expect((r.datos as { candidatos: unknown[] }).candidatos).toEqual([]);
  });
});

describe('ficha_medicamento (FR-016)', () => {
  it('lleva los atributos de CIMAVet y la fecha de la última sincronización', async () => {
    const r = await llamar(herramientas(), 'ficha_medicamento', { nregistro: '1868 ESP' });
    expect(r.datos).toMatchObject({
      encontrado: true,
      nombre: expect.stringContaining('CLAVUBAY'),
      sujetoPrescripcion: true,
      antimicrobiano: true,
      psicotropo: false,
      estupefaciente: false,
      desactualizado: false,
      ultimaSincronizacion: '2026-10-14T06:00:00.000Z',
      excluidoSustitucion: { excluido: false },
    });
    expect(r.fuentes?.[0]).toMatchObject({
      fuenteId: 'cimavet:1868 ESP',
      version: '2026-10-14T06:00:00.000Z',
    });
  });

  it('avisa si los datos están desactualizados', async () => {
    const r = await llamar(herramientas({ maxEdadCimavetH: 1 }), 'ficha_medicamento', {
      nregistro: '1868 ESP',
    });
    expect((r.datos as { desactualizado: boolean }).desactualizado).toBe(true);
  });

  it('indica si está en la lista de exclusiones de la sustitución', async () => {
    const r = await llamar(
      herramientas({
        exclusiones: [{ nregistro: '1868 ESP', pa_id: null, motivo: 'estrecho margen', fuente: 'prueba' }],
      }),
      'ficha_medicamento',
      { nregistro: '1868 ESP' },
    );
    expect((r.datos as { excluidoSustitucion: unknown }).excluidoSustitucion).toMatchObject({
      excluido: true,
      motivo: 'estrecho margen',
    });
  });

  it('un medicamento que no está en CIMAVet remite a la Ayuda y no inventa datos', async () => {
    const r = await llamar(herramientas(), 'ficha_medicamento', { nregistro: '0000 XX' });
    expect(r.datos).toMatchObject({ encontrado: false });
    expect(r.fuentes ?? []).toEqual([]);
  });
});
