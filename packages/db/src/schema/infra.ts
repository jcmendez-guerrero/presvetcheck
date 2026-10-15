import { bigserial, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
