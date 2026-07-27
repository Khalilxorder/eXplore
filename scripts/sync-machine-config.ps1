param(
  [switch]$Open
)

$ErrorActionPreference = 'Stop'

$projectName = 'explore'
$projectRoot = Split-Path -Parent $PSScriptRoot
$machineConfigRoot = Join-Path $env:USERPROFILE '.dev-config'
$machineConfigPath = Join-Path $machineConfigRoot 'services.json'
$frontendEnvPath = Join-Path $projectRoot '.env.local'
$backendEnvPath = Join-Path $projectRoot 'backend\.env'
$androidGoogleServicesPath = Join-Path $projectRoot 'android\app\google-services.json'
$androidBuildGradlePath = Join-Path $projectRoot 'android\app\build.gradle'

function ConvertTo-OrderedMap {
  param([Parameter(ValueFromPipeline = $true)]$InputObject)

  if ($null -eq $InputObject) {
    return $null
  }

  if ($InputObject -is [System.Collections.Specialized.OrderedDictionary]) {
    return $InputObject
  }

  if ($InputObject -is [System.Collections.IDictionary]) {
    $result = [ordered]@{}
    foreach ($key in $InputObject.Keys) {
      $result[$key] = ConvertTo-OrderedMap $InputObject[$key]
    }
    return $result
  }

  if ($InputObject -is [System.Management.Automation.PSCustomObject]) {
    $result = [ordered]@{}
    foreach ($property in $InputObject.PSObject.Properties) {
      $result[$property.Name] = ConvertTo-OrderedMap $property.Value
    }
    return $result
  }

  if (($InputObject -is [System.Collections.IEnumerable]) -and -not ($InputObject -is [string])) {
    $items = @()
    foreach ($item in $InputObject) {
      $items += ,(ConvertTo-OrderedMap $item)
    }
    return $items
  }

  return $InputObject
}

function Read-EnvFile {
  param([string]$Path)

  $result = [ordered]@{}
  if (-not (Test-Path $Path)) {
    return $result
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf('=')
    if ($separatorIndex -lt 1) {
      continue
    }

    $key = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1)

    if ($key -notmatch '^[A-Z][A-Z0-9_]*$') {
      continue
    }

    $result[$key] = $value
  }

  return $result
}

function Normalize-EnvMap {
  param([System.Collections.IDictionary]$Map)

  $normalized = [ordered]@{}
  if ($null -eq $Map) {
    return $normalized
  }

  foreach ($key in $Map.Keys) {
    if ($key -match '^[A-Z][A-Z0-9_]*$') {
      $value = $Map[$key]
      if ($null -eq $value) {
        $normalized[$key] = ''
      } elseif ($value -is [System.Collections.IDictionary]) {
        $normalized[$key] = ($value | ConvertTo-Json -Depth 10 -Compress)
      } else {
        $normalized[$key] = ([string]$value -replace "(`r`n|`r|`n)", '\n')
      }
    }
  }

  return $normalized
}

