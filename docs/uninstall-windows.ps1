$ErrorActionPreference = "Stop"

function Split-UninstallCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  $trimmed = $Command.Trim()
  if ($trimmed.StartsWith('"')) {
    $endQuote = $trimmed.IndexOf('"', 1)
    if ($endQuote -lt 1) {
      throw "Invalid uninstall command: $Command"
    }
    return @{
      FilePath = $trimmed.Substring(1, $endQuote - 1)
      Args = $trimmed.Substring($endQuote + 1).Trim()
    }
  }

  $parts = $trimmed.Split(" ", 2)
  return @{
    FilePath = $parts[0]
    Args = if ($parts.Count -gt 1) { $parts[1] } else { "" }
  }
}

function Remove-SafePath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$AllowedRoots
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $resolved = (Resolve-Path -LiteralPath $Path).ProviderPath
  $allowed = $false
  foreach ($root in $AllowedRoots) {
    if (-not $root) {
      continue
    }
    $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd("\")
    if ($resolved.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      $allowed = $true
      break
    }
  }

  if (-not $allowed) {
    throw "Refusing to remove path outside expected app locations: $resolved"
  }

  Remove-Item -LiteralPath $resolved -Recurse -Force
  Write-Host "Removed $resolved"
  return $true
}

$roots = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

$apps = foreach ($root in $roots) {
  Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "NightGrid Cyberdeck" -or $_.DisplayName -eq "nightgrid-cyberdeck" }
}

$removed = $false
$app = $apps | Select-Object -First 1
if ($app) {
  $command = if ($app.UninstallString) { $app.UninstallString } else { $app.QuietUninstallString }
  if (-not $command) {
    throw "NightGrid Cyberdeck is registered, but no uninstall command was found."
  }

  $split = Split-UninstallCommand -Command $command
  Write-Host "Launching NightGrid Cyberdeck uninstaller"
  if ($split.Args) {
    Start-Process -FilePath $split.FilePath -ArgumentList $split.Args -Wait
  } else {
    Start-Process -FilePath $split.FilePath -Wait
  }
  $removed = $true
}

$shortcutRoots = @($env:USERPROFILE, $env:APPDATA, $env:PUBLIC)
$shortcuts = @(
  (Join-Path $env:USERPROFILE "Desktop\NightGrid Cyberdeck.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\NightGrid Cyberdeck.lnk"),
  (Join-Path $env:PUBLIC "Desktop\NightGrid Cyberdeck.lnk")
)

foreach ($shortcut in $shortcuts) {
  if (Remove-SafePath -Path $shortcut -AllowedRoots $shortcutRoots) {
    $removed = $true
  }
}

if ($env:NIGHTGRID_PURGE_DATA -eq "1") {
  $dataRoots = @($env:APPDATA, $env:LOCALAPPDATA)
  $dataPaths = @(
    (Join-Path $env:APPDATA "NightGrid Cyberdeck"),
    (Join-Path $env:LOCALAPPDATA "NightGrid Cyberdeck"),
    (Join-Path $env:LOCALAPPDATA "nightgrid-cyberdeck")
  )

  foreach ($dataPath in $dataPaths) {
    if (Remove-SafePath -Path $dataPath -AllowedRoots $dataRoots) {
      $removed = $true
    }
  }
}

if ($removed) {
  Write-Host "NightGrid Cyberdeck uninstall complete."
} else {
  Write-Host "NightGrid Cyberdeck was not found in the standard install locations."
}

Write-Host "Set NIGHTGRID_PURGE_DATA=1 before running this script to also remove app settings."
