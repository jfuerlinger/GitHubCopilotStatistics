param(
  [string] $ResourceGroup = 'rg-githubcopilotstatistics-poc',
  [SecureString] $IngestionKey,
  [string] $Location = 'westeurope'
)

if ($null -eq $IngestionKey) {
  if ($env:COPILOT_USAGE_INGESTION_KEY) {
    $IngestionKey = ConvertTo-SecureString $env:COPILOT_USAGE_INGESTION_KEY -AsPlainText -Force
  } else {
    $IngestionKey = Read-Host 'Ingestion key' -AsSecureString
  }
}

$plainKey = [System.Net.NetworkCredential]::new('', $IngestionKey).Password
az group create --name $ResourceGroup --location $Location --output none
if ($LASTEXITCODE -ne 0) { throw 'Could not create resource group.' }

az deployment group create `
  --resource-group $ResourceGroup `
  --template-file "$PSScriptRoot\main.bicep" `
  --parameters "$PSScriptRoot\main.bicepparam" ingestionKey=$plainKey `
  --query properties.outputs `
  --output json
if ($LASTEXITCODE -ne 0) { throw 'Azure deployment failed.' }
