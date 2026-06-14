# NightGrid Cyberdeck

NightGrid Cyberdeck is a dark desktop field console for a Linux laptop or Windows laptop with USB-connected boards.

It is built for:

- Heltec V3 / ESP32-S3 mesh boards over USB-C
- USB GPS modules that emit NMEA sentences
- Raspberry Pi Pico boards running MicroPython or CircuitPython
- Any extra serial console you want on the deck

The app runs locally. It does not send serial traffic, GPS data, or mesh output to a cloud service.

## Features

- Serial port scanner with Heltec, Pico, GPS, CP210x, CH340, and ESP32 hints.
- Role-based connect presets for Heltec mesh, GPS NMEA, Pico console, and generic serial.
- Live serial console with RX/TX/status lanes.
- GPS fix panel for GGA/RMC NMEA sentences.
- Pico quick keys for Ctrl-C, Ctrl-D, `help()`, and file listing.
- Optional Meshtastic CLI bridge for Heltec info, node list, and text sends.
- GitHub Pages installer page plus GitHub Actions release builds for Linux and Windows.

## Install

Download installers from the GitHub Pages installer page:

https://its-ze.github.io/nightgrid-cyberdeck/

Linux quick install:

```bash
curl -fsSL https://its-ze.github.io/nightgrid-cyberdeck/install-linux.sh | bash
```

Windows quick install from PowerShell:

```powershell
irm https://its-ze.github.io/nightgrid-cyberdeck/install-windows.ps1 | iex
```

## Linux USB Access

Most Linux systems require your user to be in the serial group before a USB board can be opened:

```bash
sudo usermod -aG dialout "$USER"
```

Log out and back in after changing groups. Some distros use `uucp` or `plugdev` instead of `dialout`.

## Meshtastic CLI Bridge

NightGrid can run Meshtastic commands through the local Python CLI if it is installed. On Linux:

```bash
python3 -m pip install --user meshtastic
```

On Windows:

```powershell
py -m pip install --user meshtastic
```

The CLI needs exclusive access to the Heltec serial port. Disconnect the live NightGrid serial session before running `Info`, `Nodes`, or `Mesh`.

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
git tag v0.1.0
git push origin v0.1.0
```

The release workflow uploads:

- `NightGrid-Cyberdeck-Linux-x64.AppImage`
- `NightGrid-Cyberdeck-Linux-x64.deb`
- `NightGrid-Cyberdeck-Windows-x64-Setup.exe`

## Safety Notes

- Meshtastic `--info` can include private channel material. Treat copied output as sensitive.
- Do not publish captured serial logs unless you have reviewed them.
- GPS coordinates are displayed locally in the app and are not transmitted by NightGrid.
