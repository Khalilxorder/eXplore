param(
  [string]$ProjectId = "",
  [string]$Region = "us-central1",
  [string]$ServiceName = "explore-api",
  [string]$FrontendUrl = "https://explore-two-rho.vercel.app",
  [string]$EnvFile = "backend/.env",
  [switch]$SkipServiceEnable
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

function Read-DotEnvFile([string]$Path) {
  $values = [ordered]@{}
  if (!(Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (!$trimmed -or $trimmed.StartsWith("#") -or !$trimmed.Contains("=")) {
      continue
    }

    $key, $value = $trimmed -split "=", 2
    $key = $key.Trim()
    $value = $value.Trim()
    if ($key -and $value -and !$key.StartsWith("NEXT_PUBLIC_")) {
      $values[$key] = $value
    }
  }

  return $values
}

function Write-CloudRunEnvYaml($Values, [string]$Path) {
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($entry in $Values.GetEnumerator()) {
    $jsonValue = ConvertTo-Json -InputObject ([string]$entry.Value) -Compress
    $lines.Add("$($entry.Key): $jsonValue")
  }

  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

Push-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
try {
  $gcloud = Get-GcloudPath
  $envValues = Read-DotEnvFile $EnvFile

  if (!$ProjectId) {
    $ProjectId = $envValues["FIREBASE_PROJECT_ID"]
  }
  if (!$ProjectId) {
    throw "ProjectId was not provided and FIREBASE_PROJECT_ID is missing from $EnvFile."
  }

  $envValues["PORT"] = "8080"
  if (!$envValues["DATA_BACKEND"]) {
    $envValues["DATA_BACKEND"] = "sqlite"
  }
  $envValues["ALLOW_DEV_MOCKS"] = "false"
  if (!$envValues["EMBED_ALERT_WORKER"]) {
    $envValues["EMBED_ALERT_WORKER"] = "true"
  }
  if (!$envValues["EMBED_DISCOVERY_WORKER"]) {
    $envValues["EMBED_DISCOVERY_WORKER"] = "true"
  }
  if (!$envValues["ALERT_WORKER_INTERVAL_MS"]) {
    $envValues["ALERT_WORKER_INTERVAL_MS"] = "300000"
  }
  if (!$envValues["DISCOVERY_WORKER_INTERVAL_MS"]) {
    $envValues["DISCOVERY_WORKER_INTERVAL_MS"] = "300000"
  }
  $envValues["META_FRONTEND_SUCCESS_URL"] = $FrontendUrl

  $tempEnv = Join-Path $env:TEMP "explore-cloudrun-env-$([guid]::NewGuid().ToString('N')).yaml"
  Write-CloudRunEnvYaml $envValues $tempEnv

  & $gcloud config set project $ProjectId | Out-Host

  if (!$SkipServiceEnable) {
    & $gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com --project $ProjectId --quiet | Out-Host
  }

  & $gcloud run deploy $ServiceName `
    --source backend `
    --region $Region `
    --platform managed `
    --port 8080 `
    --allow-unauthenticated `
    --env-vars-file $tempEnv `
    --project $ProjectId `
    --quiet | Out-Host

  $serviceUrl = (& $gcloud run services describe $ServiceName --region $Region --project $ProjectId --format "value(status.url)").Trim()
  if ($serviceUrl) {
    & $gcloud run services update $ServiceName `
      --region $Region `
      --project $ProjectId `
      --update-env-vars "BACKEND_PUBLIC_URL=$serviceUrl,META_FRONTEND_SUCCESS_URL=$FrontendUrl" `
      --quiet | Out-Host

    Write-Host "Cloud Run service URL: $serviceUrl"
    try {
      $health = Invoke-WebRequest -UseBasicParsing "$serviceUrl/api/v1/health" -TimeoutSec 30
      Write-Host "Health check: $($health.StatusCode)"
    } catch {
      Write-Warning "Cloud Run deployed, but health check failed: $($_.Exception.Message)"
    }
  }
} finally {
  if ($tempEnv -and (Test-Path $tempEnv)) {
    Remove-Item -LiteralPath $tempEnv -Force
  }
  Pop-Location
}
