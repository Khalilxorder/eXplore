param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectName
)

$ErrorActionPreference = "Stop"

Push-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
try {
  npm.cmd run build:local | Out-Host
  npx --yes wrangler pages deploy out --project-name $ProjectName | Out-Host
} finally {
  Pop-Location
}
