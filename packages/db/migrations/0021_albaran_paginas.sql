-- Migración 0021: todas las páginas de un albarán leído desde el móvil o el ordenador (specs/013).
-- Nulo en las filas antiguas: una sola página (`documento_path`).
ALTER TABLE "albaran_documento" ADD COLUMN IF NOT EXISTS "paginas" jsonb;
