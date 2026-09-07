@description('Globally unique name of the Static Web App.')
param staticWebAppName string

@description('Name of the Storage Account (3-24 lowercase alphanumeric characters).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Shared secret required by POST /api/usage.')
@secure()
param ingestionKey string

@allowed([
  'westeurope'
  'westus2'
  'eastasia'
  'eastus2'
  'centralus'
])
param staticWebAppLocation string = 'westeurope'

param storageLocation string = resourceGroup().location

@description('Globally unique name of the Function App hosting the usage API.')
param functionAppName string

@description('Location of the Function App and its consumption plan.')
param functionAppLocation string = resourceGroup().location

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: storageLocation
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource usageTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'CopilotUsage'
}

resource repositoriesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'CopilotRepositories'
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${functionAppName}-logs'
  location: functionAppLocation
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${functionAppName}-insights'
  location: functionAppLocation
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource consumptionPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${functionAppName}-plan'
  location: functionAppLocation
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: false
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: functionAppLocation
  kind: 'functionapp'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: consumptionPlan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'FtpsOnly'
      nodeVersion: '~22'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~22'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'USAGE_STORAGE_CONNECTION_STRING'
          value: storageConnectionString
        }
        {
          name: 'INGESTION_KEY'
          value: ingestionKey
        }
      ]
    }
  }
}

resource functionAppScmPublishing 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2022-03-01' = {
  parent: functionApp
  name: 'scm'
  properties: {
    allow: true
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

resource appSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    USAGE_STORAGE_CONNECTION_STRING: storageConnectionString
    INGESTION_KEY: ingestionKey
  }
}

output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output webhookBaseUrl string = 'https://${staticWebApp.properties.defaultHostname}/api/usage'
output storageTables array = [usageTable.name, repositoriesTable.name]
output functionAppNameOut string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output functionAppWebhookUrl string = 'https://${functionApp.properties.defaultHostName}/api/usage'
