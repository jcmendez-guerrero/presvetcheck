-- El farmacéutico garante no usa la app (sus revisiones se hacen fuera, sobre el reporte semanal).
DROP TABLE "revision_garante" CASCADE;--> statement-breakpoint
ALTER TABLE "discrepancia" ADD COLUMN "nota_resolucion" text;