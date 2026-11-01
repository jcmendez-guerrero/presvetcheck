import { describe, expect, it } from 'vitest';
import type { DomainError } from '@mmx/shared';
import { exigirMotivoLote, validarEnvase, type EntradaEscaneo } from '../src/escaneo';
import { caducidadFefo, disponibleNoCaducado, ordenarFefo, proponerLotes } from '../src/fefo';
import { HOY, lote, politica } from './builders';

const base = (o: Partial<EntradaEscaneo> = {}): EntradaEscaneo => ({
  linea: 1,
  cnSeleccionado: '570016',
  envase: { cn: '570016', lote: 'L1', caducidad: '2027-01-31', serie: null },
  loteRecomendado: 'L1',
  motivoLoteDistinto: null,
  unidadesYaDispensadas: 0,
  unidadesAhora: 1,
  unidadesMax: 1,
  seriesYaDispensadas: [],
  psicotropo: false,
  hoy: HOY,
  politica: politica(),
  ...o,
});
const codes = (e: EntradaEscaneo) => validarEnvase(e).map((i) => `${i.code}:${i.severidad}`);

describe('confirmación por escaneo (SPEC §4.6)', () => {
  it('envase correcto → sin incidencias', () => {
    expect(codes(base())).toEqual([]);
  });
  it.each`
    descripcion                                | cambio                                                                                                         | esperado
    ${'CN distinto al seleccionado → bloqueo'} | ${{ envase: { cn: '999999', lote: 'L1', caducidad: '2027-01-31', serie: null } }}                              | ${['CN_ESCANEADO_DISTINTO:BLOQUEANTE_FORMA']}
    ${'envase caducado → bloqueo'}             | ${{ envase: { cn: '570016', lote: 'L1', caducidad: '2026-10-13', serie: null } }}                              | ${['ENVASE_CADUCADO:BLOQUEANTE_FORMA']}
    ${'caduca hoy → todavía válido'}           | ${{ envase: { cn: '570016', lote: 'L1', caducidad: '2026-10-14', serie: null } }}                              | ${[]}
    ${'lote distinto al FEFO → aviso'}         | ${{ envase: { cn: '570016', lote: 'L9', caducidad: '2027-01-31', serie: null } }}                              | ${['LOTE_NO_FEFO:AVISO']}
    ${'unidades > prescritas → bloqueo'}       | ${{ unidadesYaDispensadas: 1 }}                                                                                | ${['UNIDADES_SUPERAN_PRESCRITAS:BLOQUEANTE_DURO']}
    ${'nº de serie repetido → aviso'}          | ${{ envase: { cn: '570016', lote: 'L1', caducidad: '2027-01-31', serie: 'S1' }, seriesYaDispensadas: ['S1'] }} | ${['SERIE_YA_DISPENSADA:AVISO']}
    ${'psicótropo, segundo envase'}            | ${{ psicotropo: true, unidadesMax: 3, unidadesAhora: 2 }}                                                      | ${['PSICOTROPO_MAS_DE_UN_ENVASE:BLOQUEANTE_DURO']}
    ${'EAN sin CN ni caducidad'}               | ${{ envase: { cn: null, lote: 'L1', caducidad: null, serie: null } }}                                          | ${[]}
  `('$descripcion', ({ cambio, esperado }) => {
    expect(codes(base(cambio))).toEqual(esperado);
  });

  it('envase caducado con PRODUCT_VALIDITY_HARD_BLOCK=true → no forzable', () => {
    expect(
      codes(
        base({
          politica: politica({ productValidityHardBlock: true }),
          envase: { cn: '570016', lote: 'L1', caducidad: '2026-01-01', serie: null },
        }),
      ),
    ).toEqual(['ENVASE_CADUCADO:BLOQUEANTE_DURO']);
  });

  it('lote distinto al FEFO exige motivo', () => {
    const incs = validarEnvase(
      base({ envase: { cn: '570016', lote: 'L9', caducidad: '2027-01-31', serie: null } }),
    );
    expect(() => exigirMotivoLote(incs, null)).toThrow();
    try {
      exigirMotivoLote(incs, ' ');
    } catch (e) {
      expect((e as DomainError).code).toBe('MOTIVO_LOTE_OBLIGATORIO');
    }
    expect(() => exigirMotivoLote(incs, 'Lote más accesible')).not.toThrow();
    expect(() => exigirMotivoLote([], null)).not.toThrow();
  });

  it('sin línea (venta sin receta) no añade el campo línea', () => {
    expect(
      validarEnvase(base({ linea: undefined as never, unidadesYaDispensadas: 3 }))[0]?.linea,
    ).toBeUndefined();
  });
});

