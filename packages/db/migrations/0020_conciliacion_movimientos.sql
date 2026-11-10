-- Migración 0019: verificación de envíos dudosos y conciliación de movimientos de Siweb360 (specs/011).
ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "verificaciones" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "siweb_movimiento" (
  "id" bigint PRIMARY KEY NOT NULL,
  "variant_id" bigint NOT NULL,
  "cn" text,
  "warehouse_id" bigint,
  "quantity" integer NOT NULL,
  "reason" text NOT NULL,
  "reference_type" text,
  "reference_id" text,
  "reference_number" text,
  "batch_number" text,
  "expiry_date" date,
  "notes" text,
  "created_at_siweb" timestamp with time zone NOT NULL,
  "leido_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siweb_movimiento_created_at_siweb_index" ON "siweb_movimiento" USING btree ("created_at_siweb");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siweb_movimiento_cn_index" ON "siweb_movimiento" USING btree ("cn");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "movimiento_justificacion" (
  "id" uuid PRIMARY KEY NOT NULL,
  "movimiento_id" bigint NOT NULL REFERENCES "siweb_movimiento"("id"),
  "tipo" text NOT NULL,
  "recepcion_linea_id" uuid,
  "dispensacion_id" uuid,
  "motivo" text,
  "nota" text,
  "sustituye_a" uuid REFERENCES "movimiento_justificacion"("id"),
  "actor" text NOT NULL,
  "at" timestamp with time zone NOT NULL,
  CONSTRAINT "movimiento_justificacion_tipo_check" CHECK (
    ("tipo" IN ('AUTO_RECEPCION', 'VINCULO_RECEPCION') AND "recepcion_linea_id" IS NOT NULL)
    OR ("tipo" IN ('AUTO_VENTA', 'VINCULO_DISPENSACION') AND "dispensacion_id" IS NOT NULL)
    OR ("tipo" = 'MOTIVO' AND "motivo" IS NOT NULL)
  ),
  CONSTRAINT "movimiento_justificacion_nota_check" CHECK (
    "tipo" LIKE 'AUTO_%' OR length(coalesce("nota", '')) >= 5
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movimiento_justificacion_movimiento_id_index" ON "movimiento_justificacion" USING btree ("movimiento_id");
--> statement-breakpoint
-- Una justificación solo puede sustituirse una vez (la cadena de correcciones es lineal).
CREATE UNIQUE INDEX IF NOT EXISTS "movimiento_justificacion_sustituye_a_unique" ON "movimiento_justificacion" ("sustituye_a") WHERE "sustituye_a" IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER siweb_movimiento_append_only BEFORE UPDATE OR DELETE ON siweb_movimiento
  FOR EACH ROW EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint
CREATE TRIGGER movimiento_justificacion_append_only BEFORE UPDATE OR DELETE ON movimiento_justificacion
  FOR EACH ROW EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint
CREATE TRIGGER movimiento_justificacion_no_truncate BEFORE TRUNCATE ON movimiento_justificacion
  FOR EACH STATEMENT EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmx_app') THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['siweb_movimiento', 'movimiento_justificacion'] LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM mmx_app', t);
  END LOOP;
END $$;
