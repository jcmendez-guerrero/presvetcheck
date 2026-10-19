CREATE TABLE "entrada_importada" (
	"id" uuid PRIMARY KEY NOT NULL,
	"importacion_id" uuid NOT NULL,
	"fila" integer NOT NULL,
	"fecha" date NOT NULL,
	"fecha_recepcion" date,
	"distribuidor" text NOT NULL,
	"albaran" text,
	"nombre_farmaco" text NOT NULL,
	"principio_activo" text,
	"forma" text,
	"cn" text,
	"lote" text,
	"caducidad" date,
	"unidades" integer NOT NULL,
	"precio_neto_compra" numeric(12, 4),
	"iva_pct" numeric(5, 2),
	"re_pct" numeric(5, 2),
	"precio_coste" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "importacion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"fichero" text NOT NULL,
	"sha256" text NOT NULL,
	"filas" integer NOT NULL,
	"creada_por" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anulada_at" timestamp with time zone,
	"anulada_por" text,
	"motivo_anulacion" text
);
--> statement-breakpoint
CREATE TABLE "salida_importada" (
	"id" uuid PRIMARY KEY NOT NULL,
	"importacion_id" uuid NOT NULL,
	"fila" integer NOT NULL,
	"fecha" date NOT NULL,
	"plantilla" text NOT NULL,
	"nombre_farmaco" text NOT NULL,
	"principio_activo" text,
	"forma" text,
	"especie" text,
	"cn" text,
	"lote" text,
	"caducidad" date,
	"unidades" integer,
	"unidades_texto" text,
	"fecha_receta" date,
	"numero_receta" text,
	"veterinario" text,
	"num_colegiado" text,
	"clinica" text,
	"direccion_veterinario" text,
	"propietario_nombre_enc" text,
	"propietario_movil_enc" text,
	"propietario_dni_enc" text,
	"propietario_direccion_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entrada_importada" ADD CONSTRAINT "entrada_importada_importacion_id_importacion_id_fk" FOREIGN KEY ("importacion_id") REFERENCES "public"."importacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salida_importada" ADD CONSTRAINT "salida_importada_importacion_id_importacion_id_fk" FOREIGN KEY ("importacion_id") REFERENCES "public"."importacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entrada_importada_fecha_index" ON "entrada_importada" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "entrada_importada_importacion_id_index" ON "entrada_importada" USING btree ("importacion_id");--> statement-breakpoint
CREATE INDEX "salida_importada_fecha_index" ON "salida_importada" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "salida_importada_importacion_id_index" ON "salida_importada" USING btree ("importacion_id");--> statement-breakpoint
-- Datos importados: de solo inserción. Solo se borran por retención (sesión con la marca de purga y movimiento
-- de más de 5 años, como el resto de registros; migración 0004). Para corregir, se anula la importación.
CREATE OR REPLACE FUNCTION mmx_importado_solo_insercion() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND mmx_purga_permitida(OLD.fecha::timestamptz) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La tabla % es de solo inserción (datos importados): para corregir, anula la importación', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER entrada_importada_solo_insercion BEFORE UPDATE OR DELETE ON "entrada_importada" FOR EACH ROW EXECUTE FUNCTION mmx_importado_solo_insercion();
--> statement-breakpoint
CREATE TRIGGER salida_importada_solo_insercion BEFORE UPDATE OR DELETE ON "salida_importada" FOR EACH ROW EXECUTE FUNCTION mmx_importado_solo_insercion();
