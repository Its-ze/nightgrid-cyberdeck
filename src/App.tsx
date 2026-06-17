import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cable,
  Clipboard,
  Cpu,
  Crosshair,
  Download,
  ExternalLink,
  Gauge,
  MapPin,
  PackageOpen,
  Plug,
  Power,
  Radio,
  RefreshCw,
  Satellite,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Terminal,
  Usb,
  Zap
} from "lucide-react";
import { createPreviewApi } from "./previewApi";
import type {
  CommandResult,
  DevicePort,
  DeviceRole,
  DongleCommandPayload,
  GpsFix,
  SerialEvent,
  SerialSession,
  SerialStatusEvent,
  WarDriveRecord
} from "./types";

interface LogEntry {
  id: number;
  channel: "rx" | "tx" | "status";
  at: string;
  path?: string;
  role?: DeviceRole;
  text: string;
}

interface ParsedMeshNode {
  nodeId: string;
  nodeName?: string;
  raw: string;
}

type LogFilter = "all" | "rx" | "tx" | "status";
type FlasherTarget = "tdeck" | "esp32s3" | "esp32" | "tdongle";
type Esp32RemoteMode = "repl" | "json";
type MarketplaceFilter = "featured" | "all" | "tdeck" | "tdongle" | "esp32" | "smart" | "firmware" | "lab";
type MarketplaceCategory = Exclude<MarketplaceFilter, "featured" | "all">;
type SideTab = "marketplace" | "command" | "radio" | "modules" | "flash";
type MarketplaceSetup =
  | {
      kind: "esp32-remote";
      label: string;
      mode: Esp32RemoteMode;
      replCode: string;
      jsonCommand: DongleCommandPayload;
    }
  | {
      kind: "dongle";
      command: DongleCommandPayload;
    }
  | {
      kind: "mesh-info";
    }
  | {
      kind: "open";
      url: string;
    };

interface MarketplacePack {
  id: string;
  title: string;
  category: MarketplaceCategory;
  featured?: boolean;
  extraTabs?: MarketplaceFilter[];
  device: "T-Deck" | "T-Dongle" | "ESP32" | "ESP32-S3";
  badge: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  installUrl?: string;
  targetRole?: DeviceRole;
  remoteMode?: Esp32RemoteMode;
  remotePin?: string;
  remoteValue?: string;
  remoteCommand?: string;
  flasherTarget?: FlasherTarget;
  setup: MarketplaceSetup;
}

const baudRates = [9600, 38400, 57600, 115200, 230400, 460800, 921600];
const gpsFreshMs = 6000;
const gpsCacheTtlMs = 120000;
const warDriveRepeatMs = 60000;
const zDeckFlasherUrl = "https://its-ze.github.io/Z-Deck-Web-Flasher/";
const zDeckReleaseUrl = "https://github.com/Its-ze/Z-Deck-Web-Flasher/releases/latest";
const esp32RemoteProtocol = "nightgrid-esp32-remote-v0";
const defaultDongleGuiUrl = "http://192.168.4.1";
const defaultDongleSsid = "CyberDeck-Link";

const flasherTargetLabels: Record<FlasherTarget, string> = {
  tdeck: "T-Deck",
  esp32s3: "ESP32-S3",
  esp32: "ESP32",
  tdongle: "T-Dongle"
};

const esp32RemoteModeLabels: Record<Esp32RemoteMode, string> = {
  repl: "MicroPython REPL",
  json: "JSON Link"
};

const marketplaceFilters: Array<{ value: MarketplaceFilter; label: string }> = [
  { value: "featured", label: "Featured" },
  { value: "all", label: "All" },
  { value: "tdeck", label: "T-Deck" },
  { value: "tdongle", label: "T-Dongle" },
  { value: "esp32", label: "ESP32" },
  { value: "smart", label: "Smart" },
  { value: "firmware", label: "Firmware" },
  { value: "lab", label: "Lab" }
];

const marketplacePacks: MarketplacePack[] = [
  {
    id: "tdongle-field-console",
    title: "T-Dongle Field Console",
    category: "tdongle",
    device: "T-Dongle",
    badge: "Display + SD + BLE",
    summary: "LilyGO T-Dongle-S3 starter lane for display, SD, Wi-Fi, BLE, and USB serial work.",
    sourceName: "LilyGO T-Dongle-S3",
    sourceUrl: "https://github.com/Xinyuan-LilyGO/T-Dongle-S3",
    targetRole: "tdongle",
    flasherTarget: "tdongle",
    featured: true,
    extraTabs: ["firmware"],
    setup: { kind: "dongle", command: { cmd: "status" } }
  },
  {
    id: "tdeck-mesh-ui",
    title: "T-Deck Mesh UI",
    category: "tdeck",
    device: "T-Deck",
    badge: "Meshtastic",
    summary: "Mesh-radio setup for the T-Deck screen, keyboard, trackball, GPS variants, and LoRa console flow.",
    sourceName: "Meshtastic T-Deck docs",
    sourceUrl: "https://meshtastic.org/docs/hardware/devices/lilygo/tdeck/",
    installUrl: "https://flasher.meshtastic.org/",
    targetRole: "tdeck",
    flasherTarget: "tdeck",
    featured: true,
    extraTabs: ["firmware"],
    setup: { kind: "mesh-info" }
  },
  {
    id: "lilygo-tdeck-examples",
    title: "T-Deck Hardware Lab",
    category: "tdeck",
    device: "T-Deck",
    badge: "Keyboard + GPS + LVGL",
    summary: "Official LilyGO examples for keyboard, LoRaWAN, microphone, touchpad, GPS shield, LVGL, and unit tests.",
    sourceName: "LilyGO T-Deck repo",
    sourceUrl: "https://github.com/Xinyuan-LilyGO/T-Deck",
    targetRole: "tdeck",
    flasherTarget: "tdeck",
    extraTabs: ["lab"],
    setup: { kind: "mesh-info" }
  },
  {
    id: "micropython-remote-lab",
    title: "MicroPython Remote Lab",
    category: "esp32",
    device: "ESP32",
    badge: "REPL ready",
    summary: "Fast serial REPL control for sensors, GPIO, I2C, Wi-Fi scan, and quick field scripts.",
    sourceName: "MicroPython ESP32 docs",
    sourceUrl: "https://docs.micropython.org/en/latest/esp32/tutorial/intro.html",
    targetRole: "esp32",
    remoteMode: "repl",
    remoteCommand: "import sys, gc\nprint(sys.platform, gc.mem_free())",
    featured: true,
    extraTabs: ["firmware", "lab"],
    setup: {
      kind: "esp32-remote",
      label: "MicroPython identify",
      mode: "repl",
      replCode: "import sys, gc\nprint('nightgrid:micropython sys=%s mem=%s' % (sys.platform, gc.mem_free()))",
      jsonCommand: { cmd: "remoteControl", action: "micropython.identify" }
    }
  },
  {
    id: "wled-led-lab",
    title: "WLED Light Rig",
    category: "smart",
    device: "ESP32",
    badge: "GPIO16 LED",
    summary: "LED-strip pack with WLED installer link and a local GPIO16 NeoPixel smoke-test command.",
    sourceName: "WLED getting started",
    sourceUrl: "https://kno.wled.ge/basics/getting-started/",
    installUrl: "https://install.wled.me/",
    targetRole: "esp32",
    flasherTarget: "esp32",
    remoteMode: "repl",
    remotePin: "16",
    remoteValue: "1",
    remoteCommand: "from machine import Pin\nPin(16, Pin.OUT).value(1)",
    featured: true,
    extraTabs: ["firmware"],
    setup: {
      kind: "esp32-remote",
      label: "WLED GPIO16 smoke test",
      mode: "repl",
      replCode: "from machine import Pin\nPin(16, Pin.OUT).value(1)\nprint('nightgrid:wled pin16 high')",
      jsonCommand: { cmd: "remoteControl", action: "gpio.write", pin: 16, value: 1 }
    }
  },
  {
    id: "esphome-sensor-node",
    title: "ESPHome Sensor Node",
    category: "smart",
    device: "ESP32",
    badge: "YAML + OTA",
    summary: "Smart-home pack for ESPHome Device Builder, Bluetooth proxy, sensors, local control, and OTA updates.",
    sourceName: "ESPHome",
    sourceUrl: "https://esphome.io/",
    installUrl: "https://web.esphome.io/",
    targetRole: "esp32",
    remoteMode: "json",
    remoteCommand: "esphome-node-template",
    featured: true,
    extraTabs: ["esp32", "firmware"],
    setup: {
      kind: "esp32-remote",
      label: "ESPHome host marker",
      mode: "json",
      replCode: "print('nightgrid:esphome-ready')",
      jsonCommand: { cmd: "remoteControl", action: "esphome.template", board: "esp32" }
    }
  },
  {
    id: "esp-idf-example-bench",
    title: "ESP-IDF Example Bench",
    category: "lab",
    device: "ESP32-S3",
    badge: "Official SDK",
    summary: "Espressif example-project bench for Wi-Fi, BLE, storage, peripherals, and native ESP-IDF builds.",
    sourceName: "ESP-IDF examples",
    sourceUrl: "https://github.com/espressif/esp-idf/tree/master/examples",
    targetRole: "esp32",
    flasherTarget: "esp32s3",
    remoteMode: "json",
    extraTabs: ["firmware"],
    setup: {
      kind: "esp32-remote",
      label: "ESP-IDF bench marker",
      mode: "json",
      replCode: "print('nightgrid:esp-idf-bench')",
      jsonCommand: { cmd: "remoteControl", action: "esp-idf.examples", target: "esp32s3" }
    }
  },
  {
    id: "tasmota-iot-console",
    title: "Tasmota IoT Console",
    category: "smart",
    device: "ESP32",
    badge: "Web installer",
    summary: "Tasmota pack for ESP32-class IoT control, templates, GPIO mapping, and web-console flashing.",
    sourceName: "Tasmota getting started",
    sourceUrl: "https://tasmota.github.io/docs/Getting-Started/",
    installUrl: "https://tasmota.github.io/install/",
    targetRole: "esp32",
    flasherTarget: "esp32",
    remoteMode: "json",
    extraTabs: ["firmware"],
    setup: { kind: "open", url: "https://tasmota.github.io/install/" }
  },
  {
    id: "arduino-esp32-starter",
    title: "Arduino ESP32 Starter",
    category: "esp32",
    device: "ESP32",
    badge: "Arduino core",
    summary: "Espressif Arduino core examples for quick sketches, serial tests, Wi-Fi, BLE, Matter, and peripheral bring-up.",
    sourceName: "Espressif Arduino-ESP32",
    sourceUrl: "https://github.com/espressif/arduino-esp32",
    installUrl: "https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html",
    targetRole: "esp32",
    remoteMode: "json",
    featured: true,
    extraTabs: ["firmware", "lab"],
    setup: {
      kind: "esp32-remote",
      label: "Arduino ESP32 marker",
      mode: "json",
      replCode: "print('nightgrid:arduino-esp32')",
      jsonCommand: { cmd: "remoteControl", action: "arduino-esp32.examples", target: "esp32" }
    }
  },
  {
    id: "esp-web-tools-launcher",
    title: "ESP Web Tools Launcher",
    category: "firmware",
    device: "ESP32",
    badge: "Browser flash",
    summary: "Browser-based ESP installer surface for supported ESP8266 and ESP32 firmware projects.",
    sourceName: "ESP Web Tools",
    sourceUrl: "https://github.com/esphome/esp-web-tools",
    installUrl: "https://esphome.github.io/esp-web-tools/",
    targetRole: "esp32",
    flasherTarget: "esp32",
    featured: true,
    extraTabs: ["esp32"],
    setup: { kind: "open", url: "https://esphome.github.io/esp-web-tools/" }
  },
  {
    id: "circuitpython-s3-console",
    title: "CircuitPython S3 Console",
    category: "firmware",
    device: "ESP32-S3",
    badge: "UF2 / REPL",
    summary: "CircuitPython board downloads and USB serial workflow for ESP32-S3 boards that support it.",
    sourceName: "CircuitPython downloads",
    sourceUrl: "https://circuitpython.org/downloads",
    installUrl: "https://circuitpython.org/downloads",
    targetRole: "esp32",
    flasherTarget: "esp32s3",
    remoteMode: "repl",
    extraTabs: ["esp32", "lab"],
    setup: {
      kind: "esp32-remote",
      label: "CircuitPython identify",
      mode: "repl",
      replCode: "import sys\nprint('nightgrid:circuitpython sys=%s' % sys.platform)",
      jsonCommand: { cmd: "remoteControl", action: "circuitpython.identify" }
    }
  },
  {
    id: "micropython-webrepl",
    title: "MicroPython WebREPL",
    category: "esp32",
    device: "ESP32",
    badge: "Wi-Fi REPL",
    summary: "Official MicroPython WebREPL docs and client for controlled wireless REPL experiments after you configure credentials.",
    sourceName: "MicroPython WebREPL",
    sourceUrl: "https://github.com/micropython/webrepl",
    installUrl: "https://docs.micropython.org/en/latest/esp32/quickref.html",
    targetRole: "esp32",
    remoteMode: "repl",
    extraTabs: ["lab"],
    setup: {
      kind: "esp32-remote",
      label: "WebREPL readiness marker",
      mode: "repl",
      replCode: "print('nightgrid:webrepl configure with import webrepl_setup before enabling network REPL')",
      jsonCommand: { cmd: "remoteControl", action: "micropython.webrepl.info" }
    }
  },
  {
    id: "esphome-bluetooth-proxy",
    title: "ESPHome Bluetooth Proxy",
    category: "smart",
    device: "ESP32",
    badge: "BLE relay",
    summary: "Home Assistant Bluetooth proxy workflow for ESP32 boards, with ESPHome Web as the installer path.",
    sourceName: "ESPHome Bluetooth Proxy",
    sourceUrl: "https://esphome.io/components/bluetooth_proxy/",
    installUrl: "https://web.esphome.io/",
    targetRole: "esp32",
    remoteMode: "json",
    featured: true,
    extraTabs: ["esp32", "firmware"],
    setup: {
      kind: "esp32-remote",
      label: "Bluetooth proxy marker",
      mode: "json",
      replCode: "print('nightgrid:bluetooth-proxy-template')",
      jsonCommand: { cmd: "remoteControl", action: "esphome.bluetooth_proxy", board: "esp32" }
    }
  },
  {
    id: "openmqttgateway-ble",
    title: "OpenMQTTGateway BLE",
    category: "smart",
    device: "ESP32",
    badge: "BLE to MQTT",
    summary: "BLE-to-MQTT sensor gateway pack for local-first smart-home scanning and Theengs Decoder workflows.",
    sourceName: "OpenMQTTGateway",
    sourceUrl: "https://github.com/1technophile/OpenMQTTGateway",
    installUrl: "https://docs.openmqttgateway.com/",
    targetRole: "esp32",
    remoteMode: "json",
    extraTabs: ["esp32", "firmware"],
    setup: { kind: "open", url: "https://docs.openmqttgateway.com/" }
  },
  {
    id: "esp-now-link-bench",
    title: "ESP-NOW Link Bench",
    category: "lab",
    device: "ESP32",
    badge: "Peer link",
    summary: "Espressif ESP-NOW references for low-latency device-to-device packets without a normal Wi-Fi network.",
    sourceName: "Espressif ESP-NOW",
    sourceUrl: "https://github.com/espressif/esp-now",
    installUrl: "https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/network/esp_now.html",
    targetRole: "esp32",
    remoteMode: "json",
    extraTabs: ["esp32"],
    setup: {
      kind: "esp32-remote",
      label: "ESP-NOW bench marker",
      mode: "json",
      replCode: "print('nightgrid:esp-now-bench')",
      jsonCommand: { cmd: "remoteControl", action: "esp-now.bench", target: "esp32" }
    }
  },
  {
    id: "esp-rainmaker-control",
    title: "ESP RainMaker Control",
    category: "smart",
    device: "ESP32-S3",
    badge: "Remote control",
    summary: "Espressif RainMaker pack for official remote-control and monitoring examples on ESP32-class boards.",
    sourceName: "ESP RainMaker",
    sourceUrl: "https://github.com/espressif/esp-rainmaker",
    installUrl: "https://rainmaker.espressif.com/docs/get-started.html",
    targetRole: "esp32",
    flasherTarget: "esp32s3",
    remoteMode: "json",
    extraTabs: ["firmware"],
    setup: {
      kind: "esp32-remote",
      label: "RainMaker marker",
      mode: "json",
      replCode: "print('nightgrid:rainmaker')",
      jsonCommand: { cmd: "remoteControl", action: "esp-rainmaker.examples", target: "esp32s3" }
    }
  },
  {
    id: "lvgl-display-bench",
    title: "LVGL Display Bench",
    category: "lab",
    device: "ESP32",
    badge: "Touch UI",
    summary: "LVGL display/touch demo lane for ESP32 screens and future T-Deck-style UI experiments.",
    sourceName: "LVGL ESP32 port",
    sourceUrl: "https://github.com/lvgl/lv_port_esp32",
    installUrl: "https://github.com/lvgl/lv_demos",
    targetRole: "esp32",
    remoteMode: "json",
    extraTabs: ["tdeck"],
    setup: {
      kind: "esp32-remote",
      label: "LVGL bench marker",
      mode: "json",
      replCode: "print('nightgrid:lvgl-display-bench')",
      jsonCommand: { cmd: "remoteControl", action: "lvgl.display_bench", target: "esp32" }
    }
  },
  {
    id: "esp-matter-starter",
    title: "ESP Matter Starter",
    category: "smart",
    device: "ESP32-S3",
    badge: "Matter SDK",
    summary: "Official Espressif Matter SDK lane for secure smart-home device experiments.",
    sourceName: "Espressif ESP-Matter",
    sourceUrl: "https://github.com/espressif/esp-matter",
    installUrl: "https://docs.espressif.com/projects/arduino-esp32/en/latest/matter/matter.html",
    targetRole: "esp32",
    flasherTarget: "esp32s3",
    remoteMode: "json",
    extraTabs: ["firmware"],
    setup: {
      kind: "esp32-remote",
      label: "Matter starter marker",
      mode: "json",
      replCode: "print('nightgrid:matter-starter')",
      jsonCommand: { cmd: "remoteControl", action: "esp-matter.starter", target: "esp32s3" }
    }
  }
];