function Normalize-SecretValue {
  param(
    [string]$Key,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $trimmed = $Value.Trim()
  $looksSecretLike = $Key -match '(API_KEY|ACCESS_TOKEN|SERVICE_ROLE_KEY|SECRET|PASSWORD|BEARER_TOKEN|CLIENT_SECRET)'
  if (-not $looksSecretLike) {
    return $trimmed
  }

  if ($trimmed -match 'YOUR_|CHANGE_ME|REPLACE_ME|PLACEHOLDER|EXAMPLE|FAKE|DEMO') {
    return ''
  }

  if ($trimmed -match '^(x|y|z|null|none|undefined|test)$') {
    return ''
  }

  if ($Key -eq 'OPENAI_API_KEY' -and $trimmed.Length -lt 20) {
    return ''
  }

  return $trimmed
}

function Sanitize-EnvMap {
  param([System.Collections.IDictionary]$Map)

  $sanitized = [ordered]@{}
  foreach ($key in $Map.Keys) {
    $sanitized[$key] = Normalize-SecretValue -Key $key -Value ([string]$Map[$key])
  }

  return $sanitized
}

function Merge-Missing {
  param(
    [System.Collections.IDictionary]$Target,
    [System.Collections.IDictionary]$Source
  )

  foreach ($key in $Source.Keys) {
    $sourceValue = $Source[$key]

    if ($sourceValue -is [System.Collections.IDictionary]) {
      if (-not $Target.Contains($key) -or -not ($Target[$key] -is [System.Collections.IDictionary])) {
        $Target[$key] = [ordered]@{}
      }

      Merge-Missing -Target $Target[$key] -Source $sourceValue
      continue
    }

    $currentValue = $null
    if ($Target.Contains($key)) {
      $currentValue = $Target[$key]
    }

    if ($null -eq $currentValue -or [string]::IsNullOrWhiteSpace([string]$currentValue)) {
      $Target[$key] = $sourceValue
    }
  }
}

function Merge-Override {
  param(
    [System.Collections.IDictionary]$Target,
    [System.Collections.IDictionary]$Source
  )

  foreach ($key in $Source.Keys) {
    $sourceValue = $Source[$key]

    if ($sourceValue -is [System.Collections.IDictionary]) {
      if (-not $Target.Contains($key) -or -not ($Target[$key] -is [System.Collections.IDictionary])) {
        $Target[$key] = [ordered]@{}
      }

      Merge-Override -Target $Target[$key] -Source $sourceValue
      continue
    }

    $Target[$key] = $sourceValue
  }
}

function Set-IfBlank {
  param(
    [System.Collections.IDictionary]$Map,
    [string]$Key,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }

  if (-not $Map.Contains($Key) -or [string]::IsNullOrWhiteSpace([string]$Map[$Key])) {
    $Map[$Key] = $Value
  }
}

function Write-EnvFile {
  param(
    [string]$Path,
    [System.Collections.IDictionary]$Values,
    [string[]]$Order
  )

  $parent = Split-Path -Parent $Path
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($key in $Order) {
    if ($Values.Contains($key) -and $key -match '^[A-Z][A-Z0-9_]*$') {
      $value = ([string]$Values[$key] -replace "(`r`n|`r|`n)", '\n')
      $lines.Add("$key=$value")
    }
  }

  $extraKeys = @($Values.Keys | Where-Object { $Order -notcontains $_ } | Sort-Object)
  foreach ($key in $extraKeys) {
    if ($key -notmatch '^[A-Z][A-Z0-9_]*$') {
      continue
    }
    $value = [string]$Values[$key]
    $lines.Add("$key=$value")
  }

  [System.IO.File]::WriteAllLines($Path, $lines)
}

function Ensure-FileFromPath {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    return $false
  }

  if (-not (Test-Path $SourcePath)) {
    return $false
  }

  $parent = Split-Path -Parent $DestinationPath
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Copy-Item -Path $SourcePath -Destination $DestinationPath -Force
  return $true
}

function Ensure-FileFromBase64 {
  param(
    [string]$EncodedValue,
    [string]$DestinationPath
  )

  if ([string]::IsNullOrWhiteSpace($EncodedValue)) {
    return $false
  }

  $bytes = [System.Convert]::FromBase64String($EncodedValue)
  $parent = Split-Path -Parent $DestinationPath
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  [System.IO.File]::WriteAllBytes($DestinationPath, $bytes)
  return $true
}

function Get-CompactJsonString {
  param([string]$JsonPath)

  if (-not (Test-Path $JsonPath)) {
    return ''
  }

  try {
    $jsonObject = Get-Content $JsonPath -Raw | ConvertFrom-Json
    return ($jsonObject | ConvertTo-Json -Depth 20 -Compress)
  } catch {
    return ''
  }
}

function Get-AndroidApplicationId {
  param([string]$BuildGradlePath)

  if (-not (Test-Path $BuildGradlePath)) {
    return ''
  }

  foreach ($line in Get-Content $BuildGradlePath) {
    if ($line -match 'applicationId\s+"([^"]+)"') {
      return $Matches[1]
    }
  }

  return ''
}

function Test-UsableXaiKey {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }

  $trimmed = $Value.Trim()
  if ($trimmed.Length -lt 12) {
    return $false
  }

  if ($trimmed -match 'YOUR_|CHANGE_ME|REPLACE_ME|PLACEHOLDER|EXAMPLE|FAKE|DEMO') {
    return $false
  }

  if ($trimmed -match '^(x|y|z|null|none|undefined|test)$') {
    return $false
  }

  return $true
}

