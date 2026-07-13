param(
  [string]$Channel = '',
  [string]$ApiKey = '',
  [switch]$SkipBuild,
  [switch]$Partial
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$effectiveChannel = if ($Channel) {
  $Channel.Trim()
} elseif ($env:CAPGO_CHANNEL) {
  $env:CAPGO_CHANNEL.Trim()
} else {
  'production'
}
$effectiveApiKey = if ($ApiKey) {
  $ApiKey.Trim()
} elseif ($env:CAPGO_APIKEY) {
  $env:CAPGO_APIKEY.Trim()
} else {
  ''
}

Set-Location $projectRoot

if (-not $SkipBuild) {
  Write-Host "Building web bundle for Capgo channel '$effectiveChannel'..."
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw 'Build failed. Capgo upload was not started.'
  }
}

$cliArgs = @(
  '@capgo/cli@latest',
  'bundle',
  'upload',
  "--channel=$effectiveChannel"
)

if ($Partial) {
  $cliArgs += '--partial'
}

if ($effectiveApiKey) {
  $cliArgs += "--apikey=$effectiveApiKey"
} else {
  Write-Host 'No CAPGO_APIKEY was found in this shell. The Capgo CLI will rely on any saved login session.'
}

Write-Host "Uploading live update to Capgo channel '$effectiveChannel'..."
& npx @cliArgs

if ($LASTEXITCODE -ne 0) {
  throw 'Capgo upload failed.'
}

Write-Host "Capgo live update uploaded for channel '$effectiveChannel'."
