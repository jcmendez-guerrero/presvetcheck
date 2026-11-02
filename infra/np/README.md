# Despliegue sobre recursos existentes (np)

Entorno actual (también producción hasta que haga falta escalar). Todo lo nuevo va en `<grupo>`,
región **North Europe** (la de la VNet). Se reutilizan:

| Recurso | Grupo | Uso |
| --- | --- | --- |
| VNet `<vnet>` + subred nueva `<subred-container-apps>` (<x.x.x.x/27>, delegada) | `<grupo-red>` | Entorno de Container Apps |
| PostgreSQL `<servidor-postgres>` (endpoint privado, autenticación Entra) | `<grupo>` | Base `mmx` |
| Key Vault `<key-vault>` | `<grupo-recursos-compartidos>` | `<secreto-token-siweb>`, `mmx-column-encryption-key`, `mmx-entra-client-secret` |
| ACR `<acr>` | `<grupo-recursos-compartidos>` | Imagen `mmx-recetas:<sha>` |
| Identidad `<identidad-app>` | `<grupo>` | App y jobs (rol `mmx_app` en PostgreSQL) |
| Document Intelligence `<document-intelligence>`, storage `<cuenta-de-storage>` | `<grupo>` | Lectura de recetas y albaranes; contenedores `recetas` (inmutable 5 años), `reportes`, `albaranes` |

Nuevo: identidad de migraciones `<identidad-migraciones>` (dueña de las tablas), Log Analytics,
Application Insights, grupo de alertas, presupuesto, entorno `azu-cae-presvetcheck-np-01`, app
`azu-ca-presvetcheck-np-01` y jobs `azu-caj-*-np`. Registro de Entra ID `mmx-recetas-np` (roles empleado,
veterinaria_responsable, admin).

## Fases
```bash
# 1. Base (identidad de migraciones, subred, monitorización, storage, permisos)
az deployment group create -g <grupo> -n presvetcheck-base -f infra/np/main.bicep -p infra/np/main.bicepparam
# 2. Container Apps (con la imagen ya en el ACR)
CREAR_APPS=true IMAGEN=<acr>-<hash>.azurecr.io/mmx-recetas:<sha> ENTRA_CLIENT_ID=<appId> \
  az deployment group create -g <grupo> -n presvetcheck-apps -f infra/np/main.bicep -p infra/np/main.bicepparam
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

## Asistente de consultas
En np está activado con **Gemini** (`ASSISTANT=gemini`, modelo `gemini-3.5-flash-lite`). No crea recursos ni claves: la
app lee la clave del secreto `gcp-gemini-api-key` de `<key-vault>`, que `<identidad-app>` ya puede
leer (*Key Vault Secrets User* sobre el almacén). Para cambiar de modelo, `ASISTENTE_DESPLIEGUE=<modelo>`; para usar
Azure OpenAI o Foundry, `ASISTENTE=azure ASISTENTE_ENDPOINT=https://<recurso>.openai.azure.com ASISTENTE_DESPLIEGUE=<despliegue>`;
para apagarlo, `ASISTENTE=off`. El límite mensual de tokens es `asistenteLimiteTokens` (3.000.000 por defecto). Las
preguntas salen a Google: usar solo datos de prueba hasta que protección de datos lo valide y el RAT de Facilita esté
actualizado (DUDA-29). El aviso del 80 % usa `REPORT_RECIPIENTS`.