function Get-XaiPoolEntries {
  param(
    [string]$PoolPath,
    [int]$MaxSlots = 3,
    [switch]$IncludeEmpty
  )

  # Returns slot-aligned entries (index 0 => XAI_API_KEY_1). Empty/disabled
  # slots are kept as placeholders when -IncludeEmpty so later keys do not shift.
  $entries = @()
  if ([string]::IsNullOrWhiteSpace($PoolPath) -or -not (Test-Path $PoolPath)) {
    return $entries
  }

  try {
    $raw = Get-Content -Raw -Path $PoolPath
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xfeff) {
      $raw = $raw.Substring(1)
    }
    $pool = $raw | ConvertFrom-Json
    $source = @()
    if ($pool -is [System.Collections.IEnumerable] -and -not ($pool -is [string]) -and -not ($pool.PSObject.Properties.Name -contains 'keys')) {
      $source = @($pool)
    } elseif ($pool -and $pool.keys) {
      $source = @($pool.keys)
    }

    $limit = $source.Count
    if ($MaxSlots -gt 0 -and $limit -gt $MaxSlots) {
      $limit = $MaxSlots
    }

    for ($index = 1; $index -le $limit; $index += 1) {
      $entry = $source[$index - 1]
      $placeholder = [ordered]@{
        id = "xai-account-$index"
        label = "xAI account $index"
        key = ''
        enabled = $false
        usable = $false
        slot = $index
      }

      if ($entry -is [string]) {
        $key = $entry.Trim()
        $placeholder.key = $key
        $placeholder.enabled = $true
        $placeholder.usable = (Test-UsableXaiKey $key)
        if ($placeholder.usable -or $IncludeEmpty) {
          $entries += $placeholder
        }
        continue
      }

      $key = [string]$entry.key
      if ([string]::IsNullOrWhiteSpace($key)) { $key = [string]$entry.apiKey }
      if ([string]::IsNullOrWhiteSpace($key)) { $key = [string]$entry.value }
      $key = if ($null -eq $key) { '' } else { $key.Trim() }

      $enabled = $true
      if ($null -ne $entry.enabled) {
        $enabled = [bool]$entry.enabled
      }

      $label = [string]$entry.label
      if ([string]::IsNullOrWhiteSpace($label)) { $label = [string]$entry.account }
      if ([string]::IsNullOrWhiteSpace($label)) { $label = [string]$entry.name }
      if ([string]::IsNullOrWhiteSpace($label)) { $label = "xAI account $index" }

      $id = [string]$entry.id
      if ([string]::IsNullOrWhiteSpace($id)) { $id = "xai-account-$index" }

      $usable = $enabled -and (Test-UsableXaiKey $key)
      $placeholder.id = $id
      $placeholder.label = $label
      $placeholder.key = $key
      $placeholder.enabled = $enabled
      $placeholder.usable = $usable

      if ($usable -or $IncludeEmpty) {
        $entries += $placeholder
      }
    }
  } catch {
    Write-Output "Warning: could not read xAI key pool at $PoolPath"
  }

  return $entries
}

