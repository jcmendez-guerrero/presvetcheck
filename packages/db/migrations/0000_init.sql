CREATE TABLE "cimavet_maestra" (
	"tipo" integer NOT NULL,
	"clave" text NOT NULL,
	"id" integer,
	"codigo" text,
	"nombre" text NOT NULL,
	CONSTRAINT "cimavet_maestra_tipo_clave_pk" PRIMARY KEY("tipo","clave")
);
--> statement-breakpoint
CREATE TABLE "cimavet_med_atc" (
	"nregistro" text NOT NULL,
	"codigo" text NOT NULL,
	CONSTRAINT "cimavet_med_atc_nregistro_codigo_pk" PRIMARY KEY("nregistro","codigo")
);
--> statement-breakpoint
CREATE TABLE "cimavet_med_especie" (
	"nregistro" text NOT NULL,
	"especie_id" integer NOT NULL,
	CONSTRAINT "cimavet_med_especie_nregistro_especie_id_pk" PRIMARY KEY("nregistro","especie_id")
);
--> statement-breakpoint
CREATE TABLE "cimavet_med_indicacion" (
	"id" serial PRIMARY KEY NOT NULL,
	"nregistro" text NOT NULL,
	"indicacion_id" integer NOT NULL,
	"nombre" text,
	"especie_id" integer
);
--> statement-breakpoint
CREATE TABLE "cimavet_med_principio_activo" (
	"nregistro" text NOT NULL,
	"orden" integer NOT NULL,
	"pa_id" integer NOT NULL,
	"nombre" text,
	"cantidad_raw" text,
	"cantidad_valor" numeric,
	"unidad_raw" text,
	"unidad_canonica" text,
	"normalizable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cimavet_med_principio_activo_nregistro_orden_pk" PRIMARY KEY("nregistro","orden")
);
--> statement-breakpoint
CREATE TABLE "cimavet_med_tiempo_espera" (
	"id" serial PRIMARY KEY NOT NULL,
	"nregistro" text NOT NULL,
	"especie_id" integer,
	"tejido" text,
	"cantidad" numeric,
	"unidad" text,
	"forma_via_admin" text,
	"no_aplica_tejido" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cimavet_med_via" (
	"nregistro" text NOT NULL,
	"via_id" integer NOT NULL,
	CONSTRAINT "cimavet_med_via_nregistro_via_id_pk" PRIMARY KEY("nregistro","via_id")
);
--> statement-breakpoint
CREATE TABLE "cimavet_medicamento" (
	"nregistro" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"nombre_norm" text NOT NULL,
	"labtitular" text,
	"labtitular_id" integer,
	"receta" boolean,
	"antibiotico" boolean,
	"estupefaciente" boolean,
	"psicotropo" boolean,
	"tipo_medicamento_id" integer,
	"forma_id" integer,
	"administracion_id" integer,
	"dispensacion_id" integer,
	"estado" jsonb,
	"estado_codigo" text DEFAULT 'autorizado' NOT NULL,
	"comerc" boolean,
	"psum" boolean,
	"ema" boolean,
	"notas" boolean,
	"primera_autorizacion" date,
	"cantidad_concentracion" numeric,
	"unidad_concentracion" text,
	"raw" jsonb,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cimavet_nota" (
	"nregistro" text NOT NULL,
	"num" text NOT NULL,
	"ref" text,
	"asunto" text,
	"fecha" date,
	"url" text,
	CONSTRAINT "cimavet_nota_nregistro_num_pk" PRIMARY KEY("nregistro","num")
);
--> statement-breakpoint
CREATE TABLE "cimavet_presentacion" (
	"cn" text PRIMARY KEY NOT NULL,
	"nregistro" text NOT NULL,
	"nombre" text NOT NULL,
	"nombre_norm" text NOT NULL,
	"comerc" boolean,
	"estado" jsonb,
	"estado_codigo" text DEFAULT 'autorizado' NOT NULL,
	"contenido" numeric,
	"unidad_contenido" text,
	"raw" jsonb,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cimavet_sync_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone,
	"contadores" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "distribuidor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"cif" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "especie_id_individual" (
	"especie_id" integer PRIMARY KEY NOT NULL,
	"obligatorio" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtin_cn" (
	"gtin" text PRIMARY KEY NOT NULL,
	"cn" text NOT NULL,
	"confirmado_por" text NOT NULL,
	"confirmado_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laboratorio_sku_prefijo" (
	"labtitular_cimavet" text PRIMARY KEY NOT NULL,
	"prefijo" text NOT NULL,
	"ultimo_reservado" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laboratorio_sku_prefijo_prefijo_unique" UNIQUE("prefijo")
);
--> statement-breakpoint
CREATE TABLE "plataforma_receta_electronica" (
	"id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"reconocida_mapa" boolean,
	"url_verificacion" text,
	"patrones_deteccion" jsonb,
	"verificada_por" text,
	"verificada_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedimiento_aprobado" (
	"id" uuid PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"version" text NOT NULL,
	"texto" text NOT NULL,
	"blob_path" text,
	"aprobado_por" text NOT NULL,
	"aprobado_at" timestamp with time zone NOT NULL,
	"vigente" boolean DEFAULT false NOT NULL,
	"solo_desarrollo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regla_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre_fichero" text NOT NULL,
	"hash" text NOT NULL,
	"contenido" jsonb NOT NULL,
	"aprobada_por" text,
	"aprobada_at" timestamp with time zone,
	"activa" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "siweb_tarea" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"cn" text NOT NULL,
	"nregistro" text,
	"propuesta" jsonb NOT NULL,
	"prefijo" text,
	"correlativo_reservado" integer,
	"origen" text NOT NULL,
	"origen_id" text,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"sku_real" text,
	"creada_por" text NOT NULL,
	"resuelta_por" text,
	"resuelta_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "siweb_variant_map" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cn" text NOT NULL,
	"variant_id" integer NOT NULL,
	"product_id" integer,
	"sku" text,
	"metodo" text NOT NULL,
	"verificado_por" text,
	"verificado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sustitucion_exclusion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nregistro" text,
	"pa_id" integer,
	"motivo" text NOT NULL,
	"fuente" text NOT NULL,
	"alta_por" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"entra_oid" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"rol_cache" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispensacion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receta_linea_id" uuid,
	"receta_id" uuid,
	"canal" text NOT NULL,
	"con_receta" boolean NOT NULL,
	"cn" text NOT NULL,
	"nregistro" text,
	"nombre_farmaco" text NOT NULL,
	"principio_activo_txt" text,
	"forma_txt" text,
	"especie_txt" text,
	"lote" text NOT NULL,
	"caducidad" date,
	"unidades" integer NOT NULL,
	"gtin" text,
	"serial" text,
	"metodo_captura" text NOT NULL,
	"lote_fefo_recomendado" text,
	"motivo_lote_distinto" text,
	"es_sustitucion" boolean DEFAULT false NOT NULL,
	"cn_prescrito" text,
	"nombre_prescrito" text,
	"sustitucion_id" uuid,
	"cambio_formato" boolean DEFAULT false NOT NULL,
	"cambio_concentracion" boolean DEFAULT false NOT NULL,
	"forzado" boolean DEFAULT false NOT NULL,
	"defectos_forzados" text[],
	"motivo_forzado" text,
	"avisos" jsonb,
	"propietario_id" uuid,
	"referencia_pedido" text,
	"procedimiento_version" text,
	"regla_version" text,
	"empleado" text NOT NULL,
	"fecha_venta" timestamp with time zone NOT NULL,
	"anula_dispensacion_id" uuid,
	"motivo_anulacion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pedido_pendiente" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cn" text NOT NULL,
	"nregistro" text,
	"unidades" integer NOT NULL,
	"motivo" text NOT NULL,
	"receta_linea_id" uuid,
	"contacto_tutor_enc" text,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"creado_por" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "propietario" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre_enc" text,
	"movil_enc" text,
	"dni_enc" text,
	"direccion_enc" text,
	"dni_hash" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receta" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"plataforma_id" text,
	"id_plataforma" text,
	"numero" text,
	"fecha_emision" date,
	"tipo_dispensacion" text,
	"clase_prescripcion" text,
	"tipo_tratamiento" text,
	"veterinario_id" uuid,
	"num_colegiado" text,
	"especie_id" integer,
	"especie_produccion" boolean DEFAULT false NOT NULL,
	"animal_identificacion" text,
	"num_animales" integer,
	"rega" text,
	"indicacion" text,
	"decl_antimicrobianos" jsonb,
	"plazo_validez_declarado" jsonb,
	"validez_efectiva" date,
	"primera_dispensacion_at" timestamp with time zone,
	"propietario_id" uuid,
	"firma_confirmada" boolean DEFAULT false NOT NULL,
	"talonario_colegial" boolean DEFAULT false NOT NULL,
	"estado" text DEFAULT 'BORRADOR' NOT NULL,
	"sha256" text,
	"phash" text,
	"extraccion" jsonb,
	"confirmacion" jsonb,
	"correcciones" jsonb,
	"evaluacion" jsonb,
	"regla_version_id" uuid,
	"regla_version" text,
	"creada_por" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receta_imagen" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receta_id" uuid NOT NULL,
	"pagina" integer NOT NULL,
	"blob_path" text NOT NULL,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receta_linea" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receta_id" uuid NOT NULL,
	"orden" integer NOT NULL,
	"texto_medicamento" text,
	"texto_principio_activo" text,
	"forma_texto" text,
	"concentracion_texto" text,
	"cantidad_envases" integer,
	"formato_texto" text,
	"unidades_max" integer,
	"posologia" jsonb,
	"duracion_dias" integer,
	"tiempo_espera_texto" text,
	"nregistro" text,
	"cn_prescrito" text,
	"decision" text,
	"motivos" jsonb,
	"evidencias" jsonb,
	"estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_garante" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" uuid NOT NULL,
	"resultado" text NOT NULL,
	"comentario" text,
	"revisado_por" text NOT NULL,
	"mfa" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sustitucion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receta_linea_id" uuid NOT NULL,
	"cn_prescrito" text,
	"cn_propuesto" text NOT NULL,
	"nregistro_propuesto" text,
	"equivalencia" jsonb NOT NULL,
	"consentimiento_tutor" jsonb,
	"aviso_veterinario" jsonb,
	"urgencia" jsonb,
	"autorizacion" jsonb,
	"anotacion" jsonb,
	"rechazo" jsonb,
	"historial" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estado" text NOT NULL,
	"modo" text NOT NULL,
	"procedimiento_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "veterinario" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"num_colegiado" text,
	"colegio" text,
	"telefono" text,
	"email" text,
	"clinica" text,
	"direccion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recepcion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"distribuidor_id" uuid NOT NULL,
	"albaran" text,
	"fecha_compra" date NOT NULL,
	"estado" text DEFAULT 'ABIERTA' NOT NULL,
	"empleado" text NOT NULL,
	"finalizada_at" timestamp with time zone,
	"sync_estado" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recepcion_ajuste" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recepcion_linea_id" uuid NOT NULL,
	"unidades" integer NOT NULL,
	"motivo" text NOT NULL,
	"empleado" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recepcion_linea" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recepcion_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"tipo" text DEFAULT 'medicamento' NOT NULL,
	"cn" text,
	"nregistro" text,
	"nombre_farmaco" text NOT NULL,
	"principio_activo_txt" text,
	"forma_txt" text,
	"lote" text,
	"caducidad" date,
	"unidades" integer NOT NULL,
	"seriales" text[],
	"gtin" text,
	"precio_neto_compra" numeric(14, 4),
	"iva_pct" numeric(5, 2),
	"re_pct" numeric(5, 2),
	"precio_coste" numeric(14, 4),
	"origen_datos" text NOT NULL,
	"siweb_variant_id" integer,
	"estado" text DEFAULT 'OK' NOT NULL,
	"empleado" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"antes" jsonb,
	"despues" jsonb,
	"ip" text,
	"user_agent" text,
	"hash_prev" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_event_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "discrepancia" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"origen" text NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"datos" jsonb NOT NULL,
	"estado" text DEFAULT 'abierta' NOT NULL,
	"resuelta_por" text,
	"resuelta_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"response" jsonb,
	"entidad" text,
	"entidad_id" uuid,
	"next_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"periodo" text NOT NULL,
	"blob_path" text,
	"formato" text,
	"generado_at" timestamp with time zone NOT NULL,
	"enviado_a" text[],
	"error" text
);
--> statement-breakpoint
ALTER TABLE "cimavet_med_atc" ADD CONSTRAINT "cimavet_med_atc_nregistro_cimavet_medicamento_nregistro_fk" FOREIGN KEY ("nregistro") REFERENCES "public"."cimavet_medicamento"("nregistro") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cimavet_med_especie" ADD CONSTRAINT "cimavet_med_especie_nregistro_cimavet_medicamento_nregistro_fk" FOREIGN KEY ("nregistro") REFERENCES "public"."cimavet_medicamento"("nregistro") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cimavet_med_indicacion" ADD CONSTRAINT "cimavet_med_indicacion_nregistro_cimavet_medicamento_nregistro_fk" FOREIGN KEY ("nregistro") REFERENCES "public"."cimavet_medicamento"("nregistro") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cimavet_med_principio_activo" ADD CONSTRAINT "cimavet_med_principio_activo_nregistro_cimavet_medicamento_nregistro_fk" FOREIGN KEY ("nregistro") REFERENCES "public"."cimavet_medicamento"("nregistro") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cimavet_med_tiempo_espera" ADD CONSTRAINT "cimavet_med_tiempo_espera_nregistro_cimavet_medicamento_nregistro_fk" FOREIGN KEY ("nregistro") REFERENCES "public"."cimavet_medicamento"("nregistro") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cimavet_med_via" ADD CONSTRAINT "cimavet_med_via_nregistro_cimavet_medicamento_nregistro_fk" FOREIGN KEY ("nregistro") REFERENCES "public"."cimavet_medicamento"("nregistro") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cimavet_presentacion" ADD CONSTRAINT "cimavet_presentacion_nregistro_cimavet_medicamento_nregistro_fk" FOREIGN KEY ("nregistro") REFERENCES "public"."cimavet_medicamento"("nregistro") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensacion" ADD CONSTRAINT "dispensacion_receta_linea_id_receta_linea_id_fk" FOREIGN KEY ("receta_linea_id") REFERENCES "public"."receta_linea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensacion" ADD CONSTRAINT "dispensacion_receta_id_receta_id_fk" FOREIGN KEY ("receta_id") REFERENCES "public"."receta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensacion" ADD CONSTRAINT "dispensacion_propietario_id_propietario_id_fk" FOREIGN KEY ("propietario_id") REFERENCES "public"."propietario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_pendiente" ADD CONSTRAINT "pedido_pendiente_receta_linea_id_receta_linea_id_fk" FOREIGN KEY ("receta_linea_id") REFERENCES "public"."receta_linea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta" ADD CONSTRAINT "receta_plataforma_id_plataforma_receta_electronica_id_fk" FOREIGN KEY ("plataforma_id") REFERENCES "public"."plataforma_receta_electronica"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta" ADD CONSTRAINT "receta_veterinario_id_veterinario_id_fk" FOREIGN KEY ("veterinario_id") REFERENCES "public"."veterinario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta" ADD CONSTRAINT "receta_propietario_id_propietario_id_fk" FOREIGN KEY ("propietario_id") REFERENCES "public"."propietario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta" ADD CONSTRAINT "receta_regla_version_id_regla_version_id_fk" FOREIGN KEY ("regla_version_id") REFERENCES "public"."regla_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_imagen" ADD CONSTRAINT "receta_imagen_receta_id_receta_id_fk" FOREIGN KEY ("receta_id") REFERENCES "public"."receta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_linea" ADD CONSTRAINT "receta_linea_receta_id_receta_id_fk" FOREIGN KEY ("receta_id") REFERENCES "public"."receta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sustitucion" ADD CONSTRAINT "sustitucion_receta_linea_id_receta_linea_id_fk" FOREIGN KEY ("receta_linea_id") REFERENCES "public"."receta_linea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recepcion" ADD CONSTRAINT "recepcion_distribuidor_id_distribuidor_id_fk" FOREIGN KEY ("distribuidor_id") REFERENCES "public"."distribuidor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recepcion_ajuste" ADD CONSTRAINT "recepcion_ajuste_recepcion_linea_id_recepcion_linea_id_fk" FOREIGN KEY ("recepcion_linea_id") REFERENCES "public"."recepcion_linea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recepcion_linea" ADD CONSTRAINT "recepcion_linea_recepcion_id_recepcion_id_fk" FOREIGN KEY ("recepcion_id") REFERENCES "public"."recepcion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cimavet_maestra_tipo_id_index" ON "cimavet_maestra" USING btree ("tipo","id");--> statement-breakpoint
CREATE INDEX "cimavet_med_indicacion_nregistro_index" ON "cimavet_med_indicacion" USING btree ("nregistro");--> statement-breakpoint
CREATE INDEX "cimavet_med_principio_activo_pa_id_index" ON "cimavet_med_principio_activo" USING btree ("pa_id");--> statement-breakpoint
CREATE INDEX "cimavet_med_tiempo_espera_nregistro_index" ON "cimavet_med_tiempo_espera" USING btree ("nregistro");--> statement-breakpoint
CREATE INDEX "cimavet_medicamento_estado_codigo_index" ON "cimavet_medicamento" USING btree ("estado_codigo");--> statement-breakpoint
CREATE INDEX "cimavet_presentacion_nregistro_index" ON "cimavet_presentacion" USING btree ("nregistro");--> statement-breakpoint
CREATE UNIQUE INDEX "procedimiento_aprobado_codigo_version_index" ON "procedimiento_aprobado" USING btree ("codigo","version");--> statement-breakpoint
CREATE UNIQUE INDEX "regla_version_nombre_fichero_hash_index" ON "regla_version" USING btree ("nombre_fichero","hash");--> statement-breakpoint
CREATE INDEX "siweb_tarea_estado_index" ON "siweb_tarea" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "siweb_tarea_prefijo_index" ON "siweb_tarea" USING btree ("prefijo");--> statement-breakpoint
CREATE UNIQUE INDEX "siweb_variant_map_cn_variant_id_index" ON "siweb_variant_map" USING btree ("cn","variant_id");--> statement-breakpoint
CREATE INDEX "siweb_variant_map_cn_index" ON "siweb_variant_map" USING btree ("cn");--> statement-breakpoint
CREATE INDEX "dispensacion_fecha_venta_index" ON "dispensacion" USING btree ("fecha_venta");--> statement-breakpoint
CREATE INDEX "dispensacion_receta_linea_id_index" ON "dispensacion" USING btree ("receta_linea_id");--> statement-breakpoint
CREATE INDEX "dispensacion_cn_lote_index" ON "dispensacion" USING btree ("cn","lote");--> statement-breakpoint
CREATE UNIQUE INDEX "dispensacion_anula_dispensacion_id_index" ON "dispensacion" USING btree ("anula_dispensacion_id");--> statement-breakpoint
CREATE INDEX "pedido_pendiente_estado_index" ON "pedido_pendiente" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "pedido_pendiente_cn_index" ON "pedido_pendiente" USING btree ("cn");--> statement-breakpoint
CREATE INDEX "propietario_dni_hash_index" ON "propietario" USING btree ("dni_hash");--> statement-breakpoint
CREATE INDEX "receta_numero_num_colegiado_index" ON "receta" USING btree ("numero","num_colegiado");--> statement-breakpoint
CREATE INDEX "receta_sha256_index" ON "receta" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "receta_phash_index" ON "receta" USING btree ("phash");--> statement-breakpoint
CREATE INDEX "receta_estado_index" ON "receta" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "receta_imagen_receta_id_pagina_index" ON "receta_imagen" USING btree ("receta_id","pagina");--> statement-breakpoint
CREATE UNIQUE INDEX "receta_linea_receta_id_orden_index" ON "receta_linea" USING btree ("receta_id","orden");--> statement-breakpoint
CREATE INDEX "revision_garante_entidad_entidad_id_index" ON "revision_garante" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "sustitucion_estado_index" ON "sustitucion" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "veterinario_num_colegiado_colegio_index" ON "veterinario" USING btree ("num_colegiado","colegio");--> statement-breakpoint
CREATE INDEX "recepcion_estado_index" ON "recepcion" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "recepcion_linea_recepcion_id_numero_index" ON "recepcion_linea" USING btree ("recepcion_id","numero");--> statement-breakpoint
CREATE INDEX "recepcion_linea_cn_index" ON "recepcion_linea" USING btree ("cn");--> statement-breakpoint
CREATE INDEX "audit_event_entidad_entidad_id_index" ON "audit_event" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "discrepancia_estado_index" ON "discrepancia" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_key_index" ON "outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_status_index" ON "outbox" USING btree ("status");