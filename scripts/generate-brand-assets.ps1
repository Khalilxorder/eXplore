param(
  [string]$SourceImagePath = $env:EXPLORE_ICON_SOURCE
)

Add-Type -AssemblyName System.Drawing

function New-Point([double]$x, [double]$y) {
  New-Object System.Drawing.PointF([single]$x, [single]$y)
}

function New-RoundedRectPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $path
}

function Draw-Polygon($graphics, $color, $points) {
  $brush = New-Object System.Drawing.SolidBrush($color)
  $graphics.FillPolygon($brush, $points)
  $brush.Dispose()
}

function Draw-Hawk($graphics, [int]$size, [bool]$includeBackground) {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::Transparent)

  if ($includeBackground) {
    $bgPath = New-RoundedRectPath ($size * 0.08) ($size * 0.08) ($size * 0.84) ($size * 0.84) ($size * 0.16)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      (New-Object System.Drawing.PointF(0, 0)),
      (New-Object System.Drawing.PointF($size, $size)),
      [System.Drawing.Color]::FromArgb(255, 3, 20, 56),
      [System.Drawing.Color]::FromArgb(255, 2, 11, 34)
    )
    $graphics.FillPath($bgBrush, $bgPath)

    $haloBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($bgPath)
    $haloBrush.CenterColor = [System.Drawing.Color]::FromArgb(36, 60, 120, 255)
    $haloBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    $graphics.FillPath($haloBrush, $bgPath)

    $bgBrush.Dispose()
    $haloBrush.Dispose()
    $bgPath.Dispose()
  }

  $shadowPoints = @(
    (New-Point ($size * 0.23) ($size * 0.68)),
    (New-Point ($size * 0.31) ($size * 0.40)),
    (New-Point ($size * 0.48) ($size * 0.27)),
    (New-Point ($size * 0.70) ($size * 0.31)),
    (New-Point ($size * 0.79) ($size * 0.57)),
    (New-Point ($size * 0.73) ($size * 0.83)),
    (New-Point ($size * 0.42) ($size * 0.88)),
    (New-Point ($size * 0.24) ($size * 0.79))
  )
  Draw-Polygon $graphics ([System.Drawing.Color]::FromArgb(80, 0, 0, 0)) $shadowPoints

  $bodyPoints = @(
    (New-Point ($size * 0.22) ($size * 0.66)),
    (New-Point ($size * 0.31) ($size * 0.38)),
    (New-Point ($size * 0.47) ($size * 0.24)),
    (New-Point ($size * 0.69) ($size * 0.29)),
    (New-Point ($size * 0.79) ($size * 0.55)),
    (New-Point ($size * 0.74) ($size * 0.85)),
    (New-Point ($size * 0.41) ($size * 0.90)),
    (New-Point ($size * 0.22) ($size * 0.78))
  )
  Draw-Polygon $graphics ([System.Drawing.Color]::FromArgb(255, 4, 53, 165)) $bodyPoints

  $headPoints = @(
    (New-Point ($size * 0.40) ($size * 0.34)),
    (New-Point ($size * 0.50) ($size * 0.25)),
    (New-Point ($size * 0.63) ($size * 0.24)),
    (New-Point ($size * 0.73) ($size * 0.30)),
    (New-Point ($size * 0.73) ($size * 0.40)),
    (New-Point ($size * 0.61) ($size * 0.46)),
    (New-Point ($size * 0.49) ($size * 0.43))
  )
  Draw-Polygon $graphics ([System.Drawing.Color]::FromArgb(255, 42, 123, 255)) $headPoints

  $neckPoints = @(
    (New-Point ($size * 0.51) ($size * 0.42)),
    (New-Point ($size * 0.62) ($size * 0.47)),
    (New-Point ($size * 0.67) ($size * 0.61)),
    (New-Point ($size * 0.63) ($size * 0.77)),
    (New-Point ($size * 0.54) ($size * 0.86)),
    (New-Point ($size * 0.43) ($size * 0.79)),
    (New-Point ($size * 0.42) ($size * 0.58))
  )
  Draw-Polygon $graphics ([System.Drawing.Color]::FromArgb(255, 2, 30, 111)) $neckPoints

  $leftWing = @(
    (New-Point ($size * 0.18) ($size * 0.57)),
    (New-Point ($size * 0.24) ($size * 0.42)),
    (New-Point ($size * 0.33) ($size * 0.47)),
    (New-Point ($size * 0.35) ($size * 0.73)),
    (New-Point ($size * 0.25) ($size * 0.77)),
    (New-Point ($size * 0.17) ($size * 0.67))
  )
  Draw-Polygon $graphics ([System.Drawing.Color]::FromArgb(255, 11, 74, 214)) $leftWing

  $rightWing = @(
    (New-Point ($size * 0.67) ($size * 0.46)),
    (New-Point ($size * 0.79) ($size * 0.54)),
    (New-Point ($size * 0.81) ($size * 0.74)),
    (New-Point ($size * 0.72) ($size * 0.84)),
    (New-Point ($size * 0.63) ($size * 0.77)),
    (New-Point ($size * 0.63) ($size * 0.57))
  )
  Draw-Polygon $graphics ([System.Drawing.Color]::FromArgb(255, 18, 67, 193)) $rightWing

  $beak = @(
    (New-Point ($size * 0.64) ($size * 0.29)),
    (New-Point ($size * 0.81) ($size * 0.33)),
    (New-Point ($size * 0.76) ($size * 0.45)),
    (New-Point ($size * 0.63) ($size * 0.43))
  )
  Draw-Polygon $graphics ([System.Drawing.Color]::FromArgb(255, 124, 223, 255)) $beak

  $beakShadow = @(
    (New-Point ($size * 0.60) ($size * 0.37)),
    (New-Point ($size * 0.76) ($size * 0.40)),
    (New-Point ($size * 0.71) ($size * 0.45)),
    (New-Point ($size * 0.58) ($size * 0.41))
  )
  Draw-Polygon $graphics ([System.Drawing.Color]::FromArgb(180, 20, 112, 215)) $beakShadow

  $feathers = @(
    @{ Color = [System.Drawing.Color]::FromArgb(180, 120, 79, 234); Points = @((New-Point ($size * 0.31) ($size * 0.44)), (New-Point ($size * 0.39) ($size * 0.35)), (New-Point ($size * 0.50) ($size * 0.39)), (New-Point ($size * 0.38) ($size * 0.55)), (New-Point ($size * 0.27) ($size * 0.50))) }
    @{ Color = [System.Drawing.Color]::FromArgb(165, 98, 166, 255); Points = @((New-Point ($size * 0.40) ($size * 0.31)), (New-Point ($size * 0.52) ($size * 0.24)), (New-Point ($size * 0.61) ($size * 0.27)), (New-Point ($size * 0.47) ($size * 0.37))) }
    @{ Color = [System.Drawing.Color]::FromArgb(140, 164, 98, 255); Points = @((New-Point ($size * 0.58) ($size * 0.25)), (New-Point ($size * 0.67) ($size * 0.27)), (New-Point ($size * 0.70) ($size * 0.34)), (New-Point ($size * 0.59) ($size * 0.31))) }
    @{ Color = [System.Drawing.Color]::FromArgb(150, 138, 92, 235); Points = @((New-Point ($size * 0.26) ($size * 0.58)), (New-Point ($size * 0.31) ($size * 0.49)), (New-Point ($size * 0.36) ($size * 0.54)), (New-Point ($size * 0.31) ($size * 0.71)), (New-Point ($size * 0.23) ($size * 0.67))) }
    @{ Color = [System.Drawing.Color]::FromArgb(150, 156, 112, 255); Points = @((New-Point ($size * 0.46) ($size * 0.46)), (New-Point ($size * 0.54) ($size * 0.41)), (New-Point ($size * 0.60) ($size * 0.47)), (New-Point ($size * 0.54) ($size * 0.70)), (New-Point ($size * 0.45) ($size * 0.65))) }
    @{ Color = [System.Drawing.Color]::FromArgb(145, 139, 95, 240); Points = @((New-Point ($size * 0.58) ($size * 0.52)), (New-Point ($size * 0.67) ($size * 0.47)), (New-Point ($size * 0.72) ($size * 0.54)), (New-Point ($size * 0.69) ($size * 0.78)), (New-Point ($size * 0.60) ($size * 0.70))) }
    @{ Color = [System.Drawing.Color]::FromArgb(150, 73, 132, 255); Points = @((New-Point ($size * 0.34) ($size * 0.71)), (New-Point ($size * 0.41) ($size * 0.60)), (New-Point ($size * 0.49) ($size * 0.64)), (New-Point ($size * 0.46) ($size * 0.86)), (New-Point ($size * 0.36) ($size * 0.84))) }
  )

  foreach ($feather in $feathers) {
    Draw-Polygon $graphics $feather.Color $feather.Points
  }

  $eyeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 6, 16, 42))
  $graphics.FillEllipse($eyeBrush, $size * 0.545, $size * 0.31, $size * 0.06, $size * 0.06)
  $eyeBrush.Dispose()

  $glintBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 116, 208, 255))
  $graphics.FillEllipse($glintBrush, $size * 0.568, $size * 0.327, $size * 0.013, $size * 0.013)
  $glintBrush.Dispose()

  $beakMarkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 11, 52, 116))
  $graphics.FillEllipse($beakMarkBrush, $size * 0.69, $size * 0.36, $size * 0.017, $size * 0.017)
  $beakMarkBrush.Dispose()
}

