// Despliegue sobre recursos EXISTENTES (entorno np, usado también para producción hasta que haga falta escalar).
// Todo lo nuevo va en azu-rg-presvetcheck-np-01, en North Europe (la región de la VNet compartida). Reutiliza:
//   VNet azu-vnet-np-02 (azu-rg-vnet-np-01) · PostgreSQL azu-psql-flex-neu-np-01 (endpoint privado) ·
//   Key Vault azukvappmascotix01 y ACR azuacrsharedmaxnp01 (azu-rg-shared-np-01) · identidad, Document
//   Intelligence y storage del grupo. Dos fases: `crearApps=false` (base) y `crearApps=true` (Container Apps).
//   az deployment group what-if -g azu-rg-presvetcheck-np-01 -f infra/np/main.bicep -p infra/np/main.bicepparam
targetScope = 'resourceGroup'

param location string = 'northeurope'
param crearApps bool = false
@description('Imagen en el ACR, p. ej. azuacrsharedmaxnp01-…azurecr.io/mmx-recetas:<sha>.')
param imagen string = ''
param entraTenantId string = subscription().tenantId
@description('Application (client) ID del registro de la app en Entra ID (fase 2).')
param entraClientId string = ''
param presupuestoEuros int = 40
param inicioPresupuesto string
param correosAlertas array

// Existentes
param identidadAppNombre string = 'azu-umi-presvetcheck-np-01'
param docIntelNombre string = 'azu-di-presvetcheck-np-neu-01'
param storageNombre string = 'azusadipvcnpneu01'
param postgresFqdn string = 'azu-psql-flex-neu-np-01.postgres.database.azure.com'
param baseDatos string = 'mmx'
param rgCompartido string = 'azu-rg-shared-np-01'
param keyVaultNombre string = 'azukvappmascotix01'
param acrNombre string = 'azuacrsharedmaxnp01'
param acrServidor string = 'azuacrsharedmaxnp01-b0e4ahfdgxbebvch.azurecr.io'
param rgRed string = 'azu-rg-vnet-np-01'
param vnetNombre string = 'azu-vnet-np-02'
param subredNombre string = 'azu-snet-presvetcheck-aca-np-01'
param subredPrefijo string = '10.0.130.0/27'
#disable-next-line secure-secrets-in-params // nombre del secreto, no su valor
param nombreSecretoSiweb string = 'azu-siweb-prod-api-key-01'
#disable-next-line secure-secrets-in-params // nombre del secreto, no su valor
param nombreSecretoCifrado string = 'mmx-column-encryption-key'
#disable-next-line secure-secrets-in-params // nombre del secreto, no su valor
param nombreSecretoEntra string = 'mmx-entra-client-secret'

// Asistente de consultas (specs/002-prescription-chat-assistant, ADR-17): 'azure' usa un despliegue de chat de Azure
// OpenAI / Foundry YA existente en la UE; 'gemini' usa la API de Gemini con la clave del secreto de Key Vault
// (KV_SECRETO_ASISTENTE, por defecto gcp-gemini-api-key), que la identidad de la app ya puede leer. No se crean recursos.
// TODO(decision DUDA-29): modelo de producción y límite mensual.
@allowed(['off', 'azure', 'gemini'])
param asistente string = 'off'
param asistenteEndpoint string = ''
param asistenteDespliegue string = ''
param asistenteLimiteTokens int = 3000000

var tags = { proyecto: 'presvetcheck', entorno: 'np' }
var dias = 1826

// ── Fase 1: base ────────────────────────────────────────────────────────────────────────────────────────────
resource idApp 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: identidadAppNombre
}

// Identidad solo para las migraciones: dueña de las tablas. La de la app solo tiene el rol mmx_app (sin
// UPDATE/DELETE en los registros).
resource idMigr 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'azu-umi-presvetcheck-migr-np-01'
  location: location
  tags: tags
}

module subred 'modules/subred.bicep' = {
  name: 'subred-aca'
  scope: resourceGroup(rgRed)
  params: { vnetNombre: vnetNombre, nombre: subredNombre, prefijo: subredPrefijo }
}

// La identidad de la app ya tenía «Key Vault Secrets User» en el Key Vault compartido (kv: false).
module compartido 'modules/roles-compartido.bicep' = {
  name: 'roles-compartido'
  scope: resourceGroup(rgCompartido)
  params: { keyVaultNombre: keyVaultNombre, acrNombre: acrNombre, identidades: [{ id: idApp.id, principalId: idApp.properties.principalId, kv: false }, { id: idMigr.id, principalId: idMigr.properties.principalId, kv: true }] }
}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'azu-law-presvetcheck-np-01'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30, workspaceCapping: { dailyQuotaGb: json('0.15') } }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: 'azu-appi-presvetcheck-np-01'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: law.id, SamplingPercentage: 25 }
}

resource alertas 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'azu-ag-presvetcheck-np-01'
  location: 'global'
  tags: tags
  properties: { groupShortName: 'presvet', enabled: true, emailReceivers: [for (c, i) in correosAlertas: { name: 'correo${i}', emailAddress: c, useCommonAlertSchema: true }] }
}

