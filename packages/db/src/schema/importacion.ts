import { date, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pk } from './common';

/**
 * Importación de registros anteriores a la app (entradas y salidas llevados en Excel). Cada importación es un
 * lote con su fichero (nombre y hash). Las filas son de solo inserción (trigger, migración 0009): una importación
 * equivocada se ANULA (sigue guardada, pero deja de contar en registros e informes), nunca se modifica.
 */
export const importacion = pgTable('importacion', {
  id: pk(),
  tipo: text().notNull(), // entradas | salidas
  fichero: text().notNull(),
  sha256: text().notNull(),
  filas: integer().notNull(),
  creadaPor: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  anuladaAt: timestamp({ withTimezone: true }),
  anuladaPor: text(),
  motivoAnulacion: text(),
});

export const entradaImportada = pgTable(
  'entrada_importada',
  {
    id: pk(),
    importacionId: uuid()
      .notNull()
      .references(() => importacion.id),
    fila: integer().notNull(),
    /** Fecha de compra (la del registro de entradas). */
    fecha: date().notNull(),
    fechaRecepcion: date(),
    distribuidor: text().notNull(),
    albaran: text(),
    nombreFarmaco: text().notNull(),
    principioActivo: text(),
    forma: text(),
    cn: text(),
    lote: text(),
    caducidad: date(),
    unidades: integer().notNull(),
    precioNetoCompra: numeric({ precision: 12, scale: 4 }),
    ivaPct: numeric({ precision: 5, scale: 2 }),
    rePct: numeric({ precision: 5, scale: 2 }),
    precioCoste: numeric({ precision: 12, scale: 4 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.fecha), index().on(t.importacionId)],
);

export const salidaImportada = pgTable(
  'salida_importada',
  {
    id: pk(),
    importacionId: uuid()
      .notNull()
      .references(() => importacion.id),
    fila: integer().notNull(),
    /** Fecha de venta (la del registro de salidas). */
    fecha: date().notNull(),
    /** A con receta, B sin receta presencial, C sin receta online. */
    plantilla: text().notNull(),
    nombreFarmaco: text().notNull(),
    principioActivo: text(),
    forma: text(),
    especie: text(),
    cn: text(),
    lote: text(),
    caducidad: date(),
    unidades: integer(),
    unidadesTexto: text(),
    fechaReceta: date(),
    numeroReceta: text(),
    veterinario: text(),
    numColegiado: text(),
    clinica: text(),
    direccionVeterinario: text(),
    /** Datos del propietario cifrados (como en `propietario`). */
    propietarioNombreEnc: text(),
    propietarioMovilEnc: text(),
    propietarioDniEnc: text(),
    propietarioDireccionEnc: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.fecha), index().on(t.importacionId)],
);
