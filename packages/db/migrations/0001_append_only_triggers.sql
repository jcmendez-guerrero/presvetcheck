-- Extensiones (SPEC §6, ADR-02). unaccent y pgcrypto son opcionales en entornos que no
-- las ofrecen (p. ej. PGlite en tests): la normalización de nombres se hace en la app.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS unaccent; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'unaccent no disponible'; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pgcrypto; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pgcrypto no disponible'; END $$;
--> statement-breakpoint

-- Búsqueda difusa de medicamentos y presentaciones (SPEC §4.2.1).
CREATE INDEX IF NOT EXISTS cimavet_medicamento_nombre_norm_trgm ON cimavet_medicamento USING gin (nombre_norm gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cimavet_presentacion_nombre_norm_trgm ON cimavet_presentacion USING gin (nombre_norm gin_trgm_ops);
--> statement-breakpoint

-- ── Tablas de registro append-only (SPEC §0.2, §6; AGENTS.md) ────────────────────
CREATE OR REPLACE FUNCTION mmx_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: las correcciones se hacen con un contramovimiento', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER dispensacion_append_only BEFORE UPDATE OR DELETE ON dispensacion
  FOR EACH ROW EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint
CREATE TRIGGER revision_garante_append_only BEFORE UPDATE OR DELETE ON revision_garante
  FOR EACH ROW EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint
CREATE TRIGGER recepcion_ajuste_append_only BEFORE UPDATE OR DELETE ON recepcion_ajuste
  FOR EACH ROW EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint
CREATE TRIGGER dispensacion_no_truncate BEFORE TRUNCATE ON dispensacion
  FOR EACH STATEMENT EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION mmx_append_only();
--> statement-breakpoint

-- Líneas de recepción: editables mientras la recepción está ABIERTA. Después solo pueden
-- cambiar los campos de sincronización (estado, siweb_variant_id); nunca se borran.
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
CREATE TRIGGER recepcion_linea_guard BEFORE UPDATE OR DELETE ON recepcion_linea
  FOR EACH ROW EXECUTE FUNCTION mmx_recepcion_linea_guard();
--> statement-breakpoint

-- No se añaden líneas a una recepción finalizada.
CREATE OR REPLACE FUNCTION mmx_recepcion_linea_insert_guard() RETURNS trigger AS $$
DECLARE
  v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM recepcion WHERE id = NEW.recepcion_id;
  IF v_estado IS DISTINCT FROM 'ABIERTA' THEN
    RAISE EXCEPTION 'recepción finalizada: no admite líneas nuevas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER recepcion_linea_insert_guard BEFORE INSERT ON recepcion_linea
  FOR EACH ROW EXECUTE FUNCTION mmx_recepcion_linea_insert_guard();
--> statement-breakpoint

-- Una recepción finalizada no vuelve a ABIERTA.
CREATE OR REPLACE FUNCTION mmx_recepcion_guard() RETURNS trigger AS $$
BEGIN
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
CREATE TRIGGER recepcion_guard BEFORE UPDATE OR DELETE ON recepcion
  FOR EACH ROW EXECUTE FUNCTION mmx_recepcion_guard();
--> statement-breakpoint

-- Vista con el estado de anulación derivado del contramovimiento.
CREATE OR REPLACE VIEW v_dispensacion AS
SELECT d.*, a.id AS anulada_por, a.motivo_anulacion AS motivo_de_anulacion, a.created_at AS anulada_at
FROM dispensacion d
LEFT JOIN dispensacion a ON a.anula_dispensacion_id = d.id
WHERE d.anula_dispensacion_id IS NULL;
--> statement-breakpoint

-- Rol de la aplicación: sin UPDATE/DELETE en tablas de registro (además del trigger).
-- En Azure el usuario de la identidad gestionada se añade a este rol (infra/README).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmx_app') THEN
    CREATE ROLE mmx_app NOLOGIN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mmx_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mmx_app;
  REVOKE UPDATE, DELETE, TRUNCATE ON dispensacion, audit_event, revision_garante, recepcion_ajuste FROM mmx_app;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se han podido crear los permisos del rol mmx_app: %', SQLERRM;
END $$;
