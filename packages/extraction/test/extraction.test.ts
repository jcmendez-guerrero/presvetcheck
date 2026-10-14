import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CAMPOS_EXTRAIDOS_LINEA, CAMPOS_EXTRAIDOS_RECETA, RecetaConfirmada } from '@mmx/shared';
import { FakeRecipeExtractor } from '../src/fake';
import { jsonSchemaReceta } from '../src/llm-schema';
import { confianzaCampo } from '../src/confianza';
import { AzureRecipeExtractor, cargarPrompt, PROMPT_VERSION } from '../src/azure/extractor';
import { DocumentIntelligenceClient } from '../src/azure/docintel';
import { AzureOpenAiClient } from '../src/azure/openai';
import { crearExtractor, DisabledRecipeExtractor } from '../src/factory';
import { borradorDesdeExtraccion, fechaIso, plazo, tipoDispensacion } from '../src/borrador';
import { compararExtraccion, costeEstimado } from '../src/eval/metricas';

const DIR = resolve(__dirname, '../../../fixtures/recetas');
const hoy = () => '2026-10-14';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('FakeRecipeExtractor', () => {
  const fake = new FakeRecipeExtractor({ dir: DIR, hoy });
  it('devuelve la fixture pedida y sustituye @HOY-n', async () => {
    const r = await fake.extract({ pages: [], mime: 'image/png', hints: { fixture: 'demo-compania-papel' } });
    expect(r.proveedor).toBe('fake');
    expect(r.modelo).toBe('fixture:demo-compania-papel');
    expect(r.receta.fechaEmision?.valor).toBe('2026-10-13');
    expect(r.lineas[0]?.medicamento?.valor).toMatch(/Clavubay/);
    expect(fake.fixtures()).toContain('demo-solo-principio-activo');
  });
  it('sin hint usa la fixture por defecto o la primera', async () => {
    expect((await fake.extract({ pages: [new Uint8Array([1])], mime: 'image/png' })).modelo).toBe('fixture:demo-compania-papel');
    const def = new FakeRecipeExtractor({ dir: DIR, hoy, porDefecto: 'demo-produccion-electronica' });
    expect((await def.extract({ pages: [], mime: 'image/png' })).receta.tipo?.valor).toBe('electronica');
  });
  it('elige por SHA-256 de la imagen si hay pareja imagen + JSON', async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), 'recetas-'));
    copyFileSync(resolve(DIR, 'demo-compania-papel.expected.json'), resolve(tmp, 'a.expected.json'));
    copyFileSync(resolve(DIR, 'demo-produccion-electronica.expected.json'), resolve(tmp, 'b.expected.json'));
    writeFileSync(resolve(tmp, 'b.png'), Buffer.from([9, 9, 9]));
    writeFileSync(resolve(tmp, 'nota.txt'), 'x');
    const r = await new FakeRecipeExtractor({ dir: tmp, hoy }).extract({ pages: [new Uint8Array([9, 9, 9])], mime: 'image/png' });
    expect(r.modelo).toBe('fixture:b');
  });
  it('sin fixtures → error claro', async () => {
    const vacio = new FakeRecipeExtractor({ dir: mkdtempSync(resolve(tmpdir(), 'vacio-')), hoy });
    await expect(vacio.extract({ pages: [], mime: 'image/png' })).rejects.toThrow(/No hay fixtures/);
    expect(new FakeRecipeExtractor({ dir: '/no/existe', hoy }).fixtures()).toEqual([]);
  });
});

