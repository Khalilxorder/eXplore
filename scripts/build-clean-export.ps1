param()

$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$nextDir = Join-Path $workspaceRoot '.next'

if (Test-Path $nextDir) {
  Remove-Item $nextDir -Recurse -Force
}

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-static-export.ps1')
