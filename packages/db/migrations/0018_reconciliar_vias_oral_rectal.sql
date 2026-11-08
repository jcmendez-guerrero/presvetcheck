-- Migración 0018: Reconciliar vías de administración oral (54) y rectal (59) en cimavet_maestra y cimavet_med_via (FR-019)
UPDATE cimavet_med_via SET via_id = 54
WHERE via_id = 48
  AND NOT EXISTS (
    SELECT 1 FROM cimavet_med_via v2
    WHERE v2.nregistro = cimavet_med_via.nregistro AND v2.via_id = 54
  );
--> statement-breakpoint
DELETE FROM cimavet_med_via WHERE via_id = 48;
--> statement-breakpoint
UPDATE cimavet_maestra
SET id = 59, clave = '59', nombre = 'VÍA RECTAL'
WHERE tipo = 3 AND (id = 54 OR clave = '54') AND nombre ILIKE '%rectal%';
--> statement-breakpoint
INSERT INTO cimavet_maestra (tipo, clave, id, codigo, nombre)
VALUES (3, '54', 54, '54', 'VÍA ORAL')
ON CONFLICT (tipo, clave) DO UPDATE SET id = 54, nombre = 'VÍA ORAL';
--> statement-breakpoint
INSERT INTO cimavet_maestra (tipo, clave, id, codigo, nombre)
VALUES (3, '59', 59, '59', 'VÍA RECTAL')
ON CONFLICT (tipo, clave) DO UPDATE SET id = 59, nombre = 'VÍA RECTAL';
