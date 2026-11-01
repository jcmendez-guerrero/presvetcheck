import { describe, expect, it } from 'vitest';
import type { DomainError } from '@mmx/shared';
import {
  defectosForzables,
  prescripcionVirtual,
  validarEleccionSoloPA,
  validarForzado,
} from '../src/forzado';
import {
  aplicarPoliticaPsicotropo,
  incidencia,
  peorSeveridad,
  severidadDe,
  avisos,
  bloqueantes,
} from '../src/severidad';
import { ESPECIE, FORMA, PA, RULES, VIA, amoxicilina, politica } from './builders';

const POL = politica();
const forma = incidencia('PRESCRIPCION_SOLO_PA', POL, { linea: 1 });
const aviso = incidencia('PROBLEMA_SUMINISTRO', POL, { linea: 1 });
const MOTIVO = 'El veterinario confirma por teléfono el medicamento';

function codigoError(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'OK';
}

describe('forzado de defectos (SPEC §4.1.6)', () => {
  it('acepta un defecto de forma con aceptación, motivo ≥ 15 y códigos coincidentes', () => {
    expect(
      validarForzado([forma, aviso], {
        codigos: ['PRESCRIPCION_SOLO_PA'],
        motivo: `  ${MOTIVO} `,
        aceptaRiesgos: true,
      }),
    ).toEqual({
      codigos: ['PRESCRIPCION_SOLO_PA'],
      motivo: MOTIVO,
    });
  });

  it.each`
    descripcion                          | incs                                                  | solicitud                                                                                | error
    ${'receta ya dispensada (duro)'}     | ${[incidencia('RECETA_YA_DISPENSADA', POL)]}          | ${{ codigos: ['RECETA_YA_DISPENSADA'], motivo: MOTIVO, aceptaRiesgos: true }}            | ${'FORZADO_NO_PERMITIDO'}
    ${'online con receta (duro)'}        | ${[incidencia('ONLINE_CON_RECETA', POL)]}             | ${{ codigos: ['ONLINE_CON_RECETA'], motivo: MOTIVO, aceptaRiesgos: true }}               | ${'FORZADO_NO_PERMITIDO'}
    ${'estupefaciente'}                  | ${[incidencia('ESTUPEFACIENTE_NO_DISPENSABLE', POL)]} | ${{ codigos: [], motivo: MOTIVO, aceptaRiesgos: true }}                                  | ${'FORZADO_NO_PERMITIDO'}
    ${'psicótropo (defecto endurecido)'} | ${aplicarPoliticaPsicotropo([forma], true, POL)}      | ${{ codigos: ['PRESCRIPCION_SOLO_PA'], motivo: MOTIVO, aceptaRiesgos: true }}            | ${'FORZADO_PSICOTROPO_NO_PERMITIDO'}
    ${'sin aceptar los riesgos'}         | ${[forma]}                                            | ${{ codigos: ['PRESCRIPCION_SOLO_PA'], motivo: MOTIVO, aceptaRiesgos: false }}           | ${'FORZADO_SIN_ACEPTACION'}
    ${'motivo corto'}                    | ${[forma]}                                            | ${{ codigos: ['PRESCRIPCION_SOLO_PA'], motivo: 'porque sí      ', aceptaRiesgos: true }} | ${'FORZADO_MOTIVO_CORTO'}
    ${'códigos distintos'}               | ${[forma]}                                            | ${{ codigos: ['FIRMA_FALTA'], motivo: MOTIVO, aceptaRiesgos: true }}                     | ${'FORZADO_CODIGOS_NO_COINCIDEN'}
    ${'nada que forzar'}                 | ${[aviso]}                                            | ${{ codigos: [], motivo: MOTIVO, aceptaRiesgos: true }}                                  | ${'FORZADO_CODIGOS_NO_COINCIDEN'}
  `('rechaza: $descripcion', ({ incs, solicitud, error }) => {
    expect(codigoError(() => validarForzado(incs, solicitud))).toBe(error);
  });

  it('envase caducado: forzable con PRODUCT_VALIDITY_HARD_BLOCK=false y rechazado con true', () => {
    const blando = [
      incidencia('ENVASE_CADUCADO', politica({ productValidityHardBlock: false }), {
        params: { fecha: '01/10/2026' },
      }),
    ];
    const duro = [incidencia('ENVASE_CADUCADO', politica({ productValidityHardBlock: true }))];
    expect(
      validarForzado(blando, { codigos: ['ENVASE_CADUCADO'], motivo: MOTIVO, aceptaRiesgos: true }).codigos,
    ).toEqual(['ENVASE_CADUCADO']);
    expect(
      codigoError(() =>
        validarForzado(duro, { codigos: ['ENVASE_CADUCADO'], motivo: MOTIVO, aceptaRiesgos: true }),
      ),
    ).toBe('FORZADO_NO_PERMITIDO');
  });

  it('lista los defectos forzables sin duplicados', () => {
    expect(defectosForzables([forma, forma, aviso])).toEqual(['PRESCRIPCION_SOLO_PA']);
  });
});

