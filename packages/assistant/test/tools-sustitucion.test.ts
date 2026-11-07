import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CimavetRepository } from '@mmx/cimavet';
import { fixedClock, type MedicamentoInfo, type PresentacionInfo } from '@mmx/domain';
import type { RulesBundle } from '@mmx/shared';
import { loadRules } from '@mmx/shared/node';
import { herramientaConsultarStock } from '../src/tools/stock';
import { herramientaBuscarSustitutos } from '../src/tools/sustitucion';
import { herramientaSimularEquivalencia } from '../src/tools/simulaciones-medicamento';
import type { DepsHerramientas, StockPortAsistente } from '../src/tools/contexto';

const ROOT = resolve(__dirname, '../../..');
const RULES: RulesBundle = loadRules(resolve(ROOT, 'config/rules')).bundle;

interface DatosSustitucion {
  encontrado?: boolean;
  prescrito?: {
    nregistro: string;
    nombre: string;
    stockDisponible: number | null;
    tieneStock: boolean;
  };
  sustitucionPermitida?: boolean;
  motivosBloqueo?: string[];
  requiereAclaracionIndicacion?: boolean;
  candidatosConStock?: Array<{ cn: string; nregistro: string; stockDisponible: number; tieneStock: boolean }>;
  candidatosSinStock?: Array<{ cn: string; nregistro: string; stockDisponible: number; tieneStock: boolean }>;
  obligacionesDispensador?: string[];
  aviso?: string;
}

