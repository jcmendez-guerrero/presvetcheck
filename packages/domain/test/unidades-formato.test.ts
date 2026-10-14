import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { concentracion, contenidoEnvase, parseCantidadTexto, parseDecimal, textoConcentracion, totalPaEnvase, unidadCanonica } from '../src/unidades';
import { evaluarAlternativaFormato, notaAdministracion, validarEnvasesFormato } from '../src/formato';
import { evaluarEquivalencia, tiemposEsperaCompatibles, viaCompatible } from '../src/equivalencia';
import { compararIndicacion, similitudIndicacion, tokensIndicacion } from '../src/indicacion';
import { autorizadoParaEspecie, especiesEquivalentes } from '../src/medicamento';
import { ESPECIE, RULES, amoxicilina, med, pres } from './builders';

const comp = (porCantidad: string | null, porUnidad: string | null) => ({ pas: [], porCantidad, porUnidad });

describe('normalización de cantidades', () => {
  it.each`
    unidad          | factor     | canon
    ${'g'}          | ${1000}    | ${'mg'}
    ${'mg'}         | ${1}       | ${'mg'}
    ${'µg'}         | ${0.001}   | ${'mg'}
    ${'μg'}         | ${0.001}   | ${'mg'}
    ${'mcg'}        | ${0.001}   | ${'mg'}
    ${'Kg'}         | ${1000000} | ${'mg'}
    ${'l'}          | ${1000}    | ${'ml'}
    ${'ml'}         | ${1}       | ${'ml'}
    ${'UI'}         | ${1}       | ${'UI'}
    ${'%'}          | ${1}       | ${'%'}
    ${'cm2'}        | ${1}       | ${'cm2'}
    ${'Comprimido'} | ${1}       | ${'unidad'}
    ${'Cápsula'}    | ${1}       | ${'unidad'}
    ${'Pipeta'}     | ${1}       | ${'unidad'}
  `('$unidad → $factor $canon', ({ unidad, factor, canon }) => {
    const u = unidadCanonica(unidad);
    expect(u?.unidad).toBe(canon);
    expect(u?.factor.toNumber()).toBe(factor);
  });
  it('unidades desconocidas no son normalizables', () => {
    expect(unidadCanonica('Generador')).toBeNull();
    expect(unidadCanonica(null)).toBeNull();
  });
  it('parsea decimales y cantidades con coma', () => {
    expect(parseDecimal('2,5')?.toNumber()).toBe(2.5);
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseCantidadTexto('0,5 g')).toEqual({ valor: new Decimal('0.5'), unidad: 'g' });
    expect(parseCantidadTexto('mucho')).toBeNull();
    expect(parseCantidadTexto(null)).toBeNull();
  });
  it('concentraciones', () => {
    const pa = (cantidad: string | null, unidad: string | null) => ({ paId: 1, nombre: 'X', cantidad, unidad });
    expect(concentracion(pa('500', 'mg'), comp('1', 'Comprimido'))).toEqual({ valor: new Decimal(500), num: 'mg', den: 'unidad' });
    expect(concentracion(pa('20', 'mg'), comp('1', 'g'))?.valor.toNumber()).toBe(0.02);
    expect(concentracion(pa('100', 'mg/ml'), comp(null, null))).toEqual({ valor: new Decimal(100), num: 'mg', den: 'ml' });
    expect(concentracion(pa('500', 'mg/5 ml'), comp(null, null))?.valor.toNumber()).toBe(100);
    expect(concentracion(pa('2,5', '%'), comp('1', 'g'))).toEqual({ valor: new Decimal(2.5), num: '%', den: '%' });
    expect(concentracion(pa(null, 'mg'), comp('1', 'g'))).toBeNull();
    expect(concentracion(pa('1', 'raro'), comp('1', 'g'))).toBeNull();
    expect(concentracion(pa('1', 'mg'), comp('0', 'g'))).toBeNull();
    expect(concentracion(pa('1', 'mg'), comp('1', 'Generador'))).toBeNull();
  });
  it('contenido y total de principio activo por envase', () => {
    const c = contenidoEnvase({ contenido: '1', unidadContenido: 'l' });
    expect(c).toEqual({ valor: new Decimal(1000), unidad: 'ml' });
    expect(contenidoEnvase({ contenido: null, unidadContenido: 'ml' })).toBeNull();
    expect(totalPaEnvase({ valor: new Decimal(100), num: 'mg', den: 'ml' }, c)?.toNumber()).toBe(100000);
    expect(totalPaEnvase({ valor: new Decimal(100), num: 'mg', den: 'unidad' }, c)).toBeNull();
    expect(totalPaEnvase(null, c)).toBeNull();
    expect(textoConcentracion({ valor: new Decimal(250), num: 'mg', den: 'unidad' })).toBe('250 mg');
  });
});

