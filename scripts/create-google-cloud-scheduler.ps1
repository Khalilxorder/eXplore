param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceUrl,
  [string]$ProjectId = "",
  [string]$Region = "us-central1",
  [string]$Schedule = "*/15 * * * *",
  [string]$TimeZone = "Europe/Budapest"
)

$ErrorActionPreference = "Stop"

function Get-GcloudPath {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"),
    "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
    "C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $command = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "Google Cloud SDK is not installed. Install Google.CloudSDK first."
}

function Get-EnvValue([string]$Path, [string]$Name) {
  if (!(Test-Path $Path)) {
    return ""
  }

  $match = Select-String -LiteralPath $Path -Pattern "^$([regex]::Escape($Name))=" | Select-Object -First 1
  if (!$match) {
    return ""
  }

  return ($match.Line -replace "^$([regex]::Escape($Name))=", "").Trim()
}

function Upsert-HttpJob([string]$Name, [string]$Uri) {
  $exists = $false
  try {
    & $gcloud scheduler jobs describe $Name --location $Region --project $ProjectId --format "value(name)" | Out-Null
    $exists = $true
  } catch {
    $exists = $false
  }

  if ($exists) {
    & $gcloud scheduler jobs update http $Name `
      --location $Region `
      --project $ProjectId `
      --schedule $Schedule `
      --time-zone $TimeZone `
      --uri $Uri `
      --http-method GET `
      --quiet | Out-Host
  } else {
    & $gcloud scheduler jobs create http $Name `
      --location $Region `
      --project $ProjectId `
      --schedule $Schedule `
      --time-zone $TimeZone `
      --uri $Uri `
      --http-method GET `
      --quiet | Out-Host
  }
}

Push-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
try {
  $gcloud = Get-GcloudPath
  if (!$ProjectId) {
    $ProjectId = Get-EnvValue "backend/.env" "FIREBASE_PROJECT_ID"
  }
  if (!$ProjectId) {
    throw "ProjectId was not provided and FIREBASE_PROJECT_ID is missing from backend/.env."
  }

  $baseUrl = $ServiceUrl.TrimEnd("/")
  & $gcloud config set project $ProjectId | Out-Host
  & $gcloud services enable cloudscheduler.googleapis.com --project $ProjectId --quiet | Out-Host

  Upsert-HttpJob "explore-feed-refresh" "$baseUrl/api/v1/feed?refresh=1"
  Upsert-HttpJob "explore-written-news-refresh" "$baseUrl/api/v1/news/brief?refresh=1"

  Write-Host "Scheduler jobs active every $Schedule ($TimeZone)."
} finally {
  Pop-Location
}
