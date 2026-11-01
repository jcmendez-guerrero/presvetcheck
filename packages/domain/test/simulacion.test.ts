import { describe, expect, it } from 'vitest';
import {
  lineaValidezDe,
  simularCambioFormato,
  simularEquivalencia,
  simularSustituibilidad,
  simularValidez,
  type EntradaSimularFormato,
  type EntradaSimularValidez,
  type LineaSimuladaValidez,
} from '../src/simulacion';
import { CLOCK, ESPECIE, RULES, amoxicilina, med, pres } from './builders';

const linea = (o: Partial<LineaSimuladaValidez> = {}): LineaSimuladaValidez => ({
  antimicrobiano: false,
  psicotropo: false,
  estupefaciente: false,
  resuelta: true,
  excluidaAmpliada: false,
  ...o,
});
const entrada = (o: Partial<EntradaSimularValidez> = {}): EntradaSimularValidez => ({
  fechaEmision: '2026-10-03',
  tipoTratamiento: null,
  especieProduccion: false,
  lineas: [linea()],
  plazoDeclarado: null,
  fechaConsulta: null,
  rules: RULES,
  clock: CLOCK,
  ...o,
});

describe('simularValidez (casos de SPEC §12.2 y §4.1.3)', () => {
  it.each`
    caso                                   | o                                                                                   | decision          | efectiva
    ${'general, 1 mes'}                    | ${{ fechaEmision: '2026-10-12' }}                                                   | ${'VALIDA_HASTA'} | ${'2026-11-12'}
    ${'fin de mes: 31/01 + 1 mes'}         | ${{ fechaEmision: '2026-01-31' }}                                                   | ${'CADUCADA'}     | ${'2026-02-28'}
    ${'antimicrobiano, 5 días (3 oct)'}    | ${{ lineas: [linea({ antimicrobiano: true })] }}                                    | ${'CADUCADA'}     | ${'2026-10-08'}
    ${'antimicrobiano, aún válida'}        | ${{ lineas: [linea({ antimicrobiano: true })], fechaConsulta: '2026-10-08' }}       | ${'VALIDA_HASTA'} | ${'2026-10-08'}
    ${'crónico no productora, 3 meses'}    | ${{ tipoTratamiento: 'cronico' }}                                                   | ${'VALIDA_HASTA'} | ${'2027-01-03'}
    ${'preventivo no productora, 6 meses'} | ${{ tipoTratamiento: 'preventivo' }}                                                | ${'VALIDA_HASTA'} | ${'2027-04-03'}
    ${'crónico en producción → 1 mes'}     | ${{ tipoTratamiento: 'cronico', especieProduccion: true }}                          | ${'VALIDA_HASTA'} | ${'2026-11-03'}
    ${'crónico sin identificar → 1 mes'}   | ${{ tipoTratamiento: 'cronico', lineas: [linea({ resuelta: false })] }}             | ${'VALIDA_HASTA'} | ${'2026-11-03'}
    ${'psicótropo crónico → 1 mes'}        | ${{ tipoTratamiento: 'cronico', lineas: [linea({ psicotropo: true })] }}            | ${'VALIDA_HASTA'} | ${'2026-11-03'}
    ${'estupefaciente, 10 días'}           | ${{ lineas: [linea({ estupefaciente: true })] }}                                    | ${'CADUCADA'}     | ${'2026-10-13'}
    ${'la línea más restrictiva manda'}    | ${{ lineas: [linea(), linea({ antimicrobiano: true })] }}                           | ${'CADUCADA'}     | ${'2026-10-08'}
    ${'plazo declarado menor'}             | ${{ fechaEmision: '2026-10-12', plazoDeclarado: { cantidad: 10, unidad: 'dias' } }} | ${'VALIDA_HASTA'} | ${'2026-10-22'}
  `('$caso', ({ o, decision, efectiva }) => {
    const r = simularValidez(entrada(o));
    expect(r.decision).toBe(decision);
    expect(r.evidencias['validezEfectiva']).toBe(efectiva);
    expect(r.reglaVersion).toBe(RULES.version);
  });

  it('el plazo declarado superior al máximo legal avisa y aplica el máximo', () => {
    const r = simularValidez(
      entrada({ fechaEmision: '2026-10-12', plazoDeclarado: { cantidad: 6, unidad: 'meses' } }),
    );
    expect(r.evidencias['validezEfectiva']).toBe('2026-11-12');
    expect(r.motivos.map((m) => m.code)).toContain('PLAZO_DECLARADO_SUPERIOR');
  });

  it('una receta caducada lo explica con la fecha', () => {
    const r = simularValidez(entrada({ lineas: [linea({ antimicrobiano: true })] }));
    const m = r.motivos.find((x) => x.code === 'RECETA_CADUCADA');
    expect(m?.mensaje).toMatch(/2026-10-08|08\/10\/2026|caduc/i);
  });

  it('sin medicamento identificado lo advierte', () => {
    expect(simularValidez(entrada({ lineas: [] })).motivos.map((m) => m.code)).toContain(
      'MEDICAMENTO_SIN_IDENTIFICAR',
    );
  });

  it.each([
    ['sin fecha de emisión', { fechaEmision: null }, ['fecha de emisión']],
    [
      'crónico sin saber si es de producción',
      { tipoTratamiento: 'cronico' as const, especieProduccion: null },
      ['producción'],
    ],
  ])('FALTAN_DATOS: %s', (_n, o, trozo) => {
    const r = simularValidez(entrada(o));
    expect(r.decision).toBe('FALTAN_DATOS');
    expect(r.faltan?.join(' ')).toContain(trozo[0]);
    expect(r.evidencias).toEqual({});
  });

  it('lineaValidezDe usa CIMAVet y la lista de ATC excluidos', () => {
    expect(lineaValidezDe(med({ antibiotico: true }), RULES)).toMatchObject({
      antimicrobiano: true,
      resuelta: true,
    });
    expect(lineaValidezDe(med({ antibiotico: false, atc: ['QN01AB'] }), RULES)).toMatchObject({
      antimicrobiano: false,
    });
  });

  it('es determinista (mismo resultado dos veces)', () => {
    expect(simularValidez(entrada())).toEqual(simularValidez(entrada()));
  });
});

