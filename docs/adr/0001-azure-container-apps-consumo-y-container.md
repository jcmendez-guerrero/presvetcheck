# ADR-01 · Azure Container Apps (Consumo) y Container Apps Jobs

- **Estado:** aceptada (SPEC §1)

## Contexto
Volumen muy bajo (decenas de recetas/día, horario comercial). Escala a cero y cabe en la cuota gratuita mensual (180.000 vCPU-s, 360.000 GiB-s, 2 M de peticiones): cómputo ≈ 0–5 €/mes.

## Decisión
API + SPA en la app `mmx-api` y tareas programadas como Container Apps Jobs, entorno *workload profiles* solo con perfil Consumo. Imágenes OCI estándar y configuración 12-factor para poder migrar a AKS añadiendo manifiestos.

## Alternativa descartada
AKS Free tier: plano de control gratis pero nodos, disco, balanceador e IP de pago; Microsoft no lo recomienda para producción y añade operación (upgrades, ingress, certificados).