describe('esquema para structured outputs (strict)', () => {
  it('todas las propiedades obligatorias y sin propiedades adicionales', () => {
    const s = jsonSchemaReceta() as { properties: { receta: { required: string[]; additionalProperties: boolean }; lineas: { items: { required: string[] } } }; additionalProperties: boolean };
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.receta.required.sort()).toEqual([...CAMPOS_EXTRAIDOS_RECETA].sort());
    expect(s.properties.receta.additionalProperties).toBe(false);
    expect(s.properties.lineas.items.required.sort()).toEqual([...CAMPOS_EXTRAIDOS_LINEA].sort());
    expect(JSON.stringify(s)).not.toContain('$schema');
  });
  it('el prompt versionado existe y prohíbe inventar', () => {
    expect(PROMPT_VERSION).toBe('receta.v1');
    expect(cargarPrompt()).toMatch(/No inventes valores/);
  });
});

describe('confianza combinada (SPEC §5.3)', () => {
  const ocr = 'Nº colegiado 28/1234 Firma';
  const palabras = [
    { texto: 'colegiado', confianza: 0.99, pagina: 1, poligono: [1, 2] },
    { texto: '28/1234', confianza: 0.6, pagina: 1, poligono: [3, 4] },
  ];
  it.each`
    caso                             | valor        | evidencia        | llm    | esperado
    ${'mínimo de OCR y modelo'}       | ${'28/1234'} | ${'28/1234'}     | ${0.95} | ${0.6}
    ${'evidencia ausente del OCR'}    | ${'28/9999'} | ${'28/9999'}     | ${0.95} | ${0.5}
    ${'sin evidencia'}               | ${'x'}       | ${null}          | ${0.9}  | ${0.5}
    ${'valor nulo'}                  | ${null}      | ${null}          | ${0.2}  | ${0.2}
    ${'evidencia sin palabras OCR'}  | ${'firma'}   | ${'Firma'}       | ${0.9}  | ${0.5}
  `('$caso', ({ valor, evidencia, llm, esperado }) => {
    expect(confianzaCampo(valor, evidencia, llm, ocr, palabras).confianza).toBeCloseTo(esperado);
  });
  it('devuelve la página y la región de la evidencia', () => {
    expect(confianzaCampo('28/1234', '28/1234', 1, ocr, palabras)).toMatchObject({ pagina: 1, region: [3, 4] });
  });
});