function Merge-XaiPoolIntoBackendEnv {
  param(
    [System.Collections.IDictionary]$BackendEnv,
    [string]$PoolPath
  )

  if ([string]::IsNullOrWhiteSpace($PoolPath)) {
    return 0
  }

  Set-IfBlank -Map $BackendEnv -Key 'XAI_KEY_POOL_FILE' -Value $PoolPath

  $maxSlots = 3
  # Slot-aligned read: empty pool slots must NOT compact into earlier env slots,
  # and must NOT overwrite existing real env values.
  $entries = @(Get-XaiPoolEntries -PoolPath $PoolPath -MaxSlots $maxSlots -IncludeEmpty)
  if ($entries.Count -eq 0) {
    return 0
  }

  $mergedKeys = New-Object System.Collections.Generic.List[string]
  $firstUsable = $null
  $applied = 0

  for ($i = 1; $i -le $maxSlots; $i += 1) {
    if ($i -gt $entries.Count) {
      break
    }

    $entry = $entries[$i - 1]
    $keyName = "XAI_API_KEY_$i"
    $labelName = "XAI_ACCOUNT_LABEL_$i"
    $keyValue = [string]$entry.key
    $labelValue = [string]$entry.label
    $usable = $false
    if ($null -ne $entry.usable) {
      $usable = [bool]$entry.usable
    } else {
      $usable = (Test-UsableXaiKey $keyValue)
    }

    # Prefer pool values when present; never clear an existing non-empty env slot
    # just because this pool slot is empty/disabled.
    if ($usable) {
      $BackendEnv[$keyName] = $keyValue
      $mergedKeys.Add($keyValue)
      $applied += 1
      if ($null -eq $firstUsable) {
        $firstUsable = $entry
      }

      if (-not [string]::IsNullOrWhiteSpace($labelValue)) {
        $BackendEnv[$labelName] = $labelValue
      }
    } elseif (-not [string]::IsNullOrWhiteSpace($labelValue)) {
      # Label-only fill when blank; still do not wipe a real key in this slot.
      if (-not $BackendEnv.Contains($labelName) -or [string]::IsNullOrWhiteSpace([string]$BackendEnv[$labelName])) {
        $BackendEnv[$labelName] = $labelValue
      }
    }
  }

  if ($mergedKeys.Count -gt 0 -and $null -ne $firstUsable) {
    Set-IfBlank -Map $BackendEnv -Key 'XAI_API_KEY' -Value $mergedKeys[0]
    Set-IfBlank -Map $BackendEnv -Key 'XAI_ACCOUNT_LABEL' -Value ([string]$firstUsable.label)
    $csv = ($mergedKeys | Select-Object -Unique) -join ','
    if ([string]::IsNullOrWhiteSpace([string]$BackendEnv['XAI_API_KEYS'])) {
      $BackendEnv['XAI_API_KEYS'] = $csv
    }
  }

  if (
    [string]::IsNullOrWhiteSpace([string]$BackendEnv['XAI_ACTIVE_ACCOUNT_ID']) -and
    $null -ne $firstUsable -and
    -not [string]::IsNullOrWhiteSpace([string]$firstUsable.id)
  ) {
    $BackendEnv['XAI_ACTIVE_ACCOUNT_ID'] = [string]$firstUsable.id
  }

  return $applied
}

function Get-GoogleServicesPackageNames {
  param([string]$JsonPath)

  if (-not (Test-Path $JsonPath)) {
    return @()
  }

  $packageNames = @()
  try {
    $json = Get-Content $JsonPath -Raw | ConvertFrom-Json
    foreach ($client in @($json.client)) {
      $packageName = [string]$client.client_info.android_client_info.package_name
      if (-not [string]::IsNullOrWhiteSpace($packageName)) {
        $packageNames += $packageName
      }
    }
  } catch {
    return @()
  }

  return @($packageNames | Select-Object -Unique)
}

