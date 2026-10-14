// Key Vault con RBAC (ADR-07): token de Siweb360, clave de cifrado de columnas, credenciales SMTP y
// cadena de conexión de PostgreSQL. Los valores se cargan fuera de la plantilla (infra/README.md).
param nombre string
param location string
param tags object
param principalId string

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: nombre
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// Key Vault Secrets User para la identidad de la app.
resource rol 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, principalId, '4633458b-17de-408a-b874-0445c86b69e6')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

output uri string = kv.properties.vaultUri
output nombre string = kv.name
