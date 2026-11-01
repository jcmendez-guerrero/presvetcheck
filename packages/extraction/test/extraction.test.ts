import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CAMPOS_EXTRAIDOS_LINEA, CAMPOS_EXTRAIDOS_RECETA, RecetaConfirmada } from '@mmx/shared';
import { FakeRecipeExtractor } from '../src/fake';
import { camposDocIntelStudio, convertir, ESQUEMA_CAMPOS_VERSION } from '../src/campos';
import { confianzaCampo } from '../src/confianza';
import { AzureRecipeExtractor } from '../src/azure/extractor';
import { DocumentIntelligenceClient } from '../src/azure/docintel';
import { crearExtractor, DisabledRecipeExtractor } from '../src/factory';
import { borradorDesdeExtraccion, esExcepcional, especieId, fechaIso, plazo, tipoDispensacion } from '../src/borrador';
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

describe('esquema de campos para Document Intelligence Studio', () => {
  it('fields.json con todos los campos de la receta y la tabla dinámica de líneas', () => {
    const f = camposDocIntelStudio();
    expect(f.fields.map((x) => x.fieldKey)).toEqual([...CAMPOS_EXTRAIDOS_RECETA, 'lineas']);
    expect(f.fields.find((x) => x.fieldKey === 'fechaEmision')?.fieldType).toBe('date');
    expect(f.fields.find((x) => x.fieldKey === 'firmaDetectada')?.fieldType).toBe('signature');
    expect(f.fields.find((x) => x.fieldKey === 'qrDetectado')?.fieldType).toBe('selectionMark');
    expect(f.fields.at(-1)).toMatchObject({ fieldType: 'array', itemType: 'lineas_fila' });
    expect(f.definitions.lineas_fila.fields.map((x) => x.fieldKey)).toEqual([...CAMPOS_EXTRAIDOS_LINEA]);
  });

  it('conversión de tipos', () => {
    expect(convertir('numAnimales', '3 animales')).toBe(3);
    expect(convertir('numAnimales', 'ninguno')).toBeNull();
    expect(convertir('firmaDetectada', 'signed')).toBe(true);
    expect(convertir('qrDetectado', 'unselected')).toBe(false);
    expect(convertir('numero', null)).toBeNull();
    expect(convertir('cantidadEnvases', '1,00')).toBe(1);
    expect(convertir('duracionDias', '2 semanas')).toBe(14);
    expect(convertir('cn', 'CN 570016.3')).toBe('570016');
    expect(convertir('cn', '12')).toBeNull();
  });
});

describe('confianza (SPEC §5.3)', () => {
  const palabras = [
    { texto: 'R-77', confianza: 0.98, pagina: 1, poligono: [1, 1, 2, 2], offset: 0, length: 4 },
    { texto: 'Clavubay', confianza: 0.7, pagina: 1, poligono: null, offset: 5, length: 8 },
  ];
  it.each([
    ['sin valor: la del modelo', null, 0.4, [], true, 0.4],
    ['mínimo entre modelo y OCR de sus palabras', 'R-77', 0.99, [{ offset: 0, length: 4 }], true, 0.98],
    ['el OCR más bajo manda', 'Clavubay', 0.95, [{ offset: 5, length: 8 }], true, 0.7],
    ['sin región en el documento → máximo 0,5', 'X', 0.99, [], false, 0.5],
    ['sin palabras en el span → la del modelo', 'Y', 0.9, [{ offset: 50, length: 3 }], true, 0.9],
  ])('%s', (_n, valor, modelo, spans, region, esperado) => {
    expect(confianzaCampo(valor, modelo, spans, region, palabras)).toBeCloseTo(esperado);
  });
});

