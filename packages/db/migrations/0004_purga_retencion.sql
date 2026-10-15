-- Retención (SPEC §9.2, DUDA-24 resuelta): pasados 5 años los datos SE ELIMINAN. Las tablas de registro
-- siguen siendo de solo inserción; la única excepción es el borrado por retención, que exige a la vez:
--   1) que la sesión lo active explícitamente (SET LOCAL mmx.purga_retencion = 'on', lo hace el job), y
--   2) que la fila tenga más de 5 años según el reloj del servidor.
-- UPDATE sigue prohibido siempre. El rastro de auditoría (audit_event) no contiene datos personales y se
-- conserva íntegro para que la cadena de hashes siga verificable.
CREATE OR REPLACE FUNCTION mmx_purga_permitida(creado timestamptz) RETURNS boolean AS $$
  SELECT coalesce(current_setting('mmx.purga_retencion', true), '') = 'on'
     AND creado < now() - interval '5 years';
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mmx_append_only() RETURNS trigger AS $$
BEGIN
  -- Condiciones anidadas: audit_event no tiene created_at (y nunca se purga).
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('dispensacion', 'recepcion_ajuste') THEN
    IF mmx_purga_permitida(OLD.created_at) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'La tabla % es de solo inserción: las correcciones se hacen con un contramovimiento', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
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
        NEW.iva_pct, NEW.re_pct, NEW.precio_coste, NEW.origen_datos, NEW.empleado, NEW.created_at)
       IS DISTINCT FROM
       (OLD.recepcion_id, OLD.numero, OLD.tipo, OLD.cn, OLD.nregistro, OLD.nombre_farmaco, OLD.principio_activo_txt,
        OLD.forma_txt, OLD.lote, OLD.caducidad, OLD.unidades, OLD.seriales, OLD.gtin, OLD.precio_neto_compra,
        OLD.iva_pct, OLD.re_pct, OLD.precio_coste, OLD.origen_datos, OLD.empleado, OLD.created_at) THEN
      RAISE EXCEPTION 'recepcion_linea finalizada: los datos registrados no se pueden modificar' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mmx_recepcion_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF mmx_purga_permitida(OLD.created_at) THEN RETURN OLD; END IF;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'recepción finalizada: no se puede borrar' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado <> 'ABIERTA' AND NEW.estado = 'ABIERTA' THEN
    RAISE EXCEPTION 'recepción finalizada: no se puede reabrir' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Las tablas de registro (dispensacion, recepcion_ajuste) solo se purgan con esta función: el rol de la
-- aplicación NO tiene DELETE sobre ellas, solo puede ejecutarla. Nunca borra con menos de 5 años.
CREATE OR REPLACE FUNCTION mmx_purgar_registros(limite timestamptz) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lim timestamptz := least(limite, now() - interval '5 years');
  v_disp int;
  v_aj int;
BEGIN
  PERFORM set_config('mmx.purga_retencion', 'on', true);
  -- No se borra un original cuya anulación (contramovimiento) es posterior al límite.
  DELETE FROM dispensacion d
   WHERE d.created_at < v_lim
     AND NOT EXISTS (SELECT 1 FROM dispensacion a WHERE a.anula_dispensacion_id = d.id AND a.created_at >= v_lim);
  GET DIAGNOSTICS v_disp = ROW_COUNT;
  DELETE FROM recepcion_ajuste WHERE created_at < v_lim;
  GET DIAGNOSTICS v_aj = ROW_COUNT;
  RETURN jsonb_build_object('dispensaciones', v_disp, 'ajustes', v_aj, 'limite', v_lim);
END;
$$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmx_app') THEN
    REVOKE ALL ON FUNCTION mmx_purgar_registros(timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION mmx_purgar_registros(timestamptz) TO mmx_app;
  END IF;
END $$;
