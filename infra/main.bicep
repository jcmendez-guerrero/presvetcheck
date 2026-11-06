// Infraestructura de Mundo Mascotix · Recetas veterinarias (SPEC §10.1). Despliegue en el grupo de
// recursos rg-mmx-recetas-{env}:
//   az deployment group what-if -g rg-mmx-recetas-dev -f infra/main.bicep -p infra/main.dev.bicepparam
targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param entorno string
@description('Región principal (ADR-11): spaincentral si todos los servicios están disponibles.')
param location string = 'spaincentral'
@description('Imagen OCI publicada en GHCR (ADR-09), p. ej. ghcr.io/org/mmx-recetas:<sha>.')
param imagen string
param entraTenantId string = subscription().tenantId
param entraClientId string
@secure()
param pgAdminPassword string
param correosAlertas array
param destinatariosReportes string
param presupuestoEuros int = 40
param inicioPresupuesto string
param sustitucionModo string = 'POST'
@description('Id del modelo personalizado de Document Intelligence (vacío hasta entrenarlo: extracción desactivada, entrada manual).')
param modeloDocIntel string = ''
@allowed(['off', 'entries_only'])
param escrituraStock string = 'off'
// Asistente de consultas (specs/002-prescription-chat-assistant, ADR-17): usa un despliegue de chat de Azure OpenAI /
// Foundry YA existente en la UE al que la identidad de la app tiene acceso; no se crean recursos ni claves.
// TODO(decision DUDA-29): despliegue concreto y límite mensual. Desactivado por defecto.
@allowed(['off', 'azure'])
param asistente string = 'off'
param asistenteEndpoint string = ''
param asistenteDespliegue string = ''
param asistenteLimiteTokens int = 3000000


var prefijo = 'mmx-recetas-${entorno}'
var corto = toLower(replace('mmx${entorno}${uniqueString(resourceGroup().id)}', '-', ''))
var tags = { proyecto: 'mmx-recetas', entorno: entorno }

module identidad 'modules/identity.bicep' = {
  name: 'identidad'
  params: { nombre: 'id-${prefijo}', location: location, tags: tags }
}

module monitor 'modules/monitoring.bicep' = {
  name: 'monitorizacion'
  params: { prefijo: prefijo, location: location, tags: tags, correosAlertas: correosAlertas }
}

module red 'modules/network.bicep' = {
  name: 'red'
  params: { prefijo: prefijo, location: location, tags: tags }
}

module kv 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: { nombre: take('kv-${corto}', 24), location: location, tags: tags, principalId: identidad.outputs.principalId }
}

module almacen 'modules/storage.bicep' = {
  name: 'almacenamiento'
  params: { nombre: take('st${corto}', 24), location: location, tags: tags, principalId: identidad.outputs.principalId, docIntelPrincipalId: ia.outputs.docIntelPrincipalId }
}

module pg 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    nombre: 'psql-${prefijo}'
    location: location
    tags: tags
    subnetId: red.outputs.subnetPgId
    dnsZoneId: red.outputs.dnsZoneId
    adminPassword: pgAdminPassword
    diasBackup: entorno == 'prod' ? 14 : 7
    actionGroupId: monitor.outputs.actionGroupId
  }
}

module ia 'modules/ai.bicep' = {
  name: 'ia'
  params: {
    prefijo: prefijo
    location: location
    tags: tags
    principalId: identidad.outputs.principalId
    skuDocIntel: entorno == 'prod' ? 'S0' : 'F0'
  }
}

module apps 'modules/containerapps.bicep' = {
  name: 'containerapps'
  params: {
    prefijo: prefijo
    location: location
    tags: tags
    subnetId: red.outputs.subnetAcaId
    lawCustomerId: monitor.outputs.workspaceCustomerId
    lawKey: monitor.outputs.workspaceKey
    identidadId: identidad.outputs.id
    identidadClientId: identidad.outputs.clientId
    imagen: imagen
    keyVaultUri: kv.outputs.uri
    appInsightsConnectionString: monitor.outputs.appInsightsConnectionString
    entraTenantId: entraTenantId
    entraClientId: entraClientId
    destinatariosReportes: destinatariosReportes
    envVars: [
      { name: 'NODE_ENV', value: 'production' }
      { name: 'PORT', value: '8080' }
      { name: 'AUTH_MODE', value: 'entra' }
      { name: 'AUTH_EASYAUTH', value: 'true' }
      { name: 'ENTRA_TENANT_ID', value: entraTenantId }
      { name: 'ENTRA_CLIENT_ID', value: entraClientId }
      { name: 'KEY_VAULT_URL', value: kv.outputs.uri }
      { name: 'BLOB_ACCOUNT_URL', value: almacen.outputs.blobEndpoint }
      { name: 'EXTRACTOR', value: 'azure' }
      { name: 'DOCINTEL_ENDPOINT', value: ia.outputs.docIntelEndpoint }
      { name: 'DOCINTEL_MODEL_ID', value: modeloDocIntel }
      { name: 'ASSISTANT', value: asistente }
      { name: 'ASSISTANT_ENDPOINT', value: asistenteEndpoint }
      { name: 'ASSISTANT_DEPLOYMENT', value: asistenteDespliegue }
      { name: 'ASSISTANT_MONTHLY_TOKEN_LIMIT', value: string(asistenteLimiteTokens) }
      { name: 'RETROSPECTIVE_DISPENSATION_MODE', value: 'enabled' }
      { name: 'SIWEB_STOCK_WRITE_MODE', value: escrituraStock }
      { name: 'SUBSTITUTION_APPROVAL_MODE', value: sustitucionModo }
      { name: 'MAILER', value: 'smtp' }
      { name: 'WEB_DIST_DIR', value: '/app/web' }
    ]
  }
}

module presupuesto 'modules/budget.bicep' = {
  name: 'presupuesto'
  params: { prefijo: prefijo, importe: presupuestoEuros, correos: correosAlertas, inicio: inicioPresupuesto }
}

output url string = apps.outputs.url
output keyVault string = kv.outputs.nombre
output postgresFqdn string = pg.outputs.fqdn
