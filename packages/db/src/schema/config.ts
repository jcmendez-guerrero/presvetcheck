import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { createdBy, pk, timestamps } from './common';

/** Configuración y maestros (SPEC §6). */

export const reglaVersion = pgTable('regla_version', {
  id: pk(),
  nombreFichero: text().notNull(),
  hash: text().notNull(),
  contenido: jsonb().notNull(),
  aprobadaPor: text(),
  aprobadaAt: timestamp({ withTimezone: true }),
  activa: boolean().notNull().default(false),
  ...timestamps,
}, (t) => [uniqueIndex().on(t.nombreFichero, t.hash)]);

export const procedimientoAprobado = pgTable('procedimiento_aprobado', {
  id: pk(),
  codigo: text().notNull(), // p. ej. SUSTITUCION
  version: text().notNull(),
  texto: text().notNull(),
  blobPath: text(),
  aprobadoPor: text().notNull(),
  aprobadoAt: timestamp({ withTimezone: true }).notNull(),
  vigente: boolean().notNull().default(false),
  /** true solo para la semilla de desarrollo: nunca vale en producción. */
  soloDesarrollo: boolean().notNull().default(false),
  ...timestamps,
}, (t) => [uniqueIndex().on(t.codigo, t.version)]);

export const sustitucionExclusion = pgTable('sustitucion_exclusion', {
  id: pk(),
  nregistro: text(),
  paId: integer(),
  motivo: text().notNull(),
  fuente: text().notNull(),
  altaPor: text().notNull(),
  ...timestamps,
});

export const especieIdIndividual = pgTable('especie_id_individual', {
  especieId: integer().primaryKey(),
  obligatorio: boolean().notNull(),
});

export const plataformaRecetaElectronica = pgTable('plataforma_receta_electronica', {
  id: text().primaryKey(),
  nombre: text().notNull(),
  /** null = pendiente de verificar contra el listado del MAPA (D-14). */
  reconocidaMapa: boolean(),
  urlVerificacion: text(),
  patronesDeteccion: jsonb(),
  verificadaPor: text(),
  verificadaAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

export const distribuidor = pgTable('distribuidor', {
  id: pk(),
  nombre: text().notNull(),
  cif: text(),
  activo: boolean().notNull().default(true),
  ...timestamps,
});

export const siwebVariantMap = pgTable(
  'siweb_variant_map',
  {
    id: pk(),
    cn: text().notNull(),
    variantId: integer().notNull(),
    productId: integer(),
    sku: text(),
    metodo: text().notNull(), // auto_sku | auto_nombre | manual
    verificadoPor: text(),
    verificadoAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.cn, t.variantId), index().on(t.cn)],
);

export const gtinCn = pgTable('gtin_cn', {
  gtin: text().primaryKey(),
  cn: text().notNull(),
  confirmadoPor: text().notNull(),
  confirmadoAt: timestamp({ withTimezone: true }).notNull(),
});

export const siwebTarea = pgTable(
  'siweb_tarea',
  {
    id: pk(),
    tipo: text().notNull(), // crear | renombrar
    cn: text().notNull(),
    nregistro: text(),
    propuesta: jsonb().notNull(),
    /** Prefijo y correlativo reservados (D-04c), para calcular el siguiente. */
    prefijo: text(),
    correlativoReservado: integer(),
    origen: text().notNull(), // recepcion_linea | mapeo | dispensacion
    origenId: text(),
    estado: text().notNull().default('pendiente'), // pendiente | hecha | descartada
    skuReal: text(),
    creadaPor: text().notNull(),
    resueltaPor: text(),
    resueltaAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.estado), index().on(t.prefijo)],
);

export const laboratorioSkuPrefijo = pgTable('laboratorio_sku_prefijo', {
  labtitularCimavet: text().primaryKey(),
  prefijo: text().notNull().unique(),
  ultimoReservado: integer().notNull().default(0),
  ...timestamps,
});

export const usuario = pgTable('usuario', {
  entraOid: text().primaryKey(),
  nombre: text().notNull(),
  rolCache: text(),
  ...timestamps,
});

export const auditCreatedBy = createdBy;
