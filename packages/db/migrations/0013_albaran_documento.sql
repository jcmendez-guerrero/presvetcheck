CREATE TABLE "albaran_documento" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"documento_path" text NOT NULL,
	"mime" text NOT NULL,
	"lectura" jsonb NOT NULL,
	"recepcion_id" uuid,
	"creado_por" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "albaran_documento" ADD CONSTRAINT "albaran_documento_recepcion_id_recepcion_id_fk" FOREIGN KEY ("recepcion_id") REFERENCES "public"."recepcion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "albaran_documento_sha256_index" ON "albaran_documento" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "albaran_documento_recepcion_id_index" ON "albaran_documento" USING btree ("recepcion_id");