describe('regla de formato (§4.3.1) en detalle', () => {
  const ctx = { especieId: ESPECIE.PERROS, especieProduccion: false, clase: 'ordinaria' as const, indicacion: 'x', viaPrescritaId: null, duracionDias: null };
  const P = { medicamento: amoxicilina(500), presentacion: pres({ cn: '570016', nregistro: '1000 ESP' }), envases: 1 };
  const c250 = { medicamento: amoxicilina(250), presentacion: pres({ cn: '570250', nregistro: '10250 ESP' }) };

  it('3 envases de 250 mg × 10 → CANTIDAD_SUPERIOR; 2 → válido', () => {
    const r = evaluarAlternativaFormato(P, c250, ctx, RULES.equivalencia);
    expect(validarEnvasesFormato(r, 3)).toBe('CANTIDAD_SUPERIOR');
    expect(validarEnvasesFormato(r, 2)).toBeNull();
    expect(validarEnvasesFormato(r, 1)).toBeNull();
  });

  it('1 envase de 250 mg × 10 también es válido (2.500 mg ≤ 5.000 mg)', () => {
    const r = evaluarAlternativaFormato(P, c250, ctx, RULES.equivalencia);
    expect(r.valido).toBe(true);
    expect(r.factorDosis?.toNumber()).toBe(2);
  });

  it.each`
    descripcion          | cambio                                                                                                                            | motivo
    ${'otra forma'}      | ${{ formaId: 99 }}                                                                                                                | ${'FORMA_DISTINTA'}
    ${'otra vía'}        | ${{ viaIds: [1] }}                                                                                                                | ${'VIA_NO_AUTORIZADA'}
    ${'otra especie'}    | ${{ especieIds: [ESPECIE.BOVINO] }}                                                                                               | ${'ESPECIE_NO_AUTORIZADA'}
    ${'no autorizado'}   | ${{ estado: 'revocado' }}                                                                                                         | ${'NO_AUTORIZADO'}
    ${'otro PA'}         | ${{ composicion: { pas: [{ paId: 2, nombre: 'Y', cantidad: '1', unidad: 'mg' }], porCantidad: '1', porUnidad: 'Comprimido' } }} | ${'COMPOSICION_DISTINTA'}
    ${'no normalizable'} | ${{ composicion: { pas: [{ paId: 161, nombre: 'A', cantidad: '250', unidad: 'mg' }], porCantidad: '1', porUnidad: '¿?' } }}      | ${'CANTIDAD_NO_NORMALIZABLE'}
  `('descarta por $descripcion', ({ cambio, motivo }) => {
    const r = evaluarAlternativaFormato(P, { ...c250, medicamento: amoxicilina(250, cambio) }, ctx, RULES.equivalencia);
    expect(r.valido).toBe(false);
    expect(r.motivos).toContain(motivo);
  });

  it('proporción distinta entre principios activos → descartado', () => {
    const asoc = (a: string, b: string) =>
      med({ nregistro: `X${a}${b}`, composicion: { pas: [{ paId: 161, nombre: 'AMOX', cantidad: a, unidad: 'mg' }, { paId: 5419, nombre: 'CLAV', cantidad: b, unidad: 'mg' }], porCantidad: '1', porUnidad: 'Comprimido' } });
    const Pa = { medicamento: asoc('400', '100'), presentacion: pres({ cn: '1', nregistro: 'X400100' }), envases: 1 };
    const prop = evaluarAlternativaFormato(Pa, { medicamento: asoc('200', '100'), presentacion: pres({ cn: '2', nregistro: 'X200100' }) }, ctx, RULES.equivalencia);
    expect(prop.motivos).toEqual(['PROPORCION_DISTINTA']);
    const ok = evaluarAlternativaFormato(Pa, { medicamento: asoc('200', '50'), presentacion: pres({ cn: '3', nregistro: 'X20050' }) }, ctx, RULES.equivalencia);
    expect(ok.valido).toBe(true);
  });

  it('presentación sin contenido conocido → no normalizable', () => {
    const r = evaluarAlternativaFormato(P, { ...c250, presentacion: pres({ cn: '570250', nregistro: '10250 ESP', contenido: null }) }, ctx, RULES.equivalencia);
    expect(r.motivos).toEqual(['CANTIDAD_NO_NORMALIZABLE']);
    expect(validarEnvasesFormato(r, 1)).toBe('CANTIDAD_NO_NORMALIZABLE');
  });

  it('nota de administración para formas líquidas (volumen equivalente)', () => {
    const liq = (mgml: string) =>
      med({ nregistro: `L${mgml}`, formaId: 5, composicion: { pas: [{ paId: 161, nombre: 'A', cantidad: mgml, unidad: 'mg' }], porCantidad: '1', porUnidad: 'ml' } });
    const Pl = { medicamento: liq('100'), presentacion: pres({ cn: '1', nregistro: 'L100', contenido: '100', unidadContenido: 'ml' }), envases: 1 };
    const r = evaluarAlternativaFormato(Pl, { medicamento: liq('40'), presentacion: pres({ cn: '2', nregistro: 'L40', contenido: '100', unidadContenido: 'ml' }) }, ctx, RULES.equivalencia);
    expect(r.valido).toBe(true);
    expect(r.avisos).toEqual(['CAMBIO_CONCENTRACION']);
    expect(notaAdministracion(r)).toBe('Este envase es de 40 mg/ml: administre 2,5 ml por cada ml de 100 mg/ml indicada por su veterinario');
    expect(notaAdministracion({ ...r, tipo: 'CAMBIO_FORMATO' })).toBeNull();
  });

  it('misma presentación', () => {
    expect(evaluarAlternativaFormato(P, { medicamento: P.medicamento, presentacion: P.presentacion }, ctx, RULES.equivalencia).tipo).toBe('MISMA_PRESENTACION');
  });
});

