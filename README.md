# NightGrid Cyberdeck

NightGrid Cyberdeck is a dark desktop field console for a Linux laptop or Windows laptop with USB-connected boards.

It is built for:

- Heltec V3 / ESP32-S3 mesh boards over USB-C
- LilyGO T-Deck mesh radios when they appear as USB serial
- LILYGO T-Dongle / ESP32-S3 USB serial devices
- Generic ESP32 modules and dev boards over CP210x, CH340, or Espressif USB serial
- Flipper Zero over its USB CLI serial port
- USB GPS modules that emit NMEA sentences
- Raspberry Pi Pico boards running MicroPython or CircuitPython
- Any extra serial console you want on the deck

The app runs locally. It does not send serial traffic, GPS data, or mesh output to a cloud service.

## Features

- Serial port scanner with Heltec V3, T-Deck, T-Dongle, ESP32, Flipper Zero, Pico, GPS, CP210x, CH340, and Heltec CP210x candidate hints.
- Role-based connect presets for Heltec/T-Deck mesh, T-Dongle serial, ESP32 modules, Flipper CLI, GPS NMEA, Pico console, and generic serial.
- Command Deck macro launcher for selected-device help/status, mesh nodes, GPS push, T-Dongle status, deck-ready payload, ESP32 ping, and memory checks.
- Tabbed Marketplace packs for T-Deck, T-Dongle, ESP32, ESP32-S3, WLED, ESPHome, MicroPython, CircuitPython, ESP-IDF, Arduino-ESP32, Tasmota, ESP-NOW, RainMaker, LVGL, Matter, and Meshtastic workflows.
- Top HUD with deck state, session count, selected role, GPS readiness, and ESP32 auto-connect state.
- Serial console log filters for RX/TX/status plus copy and clear controls.
- Live serial console with RX/TX/status lanes, line reassembly, and ANSI cleanup for Meshtastic firmware logs.
- GPS fix panel for GGA/RMC NMEA sentences, active baud probing, cached fix display, and manual/auto push to the T-Dongle bridge.
- Heltec V3 War Drive mode for passive Meshtastic node sightings with GPS-stamped local JSONL/CSV logs.
- ESP32 module panel with automatic connect, reset, bootloader, Ctrl-C/Ctrl-D, `help()`, file listing, and remote-control actions.
- ESP32 Remote controls for host link, identify, heartbeat, Wi-Fi scan, I2C scan, GPIO write, and custom command send over MicroPython REPL or newline JSON Link.
- Flasher panel for T-Deck, ESP32-S3, ESP32, and T-Dongle serial boards with web flasher, latest firmware, connect, reset, and bootloader actions.
- ESP32 T-Deck Link controls for `cyberdeck-link-v0` probe, pair, deck-ready, launcher, and text events over the selected ESP32 serial module.
- Pico quick keys for Ctrl-C, Ctrl-D, `help()`, and file listing.
- Flipper Zero quick keys for `help`, `device_info`, storage listing, and power status.
- Optional Meshtastic CLI bridge for Heltec and T-Deck info, node list, and text sends.
- T-Dongle wireless bridge panel for probing the `CyberDeck-Link` GUI, opening Wi-Fi settings, writing the bridge URL, pairing with the T-Deck, GPS fix push, remote payloads, launcher/refresh, and text events.
- Packaged NightGrid app icon for Linux AppImage/deb, Linux launchers, Windows setup, the app window, and browser/installer preview.
- In-app Update button for replacing the Linux AppImage or launching the Windows setup updater.
- Uninstall scripts for Linux and Windows, with optional app-settings purge.
- Debian package install hook that keeps Debian/Ubuntu/Pop!_OS laptops awake when the lid is closed, and removes that policy on package removal.
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

The Linux script replaces the existing `NightGrid-Cyberdeck.AppImage` in place when that directory is writable. If the current AppImage location is read-only, the installer falls back to `~/.local/share/nightgrid-cyberdeck/NightGrid-Cyberdeck.AppImage`, installs the NightGrid icon into the user icon theme, and updates the desktop launcher with that icon path. The Windows script downloads a fresh setup executable and launches the installer/updater. Inside the app, use the `Update` button in the top bar to pull the latest release without returning to this page.

