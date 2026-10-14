# ADR-11 · Región spaincentral con excepciones por servicio

- **Estado:** aceptada (SPEC §1)

## Contexto
Residencia de datos en la UE y latencia.

## Decisión
`spaincentral` si están Container Apps, PostgreSQL, Document Intelligence y Azure OpenAI Data Zone UE; si alguno no, `westeurope` o `swedencentral` para ese servicio (`locationOpenAi`).

## Alternativa descartada
—
