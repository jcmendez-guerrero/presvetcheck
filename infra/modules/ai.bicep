// Azure AI Document Intelligence (F0 en dev, S0 en prod). Extracción con un MODELO PERSONALIZADO entrenado en
// Document Intelligence Studio con las recetas de las clínicas (DUDA-27: sin Azure OpenAI). Autenticación
// local desactivada: solo Entra (identidad gestionada). La identidad del propio recurso lee los datos de
// entrenamiento del contenedor privado `docintel-entrenamiento`.
param prefijo string
param location string
param tags object
param principalId string
param skuDocIntel string = 'F0'

resource di 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'di-${prefijo}'
  location: location
  tags: tags
  kind: 'FormRecognizer'
  sku: { name: skuDocIntel }
  identity: { type: 'SystemAssigned' }
  properties: { customSubDomainName: 'di-${prefijo}', disableLocalAuth: true, publicNetworkAccess: 'Enabled' }
}

// Cognitive Services User para la identidad de la app (analizar documentos).
resource rolDi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: di
  name: guid(di.id, principalId, 'a97b65f3-24c7-4388-baec-2e87135dc908')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

output docIntelEndpoint string = di.properties.endpoint
output docIntelPrincipalId string = di.identity.principalId
