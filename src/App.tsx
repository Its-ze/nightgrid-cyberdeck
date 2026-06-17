import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cable,
  Clipboard,
  Cpu,
  Crosshair,
  Download,
  Gauge,
  MapPin,
  Plug,
  Power,
  Radio,
  RefreshCw,
  Satellite,
  Send,
  ShieldCheck,
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
  SerialStatusEvent
} from "./types";

interface LogEntry {
  id: number;
  channel: "rx" | "tx" | "status";
  at: string;
  path?: string;
  role?: DeviceRole;
  text: string;
}

type LogFilter = "all" | "rx" | "tx" | "status";
type FlasherTarget = "tdeck" | "esp32s3" | "esp32" | "tdongle";

const baudRates = [9600, 38400, 57600, 115200, 230400, 460800, 921600];
const gpsFreshMs = 6000;
const gpsCacheTtlMs = 120000;
const zDeckFlasherUrl = "https://its-ze.github.io/Z-Deck-Web-Flasher/";
const zDeckReleaseUrl = "https://github.com/Its-ze/Z-Deck-Web-Flasher/releases/latest";

const flasherTargetLabels: Record<FlasherTarget, string> = {
  tdeck: "T-Deck",
  esp32s3: "ESP32-S3",
  esp32: "ESP32",
  tdongle: "T-Dongle"
};

const roleLabels: Record<DeviceRole, string> = {
  heltec: "Heltec mesh",
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
  const [donglePath, setDonglePath] = useState("");
  const [dongleBusy, setDongleBusy] = useState(false);
  const [dongleOutput, setDongleOutput] = useState("T-Dongle bridge output will appear here.");
  const [dongleDeckId, setDongleDeckId] = useState("itsz-tdeck");
  const [dongleDeckName, setDongleDeckName] = useState("ITSZ T-Deck");
  const [donglePairCode, setDonglePairCode] = useState("");
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
  const [macroBusy, setMacroBusy] = useState("");
  const [macroOutput, setMacroOutput] = useState("Command deck ready.");
  const [platform, setPlatform] = useState<{ platform: NodeJS.Platform; version: string } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const logCounter = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const lastGpsPushAt = useRef(0);
  const lastGpsPushedFixAt = useRef<number | null>(null);
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
    } catch (error) {
      setMeshOutput(error instanceof Error ? error.message : "Meshtastic command failed.");
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

  const runDongleCommand = async (command: DongleCommandPayload, timeoutMs = 3400) => {
    if (!donglePath) return;
    setDongleBusy(true);
    try {
      const result = await api.dongleCommand({ path: donglePath, command, timeoutMs });
      setDongleOutput(formatCommandResult(result));
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: donglePath,
        role: "tdongle",
        text: result.ok ? `T-Dongle command ${command.cmd} completed.` : `T-Dongle command ${command.cmd} failed.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "T-Dongle command failed.";
      setDongleOutput(message);
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: donglePath,
        role: "tdongle",
        text: message
      });
    } finally {
      setDongleBusy(false);
    }
  };

  const sendDongleText = async () => {
    if (!dongleText.trim()) return;
    await runDongleCommand({ cmd: "text", text: dongleText.trim() });
  };

  const sendDonglePayload = async () => {
    if (!donglePayloadId.trim()) return;
    await runDongleCommand({ cmd: "payload", id: donglePayloadId.trim() });
  };

  const connectEsp32 = async () => {
    const port = ports.find((item) => item.path === esp32Path) ?? esp32Ports[0];
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
    return connectEsp32();
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
    } finally {
      setEsp32Busy(false);
    }
  };

  const sendEsp32Quick = async (label: string, data: string) => {
    await runEsp32Action(label, (session) => writeSession(session, data));
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
      action: () => runDeckMacro("Mesh nodes", () => runMeshCommand(() => api.meshNodes({ path: meshPath })))
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
      action: () => runDeckMacro("Dongle status", () => runDongleCommand({ cmd: "status" }))
    },
    {
      label: "Deck ready",
      icon: Power,
      disabled: dongleBusy || !donglePath,
      action: () => runDeckMacro("Deck ready", () => runDongleCommand({ cmd: "payload", id: "remote.deck-ready" }))
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

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Heltec / T-Deck</p>
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