describe('simularSustituibilidad (SPEC §4.4.1)', () => {
  it.each`
    caso                          | m                         | clase            | decision          | codigo
    ${'ordinaria, sin exclusión'} | ${{}}                     | ${'ordinaria'}   | ${'PERMITIDA'}    | ${null}
    ${'excepcional'}              | ${{}}                     | ${'excepcional'} | ${'NO_PERMITIDA'} | ${'SUSTITUCION_PROHIBIDA_EXCEPCIONAL'}
    ${'clase no indicada'}        | ${{}}                     | ${null}          | ${'NO_PERMITIDA'} | ${'SUSTITUCION_PROHIBIDA_CLASE_NO_INDICADA'}
    ${'inmunológico (vacuna)'}    | ${{ inmunologico: true }} | ${'ordinaria'}   | ${'NO_PERMITIDA'} | ${'SUSTITUCION_PROHIBIDA_INMUNOLOGICO'}
    ${'biológico'}                | ${{ biologico: true }}    | ${'ordinaria'}   | ${'NO_PERMITIDA'} | ${'SUSTITUCION_PROHIBIDA_BIOLOGICO'}
  `('$caso', ({ m, clase, decision, codigo }) => {
    const r = simularSustituibilidad({ prescrito: med(m), clasePrescripcion: clase, rules: RULES });
    expect(r.decision).toBe(decision);
    if (codigo) expect(r.motivos.map((x) => x.code)).toContain(codigo);
    else expect(r.motivos).toEqual([]);
    expect(r.reglaVersion).toBe(RULES.version);
  });

  it('una exclusión de la lista del garante impide sustituir', () => {
    const rules = {
      ...RULES,
      exclusiones: {
        ...RULES.exclusiones,
        exclusiones: [{ nregistro: '1000 ESP', pa_id: null, motivo: 'prueba', fuente: 'prueba' }],
      },
    };
    const r = simularSustituibilidad({ prescrito: med(), clasePrescripcion: 'ordinaria', rules });
    expect(r.decision).toBe('NO_PERMITIDA');
    expect(r.motivos.map((x) => x.code)).toContain('SUSTITUCION_PROHIBIDA_EXCLUSION');
  });
});

