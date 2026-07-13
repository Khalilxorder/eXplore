$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $env:USERPROFILE '.dev-config\services.json'
$poolPath = Join-Path $env:USERPROFILE '.dev-config\gemini-key-pool.json'

if (-not (Test-Path $configPath)) {
  throw "Machine config is missing at $configPath"
}

if (-not (Test-Path (Split-Path -Parent $poolPath))) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $poolPath) -Force | Out-Null
}

$raw = Get-Content -Raw -Path $configPath
if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xfeff) {
  $raw = $raw.Substring(1)
}

$config = $raw | ConvertFrom-Json
if (-not $config.projects) {
  $config | Add-Member -NotePropertyName projects -NotePropertyValue ([pscustomobject]@{})
}
if (-not $config.projects.explore) {
  $config.projects | Add-Member -NotePropertyName explore -NotePropertyValue ([pscustomobject]@{})
}
if (-not $config.projects.explore.backendEnv) {
  $config.projects.explore | Add-Member -NotePropertyName backendEnv -NotePropertyValue ([pscustomobject]@{})
}

$env = $config.projects.explore.backendEnv
if ($env.PSObject.Properties.Name -contains 'GEMINI_KEY_POOL_FILE') {
  $env.GEMINI_KEY_POOL_FILE = $poolPath
} else {
  $env | Add-Member -NotePropertyName 'GEMINI_KEY_POOL_FILE' -NotePropertyValue $poolPath
}

if (-not (Test-Path $poolPath)) {
  $payload = [ordered]@{
    version = 1
    updatedAt = (Get-Date).ToString('o')
    maxActiveKeys = 100
    usage = 'Backend-only Gemini key pool for legitimate keys. Do not commit this file.'
    keys = @()
  }
  [System.IO.File]::WriteAllText($poolPath, ($payload | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
}

if ($config.PSObject.Properties.Name -contains 'updatedAt') {
  $config.updatedAt = (Get-Date).ToString('o')
} else {
  $config | Add-Member -NotePropertyName 'updatedAt' -NotePropertyValue (Get-Date).ToString('o')
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path (Split-Path -Parent $configPath) "services.backup-init-gemini-pool-$stamp.json"
Copy-Item -Path $configPath -Destination $backupPath -Force

[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 50), [System.Text.UTF8Encoding]::new($false))

& npm --prefix $projectRoot run config:sync | Out-Null

Write-Output "Gemini key pool initialized at $poolPath"
