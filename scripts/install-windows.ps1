$ErrorActionPreference = "Stop"

$repo = if ($env:NIGHTGRID_REPO) { $env:NIGHTGRID_REPO } else { "Its-ze/nightgrid-cyberdeck" }
$asset = "NightGrid-Cyberdeck-Windows-x64-Setup.exe"
$url = "https://github.com/$repo/releases/latest/download/$asset"
$out = Join-Path $env:TEMP ("NightGrid-Cyberdeck-Setup-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + ".exe")

Write-Host "Downloading $url"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out
Write-Host "Launching NightGrid Cyberdeck installer/updater"
Start-Process -FilePath $out -Wait
Write-Host "NightGrid Cyberdeck installer/updater finished"
