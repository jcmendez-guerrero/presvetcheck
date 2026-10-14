import { resolve } from 'node:path';
import { RecetaConfirmada, type RecetaConfirmadaInput, type RulesBundle } from '@mmx/shared';
import { loadRules } from '@mmx/shared/node';
import type { LoteStock, MedicamentoInfo, PresentacionInfo } from '../src/tipos';
import type { PoliticaSeveridad } from '../src/severidad';
import { fixedClock } from '../src/clock';

/** Reglas reales de config/rules (los tests validan los valores por defecto aprobados). */
export const RULES: RulesBundle = loadRules(resolve(__dirname, '../../../config/rules')).bundle;

export function politica(o: Partial<Omit<PoliticaSeveridad, 'rules'>> = {}): PoliticaSeveridad {
  return { rules: RULES.recetaCampos, productValidityHardBlock: false, psychotropicAllowForce: false, ...o };
}

/** 14/10/2026 a las 12:00 en Madrid. */
export const HOY = '2026-10-14';
export const CLOCK = fixedClock('2026-10-14T10:00:00Z');

export const ESPECIE = { PERROS: 14, GATOS: 15, BOVINO: 1, PORCINO: 7, PERROS_GRANDES: 326 };
export const FORMA = { COMPRIMIDO: 40, SUSPENSION_INYECTABLE: 12 };
export const VIA = { ORAL: 54, INTRAMUSCULAR: 41 };
export const PA = { AMOXICILINA: 161, CLAVULANICO: 5419, MELOXICAM: 900 };

export function med(o: Partial<MedicamentoInfo> = {}): MedicamentoInfo {
  return {
    nregistro: '1000 ESP',
    nombre: 'AMOXIVET 500 mg COMPRIMIDOS',
    labtitular: 'LABORATORIO A',
    receta: true,
    antibiotico: true,
    estupefaciente: false,
    psicotropo: false,
    inmunologico: false,
    biologico: false,
    usoHumano: false,
    formaId: FORMA.COMPRIMIDO,
    viaIds: [VIA.ORAL],
    especieIds: [ESPECIE.PERROS, ESPECIE.GATOS],
    atc: ['QJ01CA04'],
    indicaciones: [{ especieId: null, texto: 'Infecciones de la piel causadas por bacterias sensibles a la amoxicilina' }],
    tiemposEspera: [],
    estado: 'autorizado',
    comerc: true,
    psum: false,
    notas: false,
    composicion: {
      pas: [{ paId: PA.AMOXICILINA, nombre: 'AMOXICILINA', cantidad: '500', unidad: 'mg' }],
      porCantidad: '1',
      porUnidad: 'Comprimido',
    },
    ...o,
  };
}

/** Medicamento no antimicrobiano (meloxicam) para los casos de validez general. */
export function medNoAntibiotico(o: Partial<MedicamentoInfo> = {}): MedicamentoInfo {
  return med({
    nregistro: '2000 ESP',
    nombre: 'MELOXIVET 1 mg COMPRIMIDOS',
    antibiotico: false,
    atc: ['QM01AC06'],
    indicaciones: [{ especieId: null, texto: 'Alivio de la inflamación y el dolor en trastornos musculoesqueléticos' }],
    composicion: { pas: [{ paId: PA.MELOXICAM, nombre: 'MELOXICAM', cantidad: '1', unidad: 'mg' }], porCantidad: '1', porUnidad: 'Comprimido' },
    ...o,
  });
}

/** Amoxicilina con otra concentración (mg/comprimido) y otro nregistro/laboratorio opcional. */
export function amoxicilina(mg: number, o: Partial<MedicamentoInfo> = {}): MedicamentoInfo {
  return med({
    nregistro: mg === 500 ? '1000 ESP' : `10${mg} ESP`,
    nombre: `AMOXIVET ${mg} mg COMPRIMIDOS`,
    composicion: { pas: [{ paId: PA.AMOXICILINA, nombre: 'AMOXICILINA', cantidad: String(mg), unidad: 'mg' }], porCantidad: '1', porUnidad: 'Comprimido' },
    ...o,
  });
}

export function pres(o: Partial<PresentacionInfo> & { cn: string; nregistro: string }): PresentacionInfo {
  return {
    nombre: `Presentación ${o.cn}`,
    comerc: true,
    estado: 'autorizado',
    contenido: '10',
    unidadContenido: 'Comprimido',
    ...o,
  };
}

export function lote(o: Partial<LoteStock> & { lote: string }): LoteStock {
  return { caducidad: '2027-06-30', disponible: 5, creadoAt: '2026-01-01T00:00:00Z', variantId: 1, ...o };
}

/** Receta de compañía completa y correcta (perro, amoxicilina 500 mg × 1 envase). */
export function receta(o: Partial<RecetaConfirmadaInput> = {}) {
  const base: RecetaConfirmadaInput = {
    tipo: 'papel',
    numero: 'R-0001',
    fechaEmision: '2026-10-12',
    tipoDispensacion: 'dispensacion',
    clasePrescripcion: 'ordinaria',
    tipoTratamiento: 'agudo',
    titular: { nombre: 'Titular de prueba', telefono: '600000000' },
    especie: { texto: 'Perro', especieId: ESPECIE.PERROS },
    especieProduccion: false,
    animalIdentificacion: '941000000000000',
    numAnimales: 1,
    veterinario: {
      nombre: 'Veterinaria de prueba',
      telefono: '910000000',
      email: 'vet@example.org',
      numColegiado: '28/1234',
      colegio: 'Madrid',
      clinica: 'Clínica de prueba',
      direccion: 'Calle de prueba 1',
    },
    firmaConfirmada: true,
    indicacion: 'Infección de piel por bacterias sensibles',
    lineas: [
      {
        orden: 1,
        medicamentoTexto: 'Amoxivet 500 mg comprimidos',
        principioActivoTexto: 'amoxicilina',
        formaTexto: 'comprimidos',
        concentracionTexto: '500 mg',
        cantidadEnvases: 1,
        formatoTexto: '10 comprimidos',
        posologia: { via: 'oral', dosis: '1 comprimido/12 h', duracionDias: 5, porcentajeEnvase: '100%' },
        tiempoEsperaTexto: 'No procede',
        declaracionAntimicrobiano: { declarada: true, finalidad: 'tratamiento' },
        nregistro: '1000 ESP',
        cn: '570016',
      },
    ],
    comprobadoConOriginal: true,
  };
  return RecetaConfirmada.parse({ ...base, ...o });
}
