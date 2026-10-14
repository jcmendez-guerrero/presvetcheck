import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdBy, createdOnly, pk, timestamps } from './common';
import { plataformaRecetaElectronica, reglaVersion } from './config';

/** Recetas y dispensación (SPEC §6). */

export const veterinario = pgTable(
  'veterinario',
  {
    id: pk(),
    nombre: text().notNull(),
    numColegiado: text(),
    colegio: text(),
    telefono: text(),
    email: text(),
    clinica: text(),
    direccion: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.numColegiado, t.colegio)],
);

/**
 * Datos personales del propietario cifrados a nivel de aplicación (AES-256-GCM, clave en
 * Key Vault). `dni_hash` (HMAC) permite buscar sin descifrar.
 */
export const propietario = pgTable(
  'propietario',
  {
    id: pk(),
    nombreEnc: text(),
    movilEnc: text(),
    dniEnc: text(),
    direccionEnc: text(),
    dniHash: text(),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [index().on(t.dniHash)],
);

export const receta = pgTable(
  'receta',
  {
    id: pk(),
    tipo: text().notNull(), // papel | electronica
    plataformaId: text().references(() => plataformaRecetaElectronica.id),
    idPlataforma: text(),
    numero: text(),
    fechaEmision: date(),
    tipoDispensacion: text(),
    clasePrescripcion: text(),
    tipoTratamiento: text(),
    veterinarioId: uuid().references(() => veterinario.id),
    numColegiado: text(),
    especieId: integer(),
    especieProduccion: boolean().notNull().default(false),
    animalIdentificacion: text(),
    numAnimales: integer(),
    rega: text(),
    indicacion: text(),
    declAntimicrobianos: jsonb(),
    plazoValidezDeclarado: jsonb(),
    validezEfectiva: date(),
    /** Fecha de la primera dispensación: referencia de validez en entregas diferidas (D-10b). */
    primeraDispensacionAt: timestamp({ withTimezone: true }),
    propietarioId: uuid().references(() => propietario.id),
    firmaConfirmada: boolean().notNull().default(false),
    talonarioColegial: boolean().notNull().default(false),
    estado: text().notNull().default('BORRADOR'),
    sha256: text(),
    phash: text(),
    extraccion: jsonb(),
    /** Borrador y versión confirmada por la persona (valor extraído vs corregido, quién y cuándo). */
    confirmacion: jsonb(),
    correcciones: jsonb(),
    evaluacion: jsonb(),
    reglaVersionId: uuid().references(() => reglaVersion.id),
    reglaVersion: text(),
    creadaPor: text().notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.numero, t.numColegiado), index().on(t.sha256), index().on(t.phash), index().on(t.estado)],
);

export const recetaImagen = pgTable(
  'receta_imagen',
  {
    id: pk(),
    recetaId: uuid()
      .notNull()
      .references(() => receta.id),
    pagina: integer().notNull(),
    blobPath: text().notNull(),
    mime: text().notNull(),
    sha256: text().notNull(),
    ...createdOnly,
  },
  (t) => [uniqueIndex().on(t.recetaId, t.pagina)],
);

export const recetaLinea = pgTable(
  'receta_linea',
  {
    id: pk(),
    recetaId: uuid()
      .notNull()
      .references(() => receta.id),
    orden: integer().notNull(),
    textoMedicamento: text(),
    textoPrincipioActivo: text(),
    formaTexto: text(),
    concentracionTexto: text(),
    cantidadEnvases: integer(),
    formatoTexto: text(),
    unidadesMax: integer(),
    posologia: jsonb(),
    duracionDias: integer(),
    tiempoEsperaTexto: text(),
    nregistro: text(),
    cnPrescrito: text(),
    decision: text(),
    motivos: jsonb(),
    evidencias: jsonb(),
    estado: text().notNull().default('PENDIENTE'),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.recetaId, t.orden)],
);

