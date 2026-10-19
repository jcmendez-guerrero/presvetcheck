// Blob Storage (ADR-03): contenedor `recetas` con inmutabilidad temporal de 5 años y ciclo de vida
// Hot → Cool (30 días) → Cold (180 días); contenedor `reportes`. Sin claves compartidas.
param nombre string
param location string
param tags object
param principalId string
@description('Identidad del recurso de Document Intelligence (lee los datos de entrenamiento).')
param docIntelPrincipalId string
@description('Días de inmutabilidad de las recetas (5 años = 1826).')
param diasInmutabilidad int = 1826

resource sa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: nombre
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
    accessTier: 'Hot'
  }
}

resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: sa
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
  }
}

resource recetas 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'recetas'
  properties: { publicAccess: 'None' }
}

resource inmutable 'Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies@2023-05-01' = {
  parent: recetas
  name: 'default'
  properties: {
    immutabilityPeriodSinceCreationInDays: diasInmutabilidad
    allowProtectedAppendWrites: false
  }
}

resource reportes 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'reportes'
  properties: { publicAccess: 'None' }
}

// Albaranes y facturas de proveedor leídos al recibir mercancía (justificante de la entrada).
resource albaranes 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
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
            actions: {
              baseBlob: {
                tierToCool: { daysAfterCreationGreaterThan: 30 }
                tierToCold: { daysAfterCreationGreaterThan: 180 }
                // Retención (DUDA-24): pasados 5 años se eliminan (además lo hace el job retention-sweep).
                delete: { daysAfterCreationGreaterThan: diasInmutabilidad + 1 }
              }
            }
          }
        }
      ]
    }
  }
}

// Recetas etiquetadas para entrenar el modelo personalizado de Document Intelligence (DUDA-27). Contienen
// datos personales: contenedor privado, sin inmutabilidad (se borran al terminar el entrenamiento o a los 5 años).
resource entrenamiento 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'docintel-entrenamiento'
  properties: { publicAccess: 'None' }
}

// Storage Blob Data Reader para Document Intelligence, solo sobre ese contenedor.
resource rolEntrenamiento 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: entrenamiento
  name: guid(entrenamiento.id, docIntelPrincipalId, '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
    principalId: docIntelPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Storage Blob Data Contributor para la identidad de la app.
resource rol 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: sa
  name: guid(sa.id, principalId, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

output blobEndpoint string = sa.properties.primaryEndpoints.blob
