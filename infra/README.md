# Infraestructura (Bicep)

`main.bicep` despliega en un grupo de recursos `rg-mmx-recetas-{dev|prod}` todo lo de SPEC §10.1:
identidad gestionada, Log Analytics con límite diario + Application Insights + alertas, VNet, Key Vault (RBAC),
Storage con inmutabilidad de 5 años y ciclo de vida, PostgreSQL Flexible B1ms (PG16, privado), Document
Intelligence (modelo personalizado, ADR-12; contenedor privado `docintel-entrenamiento`), entorno de Container Apps (Consumo) con la app `mmx-api`, los jobs y
el presupuesto con avisos al 50/80/100 %.

## Validar y desplegar
```bash
az group create -n rg-mmx-recetas-dev -l spaincentral
PG_ADMIN_PASSWORD='…' az deployment group what-if -g rg-mmx-recetas-dev -f infra/main.bicep -p infra/main.dev.bicepparam
PG_ADMIN_PASSWORD='…' az deployment group create  -g rg-mmx-recetas-dev -f infra/main.bicep -p infra/main.dev.bicepparam
```
Antes, rellena en `main.{dev,prod}.bicepparam` la imagen de GHCR, el `entraClientId` de la app registration y
los correos. Comprueba la disponibilidad de servicios en `spaincentral` (ADR-11), en
particular el entrenamiento de modelos personalizados de Document Intelligence. Tras entrenar el modelo
(docs/extraccion-docintel.md), pon su id en `modeloDocIntel` y vuelve a desplegar; mientras esté vacío la app
funciona con entrada manual.

## Secretos en Key Vault (se cargan fuera de la plantilla)
| Secreto | Uso |
|---|---|
| `database-url` | `postgres://mmx_app_user:…@<fqdn>:5432/mmx?sslmode=require` |
| `column-encryption-key` | Clave AES-256 (32 bytes en base64) de las columnas personales |
| `siweb-token` | Token Bearer de Siweb360 |
| `smtp-password` | Contraseña SMTP (Google Workspace) si `MAILER=smtp` |
| `entra-client-secret` | Secreto de la app registration para la autenticación integrada |

El usuario de base de datos de la app debe pertenecer al rol `mmx_app` (creado por la migración), que **no** tiene
UPDATE/DELETE en las tablas de registro: `GRANT mmx_app TO mmx_app_user;`.

## Entra ID
App registration con *app roles* `empleado`, `veterinaria_responsable` y `admin` (SPEC §9.1; el
farmacéutico garante no usa la app: sus actuaciones las registra el empleado), *redirect URI*
`https://<fqdn>/.auth/login/aad/callback` y acceso condicional con MFA para `admin` (aprobación de reglas y
exportación con DNI completo). La autenticación integrada de Container Apps es obligatoria; la API además
valida el principal (`AUTH_EASYAUTH=true`) o el Bearer.

## Jobs (cron en UTC)
| Job | Cron UTC | Hora en Madrid (verano / invierno) |
|---|---|---|
| `cimavet-delta` | `30 4 * * *` | 06:30 / 05:30 |
| `cimavet-full` | `0 1 * * 0` | domingo 03:00 / 02:00 |
| `outbox-dispatcher` | `*/5 8-19 * * 1-6` | cada 5 min, 10:00–21:55 / 09:00–20:55 |
| `sales-reconciliation` | `0 19 * * *` | 21:00 / 20:00 |
| `weekly-reports` | `0 5 * * 1` | lunes 07:00 / 06:00 |
| `retention-sweep` | `0 2 1 * *` | día 1, 04:00 / 03:00 |
| `nomenclator-import`, `db-migrate` | manual | — |

La réplica caliente de la app (D-08) usa reglas KEDA `cron` con zona `Europe/Madrid`, así que no depende del
cambio de hora: L–V 10:15–20:15 y S 10:15–14:15 con `minReplicas=1`; el resto, 0.

## Pendiente
- `what-if` contra una suscripción real (no ejecutado desde el entorno de desarrollo).
- Autenticación de PostgreSQL con Entra (token) en lugar de usuario/contraseña en Key Vault.
