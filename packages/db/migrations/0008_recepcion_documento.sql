ALTER TABLE "recepcion" ADD COLUMN "fecha_recepcion" date;--> statement-breakpoint
ALTER TABLE "recepcion" ADD COLUMN "lectura_documento" jsonb;--> statement-breakpoint
ALTER TABLE "recepcion" ADD COLUMN "documento_path" text;