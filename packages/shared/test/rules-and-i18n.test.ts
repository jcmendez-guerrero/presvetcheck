import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { CODIGOS_INCIDENCIA, CODIGOS_ERROR, catalogoDefectos, catalogoErrores, textoDefecto, normalizeText, formatFechaEs } from '../src';
import { loadRules, streamXmlRecords, xmlChildren, xmlText, xmlTexts } from '../src/node';

const ROOT = resolve(__dirname, '../../..');

describe('reglas en config/rules', () => {
  it('cargan, validan y producen una versión con hash', () => {
    const { bundle, files } = loadRules(resolve(ROOT, 'config/rules'));
    expect(files).toHaveLength(5);
    expect(bundle.version).toMatch(/^receta-campos\.v1@[0-9a-f]{8}\+validez\.v1@/);
    expect(bundle.validez.antimicrobiano).toEqual({ dias: 5 });
    expect(bundle.recetaCampos.campos.titular_telefono).toMatchObject({ compania: 'AVISO', produccion: 'BLOQUEANTE_FORMA' });
    expect(bundle.recetaCampos.incidencias.RECETA_YA_DISPENSADA).toBe('BLOQUEANTE_DURO');
    expect(bundle.precios.recargo_equivalencia['10']).toBe(1.4);
  });

  it('todas las incidencias tienen severidad por defecto o son de campo', () => {
    const { bundle } = loadRules(resolve(ROOT, 'config/rules'));
    const deCampo = new Set(Object.values(bundle.recetaCampos.campos).map((c) => c.codigo));
    for (const code of CODIGOS_INCIDENCIA) {
      expect(deCampo.has(code) || code in bundle.recetaCampos.incidencias, code).toBe(true);
    }
  });
});

describe('catálogo de textos', () => {
  it.each(CODIGOS_INCIDENCIA)('defecto %s tiene texto en español', (code) => {
    expect(catalogoDefectos[code]?.titulo).toBeTruthy();
  });
  it.each(CODIGOS_ERROR)('error %s tiene texto en español', (code) => {
    expect(catalogoErrores[code]).toBeTruthy();
  });
  it('interpola parámetros', () => {
    expect(textoDefecto('RECETA_CADUCADA', { fecha: '12/10/2026' }).titulo).toBe('La receta caducó el 12/10/2026');
    expect(textoDefecto('ENVASE_CADUCADO', {}).titulo).toContain('{fecha}');
  });
});

describe('utilidades de texto', () => {
  it('normaliza acentos y mayúsculas', () => {
    expect(normalizeText('  AMOXICILINA  Ácido   Clavulánico ')).toBe('amoxicilina acido clavulanico');
    expect(formatFechaEs('2026-10-14')).toBe('14/10/2026');
  });
});

describe('streamXmlRecords', () => {
  it('lee el diccionario de especies real en streaming', async () => {
    const out = [];
    for await (const r of streamXmlRecords(resolve(ROOT, 'fixtures/nomenclator/DICCIONARIO_ESPECIES_DESTINO.xml'), 'especiesdestino', { highWaterMark: 512 })) {
      out.push(r);
    }
    expect(out.length).toBe(371);
    expect(xmlText(out[0]!, 'cod_espdes')).toBe('1');
    expect(xmlText(out[0]!, 'des_espdes')).toBe('Bovino');
  });

  it('lee registros anidados y repetidos de la muestra del Nomenclátor', async () => {
    const it = streamXmlRecords(resolve(ROOT, 'fixtures/nomenclator/PrescripcionVET.sample.xml'), 'prescription');
    const first = (await it.next()).value!;
    expect(xmlText(first, 'cod_nacion')).toBe('570004');
    const forma = xmlChildren(first, 'formafarmaceutica')[0]!;
    expect(xmlText(forma, 'cod_forma_farmaceutica')).toBe('95');
    expect(xmlChildren(first, 'especiesdestino').map((e) => xmlText(e, 'cod_espdes'))).toContain('14');
    expect(xmlTexts(first, 'no_existe')).toEqual([]);
    expect(xmlText(first, 'no_existe')).toBeNull();
    expect(xmlChildren(first, 'no_existe')).toEqual([]);
  });
});
