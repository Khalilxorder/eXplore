param(
  [switch]$SkipConfigSync,
  [switch]$SkipWebBuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$currentDirectory = (Get-Location).ProviderPath
if (Test-Path (Join-Path $currentDirectory 'package.json')) {
  $projectRoot = $currentDirectory
}
$androidRoot = Join-Path $projectRoot 'android'
$appRoot = Join-Path $androidRoot 'app'
$keystorePropertiesPath = Join-Path $androidRoot 'keystore.properties'
$keystorePath = Join-Path $appRoot 'explore-release.keystore'
$keyAlias = 'explore-release'

function Use-Jdk21 {
  $candidates = @(
    $env:JAVA_HOME,
    'C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot',
    'C:\Program Files\Eclipse Adoptium\jdk-21*',
    'C:\Program Files\Java\jdk-21*'
  )

  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }

    $resolvedCandidates = @(Get-Item -Path $candidate -ErrorAction SilentlyContinue)
    foreach ($resolved in $resolvedCandidates) {
      $javaPath = Join-Path $resolved.FullName 'bin\java.exe'
      if (-not (Test-Path $javaPath)) {
        continue
      }

      $previousErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        $versionOutput = & $javaPath -version 2>&1 | Out-String
      } finally {
        $ErrorActionPreference = $previousErrorActionPreference
      }
      if ($versionOutput -match '"21\.') {
        $env:JAVA_HOME = $resolved.FullName
        $env:Path = "$(Join-Path $resolved.FullName 'bin');$env:Path"
        Write-Host "Using JDK 21: $($resolved.FullName)"
        return
      }
    }
  }

  throw 'JDK 21 is required for the Capacitor Android release build. Install Microsoft.OpenJDK.21 or set JAVA_HOME to a JDK 21 directory.'
}

function Ensure-AndroidSdkPath {
  $localPropertiesPath = Join-Path $androidRoot 'local.properties'
  $candidates = @(
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
  )

  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path $candidate)) {
      continue
    }

    if (Test-Path (Join-Path $candidate 'platforms\android-36')) {
      $normalized = $candidate.Replace('\', '/')
      Write-Utf8NoBomFile -Path $localPropertiesPath -Lines @("sdk.dir=$normalized")
      Write-Host "Using Android SDK: $candidate"
      return
    }
  }

  throw 'Android SDK with platform android-36 was not found. Install Android SDK 36 or set ANDROID_SDK_ROOT/ANDROID_HOME.'
}

function New-RandomSecret {
  param([int]$Length = 24)

  $bytes = New-Object byte[] ($Length)
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').TrimEnd('=').Substring(0, $Length)
}

function Write-Utf8NoBomFile {
  param(
    [string]$Path,
    [string[]]$Lines
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($Path, $Lines, $encoding)
}

function Read-SimpleProperties {
  param([string]$Path)

  $map = @{}
  if (-not (Test-Path $Path)) {
    return $map
  }

  foreach ($line in Get-Content $Path) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.Trim().StartsWith('#')) {
      continue
    }

    $parts = $line -split '=', 2
    if ($parts.Count -eq 2) {
      $map[$parts[0].Trim()] = $parts[1].Trim()
    }
  }

  return $map
}

function Write-KeystoreProperties {
  param(
    [string]$StorePassword,
    [string]$Alias
  )

  Write-Utf8NoBomFile -Path $keystorePropertiesPath -Lines @(
    'storeFile=app/explore-release.keystore'
    "storePassword=$StorePassword"
    "keyAlias=$Alias"
    "keyPassword=$StorePassword"
  )
}

Use-Jdk21
Ensure-AndroidSdkPath

if (-not $SkipConfigSync) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-machine-config.ps1')
}