describe('prescripción solo por principio activo forzada (SPEC §4.1.4)', () => {
  const virtual = prescripcionVirtual({
    pas: [{ paId: PA.AMOXICILINA, nombre: 'AMOXICILINA', cantidad: '500', unidad: 'mg' }],
    porCantidad: '1',
    porUnidad: 'Comprimido',
    formaId: FORMA.COMPRIMIDO,
    viaId: VIA.ORAL,
    especieId: ESPECIE.PERROS,
  });
  const ctx = {
    especieId: ESPECIE.PERROS,
    especieProduccion: false,
    clase: 'ordinaria' as const,
    indicacion: 'Infecciones de la piel',
    viaPrescritaId: VIA.ORAL,
    duracionDias: null,
  };

  it('el medicamento elegido equivalente a lo que indica la receta se acepta', () => {
    expect(() => validarEleccionSoloPA(virtual, amoxicilina(500), ctx, RULES.equivalencia)).not.toThrow();
    expect(virtual.nombre).toBe('AMOXICILINA');
  });

  it('forzado con medicamento no equivalente → rechazado', () => {
    expect(codigoError(() => validarEleccionSoloPA(virtual, amoxicilina(250), ctx, RULES.equivalencia))).toBe(
      'FORZADO_ELECCION_NO_EQUIVALENTE',
    );
  });

  it('en especie productora no hay tiempo de espera de referencia → rechazado (conservador)', () => {
    const v = prescripcionVirtual({
      pas: virtual.composicion.pas,
      porCantidad: '1',
      porUnidad: 'Comprimido',
      formaId: FORMA.COMPRIMIDO,
      viaId: null,
      especieId: null,
    });
    const prod = { ...ctx, especieId: ESPECIE.BOVINO, especieProduccion: true, viaPrescritaId: null };
    expect(v.viaIds).toEqual([]);
    expect(
      codigoError(() =>
        validarEleccionSoloPA(
          v,
          amoxicilina(500, { especieIds: [ESPECIE.BOVINO] }),
          prod,
          RULES.equivalencia,
        ),
      ),
    ).toBe('FORZADO_ELECCION_NO_EQUIVALENTE');
  });
});

describe('severidades', () => {
  it('peor severidad y filtros', () => {
    const duro = incidencia('RECETA_YA_DISPENSADA', POL);
    expect(peorSeveridad([aviso, forma, duro])).toBe('BLOQUEANTE_DURO');
    expect(peorSeveridad([aviso, forma])).toBe('BLOQUEANTE_FORMA');
    expect(peorSeveridad([aviso])).toBe('AVISO');
    expect(peorSeveridad([])).toBeNull();
    expect(bloqueantes([aviso, forma])).toEqual([forma]);
    expect(avisos([aviso, forma])).toEqual([aviso]);
  });
  it('lanza si una incidencia no tiene severidad configurada', () => {
    expect(() => severidadDe('RECETA_NUMERO_FALTA', POL)).toThrow(/sin severidad/);
  });
  it('ámbito explícito', () => {
    expect(incidencia('SUSTITUCION', POL, { ambito: 'linea' }).ambito).toBe('linea');
    expect(aplicarPoliticaPsicotropo([forma], false, POL)).toEqual([forma]);
  });
});