const sideTabs: Array<{ value: SideTab; label: string; detail: string; icon: typeof Radio }> = [
  { value: "marketplace", label: "Market", detail: "packs", icon: PackageOpen },
  { value: "command", label: "Deck", detail: "macros", icon: Zap },
  { value: "radio", label: "Radio", detail: "GPS / mesh", icon: Radio },
  { value: "modules", label: "Modules", detail: "ESP32 / tools", icon: Cpu },
  { value: "flash", label: "Flash", detail: "firmware", icon: Download }
];

const roleLabels: Record<DeviceRole, string> = {
  heltec: "Heltec V3 mesh",
  tdeck: "T-Deck / ESP32-S3 mesh",
  tdongle: "T-Dongle console",
  esp32: "ESP32 module",
  gps: "GPS NMEA",
  pico: "Pico console",
  flipper: "Flipper Zero",
  console: "Serial console"
};

const roleIcons: Record<DeviceRole, typeof Radio> = {
  heltec: Radio,
  tdeck: Radio,
  tdongle: Cpu,
  esp32: Cpu,
  gps: Satellite,
  pico: Cpu,
  flipper: Cpu,
  console: Terminal
};

const defaultBaud = (role: DeviceRole) => (role === "gps" ? 9600 : 115200);

const isMeshRole = (role?: DeviceRole) => role === "heltec" || role === "tdeck";

const isDongleCandidate = (port: DevicePort, role?: DeviceRole) =>
  role === "tdongle" ||
  port.suggestedRole === "tdongle" ||
  (port.vendorId === "303A" && port.productId === "1001") ||
  port.tags.some((tag) => /t-dongle|t-deck\/t-dongle|lilygo esp32-s3/i.test(tag)) ||
  /t-dongle|tdongle|lilygo esp32-s3/i.test(`${port.friendlyName} ${port.manufacturer ?? ""}`);

const isEsp32Candidate = (port: DevicePort, role?: DeviceRole) =>
  role === "esp32" ||
  port.suggestedRole === "esp32" ||
  port.tags.some((tag) => /esp32|esp32-s3|cp210x|ch340|usb-serial\/jtag/i.test(tag)) ||
  ["10C4", "1A86", "303A"].includes(port.vendorId ?? "") ||
  /esp32|espressif|cp210|ch340|usb-serial\/jtag/i.test(`${port.friendlyName} ${port.manufacturer ?? ""}`);

const isFlasherCandidate = (port: DevicePort, role?: DeviceRole) =>
  role === "tdeck" ||
  role === "tdongle" ||
  role === "esp32" ||
  role === "heltec" ||
  ["tdeck", "tdongle", "esp32", "heltec"].includes(port.suggestedRole) ||
  isEsp32Candidate(port, role) ||
  port.tags.some((tag) => /esp32|esp32-s3|t-deck|t-dongle|heltec|cp210x|ch340|usb-serial\/jtag/i.test(tag));

const isGpsCandidate = (port: DevicePort, role?: DeviceRole) =>
  role === "gps" ||
  port.suggestedRole === "gps" ||
  port.tags.some((tag) => /gps|nmea/i.test(tag)) ||
  ["1546", "067B", "0403", "1A86", "10C4"].includes(port.vendorId ?? "") ||
  /gps|nmea|ublox|u-blox|gnss|global.?sat|prolific|ftdi/i.test(`${port.friendlyName} ${port.manufacturer ?? ""}`);

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(iso));

const formatCoord = (value?: number) => (typeof value === "number" ? value.toFixed(6) : "No fix");

const hasGpsCoordinates = (fix?: GpsFix | null): fix is GpsFix & { lat: number; lon: number } =>
  typeof fix?.lat === "number" && typeof fix?.lon === "number";

const hasLiveGpsCoordinates = (fix?: GpsFix | null) => {
  if (!hasGpsCoordinates(fix)) return false;
  return !/(?:no fix|void)/i.test(fix.fixQuality ?? "");
};

const mergeGpsFix = (previous: GpsFix | null, next: GpsFix): GpsFix => {
  const keepPreviousQuality = !hasLiveGpsCoordinates(next) && hasGpsCoordinates(previous);
  return {
    ...next,
    lat: next.lat ?? previous?.lat,
    lon: next.lon ?? previous?.lon,
    altitudeMeters: next.altitudeMeters ?? previous?.altitudeMeters,
    speedKnots: next.speedKnots ?? previous?.speedKnots,
    satellites: next.satellites ?? previous?.satellites,
    fixQuality: keepPreviousQuality ? previous?.fixQuality ?? next.fixQuality : next.fixQuality ?? previous?.fixQuality,
    utcTime: next.utcTime ?? previous?.utcTime
  };
};

const formatGpsAge = (ageMs: number) => {
  if (ageMs < 1000) return "now";
  if (ageMs < 60000) return `${Math.round(ageMs / 1000)}s`;
  return `${Math.round(ageMs / 60000)}m`;
};

const formatGpsStatus = (fix: GpsFix | null, ageMs: number | null) => {
  if (!fix) return "Waiting";
  if (!hasGpsCoordinates(fix)) return fix.fixQuality ?? "Waiting";
  if (ageMs === null || ageMs <= gpsFreshMs) return fix.fixQuality ?? "Live";
  if (ageMs <= gpsCacheTtlMs) return `Cached ${formatGpsAge(ageMs)}`;
  return `Stale ${formatGpsAge(ageMs)}`;
};

const formatGpsPush = (fix: GpsFix) => {
  const coords =
    typeof fix.lat === "number" && typeof fix.lon === "number"
      ? `${fix.lat.toFixed(6)},${fix.lon.toFixed(6)}`
      : "no-fix";
  const parts = [
    `GPS ${coords}`,
    typeof fix.satellites === "number" ? `sat=${fix.satellites}` : "",
    typeof fix.altitudeMeters === "number" ? `alt=${fix.altitudeMeters.toFixed(1)}m` : "",
    typeof fix.speedKnots === "number" ? `speed=${fix.speedKnots.toFixed(1)}kt` : "",
    fix.fixQuality ? `quality=${fix.fixQuality}` : "",
    fix.utcTime ? `utc=${fix.utcTime}` : ""
  ].filter(Boolean);
  return parts.join(" ");
};

const formatCommandResult = (result: CommandResult) => {
  const parts = [
    `$ ${result.command}`,
    result.stdout.trim(),
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
    `exit: ${result.code ?? "no code"}`
  ].filter(Boolean);
  return parts.join("\n\n");
};

const simpleHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const isMeshNodeLine = (line: string) => {
  if (!line || line.startsWith("$")) return false;
  if (/^(stderr:|exit:|nodes in mesh|user id|node list|connected|disconnected|warning|error)/i.test(line)) return false;
  if (/^[+|\-\s]+$/.test(line)) return false;
  return /![0-9a-f]{4,16}\b/i.test(line) || /\b[0-9a-f]{8}\b/i.test(line);
};

const parseMeshNodeOutput = (output: string): ParsedMeshNode[] => {
  const seen = new Set<string>();
  const nodes: ParsedMeshNode[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!isMeshNodeLine(raw)) continue;
    const cells = raw
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    const searchLine = cells.length > 1 ? cells.join(" ") : raw;
    const idMatch = searchLine.match(/![0-9a-f]{4,16}\b/i) ?? searchLine.match(/\b[0-9a-f]{8}\b/i);
    const nodeId = idMatch?.[0] ?? `line-${simpleHash(raw)}`;
    if (seen.has(nodeId)) continue;

    const idCellIndex = cells.findIndex((cell) => cell.includes(nodeId));
    const cellName =
      idCellIndex >= 0
        ? cells.find((cell, index) => index !== idCellIndex && !/^(last heard|snr|hops?|channel|role|hw|firmware)$/i.test(cell))
        : undefined;
    const roughName = raw
      .replace(nodeId, "")
      .replace(/[|,;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const nodeName = (cellName ?? roughName).slice(0, 80) || undefined;
    seen.add(nodeId);
    nodes.push({ nodeId, nodeName, raw });
  }

  return nodes;
};

const csvCell = (value: unknown) => {
  if (value === undefined || value === null) return "";
  const text = String(value).replace(/\r?\n/g, " ");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const warDriveCsv = (records: WarDriveRecord[]) => {
  const header = ["seenAt", "nodeId", "nodeName", "lat", "lon", "gpsStatus", "meshPath", "raw"];
  const rows = records.map((record) =>
    [
      record.seenAt,
      record.nodeId,
      record.nodeName,
      record.lat,
      record.lon,
      record.gpsStatus,
      record.meshPath,
      record.raw
    ]
      .map(csvCell)
      .join(",")
  );
  return `${header.join(",")}\n${rows.join("\n")}`;
};

const parseCommandJson = (text: string): Record<string, unknown> | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    ...trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("{") && line.endsWith("}"))
      .reverse()
  ];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next candidate; dongle output can include logs around JSON.
    }
  }
  return null;
};

const readTextField = (record: Record<string, unknown> | null, key: string) => {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
};

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return defaultDongleGuiUrl;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
};

