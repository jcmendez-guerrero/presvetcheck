import { z } from 'zod';

/** Campo extraído por IA: valor + confianza + evidencia + fuente (SPEC §4.1.1 punto 2). */
export const CampoExtraido = z.object({
  valor: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  confianza: z.number().min(0).max(1),
  evidencia: z
    .object({
      texto: z.string().nullable(),
      pagina: z.number().int().nullable(),
      /** Polígono [x1,y1,x2,y2,...] en unidades de la página, si lo da el OCR. */
      region: z.array(z.number()).nullable(),
    })
    .nullable(),
  fuente: z.enum(['ocr', 'llm', 'manual']),
});
export type CampoExtraido = z.infer<typeof CampoExtraido>;

export const CAMPOS_EXTRAIDOS_RECETA = [
  'tipo',
  'plataforma',
  'idPlataforma',
  'numero',
  'fechaEmision',
  'tipoDispensacion',
  'clasePrescripcion',
  'tipoTratamiento',
  'antimicrobianos',
  'titularNombre',
  'titularTelefono',
  'rega',
  'especie',
  'animalIdentificacion',
  'numAnimales',
  'veterinarioNombre',
  'veterinarioTelefono',
  'veterinarioEmail',
  'veterinarioNumColegiado',
  'veterinarioColegio',
  'veterinarioClinica',
  'veterinarioDireccion',
  'indicacion',
  'plazoValidez',
  'advertencias',
  'firmaDetectada',
  'selloDetectado',
  'qrDetectado',
] as const;

export const CAMPOS_EXTRAIDOS_LINEA = [
  'medicamento',
  'principioActivo',
  'forma',
  'concentracion',
  'cantidadEnvases',
  'formato',
  'via',
  'dosis',
  'duracionDias',
  'tiempoEspera',
  'declaracionAntimicrobiano',
  /** Código nacional si la receta lo trae (no es obligatorio: sin él se busca por nombre). */
  'cn',
] as const;

export const ExtractionResult = z.object({
  receta: z.record(z.enum(CAMPOS_EXTRAIDOS_RECETA), CampoExtraido),
  // Las líneas pueden traer solo parte de los campos (p. ej. sin código nacional).
  lineas: z.array(z.partialRecord(z.enum(CAMPOS_EXTRAIDOS_LINEA), CampoExtraido)),
  proveedor: z.enum(['fake', 'azure']),
  modelo: z.string(),
  promptVersion: z.string(),
  /** Texto OCR completo (solo para auditoría; nunca a logs). */
  ocrTexto: z.string().nullable().default(null),
});
export type ExtractionResult = z.output<typeof ExtractionResult>;