const createMockCimavet = (): CimavetRepository => {
  const meds = new Map<string, MedicamentoInfo & { fetchedAt: Date }>();
  const presentaciones = new Map<string, Array<PresentacionInfo & { fetchedAt: Date }>>();

  // Medicamento prescrito ordinario
  meds.set('3313 ESP', {
    nregistro: '3313 ESP',
    nombre: 'Prednicortone 5 mg comprimidos',
    labtitular: 'Dechra',
    receta: true,
    antibiotico: false,
    estupefaciente: false,
    psicotropo: false,
    inmunologico: false,
    biologico: false,
    usoHumano: false,
    formaId: 10,
    viaIds: [54, 1],
    especieIds: [14, 1], // Perro
    atc: ['QH02AB06'],
    indicaciones: [
      { especieId: 14, texto: 'Tratamiento de afecciones inflamatorias y alergicas' },
      { especieId: 1, texto: 'Tratamiento antiinflamatorio' },
    ],
    tiemposEspera: [],
    estado: 'autorizado',
    comerc: true,
    psum: false,
    notas: false,
    composicion: {
      pas: [{ paId: 101, nombre: 'Prednisolona', cantidad: '5', unidad: 'mg' }],
      porCantidad: '1',
      porUnidad: 'Comprimido',
    },
    fetchedAt: new Date('2026-10-01T00:00:00Z'),
  });

  presentaciones.set('3313 ESP', [
    {
      cn: '584958',
      nregistro: '3313 ESP',
      nombre: 'Prednicortone 5 mg 30 comprimidos',
      comerc: true,
      estado: 'autorizado',
      contenido: '30',
      unidadContenido: 'comprimidos',
      fetchedAt: new Date('2026-10-01T00:00:00Z'),
    },
    {
      cn: '570001',
      nregistro: '3313 ESP',
      nombre: 'Prednicortone 5 mg 30 comprimidos',
      comerc: true,
      estado: 'autorizado',
      contenido: '30',
      unidadContenido: 'comprimidos',
      fetchedAt: new Date('2026-10-01T00:00:00Z'),
    },
  ]);

  // Hedylon 5 mg 30 comp (Prescrito)
  meds.set('3738 ESP', {
    nregistro: '3738 ESP',
    nombre: 'HEDYLON 5 MG 30 COMP',
    labtitular: 'Livisto',
    receta: true,
    antibiotico: false,
    estupefaciente: false,
    psicotropo: false,
    inmunologico: false,
    biologico: false,
    usoHumano: false,
    formaId: 10,
    viaIds: [54],
    especieIds: [14],
    atc: ['QH02AB06'],
    indicaciones: [
      {
        especieId: 14,
        texto: 'Tratamiento coadyuvante en enfermedades inflamatorias e inmunomediadas',
      },
    ],
    tiemposEspera: [],
    estado: 'autorizado',
    comerc: true,
    psum: false,
    notas: false,
    composicion: {
      pas: [{ paId: 101, nombre: 'Prednisolona', cantidad: '5', unidad: 'mg' }],
      porCantidad: '1',
      porUnidad: 'Comprimido',
    },
    fetchedAt: new Date('2026-10-01T00:00:00Z'),
  });

  presentaciones.set('3738 ESP', [
    {
      cn: '580001',
      nregistro: '3738 ESP',
      nombre: 'HEDYLON 5 MG 30 COMP',
      comerc: true,
      estado: 'autorizado',
      contenido: '30',
      unidadContenido: 'comprimidos',
      fetchedAt: new Date('2026-10-01T00:00:00Z'),
    },
  ]);

  // Sustituto equivalente 1 (Con stock)
  meds.set('4414 ESP', {
    nregistro: '4414 ESP',
    nombre: 'Prednisolona Vet 5 mg',
    labtitular: 'Lab A',
    receta: true,
    antibiotico: false,
    estupefaciente: false,
    psicotropo: false,
    inmunologico: false,
    biologico: false,
    usoHumano: false,
    formaId: 10,
    viaIds: [54, 1],
    especieIds: [14, 1],
    atc: ['QH02AB06'],
    indicaciones: [
      { especieId: 14, texto: 'Tratamiento antiinflamatorio' },
      { especieId: 1, texto: 'Tratamiento antiinflamatorio' },
    ],
    tiemposEspera: [],
    estado: 'autorizado',
    comerc: true,
    psum: false,
    notas: false,
    composicion: {
      pas: [{ paId: 101, nombre: 'Prednisolona', cantidad: '5', unidad: 'mg' }],
      porCantidad: '1',
      porUnidad: 'Comprimido',
    },
    fetchedAt: new Date('2026-10-01T00:00:00Z'),
  });

  presentaciones.set('4414 ESP', [
    {
      cn: '570002',
      nregistro: '4414 ESP',
      nombre: 'Prednisolona Vet 5 mg 30 comp',
      comerc: true,
      estado: 'autorizado',
      contenido: '30',
      unidadContenido: 'comprimidos',
      fetchedAt: new Date('2026-10-01T00:00:00Z'),
    },
  ]);

  // Sustituto equivalente 2 (Sin stock)
  meds.set('5515 ESP', {
    nregistro: '5515 ESP',
    nombre: 'Cortipet 5 mg',
    labtitular: 'Lab B',
    receta: true,
    antibiotico: false,
    estupefaciente: false,
    psicotropo: false,
    inmunologico: false,
    biologico: false,
    usoHumano: false,
    formaId: 10,
    viaIds: [54, 1],
    especieIds: [14, 1],
    atc: ['QH02AB06'],
    indicaciones: [
      { especieId: 14, texto: 'Tratamiento antiinflamatorio' },
      { especieId: 1, texto: 'Tratamiento antiinflamatorio' },
    ],
    tiemposEspera: [],
    estado: 'autorizado',
    comerc: true,
    psum: false,
    notas: false,
    composicion: {
      pas: [{ paId: 101, nombre: 'Prednisolona', cantidad: '5', unidad: 'mg' }],
      porCantidad: '1',
      porUnidad: 'Comprimido',
    },
    fetchedAt: new Date('2026-10-01T00:00:00Z'),
  });

  presentaciones.set('5515 ESP', [
    {
      cn: '570003',
      nregistro: '5515 ESP',
      nombre: 'Cortipet 5 mg 30 comp',
      comerc: true,
      estado: 'autorizado',
      contenido: '30',
      unidadContenido: 'comprimidos',
      fetchedAt: new Date('2026-10-01T00:00:00Z'),
    },
  ]);

  // Vacuna no sustituible
  meds.set('VACUNA ESP', {
    nregistro: 'VACUNA ESP',
    nombre: 'Vacuna Canina Eurican',
    labtitular: 'Boehringer',
    receta: true,
    antibiotico: false,
    estupefaciente: false,
    psicotropo: false,
    inmunologico: true,
    biologico: true,
    usoHumano: false,
    formaId: 20,
    viaIds: [2],
    especieIds: [1],
    atc: ['QI07AA01'],
    indicaciones: [{ especieId: 1, texto: 'Inmunización' }],
    tiemposEspera: [],
    estado: 'autorizado',
    comerc: true,
    psum: false,
    notas: false,
    composicion: {
      pas: [{ paId: 900, nombre: 'Antígeno', cantidad: '1', unidad: 'dosis' }],
      porCantidad: '1',
      porUnidad: 'dosis',
    },
    fetchedAt: new Date('2026-10-01T00:00:00Z'),
  });

  return {
    especiePorTexto: async (texto: string | null) => (texto?.toLowerCase().includes('perro') ? 14 : null),
    medicamento: async (nreg: string) => meds.get(nreg) ?? null,
    medicamentos: async (nregs: string[]) => {
      const map = new Map();
      for (const n of nregs) {
        if (meds.has(n)) map.set(n, meds.get(n));
      }
      return map;
    },
    presentacionesDe: async (nregs: string[]) => {
      const list: Array<PresentacionInfo & { fetchedAt: Date }> = [];
      for (const n of nregs) {
        const found = presentaciones.get(n);
        if (found) list.push(...found);
      }
      return list;
    },
    buscar: async (texto: string) => {
      const results: Array<{
        nregistro: string;
        cn: string;
        nombre: string;
        medicamento: string;
        labtitular: string | null;
        puntuacion: number;
      }> = [];
      for (const m of meds.values()) {
        if (m.nombre.toLowerCase().includes(texto.toLowerCase())) {
          results.push({
            nregistro: m.nregistro,
            cn: '570001',
            nombre: m.nombre,
            medicamento: m.nombre,
            labtitular: m.labtitular,
            puntuacion: 1,
          });
        }
      }
      return results as never;
    },
    nregistrosMismosPa: async (nreg: string) => {
      if (['3738 ESP', '3313 ESP', '4414 ESP', '5515 ESP'].includes(nreg)) {
        return ['3738 ESP', '3313 ESP', '4414 ESP', '5515 ESP'];
      }
      if (nreg === 'VACUNA ESP') return ['VACUNA ESP'];
      return [];
    },
    nombresFicha: async () => ({
      especies: new Map([
        [14, 'Perros'],
        [1, 'Perros'],
      ]),
      formas: new Map([[10, 'Comprimido']]),
      vias: new Map([
        [54, 'VÍA ORAL'],
        [1, 'Oral'],
      ]),
    }),
  } as unknown as CimavetRepository;
};

