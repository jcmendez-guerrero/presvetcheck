// Permisos de las identidades de la app sobre recursos del grupo compartido: leer secretos del Key Vault
// (RBAC) y descargar la imagen del ACR.
param keyVaultNombre string
param acrNombre string
@description('Identidades (id, principalId y kv: si falta el rol de lectura de secretos) que leen secretos y descargan imágenes.')
param identidades array

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultNombre
}
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrNombre
}

var kvSecretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var acrPull = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource rolKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for i in filter(identidades, x => x.kv): {
    scope: kv
    name: guid(kv.id, i.id, kvSecretsUser)
    properties: { roleDefinitionId: kvSecretsUser, principalId: i.principalId, principalType: 'ServicePrincipal' }
  }
]
resource rolAcr 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for i in identidades: {
    scope: acr
    name: guid(acr.id, i.id, acrPull)
    properties: { roleDefinitionId: acrPull, principalId: i.principalId, principalType: 'ServicePrincipal' }
  }
]