describe('equivalencia: detalles', () => {
  const ctx = { especieId: ESPECIE.PERROS, especieProduccion: false, clase: 'ordinaria' as const, indicacion: 'infecciones de la piel', viaPrescritaId: 54, duracionDias: null };
  it('vía prescrita explícita', () => {
    expect(viaCompatible(med(), med({ viaIds: [54, 1] }), 54)).toBe(true);
    expect(viaCompatible(med(), med({ viaIds: [1] }), 54)).toBe(false);
    expect(viaCompatible(med({ viaIds: [] }), med(), null)).toBe(false);
  });
  it('tiempos de espera: desconocido, no aplica, sin días', () => {
    const te = (dias: number | null, noAplica = false, tejido = 'Carne') => [{ especieId: ESPECIE.BOVINO, tejido, dias, noAplica }];
    expect(tiemposEsperaCompatibles(med({ tiemposEspera: [] }), med(), [ESPECIE.BOVINO])).toBe('TIEMPO_ESPERA_DESCONOCIDO');
    expect(tiemposEsperaCompatibles(med({ tiemposEspera: te(5, true) }), med(), [ESPECIE.BOVINO])).toBeNull();
    expect(tiemposEsperaCompatibles(med({ tiemposEspera: te(5) }), med({ tiemposEspera: te(5, true) }), [ESPECIE.BOVINO])).toBeNull();
    expect(tiemposEsperaCompatibles(med({ tiemposEspera: te(5) }), med({ tiemposEspera: te(null) }), [ESPECIE.BOVINO])).toBe('TIEMPO_ESPERA_DESCONOCIDO');
    expect(tiemposEsperaCompatibles(med({ tiemposEspera: te(5) }), med({ tiemposEspera: te(3, false, 'Leche') }), [ESPECIE.BOVINO])).toBe('TIEMPO_ESPERA_DESCONOCIDO');
    expect(tiemposEsperaCompatibles(med({ tiemposEspera: te(5) }), med({ tiemposEspera: te(3) }), [ESPECIE.BOVINO])).toBeNull();
  });
  it('prescrito sin forma → forma distinta', () => {
    expect(evaluarEquivalencia(med({ formaId: null }), med(), ctx, RULES.equivalencia).motivos).toContain('FORMA_DISTINTA');
  });
  it('especie: subcategoría y especies equivalentes', () => {
    expect(autorizadoParaEspecie(med(), null, RULES.equivalencia.especie_padre)).toBe(false);
    expect(autorizadoParaEspecie(med({ especieIds: [326] }), ESPECIE.PERROS, RULES.equivalencia.especie_padre)).toBe(false);
    expect(especiesEquivalentes(326, RULES.equivalencia.especie_padre)).toEqual([326, 14]);
    expect(especiesEquivalentes(null, RULES.equivalencia.especie_padre)).toEqual([]);
  });
});

describe('indicación', () => {
  const R = RULES.equivalencia.indicacion;
  it('sinónimos y palabras vacías', () => {
    expect([...tokensIndicacion('Infecciones del tracto urinario', R)]).toEqual(['cistitis']);
    expect(similitudIndicacion('Cistitis', 'Infecciones del tracto urinario causadas por E. coli', R)).toBe(1);
    expect(similitudIndicacion('de la', 'x', R)).toBe(0);
  });
  it('resultado COINCIDE / PROBABLE / NO_COINCIDE', () => {
    expect(compararIndicacion('otitis externa', ['Otitis externa bacteriana'], R).resultado).toBe('COINCIDE');
    expect(compararIndicacion('piel y otitis externa', ['Infecciones de piel'], R).resultado).toBe('PROBABLE');
    expect(compararIndicacion('mastitis', ['piel'], R).resultado).toBe('NO_COINCIDE');
    expect(compararIndicacion(null, ['piel'], R).resultado).toBe('NO_COINCIDE');
    expect(compararIndicacion('piel', [], R).mejor).toBeNull();
  });
});
