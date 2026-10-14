import { describe, expect, it } from 'vitest';
import { decidirLinea, resumenReceta, type Candidato, type EntradaDecision } from '../src/decision';
import { incidencia } from '../src/severidad';
import type { Incidencia, MedicamentoInfo } from '../src/tipos';
import { ESPECIE, HOY, RULES, amoxicilina, lote, med, politica, pres } from './builders';

const POL = politica();
const P500 = amoxicilina(500);
const PRES500 = pres({ cn: '570016', nregistro: '1000 ESP', nombre: 'AMOXIVET 500 mg 10 comprimidos' });

function decidir(o: Partial<EntradaDecision> = {}) {
  return decidirLinea({
    linea: 1,
    incidencias: [],
    forzado: null,
    prescrito: { medicamento: P500, presentacion: PRES500, envases: 1 },
    candidatos: [],
    stock: {},
    ctx: { especieId: ESPECIE.PERROS, especieProduccion: false, clase: 'ordinaria', indicacion: 'Infecciones de la piel por bacterias sensibles', viaPrescritaId: null, duracionDias: 5 },
    exclusiones: [],
    politica: POL,
    equivalencia: RULES.equivalencia,
    config: { allowPackSizeChange: true, modoSustitucion: 'POST' },
    hoy: HOY,
    reglaVersion: RULES.version,
    ...o,
  });
}

/** Equivalente genérico de otro laboratorio (misma composición, forma, vía, especie e indicación). */
const generico = (o: Partial<MedicamentoInfo> = {}) =>
  amoxicilina(500, { nregistro: '3000 ESP', nombre: 'GENERICAMOX 500 mg', labtitular: 'LABORATORIO B', ...o });
const cand = (medicamento: MedicamentoInfo, cn: string, o: Partial<Candidato> = {}): Candidato => ({
  medicamento,
  presentacion: pres({ cn, nregistro: medicamento.nregistro, nombre: `${medicamento.nombre} (${cn})` }),
  ...o,
});

