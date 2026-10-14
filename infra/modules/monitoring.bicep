// Log Analytics con límite diario de ingesta + Application Insights con muestreo (SPEC §10.1).
param prefijo string
param location string
param tags object
@description('Límite diario de ingesta en GB (p. ej. 0,15).')
param limiteDiarioGb string = '0.15'
param correosAlertas array

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${prefijo}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json(limiteDiarioGb) }
  }
}

resource ai 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${prefijo}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
    SamplingPercentage: 25
    DisableIpMasking: false
  }
}

resource grupo 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${prefijo}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'mmxalertas'
    enabled: true
    emailReceivers: [for (c, i) in correosAlertas: { name: 'correo${i}', emailAddress: c, useCommonAlertSchema: true }]
  }
}

// Alertas de SPEC §11 a partir de los logs JSON: outbox en reconciliación, ruptura de la cadena de
// auditoría y jobs fallidos (los jobs escriben "ALERTA:" o "fallido" en el log).
resource alertaLogs 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${prefijo}-jobs'
  location: location
  tags: tags
  properties: {
    displayName: 'MMX: alertas de jobs (outbox, auditoría, CIMAVet)'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT1H'
    windowSize: 'PT1H'
    scopes: [law.id]
    criteria: {
      allOf: [
        {
          query: 'ContainerAppConsoleLogs_CL | where Log_s has "ALERTA:" or Log_s has "fallido"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [grupo.id] }
  }
}

output workspaceId string = law.id
output workspaceCustomerId string = law.properties.customerId
#disable-next-line outputs-should-not-contain-secrets
output workspaceKey string = law.listKeys().primarySharedKey
output appInsightsConnectionString string = ai.properties.ConnectionString
output actionGroupId string = grupo.id