// Storage existente: contenedores de la app y ciclo de vida.
resource sa 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageNombre
}
resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: sa
  name: 'default'
}
resource cRecetas 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'recetas'
  // Inmutabilidad a nivel de versión (la cuenta tiene control de versiones): 5 años, política sin bloquear.
  properties: {
    publicAccess: 'None'
    immutableStorageWithVersioning: { enabled: true }
  }
}
resource cReportes 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'reportes'
  properties: { publicAccess: 'None' }
}
resource cAlbaranes 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'albaranes'
  properties: { publicAccess: 'None' }
}
resource ciclo 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: sa
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'recetas-hot-cool-cold-borrado'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['recetas/'] }
            actions: { baseBlob: { tierToCool: { daysAfterCreationGreaterThan: 30 }, tierToCold: { daysAfterCreationGreaterThan: 180 }, delete: { daysAfterCreationGreaterThan: dias + 1 } } }
          }
        }
      ]
    }
  }
}

var blobContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
resource rolBlobApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: sa
  name: guid(sa.id, idApp.id, blobContributor)
  properties: { roleDefinitionId: blobContributor, principalId: idApp.properties.principalId, principalType: 'ServicePrincipal' }
}
resource rolBlobMigr 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: sa
  name: guid(sa.id, idMigr.id, blobContributor)
  properties: { roleDefinitionId: blobContributor, principalId: idMigr.properties.principalId, principalType: 'ServicePrincipal' }
}

resource di 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: docIntelNombre
}
var cogUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')
resource rolDi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: di
  name: guid(di.id, idApp.id, cogUser)
  properties: { roleDefinitionId: cogUser, principalId: idApp.properties.principalId, principalType: 'ServicePrincipal' }
}

resource presupuesto 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'azu-budget-presvetcheck-np-01'
  properties: {
    category: 'Cost'
    amount: presupuestoEuros
    timeGrain: 'Monthly'
    timePeriod: { startDate: inicioPresupuesto }
    notifications: {
      al50: { enabled: true, operator: 'GreaterThan', threshold: 50, contactEmails: correosAlertas }
      al80: { enabled: true, operator: 'GreaterThan', threshold: 80, contactEmails: correosAlertas }
      al100: { enabled: true, operator: 'GreaterThan', threshold: 100, contactEmails: correosAlertas }
    }
  }
}

// ── Fase 2: Container Apps ─────────────────────────────────────────────────────────────────────────────────
var kvUri = 'https://${keyVaultNombre}${environment().suffixes.keyvaultDns}/'
var envBase = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: '8080' }
  { name: 'LOG_LEVEL', value: 'info' }
  { name: 'AUTH_MODE', value: 'entra' }
  { name: 'AUTH_EASYAUTH', value: 'true' }
  { name: 'ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ENTRA_CLIENT_ID', value: entraClientId }
  { name: 'KEY_VAULT_URL', value: kvUri }
  { name: 'KV_SECRETO_SIWEB_TOKEN', value: nombreSecretoSiweb }
  { name: 'KV_SECRETO_CIFRADO', value: nombreSecretoCifrado }
  { name: 'BLOB_ACCOUNT_URL', value: sa.properties.primaryEndpoints.blob }
  { name: 'DATABASE_AUTH', value: 'entra' }
  { name: 'EXTRACTOR', value: 'azure' }
  { name: 'DOCINTEL_ENDPOINT', value: di.properties.endpoint }
  { name: 'DOCINTEL_MODEL_ID', value: 'prebuilt-layout' }
  { name: 'ASSISTANT', value: asistente }
  { name: 'ASSISTANT_ENDPOINT', value: asistenteEndpoint }
  { name: 'ASSISTANT_DEPLOYMENT', value: asistenteDespliegue }
  { name: 'ASSISTANT_MONTHLY_TOKEN_LIMIT', value: string(asistenteLimiteTokens) }
  { name: 'SIWEB_STOCK_WRITE_MODE', value: 'off' }
  { name: 'SUBSTITUTION_APPROVAL_MODE', value: 'POST' }
  { name: 'SUBSTITUTION_SIGN_MAX_DAYS', value: '35' } // firma del farmacéutico garante en su visita mensual
  // Sin correo por ahora: los reportes se descargan desde la app (SMTP en una segunda fase).
  { name: 'MAILER', value: 'console' }
  { name: 'WEB_DIST_DIR', value: '/app/web' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
]
var envApp = concat(envBase, [
  { name: 'AZURE_CLIENT_ID', value: idApp.properties.clientId }
  { name: 'DATABASE_URL', value: 'postgres://${identidadAppNombre}@${postgresFqdn}:5432/${baseDatos}?sslmode=require' }
])
var envMigr = concat(envBase, [
  { name: 'AZURE_CLIENT_ID', value: idMigr.properties.clientId }
  { name: 'DATABASE_URL', value: 'postgres://${idMigr.name}@${postgresFqdn}:5432/${baseDatos}?sslmode=require' }
])

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = if (crearApps) {
  name: 'azu-cae-presvetcheck-np-01'
  location: location
  tags: tags
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    vnetConfiguration: { infrastructureSubnetId: subred.outputs.id, internal: false }
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: law.properties.customerId, sharedKey: law.listKeys().primarySharedKey } }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = if (crearApps) {
  name: 'azu-ca-presvetcheck-np-01'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${idApp.id}': {} } }
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      registries: [{ server: acrServidor, identity: idApp.id }]
      secrets: [{ name: 'entra-client-secret', keyVaultUrl: '${kvUri}secrets/${nombreSecretoEntra}', identity: idApp.id }]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: imagen
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: envApp
          probes: [
            { type: 'Liveness', httpGet: { path: '/api/health', port: 8080 }, initialDelaySeconds: 10 }
            { type: 'Readiness', httpGet: { path: '/api/ready', port: 8080 }, initialDelaySeconds: 5 }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
        rules: [
          { name: 'http', http: { metadata: { concurrentRequests: '20' } } }
          // Réplica caliente en horario comercial (D-08): L–V 10:15–20:15 y S 10:15–14:15, hora de Madrid.
          { name: 'horario-lv', custom: { type: 'cron', metadata: { timezone: 'Europe/Madrid', start: '15 10 * * 1-5', end: '15 20 * * 1-5', desiredReplicas: '1' } } }
          { name: 'horario-s', custom: { type: 'cron', metadata: { timezone: 'Europe/Madrid', start: '15 10 * * 6', end: '15 14 * * 6', desiredReplicas: '1' } } }
        ]
      }
    }
  }
}