function Save-ScaledBitmap($sourceBitmap, [int]$size, [string]$path) {
  $target = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($sourceBitmap, 0, 0, $size, $size)
  $target.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $target.Dispose()
}

function Save-IcoFromPng([string]$pngPath, [string]$icoPath) {
  $pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
  $stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($stream)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]1)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngBytes.Length)
  $writer.Write([UInt32]22)
  $writer.Write($pngBytes)
  $writer.Dispose()
  $stream.Dispose()
}

function Get-ContentBounds([System.Drawing.Bitmap]$bitmap, [int]$lightThreshold = 246) {
  $minX = $bitmap.Width
  $minY = $bitmap.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $bitmap.Height; $y += 1) {
    for ($x = 0; $x -lt $bitmap.Width; $x += 1) {
      $pixel = $bitmap.GetPixel($x, $y)
      if ($pixel.A -lt 16) {
        continue
      }

      $isNearWhite = (
        $pixel.R -ge $lightThreshold -and
        $pixel.G -ge $lightThreshold -and
        $pixel.B -ge $lightThreshold
      )

      if ($isNearWhite) {
        continue
      }

      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }

  if ($maxX -lt 0 -or $maxY -lt 0) {
    return New-Object System.Drawing.RectangleF(0, 0, $bitmap.Width, $bitmap.Height)
  }

  return New-Object System.Drawing.RectangleF(
    [single]$minX,
    [single]$minY,
    [single]($maxX - $minX + 1),
    [single]($maxY - $minY + 1)
  )
}