describe('FEFO (SPEC §4.5)', () => {
  it('ordena por caducidad; empate → creado antes; sin caducidad al final', () => {
    const r = ordenarFefo([
      lote({ lote: 'SIN', caducidad: null }),
      lote({ lote: 'B', caducidad: '2027-01-31', creadoAt: '2026-05-01T00:00:00Z' }),
      lote({ lote: 'A', caducidad: '2027-01-31', creadoAt: '2026-02-01T00:00:00Z' }),
      lote({ lote: 'C', caducidad: '2026-12-31' }),
      lote({ lote: 'SIN2', caducidad: null, creadoAt: '2025-01-01T00:00:00Z' }),
    ]);
    expect(r.map((l) => l.lote)).toEqual(['C', 'A', 'B', 'SIN2', 'SIN']);
  });

  it('reparte entre lotes si la cantidad supera el primero y avisa del lote sin caducidad', () => {
    const r = proponerLotes({
      lotes: [
        lote({ lote: 'A', disponible: 1, caducidad: '2027-01-01' }),
        lote({ lote: 'B', disponible: 0 }),
        lote({ lote: 'C', disponible: 5, caducidad: null }),
      ],
      unidades: 3,
      hoy: HOY,
      duracionDias: null,
    });
    expect(r.reparto).toEqual([
      { lote: 'A', unidades: 1, caducidad: '2027-01-01', variantId: 1 },
      { lote: 'C', unidades: 2, caducidad: null, variantId: 1 },
    ]);
    expect(r.avisos.map((a) => a.code)).toEqual(['LOTE_SIN_CADUCIDAD']);
    expect(r.excluidos).toEqual([{ lote: 'B', motivo: 'SIN_DISPONIBLE' }]);
    expect(r.disponibleTotal).toBe(6);
  });

  it('stock insuficiente → aviso', () => {
    const r = proponerLotes({
      lotes: [lote({ lote: 'A', disponible: 1 })],
      unidades: 3,
      hoy: HOY,
      duracionDias: null,
    });
    expect(r.avisos.map((a) => a.code)).toEqual(['STOCK_INSUFICIENTE']);
  });

  it('sin lotes válidos → sin recomendación', () => {
    const r = proponerLotes({
      lotes: [lote({ lote: 'A', caducidad: '2020-01-01' })],
      unidades: 1,
      hoy: HOY,
      duracionDias: 10,
    });
    expect(r.recomendado).toBeNull();
    expect(r.avisos).toEqual([]);
  });

  it('ningún lote cubre el tratamiento → aviso sin alternativa', () => {
    const r = proponerLotes({
      lotes: [lote({ lote: 'A', caducidad: '2026-10-20' })],
      unidades: 1,
      hoy: HOY,
      duracionDias: 30,
    });
    expect(r.alternativaQueCubre).toBeNull();
    expect(r.avisos.map((a) => a.code)).toEqual(['LOTE_CADUCA_ANTES_FIN_TRATAMIENTO']);
  });

  it('disponible no caducado y caducidad FEFO', () => {
    const lotes = [
      lote({ lote: 'A', caducidad: '2026-10-01', disponible: 9 }),
      lote({ lote: 'B', caducidad: '2027-02-01', disponible: 2 }),
    ];
    expect(disponibleNoCaducado(lotes, HOY)).toBe(2);
    expect(caducidadFefo(lotes, HOY)).toBe('2027-02-01');
    expect(caducidadFefo([], HOY)).toBeNull();
  });
});
