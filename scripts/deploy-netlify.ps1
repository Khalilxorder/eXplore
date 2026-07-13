$ErrorActionPreference = "Stop"

Push-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
try {
  npm.cmd run build:local | Out-Host
  npx --yes netlify deploy --prod --dir=out | Out-Host
} finally {
  Pop-Location
}
