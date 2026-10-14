// PostgreSQL Flexible Server B1ms, PG16, 32 GB, acceso privado, copias 7–14 días, extensiones
// pg_trgm/unaccent/pgcrypto y alerta de créditos de CPU bajos (ADR-02, SPEC §10.1).
param nombre string
param location string
param tags object
param subnetId string
param dnsZoneId string
param adminUsuario string = 'mmxadmin'
@secure()
param adminPassword string
param diasBackup int = 14
param actionGroupId string

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: nombre
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: adminUsuario
    administratorLoginPassword: adminPassword
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: diasBackup, geoRedundantBackup: 'Disabled' }
    network: { delegatedSubnetResourceId: subnetId, privateDnsZoneArmResourceId: dnsZoneId, publicNetworkAccess: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    authConfig: { activeDirectoryAuth: 'Enabled', passwordAuth: 'Enabled', tenantId: subscription().tenantId }
  }
}

resource extensiones 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: { value: 'PG_TRGM,UNACCENT,PGCRYPTO', source: 'user-override' }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'mmx'
  properties: { charset: 'UTF8', collation: 'es_ES.utf8' }
}

resource alertaCreditos 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-${nombre}-cpu-credits'
  location: 'global'
  tags: tags
  properties: {
    description: 'Créditos de CPU de PostgreSQL bajos (B1ms)'
    severity: 2
    enabled: true
    scopes: [pg.id]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{ name: 'creditos', metricName: 'cpu_credits_remaining', operator: 'LessThan', threshold: 30, timeAggregation: 'Average', criterionType: 'StaticThresholdCriterion' }]
    }
    actions: [{ actionGroupId: actionGroupId }]
  }
}

output fqdn string = pg.properties.fullyQualifiedDomainName
output nombreBd string = db.name
