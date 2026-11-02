using 'main.bicep'

// Fase 1 (base): crearApps=false. Fase 2: crearApps=true con la imagen del ACR y el client ID de Entra.
param crearApps = bool(readEnvironmentVariable('CREAR_APPS', 'false'))
param imagen = readEnvironmentVariable('IMAGEN', '')
// Registro de aplicación «mmx-recetas-np» (el appId no es secreto). Por defecto, para que un despliegue nunca lo deje vacío.
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '<app-id-del-registro-entra>')
param inicioPresupuesto = '2026-10-01'
param correosAlertas = ['<buzon-de-alertas>@<dominio>']
// Asistente de consultas: off por defecto. Para activarlo: ASISTENTE=azure ASISTENTE_ENDPOINT=https://<recurso>.openai.azure.com ASISTENTE_DESPLIEGUE=<despliegue>.
param asistente = readEnvironmentVariable('ASISTENTE', 'off')
param asistenteEndpoint = readEnvironmentVariable('ASISTENTE_ENDPOINT', '')
param asistenteDespliegue = readEnvironmentVariable('ASISTENTE_DESPLIEGUE', '')
