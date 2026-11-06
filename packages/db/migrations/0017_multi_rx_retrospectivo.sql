-- Migración 0017: Multi-receta por ticket y modo retrospectivo (specs/004-multi-rx-ticket-training-mode, D-11, D-14)
ALTER TABLE "dispensacion" ADD COLUMN IF NOT EXISTS "modo" text DEFAULT 'en_vivo' NOT NULL;
--> statement-breakpoint
ALTER TABLE "dispensacion" ADD COLUMN IF NOT EXISTS "fecha_original" date;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_receta" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"ticket_numero" text NOT NULL,
	"receta_id" uuid NOT NULL,
	"fecha_vinculacion" timestamp with time zone NOT NULL,
	"usuario_id" text NOT NULL,
	"estado" text DEFAULT 'vinculado' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_receta_receta_id_unique" UNIQUE("receta_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_receta_ticket_id_idx" ON "ticket_receta" USING btree ("ticket_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_receta_ticket_numero_idx" ON "ticket_receta" USING btree ("ticket_numero");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidencia_stock_retrospectiva" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispensacion_id" uuid NOT NULL,
	"cn" text NOT NULL,
	"variant_id" integer,
	"fecha_original" date NOT NULL,
	"movimientos_consultados" jsonb NOT NULL,
	"unidades_requeridas" integer NOT NULL,
	"unidades_encontradas" integer NOT NULL,
	"resultado" text NOT NULL,
	"forzado" boolean DEFAULT false NOT NULL,
	"motivo_forzado" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidencia_stock_retrospectiva_dispensacion_id_unique" UNIQUE("dispensacion_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidencia_stock_retrospectiva_dispensacion_id_idx" ON "evidencia_stock_retrospectiva" USING btree ("dispensacion_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidencia_stock_retrospectiva_cn_fecha_idx" ON "evidencia_stock_retrospectiva" USING btree ("cn", "fecha_original");