function New-DefaultProjectConfig {
  $frontendEnv = [ordered]@{
    NEXT_PUBLIC_API_URL = 'https://explore-two-rho.vercel.app/_/backend'
    NEXT_PUBLIC_SITE_URL = 'https://explore-two-rho.vercel.app'
    NEXT_PUBLIC_SUPABASE_URL = ''
    NEXT_PUBLIC_SUPABASE_ANON_KEY = ''
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ''
    NEXT_PUBLIC_MOBILE_API_URL = 'https://explore-two-rho.vercel.app/_/backend'
    NEXT_PUBLIC_MOBILE_APP_SCHEME = 'explore'
  }

  $backendEnv = [ordered]@{
    PORT = '8080'
    POSTGRES_URL = ''
    REDIS_URL = 'redis://localhost:6379'
    DATA_BACKEND = 'sqlite'
    EMBED_ALERT_WORKER = 'true'
    SUPABASE_PROJECT_REF = ''
    SUPABASE_URL = ''
    SUPABASE_ANON_KEY = ''
    SUPABASE_SERVICE_ROLE_KEY = ''
    SUPABASE_PUBLISHABLE_KEY = ''
    SUPABASE_SECRET_KEY = ''
    SUPABASE_ACCESS_TOKEN = ''
    SUPABASE_DB_PASSWORD = ''
    GOOGLE_OAUTH_CLIENT_ID = ''
    GOOGLE_OAUTH_CLIENT_SECRET = ''
    GOOGLE_OAUTH_REDIRECT_URI = 'https://explore-two-rho.vercel.app/_/backend/api/v1/mail/google/callback'
    SUPABASE_AUTH_GOOGLE_CLIENT_ID = ''
    SUPABASE_AUTH_GOOGLE_CLIENT_SECRET = ''
    SUPABASE_AUTH_GOOGLE_ENABLED = ''
    YOUTUBE_API_KEY = ''
    YOUTUBE_API_KEYS = ''
    YOUTUBE_API_KEY_1 = ''
    YOUTUBE_API_KEY_2 = ''
    YOUTUBE_API_KEY_3 = ''
    YOUTUBE_API_KEY_4 = ''
    YOUTUBE_API_KEY_5 = ''
    YOUTUBE_API_KEY_6 = ''
    YOUTUBE_API_KEY_7 = ''
    YOUTUBE_API_KEY_8 = ''
    YOUTUBE_API_KEY_9 = ''
    YOUTUBE_API_KEY_10 = ''
    ALLOW_DEV_MOCKS = 'false'
    APIFY_API_TOKEN = ''
    APIFY_TIKTOK_ACTOR_ID = 'therealdude/tiktok-scraper'
    APIFY_TIKTOK_HASHTAGS = 'trending,viral,fyp'
    APIFY_INSTAGRAM_ACTOR_ID = 'apify/instagram-scraper'
    REDDIT_CLIENT_ID = ''
    REDDIT_CLIENT_SECRET = ''
    X_BEARER_TOKEN = ''
    AI_PROVIDER = 'gemini'
    OPENAI_API_KEY = ''
    OPENAI_MODEL = 'gpt-4o-mini'
    GOOGLE_AI_API_KEY = ''
    GOOGLE_GEMINI_API_KEY = ''
    GOOGLE_AI_API_KEYS = ''
    GOOGLE_AI_API_KEY_1 = ''
    GOOGLE_AI_API_KEY_2 = ''
    GOOGLE_AI_API_KEY_3 = ''
    GOOGLE_AI_API_KEY_4 = ''
    GOOGLE_AI_API_KEY_5 = ''
    GOOGLE_AI_API_KEY_6 = ''
    GOOGLE_AI_API_KEY_7 = ''
    GOOGLE_AI_API_KEY_8 = ''
    GOOGLE_AI_API_KEY_9 = ''
    GOOGLE_AI_API_KEY_10 = ''
    GEMINI_KEY_POOL_FILE = ''
    GEMINI_MODEL = 'gemini-3.5-flash'
    GEMINI_ANALYSIS_MODEL = 'gemini-3.5-flash'
    GEMINI_TEMPLATE_MODEL = 'gemini-3.5-flash'
    GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001'
    XAI_API_KEY = ''
    XAI_API_KEY_1 = ''
    XAI_API_KEY_2 = ''
    XAI_API_KEY_3 = ''
    XAI_ACCOUNT_LABEL = ''
    XAI_ACCOUNT_LABEL_1 = ''
    XAI_ACCOUNT_LABEL_2 = ''
    XAI_ACCOUNT_LABEL_3 = ''
    XAI_API_KEYS = ''
    XAI_KEY_POOL_FILE = ''
    XAI_ACTIVE_ACCOUNT_ID = ''
    XAI_BASE_URL = 'https://api.x.ai/v1'
    FIREBASE_PROJECT_ID = ''
    FIREBASE_SERVICE_ACCOUNT_JSON = ''
    WRITTEN_NEWS_FEEDS = 'https://feeds.bbci.co.uk/news/technology/rss.xml,https://feeds.bbci.co.uk/news/world/rss.xml,https://feeds.bbci.co.uk/news/business/rss.xml'
    BACKEND_PUBLIC_URL = 'https://explore-two-rho.vercel.app/_/backend'
    META_APP_ID = ''
    META_APP_SECRET = ''
    META_LOGIN_CONFIG_ID = ''
    META_GRAPH_API_VERSION = 'v22.0'
    META_WEBHOOK_VERIFY_TOKEN = ''
    META_CONNECTION_SECRET = ''
    META_FRONTEND_SUCCESS_URL = 'https://explore-two-rho.vercel.app'
  }

  return [ordered]@{
    frontendEnv = $frontendEnv
    backendEnv = $backendEnv
    files = [ordered]@{
      firebaseServiceAccountJsonPath = ''
      googleServicesJsonPath = ''
      googleServicesJsonBase64 = ''
    }
    servers = [ordered]@{
      devHost = ''
      stagingHost = ''
      productionHost = ''
      deployPath = ''
    }
  }
}

