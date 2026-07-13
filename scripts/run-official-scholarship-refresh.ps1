param(
  [switch]$DryRun,
  [string[]]$Source = @(),
  [int]$MaxLinks = 24,
  [string]$Db = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ScriptPath = Join-Path $ProjectRoot "backend\opportunities\refresh_official_scholarships.py"

function Resolve-Python {
  $candidatePaths = @(
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"),
    "python",
    "python3"
  )

  foreach ($candidate in $candidatePaths) {
    if ($candidate -like "*.exe" -and (Test-Path -LiteralPath $candidate)) {
      return @{ Command = $candidate; PrefixArgs = @() }
    }

    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
      return @{ Command = $command.Source; PrefixArgs = @() }
    }
  }

  $pyLauncher = Get-Command "py" -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    return @{ Command = $pyLauncher.Source; PrefixArgs = @("-3") }
  }

  throw "Python 3 was not found. Install Python or add it to PATH before refreshing official scholarship sources."
}

$python = Resolve-Python
$argsList = @($python.PrefixArgs + @($ScriptPath, "--max-links", [string]$MaxLinks))

if ($DryRun) {
  $argsList += "--dry-run"
}

if ($Db) {
  $argsList += @("--db", $Db)
}

foreach ($sourceId in $Source) {
  if ($sourceId) {
    $argsList += @("--source", $sourceId)
  }
}

& $python.Command @argsList
exit $LASTEXITCODE