const createMockStockPort = (stockMap: Record<string, number>): StockPortAsistente => ({
  async lotes(cn: string) {
    const unidades = stockMap[cn] ?? 0;
    if (unidades === 0 && stockMap[cn] === undefined) {
      return { estado: 'OK', lotes: [] };
    }
    return {
      estado: 'OK',
      lotes: [
        {
          lote: 'L01',
          disponible: unidades,
          caducidad: '2028-01-01',
          variantId: 1,
          creadoAt: null,
          ubicacion: null,
        },
      ],
    };
  },
});

describe('herramientaConsultarStock', () => {
  it('devuelve las existencias de los CNs consultados', async () => {
    const stockPort = createMockStockPort({ '570001': 5, '570002': 0 });
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: stockPort,
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaConsultarStock(deps);
    const res = await tool.ejecutar({ cns: ['570001', '570002'] }, { contexto: { tipo: 'general' } });

    expect(res.datos).toMatchObject({
      items: [
        { cn: '570001', stockDisponible: 5, tieneStock: true, estado: 'OK' },
        { cn: '570002', stockDisponible: 0, tieneStock: false, estado: 'OK' },
      ],
    });
  });

  it('avisa si no hay puerto de stock configurado', async () => {
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: null,
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaConsultarStock(deps);
    const res = await tool.ejecutar({ cns: ['570001'] }, { contexto: { tipo: 'general' } });

    expect((res.datos as { aviso?: string }).aviso).toContain('inventario no está disponible');
  });
});