$defaultConfig = [ordered]@{
  version = 1
  updatedAt = (Get-Date).ToString('o')
  projects = [ordered]@{
    explore = New-DefaultProjectConfig
  }
}

$currentFrontend = Read-EnvFile $frontendEnvPath
$currentBackend = Read-EnvFile $backendEnvPath

$envSeed = [ordered]@{
  projects = [ordered]@{
    explore = [ordered]@{
      frontendEnv = $currentFrontend
      backendEnv = $currentBackend
    }
  }
}

$existingConfig = $null
if (Test-Path $machineConfigPath) {
  $existingConfig = ConvertTo-OrderedMap (Get-Content $machineConfigPath -Raw | ConvertFrom-Json)
}

$machineConfigHasMobileApiUrl = $false
if (
  $existingConfig -and
  $existingConfig.projects -is [System.Collections.IDictionary] -and
  $existingConfig.projects.Contains('explore')
) {
  $machineProjectConfig = $existingConfig.projects['explore']
  if (
    $machineProjectConfig -and
    $machineProjectConfig.frontendEnv -is [System.Collections.IDictionary]
  ) {
    $machineConfigHasMobileApiUrl = $machineProjectConfig.frontendEnv.Contains('NEXT_PUBLIC_MOBILE_API_URL')
  }
}

$config = ConvertTo-OrderedMap $defaultConfig
Merge-Missing -Target $config -Source $envSeed

if ($existingConfig) {
  Merge-Override -Target $config -Source $existingConfig
}

$projectConfig = $config.projects[$projectName]
$projectConfig.frontendEnv = Normalize-EnvMap $projectConfig.frontendEnv
$projectConfig.backendEnv = Normalize-EnvMap $projectConfig.backendEnv
$projectConfig.frontendEnv = Sanitize-EnvMap $projectConfig.frontendEnv
$projectConfig.backendEnv = Sanitize-EnvMap $projectConfig.backendEnv
if ($existingConfig -and -not $machineConfigHasMobileApiUrl) {
  $projectConfig.frontendEnv.Remove('NEXT_PUBLIC_MOBILE_API_URL')
}
Set-IfBlank -Map $projectConfig.frontendEnv -Key 'NEXT_PUBLIC_SUPABASE_URL' -Value ([string]$projectConfig.backendEnv['SUPABASE_URL'])
Set-IfBlank -Map $projectConfig.frontendEnv -Key 'NEXT_PUBLIC_SUPABASE_ANON_KEY' -Value ([string]$projectConfig.backendEnv['SUPABASE_ANON_KEY'])
Set-IfBlank -Map $projectConfig.frontendEnv -Key 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' -Value ([string]$projectConfig.backendEnv['SUPABASE_PUBLISHABLE_KEY'])
Set-IfBlank -Map $projectConfig.backendEnv -Key 'BACKEND_PUBLIC_URL' -Value ([string]$projectConfig.frontendEnv['NEXT_PUBLIC_API_URL'])
Set-IfBlank -Map $projectConfig.backendEnv -Key 'META_FRONTEND_SUCCESS_URL' -Value ([string]$projectConfig.frontendEnv['NEXT_PUBLIC_SITE_URL'])
if (
  [string]::IsNullOrWhiteSpace([string]$projectConfig.backendEnv['SUPABASE_PROJECT_REF']) -and
  -not [string]::IsNullOrWhiteSpace([string]$projectConfig.backendEnv['SUPABASE_URL']) -and
  ([string]$projectConfig.backendEnv['SUPABASE_URL']) -match '^https://([^.]+)\.supabase\.co/?$'
) {
  $projectConfig.backendEnv['SUPABASE_PROJECT_REF'] = $Matches[1]
}