// Autenticación integrada con Entra (ADR-06). Rutas públicas: sondas y el móvil emparejado (token del QR).
resource auth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (crearApps) {
  parent: app
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
      excludedPaths: ['/api/health', '/api/ready', '/api/movil/m/*', '/movil', '/assets/*', '/manifest.webmanifest', '/registerSW.js', '/sw.js', '/favicon.png', '/icono-192.png', '/icono-512.png', '/logo-horizontal.png']
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: { clientId: entraClientId, clientSecretSettingName: 'entra-client-secret', openIdIssuer: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0' }
        validation: { allowedAudiences: [entraClientId, 'api://${entraClientId}'] }
      }
    }
    login: { preserveUrlFragmentsForLogins: true }
  }
}

// Jobs (cron en UTC; equivalencias con la hora de Madrid en infra/README.md). db-migrate usa la identidad de
// migraciones; el resto, la de la app.
var jobs = [
  { nombre: 'cimavet-delta', cron: '30 4 * * *', manual: false, args: [], migr: false }
  { nombre: 'cimavet-full', cron: '0 1 * * 0', manual: false, args: [], migr: false }
  { nombre: 'outbox-dispatcher', cron: '*/5 8-19 * * 1-6', manual: false, args: [], migr: false }
  { nombre: 'sales-reconciliation', cron: '0 19 * * *', manual: false, args: [], migr: false }
  { nombre: 'weekly-reports', cron: '0 5 * * 1', manual: false, args: [], migr: false }
  { nombre: 'retention-sweep', cron: '0 2 1 * *', manual: false, args: [], migr: false }
  { nombre: 'nomenclator-import', cron: '', manual: true, args: ['--descargar'], migr: false }
  { nombre: 'procedimiento-cargar', cron: '', manual: true, args: [], migr: false }
  { nombre: 'db-migrate', cron: '', manual: true, args: [], migr: true }
]

resource job 'Microsoft.App/jobs@2024-03-01' = [
  for j in jobs: if (crearApps) {
    name: 'azu-caj-${j.nombre}-np'
    location: location
    tags: tags
    identity: { type: 'UserAssigned', userAssignedIdentities: { '${j.migr ? idMigr.id : idApp.id}': {} } }
    properties: {
      environmentId: cae.id
      workloadProfileName: 'Consumption'
      configuration: {
        triggerType: j.manual ? 'Manual' : 'Schedule'
        replicaTimeout: 3600
        // Sin reintentos automáticos: el outbox nunca reenvía a ciegas y el resto se reejecuta en su ventana.
        replicaRetryLimit: 0
        scheduleTriggerConfig: j.manual ? null : { cronExpression: j.cron, parallelism: 1, replicaCompletionCount: 1 }
        manualTriggerConfig: j.manual ? { parallelism: 1, replicaCompletionCount: 1 } : null
        registries: [{ server: acrServidor, identity: j.migr ? idMigr.id : idApp.id }]
      }
      template: {
        containers: [
          {
            name: j.nombre
            image: imagen
            command: concat(['node', 'worker/worker.js', j.nombre], j.args)
            resources: { cpu: json('0.5'), memory: '1Gi' }
            env: j.migr ? envMigr : envApp
          }
        ]
      }
    }
  }
]

output identidadMigraciones string = idMigr.name
output url string = crearApps ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
