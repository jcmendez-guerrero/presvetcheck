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

## Despliegue continuo (CI, job `dev`)

Cada push a `main` importa la imagen de GHCR al ACR como `mmx-recetas:<sha>`, lanza `azu-caj-db-migrate-np`, espera
a que termine y actualiza la app y el resto de jobs. Los nombres reales se configuran como **variables** del entorno
`dev` de GitHub (Settings › Environments › dev), con los valores de Confluence:

| Variable | Valor |
| --- | --- |
| `AZURE_RESOURCE_GROUP` | Grupo del proyecto (app y jobs) |
| `ACA_APP` | `azu-ca-<sufijo>-01` |
| `ACR_NAME` / `ACR_SERVER` | Mismos valores que `acrNombre` / `acrServidor` |
| `ACA_JOB_SUFFIX` | Opcional; por defecto `np` |

La identidad federada de GitHub (`AZURE_CLIENT_ID`, sujeto `environment:dev`) necesita permiso para importar en el
ACR (p. ej. `Container Registry Data Importer and Data Reader`) y `Contributor` sobre el grupo del proyecto.

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

## Corregir importaciones con CIMAVet (`azu-caj-import-fix-np`)

Pone las entradas y salidas importadas con el nombre, el principio activo y la forma de CIMAVet (ADR-14): crea una
importación corregida y anula la original. Las importaciones sin diferencias no se tocan, así que repetirlo no cambia
nada. Por defecto solo informa: se lanza, se revisa el informe en los logs y, si es correcto, se vuelve a desplegar con
`IMPORT_FIX_APPLY=true`, se lanza otra vez y se vuelve a desplegar sin la variable. No uses
`az containerapp job start --args`: sustituye el contenedor y se pierden las variables de entorno.

```bash
az containerapp job start -g <grupo> -n azu-caj-import-fix-np
```

Correo: `MAILER=console` (los reportes se descargan desde la app); SMTP en una segunda fase.

## Asistente de consultas

`asistente` = `gemini` (la app lee la clave de un secreto del Key Vault que la identidad de la app ya puede leer),
`azure` (`ASISTENTE_ENDPOINT=https://<recurso>.openai.azure.com ASISTENTE_DESPLIEGUE=<despliegue>`) u `off`. El
límite mensual de tokens es `asistenteLimiteTokens` (3.000.000 por defecto). Con un modelo externo, usar solo datos de
prueba hasta que el RAT recoja ese encargado (estado en Confluence; DUDA-29). El aviso del 80 % usa `REPORT_RECIPIENTS`.

## Escritura de entradas de stock en Siweb360 (specs/011)

Por defecto `escrituraStock = off`: la app no escribe nada en Siweb360. Para encenderla:

1. Administración › Prueba de escritura con una variante `TEST-…` creada a mano en Siweb360. Debe salir `ok`, `coherente` e `historialOk`; sin una prueba superada en los últimos 30 días el outbox no envía nada.
2. Desplegar la fase 2 con `ESCRITURA_STOCK=entries_only FECHA_CORTE_ENTRADAS=AAAA-MM-DD`. Si falta la fecha de corte o no tiene ese formato, el despliegue falla.
3. Avisar al personal: desde la fecha de corte no se dan entradas de medicamentos a mano en Siweb360.

Marcha atrás: desplegar con `ESCRITURA_STOCK=off`; los envíos pendientes se conservan.
