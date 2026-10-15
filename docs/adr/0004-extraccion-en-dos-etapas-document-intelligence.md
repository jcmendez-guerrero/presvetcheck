# ADR-04 · Extracción en dos etapas: Document Intelligence + Azure OpenAI

- **Estado:** sustituida por [ADR-12](./0012-extraccion-con-modelo-personalizado-de-document-intelligence.md) (15/10/2026)

## Contexto
El OCR da texto y confianza auditables; el LLM estructura los campos y detecta firma/sello. Datos personales sin salir de la UE.

## Decisión
`prebuilt-layout` (impreso y manuscrito en español, confianza por palabra) + modelo multimodal de Azure OpenAI en *Data Zone* UE con *structured outputs*.

## Alternativa descartada
Solo LLM (sin trazabilidad de confianza); solo OCR (no estructura recetas heterogéneas).
