// Container Apps (ADR-01): entorno con perfil Consumo en la VNet, app `mmx-api` (API + SPA) y jobs.
param prefijo string
param location string
param tags object
param subnetId string
param lawCustomerId string
@secure()
param lawKey string
param identidadId string
param identidadClientId string
param imagen string
param keyVaultUri string
param appInsightsConnectionString string
param envVars array
param entraTenantId string
param entraClientId string
@description('Correo de alertas en los que se apoya el Mailer (destinatarios de reportes).')
param destinatariosReportes string

var secretos = [
  { name: 'database-url', keyVaultUrl: '${keyVaultUri}secrets/database-url', identity: identidadId }
  { name: 'entra-client-secret', keyVaultUrl: '${keyVaultUri}secrets/entra-client-secret', identity: identidadId }
]
var envComun = concat(envVars, [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'AZURE_CLIENT_ID', value: identidadClientId }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
  { name: 'REPORT_RECIPIENTS', value: destinatariosReportes }
])

resource entorno 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${prefijo}'
  location: location
  tags: tags
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    vnetConfiguration: { infrastructureSubnetId: subnetId, internal: false }
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: lawCustomerId, sharedKey: lawKey } }
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'mmx-api'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identidadId}': {} } }
  properties: {
    environmentId: entorno.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      secrets: secretos
    }
    template: {
      containers: [
        {
          name: 'api'
          image: imagen
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: envComun
          probes: [
            { type: 'Liveness', httpGet: { path: '/api/health', port: 8080 } }
            { type: 'Readiness', httpGet: { path: '/api/ready', port: 8080 } }
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

// Autenticación integrada con Entra (ADR-06): obligatoria; la API además valida el token o el principal.
resource auth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = {
  parent: api
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: { unauthenticatedClientAction: 'RedirectToLoginPage', redirectToProvider: 'azureactivedirectory', excludedPaths: ['/api/health', '/api/ready'] }
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

// Jobs programados. Los cron de Container Apps Jobs van en UTC: la hora de Madrid es UTC+2 en verano y
// UTC+1 en invierno (equivalencias en infra/README.md).
var jobs = [
  { nombre: 'cimavet-delta', cron: '30 4 * * *', manual: false, args: [] }
  { nombre: 'cimavet-full', cron: '0 1 * * 0', manual: false, args: [] }
  { nombre: 'outbox-dispatcher', cron: '*/5 8-19 * * 1-6', manual: false, args: [] }
  { nombre: 'sales-reconciliation', cron: '0 19 * * *', manual: false, args: [] }
  { nombre: 'weekly-reports', cron: '0 5 * * 1', manual: false, args: [] }
  { nombre: 'retention-sweep', cron: '0 2 1 * *', manual: false, args: [] }
  { nombre: 'nomenclator-import', cron: '', manual: true, args: ['--descargar'] }
  { nombre: 'db-migrate', cron: '', manual: true, args: [] }
]

resource job 'Microsoft.App/jobs@2024-03-01' = [
  for j in jobs: {
    name: 'job-${j.nombre}'
    location: location
    tags: tags
    identity: { type: 'UserAssigned', userAssignedIdentities: { '${identidadId}': {} } }
    properties: {
      environmentId: entorno.id
      workloadProfileName: 'Consumption'
      configuration: {
        triggerType: j.manual ? 'Manual' : 'Schedule'
        replicaTimeout: 3600
        // Sin reintentos automáticos: el outbox nunca reenvía a ciegas y el resto se reejecuta en su próxima ventana.
        replicaRetryLimit: 0
        scheduleTriggerConfig: j.manual ? null : { cronExpression: j.cron, parallelism: 1, replicaCompletionCount: 1 }
        manualTriggerConfig: j.manual ? { parallelism: 1, replicaCompletionCount: 1 } : null
        secrets: secretos
      }
      template: {
        containers: [
          {
            name: j.nombre
            image: imagen
            // nomenclator-import descarga el Nomenclátor de CIMAVet (NOMENCLATOR_URL): no va en la imagen.
            command: concat(['node', 'worker/worker.js', j.nombre], j.args)
            resources: { cpu: json('0.5'), memory: '1Gi' }
            env: envComun
          }
        ]
      }
    }
  }
]

output url string = 'https://${api.properties.configuration.ingress.fqdn}'
output entornoId string = entorno.id
