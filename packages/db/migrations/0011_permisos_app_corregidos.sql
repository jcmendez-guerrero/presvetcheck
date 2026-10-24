-- Corrige 0010: en Azure la identidad de migraciones no puede conceder EXECUTE sobre las funciones de pg_trgm
-- (son del administrador) y ese fallo deshacía el bloque entero. Cada permiso va en su propio bloque y solo sobre
-- objetos propios; un fallo se avisa (NOTICE) sin anular los demás. Las funciones ya son ejecutables por PUBLIC.
DO $$
DECLARE
  sentencias text[] := ARRAY[
    'GRANT USAGE ON SCHEMA public TO mmx_app',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mmx_app',
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mmx_app',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mmx_app',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mmx_app',
    'REVOKE UPDATE, DELETE, TRUNCATE ON dispensacion, audit_event, revision_garante, recepcion_ajuste FROM mmx_app',
    'REVOKE UPDATE, TRUNCATE ON entrada_importada, salida_importada, conciliacion FROM mmx_app'
  ];
  s text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmx_app') THEN
    RAISE NOTICE 'Falta el rol mmx_app (créalo como administrador: infra/np/README.md)';
    RETURN;
  END IF;
  FOREACH s IN ARRAY sentencias LOOP
    BEGIN
      EXECUTE s;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Permiso no aplicado (%): %', s, SQLERRM;
    END;
  END LOOP;
END $$;
