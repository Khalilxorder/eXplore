[CmdletBinding()]
param()

$policyPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome\URLBlocklist'
$rules = @(
  '*://youtube.com/*',
  '*://*.youtube.com/*',
  '*://youtu.be/*',
  '*://youtube-nocookie.com/*',
  '*://*.youtube-nocookie.com/*'
)

$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated PowerShell window. It deliberately writes the machine-wide Chrome policy.'
}

New-Item -Path $policyPath -Force | Out-Null
for ($index = 0; $index -lt $rules.Count; $index += 1) {
  New-ItemProperty -LiteralPath $policyPath -Name ([string]($index + 1)) -Value $rules[$index] -PropertyType String -Force | Out-Null
}

Get-Item -LiteralPath $policyPath | Select-Object -ExpandProperty Property | Sort-Object | ForEach-Object {
  [PSCustomObject]@{ Rule = $_; Pattern = Get-ItemPropertyValue -LiteralPath $policyPath -Name $_ }
} | Format-Table -AutoSize
