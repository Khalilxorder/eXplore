param(
  [switch]$SkipConfigSync
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$logDir = Join-Path $backendRoot 'logs'
$serverLog = Join-Path $logDir 'server.log'

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

if (-not $SkipConfigSync) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-machine-config.ps1')
}

# Kill any existing node process holding port 8080 or 3000 to prevent EADDRINUSE
foreach ($port in @(8080, 3000)) {
  try {
    $portPid = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if ($portPid) {
      Write-Host "Stopping existing process on port $port (PID $portPid)..."
      Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }
  } catch {
    # Ignore errors — port may already be free
  }
}

$serverCommand = @"
Set-Location '$backendRoot'
cmd.exe /d /s /c "npm.cmd run dev >> `"$serverLog`" 2>&1"
"@

Start-Process powershell -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command', $serverCommand
) -WindowStyle Minimized | Out-Null

Write-Host 'Backend started in background with the embedded alert worker.'
Write-Host "Server log: $serverLog"
Write-Host 'Starting frontend dev:web server...'

Set-Location $projectRoot
npm.cmd run dev:web