describe('AzureRecipeExtractor (MSW: modelo personalizado de Document Intelligence)', () => {
  const DI = 'https://di.test';
  const getToken = async () => 'token-entra';
  const pagina = (fields: Record<string, unknown>, content: string) => ({
    status: 'succeeded',
    analyzeResult: {
      modelId: 'recetas-v1',
      content,
      pages: [{ pageNumber: 1, words: [{ content: 'R-77', confidence: 0.98, span: { offset: 7, length: 4 } }, { content: 'Clavubay', confidence: 0.7, span: { offset: 12, length: 8 } }] }],
      documents: [{ docType: 'recetas-v1', fields }],
    },
  });
  const region = [{ pageNumber: 1, polygon: [0, 0, 1, 0, 1, 1, 0, 1] }];
  const P1 = pagina(
    {
      numero: { type: 'string', valueString: 'R-77', content: 'R-77', confidence: 0.99, boundingRegions: region, spans: [{ offset: 7, length: 4 }] },
      fechaEmision: { type: 'date', valueDate: '2026-10-12', content: '12/10/2026', confidence: 0.95, boundingRegions: region },
      numAnimales: { type: 'number', valueNumber: 3, content: '3', confidence: 0.9, boundingRegions: region },
      firmaDetectada: { type: 'signature', valueSignature: 'signed', confidence: 0.8, boundingRegions: region },
      // Sin región: no se puede enseñar de dónde sale → máximo 0,5.
      veterinarioNombre: { type: 'string', valueString: 'Dra. Prueba', confidence: 0.99 },
      especie: { type: 'string', content: 'Canina', confidence: 0.6, boundingRegions: region },
      lineas: {
        type: 'array',
        valueArray: [
          { type: 'object', valueObject: { medicamento: { type: 'string', content: 'Clavubay', confidence: 0.97, boundingRegions: region, spans: [{ offset: 12, length: 8 }] }, cantidadEnvases: { type: 'number', content: '1', confidence: 0.9, boundingRegions: region } } },
          { type: 'object', valueObject: { medicamento: { type: 'string', content: '  ', confidence: 0.1 } } },
        ],
      },
    },
    'Receta R-77 Clavubay',
  );
  const P2 = pagina({ especie: { type: 'string', content: 'Perro', confidence: 0.92, boundingRegions: region }, lineas: { type: 'array', valueArray: [{ type: 'object', valueObject: { medicamento: { type: 'string', content: 'Otro', confidence: 0.9, boundingRegions: region } } }] } }, 'Perro Otro');

  function handlers(respuestas: unknown[]) {
    let analisis = 0;
    let url = '';
    let auth: string | null = null;
    return {
      get: () => ({ analisis, url, auth }),
      list: [
        http.post(`${DI}/documentintelligence/documentModels/:modelo`, ({ request }) => {
          url = request.url;
          auth = request.headers.get('authorization');
          const n = analisis++;
          return new HttpResponse(null, { status: 202, headers: { 'operation-location': `${DI}/ops/${n}` } });
        }),
        http.get(`${DI}/ops/:n`, ({ params }) => HttpResponse.json(respuestas[Number(params.n)] ?? { status: 'running' })),
      ],
    };
  }
  const extractor = () => new AzureRecipeExtractor(new DocumentIntelligenceClient({ endpoint: `${DI}/`, getToken, sleep: async () => {} }), 'recetas-v1');

  it('campos del modelo con confianza, región y tipos; varias páginas: el más fiable y líneas concatenadas', async () => {
    const h = handlers([P1, P2]);
    server.use(...h.list);
    const r = await extractor().extract({ pages: [new Uint8Array([1]), new Uint8Array([2])], mime: 'image/png' });
    expect(h.get().analisis).toBe(2);
    expect(h.get().auth).toBe('Bearer token-entra');
    expect(h.get().url).toContain('/documentModels/recetas-v1:analyze?api-version=2024-11-30');
    expect(r).toMatchObject({ proveedor: 'azure', promptVersion: ESQUEMA_CAMPOS_VERSION, modelo: 'docintel:recetas-v1 (api 2024-11-30)' });
    expect(r.receta.numero).toMatchObject({ valor: 'R-77', fuente: 'ocr', evidencia: { texto: 'R-77', pagina: 1, region: region[0]!.polygon } });
    expect(r.receta.numero?.confianza).toBeCloseTo(0.98);
    expect(r.receta.fechaEmision?.valor).toBe('2026-10-12');
    expect(r.receta.numAnimales?.valor).toBe(3);
    expect(r.receta.firmaDetectada?.valor).toBe(true);
    expect(r.receta.veterinarioNombre?.confianza).toBe(0.5);
    expect(r.receta.especie).toMatchObject({ valor: 'Perro', evidencia: { pagina: 2 } });
    expect(r.receta.rega).toMatchObject({ valor: null, evidencia: null });
    expect(r.lineas.map((l) => l.medicamento?.valor)).toEqual(['Clavubay', 'Otro']);
    expect(r.lineas[0]?.medicamento?.confianza).toBeCloseTo(0.7);
    expect(r.lineas[0]?.cantidadEnvases?.valor).toBe(1);
    expect(r.ocrTexto).toContain('Clavubay');
  });

  it('sin modelo entrenado (DOCINTEL_MODEL_ID=prebuilt-layout): pares clave-valor + reglas', async () => {
    const h = handlers([
      {
        status: 'succeeded',
        analyzeResult: {
          modelId: 'prebuilt-layout',
          content: 'Fármaco: PRUEBAVET 5 MG',
          pages: [{ pageNumber: 1, words: [] }],
          keyValuePairs: [{ key: { content: 'Fármaco:' }, value: { content: 'PRUEBAVET 5 MG', boundingRegions: region }, confidence: 0.95 }],
        },
      },
    ]);
    server.use(...h.list);
    const r = await new AzureRecipeExtractor(new DocumentIntelligenceClient({ endpoint: DI, getToken, sleep: async () => {} }), 'prebuilt-layout').extract({ pages: [new Uint8Array([1])], mime: 'image/png' });
    expect(h.get().url).toContain('prebuilt-layout:analyze');
    expect(h.get().url).toContain('features=keyValuePairs');
    expect(r).toMatchObject({ modelo: 'docintel:prebuilt-layout + reglas (api 2024-11-30)', promptVersion: 'layout-reglas.v1' });
    expect(r.lineas[0]?.medicamento?.valor).toBe('PRUEBAVET 5 MG');
    expect(r.receta.numero?.valor).toBeNull();
  });

  it('errores de Document Intelligence', async () => {
    server.use(...handlers([{ status: 'failed', error: { message: 'imagen ilegible' } }]).list);
    await expect(extractor().extract({ pages: [new Uint8Array([1])], mime: 'image/png' })).rejects.toThrow(/imagen ilegible/);
    server.resetHandlers();
    server.use(http.post(`${DI}/documentintelligence/documentModels/:modelo`, () => new HttpResponse(null, { status: 401 })));
    await expect(extractor().extract({ pages: [new Uint8Array([1])], mime: 'image/png' })).rejects.toThrow(/401/);
    server.resetHandlers();
    server.use(http.post(`${DI}/documentintelligence/documentModels/:modelo`, () => new HttpResponse(null, { status: 202 })));
    await expect(extractor().extract({ pages: [new Uint8Array([1])], mime: 'image/png' })).rejects.toThrow(/Operation-Location/);
    server.resetHandlers();
    server.use(...handlers([]).list);
    const lento = new AzureRecipeExtractor(new DocumentIntelligenceClient({ endpoint: DI, getToken, sleep: async () => {}, maxPolls: 2 }), 'm');
    await expect(lento.extract({ pages: [new Uint8Array([1])], mime: 'image/png' })).rejects.toThrow(/tiempo de espera/);
    // Límite por tiempo (F0 puede tardar más de un minuto por página) y 429 al consultar → se espera más.
    let t = 0;
    const esperas: number[] = [];
    server.resetHandlers();
    server.use(
      http.post(`${DI}/documentintelligence/documentModels/:modelo`, () => new HttpResponse(null, { status: 202, headers: { 'operation-location': `${DI}/ops/x`, 'retry-after': '2' } })),
      http.get(`${DI}/ops/x`, () => new HttpResponse(null, { status: 429 })),
    );
    const porTiempo = new AzureRecipeExtractor(
      new DocumentIntelligenceClient({ endpoint: DI, getToken, now: () => t, maxEsperaMs: 20_000, sleep: async (ms) => { esperas.push(ms); t += ms; } }),
      'm',
    );
    await expect(porTiempo.extract({ pages: [new Uint8Array([1])], mime: 'image/png' })).rejects.toThrow(/tiempo de espera/);
    expect(esperas.slice(0, 3)).toEqual([2000, 4000, 8000]);
  });
});

