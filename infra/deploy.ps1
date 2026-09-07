param(
  [Parameter(Mandatory)] [string] $ResourceGroup,
  [Parameter(Mandatory)] [string] $StaticWebAppName,
  [Parameter(Mandatory)] [ValidatePattern('^[a-z0-9]{3,24}$')] [string] $StorageAccountName,
  [Parameter(Mandatory)] [string] $FunctionAppName,
  [Parameter(Mandatory)] [SecureString] $IngestionKey,
  [string] $Location = 'westeurope'
)

$plainKey = [System.Net.NetworkCredential]::new('', $IngestionKey).Password
az group create --name $ResourceGroup --location $Location --output none
if ($LASTEXITCODE -ne 0) { throw 'Could not create resource group.' }

az deployment group create `
  --resource-group $ResourceGroup `
  --template-file "$PSScriptRoot\main.bicep" `
  --parameters staticWebAppName=$StaticWebAppName storageAccountName=$StorageAccountName functionAppName=$FunctionAppName ingestionKey=$plainKey `
  --query properties.outputs `
  --output json
if ($LASTEXITCODE -ne 0) { throw 'Azure deployment failed.' }
