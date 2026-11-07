import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CimavetRepository } from '@mmx/cimavet';
import { createTestDb } from '@mmx/db/testing';
import { fixedClock } from '@mmx/domain';
import type { RulesBundle } from '@mmx/shared';
import { loadRules } from '@mmx/shared/node';
import { IndiceFuentes } from '../src/fuentes/indice';
import { crearHerramientas, type DepsHerramientas } from '../src/tools';
import type { ResultadoHerramienta, ToolRegistry } from '../src/tools/registry';

const ROOT = resolve(__dirname, '../../..');
const RULES: RulesBundle = loadRules(resolve(ROOT, 'config/rules')).bundle;
const GUIA = readFileSync(resolve(ROOT, 'docs/ref/guia-receta-veterinaria.md'), 'utf8');
const CTX = { contexto: { tipo: 'general' as const } };

let deps: DepsHerramientas;
beforeAll(async () => {
  const h = await createTestDb({ seed: false });
  deps = {
    rules: RULES,
    clock: fixedClock('2026-10-14T10:00:00Z'),
    indice: new IndiceFuentes(GUIA),
    cimavet: new CimavetRepository(h.db),
    permitirCambioFormato: true,
    maxEdadCimavetH: 24,
  };
}, 60_000);

const llamar = async (r: ToolRegistry, nombre: string, args: unknown, ctx = CTX) => {
  const h = r.obtener(nombre, ctx);
  expect(h, `herramienta ${nombre}`).toBeDefined();
  const parsed = (h!.args as unknown as { parse(v: unknown): unknown }).parse(args);
  return (h as unknown as { ejecutar(a: unknown, c: unknown): Promise<ResultadoHerramienta> }).ejecutar(
    parsed,
    ctx,
  );
};

describe('consultar_reglas', () => {
  it('devuelve las reglas activas con la versión de su fichero', async () => {
    const r = await llamar(crearHerramientas(deps), 'consultar_reglas', { tema: 'validez' });
    expect(r.fuentes?.[0]).toMatchObject({ fuenteId: 'regla:validez', tipo: 'regla' });
    expect(r.fuentes?.[0]?.version).toMatch(/^validez\.v1@[0-9a-f]{8}$/);
    expect((r.datos as { contenido: { antimicrobiano: unknown } }).contenido.antimicrobiano).toEqual({
      dias: 5,
    });
  });

  it('si cambia la regla, cambian el contenido y la versión sin tocar el asistente (US1-AS3)', async () => {
    const otras: RulesBundle = {
      ...RULES,
      version: RULES.version.replace(/validez\.v1@[0-9a-f]{8}/, 'validez.v1@ffffffff'),
      validez: { ...RULES.validez, antimicrobiano: { dias: 7 } },
    };
    const r = await llamar(crearHerramientas({ ...deps, rules: otras }), 'consultar_reglas', {
      tema: 'validez',
    });
    expect(r.fuentes?.[0]?.version).toBe('validez.v1@ffffffff');
    expect((r.datos as { contenido: { antimicrobiano: unknown } }).contenido.antimicrobiano).toEqual({
      dias: 7,
    });
  });

  it('formato refleja la configuración', async () => {
    const r = await llamar(crearHerramientas({ ...deps, permitirCambioFormato: false }), 'consultar_reglas', {
      tema: 'formato',
    });
    expect((r.datos as { contenido: unknown }).contenido).toEqual({ permitirCambioFormato: false });
  });

  it('rechaza un tema que no existe', () => {
    expect(() =>
      (
        crearHerramientas(deps).obtener('consultar_reglas', CTX)!.args as unknown as {
          parse(v: unknown): unknown;
        }
      ).parse({ tema: 'otro' }),
    ).toThrow();
  });
});

describe('buscar_guia y buscar_ayuda', () => {
  it('devuelven fragmentos citables', async () => {
    const r = await llamar(crearHerramientas(deps), 'buscar_guia', {
      consulta: 'psicótropos un envase por receta',
    });
    expect(r.fuentes?.length).toBeGreaterThan(0);
    expect(r.fuentes?.every((f) => f.tipo === 'guia' && /^guia@/.test(f.version))).toBe(true);
    const a = await llamar(crearHerramientas(deps), 'buscar_ayuda', { consulta: 'albarán recepción' });
    expect(a.fuentes?.every((f) => f.tipo === 'ayuda')).toBe(true);
  });

  it('sin resultados lo indica para responder «sin información»', async () => {
    const r = await llamar(crearHerramientas(deps), 'buscar_guia', { consulta: 'zzzqqq xxxwww' });
    expect(r.fuentes ?? []).toEqual([]);
    expect(JSON.stringify(r.datos)).toContain('sin_informacion');
  });

  it('sin índice no hay resultados', async () => {
    const r = await llamar(crearHerramientas({ ...deps, indice: null }), 'buscar_guia', {
      consulta: 'sustitución',
    });
    expect((r.datos as { resultados: unknown[] }).resultados).toEqual([]);
  });
});