export function App() {
  const api = useMemo(() => window.nightgrid ?? createPreviewApi(), []);
  const [ports, setPorts] = useState<DevicePort[]>([]);
  const [sessions, setSessions] = useState<SerialSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [roleByPath, setRoleByPath] = useState<Record<string, DeviceRole>>({});
  const [baudByPath, setBaudByPath] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null);
  const [gpsPath, setGpsPath] = useState("");
  const [gpsBaud, setGpsBaud] = useState(9600);
  const [gpsProbeBusy, setGpsProbeBusy] = useState(false);
  const [gpsProbeOutput, setGpsProbeOutput] = useState("Probe a GPS serial port to confirm NMEA output.");
  const [gpsPushBusy, setGpsPushBusy] = useState(false);
  const [gpsAutoPush, setGpsAutoPush] = useState(false);
  const [gpsLastFixAt, setGpsLastFixAt] = useState<number | null>(null);
  const [gpsNow, setGpsNow] = useState(Date.now());
  const [serialInput, setSerialInput] = useState("");
  const [lineEnding, setLineEnding] = useState<"none" | "lf" | "crlf">("lf");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [meshBusy, setMeshBusy] = useState(false);
  const [meshOutput, setMeshOutput] = useState("Meshtastic CLI output will appear here.");
  const [meshMessage, setMeshMessage] = useState("");
  const [meshChannel, setMeshChannel] = useState("0");
  const [meshPath, setMeshPath] = useState("");
  const [warDriveActive, setWarDriveActive] = useState(false);
  const [warDriveInterval, setWarDriveInterval] = useState("20");
  const [warDriveSaving, setWarDriveSaving] = useState(false);
  const [warDriveRecords, setWarDriveRecords] = useState<WarDriveRecord[]>([]);
  const [warDriveOutput, setWarDriveOutput] = useState("War Drive mode is idle. Select a Heltec V3 mesh port and connect your GPS module.");
  const [donglePath, setDonglePath] = useState("");
  const [dongleBusy, setDongleBusy] = useState(false);
  const [dongleOutput, setDongleOutput] = useState("T-Dongle bridge output will appear here.");
  const [dongleDeckId, setDongleDeckId] = useState("itsz-tdeck");
  const [dongleDeckName, setDongleDeckName] = useState("ITSZ T-Deck");
  const [donglePairCode, setDonglePairCode] = useState("");
  const [dongleGuiUrl, setDongleGuiUrl] = useState(defaultDongleGuiUrl);
  const [dongleGuiSsid, setDongleGuiSsid] = useState(defaultDongleSsid);
  const [dongleText, setDongleText] = useState("");
  const [donglePayloadId, setDonglePayloadId] = useState("remote.deck-ready");
  const [esp32Path, setEsp32Path] = useState("");
  const [esp32AutoConnect, setEsp32AutoConnect] = useState(true);
  const [esp32Busy, setEsp32Busy] = useState(false);
  const [esp32Output, setEsp32Output] = useState("ESP32 module output will appear here.");
  const [flasherPath, setFlasherPath] = useState("");
  const [flasherTarget, setFlasherTarget] = useState<FlasherTarget>("tdeck");
  const [flasherBusy, setFlasherBusy] = useState(false);
  const [flasherOutput, setFlasherOutput] = useState("Flasher controls will appear here.");
  const [esp32LinkText, setEsp32LinkText] = useState("NightGrid ESP32 link check");
  const [esp32LinkOutput, setEsp32LinkOutput] = useState("ESP32 T-Deck link output will appear here.");
  const [esp32RemoteMode, setEsp32RemoteMode] = useState<Esp32RemoteMode>("repl");
  const [esp32RemotePin, setEsp32RemotePin] = useState("2");
  const [esp32RemoteValue, setEsp32RemoteValue] = useState("1");
  const [esp32RemoteCommand, setEsp32RemoteCommand] = useState("print('nightgrid remote')");
  const [esp32RemoteOutput, setEsp32RemoteOutput] = useState("ESP32 remote control output will appear here.");
  const [marketplaceFilter, setMarketplaceFilter] = useState<MarketplaceFilter>("featured");
  const [marketplaceBusy, setMarketplaceBusy] = useState("");
  const [marketplaceOutput, setMarketplaceOutput] = useState("Marketplace packs are ready.");
  const [sideTab, setSideTab] = useState<SideTab>("marketplace");
  const [macroBusy, setMacroBusy] = useState("");
  const [macroOutput, setMacroOutput] = useState("Command deck ready.");
  const [platform, setPlatform] = useState<{ platform: NodeJS.Platform; version: string } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const logCounter = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const lastGpsPushAt = useRef(0);
  const lastGpsPushedFixAt = useRef<number | null>(null);
  const gpsFixRef = useRef<GpsFix | null>(null);
  const gpsLastFixAtRef = useRef<number | null>(null);
  const warDriveBusyRef = useRef(false);
  const warDriveRecordsRef = useRef<WarDriveRecord[]>([]);
  const warDriveSeenRef = useRef(new Map<string, { seenAtMs: number; coordKey: string }>());
  const sessionsRef = useRef<SerialSession[]>([]);
  const roleByPathRef = useRef<Record<string, DeviceRole>>({});
  const baudByPathRef = useRef<Record<string, number>>({});
  const meshPathRef = useRef("");
  const gpsPathRef = useRef("");
  const donglePathRef = useRef("");
  const esp32PathRef = useRef("");
  const flasherPathRef = useRef("");
  const esp32AutoConnected = useRef(new Set<string>());
  const esp32AutoScanBusy = useRef(false);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];
  const connectedPaths = new Set(sessions.map((session) => session.path));
  const meshPorts = ports.filter((port) => isMeshRole(port.suggestedRole) || isMeshRole(roleByPath[port.path]));
  const donglePorts = ports.filter((port) => isDongleCandidate(port, roleByPath[port.path] ?? port.suggestedRole));
  const esp32Ports = ports.filter((port) => isEsp32Candidate(port, roleByPath[port.path] ?? port.suggestedRole));
  const esp32Session = sessions.find((session) => session.path === esp32Path) ?? sessions.find((session) => session.role === "esp32");
  const flasherPorts = ports.filter((port) => isFlasherCandidate(port, roleByPath[port.path] ?? port.suggestedRole));
  const flasherSession = sessions.find((session) => session.path === flasherPath);
  const gpsPorts = ports.filter((port) => isGpsCandidate(port, roleByPath[port.path] ?? port.suggestedRole));
  const gpsFixAgeMs = gpsLastFixAt === null ? null : Math.max(0, gpsNow - gpsLastFixAt);
  const gpsCanPush = Boolean(gpsFix && hasGpsCoordinates(gpsFix) && gpsFixAgeMs !== null && gpsFixAgeMs <= gpsCacheTtlMs);
  const gpsStatus = formatGpsStatus(gpsFix, gpsFixAgeMs);
  const latestWarDriveRecord = warDriveRecords[warDriveRecords.length - 1];
  const warDriveIntervalSeconds = Math.min(Math.max(Number(warDriveInterval) || 20, 10), 300);
  const knownPortCount = ports.filter((port) => port.isKnownBoard).length;
  const logStats = useMemo(
    () => ({
      all: logs.length,
      rx: logs.filter((entry) => entry.channel === "rx").length,
      tx: logs.filter((entry) => entry.channel === "tx").length,
      status: logs.filter((entry) => entry.channel === "status").length
    }),
    [logs]
  );
  const visibleLogs = useMemo(
    () => (logFilter === "all" ? logs : logs.filter((entry) => entry.channel === logFilter)),
    [logFilter, logs]
  );
  const latestEvent = logs[logs.length - 1];
  const deckState = sessions.length > 0 ? "Online" : ports.length > 0 ? "Ready" : "Standby";
  const selectedRoleLabel = selectedSession ? roleLabels[selectedSession.role] : "No session";
  const selectedPathLabel = selectedSession?.path ?? "No port selected";
  const visibleMarketplacePacks = useMemo(
    () =>
      marketplaceFilter === "featured"
        ? marketplacePacks.filter((pack) => pack.featured)
        : marketplaceFilter === "all"
        ? marketplacePacks
        : marketplacePacks.filter((pack) => pack.category === marketplaceFilter || pack.extraTabs?.includes(marketplaceFilter)),
    [marketplaceFilter]
  );
  const marketplaceTabCounts = useMemo(
    () =>
      Object.fromEntries(
        marketplaceFilters.map((filter) => [
          filter.value,
          filter.value === "featured"
            ? marketplacePacks.filter((pack) => pack.featured).length
            : filter.value === "all"
              ? marketplacePacks.length
              : marketplacePacks.filter((pack) => pack.category === filter.value || pack.extraTabs?.includes(filter.value)).length
        ])
      ) as Record<MarketplaceFilter, number>,
    []
  );

  const groupedPorts = useMemo(() => {
    const known = ports.filter((port) => port.isKnownBoard);
    const other = ports.filter((port) => !port.isKnownBoard);
    return [...known, ...other];
  }, [ports]);

  const addLog = (entry: Omit<LogEntry, "id">) => {
    setLogs((current) => {
      const next = [...current, { ...entry, id: logCounter.current++ }];
      return next.slice(-700);
    });
  };

  const setPortPreset = (path: string, role: DeviceRole, baudRate = defaultBaud(role)) => {
    if (!path) return;
    setRoleByPath((current) => {
      const next = { ...current, [path]: role };
      roleByPathRef.current = next;
      return next;
    });
    setBaudByPath((current) => {
      const next = { ...current, [path]: current[path] ?? baudRate };
      baudByPathRef.current = next;
      return next;
    });
  };

  const applyScannedPorts = (nextPorts: DevicePort[], options: { log?: boolean } = {}) => {
    setPorts(nextPorts);
    const scannedPaths = new Set(nextPorts.map((port) => port.path));
    for (const path of esp32AutoConnected.current) {
      if (!scannedPaths.has(path)) esp32AutoConnected.current.delete(path);
    }
    setRoleByPath((current) => {
      const next = { ...current };
      for (const port of nextPorts) {
        next[port.path] ??= port.suggestedRole;
      }
      roleByPathRef.current = next;
      return next;
    });
    setBaudByPath((current) => {
      const next = { ...current };
      for (const port of nextPorts) {
        next[port.path] ??= defaultBaud(port.suggestedRole);
      }
      baudByPathRef.current = next;
      return next;
    });

    if (!meshPathRef.current) {
      const meshPort = nextPorts.find((port) => isMeshRole(port.suggestedRole));
      if (meshPort) {
        meshPathRef.current = meshPort.path;
        setMeshPath(meshPort.path);
      }
    }

    if (!gpsPathRef.current) {
      const gpsPort =
        nextPorts.find((port) => port.suggestedRole === "gps") ??
        nextPorts.find((port) => isGpsCandidate(port, port.suggestedRole));
      if (gpsPort) {
        gpsPathRef.current = gpsPort.path;
        setGpsPath(gpsPort.path);
        setGpsBaud(defaultBaud("gps"));
      }
    }

    if (!donglePathRef.current) {
      const donglePort =
        nextPorts.find((port) => port.suggestedRole === "tdongle") ??
        nextPorts.find((port) => isDongleCandidate(port, port.suggestedRole));
      if (donglePort) {
        donglePathRef.current = donglePort.path;
        setDonglePath(donglePort.path);
      }
    }

    if (!esp32PathRef.current) {
      const esp32Port =
        nextPorts.find((port) => port.suggestedRole === "esp32") ??
        nextPorts.find((port) => isEsp32Candidate(port, port.suggestedRole));
      if (esp32Port) {
        esp32PathRef.current = esp32Port.path;
        setEsp32Path(esp32Port.path);
      }
    }

    if (!flasherPathRef.current) {
      const flasherPort =
        nextPorts.find((port) => port.suggestedRole === "tdeck") ??
        nextPorts.find((port) => port.suggestedRole === "esp32") ??
        nextPorts.find((port) => port.suggestedRole === "tdongle") ??
        nextPorts.find((port) => isFlasherCandidate(port, port.suggestedRole));
      if (flasherPort) {
        flasherPathRef.current = flasherPort.path;
        setFlasherPath(flasherPort.path);
      }
    }

    if (options.log !== false) {
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: `Scanned ${nextPorts.length} serial port${nextPorts.length === 1 ? "" : "s"}.`
      });
    }
  };

  const refreshDevices = async () => {
    setIsRefreshing(true);
    try {
      const nextPorts = await api.listDevices();
      applyScannedPorts(nextPorts);
    } catch (error) {
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: error instanceof Error ? error.message : "Device scan failed."
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const connectPort = async (port: DevicePort, roleOverride?: DeviceRole) => {
    const role = roleOverride ?? roleByPath[port.path] ?? port.suggestedRole;
    const baudRate = baudByPath[port.path] ?? defaultBaud(role);
    if (roleOverride) {
      setRoleByPath((current) => {
        const next = { ...current, [port.path]: roleOverride };
        roleByPathRef.current = next;
        return next;
      });
      setBaudByPath((current) => {
        const next = { ...current, [port.path]: baudRate };
        baudByPathRef.current = next;
        return next;
      });
    }
    try {
      const session = await api.connectDevice({ path: port.path, baudRate, role });
      setSessions((current) => {
        const next = current.some((item) => item.id === session.id) ? current : [...current, session];
        sessionsRef.current = next;
        return next;
      });
      setSelectedSessionId(session.id);
      return session;
    } catch (error) {
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: port.path,
        role,
        text: error instanceof Error ? error.message : "Connection failed."
      });
      return undefined;
    }
  };

  const ensurePortSession = async (path: string, roleOverride?: DeviceRole) => {
    const existing = sessionsRef.current.find((session) => session.path === path);
    if (existing) return existing;
    const port = ports.find((item) => item.path === path);
    if (!port) return undefined;
    return connectPort(port, roleOverride ?? roleByPathRef.current[path] ?? port.suggestedRole);
  };

  const disconnectSession = async (sessionId: string) => {
    await api.disconnectDevice(sessionId);
    setSessions((current) => {
      const next = current.filter((session) => session.id !== sessionId);
      sessionsRef.current = next;
      return next;
    });
    if (selectedSessionId === sessionId) setSelectedSessionId("");
  };

  const writeSession = async (session: SerialSession | undefined, payload: string) => {
    if (!session || !payload) return;
    await api.writeDevice({ sessionId: session.id, data: payload });
    addLog({
      channel: "tx",
      at: new Date().toISOString(),
      path: session.path,
      role: session.role,
      text: payload
    });
  };

  const writeSelected = async (data?: string) => {
    const suffix = lineEnding === "crlf" ? "\r\n" : lineEnding === "lf" ? "\n" : "";
    const payload = data ?? `${serialInput}${suffix}`;
    if (!payload) return;
    await writeSession(selectedSession, payload);
    if (!data) setSerialInput("");
  };

  const copyLogs = async () => {
    const text = logs
      .map((entry) => `[${formatTime(entry.at)}] ${entry.channel.toUpperCase()} ${entry.path ?? "system"} ${entry.text}`)
      .join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: `Copied ${logs.length} log line${logs.length === 1 ? "" : "s"}.`
      });
    } catch (error) {
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: error instanceof Error ? error.message : "Copy logs failed."
      });
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const sendSelectedHelp = async () => {
    if (!selectedSession) return;
    const payload = selectedSession.role === "flipper" ? "help\r\n" : "help()\r\n";
    await writeSession(selectedSession, payload);
  };

  const sendSelectedStatus = async () => {
    if (!selectedSession) return;
    const payload =
      selectedSession.role === "flipper"
        ? "device_info\r\n"
        : selectedSession.role === "gps"
          ? "$PMTK605*31\r\n"
          : "import sys; print(sys.platform)\r\n";
    await writeSession(selectedSession, payload);
  };

  const runMeshCommand = async (action: () => Promise<CommandResult>) => {
    setMeshBusy(true);
    try {
      const result = await action();
      setMeshOutput(formatCommandResult(result));
      return result.ok;
    } catch (error) {
      setMeshOutput(error instanceof Error ? error.message : "Meshtastic command failed.");
      return false;
    } finally {
      setMeshBusy(false);
    }
  };

  const sendMeshMessage = async () => {
    const channelIndex = Number(meshChannel);
    await runMeshCommand(() =>
      api.meshSendText({
        path: meshPath,
        message: meshMessage,
        channelIndex: Number.isFinite(channelIndex) ? channelIndex : undefined
      })
    );
  };

  const appendWarDriveRecords = (records: WarDriveRecord[]) => {
    if (records.length === 0) return;
    setWarDriveRecords((current) => {
      const next = [...current, ...records].slice(-1500);
      warDriveRecordsRef.current = next;
      return next;
    });
  };

  const recordWarDriveNodes = async (reason = "poll") => {
    const targetPath = meshPathRef.current || meshPorts[0]?.path;
    if (!targetPath) {
      setWarDriveOutput("Select or plug in a Heltec V3 / Meshtastic serial port first.");
      return;
    }
    if (sessionsRef.current.some((session) => session.path === targetPath)) {
      setWarDriveOutput(`Disconnect the live serial session on ${targetPath} before War Drive polling. Meshtastic CLI needs exclusive port access.`);
      return;
    }
    if (warDriveBusyRef.current) return;

    if (targetPath !== meshPathRef.current) {
      setMeshPath(targetPath);
      meshPathRef.current = targetPath;
    }

    warDriveBusyRef.current = true;
    try {
      const result = await api.meshNodes({ path: targetPath });
      if (!result.ok) {
        setWarDriveOutput(formatCommandResult(result));
        addLog({
          channel: "status",
          at: new Date().toISOString(),
          path: targetPath,
          role: "heltec",
          text: "War Drive mesh node poll failed."
        });
        return;
      }

      const nodes = parseMeshNodeOutput(`${result.stdout}\n${result.stderr}`);
      const fix = gpsFixRef.current;
      const ageMs = gpsLastFixAtRef.current === null ? null : Math.max(0, Date.now() - gpsLastFixAtRef.current);
      const hasFreshCachedGps = Boolean(fix && hasGpsCoordinates(fix) && ageMs !== null && ageMs <= gpsCacheTtlMs);
      const coordKey = hasFreshCachedGps && fix ? `${fix.lat?.toFixed(4)},${fix.lon?.toFixed(4)}` : "no-gps";
      const status = formatGpsStatus(fix, ageMs);
      const seenAtMs = Date.now();
      const seenAt = new Date(seenAtMs).toISOString();
      const newRecords: WarDriveRecord[] = [];

      for (const node of nodes) {
        const lastSeen = warDriveSeenRef.current.get(node.nodeId);
        if (lastSeen && lastSeen.coordKey === coordKey && seenAtMs - lastSeen.seenAtMs < warDriveRepeatMs) continue;
        warDriveSeenRef.current.set(node.nodeId, { seenAtMs, coordKey });
        newRecords.push({
          id: `${seenAtMs}-${simpleHash(`${node.nodeId}:${coordKey}:${node.raw}`)}`,
          seenAt,
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          meshPath: targetPath,
          raw: node.raw,
          gpsPath: fix?.path ?? gpsPathRef.current,
          lat: hasFreshCachedGps ? fix?.lat : undefined,
          lon: hasFreshCachedGps ? fix?.lon : undefined,
          altitudeMeters: hasFreshCachedGps ? fix?.altitudeMeters : undefined,
          satellites: hasFreshCachedGps ? fix?.satellites : undefined,
          gpsStatus: status,
          gpsFixAgeMs: ageMs ?? undefined,
          cliCommand: result.command
        });
      }

      appendWarDriveRecords(newRecords);
      const gpsLine = hasFreshCachedGps && fix ? `${fix.lat?.toFixed(6)}, ${fix.lon?.toFixed(6)} (${status})` : status;
      setWarDriveOutput(
        [
          `${reason === "manual" ? "Manual mark" : "War Drive poll"}: ${nodes.length} node${nodes.length === 1 ? "" : "s"} parsed from ${targetPath}.`,
          `${newRecords.length} new sighting${newRecords.length === 1 ? "" : "s"} recorded.`,
          `GPS: ${gpsLine}`,
          nodes.length === 0 ? "No Meshtastic node IDs were found in CLI output." : "",
          newRecords
            .slice(-6)
            .map((record) => `${formatTime(record.seenAt)} ${record.nodeId} ${record.nodeName ?? ""} ${record.lat ?? "no-lat"},${record.lon ?? "no-lon"}`)
            .join("\n")
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "War Drive poll failed.";
      setWarDriveOutput(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: targetPath,
        role: "heltec",
        text: message
      });
    } finally {
      warDriveBusyRef.current = false;
    }
  };

  const startWarDrive = () => {
    if (!meshPathRef.current && !meshPorts[0]?.path) {
      setWarDriveOutput("Plug in a Heltec V3 / Meshtastic serial port and scan before starting War Drive mode.");
      return;
    }
    setWarDriveActive(true);
    setWarDriveOutput(`War Drive armed. Polling every ${warDriveIntervalSeconds}s.`);
    void recordWarDriveNodes("manual");
  };

  const stopWarDrive = () => {
    setWarDriveActive(false);
    setWarDriveOutput(`War Drive stopped with ${warDriveRecordsRef.current.length} recorded sighting${warDriveRecordsRef.current.length === 1 ? "" : "s"}.`);
  };

  const saveWarDriveRecords = async () => {
    const records = warDriveRecordsRef.current;
    if (records.length === 0) {
      setWarDriveOutput("No War Drive records to save yet.");
      return;
    }
    setWarDriveSaving(true);
    try {
      const result = await api.saveWarDriveLog({ records });
      setWarDriveOutput([result.message, result.jsonlPath, result.csvPath].join("\n"));
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: meshPathRef.current || undefined,
        role: "heltec",
        text: result.message
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "War Drive save failed.";
      setWarDriveOutput(message);
    } finally {
      setWarDriveSaving(false);
    }
  };

  const copyWarDriveRecords = async () => {
    if (warDriveRecordsRef.current.length === 0) {
      setWarDriveOutput("No War Drive records to copy yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(warDriveCsv(warDriveRecordsRef.current));
      setWarDriveOutput(`Copied ${warDriveRecordsRef.current.length} War Drive record${warDriveRecordsRef.current.length === 1 ? "" : "s"} as CSV.`);
    } catch (error) {
      setWarDriveOutput(error instanceof Error ? error.message : "Copy War Drive CSV failed.");
    }
  };

  const clearWarDriveRecords = () => {
    warDriveSeenRef.current.clear();
    warDriveRecordsRef.current = [];
    setWarDriveRecords([]);
    setWarDriveOutput("War Drive records cleared.");
  };

  const probeGps = async () => {
    if (!gpsPath) return;
    setGpsProbeBusy(true);
    try {
      const result = await api.probeGps({ path: gpsPath, baudRates: [gpsBaud], timeoutMs: 3200 });
      setGpsProbeOutput(formatCommandResult(result));
      if (result.ok) {
        setRoleByPath((current) => ({ ...current, [gpsPath]: "gps" }));
        setBaudByPath((current) => ({ ...current, [gpsPath]: gpsBaud }));
      }
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: gpsPath,
        role: "gps",
        text: result.ok ? "GPS NMEA probe found data." : "GPS NMEA probe did not find data."
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GPS probe failed.";
      setGpsProbeOutput(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: gpsPath,
        role: "gps",
        text: message
      });
    } finally {
      setGpsProbeBusy(false);
    }
  };

  const connectGps = async () => {
    const port = ports.find((item) => item.path === gpsPath);
    if (!port) return;
    setRoleByPath((current) => ({ ...current, [port.path]: "gps" }));
    setBaudByPath((current) => ({ ...current, [port.path]: gpsBaud }));
    try {
      const session = await api.connectDevice({ path: port.path, baudRate: gpsBaud, role: "gps" });
      setSessions((current) => {
        const next = current.some((item) => item.id === session.id) ? current : [...current, session];
        sessionsRef.current = next;
        return next;
      });
      setSelectedSessionId(session.id);
    } catch (error) {
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: port.path,
        role: "gps",
        text: error instanceof Error ? error.message : "GPS connection failed."
      });
    }
  };

  const pushGpsFix = async (fix: GpsFix | null = gpsFix) => {
    if (!fix || !hasGpsCoordinates(fix) || !donglePath) return;
    const text = formatGpsPush(fix);
    setGpsPushBusy(true);
    try {
      const textResult = await api.dongleCommand({ path: donglePath, command: { cmd: "text", text }, timeoutMs: 1800 });
      const noteResult = await api.dongleCommand({
        path: donglePath,
        command: { cmd: "sd", action: "note.append", path: "/zdeck/notes/gps.log", payload: text },
        timeoutMs: 1800
      });
      setDongleOutput([formatCommandResult(textResult), formatCommandResult(noteResult)].join("\n\n"));
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: donglePath,
        role: "tdongle",
        text: `GPS fix pushed to T-Dongle bridge: ${text}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GPS push failed.";
      setDongleOutput(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: donglePath,
        role: "tdongle",
        text: message
      });
    } finally {
      setGpsPushBusy(false);
    }
  };

  const sendDongleCommandRaw = async (
    command: DongleCommandPayload,
    timeoutMs = 3400,
    pathOverride = donglePathRef.current || donglePath
  ) => {
    const commandPath = pathOverride || donglePathRef.current || donglePath;
    if (!commandPath) throw new Error("Select a T-Dongle serial port first.");
    return api.dongleCommand({ path: commandPath, command, timeoutMs });
  };

  const applyDongleDiscovery = (result: CommandResult) => {
    const data = parseCommandJson(result.stdout);
    const ip = readTextField(data, "ip");
    const apSsid = readTextField(data, "apSsid");
    const pairCode = readTextField(data, "pairCode");
    const bridgeUrl = readTextField(data, "bridgeUrl");
    if (ip) setDongleGuiUrl(normalizeUrl(ip));
    if (bridgeUrl) setDongleGuiUrl(normalizeUrl(bridgeUrl));
    if (apSsid) setDongleGuiSsid(apSsid);
    if (pairCode) setDonglePairCode(pairCode);
    return data;
  };

  const executeDongleCommand = async (
    command: DongleCommandPayload,
    timeoutMs = 3400,
    pathOverride = donglePathRef.current || donglePath
  ) => {
    setDongleBusy(true);
    try {
      const commandPath = pathOverride || donglePathRef.current || donglePath;
      const result = await sendDongleCommandRaw(command, timeoutMs, commandPath);
      applyDongleDiscovery(result);
      setDongleOutput(formatCommandResult(result));
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: commandPath,
        role: "tdongle",
        text: result.ok ? `T-Dongle command ${command.cmd} completed.` : `T-Dongle command ${command.cmd} failed.`
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "T-Dongle command failed.";
      setDongleOutput(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: pathOverride || donglePathRef.current || donglePath || undefined,
        role: "tdongle",
        text: message
      });
      return undefined;
    } finally {
      setDongleBusy(false);
    }
  };

  const runDongleCommand = async (
    command: DongleCommandPayload,
    timeoutMs = 3400,
    pathOverride = donglePathRef.current || donglePath
  ) => Boolean((await executeDongleCommand(command, timeoutMs, pathOverride))?.ok);

  const sendDongleText = async () => {
    if (!dongleText.trim()) return;
    await runDongleCommand({ cmd: "text", text: dongleText.trim() });
  };

  const sendDonglePayload = async () => {
    if (!donglePayloadId.trim()) return;
    await runDongleCommand({ cmd: "payload", id: donglePayloadId.trim() });
  };

  const openDongleGui = async () => {
    const url = normalizeUrl(dongleGuiUrl);
    setDongleGuiUrl(url);
    await api.openExternal(url);
    setDongleOutput(`Opened T-Dongle GUI at ${url}\nJoin Wi-Fi AP ${dongleGuiSsid || defaultDongleSsid} if the page does not load.`);
  };

  const probeDongleGui = async () => {
    await executeDongleCommand({ cmd: "attachProbe", deckId: dongleDeckId, deckName: dongleDeckName }, 2400);
  };

  const dongleProfilePayload = () =>
    JSON.stringify({
      name: dongleDeckName,
      deckId: dongleDeckId,
      bridgeUrl: normalizeUrl(dongleGuiUrl),
      mode: "field"
    });

  const runDongleRemoteWizard = async (
    label: string,
    commands: Array<{ command: DongleCommandPayload; timeoutMs?: number }>
  ) => {
    const commandPath = donglePathRef.current || donglePath;
    if (!commandPath) {
      setDongleOutput("Select a T-Dongle serial port first.");
      return false;
    }

    setDongleBusy(true);
    const results: CommandResult[] = [];
    let latestPairCode = donglePairCode;
    let latestGuiUrl = normalizeUrl(dongleGuiUrl);
    let latestSsid = dongleGuiSsid || defaultDongleSsid;
    try {
      for (const step of commands) {
        const result = await sendDongleCommandRaw(step.command, step.timeoutMs ?? 3200, commandPath);
        const data = applyDongleDiscovery(result);
        const ip = readTextField(data, "ip");
        const bridgeUrl = readTextField(data, "bridgeUrl");
        const apSsid = readTextField(data, "apSsid");
        const pairCode = readTextField(data, "pairCode");
        if (ip) latestGuiUrl = normalizeUrl(ip);
        if (bridgeUrl) latestGuiUrl = normalizeUrl(bridgeUrl);
        if (apSsid) latestSsid = apSsid;
        if (pairCode) latestPairCode = pairCode;
        results.push(result);
        addLog({
          channel: "status",
          at: new Date().toISOString(),
          path: commandPath,
          role: "tdongle",
          text: `${label}: ${step.command.cmd} ${result.ok ? "completed" : "failed"}.`
        });
      }

      const failed = results.filter((result) => !result.ok).length;
      const pairCodeLine = latestPairCode ? `Pair code: ${latestPairCode}` : "Pair code will appear here if the dongle returns one.";
      setDongleOutput(
        [
          `${label} ${failed ? `completed with ${failed} failed step${failed === 1 ? "" : "s"}` : "complete"}.`,
          `GUI: ${latestGuiUrl}`,
          `AP: ${latestSsid}`,
          pairCodeLine,
          ...results.map(formatCommandResult)
        ].join("\n\n")
      );
      return failed === 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed.`;
      setDongleOutput([message, ...results.map(formatCommandResult)].join("\n\n"));
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: commandPath,
        role: "tdongle",
        text: message
      });
      return false;
    } finally {
      setDongleBusy(false);
    }
  };

  const startDongleRemoteLink = async () => {
    const bridgeUrl = normalizeUrl(dongleGuiUrl);
    setDongleGuiUrl(bridgeUrl);
    await runDongleRemoteWizard("T-Dongle remote link start", [
      { command: { cmd: "attachProbe", deckId: dongleDeckId, deckName: dongleDeckName }, timeoutMs: 2400 },
      { command: { cmd: "writeConfig", key: "bridgeUrl", value: bridgeUrl }, timeoutMs: 2200 },
      {
        command: {
          cmd: "saveProfile",
          deckId: dongleDeckId,
          deckName: dongleDeckName,
          profile: dongleProfilePayload(),
          profileHash: "tdeck-profile-v1"
        },
        timeoutMs: 2600
      },
      { command: { cmd: "payload", id: "remote.dongle-auto-pair" }, timeoutMs: 3200 },
      { command: { cmd: "pairBegin", deckId: dongleDeckId, deckName: dongleDeckName }, timeoutMs: 3000 }
    ]);
  };

  const finishDongleRemoteLink = async () => {
    if (!donglePairCode.trim()) {
      setDongleOutput("Start the remote link first or enter the T-Deck pair code before finishing.");
      return;
    }
    await runDongleRemoteWizard("T-Dongle remote link finish", [
      {
        command: {
          cmd: "pairConfirm",
          deckId: dongleDeckId,
          deckName: dongleDeckName,
          code: donglePairCode.trim()
        },
        timeoutMs: 3200
      },
      { command: { cmd: "payload", id: "remote.deck-ready" }, timeoutMs: 2600 },
      { command: { cmd: "control", action: "launcher" }, timeoutMs: 1800 },
      { command: { cmd: "control", action: "refresh" }, timeoutMs: 1800 }
    ]);
  };

  const connectEsp32 = async (pathOverride?: string) => {
    const targetPath = pathOverride ?? esp32PathRef.current ?? esp32Path;
    const port = ports.find((item) => item.path === targetPath) ?? esp32Ports[0];
    if (!port) return undefined;
    setEsp32Busy(true);
    try {
      const session = await connectPort(port, "esp32");
      if (session) {
        setEsp32Path(port.path);
        esp32PathRef.current = port.path;
        setEsp32Output(`Connected ESP32 module on ${port.path} at ${session.baudRate}.`);
      }
      return session;
    } finally {
      setEsp32Busy(false);
    }
  };

  const ensureEsp32Session = async () => {
    const existing =
      sessionsRef.current.find((session) => session.path === esp32PathRef.current) ??
      sessionsRef.current.find((session) => session.role === "esp32");
    if (existing) return existing;
    return connectEsp32(esp32PathRef.current);
  };

  const runEsp32Action = async (label: string, action: (session: SerialSession) => Promise<void>) => {
    setEsp32Busy(true);
    try {
      const session = await ensureEsp32Session();
      if (!session) throw new Error("Select or connect an ESP32 serial module first.");
      await action(session);
      setEsp32Output(`${label} completed on ${session.path}.`);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: session.path,
        role: session.role,
        text: `${label} completed.`
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed.`;
      setEsp32Output(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: esp32Path || undefined,
        role: "esp32",
        text: message
      });
      return false;
    } finally {
      setEsp32Busy(false);
    }
  };

  const sendEsp32Quick = async (label: string, data: string) => {
    await runEsp32Action(label, (session) => writeSession(session, data));
  };

  const formatEsp32RemotePayload = (replCode: string, jsonCommand: DongleCommandPayload, mode = esp32RemoteMode) =>
    mode === "json"
      ? `${JSON.stringify({ protocol: esp32RemoteProtocol, ...jsonCommand })}\n`
      : `${replCode.trimEnd()}\r\n`;

  const sendEsp32RemotePayload = async (
    label: string,
    replCode: string,
    jsonCommand: DongleCommandPayload,
    mode: Esp32RemoteMode = esp32RemoteMode
  ) => {
    return runEsp32Action(`ESP32 remote ${label}`, async (session) => {
      const payload = formatEsp32RemotePayload(replCode, jsonCommand, mode);
      await writeSession(session, payload);
      setEsp32RemoteOutput(`Sent ${label} to ${session.path} (${esp32RemoteModeLabels[mode]})\n${payload.trim()}`);
    });
  };

  const linkEsp32RemoteHost = async () =>
    sendEsp32RemotePayload(
      "host link",
      `print('${esp32RemoteProtocol}:linked')`,
      {
        cmd: "remoteLink",
        hostId: "nightgrid-computer",
        hostName: "NightGrid Cyberdeck"
      }
    );

  const identifyEsp32Remote = async () =>
    sendEsp32RemotePayload(
      "identify",
      "import sys, gc\nprint('nightgrid:identify sys=%s mem=%s' % (sys.platform, gc.mem_free()))",
      { cmd: "remoteControl", action: "identify" }
    );

  const heartbeatEsp32Remote = async () =>
    sendEsp32RemotePayload("heartbeat", "print('nightgrid:heartbeat')", { cmd: "remoteControl", action: "heartbeat" });

  const scanEsp32Wifi = async () =>
    sendEsp32RemotePayload(
      "Wi-Fi scan",
      "import network\nw=network.WLAN(network.STA_IF)\nw.active(True)\nprint(w.scan())",
      { cmd: "remoteControl", action: "wifi.scan" }
    );

  const scanEsp32I2c = async () =>
    sendEsp32RemotePayload(
      "I2C scan",
      "from machine import Pin, I2C\ni=I2C(0, scl=Pin(22), sda=Pin(21))\nprint(i.scan())",
      { cmd: "remoteControl", action: "i2c.scan", scl: 22, sda: 21 }
    );

  const writeEsp32Gpio = async () => {
    const pin = Number(esp32RemotePin);
    if (!Number.isInteger(pin) || pin < 0 || pin > 48) {
      setEsp32RemoteOutput("GPIO pin must be an integer from 0 to 48.");
      return;
    }
    const value = esp32RemoteValue === "0" ? 0 : 1;
    await sendEsp32RemotePayload(
      `GPIO ${pin}=${value}`,
      `from machine import Pin\nPin(${pin}, Pin.OUT).value(${value})\nprint('nightgrid:gpio ${pin}=${value}')`,
      { cmd: "remoteControl", action: "gpio.write", pin, value }
    );
  };

  const runEsp32RemoteCommand = async () => {
    const command = esp32RemoteCommand.trim();
    if (!command) return;
    await sendEsp32RemotePayload("custom command", command, { cmd: "remoteCommand", code: command });
  };

  const findMarketplacePort = (pack: MarketplacePack) => {
    const role = pack.targetRole;
    const preferredPath =
      role === "esp32"
        ? esp32PathRef.current || esp32Path
        : role === "tdongle"
          ? donglePathRef.current || donglePath
          : role && isMeshRole(role)
            ? meshPathRef.current || meshPath
            : "";
    if (preferredPath && ports.some((port) => port.path === preferredPath)) return preferredPath;

    const candidate =
      role === "esp32"
        ? esp32Ports[0] ?? ports.find((port) => isEsp32Candidate(port, roleByPathRef.current[port.path] ?? port.suggestedRole))
        : role === "tdongle"
          ? donglePorts[0] ?? ports.find((port) => isDongleCandidate(port, roleByPathRef.current[port.path] ?? port.suggestedRole))
          : role && isMeshRole(role)
            ? meshPorts[0] ?? ports.find((port) => isMeshRole(roleByPathRef.current[port.path] ?? port.suggestedRole))
            : undefined;
    return candidate?.path ?? preferredPath;
  };

  const selectMarketplacePort = (pack: MarketplacePack) => {
    const path = findMarketplacePort(pack);
    if (path && pack.targetRole) setPortPreset(path, pack.targetRole);

    if (path && pack.targetRole === "esp32") {
      setEsp32Path(path);
      esp32PathRef.current = path;
    }
    if (path && pack.targetRole === "tdongle") {
      setDonglePath(path);
      donglePathRef.current = path;
    }
    if (path && pack.targetRole && isMeshRole(pack.targetRole)) {
      setMeshPath(path);
      meshPathRef.current = path;
    }
    if (pack.flasherTarget) {
      setFlasherTarget(pack.flasherTarget);
      if (path) {
        setFlasherPath(path);
        flasherPathRef.current = path;
      }
    }
    const setupRemoteMode = pack.setup.kind === "esp32-remote" ? pack.setup.mode : undefined;
    if (pack.remoteMode || setupRemoteMode) {
      setEsp32RemoteMode(pack.remoteMode ?? setupRemoteMode ?? esp32RemoteMode);
    }
    if (pack.remotePin) setEsp32RemotePin(pack.remotePin);
    if (pack.remoteValue) setEsp32RemoteValue(pack.remoteValue);
    if (pack.remoteCommand) {
      setEsp32RemoteCommand(pack.remoteCommand);
    } else if (pack.setup.kind === "esp32-remote") {
      setEsp32RemoteCommand(pack.setup.replCode);
    }

    return path;
  };

  const applyMarketplacePack = (pack: MarketplacePack) => {
    const path = selectMarketplacePort(pack);
    const lines = [
      `Loaded ${pack.title}.`,
      `Source: ${pack.sourceName}`,
      path ? `Auto selected ${path}${pack.targetRole ? ` as ${roleLabels[pack.targetRole]}` : ""}.` : "No matching port is selected yet. Plug the device in and scan.",
      pack.flasherTarget ? `Flasher target: ${flasherTargetLabels[pack.flasherTarget]}.` : "",
      pack.setup.kind === "esp32-remote"
        ? `Remote mode: ${esp32RemoteModeLabels[pack.remoteMode ?? pack.setup.mode]}.`
        : pack.setup.kind === "dongle"
          ? "Run setup sends the T-Dongle preset command."
          : pack.setup.kind === "mesh-info"
            ? "Run setup requests Mesh info for the selected T-Deck or Heltec mesh port."
            : "Run setup opens the official web installer."
    ].filter(Boolean);
    setMarketplaceOutput(lines.join("\n"));
    addLog({
      channel: "status",
      at: new Date().toISOString(),
      path: path || undefined,
      role: pack.targetRole,
      text: `Marketplace loaded ${pack.title}.`
    });
  };

  const openMarketplaceSource = async (pack: MarketplacePack) => {
    setMarketplaceBusy(`${pack.id}:source`);
    try {
      const url = pack.sourceUrl;
      await api.openExternal(url);
      setMarketplaceOutput(
        [`Opened source for ${pack.title}.`, url, pack.installUrl ? `Installer: ${pack.installUrl}` : ""].filter(Boolean).join("\n")
      );
    } catch (error) {
      setMarketplaceOutput(error instanceof Error ? error.message : `Could not open ${pack.title}.`);
    } finally {
      setMarketplaceBusy("");
    }
  };

  const grabMarketplacePack = async (pack: MarketplacePack) => {
    setMarketplaceBusy(`${pack.id}:grab`);
    try {
      const url = pack.installUrl ?? pack.sourceUrl;
      await api.openExternal(url);
      setMarketplaceOutput(
        [
          `Opened grab path for ${pack.title}.`,
          url,
          pack.installUrl ? `Source: ${pack.sourceUrl}` : "No separate installer is published for this pack."
        ].join("\n")
      );
    } catch (error) {
      setMarketplaceOutput(error instanceof Error ? error.message : `Could not grab ${pack.title}.`);
    } finally {
      setMarketplaceBusy("");
    }
  };

  const runMarketplacePack = async (pack: MarketplacePack) => {
    setMarketplaceBusy(`${pack.id}:run`);
    try {
      const path = selectMarketplacePort(pack);
      const setup = pack.setup;
      setMarketplaceOutput(`Running ${pack.title} setup...`);

      if (setup.kind === "esp32-remote") {
        const targetPath = path || esp32PathRef.current || sessionsRef.current.find((session) => session.role === "esp32")?.path;
        if (!targetPath) throw new Error("Plug in or select an ESP32 serial module first.");
        const ok = await sendEsp32RemotePayload(setup.label, setup.replCode, setup.jsonCommand, setup.mode);
        setMarketplaceOutput(
          ok ? `Sent ${setup.label} for ${pack.title} to ${targetPath}.` : `${pack.title} could not send. Check the ESP32 output panel.`
        );
      } else if (setup.kind === "dongle") {
        const targetPath = path || donglePathRef.current;
        if (!targetPath) throw new Error("Plug in or select a T-Dongle serial port first.");
        const ok = await runDongleCommand(setup.command, 3400, targetPath);
        setMarketplaceOutput(
          ok
            ? `Sent T-Dongle ${setup.command.cmd} preset for ${pack.title} to ${targetPath}.`
            : `${pack.title} command failed or returned a nonzero status. Check the T-Dongle bridge output.`
        );
      } else if (setup.kind === "mesh-info") {
        const targetPath = path || meshPathRef.current;
        if (!targetPath) throw new Error("Plug in or select a T-Deck or Heltec mesh serial port first.");
        const ok = await runMeshCommand(() => api.meshInfo({ path: targetPath }));
        setMarketplaceOutput(
          ok ? `Requested Mesh info for ${pack.title} on ${targetPath}.` : `${pack.title} Mesh info failed. Check the Mesh CLI output.`
        );
      } else {
        await api.openExternal(setup.url);
        setMarketplaceOutput(`Opened installer for ${pack.title}.\n${setup.url}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${pack.title} setup failed.`;
      setMarketplaceOutput(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        role: pack.targetRole,
        text: `Marketplace: ${message}`
      });
    } finally {
      setMarketplaceBusy("");
    }
  };

  const runFlasherAction = async (label: string, action: () => Promise<string | void>) => {
    setFlasherBusy(true);
    try {
      const message = await action();
      setFlasherOutput(message ?? `${label} complete.`);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: flasherPath || undefined,
        text: `Flasher: ${label} complete.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed.`;
      setFlasherOutput(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: flasherPath || undefined,
        text: `Flasher: ${message}`
      });
    } finally {
      setFlasherBusy(false);
    }
  };

  const connectFlasherTarget = async () => {
    if (!flasherPath) throw new Error("Select a flasher serial port first.");
    const roleOverride: DeviceRole =
      flasherTarget === "tdongle" ? "tdongle" : flasherTarget === "tdeck" ? "tdeck" : "esp32";
    const session = await ensurePortSession(flasherPath, roleOverride);
    if (!session) throw new Error("Could not open the selected flasher serial port.");
    setFlasherPath(session.path);
    flasherPathRef.current = session.path;
    return session;
  };

  const connectFlasher = () =>
    runFlasherAction("Connect flasher", async () => {
      const session = await connectFlasherTarget();
      return `${flasherTargetLabels[flasherTarget]} connected on ${session.path} at ${session.baudRate}.`;
    });

  const openWebFlasher = () =>
    runFlasherAction("Open web flasher", async () => {
      await api.openExternal(zDeckFlasherUrl);
      return `Opened ${zDeckFlasherUrl}`;
    });

  const openFirmwareRelease = () =>
    runFlasherAction("Open latest firmware", async () => {
      await api.openExternal(zDeckReleaseUrl);
      return `Opened ${zDeckReleaseUrl}`;
    });

  const resetFlasherTarget = () =>
    runFlasherAction(`${flasherTargetLabels[flasherTarget]} reset`, async () => {
      const session = await connectFlasherTarget();
      await api.esp32Reset({ sessionId: session.id });
      return `${flasherTargetLabels[flasherTarget]} reset signal sent to ${session.path}.`;
    });

  const bootloaderFlasherTarget = () =>
    runFlasherAction(`${flasherTargetLabels[flasherTarget]} bootloader`, async () => {
      const session = await connectFlasherTarget();
      await api.esp32Bootloader({ sessionId: session.id });
      return `${flasherTargetLabels[flasherTarget]} bootloader signal sent to ${session.path}.`;
    });

  const sendEsp32LinkCommand = async (label: string, command: DongleCommandPayload) => {
    await runEsp32Action(`T-Deck link ${label}`, async (session) => {
      const payload = `${JSON.stringify(command)}\n`;
      await writeSession(session, payload);
      setEsp32LinkOutput(`Sent ${label} to ${session.path}\n${payload.trim()}`);
    });
  };

  const sendEsp32LinkText = async () => {
    const text = esp32LinkText.trim();
    if (!text) return;
    await sendEsp32LinkCommand("text", { cmd: "text", text });
  };

  const runDeckMacro = async (label: string, action: () => Promise<void>) => {
    setMacroBusy(label);
    try {
      await action();
      setMacroOutput(`${label} complete.`);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: `Command Deck: ${label} complete.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed.`;
      setMacroOutput(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: `Command Deck: ${message}`
      });
    } finally {
      setMacroBusy("");
    }
  };

  const installUpdate = async () => {
    setUpdateBusy(true);
    setUpdateMessage("");
    try {
      const result = await api.installUpdate();
      setUpdateMessage(result.message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: result.message
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update failed.";
      setUpdateMessage(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: message
      });
    } finally {
      setUpdateBusy(false);
    }
  };

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    roleByPathRef.current = roleByPath;
  }, [roleByPath]);

  useEffect(() => {
    baudByPathRef.current = baudByPath;
  }, [baudByPath]);

  useEffect(() => {
    gpsFixRef.current = gpsFix;
  }, [gpsFix]);

  useEffect(() => {
    gpsLastFixAtRef.current = gpsLastFixAt;
  }, [gpsLastFixAt]);

  useEffect(() => {
    warDriveRecordsRef.current = warDriveRecords;
  }, [warDriveRecords]);

  useEffect(() => {
    meshPathRef.current = meshPath;
  }, [meshPath]);

  useEffect(() => {
    gpsPathRef.current = gpsPath;
  }, [gpsPath]);

  useEffect(() => {
    donglePathRef.current = donglePath;
  }, [donglePath]);

  useEffect(() => {
    esp32PathRef.current = esp32Path;
  }, [esp32Path]);

  useEffect(() => {
    flasherPathRef.current = flasherPath;
  }, [flasherPath]);

  useEffect(() => {
    refreshDevices();
    api.getPlatform().then(setPlatform).catch(() => undefined);

    const offData = api.onSerialData((event: SerialEvent) => {
      addLog({
        channel: "rx",
        at: event.at,
        path: event.path,
        role: event.role,
        text: event.text
      });
    });

    const offStatus = api.onSerialStatus((event: SerialStatusEvent) => {
      addLog({
        channel: "status",
        at: event.at,
        path: event.path,
        text: event.message
      });
      if (event.status === "disconnected" && event.sessionId) {
        setSessions((current) => {
          const next = current.filter((session) => session.id !== event.sessionId);
          sessionsRef.current = next;
          return next;
        });
      }
    });

    const offGps = api.onGpsFix((event: GpsFix) => {
      const receivedAt = Date.now();
      setGpsFix((current) => mergeGpsFix(current?.path === event.path ? current : null, event));
      if (hasLiveGpsCoordinates(event)) {
        setGpsLastFixAt(receivedAt);
        setGpsNow(receivedAt);
      }
    });

    return () => {
      offData();
      offStatus();
      offGps();
    };
  }, [api]);

  useEffect(() => {
    if (!esp32AutoConnect) return;
    let cancelled = false;

    const scanAndConnect = async () => {
      if (esp32AutoScanBusy.current) return;
      let targetPath: string | undefined;
      esp32AutoScanBusy.current = true;
      try {
        const nextPorts = await api.listDevices();
        if (cancelled) return;
        applyScannedPorts(nextPorts, { log: false });

        const candidate = nextPorts.find((port) => {
          const role = roleByPathRef.current[port.path] ?? port.suggestedRole;
          return (
            role === "esp32" &&
            isEsp32Candidate(port, role) &&
            !sessionsRef.current.some((session) => session.path === port.path) &&
            !esp32AutoConnected.current.has(port.path)
          );
        });
        if (!candidate) return;

        targetPath = candidate.path;
        const baudRate = baudByPathRef.current[candidate.path] ?? defaultBaud("esp32");
        esp32AutoConnected.current.add(candidate.path);
        setEsp32Path(candidate.path);
        esp32PathRef.current = candidate.path;
        setRoleByPath((current) => {
          const next = { ...current, [candidate.path]: "esp32" as DeviceRole };
          roleByPathRef.current = next;
          return next;
        });
        setBaudByPath((current) => {
          const next = { ...current, [candidate.path]: baudRate };
          baudByPathRef.current = next;
          return next;
        });

        const session = await api.connectDevice({ path: candidate.path, baudRate, role: "esp32" });
        if (cancelled) return;
        setSessions((current) => {
          const next = current.some((item) => item.id === session.id) ? current : [...current, session];
          sessionsRef.current = next;
          return next;
        });
        setSelectedSessionId(session.id);
        setEsp32Output(`Auto connected ESP32 module on ${candidate.path} at ${baudRate}.`);
        addLog({
          channel: "status",
          at: new Date().toISOString(),
          path: candidate.path,
          role: "esp32",
          text: `Auto connected ESP32 module at ${baudRate} baud.`
        });
      } catch (error) {
        if (!targetPath) return;
        const message = error instanceof Error ? error.message : "ESP32 auto connect failed.";
        addLog({
          channel: "status",
          at: new Date().toISOString(),
          path: targetPath,
          role: "esp32",
          text: message
        });
      } finally {
        esp32AutoScanBusy.current = false;
      }
    };

    void scanAndConnect();
    const timer = window.setInterval(scanAndConnect, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, esp32AutoConnect]);

  useEffect(() => {
    const timer = window.setInterval(() => setGpsNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logFilter, visibleLogs.length]);

  useEffect(() => {
    if (!gpsAutoPush || !gpsFix || !gpsCanPush || !donglePath || gpsPushBusy || gpsLastFixAt === null) return;
    if (lastGpsPushedFixAt.current === gpsLastFixAt) return;
    const elapsed = Date.now() - lastGpsPushAt.current;
    if (elapsed < 15000) return;
    lastGpsPushAt.current = Date.now();
    lastGpsPushedFixAt.current = gpsLastFixAt;
    void pushGpsFix(gpsFix);
  }, [gpsAutoPush, gpsFix, gpsCanPush, gpsLastFixAt, donglePath, gpsPushBusy]);

  useEffect(() => {
    if (!warDriveActive) return;
    const timer = window.setInterval(() => {
      void recordWarDriveNodes("poll");
    }, warDriveIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [warDriveActive, warDriveIntervalSeconds]);

  const macroButtons = [
    {
      label: "Selected help",
      icon: Terminal,
      disabled: !selectedSession,
      action: () => runDeckMacro("Selected help", sendSelectedHelp)
    },
    {
      label: "Selected status",
      icon: Gauge,
      disabled: !selectedSession,
      action: () => runDeckMacro("Selected status", sendSelectedStatus)
    },
    {
      label: "Mesh nodes",
      icon: Radio,
      disabled: meshBusy || !meshPath,
      action: () =>
        runDeckMacro("Mesh nodes", async () => {
          await runMeshCommand(() => api.meshNodes({ path: meshPath }));
        })
    },
    {
      label: "War mark",
      icon: Crosshair,
      disabled: !meshPath || warDriveBusyRef.current,
      action: () =>
        runDeckMacro("War mark", async () => {
          await recordWarDriveNodes("manual");
        })
    },
    {
      label: "GPS push",
      icon: MapPin,
      disabled: !gpsCanPush || !donglePath || gpsPushBusy,
      action: () => runDeckMacro("GPS push", () => pushGpsFix())
    },
    {
      label: "Dongle status",
      icon: Activity,
      disabled: dongleBusy || !donglePath,
      action: () =>
        runDeckMacro("Dongle status", async () => {
          await runDongleCommand({ cmd: "status" });
        })
    },
    {
      label: "Dongle GUI",
      icon: ExternalLink,
      disabled: false,
      action: () => runDeckMacro("Dongle GUI", openDongleGui)
    },
    {
      label: "Deck ready",
      icon: Power,
      disabled: dongleBusy || !donglePath,
      action: () =>
        runDeckMacro("Deck ready", async () => {
          await runDongleCommand({ cmd: "payload", id: "remote.deck-ready" });
        })
    },
    {
      label: "ESP32 ping",
      icon: Zap,
      disabled: !esp32Path || esp32Busy,
      action: () => runDeckMacro("ESP32 ping", () => sendEsp32Quick("ESP32 ping", "print('nightgrid')\r\n"))
    },
    {
      label: "T-Deck link",
      icon: Plug,
      disabled: !esp32Path || esp32Busy,
      action: () =>
        runDeckMacro("T-Deck link", () =>
          sendEsp32LinkCommand("probe", { cmd: "attachProbe", deckId: dongleDeckId, deckName: dongleDeckName })
        )
    },
    {
      label: "ESP32 remote",
      icon: Activity,
      disabled: !esp32Path || esp32Busy,
      action: () =>
        runDeckMacro("ESP32 remote", async () => {
          await linkEsp32RemoteHost();
        })
    },
    {
      label: "Memory check",
      icon: Cpu,
      disabled: !selectedSession || selectedSession.role === "flipper",
      action: () => runDeckMacro("Memory check", () => writeSelected("import gc; print(gc.mem_free())\r\n"))
    }
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            NG
          </div>
          <div>
            <p className="eyebrow">USB field console</p>
            <h1>NightGrid Cyberdeck</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="status-pill">
            <ShieldCheck size={16} />
            Local only
          </span>
          <span className="status-pill">
            <Activity size={16} />
            {platform ? `${platform.platform} v${platform.version}` : "Starting"}
          </span>
          {updateMessage ? <span className="status-pill update-pill">{updateMessage}</span> : null}
          <button className="icon-button" onClick={installUpdate} disabled={updateBusy}>
            <Download size={18} />
            {updateBusy ? "Updating" : "Update"}
          </button>
          <button className="icon-button primary" onClick={refreshDevices} disabled={isRefreshing}>
            <RefreshCw size={18} className={isRefreshing ? "spin" : ""} />
            Scan
          </button>
        </div>
      </header>

      <section className="deck-hud" aria-label="NightGrid deck status">
        <div className="hud-tile live">
          <span>Deck</span>
          <strong>{deckState}</strong>
          <small>{ports.length} ports scanned</small>
        </div>
        <div className="hud-tile">
          <span>Sessions</span>
          <strong>{sessions.length}</strong>
          <small>{selectedPathLabel}</small>
        </div>
        <div className="hud-tile">
          <span>Known boards</span>
          <strong>{knownPortCount}</strong>
          <small>{selectedRoleLabel}</small>
        </div>
        <div className="hud-tile">
          <span>GPS</span>
          <strong>{gpsStatus}</strong>
          <small>{gpsCanPush ? "Fix ready" : "No push"}</small>
        </div>
        <div className="hud-tile">
          <span>ESP32 auto</span>
          <strong>{esp32AutoConnect ? "Armed" : "Off"}</strong>
          <small>{esp32Session ? esp32Session.path : "Waiting"}</small>
        </div>
      </section>

      <section className="dashboard">
        <aside className="panel device-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Attached hardware</p>
              <h2>Ports</h2>
            </div>
            <Usb size={22} />
          </div>

          <div className="device-list">
            {groupedPorts.length === 0 ? (
              <div className="empty-state">
                <Cable size={28} />
                <p>No serial devices found.</p>
              </div>
            ) : (
              groupedPorts.map((port) => {
                const role = roleByPath[port.path] ?? port.suggestedRole;
                const RoleIcon = roleIcons[role];
                const connected = connectedPaths.has(port.path);
                const session = sessions.find((item) => item.path === port.path);
                return (
                  <article className={`device-card role-${role} ${connected ? "connected" : ""}`} key={port.path}>
                    <div className="device-main">
                      <RoleIcon size={20} />
                      <div>
                        <h3>{port.path}</h3>
                        <p>{port.friendlyName || port.manufacturer}</p>
                      </div>
                    </div>
                    <div className="device-status-strip" aria-hidden="true">
                      {[0, 1, 2, 3, 4].map((bar) => (
                        <span key={bar} className={connected || bar < Math.min(port.tags.length + 1, 5) ? "lit" : ""} />
                      ))}
                    </div>

                    <div className="tag-row">
                      {(port.tags.length ? port.tags : ["Serial"]).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>

                    <label>
                      Role
                      <select
                        value={role}
                        onChange={(event) => {
                          const nextRole = event.target.value as DeviceRole;
                          setRoleByPath((current) => ({ ...current, [port.path]: nextRole }));
                          setBaudByPath((current) => ({ ...current, [port.path]: defaultBaud(nextRole) }));
                        }}
                      >
                        {Object.entries(roleLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Baud
                      <select
                        value={baudByPath[port.path] ?? defaultBaud(role)}
                        onChange={(event) =>
                          setBaudByPath((current) => ({ ...current, [port.path]: Number(event.target.value) }))
                        }
                      >
                        {baudRates.map((baud) => (
                          <option key={baud} value={baud}>
                            {baud}
                          </option>
                        ))}
                      </select>
                    </label>

                    {connected && session ? (
                      <button className="icon-button danger" onClick={() => disconnectSession(session.id)}>
                        <Power size={16} />
                        Disconnect
                      </button>
                    ) : (
                      <button className="icon-button" onClick={() => connectPort(port)}>
                        <Plug size={16} />
                        Connect
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </aside>

        <section className="panel console-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live traffic</p>
              <h2>Serial Console</h2>
            </div>
            <Terminal size={22} />
          </div>

          <div className="console-hud">
            <div>
              <span>Selected</span>
              <strong>{selectedPathLabel}</strong>
            </div>
            <div>
              <span>Role</span>
              <strong>{selectedRoleLabel}</strong>
            </div>
            <div>
              <span>Last event</span>
              <strong>{latestEvent ? latestEvent.channel.toUpperCase() : "None"}</strong>
            </div>
          </div>

          <div className="session-tabs">
            {sessions.length === 0 ? (
              <span className="muted">Connect a port to start a session.</span>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  className={session.id === selectedSession?.id ? "active" : ""}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  {session.path}
                </button>
              ))
            )}
          </div>

          <div className="terminal-toolbar">
            <div className="filter-row">
              {(["all", "rx", "tx", "status"] as LogFilter[]).map((filter) => (
                <button
                  className={logFilter === filter ? "active" : ""}
                  key={filter}
                  onClick={() => setLogFilter(filter)}
                >
                  {filter.toUpperCase()}
                  <span>{logStats[filter]}</span>
                </button>
              ))}
            </div>
            <div className="tool-row">
              <button className="icon-button compact" disabled={logs.length === 0} onClick={copyLogs}>
                <Clipboard size={15} />
                Copy
              </button>
              <button className="icon-button compact danger" disabled={logs.length === 0} onClick={clearLogs}>
                <Trash2 size={15} />
                Clear
              </button>
            </div>
          </div>

          <div className="terminal-window" ref={logRef}>
            {visibleLogs.length === 0 ? (
              <p className="terminal-muted">Waiting for traffic.</p>
            ) : (
              visibleLogs.map((entry) => (
                <div className={`log-line ${entry.channel}`} key={entry.id}>
                  <span>{formatTime(entry.at)}</span>
                  <span>{entry.channel.toUpperCase()}</span>
                  <span>{entry.path ?? "system"}</span>
                  <code>{entry.text.replace(/\r/g, "\\r").replace(/\n/g, "\\n\n")}</code>
                </div>
              ))
            )}
          </div>

          <div className="command-row">
            <input
              value={serialInput}
              onChange={(event) => setSerialInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") writeSelected();
              }}
              placeholder={selectedSession ? `Send to ${selectedSession.path}` : "Select a connected session"}
              disabled={!selectedSession}
            />
            <select value={lineEnding} onChange={(event) => setLineEnding(event.target.value as typeof lineEnding)}>
              <option value="lf">LF</option>
              <option value="crlf">CRLF</option>
              <option value="none">None</option>
            </select>
            <button className="icon-button primary" onClick={() => writeSelected()} disabled={!selectedSession}>
              <Send size={16} />
              Send
            </button>
          </div>
        </section>

        <aside className="side-stack">
          <nav className="side-tabs" aria-label="NightGrid tool tabs">
            {sideTabs.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  className={sideTab === tab.value ? "active" : ""}
                  key={tab.value}
                  onClick={() => setSideTab(tab.value)}
                >
                  <TabIcon size={16} />
                  <span>{tab.label}</span>
                  <small>{tab.detail}</small>
                </button>
              );
            })}
          </nav>

          {sideTab === "command" && (
            <>
          <section className="panel command-deck-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Macro launcher</p>
                <h2>Command Deck</h2>
              </div>
              <Zap size={22} />
            </div>
            <div className="macro-grid">
              {macroButtons.map((macro) => {
                const MacroIcon = macro.icon;
                const disabled = Boolean(macroBusy) || macro.disabled;
                return (
                  <button className="icon-button macro-button" disabled={disabled} key={macro.label} onClick={macro.action}>
                    <MacroIcon size={15} />
                    {macroBusy === macro.label ? "Running" : macro.label}
                  </button>
                );
              })}
            </div>
            <pre className="mesh-output macro-output">{macroOutput}</pre>
          </section>
            </>
          )}

          {sideTab === "marketplace" && (
            <>
          <section className="panel marketplace-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Curated packs</p>
                <h2>Marketplace</h2>
              </div>
              <PackageOpen size={22} />
            </div>
            <div className="market-hero">
              <div>
                <strong>{visibleMarketplacePacks.length} / {marketplacePacks.length} Packs</strong>
                <span>Official source, installer, and setup lanes for field hardware</span>
              </div>
              <button className="icon-button compact" disabled={Boolean(marketplaceBusy)} onClick={() => setMarketplaceFilter("featured")}>
                <Sparkles size={15} />
                Featured
              </button>
            </div>
            <div className="market-tabs" aria-label="Marketplace filters">
              {marketplaceFilters.map((filter) => (
                <button
                  className={marketplaceFilter === filter.value ? "active" : ""}
                  key={filter.value}
                  onClick={() => setMarketplaceFilter(filter.value)}
                >
                  <span>{filter.label}</span>
                  <strong>{marketplaceTabCounts[filter.value]}</strong>
                </button>
              ))}
            </div>
            <div className="market-grid">
              {visibleMarketplacePacks.map((pack) => {
                const isBusy = marketplaceBusy.startsWith(pack.id);
                return (
                  <article className="market-card" key={pack.id}>
                    <div className="market-card-top">
                      <span>{pack.device}</span>
                      <span>{pack.badge}</span>
                    </div>
                    <h3>{pack.title}</h3>
                    <p>{pack.summary}</p>
                    <div className="market-source">Source: {pack.sourceName}</div>
                    <div className="market-actions">
                      <button className="icon-button compact" disabled={Boolean(marketplaceBusy)} onClick={() => openMarketplaceSource(pack)}>
                        <ExternalLink size={15} />
                        Source
                      </button>
                      <button className="icon-button compact" disabled={Boolean(marketplaceBusy)} onClick={() => grabMarketplacePack(pack)}>
                        <Download size={15} />
                        Grab
                      </button>
                      <button className="icon-button compact" disabled={Boolean(marketplaceBusy)} onClick={() => applyMarketplacePack(pack)}>
                        <Sparkles size={15} />
                        Auto setup
                      </button>
                      <button
                        className="icon-button compact primary"
                        disabled={Boolean(marketplaceBusy)}
                        onClick={() => runMarketplacePack(pack)}
                      >
                        <Zap size={15} />
                        {isBusy ? "Running" : "Run"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <pre className="mesh-output marketplace-output">{marketplaceOutput}</pre>
          </section>
            </>
          )}

          {sideTab === "flash" && (
            <>
          <section className="panel flasher-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">ESP32-S3 / T-Deck</p>
                <h2>Flasher</h2>
              </div>
              <Download size={22} />
            </div>
            <div className="flasher-controls">
              <label>
                Target
                <select value={flasherTarget} onChange={(event) => setFlasherTarget(event.target.value as FlasherTarget)}>
                  {Object.entries(flasherTargetLabels).map(([target, label]) => (
                    <option value={target} key={target}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Port
                <select
                  value={flasherPath}
                  onChange={(event) => {
                    setFlasherPath(event.target.value);
                    flasherPathRef.current = event.target.value;
                  }}
                >
                  <option value="">Select port</option>
                  {(flasherPorts.length ? flasherPorts : ports).map((port) => (
                    <option value={port.path} key={port.path}>
                      {port.path} {port.friendlyName ? `- ${port.friendlyName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="button-grid">
              <button className="icon-button primary" disabled={flasherBusy} onClick={openWebFlasher}>
                <Download size={15} />
                Open flasher
              </button>
              <button className="icon-button" disabled={flasherBusy} onClick={openFirmwareRelease}>
                <Activity size={15} />
                Firmware
              </button>
              <button className="icon-button" disabled={flasherBusy || !flasherPath || Boolean(flasherSession)} onClick={connectFlasher}>
                <Plug size={15} />
                {flasherSession ? "Connected" : "Connect"}
              </button>
              <button className="icon-button" disabled={flasherBusy || !flasherPath} onClick={bootloaderFlasherTarget}>
                <Download size={15} />
                Bootloader
              </button>
              <button className="icon-button" disabled={flasherBusy || !flasherPath} onClick={resetFlasherTarget}>
                <RefreshCw size={15} />
                Reset
              </button>
            </div>
            <pre className="mesh-output flasher-output">{flasherOutput}</pre>
          </section>
            </>
          )}

          {sideTab === "radio" && (
            <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">GPS module</p>
                <h2>Fix</h2>
              </div>
              <MapPin size={22} />
            </div>
            <div className="gps-grid">
              <Metric label="Latitude" value={formatCoord(gpsFix?.lat)} />
              <Metric label="Longitude" value={formatCoord(gpsFix?.lon)} />
              <Metric label="Satellites" value={gpsFix?.satellites?.toString() ?? "Unknown"} />
              <Metric label="Altitude" value={typeof gpsFix?.altitudeMeters === "number" ? `${gpsFix.altitudeMeters.toFixed(1)} m` : "Unknown"} />
              <Metric label="Speed" value={typeof gpsFix?.speedKnots === "number" ? `${gpsFix.speedKnots.toFixed(1)} kt` : "Unknown"} />
              <Metric label="Status" value={gpsStatus} />
            </div>
            <div className="gps-controls">
              <label>
                GPS port
                <select
                  value={gpsPath}
                  onChange={(event) => {
                    setGpsPath(event.target.value);
                    setGpsFix(null);
                    setGpsLastFixAt(null);
                    lastGpsPushedFixAt.current = null;
                  }}
                >
                  <option value="">Select port</option>
                  {(gpsPorts.length ? gpsPorts : ports).map((port) => (
                    <option value={port.path} key={port.path}>
                      {port.path} {port.friendlyName ? `- ${port.friendlyName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Baud
                <select value={gpsBaud} onChange={(event) => setGpsBaud(Number(event.target.value))}>
                  {[9600, 38400, 4800, 57600, 115200].map((baud) => (
                    <option key={baud} value={baud}>
                      {baud}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="button-grid">
              <button className="icon-button" disabled={gpsProbeBusy || !gpsPath} onClick={probeGps}>
                <Crosshair size={15} />
                Probe NMEA
              </button>
              <button className="icon-button" disabled={!gpsPath || connectedPaths.has(gpsPath)} onClick={connectGps}>
                <Plug size={15} />
                Connect GPS
              </button>
              <button className="icon-button primary" disabled={!gpsCanPush || !donglePath || gpsPushBusy} onClick={() => pushGpsFix()}>
                <Send size={15} />
                Push fix
              </button>
              <label className="checkbox-row">
                <input type="checkbox" checked={gpsAutoPush} onChange={(event) => setGpsAutoPush(event.target.checked)} />
                Auto push
              </label>
            </div>
            <pre className="mesh-output gps-output">{gpsProbeOutput}</pre>
          </section>

          <section className={`panel war-drive-panel ${warDriveActive ? "active" : ""}`}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Heltec V3</p>
                <h2>War Drive</h2>
              </div>
              <Crosshair size={22} />
            </div>
            <div className="gps-grid war-drive-grid">
              <Metric label="Mode" value={warDriveActive ? "Recording" : "Idle"} />
              <Metric label="Sightings" value={warDriveRecords.length.toString()} />
              <Metric label="Last node" value={latestWarDriveRecord?.nodeId ?? "None"} />
              <Metric
                label="Last fix"
                value={
                  latestWarDriveRecord?.lat !== undefined && latestWarDriveRecord.lon !== undefined
                    ? `${latestWarDriveRecord.lat.toFixed(5)}, ${latestWarDriveRecord.lon.toFixed(5)}`
                    : gpsStatus
                }
              />
            </div>
            <div className="war-drive-controls">
              <label>
                Heltec / mesh port
                <select value={meshPath} onChange={(event) => setMeshPath(event.target.value)}>
                  <option value="">Select port</option>
                  {(meshPorts.length ? meshPorts : ports).map((port) => (
                    <option value={port.path} key={port.path}>
                      {port.path} {port.friendlyName ? `- ${port.friendlyName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Poll seconds
                <input
                  value={warDriveInterval}
                  inputMode="numeric"
                  onChange={(event) => setWarDriveInterval(event.target.value)}
                  aria-label="War Drive poll interval seconds"
                />
              </label>
            </div>
            <div className="button-grid">
              <button className="icon-button primary" disabled={!meshPath && !meshPorts[0]?.path} onClick={warDriveActive ? stopWarDrive : startWarDrive}>
                <Power size={15} />
                {warDriveActive ? "Stop" : "Start"}
              </button>
              <button className="icon-button" disabled={!meshPath && !meshPorts[0]?.path} onClick={() => recordWarDriveNodes("manual")}>
                <Crosshair size={15} />
                Mark now
              </button>
              <button className="icon-button" disabled={warDriveSaving || warDriveRecords.length === 0} onClick={saveWarDriveRecords}>
                <Download size={15} />
                Save log
              </button>
              <button className="icon-button" disabled={warDriveRecords.length === 0} onClick={copyWarDriveRecords}>
                <Clipboard size={15} />
                Copy CSV
              </button>
              <button className="icon-button danger" disabled={warDriveRecords.length === 0} onClick={clearWarDriveRecords}>
                <Trash2 size={15} />
                Clear
              </button>
              <span className="status-pill war-drive-pill">{gpsCanPush ? "GPS cached" : "GPS optional"}</span>
            </div>
            <pre className="mesh-output war-drive-output">{warDriveOutput}</pre>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Heltec V3 / T-Deck</p>
                <h2>Mesh CLI</h2>
              </div>
              <Radio size={22} />
            </div>
            <label>
              Mesh port
              <select value={meshPath} onChange={(event) => setMeshPath(event.target.value)}>
                <option value="">Select port</option>
                {(meshPorts.length ? meshPorts : ports).map((port) => (
                  <option value={port.path} key={port.path}>
                    {port.path} {port.friendlyName ? `- ${port.friendlyName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-grid">
              <button className="icon-button" disabled={meshBusy} onClick={() => runMeshCommand(api.probeMeshCli)}>
                <Crosshair size={15} />
                Probe
              </button>
              <button
                className="icon-button"
                disabled={meshBusy || !meshPath}
                onClick={() => runMeshCommand(() => api.meshInfo({ path: meshPath }))}
              >
                <Download size={15} />
                Info
              </button>
              <button
                className="icon-button"
                disabled={meshBusy || !meshPath}
                onClick={() => runMeshCommand(() => api.meshNodes({ path: meshPath }))}
              >
                <Radio size={15} />
                Nodes
              </button>
            </div>
            <div className="mesh-send">
              <input
                value={meshMessage}
                onChange={(event) => setMeshMessage(event.target.value)}
                placeholder="Text to send"
              />
              <input
                className="channel-input"
                value={meshChannel}
                onChange={(event) => setMeshChannel(event.target.value)}
                aria-label="Mesh channel index"
              />
              <button className="icon-button primary" disabled={meshBusy || !meshPath || !meshMessage} onClick={sendMeshMessage}>
                <Send size={15} />
                Mesh
              </button>
            </div>
            <pre className="mesh-output">{meshOutput}</pre>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">T-Dongle</p>
                <h2>Wireless Bridge</h2>
              </div>
              <Plug size={22} />
            </div>
            <label>
              Bridge port
              <select value={donglePath} onChange={(event) => setDonglePath(event.target.value)}>
                <option value="">Select port</option>
                {(donglePorts.length ? donglePorts : ports).map((port) => (
                  <option value={port.path} key={port.path}>
                    {port.path} {port.friendlyName ? `- ${port.friendlyName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="bridge-grid">
              <label>
                Deck ID
                <input value={dongleDeckId} onChange={(event) => setDongleDeckId(event.target.value)} />
              </label>
              <label>
                Deck name
                <input value={dongleDeckName} onChange={(event) => setDongleDeckName(event.target.value)} />
              </label>
            </div>
            <div className="subsection-heading">
              <span>GUI + Remote Link</span>
              <ExternalLink size={16} />
            </div>
            <div className="gps-grid dongle-gui-grid">
              <Metric label="AP" value={dongleGuiSsid || defaultDongleSsid} />
              <Metric label="GUI" value={normalizeUrl(dongleGuiUrl)} />
            </div>
            <label className="solo-input">
              T-Dongle GUI URL
              <input value={dongleGuiUrl} onChange={(event) => setDongleGuiUrl(event.target.value)} />
            </label>
            <div className="button-grid">
              <button className="icon-button" disabled={dongleBusy || !donglePath} onClick={probeDongleGui}>
                <Crosshair size={15} />
                Probe GUI
              </button>
              <button className="icon-button primary" onClick={openDongleGui}>
                <ExternalLink size={15} />
                Open GUI
              </button>
              <button className="icon-button" disabled={dongleBusy || !donglePath} onClick={startDongleRemoteLink}>
                <Plug size={15} />
                Start link
              </button>
              <button className="icon-button" disabled={dongleBusy || !donglePath || !donglePairCode.trim()} onClick={finishDongleRemoteLink}>
                <ShieldCheck size={15} />
                Finish link
              </button>
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() =>
                  runDongleCommand({
                    cmd: "saveProfile",
                    deckId: dongleDeckId,
                    deckName: dongleDeckName,
                    profile: dongleProfilePayload(),
                    profileHash: "tdeck-profile-v1"
                  })
                }
              >
                <Clipboard size={15} />
                Profile
              </button>
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() => runDongleCommand({ cmd: "writeConfig", key: "bridgeUrl", value: normalizeUrl(dongleGuiUrl) })}
              >
                <Download size={15} />
                Write URL
              </button>
            </div>
            <div className="button-grid">
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() => runDongleCommand({ cmd: "attachProbe", deckId: dongleDeckId, deckName: dongleDeckName })}
              >
                <Crosshair size={15} />
                Probe
              </button>
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() => runDongleCommand({ cmd: "status" })}
              >
                <Activity size={15} />
                Status
              </button>
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() => runDongleCommand({ cmd: "pairBegin", deckId: dongleDeckId, deckName: dongleDeckName })}
              >
                <Radio size={15} />
                Pair begin
              </button>
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath || !donglePairCode.trim()}
                onClick={() =>
                  runDongleCommand({
                    cmd: "pairConfirm",
                    deckId: dongleDeckId,
                    deckName: dongleDeckName,
                    code: donglePairCode.trim()
                  })
                }
              >
                <ShieldCheck size={15} />
                Confirm
              </button>
            </div>
            <input
              className="solo-input"
              value={donglePairCode}
              onChange={(event) => setDonglePairCode(event.target.value)}
              placeholder="Pair code"
            />
            <div className="button-grid">
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() => runDongleCommand({ cmd: "payload", id: "remote.deck-ready" })}
              >
                <Power size={15} />
                Deck ready
              </button>
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() => runDongleCommand({ cmd: "payload", id: "remote.dongle-auto-pair" })}
              >
                <Plug size={15} />
                Auto pair
              </button>
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() => runDongleCommand({ cmd: "control", action: "launcher" })}
              >
                <Terminal size={15} />
                Launcher
              </button>
              <button
                className="icon-button"
                disabled={dongleBusy || !donglePath}
                onClick={() => runDongleCommand({ cmd: "control", action: "refresh" })}
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            </div>
            <div className="bridge-send">
              <input value={dongleText} onChange={(event) => setDongleText(event.target.value)} placeholder="Text event" />
              <button className="icon-button primary" disabled={dongleBusy || !donglePath || !dongleText.trim()} onClick={sendDongleText}>
                <Send size={15} />
                Text
              </button>
            </div>
            <div className="bridge-send">
              <input value={donglePayloadId} onChange={(event) => setDonglePayloadId(event.target.value)} placeholder="Payload ID" />
              <button className="icon-button" disabled={dongleBusy || !donglePath || !donglePayloadId.trim()} onClick={sendDonglePayload}>
                <Download size={15} />
                Payload
              </button>
            </div>
            <pre className="mesh-output bridge-output">{dongleOutput}</pre>
          </section>
            </>
          )}

          {sideTab === "modules" && (
            <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">ESP32</p>
                <h2>Module</h2>
              </div>
              <Cpu size={22} />
            </div>
            <label>
              ESP32 port
              <select
                value={esp32Path}
                onChange={(event) => {
                  const nextPath = event.target.value;
                  setEsp32Path(nextPath);
                  esp32PathRef.current = nextPath;
                  if (nextPath) {
                    setRoleByPath((current) => {
                      const next = { ...current, [nextPath]: "esp32" as DeviceRole };
                      roleByPathRef.current = next;
                      return next;
                    });
                    setBaudByPath((current) => {
                      const next = { ...current, [nextPath]: current[nextPath] ?? defaultBaud("esp32") };
                      baudByPathRef.current = next;
                      return next;
                    });
                  }
                }}
              >
                <option value="">Select port</option>
                {(esp32Ports.length ? esp32Ports : ports).map((port) => (
                  <option value={port.path} key={port.path}>
                    {port.path} {port.friendlyName ? `- ${port.friendlyName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-grid">
              <button className="icon-button" disabled={esp32Busy || !esp32Path || Boolean(esp32Session)} onClick={() => connectEsp32()}>
                <Plug size={15} />
                {esp32Session ? "Connected" : "Connect"}
              </button>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={esp32AutoConnect}
                  onChange={(event) => setEsp32AutoConnect(event.target.checked)}
                />
                Auto connect
              </label>
              <button
                className="icon-button"
                disabled={esp32Busy || !esp32Session}
                onClick={() => runEsp32Action("ESP32 reset", (session) => api.esp32Reset({ sessionId: session.id }))}
              >
                <RefreshCw size={15} />
                Reset
              </button>
              <button
                className="icon-button"
                disabled={esp32Busy || !esp32Session}
                onClick={() =>
                  runEsp32Action("ESP32 bootloader", (session) => api.esp32Bootloader({ sessionId: session.id }))
                }
              >
                <Download size={15} />
                Bootloader
              </button>
            </div>
            <div className="button-grid">
              <button className="icon-button" disabled={esp32Busy || !esp32Session} onClick={() => sendEsp32Quick("Ctrl-C", "\x03")}>
                Ctrl-C
              </button>
              <button className="icon-button" disabled={esp32Busy || !esp32Session} onClick={() => sendEsp32Quick("Ctrl-D", "\x04")}>
                Ctrl-D
              </button>
              <button
                className="icon-button"
                disabled={esp32Busy || !esp32Session}
                onClick={() => sendEsp32Quick("help()", "help()\r\n")}
              >
                help()
              </button>
              <button
                className="icon-button"
                disabled={esp32Busy || !esp32Session}
                onClick={() => sendEsp32Quick("List files", "import os; print(os.listdir())\r\n")}
              >
                List files
              </button>
            </div>
            <div className="subsection-heading">
              <span>ESP32 Remote</span>
              <Activity size={16} />
            </div>
            <div className="remote-controls">
              <label>
                Mode
                <select
                  aria-label="ESP32 remote mode"
                  value={esp32RemoteMode}
                  onChange={(event) => setEsp32RemoteMode(event.target.value as Esp32RemoteMode)}
                >
                  {Object.entries(esp32RemoteModeLabels).map(([mode, label]) => (
                    <option value={mode} key={mode}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pin
                <input
                  aria-label="ESP32 remote GPIO pin"
                  value={esp32RemotePin}
                  onChange={(event) => setEsp32RemotePin(event.target.value)}
                />
              </label>
              <label>
                Value
                <select
                  aria-label="ESP32 remote GPIO value"
                  value={esp32RemoteValue}
                  onChange={(event) => setEsp32RemoteValue(event.target.value)}
                >
                  <option value="1">High</option>
                  <option value="0">Low</option>
                </select>
              </label>
            </div>
            <div className="button-grid">
              <button className="icon-button" disabled={esp32Busy || !esp32Path} onClick={linkEsp32RemoteHost}>
                <Plug size={15} />
                Link host
              </button>
              <button className="icon-button" disabled={esp32Busy || !esp32Path} onClick={identifyEsp32Remote}>
                <Cpu size={15} />
                Identify
              </button>
              <button className="icon-button" disabled={esp32Busy || !esp32Path} onClick={heartbeatEsp32Remote}>
                <Activity size={15} />
                Heartbeat
              </button>
              <button className="icon-button" disabled={esp32Busy || !esp32Path} onClick={scanEsp32Wifi}>
                <Radio size={15} />
                Wi-Fi scan
              </button>
              <button className="icon-button" disabled={esp32Busy || !esp32Path} onClick={scanEsp32I2c}>
                <Crosshair size={15} />
                I2C scan
              </button>
              <button className="icon-button" disabled={esp32Busy || !esp32Path} onClick={writeEsp32Gpio}>
                <Zap size={15} />
                GPIO write
              </button>
            </div>
            <div className="remote-send">
              <input
                value={esp32RemoteCommand}
                onChange={(event) => setEsp32RemoteCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runEsp32RemoteCommand();
                }}
                placeholder="Remote command"
              />
              <button className="icon-button primary" disabled={esp32Busy || !esp32Path || !esp32RemoteCommand.trim()} onClick={runEsp32RemoteCommand}>
                <Send size={15} />
                Run
              </button>
            </div>
            <pre className="mesh-output remote-output">{esp32RemoteOutput}</pre>
            <div className="subsection-heading">
              <span>T-Deck Link</span>
              <Radio size={16} />
            </div>
            <div className="button-grid">
              <button
                className="icon-button"
                disabled={esp32Busy || !esp32Path}
                onClick={() => sendEsp32LinkCommand("probe", { cmd: "attachProbe", deckId: dongleDeckId, deckName: dongleDeckName })}
              >
                <Crosshair size={15} />
                Link probe
              </button>
              <button
                className="icon-button"
                disabled={esp32Busy || !esp32Path}
                onClick={() => sendEsp32LinkCommand("pair", { cmd: "pairBegin", deckId: dongleDeckId, deckName: dongleDeckName })}
              >
                <ShieldCheck size={15} />
                Pair begin
              </button>
              <button
                className="icon-button"
                disabled={esp32Busy || !esp32Path}
                onClick={() => sendEsp32LinkCommand("deck ready", { cmd: "payload", id: "remote.deck-ready" })}
              >
                <Power size={15} />
                Deck ready
              </button>
              <button
                className="icon-button"
                disabled={esp32Busy || !esp32Path}
                onClick={() => sendEsp32LinkCommand("launcher", { cmd: "control", action: "launcher" })}
              >
                <Terminal size={15} />
                Launcher
              </button>
            </div>
            <div className="bridge-send">
              <input value={esp32LinkText} onChange={(event) => setEsp32LinkText(event.target.value)} placeholder="T-Deck link text" />
              <button className="icon-button primary" disabled={esp32Busy || !esp32Path || !esp32LinkText.trim()} onClick={sendEsp32LinkText}>
                <Send size={15} />
                Link
              </button>
            </div>
            <pre className="mesh-output link-output">{esp32LinkOutput}</pre>
            <pre className="mesh-output esp32-output">{esp32Output}</pre>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Raspberry Pi Pico</p>
                <h2>Quick Keys</h2>
              </div>
              <Cpu size={22} />
            </div>
            <div className="button-grid">
              <button className="icon-button" disabled={!selectedSession} onClick={() => writeSelected("\x03")}>
                Ctrl-C
              </button>
              <button className="icon-button" disabled={!selectedSession} onClick={() => writeSelected("\x04")}>
                Ctrl-D
              </button>
              <button className="icon-button" disabled={!selectedSession} onClick={() => writeSelected("help()\r\n")}>
                help()
              </button>
              <button className="icon-button" disabled={!selectedSession} onClick={() => writeSelected("import os; os.listdir()\r\n")}>
                List files
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Flipper Zero</p>
                <h2>CLI Keys</h2>
              </div>
              <Cpu size={22} />
            </div>
            <div className="button-grid">
              <button className="icon-button" disabled={!selectedSession} onClick={() => writeSelected("help\r\n")}>
                Help
              </button>
              <button className="icon-button" disabled={!selectedSession} onClick={() => writeSelected("device_info\r\n")}>
                Device info
              </button>
              <button className="icon-button" disabled={!selectedSession} onClick={() => writeSelected("storage list /ext\r\n")}>
                Storage
              </button>
              <button className="icon-button" disabled={!selectedSession} onClick={() => writeSelected("power info\r\n")}>
                Power
              </button>
            </div>
          </section>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
