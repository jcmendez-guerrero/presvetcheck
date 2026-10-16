CREATE TABLE "conciliacion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispensacion_id" uuid NOT NULL,
	"movimiento_id" text NOT NULL,
	"ticket" text,
	"lote_verificado" boolean NOT NULL,
	"origen" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "conciliacion_dispensacionId_unique" UNIQUE("dispensacion_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_demo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"numero" text NOT NULL,
	"cn" text NOT NULL,
	"unidades" integer NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"creado_por" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "conciliacion_movimiento_id_index" ON "conciliacion" USING btree ("movimiento_id");