describe('herramientaBuscarSustitutos', () => {
  it('encuentra equivalentes y discrimina entre con stock y sin stock (US1 & US2)', async () => {
    // Prescrito (570001) sin stock, Candidato 1 (570002) tiene 4 uds, Candidato 2 (570003) tiene 0
    const stockPort = createMockStockPort({ '570001': 0, '570002': 4, '570003': 0 });
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: stockPort,
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaBuscarSustitutos(deps);
    const res = await tool.ejecutar(
      { nombre: 'prednicortone', especie: 'perro' },
      { contexto: { tipo: 'general' } },
    );

    const d = res.datos as DatosSustitucion;
    expect(d.sustitucionPermitida).toBe(true);
    expect(d.prescrito?.nregistro).toBe('3313 ESP');
    expect(d.prescrito?.stockDisponible).toBe(0);
    expect(d.prescrito?.tieneStock).toBe(false);

    // Candidatos con stock
    expect(d.candidatosConStock).toHaveLength(1);
    expect(d.candidatosConStock?.[0]).toMatchObject({
      cn: '570002',
      nregistro: '4414 ESP',
      stockDisponible: 4,
      tieneStock: true,
    });

    // Candidatos sin stock
    expect(d.candidatosSinStock).toHaveLength(1);
    expect(d.candidatosSinStock?.[0]).toMatchObject({
      cn: '570003',
      nregistro: '5515 ESP',
      stockDisponible: 0,
      tieneStock: false,
    });

    // Deberes normativos incluidos
    expect(d.obligacionesDispensador).toHaveLength(3);
  });

  it('advierte si el medicamento prescrito SI tiene stock en farmacia', async () => {
    // Prescrito tiene 3 uds
    const stockPort = createMockStockPort({ '570001': 3, '570002': 10 });
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: stockPort,
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaBuscarSustitutos(deps);
    const res = await tool.ejecutar(
      { nregistro: '3313 ESP', especie: 'perro' },
      { contexto: { tipo: 'general' } },
    );

    const d = res.datos as DatosSustitucion;
    expect(d.prescrito?.tieneStock).toBe(true);
    expect(d.aviso).toContain('El medicamento prescrito sí dispone de existencias');
  });

  it('bloquea la sustitucion si el medicamento es inmunológico / vacuna (US4)', async () => {
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: createMockStockPort({}),
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaBuscarSustitutos(deps);
    const res = await tool.ejecutar(
      { nregistro: 'VACUNA ESP', especie: 'perro' },
      { contexto: { tipo: 'general' } },
    );

    const d = res.datos as DatosSustitucion;
    expect(d.sustitucionPermitida).toBe(false);
    expect(d.motivosBloqueo?.join(' ')).toContain('inmunológico');
    expect(d.aviso).toContain('PEDIR');
    expect(d.candidatosConStock).toEqual([]);
  });

  it('orienta a PEDIR si ningun equivalente tiene stock en tienda (US3)', async () => {
    const stockPort = createMockStockPort({ '570001': 0, '570002': 0, '570003': 0 });
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: stockPort,
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaBuscarSustitutos(deps);
    const res = await tool.ejecutar(
      { nregistro: '3313 ESP', especie: 'perro' },
      { contexto: { tipo: 'general' } },
    );

    const d = res.datos as DatosSustitucion;
    expect(d.candidatosConStock).toHaveLength(0);
    expect(d.candidatosSinStock).toHaveLength(2);
    expect(d.aviso).toContain('PEDIR');
  });

  it('informa si la especie no es identificada', async () => {
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: null,
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaBuscarSustitutos(deps);
    const res = await tool.ejecutar(
      { nombre: 'prednicortone', especie: 'dragón' },
      { contexto: { tipo: 'general' } },
    );

    const d = res.datos as DatosSustitucion;
    expect(d.encontrado).toBe(false);
    expect(d.aviso).toContain('No se reconoce la especie');
  });

  it('propone Prednicortone 5 mg para sustituir a Hedylon 5 mg con stock y activa requiereAclaracionIndicacion (US1, FR-013, FR-014, FR-015)', async () => {
    // Hedylon 5 mg (580001) tiene 0 stock; Prednicortone (584958) tiene 7 unidades
    const stockPort = createMockStockPort({ '580001': 0, '584958': 7, '570001': 0, '570002': 0, '570003': 0 });
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: stockPort,
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaBuscarSustitutos(deps);
    const res = await tool.ejecutar(
      { nombre: 'HEDYLON 5 MG 30 COMP', especie: 'perro' },
      { contexto: { tipo: 'general' } },
    );

    const d = res.datos as DatosSustitucion;
    expect(d.encontrado).not.toBe(false);
    expect(d.sustitucionPermitida).toBe(true);
    expect(d.prescrito?.nregistro).toBe('3738 ESP');
    expect(d.prescrito?.tieneStock).toBe(false);
    // Debe marcar que requiere aclaración de indicación clínica al dispensador
    expect(d.requiereAclaracionIndicacion).toBe(true);
    // Debe devolver a Prednicortone con 7 unidades de stock sin bloquearlo por vía ni especie
    expect(d.candidatosConStock).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nregistro: '3313 ESP',
          cn: '584958',
          stockDisponible: 7,
          tieneStock: true,
        }),
      ]),
    );
  });

  it('simular_equivalencia enriquece evidencias.comparativa con nombres legibles resueltos de CIMAVet (US5, FR-016)', async () => {
    const deps: DepsHerramientas = {
      rules: RULES,
      clock: fixedClock('2026-10-14T10:00:00Z'),
      indice: null,
      cimavet: createMockCimavet(),
      stock: null,
      permitirCambioFormato: true,
      maxEdadCimavetH: 24,
    };

    const tool = herramientaSimularEquivalencia(deps);
    const res = await tool.ejecutar(
      {
        prescrito: { nregistro: '3738 ESP' },
        candidato: { nregistro: '3313 ESP' },
        especie: 'perro',
        indicacion: 'Tratamiento de afecciones inflamatorias y alergicas',
      },
      { contexto: { tipo: 'general' } },
    );

    expect(res.simulacion).toBeDefined();
    expect(res.simulacion?.decision).toBe('EQUIVALENTE');
    const comp = (res.simulacion?.evidencias as Record<string, unknown>)['comparativa'] as Array<{
      criterio: string;
      prescrito: string;
      candidato: string;
      coincide: boolean;
      detalle?: string;
    }>;

    expect(Array.isArray(comp)).toBe(true);
    expect(comp).toHaveLength(7);
    const formaRow = comp.find((c) => c.criterio === 'Forma farmacéutica');
    expect(formaRow?.prescrito).toBe('Comprimido');
    expect(formaRow?.candidato).toBe('Comprimido');
    expect(formaRow?.coincide).toBe(true);

    const viaRow = comp.find((c) => c.criterio === 'Vía de administración');
    expect(viaRow?.prescrito).toBe('VÍA ORAL');
    expect(viaRow?.coincide).toBe(true);

    const especieRow = comp.find((c) => c.criterio === 'Especie de destino');
    expect(especieRow?.prescrito).toBe('Perros');
    expect(especieRow?.coincide).toBe(true);

    const indRow = comp.find((c) => c.criterio === 'Indicación');
    expect(indRow?.prescrito).toBe('Tratamiento de afecciones inflamatorias y alergicas');
    expect(indRow?.coincide).toBe(true);
  });
});
