import { describe, expect, it } from 'vitest';
import type { RecetaConfirmada } from '@mmx/shared';
import { fixedClock } from '../src/clock';
import { evaluarReceta, fechaReferenciaValidez, type EntradaEvaluacion } from '../src/evaluacion';
import type { MedicamentoInfo, PresentacionInfo } from '../src/tipos';
import { CLOCK, ESPECIE, RULES, med, medNoAntibiotico, politica, pres, receta } from './builders';

function evaluar(
  r: RecetaConfirmada,
  o: Partial<EntradaEvaluacion> & { m?: MedicamentoInfo | null; p?: PresentacionInfo | null } = {},
) {
  const m = o.m === undefined ? med() : o.m;
  const p = o.p === undefined ? pres({ cn: '570016', nregistro: '1000 ESP' }) : o.p;
  return evaluarReceta({
    receta: r,
    lineas: r.lineas.map((l) => ({ orden: l.orden, medicamento: m, presentacion: p })),
    yaDispensada: false,
    recetaSimilarId: null,
    plataforma: null,
    cimavetCacheDesde: null,
    primeraDispensacion: null,
    clock: CLOCK,
    politica: politica(),
    rules: RULES,
    ...o,
  });
}

const codes = (r: ReturnType<typeof evaluar>) => r.incidencias.map((i) => `${i.code}:${i.severidad}`);

describe('receta completa', () => {
  it('receta de compañía completa no tiene defectos', () => {
    const r = evaluar(receta());
    expect(r.incidencias).toEqual([]);
    expect(r.validez?.efectiva).toBe('2026-10-17');
    expect(r.reglaVersion).toBe(RULES.version);
    expect(r.porLinea[1]).toEqual([]);
  });
});

