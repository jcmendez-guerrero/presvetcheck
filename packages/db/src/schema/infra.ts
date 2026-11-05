import {
  bigserial,
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
import { pk, timestamps } from './common';

/** Outbox de escrituras en Siweb360 (SPEC §5.2.5). */
export const outbox = pgTable(
  'outbox',
  {
    id: pk(),
    operation: text().notNull(), // stock_adjustment_entry
    payload: jsonb().notNull(),
    /** `MMX-{entidad}-{id}-{n}`; viaja en `notes` del ajuste. */
    idempotencyKey: text().notNull(),
    status: text().notNull().default('pending'), // pending | sent | failed | needs_reconciliation
    attempts: integer().notNull().default(0),
    lastError: text(),
    response: jsonb(),
    entidad: text(),
    entidadId: uuid(),
    nextAttemptAt: timestamp({ withTimezone: true }),
    lockedAt: timestamp({ withTimezone: true }),
    sentAt: timestamp({ withTimezone: true }),
    resolvedBy: text(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolution: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.idempotencyKey), index().on(t.status)],
);

/** Auditoría append-only con cadena de hashes (SPEC §9.4). */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: pk(),
    seq: bigserial({ mode: 'number' }).notNull().unique(),
    at: timestamp({ withTimezone: true }).notNull(),
    actor: text().notNull(),
    accion: text().notNull(),
    entidad: text().notNull(),
    entidadId: text(),
    antes: jsonb(),
    despues: jsonb(),
    ip: text(),
    userAgent: text(),
    hashPrev: text().notNull(),
    hash: text().notNull(),
  },
  (t) => [index().on(t.entidad, t.entidadId)],
);

export const reportRun = pgTable('report_run', {
  id: pk(),
  tipo: text().notNull(),
  periodo: text().notNull(),
  blobPath: text(),
  formato: text(),
  generadoAt: timestamp({ withTimezone: true }).notNull(),
  enviadoA: text().array(),
  error: text(),
});

/** Discrepancias (conciliación ticket↔dispensación, outbox): las resuelve el empleado con una nota. */
export const discrepancia = pgTable(
  'discrepancia',
  {
    id: pk(),
    tipo: text().notNull(),
    origen: text().notNull(), // sales-reconciliation | outbox
    fecha: timestamp({ withTimezone: true }).notNull(),
    datos: jsonb().notNull(),
    estado: text().notNull().default('abierta'), // abierta | resuelta
    resueltaPor: text(),
    resueltaAt: timestamp({ withTimezone: true }),
    notaResolucion: text(),
    ...timestamps,
  },
  (t) => [index().on(t.estado)],
);

/**
 * Emparejamiento de un móvil con el puesto del PC (foto de la receta y lectura de códigos desde el móvil).
 * El móvil se identifica con un token de un solo uso por sesión (solo se guarda su hash) que el PC muestra en
 * un código QR; actúa siempre en nombre de la persona que abrió la sesión en el PC.
 */
export const sesionMovil = pgTable('sesion_movil', {
  id: pk(),
  tokenHash: text().notNull().unique(),
  usuarioId: text().notNull(),
  usuarioNombre: text().notNull(),
  roles: text().array().notNull(),
  expiraAt: timestamp({ withTimezone: true }).notNull(),
  cerradaAt: timestamp({ withTimezone: true }),
  movilVistoAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Lo que el móvil envía al PC: `receta` (id de la receta creada) o `codigo` (lectura del envase). */
export const sesionMovilEvento = pgTable(
  'sesion_movil_evento',
  {
    seq: bigserial({ mode: 'number' }).primaryKey(),
    sesionId: uuid()
      .notNull()
      .references(() => sesionMovil.id),
    tipo: text().notNull(),
    datos: jsonb().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.sesionId, t.seq)],
);

/**
 * Conciliación de cada salida con su ticket del TPV (SPEC §5.2.4). La dispensación es de solo inserción, así
 * que el resultado va aparte: una fila por salida conciliada (una sola vez: `dispensacion_id` único).
 */
export const conciliacion = pgTable(
  'conciliacion',
  {
    id: pk(),
    dispensacionId: uuid().notNull().unique(),
    /** Movimiento de venta (línea de ticket) con el que se ha emparejado. */
    movimientoId: text().notNull(),
    ticket: text(),
    /** false si el ticket no trae lote (Siweb360): conciliada por código nacional y unidades. */
    loteVerificado: boolean().notNull(),
    /** registro (al completar el registro) | bajo-demanda | sales-reconciliation (job diario) | manual. */
    origen: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index().on(t.movimientoId)],
);

/** Tickets SIMULADOS del TPV para la demo («Simular cobro en TPV»). Imposibles en producción. */
export const ticketDemo = pgTable('ticket_demo', {
  id: pk(),
  numero: text().notNull(),
  cn: text().notNull(),
  unidades: integer().notNull(),
  fecha: timestamp({ withTimezone: true }).notNull(),
  creadoPor: text().notNull(),
});
