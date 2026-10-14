# ADR-05 · Interfaz RecipeExtractor agnóstica de proveedor

- **Estado:** aceptada (SPEC §1)

## Contexto
Poder cambiar de modelo o volver a AWS sin tocar el dominio.

## Decisión
Puerto `RecipeExtractor` en `packages/domain`; implementaciones `FakeRecipeExtractor` y `AzureRecipeExtractor` en `packages/extraction`.

## Alternativa descartada
—