if (-not (Test-Path $keystorePropertiesPath) -or -not (Test-Path $keystorePath)) {
  $storePassword = New-RandomSecret
  $dname = 'CN=eXPLORE, OU=Mobile, O=eXPLORE, L=Budapest, S=Budapest, C=HU'

  keytool -genkeypair `
    -v `
    -keystore $keystorePath `
    -alias $keyAlias `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -storepass $storePassword `
    -dname $dname | Out-Null

  Write-KeystoreProperties -StorePassword $storePassword -Alias $keyAlias
} else {
  $properties = Read-SimpleProperties -Path $keystorePropertiesPath
  $storePassword = [string]$properties['storePassword']
  if (-not [string]::IsNullOrWhiteSpace($storePassword)) {
    $existingAlias = [string]$properties['keyAlias']
    if ([string]::IsNullOrWhiteSpace($existingAlias)) {
      $existingAlias = $keyAlias
    }
    Write-KeystoreProperties -StorePassword $storePassword -Alias $existingAlias
  }
}

Push-Location $projectRoot
try {
  if ($SkipWebBuild) {
    $existingExportIndex = Join-Path $projectRoot 'out\index.html'
    if (-not (Test-Path $existingExportIndex)) {
      throw "Cannot skip web build because $existingExportIndex is missing."
    }
    Write-Host "Using existing web export at $(Join-Path $projectRoot 'out')"
  } else {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-static-export.ps1')
    if ($LASTEXITCODE -ne 0) {
      throw "Web build failed with exit code $LASTEXITCODE."
    }
  }

  $capacitorCliPath = Join-Path $projectRoot 'node_modules\@capacitor\cli\bin\capacitor'
  if (-not (Test-Path $capacitorCliPath)) {
    throw "Local Capacitor CLI was not found at $capacitorCliPath. Run npm install before building Android."
  }

  & node $capacitorCliPath sync android
  if ($LASTEXITCODE -ne 0) {
    throw "Capacitor sync failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$releaseApkPath = Join-Path $appRoot 'build\outputs\apk\release\app-release.apk'
$releaseAabPath = Join-Path $appRoot 'build\outputs\bundle\release\app-release.aab'
$workspaceReleaseDir = Join-Path $projectRoot 'releases'
$workspaceReleaseApkPath = Join-Path $workspaceReleaseDir 'eXplore-release.apk'
$workspaceReleaseAabPath = Join-Path $workspaceReleaseDir 'eXplore-release.aab'

Push-Location $androidRoot
try {
  & .\gradlew bundleRelease assembleRelease
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle release build failed with exit code $LASTEXITCODE."
  }
} catch {
  Write-Warning $_.Exception.Message
  if (Test-Path $workspaceReleaseApkPath) {
    Write-Warning 'Gradle packaging failed. Refreshing the existing native APK with the newly synced web assets instead.'
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'repack-android-web-apk.ps1')
    if ($LASTEXITCODE -ne 0) {
      throw "APK web-asset repack failed with exit code $LASTEXITCODE."
    }
    Write-Host ''
    Write-Host 'Android release APK refreshed from existing native shell.'
    Write-Host "Workspace APK: $workspaceReleaseApkPath"
    Write-Host 'AAB was not rebuilt because Gradle packaging failed.'
    exit 0
  }
  throw
} finally {
  Pop-Location
}

$desktopReleaseApkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'eXplore-release.apk'
$desktopReleaseAabPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'eXplore-release.aab'

if (-not (Test-Path $workspaceReleaseDir)) {
  New-Item -ItemType Directory -Path $workspaceReleaseDir -Force | Out-Null
}

Copy-Item -LiteralPath $releaseApkPath -Destination $workspaceReleaseApkPath -Force
Copy-Item -LiteralPath $releaseAabPath -Destination $workspaceReleaseAabPath -Force

try {
  Copy-Item -LiteralPath $releaseApkPath -Destination $desktopReleaseApkPath -Force
  Copy-Item -LiteralPath $releaseAabPath -Destination $desktopReleaseAabPath -Force
} catch {
  Write-Warning "Could not copy release files to Desktop: $($_.Exception.Message)"
}

Write-Host ''
Write-Host 'Android release build complete.'
Write-Host "Release APK: $releaseApkPath"
Write-Host "Play Store bundle: $releaseAabPath"
Write-Host "Workspace APK: $workspaceReleaseApkPath"
Write-Host "Workspace bundle: $workspaceReleaseAabPath"
Write-Host "Desktop APK: $desktopReleaseApkPath"
Write-Host "Desktop bundle: $desktopReleaseAabPath"
Write-Host "Keystore props: $keystorePropertiesPath"
