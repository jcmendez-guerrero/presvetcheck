import { z } from 'zod';
import { TipoTratamiento } from '../enums';

/**
 * Esquemas del asistente de consultas (specs/002-prescription-chat-assistant/contracts). Las herramientas que
 * puede llamar el modelo, la salida estructurada del modelo y la API HTTP salen de aquí; los tipos se infieren.
 */

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');

export const TIPOS_RESPUESTA = [
  'respondida',
  'sin_informacion',
  'fuera_de_ambito',
  'aclaracion',
  'rechazo_reglas',
] as const;
export const TipoRespuesta = z.enum(TIPOS_RESPUESTA);
export type TipoRespuesta = z.infer<typeof TipoRespuesta>;

/** Fuente de referencia que se puede citar y abrir desde la respuesta (FR-007). */
export const FuenteCitada = z.object({
  fuenteId: z.string().min(1),
  tipo: z.enum(['regla', 'guia', 'ayuda', 'cimavet', 'motor']),
  titulo: z.string(),
  version: z.string(),
  ancla: z.string().optional(),
});
export type FuenteCitada = z.infer<typeof FuenteCitada>;

export const DECISIONES_SIMULACION = [
  'VALIDA_HASTA',
  'CADUCADA',
  'PERMITIDA',
  'NO_PERMITIDA',
  'EQUIVALENTE',
  'NO_EQUIVALENTE',
  'ALTERNATIVA_VALIDA',
  'ALTERNATIVA_NO_VALIDA',
  'FALTAN_DATOS',
] as const;
export const DecisionSimulacion = z.enum(DECISIONES_SIMULACION);
export type DecisionSimulacion = z.infer<typeof DecisionSimulacion>;

/** Resultado de una simulación del motor, tal como se guarda en el intercambio (FR-009a). */
export const SimulacionGuardada = z.object({
  simulacionId: z.string(),
  herramienta: z.string(),
  decision: DecisionSimulacion,
  motivos: z.array(z.object({ code: z.string(), mensaje: z.string() })),
  evidencias: z.unknown(),
  supuestos: z.record(z.string(), z.unknown()),
  faltan: z.array(z.string()).optional(),
  reglaVersion: z.string(),
});
export type SimulacionGuardada = z.infer<typeof SimulacionGuardada>;

/** Salida estructurada obligatoria del modelo (contracts/salida-modelo.md). */
export const SalidaModelo = z.object({
  tipo: TipoRespuesta,
  texto: z.string().min(1).max(1500),
  fuentes: z.array(z.string()),
  simulaciones: z.array(z.string()),
  usaContextoLinea: z.boolean(),
});
export type SalidaModelo = z.infer<typeof SalidaModelo>;

// ── Contexto de conversación ────────────────────────────────────────────────

export const ContextoConversacion = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('general') }),
  z.object({ tipo: z.literal('linea'), recetaLineaId: z.string().uuid() }),
  z.object({ tipo: z.literal('medicamento'), nregistro: z.string().min(1).optional() }),
]);
export type ContextoConversacion = z.infer<typeof ContextoConversacion>;

/**
 * Lo único que el modelo ve de una línea de receta (aclaración Q1): resultado del motor y campos no personales.
 * `.strict()`: ningún dato del titular ni del veterinario (nombre, colegiado, teléfono, correo) ni la imagen.
 */
export const ResultadoLineaDto = z
  .object({
    decision: z.string(),
    motivos: z.array(z.object({ code: z.string(), severidad: z.string(), mensaje: z.string() })),
    forzable: z.boolean(),
    equivalentes: z.array(
      z.object({
        nregistro: z.string(),
        cn: z.string().nullable(),
        nombre: z.string(),
        laboratorio: z.string().nullable(),
        stock: z.boolean(),
      }),
    ),
    alternativaFormato: z
      .object({ tipo: z.string(), envases: z.number().nullable(), notaAdministracion: z.string().nullable() })
      .optional(),
    validez: z.object({ efectiva: Fecha, caso: z.string(), maximoLegal: Fecha }).optional(),
  })
  .strict();
export type ResultadoLineaDto = z.infer<typeof ResultadoLineaDto>;

