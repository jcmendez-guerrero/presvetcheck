-- Migración 0019: alta manual de recetas sin imagen (specs/011-manual-prescription-entry)
ALTER TABLE "receta" ADD COLUMN IF NOT EXISTS "origen" text DEFAULT 'escaneo' NOT NULL;
--> statement-breakpoint
ALTER TABLE "receta" ADD COLUMN IF NOT EXISTS "motivo_alta" text;
--> statement-breakpoint
ALTER TABLE "receta" ADD COLUMN IF NOT EXISTS "custodia_papel" text;
--> statement-breakpoint
ALTER TABLE "receta" ADD CONSTRAINT "receta_alta_manual_motivo" CHECK ("origen" <> 'manual' OR "motivo_alta" IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receta_origen_idx" ON "receta" USING btree ("origen");
