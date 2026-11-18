-- Migración 0022: contacto proveedor de Siweb360 recordado en el distribuidor (specs/016).
-- Nulo hasta que se resuelve por CIF o se vincula en administración. Reversible: DROP COLUMN sin pérdida de datos de negocio.
ALTER TABLE "distribuidor" ADD COLUMN IF NOT EXISTS "siweb_contact_id" integer;
