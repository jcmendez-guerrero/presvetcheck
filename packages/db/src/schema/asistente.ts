import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pk } from './common';
import { recetaLinea } from './recetas';

/**
 * Asistente de consultas (specs/002-prescription-chat-assistant). Ninguna tabla guarda datos del titular del
 * animal ni la identidad del veterinario. Las conversaciones se eliminan al año (retention-sweep).
 */

/** Sesión de consulta de un empleado. */
export const asistenteConversacion = pgTable(
  'asistente_conversacion',
  {
    id: pk(),
    /** Sin FK a `usuario` (solo la siembra la rellena): el resto de registros guarda el id de Entra como texto. */
    usuarioOid: text().notNull(),
    usuarioNombre: text().notNull(),
    contextoTipo: text().notNull(), // general | linea | medicamento
    /** Sin ON DELETE CASCADE: la conversación (1 año) desaparece antes que la receta (5 años). */
    recetaLineaId: uuid().references(() => recetaLinea.id),
    nregistro: text(),
    estado: text().notNull().default('abierta'), // abierta | cerrada
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    cerradaAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.usuarioOid, t.createdAt), index().on(t.createdAt)],
);

/** Cada par pregunta-respuesta. De solo inserción (trigger); se purga a 1 año. */
export const asistenteIntercambio = pgTable(
  'asistente_intercambio',
  {
    id: pk(),
    conversacionId: uuid()
      .notNull()
      .references(() => asistenteConversacion.id, { onDelete: 'cascade' }),
    orden: integer().notNull(),
    /** Ya saneada de datos personales. */
    pregunta: text().notNull(),
    piiEliminada: boolean().notNull().default(false),
    estado: text().notNull(), // respondida | error | limite
    tipoRespuesta: text(), // respondida | sin_informacion | fuera_de_ambito | aclaracion | rechazo_reglas
    respuesta: text(),
    fuentes: jsonb().notNull().default([]),
    simulaciones: jsonb().notNull().default([]),
    contextoMotor: jsonb(),
    reglaVersion: text().notNull(),
    fuentesVersion: text().notNull(),
    modelo: text().notNull(),
    instruccionesVersion: text().notNull(),
    tokensEntrada: integer().notNull().default(0),
    tokensSalida: integer().notNull().default(0),
    rondasHerramientas: integer().notNull().default(0),
    duracionMs: integer().notNull().default(0),
    errorCode: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.conversacionId, t.orden), index().on(t.createdAt)],
);

/** Opinión del empleado sobre un intercambio; volver a valorar sustituye la anterior. */
export const asistenteValoracion = pgTable(
  'asistente_valoracion',
  {
    id: pk(),
    intercambioId: uuid()
      .notNull()
      .references(() => asistenteIntercambio.id, { onDelete: 'cascade' }),
    usuarioOid: text().notNull(),
    valor: text().notNull(), // util | incorrecta
    comentario: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.intercambioId, t.usuarioOid)],
);

/** Consumo acumulado por mes natural (`YYYY-MM`, Europe/Madrid). Sin datos personales; no se purga. */
export const asistenteConsumoMes = pgTable('asistente_consumo_mes', {
  mes: text().primaryKey(),
  tokensEntrada: bigint({ mode: 'number' }).notNull().default(0),
  tokensSalida: bigint({ mode: 'number' }).notNull().default(0),
  preguntas: integer().notNull().default(0),
  limiteTokens: bigint({ mode: 'number' }).notNull(),
  limiteAmpliado: bigint({ mode: 'number' }),
  ampliadoPor: text(),
  ampliadoAt: timestamp({ withTimezone: true }),
  avisoEnviadoAt: timestamp({ withTimezone: true }),
  pausadoAt: timestamp({ withTimezone: true }),
});
