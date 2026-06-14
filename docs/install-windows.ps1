$ErrorActionPreference = "Stop"

$repo = if ($env:NIGHTGRID_REPO) { $env:NIGHTGRID_REPO } else { "Its-ze/nightgrid-cyberdeck" }
$asset = "NightGrid-Cyberdeck-Windows-x64-Setup.exe"
$url = "https://github.com/$repo/releases/latest/download/$asset"
$out = Join-Path $env:TEMP $asset

Write-Host "Downloading $url"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out
Write-Host "Launching NightGrid Cyberdeck installer"
Start-Process -FilePath $out -Wait
