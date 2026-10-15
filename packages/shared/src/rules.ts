import { z } from 'zod';
import { CodigoIncidencia } from './codes';
import { Severidad } from './enums';

/**
 * Esquemas de los ficheros de reglas `config/rules/*.yaml` (SPEC §4.1, §4.4, §4.10).
 * Las reglas legales viven como datos; el dominio solo las interpreta.
 */

const SeveridadCampo = z.enum(['AVISO', 'BLOQUEANTE_FORMA', 'BLOQUEANTE_DURO', 'NO_APLICA', 'OPCIONAL']);
export type SeveridadCampo = z.infer<typeof SeveridadCampo>;

const ReglaCampo = z.object({
  codigo: CodigoIncidencia,
  compania: SeveridadCampo,
  produccion: SeveridadCampo,
  /** Severidad en compañía cuando la especie tiene identificación individual obligatoria. */
  compania_id_individual: SeveridadCampo.optional(),
  /** Solo se exige si la línea contiene un antimicrobiano. */
  solo_si_antimicrobiano: z.boolean().optional(),
  nota: z.string().optional(),
});
export type ReglaCampo = z.infer<typeof ReglaCampo>;

export const CAMPOS_RECETA = [
  'numero_receta',
  'tipo_dispensacion',
  'titular_nombre',
  'titular_telefono',
  'rega',
  'especie',
  'animal_identificacion',
  'num_animales',
  'fecha_emision',
  'veterinario_nombre',
  'veterinario_telefono',
  'veterinario_email',
  'num_colegiado',
  'firma',
  'medicamento_nombre',
  'principio_activo',
  'clase_prescripcion',
  'indicacion',
  'declaracion_antimicrobiano',
  'forma_concentracion',
  'cantidad',
  'posologia',
  'tiempo_espera',
  'plazo_validez',
  'advertencias',
] as const;
export type CampoReceta = (typeof CAMPOS_RECETA)[number];

export const RecetaCamposRulesSchema = z.object({
  version: z.string(),
  campos: z.record(z.enum(CAMPOS_RECETA), ReglaCampo).refine(
    (c) => CAMPOS_RECETA.every((k) => k in c),
    { message: 'Faltan campos en receta-campos: deben estar todos los de SPEC §4.1.2' },
  ),
  /** Especies (id de la maestra de CIMAVet) con identificación individual obligatoria. */
  especies_id_individual: z.array(z.number().int()),
  /** Prefijos ATC que identifican un antimicrobiano (además de antibiotico=true). */
  antimicrobianos_atc_prefijos: z.array(z.string()),
  /** Prefijos ATC excluidos de la validez de crónico/preventivo (gases medicinales, etc.). */
  excluidos_cronico_atc_prefijos: z.array(z.string()).default([]),
  /**
   * Campos cuya presencia en la receta se puede confirmar sin transcribirlos antes de dispensar (animales de
   * compañía): se transcriben después para el registro. Los demás se comprueban siempre antes de dispensar.
   */
  diferibles_registro: z.array(z.enum(CAMPOS_RECETA)).default([]),
  /** Severidad por defecto de las incidencias no ligadas a un campo. */
  incidencias: z.partialRecord(CodigoIncidencia, Severidad),
  /** Grupo "producto no válido": forzable salvo PRODUCT_VALIDITY_HARD_BLOCK=true. */
  producto_no_valido: z.array(CodigoIncidencia),
});
export type RecetaCamposRules = z.infer<typeof RecetaCamposRulesSchema>;

const Plazo = z
  .object({ dias: z.number().int().positive().optional(), meses: z.number().int().positive().optional() })
  .refine((p) => (p.dias === undefined) !== (p.meses === undefined), { message: 'Indica dias o meses' });
export type Plazo = z.infer<typeof Plazo>;

export const ValidezRulesSchema = z.object({
  version: z.string(),
  general: Plazo,
  antimicrobiano: Plazo,
  cronico_no_productora: Plazo,
  /** Producción: crónico/periódico recogido en el plan sanitario de la explotación o pautado por el veterinario de la ADS. */
  cronico_plan_sanitario: Plazo,
  preventivo_no_productora: Plazo,
  estupefaciente: Plazo,
  psicotropo: Plazo,
});
export type ValidezRules = z.infer<typeof ValidezRulesSchema>;

export const SustitucionExclusionesSchema = z.object({
  version: z.string(),
  exclusiones: z.array(
    z
      .object({
        nregistro: z.string().nullable().default(null),
        pa_id: z.number().int().nullable().default(null),
        motivo: z.string(),
        fuente: z.string(),
      })
      .refine((e) => e.nregistro !== null || e.pa_id !== null, { message: 'nregistro o pa_id' }),
  ),
});
export type SustitucionExclusiones = z.infer<typeof SustitucionExclusionesSchema>;

export const EquivalenciaRulesSchema = z.object({
  version: z.string(),
  indicacion: z.object({
    umbral_coincide: z.number().min(0).max(1),
    umbral_probable: z.number().min(0).max(1),
    palabras_vacias: z.array(z.string()),
    sinonimos: z.array(z.array(z.string()).min(2)),
  }),
  /** Subcategoría de especie → especie base (id de la maestra de CIMAVet). */
  especie_padre: z.record(z.string(), z.number().int()).default({}),
});
export type EquivalenciaRules = z.infer<typeof EquivalenciaRulesSchema>;

export const PreciosRulesSchema = z.object({
  version: z.string(),
  iva_por_defecto_medicamento: z.number(),
  /** IVA (%) → recargo de equivalencia (%). Claves como texto: "10", "21", "4". */
  recargo_equivalencia: z.record(z.string(), z.number()),
  decimales_almacen: z.number().int().default(4),
  decimales_pantalla: z.number().int().default(2),
});
export type PreciosRules = z.infer<typeof PreciosRulesSchema>;

/** Conjunto de reglas activas, con la versión que se guarda en cada evaluación. */
export interface RulesBundle {
  /** Identificador compuesto (`fichero@hash` de cada fichero) que se guarda con cada decisión. */
  version: string;
  recetaCampos: RecetaCamposRules;
  validez: ValidezRules;
  exclusiones: SustitucionExclusiones;
  equivalencia: EquivalenciaRules;
  precios: PreciosRules;
}

export const RULE_FILES = {
  recetaCampos: { fichero: 'receta-campos.v1.yaml', schema: RecetaCamposRulesSchema },
  validez: { fichero: 'validez.v1.yaml', schema: ValidezRulesSchema },
  exclusiones: { fichero: 'sustitucion-exclusiones.v1.yaml', schema: SustitucionExclusionesSchema },
  equivalencia: { fichero: 'equivalencia.v1.yaml', schema: EquivalenciaRulesSchema },
  precios: { fichero: 'precios.v1.yaml', schema: PreciosRulesSchema },
} as const;
