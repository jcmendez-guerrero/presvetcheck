import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdOnly, pk, timestamps } from './common';
import { distribuidor } from './config';

/** Entradas / recepción de mercancía (SPEC §4.9, §6). */

export const recepcion = pgTable(
  'recepcion',
  {
    id: pk(),
    distribuidorId: uuid()
      .notNull()
      .references(() => distribuidor.id),
    albaran: text(),
    fechaCompra: date().notNull(),
    /** Fecha en que llega la mercancía (puede ser posterior a la de compra del albarán o factura). */
    fechaRecepcion: date(),
    /** Propuesta leída del albarán o la factura (Document Intelligence) y ruta del documento en Blob. */
    lecturaDocumento: jsonb(),
    documentoPath: text(),
    estado: text().notNull().default('ABIERTA'), // ABIERTA | FINALIZADA | SINCRONIZADA | ERROR_SINCRONIZACION
    empleado: text().notNull(),
    finalizadaAt: timestamp({ withTimezone: true }),
    syncEstado: text(),
    ...timestamps,
  },
  (t) => [index().on(t.estado)],
);

/** Línea de entrada — append-only tras finalizar la recepción (trigger). */
export const recepcionLinea = pgTable(
  'recepcion_linea',
  {
    id: pk(),
    recepcionId: uuid()
      .notNull()
      .references(() => recepcion.id),
    numero: integer().notNull(),
    tipo: text().notNull().default('medicamento'), // medicamento | producto
    cn: text(),
    nregistro: text(),
    nombreFarmaco: text().notNull(),
    principioActivoTxt: text(),
    formaTxt: text(),
    lote: text(),
    caducidad: date(),
    unidades: integer().notNull(),
    seriales: text().array(),
    gtin: text(),
    precioNetoCompra: numeric({ precision: 14, scale: 4 }),
    ivaPct: numeric({ precision: 5, scale: 2 }),
    rePct: numeric({ precision: 5, scale: 2 }),
    precioCoste: numeric({ precision: 14, scale: 4 }),
    origenDatos: text().notNull(), // cimavet | manual
    siwebVariantId: integer(),
    estado: text().notNull().default('OK'),
    empleado: text().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.recepcionId, t.numero), index().on(t.cn)],
);

/** Contramovimiento de entrada (correcciones tras finalizar). Append-only. */
export const recepcionAjuste = pgTable('recepcion_ajuste', {
  id: pk(),
  recepcionLineaId: uuid()
    .notNull()
    .references(() => recepcionLinea.id),
  unidades: integer().notNull(),
  motivo: text().notNull(),
  empleado: text().notNull(),
  ...createdOnly,
});