describe('AzureRecipeExtractor (MSW: Document Intelligence + Azure OpenAI)', () => {
  const DI = 'https://di.test';
  const AOAI = 'https://aoai.test';
  const getToken = async () => 'token-entra';
  const vacio = { valor: null, evidencia: null, confianza: 0 };
  const llmRespuesta = {
    receta: {
      ...Object.fromEntries(CAMPOS_EXTRAIDOS_RECETA.map((c) => [c, vacio])),
      numero: { valor: 'R-77', evidencia: 'R-77', confianza: 0.99 },
      numAnimales: { valor: '3 animales', evidencia: '3', confianza: 0.9 },
      firmaDetectada: { valor: 'true', evidencia: 'Firma', confianza: 0.8 },
      veterinarioNombre: { valor: 'Dra. Inventada', evidencia: 'Dra. Inventada', confianza: 0.99 },
    },
    lineas: [{ ...Object.fromEntries(CAMPOS_EXTRAIDOS_LINEA.map((c) => [c, vacio])), medicamento: { valor: 'Clavubay', evidencia: 'Clavubay', confianza: 0.97 } }],
  };

  function handlers(opts: { diFalla?: boolean; rechazo?: boolean } = {}) {
    let polls = 0;
    let authDi: string | null = null;
    let body: Record<string, unknown> = {};
    return {
      get: () => ({ polls, authDi, body }),
      list: [
        http.post(`${DI}/documentintelligence/documentModels/prebuilt-layout:analyze`, ({ request }) => {
          authDi = request.headers.get('authorization');
          return new HttpResponse(null, { status: 202, headers: { 'operation-location': `${DI}/ops/1` } });
        }),
        http.get(`${DI}/ops/1`, () => {
          polls++;
          if (polls === 1) return HttpResponse.json({ status: 'running' });
          if (opts.diFalla) return HttpResponse.json({ status: 'failed', error: { message: 'imagen ilegible' } });
          return HttpResponse.json({
            status: 'succeeded',
            analyzeResult: {
              content: 'Receta R-77 Clavubay 3 Firma',
              pages: [{ pageNumber: 1, words: [{ content: 'R-77', confidence: 0.98 }, { content: 'Clavubay', confidence: 0.7 }, { content: '3', confidence: 0.99 }, { content: 'Firma', confidence: 0.9 }] }],
              styles: [{ isHandwritten: true, spans: [{ offset: 0, length: 6 }] }],
            },
          });
        }),
        http.post(`${AOAI}/openai/deployments/:dep/chat/completions`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          if (opts.rechazo) return HttpResponse.json({ choices: [{ message: { content: null, refusal: 'no' } }] });
          return HttpResponse.json({ model: 'gpt-4o-2024-08-06', usage: { prompt_tokens: 100, completion_tokens: 50 }, choices: [{ message: { content: JSON.stringify(llmRespuesta) } }] });
        }),
      ],
    };
  }
  const extractor = () =>
    new AzureRecipeExtractor(
      new DocumentIntelligenceClient({ endpoint: `${DI}/`, getToken, sleep: async () => {} }),
      new AzureOpenAiClient({ endpoint: AOAI, deployment: 'gpt4o-eu', apiVersion: '2024-10-21', getToken }),
      'gpt4o-eu',
    );

  it('OCR + structured outputs → campos con confianza, evidencia y tipos', async () => {
    const h = handlers();
    server.use(...h.list);
    const r = await extractor().extract({ pages: [new Uint8Array([1, 2, 3])], mime: 'image/png' });
    expect(h.get().polls).toBe(2);
    expect(h.get().authDi).toBe('Bearer token-entra');
    const body = h.get().body as { response_format: { type: string; json_schema: { strict: boolean } }; temperature: number };
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.temperature).toBe(0);
    expect(r).toMatchObject({ proveedor: 'azure', promptVersion: 'receta.v1', modelo: 'gpt4o-eu (gpt-4o-2024-08-06)' });
    expect(r.receta.numero).toMatchObject({ valor: 'R-77', fuente: 'llm' });
    expect(r.receta.numero?.confianza).toBeCloseTo(0.98);
    expect(r.receta.numAnimales?.valor).toBe(3);
    expect(r.receta.firmaDetectada?.valor).toBe(true);
    // Evidencia que no aparece en el OCR → confianza máxima 0,5 (posible invención del modelo).
    expect(r.receta.veterinarioNombre?.confianza).toBe(0.5);
    expect(r.lineas[0]?.medicamento?.confianza).toBeCloseTo(0.7);
    expect(r.ocrTexto).toContain('Clavubay');
  });

  it('errores de Document Intelligence y rechazo del modelo', async () => {
    server.use(...handlers({ diFalla: true }).list);
    await expect(extractor().extract({ pages: [new Uint8Array([1])], mime: 'image/png' })).rejects.toThrow(/imagen ilegible/);
    server.resetHandlers();
    server.use(...handlers({ rechazo: true }).list);
    await expect(extractor().extract({ pages: [new Uint8Array([1])], mime: 'application/pdf' })).rejects.toThrow(/rechazó/);
    server.resetHandlers();
    server.use(http.post(`${DI}/documentintelligence/documentModels/prebuilt-layout:analyze`, () => new HttpResponse(null, { status: 401 })));
    await expect(extractor().extract({ pages: [new Uint8Array([1])], mime: 'image/png' })).rejects.toThrow(/401/);
  });
});