describe('severidad por campo y contexto (receta-campos.v1.yaml)', () => {
  const vet = receta().veterinario;
  it.each`
    descripcion                         | cambio                                             | produccion | esperado
    ${'falta nº de receta'}             | ${{ numero: null }}                                | ${false}   | ${'RECETA_NUMERO_FALTA:BLOQUEANTE_FORMA'}
    ${'falta tipo de dispensación'}     | ${{ tipoDispensacion: null }}                      | ${false}   | ${'TIPO_DISPENSACION_FALTA:BLOQUEANTE_FORMA'}
    ${'falta titular'}                  | ${{ titular: { nombre: null, telefono: '6' } }}    | ${false}   | ${'TITULAR_NOMBRE_FALTA:BLOQUEANTE_FORMA'}
    ${'teléfono titular, compañía'}     | ${{ titular: { nombre: 'X', telefono: null } }}    | ${false}   | ${'TITULAR_TELEFONO_FALTA:AVISO'}
    ${'teléfono titular, producción'}   | ${{ titular: { nombre: 'X', telefono: null } }}    | ${true}    | ${'TITULAR_TELEFONO_FALTA:BLOQUEANTE_FORMA'}
    ${'REGA en producción'}             | ${{ rega: null }}                                  | ${true}    | ${'REGA_FALTA:BLOQUEANTE_FORMA'}
    ${'falta especie'}                  | ${{ especie: { texto: null, especieId: null } }}   | ${false}   | ${'ESPECIE_FALTA:BLOQUEANTE_FORMA'}
    ${'ID animal en perro (microchip)'} | ${{ animalIdentificacion: null }}                  | ${false}   | ${'ANIMAL_ID_FALTA:BLOQUEANTE_FORMA'}
    ${'nº de animales, compañía'}       | ${{ numAnimales: null }}                           | ${false}   | ${'NUM_ANIMALES_FALTA:AVISO'}
    ${'nº de animales, producción'}     | ${{ numAnimales: null }}                           | ${true}    | ${'NUM_ANIMALES_FALTA:BLOQUEANTE_FORMA'}
    ${'falta fecha de emisión'}         | ${{ fechaEmision: null }}                          | ${false}   | ${'FECHA_EMISION_FALTA:BLOQUEANTE_FORMA'}
    ${'fecha de emisión futura'}        | ${{ fechaEmision: '2026-10-20' }}                  | ${false}   | ${'FECHA_EMISION_FUTURA:BLOQUEANTE_FORMA'}
    ${'falta nombre veterinario'}       | ${{ veterinario: { ...vet, nombre: null } }}       | ${false}   | ${'VETERINARIO_NOMBRE_FALTA:BLOQUEANTE_FORMA'}
    ${'falta teléfono veterinario'}     | ${{ veterinario: { ...vet, telefono: null } }}     | ${false}   | ${'VETERINARIO_TELEFONO_FALTA:AVISO'}
    ${'falta correo veterinario'}       | ${{ veterinario: { ...vet, email: null } }}        | ${false}   | ${'VETERINARIO_EMAIL_FALTA:AVISO'}
    ${'falta nº colegiado'}             | ${{ veterinario: { ...vet, numColegiado: null } }} | ${false}   | ${'VETERINARIO_COLEGIADO_FALTA:BLOQUEANTE_FORMA'}
    ${'falta firma'}                    | ${{ firmaConfirmada: false }}                      | ${false}   | ${'FIRMA_FALTA:BLOQUEANTE_FORMA'}
    ${'falta clase de prescripción'}    | ${{ clasePrescripcion: null }}                     | ${false}   | ${'CLASE_PRESCRIPCION_FALTA:AVISO'}
    ${'falta indicación'}               | ${{ indicacion: null }}                            | ${false}   | ${'INDICACION_FALTA:BLOQUEANTE_FORMA'}
    ${'datos sin comprobar'}            | ${{ comprobadoConOriginal: false }}                | ${false}   | ${'DATOS_NO_COMPROBADOS:BLOQUEANTE_DURO'}
  `('$descripcion → $esperado', ({ cambio, produccion, esperado }) => {
    const extra = produccion
      ? {
          especieProduccion: true,
          especie: { texto: 'Bovino', especieId: ESPECIE.BOVINO },
          rega: 'ES000000000000',
        }
      : {};
    const r = evaluar(receta({ ...extra, ...cambio }), {
      m: med({ especieIds: [ESPECIE.PERROS, ESPECIE.BOVINO] }),
    });
    expect(codes(r)).toContain(esperado);
  });

  it('dispensación ágil (compañía): los datos de registro confirmados se transcriben después; los esenciales no', () => {
    const vacios = {
      titular: { nombre: null, telefono: null, direccion: null, dni: null },
      veterinario: { ...vet, nombre: null },
      indicacion: null,
      animalIdentificacion: null,
    };
    const sin = codes(evaluar(receta(vacios)));
    expect(sin).toContain('TITULAR_NOMBRE_FALTA:BLOQUEANTE_FORMA');
    const con = codes(evaluar(receta({ ...vacios, registroDiferido: true })));
    expect(con).toEqual(['REGISTRO_PENDIENTE:AVISO']);
    // Nº de receta, colegiado, firma y fecha se comprueban siempre antes de dispensar.
    const esenciales = codes(
      evaluar(
        receta({
          registroDiferido: true,
          numero: null,
          firmaConfirmada: false,
          veterinario: { ...vet, numColegiado: null },
        }),
      ),
    );
    expect(esenciales).toEqual(
      expect.arrayContaining([
        'RECETA_NUMERO_FALTA:BLOQUEANTE_FORMA',
        'FIRMA_FALTA:BLOQUEANTE_FORMA',
        'VETERINARIO_COLEGIADO_FALTA:BLOQUEANTE_FORMA',
      ]),
    );
  });

  it('dispensación ágil no aplica a animales de producción', () => {
    const r = evaluar(
      receta({
        registroDiferido: true,
        especieProduccion: true,
        especie: { texto: 'Bovino', especieId: ESPECIE.BOVINO },
        rega: 'ES0',
        indicacion: null,
      }),
      { m: med({ especieIds: [ESPECIE.BOVINO] }) },
    );
    expect(codes(r)).toContain('INDICACION_FALTA:BLOQUEANTE_FORMA');
    expect(codes(r)).not.toContain('REGISTRO_PENDIENTE:AVISO');
  });

  it('REGA no aplica en compañía', () => {
    expect(codes(evaluar(receta({ rega: null })))).toEqual([]);
  });

  it('identificación del animal es AVISO en especies sin ID individual obligatoria', () => {
    const r = evaluar(receta({ animalIdentificacion: null, especie: { texto: 'Conejo', especieId: 16 } }), {
      m: med({ especieIds: [16] }),
    });
    expect(codes(r)).toEqual(['ANIMAL_ID_FALTA:AVISO']);
  });

  it('talonario colegial exime del nº de colegiado', () => {
    const r = evaluar(receta({ talonarioColegial: true, veterinario: { ...vet, numColegiado: null } }));
    expect(codes(r)).toEqual([]);
  });

  const lineaBase = receta().lineas[0]!;
  it.each`
    descripcion                         | cambio                                                    | esperado
    ${'falta nombre y PA'}              | ${{ medicamentoTexto: null, principioActivoTexto: null }} | ${['MEDICAMENTO_NOMBRE_FALTA:BLOQUEANTE_FORMA', 'PRINCIPIO_ACTIVO_FALTA:BLOQUEANTE_FORMA']}
    ${'solo principio activo'}          | ${{ medicamentoTexto: null }}                             | ${['PRESCRIPCION_SOLO_PA:BLOQUEANTE_FORMA']}
    ${'falta principio activo'}         | ${{ principioActivoTexto: null }}                         | ${['PRINCIPIO_ACTIVO_FALTA:BLOQUEANTE_FORMA']}
    ${'falta forma/concentración'}      | ${{ concentracionTexto: null }}                           | ${['FORMA_CONCENTRACION_FALTA:BLOQUEANTE_FORMA']}
    ${'falta cantidad'}                 | ${{ cantidadEnvases: null }}                              | ${['CANTIDAD_FALTA:BLOQUEANTE_FORMA']}
    ${'falta posología (compañía)'}     | ${{ posologia: null }}                                    | ${['POSOLOGIA_FALTA:AVISO']}
    ${'falta tiempo de espera'}         | ${{ tiempoEsperaTexto: null }}                            | ${['TIEMPO_ESPERA_FALTA:AVISO']}
    ${'antimicrobiano sin declaración'} | ${{ declaracionAntimicrobiano: null }}                    | ${['DECLARACION_ANTIMICROBIANO_FALTA:BLOQUEANTE_FORMA']}
  `('línea: $descripcion', ({ cambio, esperado }) => {
    const r = evaluar(receta({ lineas: [{ ...lineaBase, ...cambio }] }));
    expect(codes(r)).toEqual(esperado);
    expect(r.incidencias.every((i) => i.linea === 1 && i.ambito === 'linea')).toBe(true);
  });

  it('un no antimicrobiano no exige la declaración del art. 107', () => {
    const r = evaluar(receta({ lineas: [{ ...lineaBase, declaracionAntimicrobiano: null }] }), {
      m: medNoAntibiotico(),
    });
    expect(codes(r)).toEqual([]);
  });

  it('receta marcada «de antimicrobianos»: exige la declaración y validez de 5 días aunque CIMAVet no lo diga', () => {
    const r = evaluar(
      receta({
        antimicrobianos: true,
        fechaEmision: '2026-10-08',
        lineas: [{ ...lineaBase, declaracionAntimicrobiano: null }],
      }),
      { m: medNoAntibiotico() },
    );
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        'DECLARACION_ANTIMICROBIANO_FALTA:BLOQUEANTE_FORMA',
        'RECETA_CADUCADA:BLOQUEANTE_FORMA',
      ]),
    );
    expect(r.validez?.caso).toBe('antimicrobiano');
  });

  it('ATC QJ01 cuenta como antimicrobiano aunque antibiotico=false', () => {
    const r = evaluar(receta({ lineas: [{ ...lineaBase, declaracionAntimicrobiano: null }] }), {
      m: med({ antibiotico: false }),
    });
    expect(codes(r)).toContain('DECLARACION_ANTIMICROBIANO_FALTA:BLOQUEANTE_FORMA');
  });
});