describe('simularCambioFormato (SPEC §4.3.1, D-09)', () => {
  const contexto = {
    especieId: ESPECIE.PERROS,
    especieProduccion: false,
    clase: 'ordinaria' as const,
    indicacion: 'x',
    viaPrescritaId: null,
    duracionDias: null,
  };
  const prescrito = {
    medicamento: amoxicilina(500),
    presentacion: pres({ cn: '570016', nregistro: '1000 ESP' }),
    envases: 1,
  };
  const entrada = (mg: number, o: Partial<EntradaSimularFormato> = {}): EntradaSimularFormato => ({
    prescrito,
    candidato: {
      medicamento: amoxicilina(mg),
      presentacion: pres({ cn: `57${mg}`, nregistro: `10${mg} ESP` }),
    },
    envasesCandidato: null,
    contexto,
    permitirCambioFormato: true,
    rules: RULES,
    ...o,
  });

  it('500 mg × 10 → 250 mg × 10: es válido, con nota de administración (2 comprimidos por toma)', () => {
    const r = simularCambioFormato(entrada(250));
    expect(r.decision).toBe('ALTERNATIVA_VALIDA');
    expect(r.evidencias['totalPrescrito']).toBe('5000');
    expect(r.evidencias['totalPorEnvase']).toBe('2500');
    expect(r.evidencias['envasesPropuestos']).toBe(2);
    expect(r.evidencias['notaAdministracion']).toMatch(/2 comprimidos/);
  });

  it.each([
    ['2 cajas de 250 mg → 5.000 mg: válido', 250, 2, 'ALTERNATIVA_VALIDA', null],
    ['3 cajas de 250 mg → 7.500 mg: cantidad superior', 250, 3, 'ALTERNATIVA_NO_VALIDA', 'CANTIDAD_SUPERIOR'],
    ['1 caja de 250 mg → 2.500 mg: válido', 250, 1, 'ALTERNATIVA_VALIDA', null],
    [
      '1 caja de 1.000 mg: concentración superior',
      1000,
      1,
      'ALTERNATIVA_NO_VALIDA',
      'CONCENTRACION_SUPERIOR',
    ],
  ])('%s', (_n, mg, envases, decision, motivo) => {
    const r = simularCambioFormato(entrada(mg, { envasesCandidato: envases }));
    expect(r.decision).toBe(decision);
    if (motivo) expect(r.motivos.map((m) => m.code)).toContain(motivo);
  });

  it('con ALLOW_PACK_SIZE_CHANGE=false no se admite otra presentación', () => {
    const r = simularCambioFormato(entrada(250, { permitirCambioFormato: false }));
    expect(r.decision).toBe('ALTERNATIVA_NO_VALIDA');
    expect(r.motivos.map((m) => m.code)).toContain('CAMBIO_FORMATO_DESACTIVADO');
  });

  it('otro principio activo: no es válido', () => {
    const r = simularCambioFormato(
      entrada(250, {
        candidato: {
          medicamento: med({
            nregistro: 'X',
            composicion: {
              pas: [{ paId: 2, nombre: 'Y', cantidad: '250', unidad: 'mg' }],
              porCantidad: '1',
              porUnidad: 'Comprimido',
            },
          }),
          presentacion: pres({ cn: '9', nregistro: 'X' }),
        },
      }),
    );
    expect(r.decision).toBe('ALTERNATIVA_NO_VALIDA');
    expect(r.motivos.map((m) => m.code)).toContain('COMPOSICION_DISTINTA');
  });

  it('cantidades no normalizables: no se propone sola', () => {
    const r = simularCambioFormato(
      entrada(250, {
        candidato: {
          medicamento: amoxicilina(250, {
            composicion: {
              pas: [{ paId: 161, nombre: 'A', cantidad: '250', unidad: 'mg' }],
              porCantidad: '1',
              porUnidad: '¿?',
            },
          }),
          presentacion: pres({ cn: '570250', nregistro: '10250 ESP' }),
        },
      }),
    );
    expect(r.decision).toBe('ALTERNATIVA_NO_VALIDA');
    expect(r.motivos.map((m) => m.code)).toContain('CANTIDAD_NO_NORMALIZABLE');
  });

  it('la dosis que no se alcanza con comprimidos enteros avisa (500 → 200)', () => {
    const r = simularCambioFormato(entrada(200, { envasesCandidato: 2 }));
    expect(r.motivos.map((m) => m.code)).toContain('DOSIS_NO_AJUSTABLE');
  });
});

