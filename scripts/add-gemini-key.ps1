param(
  [string]$Key,
  [string]$Account,
  [string]$Project,
  [string]$Label,
  [string]$Notes
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $env:USERPROFILE '.dev-config\services.json'
$poolPath = Join-Path $env:USERPROFILE '.dev-config\gemini-key-pool.json'
$maxKeys = 100

if (-not (Test-Path $configPath)) {
  throw "Machine config is missing at $configPath"
}

if ([string]::IsNullOrWhiteSpace($Key)) {
  $secureKey = Read-Host -Prompt 'Paste Gemini API key' -AsSecureString
  $credential = [pscredential]::new('gemini', $secureKey)
  $Key = $credential.GetNetworkCredential().Password
}

$Key = $Key.Trim()
if ($Key -notmatch '^(?:AIza[0-9A-Za-z\-_]{20,}|AQ\.[0-9A-Za-z\-_]{20,})$') {
  throw 'That does not look like a Gemini API key.'
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
$keys = New-Object System.Collections.Generic.List[string]
$metadataByKey = @{}

foreach ($name in @('GOOGLE_AI_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY')) {
  $value = [string]$env.$name
  if ($value -match '^(?:AIza[0-9A-Za-z\-_]{20,}|AQ\.[0-9A-Za-z\-_]{20,})$' -and -not $keys.Contains($value)) {
    $keys.Add($value)
  }
}

$pooled = [string]$env.GOOGLE_AI_API_KEYS
foreach ($value in $pooled -split '[,\r\n]+') {
  $trimmed = $value.Trim()
  if ($trimmed -match '^(?:AIza[0-9A-Za-z\-_]{20,}|AQ\.[0-9A-Za-z\-_]{20,})$' -and -not $keys.Contains($trimmed)) {
    $keys.Add($trimmed)
  }
}

for ($index = 1; $index -le $maxKeys; $index += 1) {
  foreach ($prefix in @('GOOGLE_AI_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY')) {
    $name = "${prefix}_${index}"
    $value = [string]$env.$name
    if ($value -match '^(?:AIza[0-9A-Za-z\-_]{20,}|AQ\.[0-9A-Za-z\-_]{20,})$' -and -not $keys.Contains($value)) {
      $keys.Add($value)
    }
  }
}

if (Test-Path $poolPath) {
  try {
    $poolRaw = Get-Content -Raw -Path $poolPath
    if ($poolRaw.Length -gt 0 -and $poolRaw[0] -eq [char]0xfeff) {
      $poolRaw = $poolRaw.Substring(1)
    }
    $pool = $poolRaw | ConvertFrom-Json
    foreach ($entry in @($pool.keys)) {
      if ($entry -is [string]) {
        $poolKey = $entry.Trim()
        $entryObject = [pscustomobject]@{ key = $poolKey }
      } else {
        $poolKey = [string]$entry.key
        if ([string]::IsNullOrWhiteSpace($poolKey)) {
          $poolKey = [string]$entry.apiKey
        }
        if ([string]::IsNullOrWhiteSpace($poolKey)) {
          $poolKey = [string]$entry.value
        }
        $poolKey = $poolKey.Trim()
        $entryObject = $entry
      }

      if ($poolKey -match '^(?:AIza[0-9A-Za-z\-_]{20,}|AQ\.[0-9A-Za-z\-_]{20,})$') {
        if (-not $keys.Contains($poolKey)) {
          $keys.Add($poolKey)
        }
        $metadataByKey[$poolKey] = $entryObject
      }
    }
  } catch {
    throw "Could not read existing Gemini pool file at $poolPath"
  }
}

if (-not $keys.Contains($Key)) {
  $keys.Add($Key)
}

if ($keys.Count -gt $maxKeys) {
  throw "There are already $($keys.Count) valid Gemini keys. Keep at most $maxKeys active keys in this app config."
}

function Set-EnvValue {
  param(
    [pscustomobject]$Object,
    [string]$Name,
    [string]$Value
  )

  if ($Object.PSObject.Properties.Name -contains $Name) {
    $Object.$Name = $Value
  } else {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  }
}

Set-EnvValue -Object $env -Name 'GOOGLE_AI_API_KEY' -Value $keys[0]
Set-EnvValue -Object $env -Name 'GOOGLE_GEMINI_API_KEY' -Value $keys[0]
Set-EnvValue -Object $env -Name 'GOOGLE_AI_API_KEYS' -Value (($keys | Select-Object -Unique) -join ',')
Set-EnvValue -Object $env -Name 'GEMINI_KEY_POOL_FILE' -Value $poolPath

for ($index = 1; $index -le $maxKeys; $index += 1) {
  $slotValue = if ($index -le $keys.Count) { $keys[$index - 1] } else { '' }
  Set-EnvValue -Object $env -Name "GOOGLE_AI_API_KEY_${index}" -Value $slotValue
}

$poolEntries = @()
for ($index = 0; $index -lt $keys.Count; $index += 1) {
  $poolKey = $keys[$index]
  $existing = $metadataByKey[$poolKey]
  $entry = [ordered]@{
    key = $poolKey
    label = if ($existing -and $existing.label) { [string]$existing.label } else { "Gemini key $($index + 1)" }
    account = if ($existing -and $existing.account) { [string]$existing.account } else { '' }
    project = if ($existing -and $existing.project) { [string]$existing.project } else { '' }
    priority = if ($existing -and $existing.priority) { [int]$existing.priority } else { 50 }
    enabled = if ($existing -and $null -ne $existing.enabled) { [bool]$existing.enabled } else { $true }
    notes = if ($existing -and $existing.notes) { [string]$existing.notes } else { '' }
    addedAt = if ($existing -and $existing.addedAt) { [string]$existing.addedAt } else { (Get-Date).ToString('o') }
  }

  if ($poolKey -eq $Key) {
    if (-not [string]::IsNullOrWhiteSpace($Label)) { $entry.label = $Label.Trim() }
    if (-not [string]::IsNullOrWhiteSpace($Account)) { $entry.account = $Account.Trim() }
    if (-not [string]::IsNullOrWhiteSpace($Project)) { $entry.project = $Project.Trim() }
    if (-not [string]::IsNullOrWhiteSpace($Notes)) { $entry.notes = $Notes.Trim() }
  }

  $poolEntries += [pscustomobject]$entry
}

$poolPayload = [ordered]@{
  version = 1
  updatedAt = (Get-Date).ToString('o')
  maxActiveKeys = $maxKeys
  usage = 'Backend-only Gemini key pool for legitimate keys. Do not commit this file.'
  keys = $poolEntries
}

Set-EnvValue -Object $config -Name 'updatedAt' -Value (Get-Date).ToString('o')

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path (Split-Path -Parent $configPath) "services.backup-gemini-key-$stamp.json"
Copy-Item -Path $configPath -Destination $backupPath -Force

$json = $config | ConvertTo-Json -Depth 50
[System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))

$poolBackupPath = Join-Path (Split-Path -Parent $poolPath) "gemini-key-pool.backup-$stamp.json"
if (Test-Path $poolPath) {
  Copy-Item -Path $poolPath -Destination $poolBackupPath -Force
}
$poolJson = $poolPayload | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($poolPath, $poolJson, [System.Text.UTF8Encoding]::new($false))

& npm --prefix $projectRoot run config:sync | Out-Null

Write-Output "Gemini key pool updated. Active key count: $($keys.Count)."

