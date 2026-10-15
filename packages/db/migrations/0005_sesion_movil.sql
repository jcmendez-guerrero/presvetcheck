CREATE TABLE "sesion_movil" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"usuario_id" text NOT NULL,
	"usuario_nombre" text NOT NULL,
	"roles" text[] NOT NULL,
	"expira_at" timestamp with time zone NOT NULL,
	"cerrada_at" timestamp with time zone,
	"movil_visto_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sesion_movil_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sesion_movil_evento" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"sesion_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"datos" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sesion_movil_evento" ADD CONSTRAINT "sesion_movil_evento_sesion_id_sesion_movil_id_fk" FOREIGN KEY ("sesion_id") REFERENCES "public"."sesion_movil"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sesion_movil_evento_sesion_id_seq_index" ON "sesion_movil_evento" USING btree ("sesion_id","seq");