$firebaseServiceAccountPath = [string]$projectConfig.files.firebaseServiceAccountJsonPath
if (-not [string]::IsNullOrWhiteSpace($firebaseServiceAccountPath) -and (Test-Path $firebaseServiceAccountPath)) {
  $compactFirebaseJson = Get-CompactJsonString -JsonPath $firebaseServiceAccountPath
  if (-not [string]::IsNullOrWhiteSpace($compactFirebaseJson)) {
    $projectConfig.backendEnv['FIREBASE_SERVICE_ACCOUNT_JSON'] = $compactFirebaseJson
  }
}

# Flow xAI keys: prefer configured pool path, else machine default.
$xaiPoolPath = [string]$projectConfig.backendEnv['XAI_KEY_POOL_FILE']
if ([string]::IsNullOrWhiteSpace($xaiPoolPath)) {
  $xaiPoolPath = Join-Path $machineConfigRoot 'xai-key-pool.json'
}
$xaiKeysMerged = Merge-XaiPoolIntoBackendEnv -BackendEnv $projectConfig.backendEnv -PoolPath $xaiPoolPath
# Re-sanitize after pool merge so placeholder values never land in backend/.env
$projectConfig.backendEnv = Sanitize-EnvMap $projectConfig.backendEnv

$config.updatedAt = (Get-Date).ToString('o')

if (-not (Test-Path $machineConfigRoot)) {
  New-Item -ItemType Directory -Path $machineConfigRoot -Force | Out-Null
}

($config | ConvertTo-Json -Depth 10) | Set-Content -Path $machineConfigPath -Encoding UTF8

$frontendOrder = @(
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_MOBILE_API_URL',
  'NEXT_PUBLIC_MOBILE_APP_SCHEME'
)

$backendOrder = @(
  'PORT',
  'POSTGRES_URL',
  'REDIS_URL',
  'DATA_BACKEND',
  'EMBED_ALERT_WORKER',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'SUPABASE_AUTH_GOOGLE_CLIENT_ID',
  'SUPABASE_AUTH_GOOGLE_CLIENT_SECRET',
  'SUPABASE_AUTH_GOOGLE_ENABLED',
  'YOUTUBE_API_KEY',
  'YOUTUBE_API_KEYS',
  'YOUTUBE_API_KEY_1',
  'YOUTUBE_API_KEY_2',
  'YOUTUBE_API_KEY_3',
  'YOUTUBE_API_KEY_4',
  'YOUTUBE_API_KEY_5',
  'YOUTUBE_API_KEY_6',
  'YOUTUBE_API_KEY_7',
  'YOUTUBE_API_KEY_8',
  'YOUTUBE_API_KEY_9',
  'YOUTUBE_API_KEY_10',
  'ALLOW_DEV_MOCKS',
  'APIFY_API_TOKEN',
  'APIFY_TIKTOK_ACTOR_ID',
  'APIFY_TIKTOK_HASHTAGS',
  'APIFY_INSTAGRAM_ACTOR_ID',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'X_BEARER_TOKEN',
  'AI_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'GOOGLE_AI_API_KEY',
  'GOOGLE_GEMINI_API_KEY',
  'GOOGLE_AI_API_KEYS',
  'GOOGLE_AI_API_KEY_1',
  'GOOGLE_AI_API_KEY_2',
  'GOOGLE_AI_API_KEY_3',
  'GOOGLE_AI_API_KEY_4',
  'GOOGLE_AI_API_KEY_5',
  'GOOGLE_AI_API_KEY_6',
  'GOOGLE_AI_API_KEY_7',
  'GOOGLE_AI_API_KEY_8',
  'GOOGLE_AI_API_KEY_9',
  'GOOGLE_AI_API_KEY_10',
  'GEMINI_KEY_POOL_FILE',
  'GEMINI_MODEL',
  'GEMINI_ANALYSIS_MODEL',
  'GEMINI_TEMPLATE_MODEL',
  'GEMINI_EMBEDDING_MODEL',
  'XAI_API_KEY',
  'XAI_API_KEY_1',
  'XAI_API_KEY_2',
  'XAI_API_KEY_3',
  'XAI_ACCOUNT_LABEL',
  'XAI_ACCOUNT_LABEL_1',
  'XAI_ACCOUNT_LABEL_2',
  'XAI_ACCOUNT_LABEL_3',
  'XAI_API_KEYS',
  'XAI_KEY_POOL_FILE',
  'XAI_ACTIVE_ACCOUNT_ID',
  'XAI_BASE_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'WRITTEN_NEWS_FEEDS',
  'BACKEND_PUBLIC_URL',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_LOGIN_CONFIG_ID',
  'META_GRAPH_API_VERSION',
  'META_WEBHOOK_VERIFY_TOKEN',
  'META_CONNECTION_SECRET',
  'META_FRONTEND_SUCCESS_URL'
)

