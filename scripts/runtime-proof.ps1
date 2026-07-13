$ErrorActionPreference = 'Continue'

[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable(
  'Path',
  @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';',
  'Process'
)

$pids = @()
foreach ($line in (netstat -ano | Select-String ':3000|:8080')) {
  $parts = $line.ToString().Trim() -split '\s+'
  if ($parts.Count -ge 5 -and $parts[3] -eq 'LISTENING') {
    $pids += [int]$parts[4]
  }
}
$pids | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path (Get-Location) 'runtime-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$web = Start-Process -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'dev:web') `
  -WorkingDirectory (Get-Location) `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "next-dev-proof-$stamp.out.log") `
  -RedirectStandardError (Join-Path $logDir "next-dev-proof-$stamp.err.log") `
  -PassThru

$api = Start-Process -FilePath 'npm.cmd' `
  -ArgumentList @('--prefix', 'backend', 'start') `
  -WorkingDirectory (Get-Location) `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "backend-proof-$stamp.out.log") `
  -RedirectStandardError (Join-Path $logDir "backend-proof-$stamp.err.log") `
  -PassThru

Start-Sleep -Seconds 12

$results = [ordered]@{
  webLauncherPid = $web.Id
  backendLauncherPid = $api.Id
}

try {
  $results.webStatus = (Invoke-WebRequest -Uri http://127.0.0.1:3000/ -UseBasicParsing -TimeoutSec 30).StatusCode
} catch {
  $results.webError = $_.Exception.Message
}

try {
  $results.health = (Invoke-WebRequest -Uri http://127.0.0.1:8080/api/v1/health -UseBasicParsing -TimeoutSec 20).Content | ConvertFrom-Json
} catch {
  $results.healthError = $_.Exception.Message
}

try {
  $results.googleAuth = (Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/v1/auth/google/status?timeoutMs=6000' -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
} catch {
  $results.googleAuthError = $_.Exception.Message
}

try {
  $results.modelProbe = (Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/v1/ai/model-pool/probe?provider=gemini&timeoutMs=8000' -UseBasicParsing -TimeoutSec 12).Content | ConvertFrom-Json
} catch {
  $results.modelProbeError = $_.Exception.Message
}

try {
  $results.modelPool = (Invoke-WebRequest -Uri http://127.0.0.1:8080/api/v1/ai/model-pool/status -UseBasicParsing -TimeoutSec 20).Content | ConvertFrom-Json
} catch {
  $results.modelPoolError = $_.Exception.Message
}

try {
  $vision = (Invoke-WebRequest -Uri http://127.0.0.1:8080/api/v1/readiness/vision -UseBasicParsing -TimeoutSec 20).Content | ConvertFrom-Json
  $results.vision = [ordered]@{
    status = $vision.status
    requirements = $vision.summary.requirement_count
    live = $vision.summary.live
    partial = $vision.summary.partial
    unavailable = $vision.summary.unavailable
    blockers = $vision.summary.blocker_count
  }
} catch {
  $results.visionError = $_.Exception.Message
}

try {
  $messages = (Invoke-WebRequest -Uri http://127.0.0.1:8080/api/v1/messages/readiness -UseBasicParsing -TimeoutSec 20).Content | ConvertFrom-Json
  $results.messages = [ordered]@{
    status = $messages.status
    migrationProofReady = $messages.migration_proof_ready
    runtimeSchemaReady = $messages.runtime_schema_ready
    registeredDevices = $messages.registered_device_count
    conversations = $messages.conversation_count
    messages = $messages.message_count
    blockers = @($messages.blockers).Count
  }
} catch {
  $results.messagesError = $_.Exception.Message
}

try {
  $sourceMap = (Invoke-WebRequest -Uri http://127.0.0.1:8080/api/v1/alerts/source-map -UseBasicParsing -TimeoutSec 20).Content | ConvertFrom-Json
  $results.sourceMap = [ordered]@{
    lanes = $sourceMap.summary.laneCount
    sources = $sourceMap.summary.sourceCount
    aiSources = $sourceMap.summary.aiAdvantageSourceCount
  }
} catch {
  $results.sourceMapError = $_.Exception.Message
}

try {
  $releases = (Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/v1/alerts/official-releases?limit=3' -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
  $results.officialReleases = [ordered]@{
    success = $releases.success
    count = @($releases.alerts).Count
  }
} catch {
  $results.officialReleasesError = $_.Exception.Message
}

try {
  $feed = (Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/v1/feed?refresh=1' -UseBasicParsing -TimeoutSec 45).Content | ConvertFrom-Json
  $results.feed = [ordered]@{
    latestNews = @($feed.latestNews).Count
    health = $feed.feedHealth.status
    direct = $feed.direct_feed
  }
} catch {
  $results.feedError = $_.Exception.Message
}

$body = @{
  messages = @(@{ role = 'user'; content = 'What should I watch today for AI advantage?' })
  context = 'general'
} | ConvertTo-Json -Depth 5

try {
  $chat = (Invoke-WebRequest -Uri http://127.0.0.1:8080/api/v1/chat -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 35).Content | ConvertFrom-Json
  $results.chat = [ordered]@{
    fallback = $chat.fallback
    hasReply = -not [string]::IsNullOrWhiteSpace($chat.reply)
  }
} catch {
  $results.chatError = $_.Exception.Message
}

$results | ConvertTo-Json -Depth 6
