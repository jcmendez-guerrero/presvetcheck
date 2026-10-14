import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { pk } from './common';

/** Caché local de CIMAVet (SPEC §5.1.2, §6). `source ∈ {nomenclator, api}`; `raw` guarda el crudo. */

export const cimavetMedicamento = pgTable(
  'cimavet_medicamento',
  {
    nregistro: text().primaryKey(),
    nombre: text().notNull(),
    nombreNorm: text().notNull(),
    labtitular: text(),
    labtitularId: integer(),
    receta: boolean(),
    antibiotico: boolean(),
    estupefaciente: boolean(),
    psicotropo: boolean(),
    tipoMedicamentoId: integer(),
    formaId: integer(),
    administracionId: integer(),
    dispensacionId: integer(),
    /** Estado tal como viene ({aut, susp, rev} en la API; códigos en el Nomenclátor). */
    estado: jsonb(),
    /** Estado normalizado: autorizado | suspendido | revocado. */
    estadoCodigo: text().notNull().default('autorizado'),
    comerc: boolean(),
    psum: boolean(),
    ema: boolean(),
    notas: boolean(),
    primeraAutorizacion: date(),
    /** Base de la composición: los principios activos se expresan por `cantidad_concentracion` `unidad_concentracion`. */
    cantidadConcentracion: numeric(),
    unidadConcentracion: text(),
    raw: jsonb(),
    source: text().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index().on(t.estadoCodigo)],
);

export const cimavetPresentacion = pgTable(
  'cimavet_presentacion',
  {
    cn: text().primaryKey(),
    nregistro: text()
      .notNull()
      .references(() => cimavetMedicamento.nregistro),
    nombre: text().notNull(),
    nombreNorm: text().notNull(),
    comerc: boolean(),
    estado: jsonb(),
    estadoCodigo: text().notNull().default('autorizado'),
    /** Contenido total del envase (p. ej. 10) y su unidad (p. ej. Comprimido), si se conoce. */
    contenido: numeric(),
    unidadContenido: text(),
    raw: jsonb(),
    source: text().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index().on(t.nregistro)],
);

export const cimavetMedPrincipioActivo = pgTable(
  'cimavet_med_principio_activo',
  {
    nregistro: text()
      .notNull()
      .references(() => cimavetMedicamento.nregistro),
    orden: integer().notNull(),
    paId: integer().notNull(),
    nombre: text(),
    cantidadRaw: text(),
    cantidadValor: numeric(),
    unidadRaw: text(),
    unidadCanonica: text(),
    normalizable: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.nregistro, t.orden] }), index().on(t.paId)],
);

export const cimavetMedEspecie = pgTable(
  'cimavet_med_especie',
  {
    nregistro: text()
      .notNull()
      .references(() => cimavetMedicamento.nregistro),
    especieId: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.nregistro, t.especieId] })],
);

export const cimavetMedVia = pgTable(
  'cimavet_med_via',
  {
    nregistro: text()
      .notNull()
      .references(() => cimavetMedicamento.nregistro),
    viaId: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.nregistro, t.viaId] })],
);

export const cimavetMedAtc = pgTable(
  'cimavet_med_atc',
  {
    nregistro: text()
      .notNull()
      .references(() => cimavetMedicamento.nregistro),
    codigo: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.nregistro, t.codigo] })],
);

export const cimavetMedIndicacion = pgTable(
  'cimavet_med_indicacion',
  {
    id: serial().primaryKey(),
    nregistro: text()
      .notNull()
      .references(() => cimavetMedicamento.nregistro),
    indicacionId: integer().notNull(),
    nombre: text(),
    /** null = "Todas" las especies. */
    especieId: integer(),
  },
  (t) => [index().on(t.nregistro)],
);

export const cimavetMedTiempoEspera = pgTable(
  'cimavet_med_tiempo_espera',
  {
    id: serial().primaryKey(),
    nregistro: text()
      .notNull()
      .references(() => cimavetMedicamento.nregistro),
    especieId: integer(),
    tejido: text(),
    cantidad: numeric(),
    unidad: text(),
    /** Desde julio de 2024 el Nomenclátor incluye forma/vía y "no aplica tejido". */
    formaViaAdmin: text(),
    noAplicaTejido: boolean().notNull().default(false),
  },
  (t) => [index().on(t.nregistro)],
);

export const cimavetNota = pgTable(
  'cimavet_nota',
  {
    nregistro: text().notNull(),
    num: text().notNull(),
    ref: text(),
    asunto: text(),
    fecha: date(),
    url: text(),
  },
  (t) => [primaryKey({ columns: [t.nregistro, t.num] })],
);

/**
 * Maestras de CIMAVet. `tipo` sigue la numeración de `GET maestras` (1 principios activos,
 * 2 formas, 3 vías, 4 laboratorios, 5 ATC, 6 excipientes, 7 especies, 8 medicamentos,
 * 9 interacciones, 10 contraindicaciones, 11 indicaciones, 12 reacciones adversas) y añade
 * diccionarios del Nomenclátor sin equivalente en la API: 100 unidades de composición,
 * 101 situación de registro, 102 dispositivos.
 */
export const cimavetMaestra = pgTable(
  'cimavet_maestra',
  {
    tipo: integer().notNull(),
    /** Clave estable: el id numérico como texto o, si no hay (ATC), el código. */
    clave: text().notNull(),
    id: integer(),
    codigo: text(),
    nombre: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tipo, t.clave] }), index().on(t.tipo, t.id)],
);

export const cimavetSyncRun = pgTable('cimavet_sync_run', {
  id: pk(),
  tipo: text().notNull(), // nomenclator | delta | full | live | maestras
  inicio: timestamp({ withTimezone: true }).notNull(),
  fin: timestamp({ withTimezone: true }),
  contadores: jsonb(),
  error: text(),
});

export const MAESTRA = {
  PRINCIPIOS_ACTIVOS: 1,
  FORMAS: 2,
  VIAS: 3,
  LABORATORIOS: 4,
  ATC: 5,
  EXCIPIENTES: 6,
  ESPECIES: 7,
  MEDICAMENTOS: 8,
  INTERACCIONES: 9,
  CONTRAINDICACIONES: 10,
  INDICACIONES: 11,
  REACCIONES_ADVERSAS: 12,
  UNIDADES: 100,
  SITUACION_REGISTRO: 101,
  DISPOSITIVOS: 102,
} as const;
