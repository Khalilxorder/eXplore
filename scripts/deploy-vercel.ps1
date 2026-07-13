param(
  [string]$Project = "",
  [string]$Scope = ""
)

$ErrorActionPreference = "Stop"

Push-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
try {
  npm.cmd run build | Out-Host

  if ($Project) {
    $linkArgs = @("link", "--yes", "--project", $Project)
    if ($Scope) {
      $linkArgs += @("--scope", $Scope)
    }
    npx --yes vercel @linkArgs | Out-Host
  }

  npx --yes vercel --prod --yes | Out-Host
} finally {
  Pop-Location
}