describe('simularEquivalencia (SPEC §4.4.2)', () => {
  const contexto = {
    especieId: ESPECIE.PERROS,
    especieProduccion: false,
    clase: 'ordinaria' as const,
    indicacion: 'Infecciones de la piel causadas por bacterias sensibles a la amoxicilina',
    viaPrescritaId: null,
    duracionDias: null,
  };

  it('mismo principio activo, concentración, forma, vía y especie → equivalente', () => {
    const r = simularEquivalencia({
      prescrito: amoxicilina(500),
      candidato: amoxicilina(500, { nregistro: '9999 TEST', labtitular: 'OTRO LAB' }),
      contexto,
      rules: RULES,
    });
    expect(r.decision).toBe('EQUIVALENTE');
    expect(r.reglaVersion).toBe(RULES.version);
  });

  it.each([
    [
      'otra concentración',
      amoxicilina(250, { nregistro: '9999 TEST' }),
      'COMPOSICION_DISTINTA|CONCENTRACION_DISTINTA|CONCENTRACION_OTRO_MEDICAMENTO',
    ],
    ['otra forma', amoxicilina(500, { nregistro: '9999 TEST', formaId: 99 }), 'FORMA_DISTINTA'],
    [
      'otra especie',
      amoxicilina(500, { nregistro: '9999 TEST', especieIds: [ESPECIE.BOVINO] }),
      'ESPECIE_NO_AUTORIZADA',
    ],
    ['no autorizado', amoxicilina(500, { nregistro: '9999 TEST', estado: 'revocado' }), 'NO_AUTORIZADO'],
    ['uso humano', amoxicilina(500, { nregistro: '9999 TEST', usoHumano: true }), 'USO_HUMANO'],
  ])('no equivalente por %s', (_n, candidato, motivo) => {
    const r = simularEquivalencia({ prescrito: amoxicilina(500), candidato, contexto, rules: RULES });
    expect(r.decision).toBe('NO_EQUIVALENTE');
    expect(r.motivos.map((m) => m.code).some((c) => motivo.split('|').includes(c))).toBe(true);
    expect(r.motivos.every((m) => m.mensaje && m.mensaje !== m.code)).toBe(true);
  });

  it('una indicación que el candidato no tiene autorizada → no equivalente por indicación', () => {
    const r = simularEquivalencia({
      prescrito: amoxicilina(500),
      candidato: amoxicilina(500, {
        nregistro: '9999 TEST',
        indicaciones: [{ especieId: null, texto: 'Alivio del dolor postoperatorio' }],
      }),
      contexto,
      rules: RULES,
    });
    expect(r.decision).toBe('NO_EQUIVALENTE');
    expect(r.motivos.map((m) => m.code)).toContain('INDICACION_NO_COINCIDE');
  });
});
