using './main.bicep'

param staticWebAppName = 'copilot-usage-YOUR-SUFFIX'
param storageAccountName = 'copilotusageYOURSUFFIX'
param functionAppName = 'copilot-usage-api-YOUR-SUFFIX'
// Pass securely on the command line or use infra/deploy.ps1; do not commit the real key.
param ingestionKey = '<replace-at-deployment>'
