import { z } from 'zod';
import { ClasePrescripcion, TipoDispensacion, TipoReceta, TipoTratamiento } from '../enums';

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');

const texto = z.string().trim().min(1).nullable().default(null);

/** Una línea de medicamento tal y como la confirma la persona (SPEC §4.1.2). */
export const RecetaLineaConfirmada = z.object({
  orden: z.number().int().positive(),
  medicamentoTexto: texto,
  principioActivoTexto: texto,
  formaTexto: texto,
  concentracionTexto: texto,
  cantidadEnvases: z.number().int().positive().nullable().default(null),
  /** Unidades de dosificación (comprimidos, pipetas…) si el veterinario las indica: dispensación fraccionada. */
  unidadesForma: z.number().int().positive().max(10000).nullable().default(null),
  formatoTexto: texto,
  posologia: z
    .object({
      via: texto,
      dosis: texto,
      duracionDias: z.number().int().positive().nullable().default(null),
      porcentajeEnvase: texto,
    })
    .nullable()
    .default(null),
  tiempoEsperaTexto: texto,
  /** Declaración art. 107.3 y 4 Reglamento (UE) 2019/6 + finalidad, si es antimicrobiano. */
  declaracionAntimicrobiano: z
    .object({
      declarada: z.boolean(),
      finalidad: z.enum(['tratamiento', 'metafilactico', 'profilactico']).nullable().default(null),
    })
    .nullable()
    .default(null),
  /** Medicamento elegido por la persona (nunca autoseleccionado, SPEC §4.2.2). */
  nregistro: z.string().nullable().default(null),
  cn: z.string().regex(/^\d{6}$/).nullable().default(null),
});
export type RecetaLineaConfirmada = z.output<typeof RecetaLineaConfirmada>;

export const RecetaConfirmada = z.object({
  tipo: TipoReceta,
  plataformaId: z.string().nullable().default(null),
  idPlataforma: z.string().nullable().default(null),
  numero: texto,
  fechaEmision: IsoDate.nullable().default(null),
  tipoDispensacion: TipoDispensacion.nullable().default(null),
  clasePrescripcion: ClasePrescripcion.nullable().default(null),
  tipoTratamiento: TipoTratamiento.nullable().default(null),
  /**
   * Receta de antimicrobianos (lo indica la receta, p. ej. "Contiene antibiótico: Sí", o lo marca quien registra).
   * Se suma a lo que dice CIMAVet: basta con que una de las dos fuentes lo indique (validez de 5 días y
   * declaración del art. 107.3 y 4 del Reglamento (UE) 2019/6).
   */
  antimicrobianos: z.boolean().default(false),
  /** Titular del animal. Dirección y DNI/NIE son opcionales; todo se guarda cifrado (SPEC §9.2). */
  titular: z
    .object({ nombre: texto, telefono: texto, direccion: texto, dni: texto })
    .default({ nombre: null, telefono: null, direccion: null, dni: null }),
  rega: texto,
  especie: z
    .object({ texto: texto, especieId: z.number().int().nullable().default(null) })
    .default({ texto: null, especieId: null }),
  especieProduccion: z.boolean().default(false),
  /**
   * Producción con tratamiento crónico/periódico: la persona que registra confirma expresamente que está
   * recogido en el plan sanitario de la explotación o lo pauta el veterinario de la ADS (validez de 3 meses).
   */
  cronicoPlanSanitario: z.boolean().default(false),
  animalIdentificacion: texto,
  numAnimales: z.number().int().positive().nullable().default(null),
  veterinario: z
    .object({
      nombre: texto,
      telefono: texto,
      email: texto,
      numColegiado: texto,
      colegio: texto,
      clinica: texto,
      direccion: texto,
    })
    .default({
      nombre: null,
      telefono: null,
      email: null,
      numColegiado: null,
      colegio: null,
      clinica: null,
      direccion: null,
    }),
  talonarioColegial: z.boolean().default(false),
  /** Papel: firma manuscrita en el original (no copia). Electrónica: registro de emisión en plataforma. */
  firmaConfirmada: z.boolean().default(false),
  indicacion: texto,
  plazoValidezDeclarado: z
    .object({ cantidad: z.number().int().positive(), unidad: z.enum(['dias', 'meses']) })
    .nullable()
    .default(null),
  advertencias: texto,
  lineas: z.array(RecetaLineaConfirmada).min(1),
  /** Casilla "He comprobado los datos con el original" (SPEC §4.1.1 punto 3). */
  comprobadoConOriginal: z.boolean().default(false),
  /**
   * Dispensación ágil: la persona confirma que la receta incluye el resto de datos obligatorios (titular,
   * veterinario, indicación, posología…) y los transcribe después de dispensar. Solo animales de compañía.
   */
  registroDiferido: z.boolean().default(false),
});
export type RecetaConfirmada = z.output<typeof RecetaConfirmada>;
export type RecetaConfirmadaInput = z.input<typeof RecetaConfirmada>;
