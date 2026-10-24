-- Corrige 0011: el REVOKE nombraba una tabla que ya no existe (revision_garante) y no se aplicaba. Tabla a tabla
-- y solo si existe: el rol de la app no puede modificar ni borrar los registros (además de los triggers).
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmx_app') THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['dispensacion', 'audit_event', 'recepcion_ajuste'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM mmx_app', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['entrada_importada', 'salida_importada', 'conciliacion'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, TRUNCATE ON public.%I FROM mmx_app', t);
    END IF;
  END LOOP;
END $$;
