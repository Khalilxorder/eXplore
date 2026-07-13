$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$exportDir = Join-Path $workspaceRoot 'out'
$nextDir = Join-Path $workspaceRoot '.next'
$publicDir = Join-Path $workspaceRoot 'public'
$packageJsonPath = Join-Path $workspaceRoot 'package.json'
$packageInfo = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

$buildId = if ($env:EXPLORE_BUILD_ID) {
  $env:EXPLORE_BUILD_ID
} else {
  "explore-$(Get-Date -Format 'yyyyMMddHHmmss')-$([guid]::NewGuid().ToString('N').Substring(0,8))"
}

$buildTime = if ($env:EXPLORE_BUILD_TIME) {
  $env:EXPLORE_BUILD_TIME
} else {
  (Get-Date).ToUniversalTime().ToString('o')
}

$env:EXPLORE_BUILD_ID = $buildId
$env:EXPLORE_BUILD_TIME = $buildTime
$env:NEXT_PUBLIC_BUILD_ID = $buildId
$env:NEXT_PUBLIC_BUILD_TIME = $buildTime
$env:EXPLORE_RELEASE_CHANNEL = if ($env:EXPLORE_RELEASE_CHANNEL) { $env:EXPLORE_RELEASE_CHANNEL } else { 'local-static' }
$env:NEXT_DIST_DIR = '.next'

if (Test-Path $nextDir) {
  Write-Host "Cleaning previous Next build output at $nextDir"
  Remove-Item $nextDir -Recurse -Force
}

if (Test-Path $exportDir) {
  Remove-Item $exportDir -Recurse -Force
}

Write-Host "Building Explore export with build id $buildId"
$nextBin = Join-Path $workspaceRoot 'node_modules\next\dist\bin\next'
$maxBuildAttempts = 3
$buildSucceeded = $false

for ($attempt = 1; $attempt -le $maxBuildAttempts; $attempt++) {
  Write-Host "Running Next.js build attempt $attempt of $maxBuildAttempts"
  & node $nextBin build --webpack

  if ($LASTEXITCODE -eq 0) {
    $buildSucceeded = $true
    break
  }

  if ($attempt -lt $maxBuildAttempts) {
    Write-Warning "Next.js build failed with exit code $LASTEXITCODE. Retrying after cleaning $nextDir."
    if (Test-Path $nextDir) {
      Remove-Item $nextDir -Recurse -Force
    }
  }
}

if (-not $buildSucceeded) {
  exit $LASTEXITCODE
}

if (-not (Test-Path $exportDir)) {
  New-Item -ItemType Directory -Path $exportDir -Force | Out-Null
}

$appServerDir = Join-Path $nextDir 'server\\app'
$pagesServerDir = Join-Path $nextDir 'server\\pages'
$nextStaticDir = Join-Path $nextDir 'static'

if (-not (Test-Path (Join-Path $appServerDir 'index.html'))) {
  throw "Static app output is missing at $appServerDir\\index.html"
}

Copy-Item (Join-Path $appServerDir 'index.html') (Join-Path $exportDir 'index.html') -Force

$notFoundSource = if (Test-Path (Join-Path $appServerDir '_not-found.html')) {
  Join-Path $appServerDir '_not-found.html'
} elseif (Test-Path (Join-Path $pagesServerDir '404.html')) {
  Join-Path $pagesServerDir '404.html'
} else {
  $null
}

if ($notFoundSource) {
  Copy-Item $notFoundSource (Join-Path $exportDir '404.html') -Force
}

if (Test-Path $nextStaticDir) {
  $nextExportRoot = Join-Path $exportDir '_next'
  if (-not (Test-Path $nextExportRoot)) {
    New-Item -ItemType Directory -Path $nextExportRoot -Force | Out-Null
  }
  Copy-Item $nextStaticDir (Join-Path $nextExportRoot 'static') -Recurse -Force
}

if (Test-Path $publicDir) {
  Get-ChildItem $publicDir -Force | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $exportDir $_.Name) -Recurse -Force
  }
}

$metadata = [ordered]@{
  app = 'eXPLORE'
  packageName = $packageInfo.name
  packageVersion = $packageInfo.version
  buildId = $buildId
  builtAt = $buildTime
  exportDir = 'out'
  nodeVersion = (node -v)
}

$metadataPath = Join-Path $exportDir '__explore_build.json'
$metadataJson = ($metadata | ConvertTo-Json -Depth 4)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($metadataPath, $metadataJson + [Environment]::NewLine, $utf8NoBom)
if (-not (Test-Path $metadataPath)) {
  throw "Failed to write build metadata to $metadataPath"
}

Write-Host "Wrote build metadata to $metadataPath"