describe('fábrica de extractores', () => {
  const base = { DOCINTEL_API_VERSION: '2024-11-30', DOCINTEL_ENDPOINT: undefined, DOCINTEL_MODEL_ID: undefined };
  it('fake por defecto; azure sin configuración → desactivado con código estable', async () => {
    expect((await crearExtractor({ ...base, EXTRACTOR: 'fake' }, { fixturesDir: DIR, hoy })).proveedor).toBe('fake');
    const d = await crearExtractor({ ...base, EXTRACTOR: 'azure' }, { fixturesDir: DIR, hoy });
    expect(d).toBeInstanceOf(DisabledRecipeExtractor);
    await expect(d.extract({ pages: [], mime: 'image/png' })).rejects.toMatchObject({ code: 'EXTRACTOR_NO_CONFIGURADO' });
  });
  it('azure configurado', async () => {
    const a = await crearExtractor(
      { ...base, EXTRACTOR: 'azure', DOCINTEL_ENDPOINT: 'https://di', DOCINTEL_MODEL_ID: 'recetas-v1' },
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

describe('especie propuesta desde el texto', () => {
  it.each([
    ['CANINA', 14],
    ['Canino', 14],
    ['PERROS', 14],
    ['Felina', 15],
    ['gato', 15],
    ['Bovino', null],
    [null, null],
  ])('%s → %s', (t, id) => expect(especieId(t)).toBe(id));
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
    expect(costeEstimado(10)).toBeCloseTo(0.28);
  });
});

describe('prescripción excepcional en el texto de la receta', () => {
  it.each([
    ['Prescripción excepcional: :selected:', true],
    ['PRESCRIPCION EXCEPCIONAL: X', true],
    ['Prescripción excepcional: Sí', true],
    ['Uso excepcional (cascada) por falta de medicamento autorizado', true],
    // La etiqueta va impresa en muchos formularios: sin marca no cuenta.
    ['Prescripción Excepcional :\n% del envase: 100', false],
    ['PRESCRIPCION EXCEPCIONAL:\n0\nFORMULA MAGISTRAL:\n0', false],
    ['Prescripción excepcional: Si No Profiláctico: Si :unselected:', false],
    ['Prescripción excepcional: :unselected:', false],
    [null, false],
  ])('%s → %s', (t, esperado) => expect(esExcepcional(t)).toBe(esperado));
});

/** Milisegundos que tarda `f` (para comprobar que las expresiones tienen coste lineal con textos patológicos). */
const ms = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe('plazo con textos patológicos: coste lineal (CodeQL js/polynomial-redos)', () => {
  const n = 100_000;
  it.each([
    ['serie larga de dígitos', () => plazo('1'.repeat(n))],
    ['dígitos y espacios alternados', () => plazo('1 '.repeat(n / 2))],
  ])('%s: < 1 s con 100 000 caracteres', (_n, f) => expect(ms(f)).toBeLessThan(1000));

  it('toma la serie de dígitos completa', () => {
    expect(plazo('validez 123 días')).toEqual({ cantidad: 123, unidad: 'dias' });
    expect(plazo('6meses')).toEqual({ cantidad: 6, unidad: 'meses' });
  });
});
