# Recetas de prueba

Formato: `<nombre>.<jpg|png|pdf>` (imagen anonimizada) + `<nombre>.expected.json` (resultado esperado de la
extracción, esquema `ExtractionResult` de `packages/shared/src/schemas/extraccion.ts`).

- **Recetas reales anonimizadas:** las aporta JC (15–20 de formatos distintos: manuscritas, impresas,
  talonario colegial, electrónicas impresas). Todavía no hay ninguna en el repositorio.
- **`demo-*.expected.json`:** datos **sintéticos de demostración** (sin imagen, sin datos de personas
  reales) para que la UI sea navegable con `EXTRACTOR=fake`. No sirven para medir la extracción.
  Los valores `@HOY-n` se sustituyen por la fecha de hoy menos `n` días (Europe/Madrid).

`pnpm eval:extraction` recorre los pares imagen + JSON y calcula la exactitud por campo.
