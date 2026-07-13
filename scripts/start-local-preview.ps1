param(
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$exportRoot = Join-Path $projectRoot 'out'
$backendLogDir = Join-Path $backendRoot 'logs'
$backendLog = Join-Path $backendLogDir 'preview-server.log'
$backendErrorLog = Join-Path $backendLogDir 'preview-server.error.log'
$siteLog = Join-Path $backendLogDir 'preview-site.log'
$siteErrorLog = Join-Path $backendLogDir 'preview-site.error.log'
$url = 'http://127.0.0.1:3000/'
$preferredBackendPort = 8080
$fallbackBackendPort = 3180
$backendPort = $preferredBackendPort
$backendUrl = "http://127.0.0.1:$backendPort/api/v1/health"
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$processPath = [System.Environment]::GetEnvironmentVariable('Path', 'Process')
if ($processPath) {
  [System.Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
  [System.Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
}

function Start-PreviewProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$StandardOutputPath,
    [Parameter(Mandatory = $true)][string]$StandardErrorPath,
    [hashtable]$EnvironmentOverrides = @{}
  )

  $previousValues = @{}
  foreach ($key in $EnvironmentOverrides.Keys) {
    $name = [string]$key
    $previousValues[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
    [System.Environment]::SetEnvironmentVariable($name, [string]$EnvironmentOverrides[$key], 'Process')
  }

  try {
    Start-Process -FilePath $FilePath `
      -ArgumentList $ArgumentList `
      -WorkingDirectory $WorkingDirectory `
      -RedirectStandardOutput $StandardOutputPath `
      -RedirectStandardError $StandardErrorPath `
      -WindowStyle Hidden
  } finally {
    foreach ($key in $previousValues.Keys) {
      [System.Environment]::SetEnvironmentVariable($key, $previousValues[$key], 'Process')
    }
  }
}

function Test-BackendHealth {
  param(
    [Parameter(Mandatory = $true)][int]$Port
  )

  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/health" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ne 200) {
      return $false
    }

    $payload = $response.Content | ConvertFrom-Json
    return $payload.status -eq 'ok'
  } catch {
    return $false
  }
}

if (-not (Test-Path $backendLogDir)) {
  New-Item -ItemType Directory -Path $backendLogDir -Force | Out-Null
}

if (-not (Test-Path (Join-Path $exportRoot 'index.html'))) {
  Write-Host 'Static export is missing. Building the local site first...'
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-static-export.ps1')
}

try {
  $portPid = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  if ($portPid) {
    Write-Host "Stopping existing site process on port 3000 (PID $portPid)..."
    Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
} catch {
  # Port may already be free.
}

$backendReady = Test-BackendHealth -Port $preferredBackendPort

if ($backendReady) {
  $backendPort = $preferredBackendPort
  $backendUrl = "http://127.0.0.1:$backendPort/api/v1/health"
}

if (-not $backendReady) {
  Write-Host "Starting backend on http://127.0.0.1:$preferredBackendPort ..."

  Start-PreviewProcess `
    -FilePath $nodeCommand `
    -ArgumentList @('server.js') `
    -WorkingDirectory $backendRoot `
    -StandardOutputPath $backendLog `
    -StandardErrorPath $backendErrorLog `
    -EnvironmentOverrides @{
      PORT = [string]$preferredBackendPort
    } | Out-Null

  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-BackendHealth -Port $preferredBackendPort) {
      $backendReady = $true
      $backendPort = $preferredBackendPort
      $backendUrl = "http://127.0.0.1:$backendPort/api/v1/health"
      break
    }
  }

  if (-not $backendReady -and (Test-BackendHealth -Port $fallbackBackendPort)) {
    $backendReady = $true
    $backendPort = $fallbackBackendPort
    $backendUrl = "http://127.0.0.1:$backendPort/api/v1/health"
    Write-Warning "Preferred backend on $preferredBackendPort was not healthy. Reusing healthy backend on $fallbackBackendPort for the local preview."
  }

  if ($backendReady) {
    Write-Host "Backend is ready on http://127.0.0.1:$backendPort."
  } else {
    throw "No healthy backend is available. Checked ports $preferredBackendPort and $fallbackBackendPort. See $backendLog and $backendErrorLog."
  }
}

$siteEnvironment = @{
  PROXY_API_HOST = '127.0.0.1'
  PROXY_API_PORT = [string]$backendPort
}
Start-PreviewProcess `
  -FilePath $nodeCommand `
  -ArgumentList @('scripts/serve-static.mjs', 'out', '3000') `
  -WorkingDirectory $projectRoot `
  -StandardOutputPath $siteLog `
  -StandardErrorPath $siteErrorLog `
  -EnvironmentOverrides $siteEnvironment | Out-Null

$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    # Keep waiting for the local preview to come up.
  }
}

if (-not $ready) {
  throw "The local preview did not start on $url"
}

Write-Host "Local preview is running at $url"

if ($OpenBrowser) {
  Start-Process $url | Out-Null
}
