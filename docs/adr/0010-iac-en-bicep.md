# ADR-10 · IaC en Bicep

- **Estado:** aceptada (SPEC §1)

## Contexto
Nativo de Azure, sin estado remoto que gestionar; compatible con `azd`.

## Decisión
`infra/main.bicep` + módulos simétricos.

## Alternativa descartada
Terraform (válido si JC lo prefiere; mantener módulos simétricos).
