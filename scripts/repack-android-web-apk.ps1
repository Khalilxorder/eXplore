$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'releases'
$inputApk = Join-Path $releaseDir 'eXPLORE-release.apk'
$publicAssets = Join-Path $projectRoot 'android\app\src\main\assets\public'
$keystorePropertiesPath = Join-Path $projectRoot 'android\keystore.properties'
$buildToolsRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$workRoot = Join-Path $projectRoot "tmp\apk-repack-$stamp"
$unpackDir = Join-Path $workRoot 'unpacked'
$inputZip = Join-Path $workRoot 'input.zip'
$unsignedZip = Join-Path $workRoot 'unsigned.zip'
$alignedApk = Join-Path $workRoot 'aligned.apk'
$freshApk = Join-Path $releaseDir "eXPLORE-release-$stamp.apk"
$backupApk = Join-Path $releaseDir "eXPLORE-release-before-$stamp.apk"
$canonicalApk = Join-Path $releaseDir 'eXPLORE-release.apk'

function Read-SimpleProperties {
  param([string]$Path)

  $map = @{}
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

function Assert-InProject {
  param([string]$Path)

  $resolved = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetFullPath($projectRoot)
  if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify outside project root: $resolved"
  }
}

if (-not (Test-Path $inputApk)) {
  throw "Release APK not found: $inputApk"
}
if (-not (Test-Path $publicAssets)) {
  throw "Current Android public assets not found: $publicAssets"
}
if (-not (Test-Path $keystorePropertiesPath)) {
  throw "Keystore properties not found: $keystorePropertiesPath"
}

$buildTools = Get-ChildItem $buildToolsRoot -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1
if (-not $buildTools) {
  throw "Android build-tools not found under $buildToolsRoot"
}

$zipalign = Join-Path $buildTools.FullName 'zipalign.exe'
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
if (-not (Test-Path $zipalign) -or -not (Test-Path $apksigner)) {
  throw "zipalign/apksigner not found in $($buildTools.FullName)"
}

$properties = Read-SimpleProperties -Path $keystorePropertiesPath
$keystorePath = Join-Path (Join-Path $projectRoot 'android') $properties['storeFile']
$storePassword = [string]$properties['storePassword']
$keyAlias = [string]$properties['keyAlias']
$keyPassword = [string]$properties['keyPassword']
if (-not (Test-Path $keystorePath) -or [string]::IsNullOrWhiteSpace($storePassword) -or [string]::IsNullOrWhiteSpace($keyAlias)) {
  throw 'Release keystore configuration is incomplete.'
}

Assert-InProject $workRoot
Assert-InProject $freshApk
Assert-InProject $backupApk
New-Item -ItemType Directory -Path $unpackDir -Force | Out-Null

Copy-Item -LiteralPath $inputApk -Destination $inputZip -Force
Expand-Archive -LiteralPath $inputZip -DestinationPath $unpackDir -Force

$targetPublicAssets = Join-Path $unpackDir 'assets\public'
Assert-InProject $targetPublicAssets
if (Test-Path $targetPublicAssets) {
  Remove-Item -LiteralPath $targetPublicAssets -Recurse -Force
}
New-Item -ItemType Directory -Path (Split-Path -Parent $targetPublicAssets) -Force | Out-Null
Copy-Item -LiteralPath $publicAssets -Destination $targetPublicAssets -Recurse -Force

$signatureDir = Join-Path $unpackDir 'META-INF'
Assert-InProject $signatureDir
if (Test-Path $signatureDir) {
  Remove-Item -LiteralPath $signatureDir -Recurse -Force
}

& jar cf $unsignedZip -C $unpackDir .
if ($LASTEXITCODE -ne 0) {
  throw "jar packaging failed with exit code $LASTEXITCODE"
}

& $zipalign -p -f 4 $unsignedZip $alignedApk
if ($LASTEXITCODE -ne 0) {
  throw "zipalign failed with exit code $LASTEXITCODE"
}

$signArgs = @(
  'sign',
  '--ks', $keystorePath,
  '--ks-key-alias', $keyAlias,
  '--ks-pass', "pass:$storePassword",
  '--key-pass', "pass:$keyPassword",
  '--out', $freshApk,
  $alignedApk
)
& $apksigner @signArgs
if ($LASTEXITCODE -ne 0) {
  throw "apksigner sign failed with exit code $LASTEXITCODE"
}

& $apksigner verify --verbose $freshApk
if ($LASTEXITCODE -ne 0) {
  throw "apksigner verify failed with exit code $LASTEXITCODE"
}

Copy-Item -LiteralPath $canonicalApk -Destination $backupApk -Force
Copy-Item -LiteralPath $freshApk -Destination $canonicalApk -Force

$buildMeta = Join-Path $publicAssets '__explore_build.json'
$meta = if (Test-Path $buildMeta) { Get-Content $buildMeta -Raw | ConvertFrom-Json } else { $null }

$result = [pscustomobject]@{
  apk = $canonicalApk
  stampedApk = $freshApk
  backupApk = $backupApk
  buildId = $meta.buildId
  builtAt = $meta.builtAt
  signed = $true
  buildTools = $buildTools.Name
}

Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue

$result | ConvertTo-Json -Depth 3