export const ContextoLineaDto = z
  .object({
    fuenteId: z.string(),
    version: z.string(),
    resultado: ResultadoLineaDto,
    receta: z
      .object({
        especie: z.string().nullable(),
        numeroAnimales: z.number().nullable(),
        fechaEmision: Fecha.nullable(),
        tipoReceta: z.string().nullable(),
        clasePrescripcion: z.string().nullable(),
        tipoTratamiento: z.string().nullable(),
        indicacion: z.string().nullable(),
        posologia: z.string().nullable(),
        forma: z.string().nullable(),
        concentracion: z.string().nullable(),
        cantidad: z.string().nullable(),
      })
      .strict(),
    medicamento: z
      .object({ nregistro: z.string().nullable(), nombre: z.string(), cn: z.string().nullable() })
      .strict(),
  })
  .strict();
export type ContextoLineaDto = z.infer<typeof ContextoLineaDto>;

// ── Argumentos de las herramientas (contracts/herramientas.md) ──────────────

export const TEMAS_REGLAS = [
  'campos_receta',
  'validez',
  'sustitucion_exclusiones',
  'equivalencia',
  'formato',
] as const;
export const ArgsConsultarReglas = z.object({ tema: z.enum(TEMAS_REGLAS) });
export const ArgsBuscarFuente = z.object({
  consulta: z.string().min(3).max(200),
  max: z.number().int().min(1).max(5).optional(),
});
export const ArgsBuscarMedicamento = z.object({
  nombre: z.string().min(2).max(120),
  especie: z.string().max(60).optional(),
});
export const ArgsFichaMedicamento = z.object({ nregistro: z.string().min(1).max(30) });
export const ArgsContextoLinea = z.object({});

const LineaSimulada = z.object({
  nregistro: z.string().optional(),
  antimicrobiano: z.boolean().optional(),
  psicotropo: z.boolean().optional(),
  estupefaciente: z.boolean().optional(),
});
export const ArgsSimularValidez = z.object({
  fechaEmision: Fecha.optional(),
  tipoTratamiento: TipoTratamiento.optional(),
  especieProduccion: z.boolean().optional(),
  lineas: z.array(LineaSimulada).max(10).optional(),
  plazoDeclarado: z
    .object({ cantidad: z.number().int().min(1), unidad: z.enum(['dias', 'meses']) })
    .optional(),
  fechaConsulta: Fecha.optional(),
});
export const ArgsSimularCambioFormato = z.object({
  prescrito: z.object({ nregistro: z.string(), cn: z.string(), envases: z.number().int().min(1) }),
  candidato: z.object({ nregistro: z.string(), cn: z.string() }),
  /** Nº de envases del candidato que se quiere dar (si no se indica, los que más se acercan sin pasarse). */
  envasesCandidato: z.number().int().min(1).max(100).optional(),
  especie: z.string().optional(),
});
export const ArgsSimularSustituibilidad = z.object({
  nregistro: z.string().optional(),
  inmunologico: z.boolean().optional(),
  biologico: z.boolean().optional(),
  clasePrescripcion: z.enum(['ordinaria', 'excepcional']).optional(),
});
export const ArgsSimularEquivalencia = z.object({
  prescrito: z.object({ nregistro: z.string() }),
  candidato: z.object({ nregistro: z.string() }),
  especie: z.string().optional(),
  indicacion: z.string().max(300).optional(),
  especieProduccion: z.boolean().optional(),
});

export const ArgsBuscarSustitutos = z.object({
  nombre: z.string().min(2).max(120).optional(),
  nregistro: z.string().min(1).max(30).optional(),
  especie: z.string().min(1).max(60),
  indicacion: z.string().max(300).optional(),
});
export type ArgsBuscarSustitutos = z.infer<typeof ArgsBuscarSustitutos>;

export const ArgsConsultarStock = z.object({
  cns: z
    .array(z.string().regex(/^\d{6}$/))
    .min(1)
    .max(50),
});
export type ArgsConsultarStock = z.infer<typeof ArgsConsultarStock>;

// ── API HTTP (contracts/api.md) ─────────────────────────────────────────────

