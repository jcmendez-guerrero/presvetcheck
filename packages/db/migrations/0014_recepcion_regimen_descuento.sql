ALTER TABLE "recepcion" ADD COLUMN "regimen" text DEFAULT 'recargo_equivalencia' NOT NULL;--> statement-breakpoint
ALTER TABLE "recepcion" ADD COLUMN "descartada_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recepcion" ADD COLUMN "descartada_por" text;--> statement-breakpoint
ALTER TABLE "recepcion" ADD COLUMN "motivo_descarte" text;--> statement-breakpoint
ALTER TABLE "recepcion_linea" ADD COLUMN "precio_bruto" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "recepcion_linea" ADD COLUMN "descuento_pct" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "recepcion_linea" ADD COLUMN "actualizar_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "recepcion_linea" ADD COLUMN "actualizar_precio" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Los campos nuevos de la línea (precio bruto, descuento y las casillas de stock y precio) también quedan fijos al
-- finalizar la recepción. Una recepción DESCARTADA tampoco se modifica (no es ABIERTA).
CREATE OR REPLACE FUNCTION mmx_recepcion_linea_guard() RETURNS trigger AS $$
DECLARE
  v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM recepcion WHERE id = OLD.recepcion_id;
  IF v_estado IS DISTINCT FROM 'ABIERTA' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'recepcion_linea finalizada: no se puede borrar' USING ERRCODE = 'restrict_violation';
    END IF;
    IF (NEW.recepcion_id, NEW.numero, NEW.tipo, NEW.cn, NEW.nregistro, NEW.nombre_farmaco, NEW.principio_activo_txt,
        NEW.forma_txt, NEW.lote, NEW.caducidad, NEW.unidades, NEW.seriales, NEW.gtin, NEW.precio_neto_compra,
        NEW.iva_pct, NEW.re_pct, NEW.precio_coste, NEW.origen_datos, NEW.empleado, NEW.created_at,
        NEW.precio_bruto, NEW.descuento_pct, NEW.actualizar_stock, NEW.actualizar_precio)
       IS DISTINCT FROM
       (OLD.recepcion_id, OLD.numero, OLD.tipo, OLD.cn, OLD.nregistro, OLD.nombre_farmaco, OLD.principio_activo_txt,
        OLD.forma_txt, OLD.lote, OLD.caducidad, OLD.unidades, OLD.seriales, OLD.gtin, OLD.precio_neto_compra,
        OLD.iva_pct, OLD.re_pct, OLD.precio_coste, OLD.origen_datos, OLD.empleado, OLD.created_at,
        OLD.precio_bruto, OLD.descuento_pct, OLD.actualizar_stock, OLD.actualizar_precio) THEN
      RAISE EXCEPTION 'recepcion_linea finalizada: los datos registrados no se pueden modificar' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