/**
 * Registro de salidas — APPEND-ONLY (trigger + permisos). Una anulación es una fila nueva
 * con `anula_dispensacion_id` apuntando a la original (contramovimiento); la vista
 * `v_dispensacion` deriva `anulada_por`.
 */
export const dispensacion = pgTable(
  'dispensacion',
  {
    id: pk(),
    recetaLineaId: uuid().references(() => recetaLinea.id),
    recetaId: uuid().references(() => receta.id),
    canal: text().notNull(), // presencial | online
    conReceta: boolean().notNull(),
    cn: text().notNull(),
    nregistro: text(),
    nombreFarmaco: text().notNull(),
    principioActivoTxt: text(),
    formaTxt: text(),
    especieTxt: text(),
    lote: text().notNull(),
    caducidad: date(),
    unidades: integer().notNull(),
    gtin: text(),
    serial: text(),
    metodoCaptura: text().notNull(), // scanner | camara | manual
    loteFefoRecomendado: text(),
    motivoLoteDistinto: text(),
    esSustitucion: boolean().notNull().default(false),
    cnPrescrito: text(),
    nombrePrescrito: text(),
    sustitucionId: uuid(),
    cambioFormato: boolean().notNull().default(false),
    cambioConcentracion: boolean().notNull().default(false),
    forzado: boolean().notNull().default(false),
    defectosForzados: text().array(),
    motivoForzado: text(),
    avisos: jsonb(),
    propietarioId: uuid().references(() => propietario.id),
    referenciaPedido: text(),
    procedimientoVersion: text(),
    reglaVersion: text(),
    empleado: text().notNull(),
    fechaVenta: timestamp({ withTimezone: true }).notNull(),
    /** Contramovimiento: si no es null, esta fila ANULA la dispensación indicada. */
    anulaDispensacionId: uuid(),
    motivoAnulacion: text(),
    ...createdOnly,
  },
  (t) => [
    index().on(t.fechaVenta),
    index().on(t.recetaLineaId),
    index().on(t.cn, t.lote),
    uniqueIndex().on(t.anulaDispensacionId),
  ],
);

/** Revisiones del garante (dispensaciones forzadas, cambios de formato, etc.). Append-only. */
export const revisionGarante = pgTable(
  'revision_garante',
  {
    id: pk(),
    entidad: text().notNull(), // dispensacion | receta | sustitucion | discrepancia
    entidadId: uuid().notNull(),
    resultado: text().notNull(), // conforme | no_conforme
    comentario: text(),
    revisadoPor: text().notNull(),
    mfa: boolean().notNull().default(false),
    ...createdOnly,
  },
  (t) => [index().on(t.entidad, t.entidadId)],
);

export const sustitucion = pgTable(
  'sustitucion',
  {
    id: pk(),
    recetaLineaId: uuid()
      .notNull()
      .references(() => recetaLinea.id),
    cnPrescrito: text(),
    cnPropuesto: text().notNull(),
    nregistroPropuesto: text(),
    equivalencia: jsonb().notNull(),
    consentimientoTutor: jsonb(),
    avisoVeterinario: jsonb(),
    urgencia: jsonb(),
    autorizacion: jsonb(),
    anotacion: jsonb(),
    rechazo: jsonb(),
    historial: jsonb().notNull().default([]),
    estado: text().notNull(),
    modo: text().notNull(), // PRE | POST
    procedimientoVersion: text(),
    ...timestamps,
  },
  (t) => [index().on(t.estado)],
);

export const pedidoPendiente = pgTable(
  'pedido_pendiente',
  {
    id: pk(),
    cn: text().notNull(),
    nregistro: text(),
    unidades: integer().notNull(),
    motivo: text().notNull(),
    recetaLineaId: uuid().references(() => recetaLinea.id),
    /** Contacto del tutor cifrado (opcional en presencial). */
    contactoTutorEnc: text(),
    estado: text().notNull().default('pendiente'), // pendiente | recibido | entregado | cancelado
    creadoPor: text().notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.estado), index().on(t.cn)],
);
