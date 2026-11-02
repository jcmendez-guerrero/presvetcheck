# Despliegue sobre recursos existentes (np)

Entorno actual (también producción hasta que haga falta escalar). Reutiliza recursos compartidos ya existentes
(VNet, PostgreSQL Flexible con endpoint privado y autenticación Entra, Key Vault, ACR, identidad gestionada,
Document Intelligence y storage) y crea lo nuevo en el grupo del proyecto, en la región de la VNet.

**Los nombres reales de recursos, rangos de red, el appId de Entra y los correos no se versionan** (repositorio
público). Están en Confluence ([PreVetCheck › Infraestructura np](https://mundomascotix.atlassian.net/wiki/spaces/CDE/pages/753665)) y en el fichero local `infra/np/main.bicepparam`, ignorado por git:

```bash
cp infra/np/main.bicepparam.example infra/np/main.bicepparam   # y rellenar con los valores de Confluence
```

| Rol | Parámetro | Uso |
| --- | --- | --- |
| VNet + subred delegada (/27) | `rgRed`, `vnetNombre`, `subredNombre`, `subredPrefijo` | Entorno de Container Apps |
| PostgreSQL Flexible (privado, Entra) | `postgresFqdn`, `baseDatos` | Base `mmx` |
| Key Vault compartido | `rgCompartido`, `keyVaultNombre`, `nombreSecreto*` | Token de Siweb360, clave de cifrado de columnas, secreto de Entra, clave del asistente |
| ACR compartido | `acrNombre`, `acrServidor` | Imagen `mmx-recetas:<sha>` |
| Identidad de la app | `identidadAppNombre` | App y jobs (rol `mmx_app` en PostgreSQL) |
| Document Intelligence + storage | `docIntelNombre`, `storageNombre` | Recetas y albaranes; contenedores `recetas` (inmutable 5 años), `reportes`, `albaranes` |

Nuevo: identidad de migraciones (`identidadMigrNombre`, dueña de las tablas), Log Analytics, Application
Insights, grupo de alertas, presupuesto, entorno y app de Container Apps (`azu-<tipo>-<sufijo>-01`) y jobs
`azu-caj-<job>-np`. Registro de Entra ID con los roles empleado, veterinaria_responsable y admin.

## Fases

```bash
# 1. Base (identidad de migraciones, subred, monitorización, storage, permisos)
az deployment group create -g <grupo> -n presvetcheck-base -f infra/np/main.bicep -p infra/np/main.bicepparam
# 2. Container Apps (con la imagen ya en el ACR)
CREAR_APPS=true IMAGEN=<servidor-acr>/mmx-recetas:<sha> ENTRA_CLIENT_ID=<appId> \
  az deployment group create -g <grupo> -n presvetcheck-apps -f infra/np/main.bicep -p infra/np/main.bicepparam
```

## Preparación de PostgreSQL (una vez, como administrador de Entra)

En `postgres`: `pgaadauth_create_principal` para las dos identidades. En `mmx`: `CREATE EXTENSION pg_trgm`,
rol `mmx_app` (NOLOGIN), `CREATE` en la base y en `public` para la identidad de migraciones, `GRANT mmx_app` a la
identidad de la app (y a la de migraciones con ADMIN OPTION, para que conceda permisos sobre sus tablas). La
extensión `PG_TRGM` debe estar permitida en `azure.extensions`.

## Primera puesta en marcha

1. Job `db-migrate` (migraciones).
2. Job `procedimiento-cargar` con `--version`, `--aprobado-por` y `--texto-b64` (directrices de sustitución):
   en modo POST la app no arranca sin procedimiento vigente.
3. Job `nomenclator-import` (Nomenclátor de CIMAVet).
4. Asignar a cada usuario su rol en la aplicación empresarial de Entra.

Correo: `MAILER=console` (los reportes se descargan desde la app); SMTP en una segunda fase.

## Asistente de consultas

`asistente` = `gemini` (la app lee la clave de un secreto del Key Vault que la identidad de la app ya puede leer),
`azure` (`ASISTENTE_ENDPOINT=https://<recurso>.openai.azure.com ASISTENTE_DESPLIEGUE=<despliegue>`) u `off`. El
límite mensual de tokens es `asistenteLimiteTokens` (3.000.000 por defecto). Con un modelo externo, usar solo datos de
prueba hasta que el RAT recoja ese encargado (estado en Confluence; DUDA-29). El aviso del 80 % usa `REPORT_RECIPIENTS`.
