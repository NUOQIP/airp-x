param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$assetDirectory = Join-Path $ProjectRoot "assets"
$iconPath = Join-Path $assetDirectory "airp-x.ico"
$previewPath = Join-Path $assetDirectory "airp-x-icon.png"
$launcherPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "AIRP X.lnk"
$targetPath = Join-Path $ProjectRoot "start-airp.cmd"

if (-not (Test-Path -LiteralPath $targetPath)) {
  throw "Launcher target does not exist: $targetPath"
}

New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null

function New-RoundedRectanglePath([System.Drawing.RectangleF]$rectangle, [float]$radius) {
  $diameter = $radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($rectangle.Left, $rectangle.Top, $diameter, $diameter, 180, 90)
  $path.AddArc($rectangle.Right - $diameter, $rectangle.Top, $diameter, $diameter, 270, 90)
  $path.AddArc($rectangle.Right - $diameter, $rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($rectangle.Left, $rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$bitmap = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

$iconRectangle = [System.Drawing.RectangleF]::new(8, 8, 240, 240)
$roundedPath = New-RoundedRectanglePath $iconRectangle 50
$backgroundBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $iconRectangle,
  [System.Drawing.Color]::FromArgb(255, 12, 18, 32),
  [System.Drawing.Color]::FromArgb(255, 24, 42, 72),
  45
)
$graphics.FillPath($backgroundBrush, $roundedPath)

$glowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(58, 56, 189, 248))
$graphics.FillEllipse($glowBrush, 138, 18, 112, 112)

$font = [System.Drawing.Font]::new("Arial", 126, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$textFormat = [System.Drawing.StringFormat]::new()
$textFormat.Alignment = [System.Drawing.StringAlignment]::Center
$textFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("X", $font, $textBrush, [System.Drawing.RectangleF]::new(20, 32, 216, 196), $textFormat)

$sparkPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 56, 189, 248), 10)
$sparkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$sparkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($sparkPen, 195, 34, 195, 74)
$graphics.DrawLine($sparkPen, 175, 54, 215, 54)

$bitmap.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png)
$pngStream = [System.IO.MemoryStream]::new()
$bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()

$iconStream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = [System.IO.BinaryWriter]::new($iconStream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([uint16]1)
$writer.Write([uint16]32)
$writer.Write([uint32]$pngBytes.Length)
$writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Dispose()
$iconStream.Dispose()

$sparkPen.Dispose()
$textFormat.Dispose()
$textBrush.Dispose()
$font.Dispose()
$glowBrush.Dispose()
$backgroundBrush.Dispose()
$roundedPath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$pngStream.Dispose()

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($launcherPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "启动 AIRP X 本地角色扮演应用"
$shortcut.WindowStyle = 1
$shortcut.Save()

[pscustomobject]@{
  Launcher = $launcherPath
  Target = $targetPath
  Icon = $iconPath
}
