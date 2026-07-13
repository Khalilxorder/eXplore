param(
  [switch]$SkipConfigSync
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'android'
$appRoot = Join-Path $androidRoot 'app'

if (-not $SkipConfigSync) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-machine-config.ps1')
}

Push-Location $projectRoot
try {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-static-export.ps1')
  if ($LASTEXITCODE -ne 0) {
    throw "Web build failed with exit code $LASTEXITCODE."
  }

  & npx cap sync android
  if ($LASTEXITCODE -ne 0) {
    throw "Capacitor sync failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

Push-Location $androidRoot
try {
  & .\gradlew assembleDebug
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle debug build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$debugApkPath = Join-Path $appRoot 'build\outputs\apk\debug\app-debug.apk'
$desktopApkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'eXplore-debug.apk'
Copy-Item -LiteralPath $debugApkPath -Destination $desktopApkPath -Force

Write-Host ''
Write-Host 'Android debug build complete.'
Write-Host "Debug APK: $debugApkPath"
Write-Host "Desktop APK: $desktopApkPath"
