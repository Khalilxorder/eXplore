param(
  [int]$Port = 3000
)

$candidateAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -and
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254*' -and
    $_.PrefixOrigin -ne 'WellKnown'
  } |
  Sort-Object -Property InterfaceMetric, SkipAsSource

$lanIp = $candidateAddresses | Select-Object -ExpandProperty IPAddress -First 1

if (-not $lanIp) {
  throw 'Could not detect a LAN IPv4 address for live reload.'
}

Write-Host "Using live-reload host: $lanIp`:$Port"
Write-Host 'Make sure your phone and this computer are on the same Wi-Fi and that the backend is running on port 8080.'

npx cap run android -l --host $lanIp --port $Port
