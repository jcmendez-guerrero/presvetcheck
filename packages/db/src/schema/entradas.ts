import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
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
    /** recargo_equivalencia (farmacia, por defecto) | nacional (solo IVA). */
    regimen: text().notNull().default('recargo_equivalencia'),
    estado: text().notNull().default('ABIERTA'), // ABIERTA | FINALIZADA | SINCRONIZADA | ERROR_SINCRONIZACION | DESCARTADA
    /** Recepción abierta descartada (no se borra: queda con quién, cuándo y por qué). */
    descartadaAt: timestamp({ withTimezone: true }),
    descartadaPor: text(),
    motivoDescarte: text(),
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
    /** Precio unitario antes del descuento y descuento en % (el neto es el resultado; sin IVA ni RE). */
    precioBruto: numeric({ precision: 14, scale: 4 }),
    descuentoPct: numeric({ precision: 6, scale: 3 }),
    precioNetoCompra: numeric({ precision: 14, scale: 4 }),
    ivaPct: numeric({ precision: 5, scale: 2 }),
    rePct: numeric({ precision: 5, scale: 2 }),
    precioCoste: numeric({ precision: 14, scale: 4 }),
    origenDatos: text().notNull(), // cimavet | manual
    siwebVariantId: integer(),
    /** Al finalizar, dar entrada de stock en Siweb360 (si la escritura está activada). */
    actualizarStock: boolean().notNull().default(true),
    /** Este precio pasa a ser el precio de coste de referencia (solo en la app: Siweb360 no permite cambiarlo). */
    actualizarPrecio: boolean().notNull().default(true),
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

/**
 * Albarán o factura de proveedor leído con Document Intelligence antes de crear la recepción (o dentro de ella):
 * el fichero (contenedor `albaranes`), lo leído y la recepción a la que pertenece. Sirve para conservar la foto y
 * los datos leídos, y para avisar si el mismo fichero ya se registró.
 */
export const albaranDocumento = pgTable(
  'albaran_documento',
  {
    id: pk(),
    sha256: text().notNull(),
    /** Ruta dentro del contenedor `albaranes`. */
    documentoPath: text().notNull(),
    mime: text().notNull(),
    /** Todas las páginas del albarán, en orden. Nulo en las filas antiguas: una sola página (`documentoPath`). */
    paginas: jsonb().$type<{ path: string; mime: string }[] | null>(),
    lectura: jsonb().notNull(),
    recepcionId: uuid().references(() => recepcion.id),
    creadoPor: text().notNull(),
    ...createdOnly,
  },
  (t) => [index().on(t.sha256), index().on(t.recepcionId)],
);