describe('casos de SPEC §12.2 en la evaluación', () => {
  it('antimicrobiano emitido hace 6 días → caducada', () => {
    const r = evaluar(receta({ fechaEmision: '2026-10-08' }));
    expect(codes(r)).toContain('RECETA_CADUCADA:BLOQUEANTE_FORMA');
    expect(r.incidencias.find((i) => i.code === 'RECETA_CADUCADA')?.params).toEqual({ fecha: '13/10/2026' });
  });

  it('antimicrobiano emitido hace 5 días → todavía válida', () => {
    expect(codes(evaluar(receta({ fechaEmision: '2026-10-09' })))).toEqual([]);
  });

  it('receta "de botiquín" → defecto', () => {
    const r = evaluar(receta({ tipoDispensacion: 'botiquin' }));
    expect(r.incidencias).toContainEqual(
      expect.objectContaining({ code: 'TIPO_DISPENSACION_NO_DISPENSABLE', params: { tipo: 'de botiquín' } }),
    );
  });

  it('"de no dispensación" → defecto', () => {
    const r = evaluar(receta({ tipoDispensacion: 'no_dispensacion' }));
    expect(r.incidencias[0]?.params).toEqual({ tipo: 'de no dispensación' });
  });

  it('duplicado (mismo nº y colegiado ya dispensado, papel) → BLOQUEANTE_DURO', () => {
    expect(codes(evaluar(receta(), { yaDispensada: true }))).toEqual([
      'RECETA_YA_DISPENSADA:BLOQUEANTE_DURO',
    ]);
  });

  it('en receta electrónica "ya dispensada" no aplica la regla de papel', () => {
    const r = evaluar(receta({ tipo: 'electronica' }), {
      yaDispensada: true,
      plataforma: { nombre: 'Recevet', reconocidaMapa: true },
    });
    expect(codes(r)).toEqual([]);
  });

  it('mismo pHash → aviso con enlace a la anterior', () => {
    const r = evaluar(receta(), { recetaSimilarId: 'abc' });
    expect(r.incidencias).toEqual([
      expect.objectContaining({
        code: 'RECETA_POSIBLE_DUPLICADO',
        severidad: 'AVISO',
        params: { recetaId: 'abc' },
      }),
    ]);
  });

  it.each`
    plataforma                                      | esperado
    ${null}                                         | ${'PLATAFORMA_DESCONOCIDA:AVISO'}
    ${'desconocida'}                                | ${'PLATAFORMA_DESCONOCIDA:AVISO'}
    ${{ nombre: 'Recevet', reconocidaMapa: false }} | ${'PLATAFORMA_NO_RECONOCIDA:AVISO'}
    ${{ nombre: 'Recevet', reconocidaMapa: null }}  | ${'PLATAFORMA_PENDIENTE_VERIFICAR:AVISO'}
  `('receta electrónica con plataforma $plataforma → $esperado', ({ plataforma, esperado }) => {
    expect(codes(evaluar(receta({ tipo: 'electronica' }), { plataforma }))).toEqual([esperado]);
  });

  it('estupefaciente → BLOQUEANTE_DURO', () => {
    expect(codes(evaluar(receta(), { m: med({ estupefaciente: true }) }))).toContain(
      'ESTUPEFACIENTE_NO_DISPENSABLE:BLOQUEANTE_DURO',
    );
  });

  it('psicótropo con 2 envases prescritos → BLOQUEANTE_DURO', () => {
    const r = evaluar(receta({ lineas: [{ ...receta().lineas[0]!, cantidadEnvases: 2 }] }), {
      m: medNoAntibiotico({ psicotropo: true }),
    });
    expect(codes(r)).toEqual(['PSICOTROPO_MAS_DE_UN_ENVASE:BLOQUEANTE_DURO']);
  });

  it('psicótropo, 1 envase, receta de 20 días en tratamiento crónico → válida', () => {
    const r = evaluar(receta({ fechaEmision: '2026-09-24', tipoTratamiento: 'cronico' }), {
      m: medNoAntibiotico({ psicotropo: true }),
    });
    expect(codes(r)).toEqual([]);
  });

  it('psicótropo, receta de 35 días en tratamiento crónico → caducada (y no forzable)', () => {
    const r = evaluar(receta({ fechaEmision: '2026-09-09', tipoTratamiento: 'cronico' }), {
      m: medNoAntibiotico({ psicotropo: true }),
    });
    expect(codes(r)).toEqual(['RECETA_CADUCADA:BLOQUEANTE_FORMA']);
    expect(r.porLinea[1]).toEqual([
      expect.objectContaining({ code: 'RECETA_CADUCADA', severidad: 'BLOQUEANTE_DURO', porPsicotropo: true }),
    ]);
  });

  it('psicótropo con PSYCHOTROPIC_ALLOW_FORCE=true mantiene el defecto forzable', () => {
    const r = evaluar(receta({ fechaEmision: '2026-09-09', tipoTratamiento: 'cronico' }), {
      m: medNoAntibiotico({ psicotropo: true }),
      politica: politica({ psychotropicAllowForce: true }),
    });
    expect(r.porLinea[1]?.[0]?.severidad).toBe('BLOQUEANTE_FORMA');
  });

  it('no antimicrobiano crónico no productora emitida hace 2 meses → válida (3 meses)', () => {
    const r = evaluar(receta({ fechaEmision: '2026-08-20', tipoTratamiento: 'cronico' }), {
      m: medNoAntibiotico(),
    });
    expect(codes(r)).toEqual([]);
  });

  it('plazo declarado de 6 meses en agudo → aviso con el máximo aplicado', () => {
    const r = evaluar(receta({ plazoValidezDeclarado: { cantidad: 6, unidad: 'meses' } }), {
      m: medNoAntibiotico(),
    });
    expect(r.incidencias).toEqual([
      expect.objectContaining({
        code: 'PLAZO_DECLARADO_SUPERIOR',
        severidad: 'AVISO',
        params: { maximo: '1 mes', fecha: '12/11/2026' },
      }),
    ]);
  });

  it('medicamento de uso humano → requiere garante (no forzable por el empleado)', () => {
    expect(codes(evaluar(receta(), { m: med({ usoHumano: true }) }))).toContain(
      'MEDICAMENTO_USO_HUMANO:BLOQUEANTE_DURO',
    );
  });

  it.each`
    descripcion                         | m                                  | p                           | esperado
    ${'suspendido (forzable temporal)'} | ${{ estado: 'suspendido' }}        | ${{}}                       | ${'MEDICAMENTO_SUSPENDIDO:BLOQUEANTE_FORMA'}
    ${'revocado'}                       | ${{ estado: 'revocado' }}          | ${{}}                       | ${'MEDICAMENTO_REVOCADO:BLOQUEANTE_FORMA'}
    ${'presentación suspendida'}        | ${{}}                              | ${{ estado: 'suspendido' }} | ${'MEDICAMENTO_SUSPENDIDO:BLOQUEANTE_FORMA'}
    ${'no comercializado'}              | ${{ comerc: false }}               | ${{}}                       | ${'MEDICAMENTO_NO_COMERCIALIZADO:AVISO'}
    ${'presentación no comercializada'} | ${{}}                              | ${{ comerc: false }}        | ${'MEDICAMENTO_NO_COMERCIALIZADO:AVISO'}
    ${'problema de suministro'}         | ${{ psum: true }}                  | ${{}}                       | ${'PROBLEMA_SUMINISTRO:AVISO'}
    ${'suministro desconocido'}         | ${{ psum: null }}                  | ${{}}                       | ${'SUMINISTRO_NO_COMPROBADO:AVISO'}
    ${'notas de seguridad'}             | ${{ notas: true }}                 | ${{}}                       | ${'NOTAS_SEGURIDAD:AVISO'}
    ${'especie no autorizada'}          | ${{ especieIds: [ESPECIE.GATOS] }} | ${{}}                       | ${'MEDICAMENTO_ESPECIE_NO_AUTORIZADA:AVISO'}
  `('medicamento $descripcion', ({ m, p, esperado }) => {
    const r = evaluar(receta(), { m: med(m), p: pres({ cn: '570016', nregistro: '1000 ESP', ...p }) });
    expect(codes(r)).toEqual([esperado]);
  });

  it('PRODUCT_VALIDITY_HARD_BLOCK=true convierte "producto no válido" en no forzable', () => {
    const r = evaluar(receta(), {
      m: med({ estado: 'suspendido' }),
      politica: politica({ productValidityHardBlock: true }),
    });
    expect(codes(r)).toEqual(['MEDICAMENTO_SUSPENDIDO:BLOQUEANTE_DURO']);
  });

  it('subcategoría de especie cubierta por la autorización de la especie base', () => {
    const r = evaluar(receta({ especie: { texto: 'Perro grande', especieId: ESPECIE.PERROS_GRANDES } }));
    expect(codes(r)).toEqual([]);
  });

  it('medicamento sin elegir → BLOQUEANTE_DURO hasta que la persona lo seleccione', () => {
    expect(codes(evaluar(receta(), { m: null }))).toEqual(['MEDICAMENTO_NO_EN_SISTEMA:BLOQUEANTE_DURO']);
    expect(codes(evaluar(receta(), { p: null }))).toEqual(['MEDICAMENTO_NO_EN_SISTEMA:BLOQUEANTE_DURO']);
  });

  it('CIMAVet sin respuesta → aviso con la fecha de la última sincronización', () => {
    const r = evaluar(receta(), { cimavetCacheDesde: '2026-10-13' });
    expect(r.incidencias).toEqual([
      expect.objectContaining({ code: 'CIMAVET_NO_DISPONIBLE', params: { fecha: '13/10/2026' } }),
    ]);
  });

  it('campo mal leído corregido a mano → reevaluación limpia, sin forzado', () => {
    const extraida = receta({ veterinario: { ...receta().veterinario, numColegiado: null } });
    const antes = evaluar(extraida);
    expect(codes(antes)).toEqual(['VETERINARIO_COLEGIADO_FALTA:BLOQUEANTE_FORMA']);
    const corregida = { ...extraida, veterinario: { ...extraida.veterinario, numColegiado: '28/1234' } };
    expect(evaluar(corregida).incidencias).toEqual([]);
  });
});

describe('dispensación diferida (D-10)', () => {
  it('la validez se evalúa en la fecha de la primera dispensación', () => {
    const r = evaluar(receta({ fechaEmision: '2026-10-01' }), {
      m: medNoAntibiotico(),
      primeraDispensacion: '2026-10-20',
      clock: fixedClock('2026-11-20T10:00:00Z'),
    });
    expect(r.fechaReferencia).toBe('2026-10-20');
    expect(codes(r)).toEqual([]);
    expect(fechaReferenciaValidez(null, '2026-10-14')).toBe('2026-10-14');
  });
});
