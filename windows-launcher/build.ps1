# Builds windows-launcher\CloudVault.exe using only tools built into Windows (.NET Framework csc).
#   powershell -ExecutionPolicy Bypass -File windows-launcher\build.ps1 [-Out <path to exe>]
param([string]$Out = (Join-Path $PSScriptRoot 'CloudVault.exe'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'app'
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

# --- icon: gradient rounded square with a padlock (matches app/icon.svg) ---
Add-Type -AssemblyName System.Drawing
$ico = Join-Path $env:TEMP 'cloudvault-icon.ico'
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$rect = New-Object System.Drawing.Rectangle 0, 0, 256, 256
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(92,124,250)), ([System.Drawing.Color]::FromArgb(112,72,232)), 45
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 112
$path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc(256 - $r, 0, $r, $r, 270, 90)
$path.AddArc(256 - $r, 256 - $r, $r, $r, 0, 90); $path.AddArc(0, 256 - $r, $r, $r, 90, 90); $path.CloseFigure()
$g.FillPath($brush, $path)
$white = [System.Drawing.Brushes]::White
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 14
$g.DrawArc($pen, 98, 64, 60, 76, 180, 180)
$g.DrawLine($pen, 98, 102, 98, 122); $g.DrawLine($pen, 158, 102, 158, 122)
$g.FillRectangle($white, 84, 118, 88, 70)
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(95,61,196))), 118, 138, 20, 20)
$g.Dispose()
# PNG-compressed .ico (supported since Windows Vista)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$fs = [System.IO.File]::Create($ico)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)
$w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
$w.Write($png); $w.Close()

# --- embed every file under app/ as resource "app/<relative/path>" ---
$resources = Get-ChildItem $app -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($app.Length).Replace('\', '/')
  "/resource:`"$($_.FullName)`",app$rel"
}

& $csc /nologo /target:winexe /optimize+ /out:"$Out" /win32icon:"$ico" `
  /reference:System.Windows.Forms.dll @resources (Join-Path $PSScriptRoot 'CloudVaultLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Write-Host "Built $Out"
