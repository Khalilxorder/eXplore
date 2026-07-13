param(
  [switch]$ApplySupabaseGoogle,
  [switch]$InstallApk,
  [string]$ApkPath = "C:\Users\khali\Desktop\eXPLORE-release.apk",
  [string]$ApiBaseUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"

function Read-DotEnvFile {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }

    $parts = $trimmed -split "=", 2
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }

  return $values
}

function Test-Value {
  param($Value)
  return -not [string]::IsNullOrWhiteSpace([string]$Value)
}

function Invoke-JsonGet {
  param(
    [string]$Url,
    [int]$TimeoutSec = 20
  )

  try {
    return @{
      ok = $true
      value = (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec).Content | ConvertFrom-Json
      error = ""
    }
  } catch {
    return @{
      ok = $false
      value = $null
      error = $_.Exception.Message
    }
  }
}

function Get-AdbPath {
  $candidates = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }

  $candidateList = @($candidates)
  if ($candidateList.Count -gt 0) {
    return $candidateList[0]
  }

  return ""
}

npm run config:sync | Out-Host

$backendEnv = Read-DotEnvFile -Path (Join-Path (Get-Location) "backend\.env")
$projectRef = $backendEnv["SUPABASE_PROJECT_REF"]
$supabaseUrl = $backendEnv["SUPABASE_URL"]
$supabaseAnon = $backendEnv["SUPABASE_PUBLISHABLE_KEY"]
if (-not (Test-Value $supabaseAnon)) { $supabaseAnon = $backendEnv["SUPABASE_ANON_KEY"] }
$supabaseAccessToken = $backendEnv["SUPABASE_ACCESS_TOKEN"]
$googleClientId = $backendEnv["SUPABASE_AUTH_GOOGLE_CLIENT_ID"]
if (-not (Test-Value $googleClientId)) { $googleClientId = $backendEnv["GOOGLE_OAUTH_CLIENT_ID"] }
$googleClientSecret = $backendEnv["SUPABASE_AUTH_GOOGLE_CLIENT_SECRET"]
if (-not (Test-Value $googleClientSecret)) { $googleClientSecret = $backendEnv["GOOGLE_OAUTH_CLIENT_SECRET"] }

$result = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  config = [ordered]@{
    supabase_project_ref = Test-Value $projectRef
    supabase_url = Test-Value $supabaseUrl
    supabase_anon_key = Test-Value $supabaseAnon
    supabase_access_token = Test-Value $supabaseAccessToken
    supabase_service_role = (Test-Value $backendEnv["SUPABASE_SERVICE_ROLE_KEY"]) -or (Test-Value $backendEnv["SUPABASE_SECRET_KEY"])
    google_oauth_client_id = Test-Value $googleClientId
    google_oauth_client_secret = Test-Value $googleClientSecret
    firebase_service_account = Test-Value $backendEnv["FIREBASE_SERVICE_ACCOUNT_JSON"]
    openai_fallback = Test-Value $backendEnv["OPENAI_API_KEY"]
  }
  supabase_google_apply = [ordered]@{
    attempted = $false
    status = "not_requested"
    error = ""
  }
}

if ($ApplySupabaseGoogle) {
  $result.supabase_google_apply.attempted = $true
  if (-not (Test-Value $projectRef) -or -not (Test-Value $supabaseAccessToken) -or -not (Test-Value $googleClientId) -or -not (Test-Value $googleClientSecret)) {
    $result.supabase_google_apply.status = "blocked_missing_credentials"
    $result.supabase_google_apply.error = "Needs SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN, and Google OAuth Client ID/Secret."
  } else {
    $body = @{
      external_google_enabled = $true
      external_google_client_id = $googleClientId
      external_google_secret = $googleClientSecret
      site_url = "https://explore-two-rho.vercel.app"
      uri_allow_list = "https://explore-two-rho.vercel.app/**,explore://auth/callback,http://127.0.0.1:3000/**,http://localhost:3000/**"
    } | ConvertTo-Json

    try {
      Invoke-WebRequest `
        -Uri "https://api.supabase.com/v1/projects/$projectRef/config/auth" `
        -Method Patch `
        -Headers @{ Authorization = "Bearer $supabaseAccessToken" } `
        -ContentType "application/json" `
        -Body $body `
        -UseBasicParsing `
        -TimeoutSec 30 | Out-Null
      $result.supabase_google_apply.status = "patched"
    } catch {
      $result.supabase_google_apply.status = "failed"
      $result.supabase_google_apply.error = $_.Exception.Message
    }
  }
}

$googleStatus = Invoke-JsonGet -Url "$($ApiBaseUrl.TrimEnd('/'))/api/v1/auth/google/status?timeoutMs=8000" -TimeoutSec 20
$result.supabase_google_probe = [ordered]@{
  reachable = $googleStatus.ok
  status = if ($googleStatus.ok) { $googleStatus.value.status } else { "" }
  enabled = if ($googleStatus.ok) { [bool]$googleStatus.value.enabled } else { $false }
  error = if ($googleStatus.ok) { $googleStatus.value.error } else { $googleStatus.error }
}

$activation = Invoke-JsonGet -Url "$($ApiBaseUrl.TrimEnd('/'))/api/v1/readiness/activation" -TimeoutSec 30
$result.local_activation_endpoint = [ordered]@{
  reachable = $activation.ok
  status = if ($activation.ok) { $activation.value.status } else { "" }
  summary = if ($activation.ok) { $activation.value.summary } else { $null }
  error = $activation.error
}

$modelProbe = Invoke-JsonGet -Url "$($ApiBaseUrl.TrimEnd('/'))/api/v1/ai/model-pool/probe?provider=gemini&timeoutMs=8000" -TimeoutSec 15
$result.gemini_probe = [ordered]@{
  reachable = $modelProbe.ok
  status = if ($modelProbe.ok) { $modelProbe.value.status } else { "" }
  provider = if ($modelProbe.ok) { $modelProbe.value.provider } else { "" }
  error = if ($modelProbe.ok) { $modelProbe.value.error } else { $modelProbe.error }
}

$adb = Get-AdbPath
$result.android = [ordered]@{
  adb_found = Test-Value $adb
  devices = @()
  install_attempted = $false
  install_status = "not_requested"
  install_error = ""
}

if (Test-Value $adb) {
  $deviceLines = (& $adb devices -l) | Where-Object { $_ -match "\sdevice\s" }
  $result.android.devices = @($deviceLines)
  if ($InstallApk) {
    $result.android.install_attempted = $true
    if (-not (Test-Path $ApkPath)) {
      $result.android.install_status = "blocked_missing_apk"
      $result.android.install_error = "APK not found at $ApkPath"
    } elseif (@($deviceLines).Count -eq 0) {
      $result.android.install_status = "blocked_no_device"
      $result.android.install_error = "No authorized Android device is attached over ADB."
    } else {
      try {
        & $adb install -r $ApkPath | Out-Null
        $result.android.install_status = "installed"
      } catch {
        $result.android.install_status = "failed"
        $result.android.install_error = $_.Exception.Message
      }
    }
  }
}

$result | ConvertTo-Json -Depth 8
