using 'main.bicep'

// Fase 1 (base): crearApps=false. Fase 2: crearApps=true con la imagen del ACR y el client ID de Entra.
param crearApps = bool(readEnvironmentVariable('CREAR_APPS', 'false'))
param imagen = readEnvironmentVariable('IMAGEN', '')
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '')
param inicioPresupuesto = '2026-10-01'
param correosAlertas = ['juanchocol69@gmail.com']
