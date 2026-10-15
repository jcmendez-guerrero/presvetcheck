import { z } from 'zod';
import { Canal, CodigoIncidencia, IsoDate, MetodoCaptura, PlantillaSalidas } from '@mmx/shared';

/** DTOs de la API (validación de entrada con zod; OpenAPI generado a partir de ellos). */

export const IdParam = z.object({ id: z.uuid() });

export const SolicitudForzadoDto = z.object({
  codigos: z.array(CodigoIncidencia).min(1),
  motivo: z.string().max(1000),
  aceptaRiesgos: z.boolean(),
});

export const EvaluarBody = z
  .object({
    /** Vista previa de forzados por línea (se validan igual que al dispensar). */
    forzados: z.record(z.string().regex(/^\d+$/), SolicitudForzadoDto).optional(),
  })
  .default({});

export const EnvaseDto = z.object({
  lote: z.string().trim().min(1).max(40),
  caducidad: IsoDate.nullable(),
  unidades: z.number().int().positive().max(1000).default(1),
  gtin: z.string().regex(/^\d{8,14}$/).nullable().default(null),
  cnEscaneado: z.string().regex(/^\d{6}$/).nullable().default(null),
  serie: z.string().max(40).nullable().default(null),
  metodoCaptura: MetodoCaptura,
});

const texto = z.string().trim().max(300).nullable().default(null);
export const PropietarioDto = z.object({ nombre: texto, movil: texto, direccion: texto, dni: texto });

export const DispensacionConRecetaDto = z.object({
  conReceta: z.literal(true),
  recetaId: z.uuid(),
  lineaOrden: z.number().int().positive(),
  cn: z.string().regex(/^\d{6}$/),
  envases: z.array(EnvaseDto).min(1).max(50),
  motivoLoteDistinto: z.string().max(500).nullable().default(null),
  forzado: SolicitudForzadoDto.nullable().default(null),
  sustitucionId: z.uuid().nullable().default(null),
  confirmaCambioFormato: z.boolean().default(false),
  notaEntregadaTutor: z.boolean().default(false),
  confirmaDosisNoAjustable: z.boolean().default(false),
  /** Dispensación fraccionada (solo presentaciones autorizadas): unidades de dosificación de un único envase abierto. */
  fraccion: z.object({ unidadesForma: z.number().int().positive().max(10000) }).nullable().default(null),
  /** Psicótropos: DNI/NIE de quien retira el medicamento (identidad comprobada por el empleado). */
  dniRetira: z.string().trim().max(20).nullable().default(null),
  propietario: PropietarioDto.nullable().default(null),
  pendientes: z.object({ lineas: z.array(z.number().int().positive()), contactoTutor: z.string().max(200).nullable().default(null) }).nullable().default(null),
});

export const DispensacionSinRecetaDto = z.object({
  conReceta: z.literal(false),
  canal: Canal,
  cn: z.string().regex(/^\d{6}$/),
  envases: z.array(EnvaseDto).min(1).max(50),
  motivoLoteDistinto: z.string().max(500).nullable().default(null),
  forzado: SolicitudForzadoDto.nullable().default(null),
  especie: z.string().max(100).nullable().default(null),
  propietario: PropietarioDto.nullable().default(null),
  referenciaPedido: z.string().max(100).nullable().default(null),
});

export const DispensacionDto = z.discriminatedUnion('conReceta', [DispensacionConRecetaDto, DispensacionSinRecetaDto]);

export const AnularDto = z.object({ motivo: z.string().min(10).max(1000) });

export const SustitucionCrearDto = z.object({ recetaId: z.uuid(), lineaOrden: z.number().int().positive(), cn: z.string().regex(/^\d{6}$/) });
export const SustitucionAccionParams = z.object({
  id: z.uuid(),
  accion: z.enum(['consentimiento', 'aviso-veterinario', 'autorizar', 'rechazar', 'anotacion', 'validar']),
});
export const SustitucionAccionDto = z
  .object({
    consiente: z.boolean().optional(),
    medio: z.string().max(100).optional(),
    resultado: z.string().max(500).optional(),
    urgencia: z.boolean().optional(),
    justificacion: z.string().max(1000).optional(),
    confirmaIndicacionProbable: z.boolean().optional(),
    motivo: z.string().max(1000).optional(),
  })
  .default({});

export const RecepcionDto = z.object({ distribuidorId: z.uuid(), albaran: z.string().max(60).nullable().default(null), fechaCompra: IsoDate.nullable().default(null) });
export const LineaEntradaDto = z.object({
  tipo: z.enum(['medicamento', 'producto']).default('medicamento'),
  cn: z.string().regex(/^\d{6,7}$/).nullable().default(null),
  nombre: z.string().max(300).nullable().default(null),
  lote: z.string().max(40).nullable().default(null),
  caducidad: IsoDate.nullable().default(null),
  unidades: z.number().int().positive().max(10000).default(1),
  serie: z.string().max(40).nullable().default(null),
  gtin: z.string().regex(/^\d{8,14}$/).nullable().default(null),
  cnEscaneado: z.string().regex(/^\d{6,7}$/).nullable().default(null),
  precioNetoCompra: z.string().regex(/^\d+(\.\d{1,4})?$/).nullable().default(null),
  ivaPct: z.number().nullable().default(null),
});

export const RegistrosQuery = z.object({
  desde: IsoDate,
  hasta: IsoDate,
  plantilla: PlantillaSalidas.default('A'),
  formato: z.enum(['xlsx', 'csv', 'json']).default('json'),
  incluirPropietario: z.enum(['0', '1']).default('0'),
  internas: z.enum(['final', 'hoja', 'ninguna']).default('final'),
});

export const BuscarQuery = z.object({
  q: z.string().min(1).max(100),
  especie: z.coerce.number().int().optional(),
  forma: z.coerce.number().int().optional(),
});

export const FefoQuery = z.object({ unidades: z.coerce.number().int().positive().default(1), duracionDias: z.coerce.number().int().positive().optional() });
export const ScanDto = z.object({ raw: z.string().min(1).max(500) });
export const RevisionDto = z.object({
  entidad: z.enum(['dispensacion', 'receta', 'sustitucion', 'discrepancia']),
  entidadId: z.uuid(),
  resultado: z.enum(['conforme', 'no_conforme']),
  comentario: z.string().max(1000).nullable().default(null),
});
export const PedidoDto = z.object({
  cn: z.string().regex(/^\d{6}$/),
  nregistro: z.string().nullable().default(null),
  unidades: z.number().int().positive().default(1),
  motivo: z.string().max(300).default('Añadido desde la decisión PEDIR'),
  recetaLineaId: z.uuid().nullable().default(null),
  contactoTutor: z.string().max(200).nullable().default(null),
});