describe('motor de decisión (SPEC §4.3)', () => {
  it('receta completa con stock del CN → DISPENSAR con el lote de caducidad más próxima no caducado', () => {
    const r = decidir({
      stock: {
        '570016': [
          lote({ lote: 'L-TARDE', caducidad: '2028-01-31' }),
          lote({ lote: 'L-PRONTO', caducidad: '2027-03-31' }),
        ],
      },
    });
    expect(r.decision).toBe('DISPENSAR');
    expect(r.evidencias.lotes?.recomendado?.lote).toBe('L-PRONTO');
    expect(r.motivos).toEqual([]);
    expect(r.reglaVersion).toBe(RULES.version);
  });

  it('mismo caso con el lote más próximo caducado → recomienda el siguiente', () => {
    const r = decidir({
      stock: { '570016': [lote({ lote: 'L-CADUCADO', caducidad: '2026-10-13' }), lote({ lote: 'L-OK', caducidad: '2027-03-31' })] },
    });
    expect(r.decision).toBe('DISPENSAR');
    expect(r.evidencias.lotes?.recomendado?.lote).toBe('L-OK');
    expect(r.evidencias.lotes?.excluidos).toEqual([{ lote: 'L-CADUCADO', motivo: 'CADUCADO' }]);
  });

  it('lote que caduca antes del fin del tratamiento → AVISO y propuesta alternativa', () => {
    const r = decidir({
      ctx: { especieId: ESPECIE.PERROS, especieProduccion: false, clase: 'ordinaria', indicacion: 'x', viaPrescritaId: null, duracionDias: 30 },
      stock: { '570016': [lote({ lote: 'L-CORTO', caducidad: '2026-10-20' }), lote({ lote: 'L-LARGO', caducidad: '2027-03-31' })] },
    });
    expect(r.decision).toBe('DISPENSAR');
    expect(r.evidencias.lotes?.recomendado?.lote).toBe('L-CORTO');
    expect(r.evidencias.lotes?.alternativaQueCubre?.lote).toBe('L-LARGO');
    expect(r.motivos).toEqual([expect.objectContaining({ code: 'LOTE_CADUCA_ANTES_FIN_TRATAMIENTO', severidad: 'AVISO', params: { lote: 'L-CORTO', fecha: '20/10/2026' } })]);
  });

  it('Siweb360 no responde → PENDIENTE_STOCK (nunca se recomienda dispensar sin confirmar stock)', () => {
    const r = decidir({ stock: 'NO_DISPONIBLE' });
    expect(r.decision).toBe('PENDIENTE_STOCK');
    expect(r.motivos.map((m) => m.code)).toEqual(['STOCK_NO_DISPONIBLE']);
  });

  describe('bloqueos', () => {
    const duro: Incidencia = incidencia('RECETA_YA_DISPENSADA', POL);
    const forma: Incidencia = incidencia('PRESCRIPCION_SOLO_PA', POL, { linea: 1 });

    it('BLOQUEANTE_DURO → NO_CONFORME no forzable, aunque se pida forzar', () => {
      const r = decidir({ incidencias: [duro, forma], forzado: { codigos: ['PRESCRIPCION_SOLO_PA'], motivo: 'x'.repeat(20) } });
      expect(r.decision).toBe('NO_CONFORME');
      expect(r.evidencias.forzable).toBe(false);
    });

    it('BLOQUEANTE_FORMA sin forzar → NO_CONFORME forzable', () => {
      const r = decidir({ incidencias: [forma], stock: { '570016': [lote({ lote: 'L1' })] } });
      expect(r.decision).toBe('NO_CONFORME');
      expect(r.evidencias.forzable).toBe(true);
    });

    it('defecto de forma forzado → se continúa con forzado=true', () => {
      const r = decidir({
        incidencias: [forma],
        forzado: { codigos: ['PRESCRIPCION_SOLO_PA'], motivo: 'El veterinario lo confirma por teléfono' },
        stock: { '570016': [lote({ lote: 'L1' })] },
      });
      expect(r.decision).toBe('DISPENSAR');
      expect(r.evidencias.forzado).toBe(true);
      expect(r.evidencias.codigosForzados).toEqual(['PRESCRIPCION_SOLO_PA']);
      expect(r.motivos.map((m) => m.code)).toContain('PRESCRIPCION_SOLO_PA');
    });

    it('forzado que no cubre todos los defectos de forma → sigue NO_CONFORME', () => {
      const otro = incidencia('FIRMA_FALTA' as never, { ...POL, rules: { ...POL.rules, incidencias: { ...POL.rules.incidencias, FIRMA_FALTA: 'BLOQUEANTE_FORMA' } } });
      const r = decidir({ incidencias: [forma, otro], forzado: { codigos: ['PRESCRIPCION_SOLO_PA'], motivo: 'x'.repeat(20) } });
      expect(r.decision).toBe('NO_CONFORME');
      expect(r.evidencias.forzable).toBe(true);
    });
  });

  describe('regla de formato y concentración (§4.3.1)', () => {
    const p250 = amoxicilina(250);
    const p1000 = amoxicilina(1000);
    const p200 = amoxicilina(200);

    it('prescrito 500 mg × 10, stock 250 mg × 10 → 2 envases (5.000 mg) con nota de administración', () => {
      const r = decidir({ candidatos: [cand(p250, '570250')], stock: { '570250': [lote({ lote: 'L250' })] } });
      expect(r.decision).toBe('DISPENSAR_CON_AVISO');
      expect(r.evidencias.alternativaFormato?.envases).toBe(2);
      expect(r.evidencias.alternativaFormato?.formato.totalPrescrito?.toString()).toBe('5000');
      expect(r.evidencias.alternativaFormato?.nota).toBe(
        'Este envase es de 250 mg: administre 2 comprimidos por cada toma de 500 mg indicada por su veterinario',
      );
      expect(r.motivos.map((m) => m.code)).toEqual(['CAMBIO_CONCENTRACION']);
    });

    it('stock 1.000 mg → descartado (CONCENTRACION_SUPERIOR)', () => {
      const r = decidir({ candidatos: [cand(p1000, '571000')], stock: { '571000': [lote({ lote: 'L1000' })] } });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.alternativasDescartadas).toEqual([expect.objectContaining({ cn: '571000', motivos: ['CONCENTRACION_SUPERIOR'] })]);
    });

    it('prescrito 500 mg; stock 200 mg → AVISO de dosis no ajustable con unidades enteras', () => {
      const r = decidir({ candidatos: [cand(p200, '570200')], stock: { '570200': [lote({ lote: 'L200' })] } });
      expect(r.decision).toBe('DISPENSAR_CON_AVISO');
      expect(r.motivos.map((m) => m.code)).toEqual(['DOSIS_NO_AJUSTABLE', 'CAMBIO_CONCENTRACION']);
      expect(r.evidencias.alternativaFormato?.envases).toBe(2); // 4.000 mg ≤ 5.000 mg
    });

    it('mismo medicamento con envase de 20 → cantidad superior; envase de 5 → cambio de formato (2 envases)', () => {
      const env20 = { medicamento: P500, presentacion: pres({ cn: '570020', nregistro: '1000 ESP', contenido: '20' }) };
      const env5 = { medicamento: P500, presentacion: pres({ cn: '570005', nregistro: '1000 ESP', contenido: '5' }) };
      const r = decidir({ candidatos: [env20, env5], stock: { '570020': [lote({ lote: 'A' })], '570005': [lote({ lote: 'B' })] } });
      expect(r.decision).toBe('DISPENSAR_CON_AVISO');
      expect(r.evidencias.alternativaFormato?.cn).toBe('570005');
      expect(r.evidencias.alternativaFormato?.envases).toBe(2);
      expect(r.motivos.map((m) => m.code)).toEqual(['CAMBIO_FORMATO']);
      expect(r.evidencias.alternativasDescartadas).toEqual([expect.objectContaining({ cn: '570020', motivos: ['CANTIDAD_SUPERIOR'] })]);
    });

    it('se prefiere el cambio de formato al de concentración', () => {
      const env5 = { medicamento: P500, presentacion: pres({ cn: '570005', nregistro: '1000 ESP', contenido: '5' }) };
      const r = decidir({
        candidatos: [cand(p250, '570250'), env5],
        stock: { '570250': [lote({ lote: 'A' })], '570005': [lote({ lote: 'B' })] },
      });
      expect(r.evidencias.alternativaFormato?.cn).toBe('570005');
    });

    it('ALLOW_PACK_SIZE_CHANGE=false → no se propone otro formato', () => {
      const r = decidir({
        candidatos: [cand(p250, '570250')],
        stock: { '570250': [lote({ lote: 'L250' })] },
        config: { allowPackSizeChange: false, modoSustitucion: 'POST' },
      });
      expect(r.decision).toBe('PEDIR');
    });

    it('menor concentración de otro laboratorio → se trata como sustitución con aprobación previa', () => {
      const otroLab = amoxicilina(250, { nregistro: '4250 ESP', labtitular: 'LABORATORIO C' });
      const r = decidir({ candidatos: [cand(otroLab, '590250')], stock: { '590250': [lote({ lote: 'X' })] } });
      expect(r.decision).toBe('SUSTITUIR');
      expect(r.evidencias.sustitutos[0]).toMatchObject({ origen: 'MENOR_CONCENTRACION_OTRO_LABORATORIO', modo: 'PRE', envases: 2 });
    });
  });

  describe('sustitución (§4.4)', () => {
    it('sin stock, prescripción excepcional → PEDIR sin evaluar equivalentes', () => {
      const r = decidir({
        ctx: { especieId: ESPECIE.PERROS, especieProduccion: false, clase: 'excepcional', indicacion: 'x', viaPrescritaId: null, duracionDias: null },
        candidatos: [cand(generico(), '580001')],
        stock: { '580001': [lote({ lote: 'G1' })] },
      });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.sustitucionBloqueada).toEqual(['SUSTITUCION_PROHIBIDA_EXCEPCIONAL']);
      expect(r.evidencias.sustitutos).toEqual([]);
      expect(r.evidencias.descartados).toEqual([]);
      expect(r.evidencias.pedido?.equivalentes).toEqual([]);
    });

    it('sin stock, clase no indicada → PEDIR (se bloquea la sustitución)', () => {
      const r = decidir({
        ctx: { especieId: ESPECIE.PERROS, especieProduccion: false, clase: null, indicacion: 'x', viaPrescritaId: null, duracionDias: null },
      });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.sustitucionBloqueada).toEqual(['SUSTITUCION_PROHIBIDA_CLASE_NO_INDICADA']);
    });

    it.each`
      descripcion                  | prescrito                             | exclusiones                                                            | motivo
      ${'inmunológico'}            | ${{ inmunologico: true }}             | ${[]}                                                                  | ${'SUSTITUCION_PROHIBIDA_INMUNOLOGICO'}
      ${'biológico'}               | ${{ biologico: true }}                | ${[]}                                                                  | ${'SUSTITUCION_PROHIBIDA_BIOLOGICO'}
      ${'excluido por nregistro'}  | ${{}}                                 | ${[{ nregistro: '1000 ESP', pa_id: null, motivo: 'm', fuente: 'f' }]}  | ${'SUSTITUCION_PROHIBIDA_EXCLUSION'}
      ${'excluido por PA'}         | ${{}}                                 | ${[{ nregistro: null, pa_id: 161, motivo: 'm', fuente: 'f' }]}         | ${'SUSTITUCION_PROHIBIDA_EXCLUSION'}
    `('sin stock, $descripcion → PEDIR', ({ prescrito, exclusiones, motivo }) => {
      const r = decidir({
        prescrito: { medicamento: amoxicilina(500, prescrito), presentacion: PRES500, envases: 1 },
        exclusiones,
        candidatos: [cand(generico(), '580001')],
        stock: { '580001': [lote({ lote: 'G1' })] },
      });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.sustitucionBloqueada).toEqual([motivo]);
    });

    it('sin stock, equivalente (composición, forma, vía, especie e indicación) con stock → SUSTITUIR', () => {
      const r = decidir({ candidatos: [cand(generico(), '580001')], stock: { '580001': [lote({ lote: 'G1', caducidad: '2027-05-31' })] } });
      expect(r.decision).toBe('SUSTITUIR');
      expect(r.evidencias.sustitutos[0]).toMatchObject({ cn: '580001', origen: 'EQUIVALENTE', modo: 'POST', caducidadFefo: '2027-05-31' });
      expect(r.evidencias.sustitutos[0]?.equivalencia.indicacion).toBe('COINCIDE');
      expect(r.motivos.map((m) => m.code)).toEqual(['SUSTITUCION']);
    });

    it('equivalentes ordenados: caducidad FEFO más lejana y después menor precio de coste', () => {
      const r = decidir({
        candidatos: [
          cand(generico({ nregistro: 'G-A' }), '580001', { precioCoste: '9.0000' }),
          cand(generico({ nregistro: 'G-B' }), '580002', { precioCoste: '5.0000' }),
          cand(generico({ nregistro: 'G-C' }), '580003', { precioCoste: '1.0000' }),
          cand(generico({ nregistro: 'G-D' }), '580004'),
        ],
        stock: {
          '580001': [lote({ lote: 'A', caducidad: '2028-01-31' })],
          '580002': [lote({ lote: 'B', caducidad: '2028-01-31' })],
          '580003': [lote({ lote: 'C', caducidad: '2027-01-31' })],
          '580004': [lote({ lote: 'D', caducidad: '2028-01-31' })],
        },
      });
      expect(r.evidencias.sustitutos.map((s) => s.cn)).toEqual(['580002', '580001', '580004', '580003']);
    });

    it('lotes sin caducidad van detrás en el orden de sustitutos', () => {
      const r = decidir({
        candidatos: [cand(generico({ nregistro: 'G-A' }), '580001'), cand(generico({ nregistro: 'G-B' }), '580002')],
        stock: { '580001': [lote({ lote: 'A', caducidad: null })], '580002': [lote({ lote: 'B', caducidad: '2027-01-31' })] },
      });
      expect(r.evidencias.sustitutos.map((s) => s.cn)).toEqual(['580002', '580001']);
    });

    it.each`
      descripcion                       | cambio                                                                                                                   | motivo
      ${'distinta concentración'}       | ${{ composicion: { pas: [{ paId: 161, nombre: 'AMOXICILINA', cantidad: '600', unidad: 'mg' }], porCantidad: '1', porUnidad: 'Comprimido' } }} | ${'CONCENTRACION_DISTINTA'}
      ${'distinta forma'}               | ${{ formaId: 99 }}                                                                                                       | ${'FORMA_DISTINTA'}
      ${'distinta especie'}             | ${{ especieIds: [ESPECIE.GATOS] }}                                                                                       | ${'ESPECIE_NO_AUTORIZADA'}
      ${'distinta vía'}                 | ${{ viaIds: [41] }}                                                                                                      | ${'VIA_NO_AUTORIZADA'}
      ${'distinta indicación'}          | ${{ indicaciones: [{ especieId: null, texto: 'Mastitis clínica en vacas' }] }}                                          | ${'INDICACION_NO_COINCIDE'}
      ${'distinta composición'}         | ${{ composicion: { pas: [{ paId: 999, nombre: 'X', cantidad: '500', unidad: 'mg' }], porCantidad: '1', porUnidad: 'Comprimido' } }} | ${'COMPOSICION_DISTINTA'}
      ${'no comercializado'}            | ${{ comerc: false }}                                                                                                     | ${'NO_COMERCIALIZADO'}
      ${'suspendido'}                   | ${{ estado: 'suspendido' }}                                                                                              | ${'NO_AUTORIZADO'}
    `('equivalente con $descripcion → descartado con motivo', ({ cambio, motivo }) => {
      const r = decidir({ candidatos: [cand(generico(cambio), '580001')], stock: { '580001': [lote({ lote: 'G1' })] } });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.descartados[0]?.motivos).toContain(motivo);
    });

    it('nunca se sustituye por un medicamento de uso humano', () => {
      const r = decidir({ candidatos: [cand(generico({ usoHumano: true }), '580001')], stock: { '580001': [lote({ lote: 'G1' })] } });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.descartados).toEqual([expect.objectContaining({ motivos: ['USO_HUMANO'] })]);
    });

    it('especie productora: equivalente con tiempo de espera mayor → descartado', () => {
      const prescrito = amoxicilina(500, {
        especieIds: [ESPECIE.BOVINO],
        tiemposEspera: [{ especieId: ESPECIE.BOVINO, tejido: 'Carne', dias: 10, noAplica: false }],
      });
      const sustituto = generico({ especieIds: [ESPECIE.BOVINO], tiemposEspera: [{ especieId: ESPECIE.BOVINO, tejido: 'Carne', dias: 14, noAplica: false }] });
      const r = decidir({
        prescrito: { medicamento: prescrito, presentacion: PRES500, envases: 1 },
        ctx: { especieId: ESPECIE.BOVINO, especieProduccion: true, clase: 'ordinaria', indicacion: 'Infecciones de la piel', viaPrescritaId: null, duracionDias: null },
        candidatos: [cand(sustituto, '580001')],
        stock: { '580001': [lote({ lote: 'G1' })] },
      });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.descartados[0]?.motivos).toContain('TIEMPO_ESPERA_SUPERIOR');
    });

    it('indicación PROBABLE → se propone con aprobación previa del garante (modo PRE)', () => {
      const r = decidir({
        ctx: { especieId: ESPECIE.PERROS, especieProduccion: false, clase: 'ordinaria', indicacion: 'Infecciones de piel y otitis externa', viaPrescritaId: null, duracionDias: null },
        candidatos: [cand(generico(), '580001')],
        stock: { '580001': [lote({ lote: 'G1' })] },
      });
      expect(r.decision).toBe('SUSTITUIR');
      expect(r.evidencias.sustitutos[0]?.equivalencia.indicacion).toBe('PROBABLE');
      expect(r.evidencias.sustitutos[0]?.modo).toBe('PRE');
    });

    it('cantidades no normalizables → "revisar manualmente", no se propone solo', () => {
      const raro = generico({ composicion: { pas: [{ paId: 161, nombre: 'AMOXICILINA', cantidad: '500', unidad: 'mg' }], porCantidad: '1', porUnidad: 'Unidad rara' } });
      const r = decidir({ candidatos: [cand(raro, '580001')], stock: { '580001': [lote({ lote: 'G1' })] } });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.revisarManual).toEqual([expect.objectContaining({ cn: '580001' })]);
    });

    it('equivalentes sin stock → PEDIR con la lista de equivalentes', () => {
      const r = decidir({ candidatos: [cand(generico(), '580001')], stock: {} });
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.pedido?.equivalentes.map((e) => e.cn)).toEqual(['580001']);
      expect(r.evidencias.pedido?.cn).toBe('570016');
    });

    it('sin equivalentes → PEDIR el prescrito', () => {
      const r = decidir();
      expect(r.decision).toBe('PEDIR');
      expect(r.evidencias.pedido).toMatchObject({ cn: '570016', equivalentes: [] });
    });
  });

  it('resumen de la receta = peor estado de sus líneas', () => {
    expect(resumenReceta(['DISPENSAR', 'PEDIR', 'DISPENSAR_CON_AVISO'])).toBe('PEDIR');
    expect(resumenReceta(['DISPENSAR', 'NO_CONFORME'])).toBe('NO_CONFORME');
    expect(resumenReceta([])).toBeNull();
  });

  it('el aviso de stock ilimitado del adaptador acompaña a la decisión', () => {
    const r = decidir({ avisosStock: [incidencia('STOCK_ILIMITADO_CONFIGURACION', POL, { params: { sku: 'X' } })], stock: { '570016': [lote({ lote: 'L' })] } });
    expect(r.motivos.map((m) => m.code)).toEqual(['STOCK_ILIMITADO_CONFIGURACION']);
  });

  it('el prescrito ya incluido entre los candidatos no se trata como sustituto', () => {
    const r = decidir({ candidatos: [{ medicamento: P500, presentacion: pres({ cn: '570099', nregistro: '1000 ESP', contenido: '100' }) }], stock: {} });
    expect(r.decision).toBe('PEDIR');
    expect(r.evidencias.sustitutos).toEqual([]);
  });

  it('no se pone el psicótropo como evidencia si no lo es', () => {
    expect(decidir().evidencias.psicotropo).toBe(false);
    expect(decidir({ prescrito: { medicamento: med({ psicotropo: true }), presentacion: PRES500, envases: 1 } }).evidencias.psicotropo).toBe(true);
  });
});