function Get-SquareCropRect([System.Drawing.Bitmap]$bitmap, [System.Drawing.RectangleF]$contentBounds, [double]$targetFill = 0.96) {
  $maxCropSize = [double][Math]::Min($bitmap.Width, $bitmap.Height)
  $contentSize = [double][Math]::Max($contentBounds.Width, $contentBounds.Height)
  $cropSize = [double][Math]::Min($maxCropSize, [Math]::Ceiling($contentSize / $targetFill))
  $centerX = [double]$contentBounds.X + ([double]$contentBounds.Width / 2.0)
  $centerY = [double]$contentBounds.Y + ([double]$contentBounds.Height / 2.0)
  $cropX = $centerX - ($cropSize / 2.0)
  $cropY = $centerY - ($cropSize / 2.0)

  if ($cropX -lt 0.0) {
    $cropX = 0.0
  }
  if ($cropY -lt 0.0) {
    $cropY = 0.0
  }

  if (($cropX + $cropSize) -gt $bitmap.Width) {
    $cropX = [double]$bitmap.Width - $cropSize
  }
  if (($cropY + $cropSize) -gt $bitmap.Height) {
    $cropY = [double]$bitmap.Height - $cropSize
  }

  return New-Object System.Drawing.RectangleF(
    [single]$cropX,
    [single]$cropY,
    [single]$cropSize,
    [single]$cropSize
  )
}

