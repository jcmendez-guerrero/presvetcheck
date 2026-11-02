using 'main.bicep'

// Fase 1 (base): crearApps=false. Fase 2: crearApps=true con la imagen del ACR y el client ID de Entra.
param crearApps = bool(readEnvironmentVariable('CREAR_APPS', 'false'))
param imagen = readEnvironmentVariable('IMAGEN', '')
// Registro de aplicación «mmx-recetas-np» (el appId no es secreto). Por defecto, para que un despliegue nunca lo deje vacío.
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '7c8ffd38-97ae-41aa-8889-96cc27648d72')
param inicioPresupuesto = '2026-10-01'
param correosAlertas = ['juanchocol69@gmail.com']
// Asistente de consultas en np: Gemini Flash-Lite (modelo más barato que supera la prueba de herramientas). Para usar
// Azure OpenAI: ASISTENTE=azure ASISTENTE_ENDPOINT=https://<recurso>.openai.azure.com ASISTENTE_DESPLIEGUE=<despliegue>.
// Para apagarlo: ASISTENTE=off. Con 'gemini' el endpoint se deja vacío.
param asistente = readEnvironmentVariable('ASISTENTE', 'gemini')
param asistenteEndpoint = readEnvironmentVariable('ASISTENTE_ENDPOINT', '')
param asistenteDespliegue = readEnvironmentVariable('ASISTENTE_DESPLIEGUE', 'gemini-3.5-flash-lite')
