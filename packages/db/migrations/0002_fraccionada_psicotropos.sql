ALTER TABLE "cimavet_presentacion" ADD COLUMN "dispensacion_fraccionada" boolean;--> statement-breakpoint
ALTER TABLE "cimavet_presentacion" ADD COLUMN "fracciones_autorizadas" text;--> statement-breakpoint
ALTER TABLE "dispensacion" ADD COLUMN "unidades_forma" integer;--> statement-breakpoint
ALTER TABLE "dispensacion" ADD COLUMN "unidades_texto" text;--> statement-breakpoint
ALTER TABLE "dispensacion" ADD COLUMN "dni_retira_enc" text;--> statement-breakpoint
ALTER TABLE "receta_linea" ADD COLUMN "unidades_forma_prescritas" integer;--> statement-breakpoint
-- La vista se recrea para incluir las columnas nuevas (`d.*` se expande al crearla).
DROP VIEW IF EXISTS v_dispensacion;--> statement-breakpoint
CREATE VIEW v_dispensacion AS
SELECT d.*, a.id AS anulada_por, a.motivo_anulacion AS motivo_de_anulacion, a.created_at AS anulada_at
FROM dispensacion d
LEFT JOIN dispensacion a ON a.anula_dispensacion_id = d.id
WHERE d.anula_dispensacion_id IS NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmx_app') THEN
    GRANT SELECT ON v_dispensacion TO mmx_app;
  END IF;
END $$;
