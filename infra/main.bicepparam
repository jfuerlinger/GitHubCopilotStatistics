using './main.bicep'

param staticWebAppName = 'stapp-githubcopilotstatistics-poc'
param storageAccountName = 'stagcstatisticspoc'
param functionAppName = 'app-gcstatistics-poc'
// Wird von infra/deploy.ps1 sicher zur Laufzeit überschrieben.
param ingestionKey = '<replace-at-deployment>'
