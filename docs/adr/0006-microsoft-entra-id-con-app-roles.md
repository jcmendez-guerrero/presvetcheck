# ADR-06 · Microsoft Entra ID con app roles

- **Estado:** aceptada (SPEC §1)

## Contexto
Gratis, MFA para administración (aprobar reglas, exportar con DNI completo), sin gestionar contraseñas. El farmacéutico garante no usa la app (JC, 15/10/2026).

## Decisión
App registration con *app roles* y autenticación integrada de Container Apps + validación del token/principal en la API.

## Alternativa descartada
Autenticación propia.
