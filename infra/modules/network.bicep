// VNet propia: subred del entorno de Container Apps y subred delegada para PostgreSQL (acceso privado).
param prefijo string
param location string
param tags object

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'vnet-${prefijo}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'snet-aca'
        properties: {
          addressPrefix: '10.40.0.0/23'
          delegations: [{ name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'snet-pg'
        properties: {
          addressPrefix: '10.40.4.0/24'
          delegations: [{ name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
    ]
  }
}

resource dns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${prefijo}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource enlace 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: dns
  name: 'vnet'
  location: 'global'
  properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false }
}

output subnetAcaId string = vnet.properties.subnets[0].id
output subnetPgId string = vnet.properties.subnets[1].id
output dnsZoneId string = dns.id
