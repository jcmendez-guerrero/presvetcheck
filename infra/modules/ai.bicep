// Azure AI Document Intelligence (F0 en dev, S0 en prod) y Azure OpenAI con despliegue Data Zone UE
// (ADR-04). Autenticación local desactivada: solo Entra (identidad gestionada).
param prefijo string
param location string
@description('Región de Azure OpenAI (Data Zone UE) si no está disponible en la principal (ADR-11).')
param locationOpenAi string
param tags object
param principalId string
param skuDocIntel string = 'F0'
param modelo string = 'gpt-4o'
param versionModelo string = '2024-08-06'
param capacidad int = 10

resource di 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'di-${prefijo}'
  location: location
  tags: tags
  kind: 'FormRecognizer'
  sku: { name: skuDocIntel }
  properties: { customSubDomainName: 'di-${prefijo}', disableLocalAuth: true, publicNetworkAccess: 'Enabled' }
}

resource aoai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'aoai-${prefijo}'
  location: locationOpenAi
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: { customSubDomainName: 'aoai-${prefijo}', disableLocalAuth: true, publicNetworkAccess: 'Enabled' }
}

resource despliegue 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aoai
  name: 'recetas-${modelo}'
  // Data Zone UE: los datos se procesan dentro de la UE.
  sku: { name: 'DataZoneStandard', capacity: capacidad }
  properties: { model: { format: 'OpenAI', name: modelo, version: versionModelo } }
}

resource rolDi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: di
  name: guid(di.id, principalId, 'a97b65f3-24c7-4388-baec-2e87135dc908')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

resource rolAoai 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aoai
  name: guid(aoai.id, principalId, '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

output docIntelEndpoint string = di.properties.endpoint
output openAiEndpoint string = aoai.properties.endpoint
output despliegue string = despliegue.name
