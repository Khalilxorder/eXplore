param(
    [string]$Source = "C:\Users\khali\OneDrive - elte.hu",
    [string]$Destination = "C:\Users\khali\OneDrive - Hashemite University\ELTE clone 2026-07-03",
    [long]$MaxFileBytes = 52428800,
    [int]$MaxFiles = 1000,
    [double]$MinFreeGB = 1.0,
    [switch]$TopLevelOnly,
    [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"

function Get-FreeGB {
    $drive = Get-PSDrive -Name C
    [math]::Round($drive.Free / 1GB, 3)
}

function Set-OnlineOnlyIfPossible {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        & attrib.exe +U -P $Path 2>$null
    }
}

function Wait-Readable {
    param(
        [string]$Path,
        [int]$TimeoutSeconds = 180
    )

    & attrib.exe -U +P $Path 2>$null
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            $stream.Dispose()
            return
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    throw "Timed out waiting for cloud file to become readable"
}

if (-not (Test-Path -LiteralPath $Source)) {
    throw "Source not found: $Source"
}

$SourceRoot = (Get-Item -LiteralPath $Source).FullName.TrimEnd("\")
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$logDir = Join-Path $Destination "_transfer logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$copiedLog = Join-Path $logDir "copied-$stamp.csv"
$skippedLog = Join-Path $logDir "skipped-$stamp.csv"
$errorLog = Join-Path $logDir "errors-$stamp.csv"

"Source,Destination,Bytes,Status" | Set-Content -LiteralPath $copiedLog -Encoding UTF8
"Source,Bytes,Reason" | Set-Content -LiteralPath $skippedLog -Encoding UTF8
"Source,Destination,Bytes,Error" | Set-Content -LiteralPath $errorLog -Encoding UTF8

$copied = 0
$skipped = 0
$errors = 0
$seen = 0
$stoppedLowSpace = $false

try {
if ($TopLevelOnly) {
    $inputFiles = Get-ChildItem -LiteralPath $Source -Force -File -ErrorAction SilentlyContinue | Select-Object -First $MaxFiles
} else {
    $inputFiles = Get-ChildItem -LiteralPath $Source -Recurse -Force -File -ErrorAction SilentlyContinue | Select-Object -First $MaxFiles
}

$inputFiles | ForEach-Object {
    $file = $_
    $seen++

    $free = Get-FreeGB
    if ($free -lt $MinFreeGB) {
        $script:stoppedLowSpace = $true
        Add-Content -LiteralPath $skippedLog -Encoding UTF8 -Value ('"{0}",{1},"Stopped: free space {2}GB below minimum {3}GB"' -f $file.FullName.Replace('"','""'), $file.Length, $free, $MinFreeGB)
        throw "LOW_SPACE_STOP"
    }

    $relative = $file.FullName.Substring($SourceRoot.Length).TrimStart("\")
    $target = Join-Path $Destination $relative
    $targetDir = Split-Path -Parent $target

    if ($file.Length -gt $MaxFileBytes) {
        $skipped++
        Add-Content -LiteralPath $skippedLog -Encoding UTF8 -Value ('"{0}",{1},"Skipped: larger than MaxFileBytes"' -f $file.FullName.Replace('"','""'), $file.Length)
        continue
    }

    if (Test-Path -LiteralPath $target) {
        $existing = Get-Item -LiteralPath $target -ErrorAction SilentlyContinue
        if ($existing -and $existing.Length -eq $file.Length -and $existing.LastWriteTimeUtc -ge $file.LastWriteTimeUtc) {
            $skipped++
            Add-Content -LiteralPath $skippedLog -Encoding UTF8 -Value ('"{0}",{1},"Skipped: destination already present"' -f $file.FullName.Replace('"','""'), $file.Length)
            continue
        }
    }

    if ($WhatIfOnly) {
        $copied++
        Add-Content -LiteralPath $copiedLog -Encoding UTF8 -Value ('"{0}","{1}",{2},"Would copy"' -f $file.FullName.Replace('"','""'), $target.Replace('"','""'), $file.Length)
        continue
    }

    try {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
        Wait-Readable -Path $file.FullName
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
        (Get-Item -LiteralPath $target).LastWriteTimeUtc = $file.LastWriteTimeUtc
        Set-OnlineOnlyIfPossible -Path $file.FullName
        Set-OnlineOnlyIfPossible -Path $target
        $copied++
        Add-Content -LiteralPath $copiedLog -Encoding UTF8 -Value ('"{0}","{1}",{2},"Copied"' -f $file.FullName.Replace('"','""'), $target.Replace('"','""'), $file.Length)
    } catch {
        $errors++
        Add-Content -LiteralPath $errorLog -Encoding UTF8 -Value ('"{0}","{1}",{2},"{3}"' -f $file.FullName.Replace('"','""'), $target.Replace('"','""'), $file.Length, $_.Exception.Message.Replace('"','""'))
        Set-OnlineOnlyIfPossible -Path $file.FullName
        Set-OnlineOnlyIfPossible -Path $target
    }
}
} catch {
    if (-not $stoppedLowSpace) {
        throw
    }
}

[pscustomobject]@{
    Seen = $seen
    Copied = $copied
    Skipped = $skipped
    Errors = $errors
    FreeGB = Get-FreeGB
    CopiedLog = $copiedLog
    SkippedLog = $skippedLog
    ErrorLog = $errorLog
}
