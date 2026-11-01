import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECCIONES_AYUDA } from '@mmx/shared';
import { IndiceFuentes, MAX_FRAGMENTO, seccionesGuia } from '../src/fuentes/indice';

const GUIA = readFileSync(resolve(__dirname, '../../../docs/ref/guia-receta-veterinaria.md'), 'utf8');

describe('seccionesGuia', () => {
  const secciones = seccionesGuia(GUIA);
  const nums = secciones.map((s) => s.num);

  it('separa la guía por sus encabezados numerados y descarta el índice', () => {
    expect(nums.length).toBeGreaterThan(40);
    expect(nums[0]).toBe('1');
    expect(nums).toEqual(expect.arrayContaining(['4.2.4', '4.4', '5.3', '5.5', '5.6']));
    expect(secciones.every((s) => !/\.{4,}/.test(s.texto.slice(0, 200)))).toBe(true);
  });

  it('une el título partido en dos líneas y la sílaba partida por guion', () => {
    const s53 = secciones.find((s) => s.num === '5.3');
    expect(s53?.titulo).toBe('Dispensación de medicamentos veterinarios psicótropos');
    expect(s53?.texto).toMatch(/sólo se podrá dispensar un envase por receta/);
    expect(secciones.find((s) => s.num === '4.2.1')?.texto).not.toMatch(/pres-\ncripción/);
  });

  it('un texto sin encabezados no produce secciones', () => {
    expect(seccionesGuia('Solo un párrafo sin ningún encabezado numerado.')).toEqual([]);
  });
});

describe('IndiceFuentes', () => {
  const idx = new IndiceFuentes(GUIA);

  it('trocea en fragmentos que caben en una respuesta de herramienta', () => {
    expect(idx.total).toBeGreaterThan(80);
    for (const q of ['psicótropo', 'sustitución', 'validez']) {
      for (const r of idx.buscar(q, 'guia', 5)) expect(r.texto.length).toBeLessThanOrEqual(MAX_FRAGMENTO + 200);
    }
  });

  it.each([
    ['psicótropos un envase por receta', 'guia', 'guia:5.3'],
    ['sustituir un medicamento', 'guia', 'guia:5.5#1'],
    ['dispensación ante prescripción excepcional', 'guia', 'guia:5.6#1'],
    ['cómo hago una sustitución', 'ayuda', 'ayuda:sustitucion'],
  ] as const)('«%s» (%s) devuelve %s entre los 3 primeros', (consulta, tipo, esperado) => {
    const ids = idx.buscar(consulta, tipo, 3).map((r) => r.fuenteId.replace(/#\d+$/, ''));
    expect(ids).toContain(esperado.replace(/#\d+$/, ''));
  });

  it('los sinónimos encuentran lo mismo: «antibiótico» ≈ «antimicrobiano»', () => {
    const a = idx.buscar('antibiótico', 'guia', 3).map((r) => r.fuenteId);
    const b = idx.buscar('antimicrobiano', 'guia', 3).map((r) => r.fuenteId);
    expect(a.length).toBeGreaterThan(0);
    expect(a[0]).toBe(b[0]);
  });

  it('una consulta sin coincidencias o solo con palabras vacías devuelve una lista vacía', () => {
    expect(idx.buscar('zzzqqq xxxwww', 'guia')).toEqual([]);
    expect(idx.buscar('que de la el', 'guia')).toEqual([]);
  });

  it('la Ayuda se indexa por secciones y se puede abrir lo citado', () => {
    const r = idx.buscar('albarán recepción mercancía', 'ayuda', 2)[0];
    expect(r?.fuenteId).toMatch(/^ayuda:/);
    const abierta = idx.abrir(r!.fuenteId);
    expect(abierta?.contenido).toBe(r!.texto);
    expect(abierta?.fuente.version).toBe(r!.version);
    expect(idx.abrir('guia:no-existe')).toBeNull();
  });

  it('la versión cambia si cambia el texto de la guía o de la Ayuda', () => {
    expect(new IndiceFuentes(GUIA).version()).toBe(idx.version());
    expect(new IndiceFuentes(GUIA + '\n4.9. Nueva sección\nTexto añadido de prueba para cambiar la versión.').version()).not.toBe(idx.version());
    const ayuda2 = SECCIONES_AYUDA.map((s, i) => (i === 0 ? { ...s, titulo: s.titulo + ' (cambiada)' } : s));
    expect(new IndiceFuentes(GUIA, ayuda2).version()).not.toBe(idx.version());
  });

  it('funciona sin guía (solo Ayuda)', () => {
    const solo = new IndiceFuentes(null);
    expect(solo.buscar('sustitución', 'guia')).toEqual([]);
    expect(solo.buscar('sustitución', 'ayuda').length).toBeGreaterThan(0);
  });
});
