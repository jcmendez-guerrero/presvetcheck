# ADR-11 · Región spaincentral con excepciones por servicio

- **Estado:** aceptada (SPEC §1)

## Contexto
Residencia de datos en la UE y latencia.

## Decisión
`spaincentral` si están Container Apps, PostgreSQL y Document Intelligence (con entrenamiento de modelos personalizados); si alguno no, `westeurope` o `swedencentral` para ese servicio. Azure OpenAI ya no se usa (ADR-12).

## Alternativa descartada
—