export const MAX_PREGUNTA = 2000;
export const MAX_COMENTARIO = 500;

export const CrearConversacionBody = z.object({ contexto: ContextoConversacion });
export const PreguntarBody = z.object({ pregunta: z.string().trim().min(1).max(MAX_PREGUNTA) });
export const ValoracionBody = z.object({
  valor: z.enum(['util', 'incorrecta']),
  comentario: z.string().trim().max(MAX_COMENTARIO).optional(),
});
export const ListarConversacionesQuery = z.object({
  desde: Fecha.optional(),
  hasta: Fecha.optional(),
  usuario: z.string().optional(),
  valoracion: z.enum(['util', 'incorrecta', 'sin_valorar']).optional(),
  conReceta: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  tamano: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListarConversacionesQuery = z.output<typeof ListarConversacionesQuery>;
export const LimiteConsumoBody = z.object({ limiteTokens: z.number().int().min(1) });

export const ESTADOS_CONSUMO = ['normal', 'aviso', 'en_pausa'] as const;
export const EstadoConsumo = z.enum(ESTADOS_CONSUMO);
export type EstadoConsumo = z.infer<typeof EstadoConsumo>;

export const ConsumoMesDto = z.object({
  mes: z.string(),
  tokensEntrada: z.number(),
  tokensSalida: z.number(),
  preguntas: z.number(),
  limiteEfectivo: z.number(),
  porcentaje: z.number(),
  estado: EstadoConsumo,
  costeEstimadoEur: z.string().nullable(),
  ampliadoPor: z.string().nullable(),
  ampliadoAt: z.string().nullable(),
});
export type ConsumoMesDto = z.infer<typeof ConsumoMesDto>;

/** Candidato que la persona puede elegir cuando hay varios medicamentos posibles (solo en la respuesta inmediata). */
export const CandidatoMedicamento = z.object({
  nregistro: z.string(),
  nombre: z.string(),
  laboratorio: z.string().nullable(),
  cn: z.string().nullable(),
});
export type CandidatoMedicamento = z.infer<typeof CandidatoMedicamento>;

export const IntercambioDto = z.object({
  id: z.string(),
  orden: z.number(),
  pregunta: z.string(),
  piiEliminada: z.boolean(),
  estado: z.enum(['respondida', 'error', 'limite']),
  tipo: TipoRespuesta.nullable(),
  texto: z.string().nullable(),
  fuentes: z.array(FuenteCitada),
  simulaciones: z.array(SimulacionGuardada),
  resultadoMotor: ResultadoLineaDto.nullable(),
  reglaVersion: z.string(),
  fuentesVersion: z.string(),
  valoracion: z
    .object({ valor: z.enum(['util', 'incorrecta']), comentario: z.string().nullable() })
    .nullable(),
  candidatos: z.array(CandidatoMedicamento).optional(),
  createdAt: z.string(),
});
export type IntercambioDto = z.infer<typeof IntercambioDto>;

// ── Banco de evaluación (fixtures/asistente/banco.v1.yaml) ──────────────────

export const CasoEvaluacion = z.object({
  id: z.string(),
  historia: z.enum(['US1', 'US2', 'US3', 'US4']),
  pregunta: z.string(),
  /** Para US2: id de la línea de la seed sobre la que se pregunta. */
  contexto: z.enum(['general', 'linea', 'medicamento']).default('general'),
  lineaSeed: z.string().optional(),
  validado: z.boolean().default(true),
  esperado: z.object({
    tipo: TipoRespuesta,
    /** Cada elemento es un texto, o una lista de formulaciones alternativas de las que basta una. */
    contiene: z.array(z.union([z.string(), z.array(z.string()).min(1)])).default([]),
    fuentes: z.array(z.string()).default([]),
    simulacion: z.boolean().default(false),
    piiEliminada: z.boolean().default(false),
  }),
});
export type CasoEvaluacion = z.infer<typeof CasoEvaluacion>;
export const BancoEvaluacion = z.object({ version: z.number().int(), casos: z.array(CasoEvaluacion) });
export type BancoEvaluacion = z.infer<typeof BancoEvaluacion>;