describe('simular_validez', () => {
  it('antibiótico, receta del 3 de octubre: el motor calcula la fecha límite', async () => {
    const r = await llamar(crearHerramientas(deps), 'simular_validez', {
      fechaEmision: '2026-10-03',
      lineas: [{ antimicrobiano: true }],
    });
    expect(r.simulacion).toMatchObject({
      decision: 'CADUCADA',
      herramienta: 'simular_validez',
      reglaVersion: RULES.version,
    });
    expect((r.simulacion?.evidencias as { validezEfectiva: string }).validezEfectiva).toBe('2026-10-08');
    expect(r.fuentes?.[0]).toMatchObject({ tipo: 'motor', version: RULES.version });
  });

  it('el id es estable para los mismos argumentos y distinto si cambian', async () => {
    const t = crearHerramientas(deps);
    const a = await llamar(t, 'simular_validez', { fechaEmision: '2026-10-03' });
    const b = await llamar(t, 'simular_validez', { fechaEmision: '2026-10-03' });
    const c = await llamar(t, 'simular_validez', { fechaEmision: '2026-10-04' });
    expect(a.simulacion?.simulacionId).toBe(b.simulacion?.simulacionId);
    expect(a.simulacion?.simulacionId).not.toBe(c.simulacion?.simulacionId);
  });

  it('faltan datos: pide la fecha en vez de suponerla', async () => {
    const r = await llamar(crearHerramientas(deps), 'simular_validez', {
      lineas: [{ antimicrobiano: true }],
    });
    expect(r.simulacion).toMatchObject({ decision: 'FALTAN_DATOS' });
    expect(r.simulacion?.faltan?.join(' ')).toContain('fecha de emisión');
  });

  it('un medicamento que no está en CIMAVet pide revisarlo en vez de inventarlo', async () => {
    const r = await llamar(crearHerramientas(deps), 'simular_validez', {
      fechaEmision: '2026-10-03',
      lineas: [{ nregistro: '0000 XX' }],
    });
    expect(r.simulacion?.decision).toBe('FALTAN_DATOS');
  });
});

describe('simular_sustituibilidad', () => {
  it('una vacuna (inmunológico) no se puede sustituir', async () => {
    const r = await llamar(crearHerramientas(deps), 'simular_sustituibilidad', {
      inmunologico: true,
      clasePrescripcion: 'ordinaria',
    });
    expect(r.simulacion).toMatchObject({ decision: 'NO_PERMITIDA' });
    expect(r.simulacion?.motivos.map((m) => m.code)).toContain('SUSTITUCION_PROHIBIDA_INMUNOLOGICO');
  });

  it('sin clase de prescripción queda bloqueada y lo explica', async () => {
    const r = await llamar(crearHerramientas(deps), 'simular_sustituibilidad', { biologico: true });
    expect(r.simulacion?.motivos.map((m) => m.code)).toContain('SUSTITUCION_PROHIBIDA_CLASE_NO_INDICADA');
  });

  it('sin medicamento ni categoría pide el dato', async () => {
    const r = await llamar(crearHerramientas(deps), 'simular_sustituibilidad', {});
    expect(r.simulacion?.decision).toBe('FALTAN_DATOS');
  });
});

describe('definiciones para el modelo', () => {
  it('contexto_linea solo está disponible en conversaciones de una línea', () => {
    const t = crearHerramientas({ ...deps, cargarContextoLinea: async () => null });
    expect(t.definiciones(CTX).map((d) => d.nombre)).not.toContain('contexto_linea');
    expect(
      t
        .definiciones({ contexto: { tipo: 'linea', recetaLineaId: '00000000-0000-4000-8000-000000000000' } })
        .map((d) => d.nombre),
    ).toContain('contexto_linea');
  });

  it('generan JSON Schema sin palabras clave que el modo estricto no admite', () => {
    const defs = crearHerramientas(deps).definiciones(CTX);
    expect(defs.map((d) => d.nombre)).toEqual([
      'consultar_reglas',
      'buscar_guia',
      'buscar_ayuda',
      'simular_validez',
      'simular_sustituibilidad',
      'simular_cambio_formato',
      'simular_equivalencia',
      'buscar_medicamento',
      'ficha_medicamento',
      'buscar_sustitutos',
      'consultar_stock',
    ]);
    const texto = JSON.stringify(defs);
    expect(texto).not.toMatch(/"(minLength|maxLength|minimum|maximum|\$schema)"/);
  });
});