describe('fábrica de extractores', () => {
  const base = { AOAI_API_VERSION: '2024-10-21', DOCINTEL_ENDPOINT: undefined, AOAI_ENDPOINT: undefined, AOAI_DEPLOYMENT: undefined };
  it('fake por defecto; azure sin configuración → desactivado con código estable', async () => {
    expect((await crearExtractor({ ...base, EXTRACTOR: 'fake' }, { fixturesDir: DIR, hoy })).proveedor).toBe('fake');
    const d = await crearExtractor({ ...base, EXTRACTOR: 'azure' }, { fixturesDir: DIR, hoy });
    expect(d).toBeInstanceOf(DisabledRecipeExtractor);
    await expect(d.extract({ pages: [], mime: 'image/png' })).rejects.toMatchObject({ code: 'EXTRACTOR_NO_CONFIGURADO' });
  });
  it('azure configurado', async () => {
    const a = await crearExtractor(
      { ...base, EXTRACTOR: 'azure', DOCINTEL_ENDPOINT: 'https://di', AOAI_ENDPOINT: 'https://ao', AOAI_DEPLOYMENT: 'd' },
      { fixturesDir: DIR, hoy, getToken: async () => 't' },
    );
    expect(a.proveedor).toBe('azure');
  });
});

describe('borrador para la revisión humana', () => {
  it('nunca marca la firma ni la comprobación desde la IA y lista los campos dudosos', async () => {
    const ext = await new FakeRecipeExtractor({ dir: DIR, hoy }).extract({ pages: [], mime: 'image/png', hints: { fixture: 'demo-compania-papel' } });
    const b = borradorDesdeExtraccion(ext, 0.85);
    const r = RecetaConfirmada.parse(b.receta);
    expect(r.firmaConfirmada).toBe(false);
    expect(r.comprobadoConOriginal).toBe(false);
    expect(r.fechaEmision).toBe('2026-10-13');
    expect(r.tipoDispensacion).toBe('dispensacion');
    expect(r.lineas[0]?.declaracionAntimicrobiano).toEqual({ declarada: true, finalidad: null });
    expect(b.dudosos).toContain('receta.titularTelefono');
    expect(b.dudosos).toContain('lineas.0.declaracionAntimicrobiano');
    expect(b.dudosos).toContain('receta.rega');
  });
  it('receta electrónica y utilidades de conversión', async () => {
    const ext = await new FakeRecipeExtractor({ dir: DIR, hoy }).extract({ pages: [], mime: 'image/png', hints: { fixture: 'demo-produccion-electronica' } });
    expect(borradorDesdeExtraccion(ext, 0.85).receta.tipo).toBe('electronica');
    expect(borradorDesdeExtraccion({ ...ext, lineas: [] }, 0.85).receta.lineas).toHaveLength(1);
    expect(fechaIso('3/2/26')).toBe('2026-02-03');
    expect(fechaIso('13.10.2026')).toBe('2026-10-13');
    expect(fechaIso('ayer')).toBeNull();
    expect(tipoDispensacion('De botiquín')).toBe('botiquin');
    expect(tipoDispensacion('de no dispensación')).toBe('no_dispensacion');
    expect(tipoDispensacion('Receta de dispensación')).toBe('dispensacion');
    expect(tipoDispensacion('otra')).toBeNull();
    expect(plazo('validez 10 días')).toEqual({ cantidad: 10, unidad: 'dias' });
    expect(plazo('3 meses')).toEqual({ cantidad: 3, unidad: 'meses' });
    expect(plazo('larga')).toBeNull();
  });
});

describe('métricas del banco de evaluación', () => {
  it('exactitud exacta/normalizada y coste', async () => {
    const fake = new FakeRecipeExtractor({ dir: DIR, hoy });
    const e = await fake.extract({ pages: [], mime: 'x', hints: { fixture: 'demo-compania-papel' } });
    const o = structuredClone(e);
    o.receta.numero = { ...o.receta.numero!, valor: 'demo-0001' };
    const m = compararExtraccion(e, o, 0.85);
    expect(m.get('receta.numero')).toMatchObject({ total: 1, exactos: 0, normalizados: 1 });
    expect(m.get('lineas.medicamento')).toMatchObject({ exactos: 1 });
    expect(costeEstimado(1, 1000, 1000)).toBeCloseTo(0.0094 + 0.0023 + 0.0092);
  });
});
