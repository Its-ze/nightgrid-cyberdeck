# NightGrid Cyberdeck

NightGrid Cyberdeck is a dark desktop field console for a Linux laptop or Windows laptop with USB-connected boards.

It is built for:

- Heltec V3 / ESP32-S3 mesh boards over USB-C
- LilyGO T-Deck mesh radios when they appear as USB serial
- LILYGO T-Dongle / ESP32-S3 USB serial devices
- Flipper Zero over its USB CLI serial port
- USB GPS modules that emit NMEA sentences
- Raspberry Pi Pico boards running MicroPython or CircuitPython
- Any extra serial console you want on the deck

The app runs locally. It does not send serial traffic, GPS data, or mesh output to a cloud service.

## Features

- Serial port scanner with Heltec, T-Deck, T-Dongle, Flipper Zero, Pico, GPS, CP210x, CH340, and ESP32 hints.
- Role-based connect presets for Heltec/T-Deck mesh, T-Dongle serial, Flipper CLI, GPS NMEA, Pico console, and generic serial.
- Live serial console with RX/TX/status lanes, line reassembly, and ANSI cleanup for Meshtastic firmware logs.
- GPS fix panel for GGA/RMC NMEA sentences, active baud probing, and manual/auto push to the T-Dongle bridge.
- Pico quick keys for Ctrl-C, Ctrl-D, `help()`, and file listing.
- Flipper Zero quick keys for `help`, `device_info`, storage listing, and power status.
- Optional Meshtastic CLI bridge for Heltec and T-Deck info, node list, and text sends.
- T-Dongle wireless bridge panel for `cyberdeck-link-v0` probe, pairing, GPS fix push, remote payloads, launcher/refresh, and text events.
- Packaged NightGrid app icon for Linux AppImage/deb, Windows setup, the app window, and browser preview.
- In-app Update button for replacing the Linux AppImage or launching the Windows setup updater.
- Uninstall scripts for Linux and Windows, with optional app-settings purge.
- GitHub Pages installer page plus GitHub Actions release builds for Linux and Windows.

## Install / Update

Download installers from the GitHub Pages installer page:

https://its-ze.github.io/nightgrid-cyberdeck/

Linux quick install or update:

```bash
curl -fsSL https://its-ze.github.io/nightgrid-cyberdeck/install-linux.sh | bash
```

Windows quick install or update from PowerShell:

```powershell
irm https://its-ze.github.io/nightgrid-cyberdeck/install-windows.ps1 | iex
```

The Linux script replaces the existing `NightGrid-Cyberdeck.AppImage` in place when that directory is writable. If the current AppImage location is read-only, the installer falls back to `~/.local/share/nightgrid-cyberdeck/NightGrid-Cyberdeck.AppImage` and updates the desktop launcher. The Windows script downloads a fresh setup executable and launches the installer/updater. Inside the app, use the `Update` button in the top bar to pull the latest release without returning to this page.

Linux uninstall:

```bash
curl -fsSL https://its-ze.github.io/nightgrid-cyberdeck/uninstall-linux.sh | bash
```

Windows uninstall from PowerShell:

```powershell
irm https://its-ze.github.io/nightgrid-cyberdeck/uninstall-windows.ps1 | iex
```

Uninstall preserves app settings by default. Set `NIGHTGRID_PURGE_DATA=1` before running the uninstall script if you also want local app settings removed.

## Linux USB Access

Most Linux systems require your user to be in the serial group before a USB board can be opened:

```bash
sudo usermod -aG dialout "$USER"
```

Log out and back in after changing groups. Some distros use `uucp` or `plugdev` instead of `dialout`.

## Meshtastic CLI Bridge

NightGrid can run Meshtastic commands through the local Python CLI. On Linux, the NightGrid install/update script creates a managed venv at `~/.local/share/nightgrid-cyberdeck/meshtastic-venv` and installs the Meshtastic CLI there. Rerun the installer to repair or update it:

```bash
curl -fsSL https://its-ze.github.io/nightgrid-cyberdeck/install-linux.sh | bash
```

If you want to manage it manually instead:

```bash
python3 -m venv ~/.local/share/nightgrid-cyberdeck/meshtastic-venv
~/.local/share/nightgrid-cyberdeck/meshtastic-venv/bin/python -m pip install --upgrade pip meshtastic
```

On Windows, install the CLI into your user Python:

```powershell
py -m pip install --user meshtastic
```

The CLI needs exclusive access to the Heltec or T-Deck serial port. Disconnect the live NightGrid serial session before running `Info`, `Nodes`, or `Mesh`.

## Development

```bash
npm install
npm run dev
```

The dev launcher starts Vite, waits for it to answer on `127.0.0.1:5173`, then opens Electron.

Build the app without packaging:

```bash
npm run build
```

Package on Linux:

```bash
npm run dist:linux
```

Package on Windows:

```powershell
npm run dist:win
```

If you are developing from a path with spaces on Windows, do not run native rebuilds from that path. The CI release path has no spaces and runs `npm run rebuild:native` before packaging.

## Release

Push a version tag to build release installers:

```bash
git tag v0.1.12
git push origin v0.1.12
```

The release workflow uploads:

- `NightGrid-Cyberdeck-Linux-x64.AppImage`
- `NightGrid-Cyberdeck-Linux-x64.deb`
- `NightGrid-Cyberdeck-Windows-x64-Setup.exe`

## Safety Notes

- Meshtastic `--info` can include private channel material. Treat copied output as sensitive.
- Do not publish captured serial logs unless you have reviewed them.
- GPS coordinates are displayed locally by default. Pressing `Push fix` or enabling `Auto push` sends the current fix to the selected T-Dongle bridge.