The `.deb` installer also writes `/etc/systemd/logind.conf.d/nightgrid-cyberdeck-lid.conf` so a mobile workstation keeps running with the laptop lid closed. Removing the `nightgrid-cyberdeck` package removes that drop-in. The AppImage installer does not change lid-close policy.

## Marketplace Packs

The in-app Marketplace uses tabs for Featured, All, T-Deck, T-Dongle, ESP32, Smart, Firmware, and Lab packs. Each pack opens curated official source or installer pages and applies NightGrid presets for the matching device role, baud rate, flasher target, and ESP32 Remote mode.

- T-Dongle Field Console from the official LilyGO T-Dongle-S3 project.
- T-Deck Mesh UI from Meshtastic T-Deck documentation and the Meshtastic web flasher.
- T-Deck Hardware Lab from official LilyGO T-Deck examples.
- MicroPython Remote Lab for REPL control and quick GPIO/I2C/Wi-Fi tests.
- WLED Light Rig with ESP32 GPIO16 smoke-test presets.
- ESPHome Sensor Node with web installer and JSON Link marker.
- ESP-IDF Example Bench for official Espressif example projects.
- Tasmota IoT Console with the official Tasmota web installer.
- Arduino ESP32 Starter, ESP Web Tools, CircuitPython S3 Console, MicroPython WebREPL, ESPHome Bluetooth Proxy, OpenMQTTGateway BLE, ESP-NOW Link Bench, ESP RainMaker, LVGL Display Bench, and ESP Matter Starter packs.

Marketplace actions do not silently execute third-party repository code. `Source` opens the official project, `Grab` opens the installer/docs path, `Auto setup` configures NightGrid controls, and `Run` sends the visible preset command through the same serial controls as the manual panels.

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

## Heltec V3 War Drive

Plug in the Heltec V3 and a USB GPS module, select the Heltec/Meshtastic port in the Radio tab, connect or probe the GPS module, then start `War Drive`. NightGrid polls `meshtastic --nodes`, records node IDs/names when seen, and stamps each sighting with the cached GPS fix when available. Use `Save log` to write JSONL and CSV files under the local NightGrid data folder.

War Drive mode is passive. It does not scan Wi-Fi networks or send mesh messages; it only records the node list reported by your local Meshtastic device.

## T-Dongle GUI / Remote Link

In the Radio tab, use the T-Dongle `Wireless Bridge` panel to get into the dongle GUI and connect it to the T-Deck:

1. Plug the T-Dongle into the computer and select its serial port.
2. Press `Probe GUI` to read the dongle AP/URL from `attachProbe`.
3. Press `Check GUI`. If NightGrid says `Join AP`, open `Wi-Fi settings` and join the `CyberDeck-Link` Wi-Fi AP from the laptop.
4. Press `Open GUI` for `http://192.168.4.1`; NightGrid checks reachability first so the browser does not just sit on a timeout page.
5. Press `Start link` to write the bridge URL, save the T-Deck profile, trigger the auto-pair payload, and begin pairing.
6. Enter or review the pair code, then press `Finish link` to confirm pairing and send deck-ready, launcher, and refresh commands.

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
git tag v0.1.23
git push origin v0.1.23
```

The release workflow uploads:

- `NightGrid-Cyberdeck-Linux-x64.AppImage`
- `NightGrid-Cyberdeck-Linux-x64.deb`
- `NightGrid-Cyberdeck-Windows-x64-Setup.exe`

## Safety Notes

- Meshtastic `--info` can include private channel material. Treat copied output as sensitive.
- Do not publish captured serial logs unless you have reviewed them.
- GPS coordinates and War Drive node sightings are displayed and saved locally by default. Pressing `Push fix` or enabling `Auto push` sends the current fix to the selected T-Dongle bridge.
- Marketplace packs open official external project pages and only send the explicit local preset payload shown by the selected pack.
