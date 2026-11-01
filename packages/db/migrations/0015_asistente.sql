CREATE TABLE "asistente_consumo_mes" (
	"mes" text PRIMARY KEY NOT NULL,
	"tokens_entrada" bigint DEFAULT 0 NOT NULL,
	"tokens_salida" bigint DEFAULT 0 NOT NULL,
	"preguntas" integer DEFAULT 0 NOT NULL,
	"limite_tokens" bigint NOT NULL,
	"limite_ampliado" bigint,
	"ampliado_por" text,
	"ampliado_at" timestamp with time zone,
	"aviso_enviado_at" timestamp with time zone,
	"pausado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "asistente_conversacion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_oid" text NOT NULL,
	"usuario_nombre" text NOT NULL,
	"contexto_tipo" text NOT NULL,
	"receta_linea_id" uuid,
	"nregistro" text,
	"estado" text DEFAULT 'abierta' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrada_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "asistente_intercambio" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversacion_id" uuid NOT NULL,
	"orden" integer NOT NULL,
	"pregunta" text NOT NULL,
	"pii_eliminada" boolean DEFAULT false NOT NULL,
	"estado" text NOT NULL,
	"tipo_respuesta" text,
	"respuesta" text,
	"fuentes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"simulaciones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contexto_motor" jsonb,
	"regla_version" text NOT NULL,
	"fuentes_version" text NOT NULL,
	"modelo" text NOT NULL,
	"instrucciones_version" text NOT NULL,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_salida" integer DEFAULT 0 NOT NULL,
	"rondas_herramientas" integer DEFAULT 0 NOT NULL,
	"duracion_ms" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asistente_valoracion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intercambio_id" uuid NOT NULL,
	"usuario_oid" text NOT NULL,
	"valor" text NOT NULL,
	"comentario" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asistente_conversacion" ADD CONSTRAINT "asistente_conversacion_receta_linea_id_receta_linea_id_fk" FOREIGN KEY ("receta_linea_id") REFERENCES "public"."receta_linea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asistente_intercambio" ADD CONSTRAINT "asistente_intercambio_conversacion_id_asistente_conversacion_id_fk" FOREIGN KEY ("conversacion_id") REFERENCES "public"."asistente_conversacion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asistente_valoracion" ADD CONSTRAINT "asistente_valoracion_intercambio_id_asistente_intercambio_id_fk" FOREIGN KEY ("intercambio_id") REFERENCES "public"."asistente_intercambio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asistente_conversacion_usuario_oid_created_at_index" ON "asistente_conversacion" USING btree ("usuario_oid","created_at");--> statement-breakpoint
CREATE INDEX "asistente_conversacion_created_at_index" ON "asistente_conversacion" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asistente_intercambio_conversacion_id_orden_index" ON "asistente_intercambio" USING btree ("conversacion_id","orden");--> statement-breakpoint
CREATE INDEX "asistente_intercambio_created_at_index" ON "asistente_intercambio" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asistente_valoracion_intercambio_id_usuario_oid_index" ON "asistente_valoracion" USING btree ("intercambio_id","usuario_oid");--> statement-breakpoint
-- Asistente de consultas: los intercambios son de solo inserción. El único borrado admitido es el de la
-- retención de 1 año (la sesión activa mmx.purga_retencion y la fila tiene más de 1 año según el reloj del servidor).
CREATE OR REPLACE FUNCTION mmx_asistente_solo_insercion() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'La tabla % es de solo inserción', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('mmx.purga_retencion', true), '') = 'on'
     AND OLD.created_at < now() - interval '1 year' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La tabla % es de solo inserción', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER asistente_intercambio_solo_insercion BEFORE UPDATE OR DELETE ON asistente_intercambio
  FOR EACH ROW EXECUTE FUNCTION mmx_asistente_solo_insercion();
--> statement-breakpoint
CREATE TRIGGER asistente_intercambio_no_truncate BEFORE TRUNCATE ON asistente_intercambio
  FOR EACH STATEMENT EXECUTE FUNCTION mmx_asistente_solo_insercion();
--> statement-breakpoint
-- Permisos del rol de la app: los privilegios por defecto de 0010 ya conceden todo; aquí se revoca lo que los
-- intercambios no admiten (modificar y vaciar). El borrado lo filtra el trigger (solo retención).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmx_app') THEN
    REVOKE UPDATE, TRUNCATE ON asistente_intercambio FROM mmx_app;
  END IF;
END $$;
