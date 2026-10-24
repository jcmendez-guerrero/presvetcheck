-- Permisos del rol de la aplicación (mmx_app) sobre las tablas creadas después de 0001, y por defecto para las
-- futuras. La identidad gestionada de la app es miembro de mmx_app; las migraciones las ejecuta otra identidad
-- (dueña de las tablas). Sin UPDATE/DELETE en los registros (además de los triggers); los datos importados no se
-- modifican (el borrado por retención lo filtra su trigger: solo con la marca de purga y más de 5 años).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmx_app') THEN
    CREATE ROLE mmx_app NOLOGIN;
  END IF;
  GRANT USAGE ON SCHEMA public TO mmx_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mmx_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mmx_app;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO mmx_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mmx_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mmx_app;
  REVOKE UPDATE, DELETE, TRUNCATE ON dispensacion, audit_event, revision_garante, recepcion_ajuste FROM mmx_app;
  REVOKE UPDATE, TRUNCATE ON entrada_importada, salida_importada, conciliacion FROM mmx_app;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se han podido conceder los permisos del rol mmx_app: %', SQLERRM;
END $$;
