-- La migración 0014 rehízo mmx_recepcion_linea_guard() para fijar los campos nuevos de la línea, pero perdió la
-- excepción de purga de la 0004: el job retention-sweep no podía borrar las líneas de recepciones finalizadas de
-- más de 5 años y fallaba entero. Se restaura la excepción (solo para DELETE, con la marca de purga de la sesión y
-- filas de más de 5 años, ver mmx_purga_permitida) y se conservan las comprobaciones de la 0014.
CREATE OR REPLACE FUNCTION mmx_recepcion_linea_guard() RETURNS trigger AS $$
DECLARE
  v_estado text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF mmx_purga_permitida(OLD.created_at) THEN RETURN OLD; END IF;
  END IF;
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
