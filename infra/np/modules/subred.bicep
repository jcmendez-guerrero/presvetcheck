// Subred dedicada al entorno de Container Apps en la VNet compartida (delegada a Microsoft.App/environments).
// Punto de servicio de Storage para entrar al almacenamiento, que solo admite redes concretas.
param vnetNombre string
param nombre string
param prefijo string

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: vnetNombre
}

resource subred 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  parent: vnet
  name: nombre
  properties: {
    addressPrefixes: [prefijo]
    delegations: [{ name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } }]
    serviceEndpoints: [{ service: 'Microsoft.Storage' }]
  }
}

output id string = subred.id