function New-BitmapFromSource([string]$sourcePath, [int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $source = New-Object System.Drawing.Bitmap $sourcePath
  $contentBounds = Get-ContentBounds $source
  $sourceRect = Get-SquareCropRect $source $contentBounds
  $destRect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $graphics.DrawImage($source, $destRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  $source.Dispose()
  $graphics.Dispose()

  return $bitmap
}

$root = Split-Path -Parent $PSScriptRoot
$defaultSourceImagePath = Join-Path $root 'public\\brand-source.png'
$resolvedSourceImagePath = $null
if (-not $SourceImagePath -and (Test-Path $defaultSourceImagePath)) {
  $SourceImagePath = $defaultSourceImagePath
}

if ($SourceImagePath) {
  $candidatePath = [System.IO.Path]::GetFullPath($SourceImagePath)
  if (Test-Path $candidatePath) {
    $resolvedSourceImagePath = $candidatePath
  } else {
    Write-Warning "Source image not found at '$SourceImagePath'. Falling back to the generated hawk mark."
  }
}

if ($resolvedSourceImagePath) {
  $fullBitmap = New-BitmapFromSource $resolvedSourceImagePath 1024
  $foregroundBitmap = New-BitmapFromSource $resolvedSourceImagePath 1024
} else {
  $fullBitmap = New-Object System.Drawing.Bitmap 1024, 1024
  $fullGraphics = [System.Drawing.Graphics]::FromImage($fullBitmap)
  Draw-Hawk $fullGraphics 1024 $true
  $fullGraphics.Dispose()

  $foregroundBitmap = New-Object System.Drawing.Bitmap 1024, 1024
  $foregroundGraphics = [System.Drawing.Graphics]::FromImage($foregroundBitmap)
  Draw-Hawk $foregroundGraphics 1024 $false
  $foregroundGraphics.Dispose()
}

$fullBitmap.Save((Join-Path $root 'public\\brand-hawk-1024.png'), [System.Drawing.Imaging.ImageFormat]::Png)

Save-ScaledBitmap $fullBitmap 512 (Join-Path $root 'public\\icon-512.png')
Save-ScaledBitmap $fullBitmap 192 (Join-Path $root 'public\\icon-192.png')
Save-ScaledBitmap $fullBitmap 180 (Join-Path $root 'public\\apple-touch-icon.png')
Save-ScaledBitmap $fullBitmap 256 (Join-Path $root 'public\\favicon-256.png')
Save-IcoFromPng (Join-Path $root 'public\\favicon-256.png') (Join-Path $root 'src\\app\\favicon.ico')
Remove-Item (Join-Path $root 'public\\favicon-256.png') -Force

$androidRes = Join-Path $root 'android\\app\\src\\main\\res'
$launcherSizes = @{
  'mipmap-mdpi' = 48
  'mipmap-hdpi' = 72
  'mipmap-xhdpi' = 96
  'mipmap-xxhdpi' = 144
  'mipmap-xxxhdpi' = 192
}

foreach ($entry in $launcherSizes.GetEnumerator()) {
  $folder = Join-Path $androidRes $entry.Key
  Save-ScaledBitmap $fullBitmap $entry.Value (Join-Path $folder 'ic_launcher.png')
  Save-ScaledBitmap $fullBitmap $entry.Value (Join-Path $folder 'ic_launcher_round.png')
  Save-ScaledBitmap $foregroundBitmap $entry.Value (Join-Path $folder 'ic_launcher_foreground.png')
}

$fullBitmap.Dispose()
$foregroundBitmap.Dispose()

$testIcon = Join-Path $root 'public\\_test_icon.png'
if (Test-Path $testIcon) {
  Remove-Item $testIcon -Force
}
