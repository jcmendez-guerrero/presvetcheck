// Presupuesto mensual con avisos al 50/80/100 % (SPEC §10.1).
param prefijo string
param importe int
param correos array
@description('Primer día del mes de inicio, AAAA-MM-01.')
param inicio string

resource presupuesto 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'budget-${prefijo}'
  properties: {
    category: 'Cost'
    amount: importe
    timeGrain: 'Monthly'
    timePeriod: { startDate: inicio }
    notifications: {
      aviso50: { enabled: true, operator: 'GreaterThan', threshold: 50, contactEmails: correos, thresholdType: 'Actual' }
      aviso80: { enabled: true, operator: 'GreaterThan', threshold: 80, contactEmails: correos, thresholdType: 'Actual' }
      aviso100: { enabled: true, operator: 'GreaterThan', threshold: 100, contactEmails: correos, thresholdType: 'Actual' }
      previsto100: { enabled: true, operator: 'GreaterThan', threshold: 100, contactEmails: correos, thresholdType: 'Forecasted' }
    }
  }
}
