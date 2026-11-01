# Despliegue sobre recursos existentes (np)

Entorno actual (también producción hasta que haga falta escalar). Todo lo nuevo va en `azu-rg-presvetcheck-np-01`,
región **North Europe** (la de la VNet). Se reutilizan:

| Recurso | Grupo | Uso |
|---|---|---|
| VNet `azu-vnet-np-02` + subred nueva `azu-snet-presvetcheck-aca-np-01` (10.0.130.0/27, delegada) | `azu-rg-vnet-np-01` | Entorno de Container Apps |
| PostgreSQL `azu-psql-flex-neu-np-01` (endpoint privado, autenticación Entra) | `azu-rg-presvetcheck-np-01` | Base `mmx` |
| Key Vault `azukvappmascotix01` | `azu-rg-shared-np-01` | `azu-siweb-prod-api-key-01`, `mmx-column-encryption-key`, `mmx-entra-client-secret` |
| ACR `azuacrsharedmaxnp01` | `azu-rg-shared-np-01` | Imagen `mmx-recetas:<sha>` |
| Identidad `azu-umi-presvetcheck-np-01` | `azu-rg-presvetcheck-np-01` | App y jobs (rol `mmx_app` en PostgreSQL) |
| Document Intelligence `azu-di-presvetcheck-np-neu-01`, storage `azusadipvcnpneu01` | `azu-rg-presvetcheck-np-01` | Lectura de recetas y albaranes; contenedores `recetas` (inmutable 5 años), `reportes`, `albaranes` |

Nuevo: identidad de migraciones `azu-umi-presvetcheck-migr-np-01` (dueña de las tablas), Log Analytics,
Application Insights, grupo de alertas, presupuesto, entorno `azu-cae-presvetcheck-np-01`, app
`azu-ca-presvetcheck-np-01` y jobs `azu-caj-*-np`. Registro de Entra ID `mmx-recetas-np` (roles empleado,
veterinaria_responsable, admin).

## Fases
```bash
# 1. Base (identidad de migraciones, subred, monitorización, storage, permisos)
az deployment group create -g azu-rg-presvetcheck-np-01 -n presvetcheck-base -f infra/np/main.bicep -p infra/np/main.bicepparam
# 2. Container Apps (con la imagen ya en el ACR)
CREAR_APPS=true IMAGEN=azuacrsharedmaxnp01-b0e4ahfdgxbebvch.azurecr.io/mmx-recetas:<sha> ENTRA_CLIENT_ID=<appId> \
  az deployment group create -g azu-rg-presvetcheck-np-01 -n presvetcheck-apps -f infra/np/main.bicep -p infra/np/main.bicepparam
```

## Preparación de PostgreSQL (una vez, como administrador de Entra)
En `postgres`: `pgaadauth_create_principal` para las dos identidades. En `mmx`: `CREATE EXTENSION pg_trgm`,
rol `mmx_app` (NOLOGIN), `CREATE` en la base y en `public` para la identidad de migraciones, `GRANT mmx_app` a la
identidad de la app (y a la de migraciones con ADMIN OPTION, para que conceda permisos sobre sus tablas). La
extensión `PG_TRGM` debe estar permitida en `azure.extensions`.

## Primera puesta en marcha
1. `azu-caj-db-migrate-np` (migraciones).
2. `azu-caj-procedimiento-cargar-np` con `--version`, `--aprobado-por` y `--texto-b64` (directrices de sustitución):
   en modo POST la app no arranca sin procedimiento vigente.
3. `azu-caj-nomenclator-import-np` (Nomenclátor de CIMAVet).
4. Asignar a cada usuario su rol en la aplicación empresarial `mmx-recetas-np`.

Correo: `MAILER=console` (los reportes se descargan desde la app); SMTP en una segunda fase.

## Asistente de consultas (opcional)
`ASSISTANT=off` por defecto. No crea recursos ni claves: usa un despliegue de chat de Azure OpenAI o Foundry **ya
existente en la UE** al que la identidad `azu-umi-presvetcheck-np-01` tiene acceso. Para activarlo, en la fase 2:
`ASISTENTE=azure ASISTENTE_ENDPOINT=https://<recurso>.openai.azure.com ASISTENTE_DESPLIEGUE=<despliegue>` (el límite
mensual de tokens es `asistenteLimiteTokens`, 3.000.000 por defecto). Antes de activarlo: ADR-16 aprobado y el RAT de
Facilita actualizado (DUDA-29). El aviso del 80 % usa `REPORT_RECIPIENTS`.

