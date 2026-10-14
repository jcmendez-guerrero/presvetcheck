using 'main.bicep'

param entorno = 'prod'
param imagen = 'ghcr.io/OWNER/mmx-recetas:latest'
param entraClientId = '00000000-0000-0000-0000-000000000000'
param pgAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD', '')
param correosAlertas = ['alertas@example.org']
param destinatariosReportes = 'garante@example.org,jc@example.org'
param inicioPresupuesto = '2026-11-01'
param presupuestoEuros = 40