Write-EnvFile -Path $frontendEnvPath -Values $projectConfig.frontendEnv -Order $frontendOrder
Write-EnvFile -Path $backendEnvPath -Values $projectConfig.backendEnv -Order $backendOrder

$googleServicesCopied = Ensure-FileFromPath -SourcePath ([string]$projectConfig.files.googleServicesJsonPath) -DestinationPath $androidGoogleServicesPath
if (-not $googleServicesCopied) {
  $googleServicesCopied = Ensure-FileFromBase64 -EncodedValue ([string]$projectConfig.files.googleServicesJsonBase64) -DestinationPath $androidGoogleServicesPath
}

$androidApplicationId = Get-AndroidApplicationId -BuildGradlePath $androidBuildGradlePath
$googleServicesPackageNames = @(Get-GoogleServicesPackageNames -JsonPath $androidGoogleServicesPath)
$googleServicesPackageMismatch = $false
if (
  -not [string]::IsNullOrWhiteSpace($androidApplicationId) -and
  $googleServicesPackageNames.Count -gt 0 -and
  -not ($googleServicesPackageNames -contains $androidApplicationId)
) {
  $googleServicesPackageMismatch = $true
  if (Test-Path $androidGoogleServicesPath) {
    Remove-Item $androidGoogleServicesPath -Force
  }
  $googleServicesCopied = $false
}

$missingFields = New-Object System.Collections.Generic.List[string]
foreach ($field in @(
  'projects.explore.frontendEnv.NEXT_PUBLIC_API_URL',
  'projects.explore.frontendEnv.NEXT_PUBLIC_SITE_URL',
  'projects.explore.frontendEnv.NEXT_PUBLIC_SUPABASE_URL',
  'projects.explore.frontendEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'projects.explore.backendEnv.SUPABASE_URL',
  'projects.explore.backendEnv.SUPABASE_ANON_KEY',
  'projects.explore.backendEnv.SUPABASE_SERVICE_ROLE_KEY',
  'projects.explore.backendEnv.FIREBASE_PROJECT_ID'
)) {
  $segments = $field.Split('.')
  $cursor = $config
  foreach ($segment in $segments) {
    if ($cursor -is [System.Collections.IDictionary] -and $cursor.Contains($segment)) {
      $cursor = $cursor[$segment]
    } else {
      $cursor = ''
      break
    }
  }

  if ([string]::IsNullOrWhiteSpace([string]$cursor)) {
    $missingFields.Add($field)
  }
}

Write-Output "Machine config synced."
Write-Output "Central config: $machineConfigPath"
Write-Output "Frontend env:   $frontendEnvPath"
Write-Output "Backend env:    $backendEnvPath"
Write-Output ("Android FCM:    " + ($(if ($googleServicesCopied) { $androidGoogleServicesPath } elseif (Test-Path $androidGoogleServicesPath) { $androidGoogleServicesPath } else { 'missing google-services.json' })))
Write-Output ("xAI pool:       " + ($(if (Test-Path $xaiPoolPath) { "$xaiPoolPath (merged $xaiKeysMerged key slot(s) into backendEnv)" } else { "missing $xaiPoolPath" })))

if ($missingFields.Count -gt 0) {
  Write-Output ''
  Write-Output 'Still missing these keys in the central config:'
  foreach ($field in $missingFields) {
    Write-Output " - $field"
  }
}

if ($googleServicesPackageMismatch) {
  Write-Output ''
  Write-Output "Warning: skipped google-services.json because packages '$($googleServicesPackageNames -join ', ')' do not include Android applicationId '$androidApplicationId'."
}

if ($Open) {
  Start-Process notepad.exe $machineConfigPath | Out-Null
}
