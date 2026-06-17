import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SerialPort } from "serialport";
import type {
  CommandResult,
  DevicePort,
  DeviceRole,
  DongleCommandPayload,
  GpsFix,
  SerialEvent,
  SerialSession,
  SerialStatusEvent,
  UpdateResult
} from "../src/types";

type ListedPort = Awaited<ReturnType<typeof SerialPort.list>>[number];

interface LiveSession extends SerialSession {
  port: SerialPort;
  lineBuffer: string;
  displayBuffer: string;
  displayFlush?: NodeJS.Timeout;
}

const sessions = new Map<string, LiveSession>();
const releaseBaseUrl = "https://github.com/Its-ze/nightgrid-cyberdeck/releases/latest/download";
const linuxAppImageAsset = "NightGrid-Cyberdeck-Linux-x64.AppImage";
const windowsSetupAsset = "NightGrid-Cyberdeck-Windows-x64-Setup.exe";
const gpsProbeBaudRates = [9600, 38400, 4800, 57600, 115200];
const nmeaSentencePattern = /\$(?:GP|GN|GL|GA|GB|GQ)(?:GGA|RMC|GLL|GSA|GSV|VTG),/;

const now = () => new Date().toISOString();
const appIconPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(__dirname, "../../build/icon.png");
const nightgridDataDir = () => path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "nightgrid-cyberdeck");
const meshtasticVenvPython = () =>
  process.platform === "win32"
    ? path.join(nightgridDataDir(), "meshtastic-venv", "Scripts", "python.exe")
    : path.join(nightgridDataDir(), "meshtastic-venv", "bin", "python");

const sendToWindows = (channel: string, payload: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

const emitStatus = (event: Omit<SerialStatusEvent, "at">) => {
  sendToWindows("serial:status", { ...event, at: now() });
};

const ansiSequencePattern = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[@-Z\\-_])/g;
const serialControlPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const cleanSerialConsoleText = (text: string) =>
  text.replace(ansiSequencePattern, "").replace(serialControlPattern, "").replace(/\r/g, "");

const emitSerialData = (session: LiveSession, text: string) => {
  const clean = cleanSerialConsoleText(text).trimEnd();
  if (!clean.trim()) return;
  const serialEvent: SerialEvent = {
    sessionId: session.id,
    path: session.path,
    role: session.role,
    text: clean,
    at: now()
  };
  sendToWindows("serial:data", serialEvent);
};

const flushSerialDisplay = (session: LiveSession) => {
  if (session.displayFlush) {
    clearTimeout(session.displayFlush);
    session.displayFlush = undefined;
  }
  if (!session.displayBuffer) return;
  emitSerialData(session, session.displayBuffer);
  session.displayBuffer = "";
};

const queueSerialDisplay = (session: LiveSession, text: string) => {
  if (session.displayFlush) {
    clearTimeout(session.displayFlush);
    session.displayFlush = undefined;
  }

  session.displayBuffer += text;
  const lines = session.displayBuffer.split(/\r?\n/);
  session.displayBuffer = lines.pop() ?? "";
  for (const line of lines) {
    emitSerialData(session, line);
  }

  if (session.displayBuffer.length > 300) {
    flushSerialDisplay(session);
  } else if (session.displayBuffer.length > 0) {
    session.displayFlush = setTimeout(() => flushSerialDisplay(session), 180);
  }
};

const normalizeUsbId = (value?: string) => value?.toUpperCase().padStart(4, "0");

const hasAny = (haystack: string, needles: string[]) => needles.some((needle) => haystack.includes(needle));

const classifyPort = (port: ListedPort): DevicePort => {
  const manufacturer = port.manufacturer ?? "";
  const listedName = "friendlyName" in port && typeof port.friendlyName === "string" ? port.friendlyName : "";
  const vendorId = normalizeUsbId(port.vendorId);
  const productId = normalizeUsbId(port.productId);
  const pnpId = port.pnpId ?? "";
  const haystack = `${manufacturer} ${listedName} ${port.path} ${pnpId} ${vendorId ?? ""}:${productId ?? ""}`.toLowerCase();
  const tags: string[] = [];
  let suggestedRole: DeviceRole = "console";

  const isEsp32S3UsbJtag = vendorId === "303A" && productId === "1001";
  const isTDeck = hasAny(haystack, ["t-deck", "tdeck", "lilygo t-deck"]);
  const isTDongle = hasAny(haystack, ["t-dongle", "tdongle", "t dongle", "lilygo esp32-s3 dongle"]);
  const isHeltec = haystack.includes("heltec");
  const isFlipper = haystack.includes("flipper") || (vendorId === "0483" && productId === "5740");
  const isGenericEsp32 =
    hasAny(haystack, ["esp32", "espressif", "usb-serial/jtag", "cp210", "ch340"]) ||
    vendorId === "10C4" ||
    vendorId === "1A86";

  if (isTDeck) {
    tags.push("T-Deck", "ESP32-S3", "Meshtastic");
    suggestedRole = "tdeck";
  } else if (isTDongle) {
    tags.push("T-Dongle", "ESP32-S3", "USB serial");
    suggestedRole = "tdongle";
  } else if (isEsp32S3UsbJtag) {
    tags.push("LILYGO ESP32-S3", "T-Deck/T-Dongle", "ESP32 module", "USB serial");
    suggestedRole = "tdeck";
  } else if (isFlipper) {
    tags.push("Flipper Zero", "CLI");
    suggestedRole = "flipper";
  } else if (isHeltec) {
    tags.push("ESP32", "Heltec/Mesh");
    suggestedRole = "heltec";
  } else if (isGenericEsp32) {
    tags.push("ESP32", "USB serial");
    suggestedRole = "esp32";
  }

  if (haystack.includes("raspberry") || haystack.includes("pico") || vendorId === "2E8A") {
    tags.push("Pico");
    suggestedRole = "pico";
  }

  if (haystack.includes("gps") || haystack.includes("ublox") || haystack.includes("u-blox") || vendorId === "1546") {
    tags.push("GPS", "NMEA");
    suggestedRole = "gps";
  }

  if (vendorId === "1A86") {
    tags.push("CH340");
  }

  if (vendorId === "10C4") {
    tags.push("CP210x");
  }

  const uniqueTags = [...new Set(tags)];
  const friendlyName = [listedName || manufacturer, port.path, vendorId && productId ? `${vendorId}:${productId}` : ""]
    .filter(Boolean)
    .join(" ");

  return {
    path: port.path,
    friendlyName: friendlyName || port.path,
    manufacturer: port.manufacturer,
    serialNumber: port.serialNumber,
    vendorId,
    productId,
    pnpId: port.pnpId,
    suggestedRole,
    tags: uniqueTags,
    isKnownBoard: uniqueTags.length > 0
  };
};

const toDecimalCoordinate = (value: string, hemisphere: string) => {
  if (!value) return undefined;
  const dot = value.indexOf(".");
  const degreeLength = dot > 4 ? 3 : 2;
  const degrees = Number(value.slice(0, degreeLength));
  const minutes = Number(value.slice(degreeLength));
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return undefined;
  const sign = hemisphere === "S" || hemisphere === "W" ? -1 : 1;
  return sign * (degrees + minutes / 60);
};

const parseNmea = (line: string, session: LiveSession): GpsFix | undefined => {
  const clean = line.trim();
  if (!clean.startsWith("$")) return undefined;
  const sentence = clean.split("*")[0];
  const parts = sentence.split(",");
  const type = parts[0].slice(3);

  if (type === "GGA") {
    const lat = toDecimalCoordinate(parts[2], parts[3]);
    const lon = toDecimalCoordinate(parts[4], parts[5]);
    return {
      sessionId: session.id,
      path: session.path,
      lat,
      lon,
      satellites: Number(parts[7]) || undefined,
      fixQuality: parts[6] === "0" ? "No fix" : `Fix ${parts[6]}`,
      altitudeMeters: Number(parts[9]) || undefined,
      utcTime: parts[1],
      raw: clean,
      updatedAt: now()
    };
  }

  if (type === "RMC") {
    const lat = toDecimalCoordinate(parts[3], parts[4]);
    const lon = toDecimalCoordinate(parts[5], parts[6]);
    return {
      sessionId: session.id,
      path: session.path,
      lat,
      lon,
      speedKnots: Number(parts[7]) || undefined,
      fixQuality: parts[2] === "A" ? "Active" : "Void",
      utcTime: parts[1],
      raw: clean,
      updatedAt: now()
    };
  }

  return undefined;
};

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1100,
    minHeight: 740,
    backgroundColor: "#06080d",
    title: "NightGrid Cyberdeck",
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
};

const openSerialPort = (session: LiveSession) =>
  new Promise<void>((resolve, reject) => {
    session.port.open((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const closeSerialPort = (session: LiveSession) =>
  new Promise<void>((resolve) => {
    session.port.close(() => resolve());
  });

const writeSerialPort = (session: LiveSession, data: string) =>
  new Promise<void>((resolve, reject) => {
    session.port.write(data, (error) => {
      if (error) reject(error);
      else session.port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
    });
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const setSerialSignals = (session: LiveSession, signals: { dtr?: boolean; rts?: boolean; brk?: boolean }) =>
  new Promise<void>((resolve, reject) => {
    session.port.set(signals, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const pulseEsp32Reset = async (session: LiveSession) => {
  await setSerialSignals(session, { dtr: false, rts: true });
  await sleep(120);
  await setSerialSignals(session, { dtr: false, rts: false });
};

const enterEsp32Bootloader = async (session: LiveSession) => {
  await setSerialSignals(session, { dtr: true, rts: false });
  await sleep(100);
  await setSerialSignals(session, { dtr: true, rts: true });
  await sleep(120);
  await setSerialSignals(session, { dtr: false, rts: true });
  await sleep(80);
  await setSerialSignals(session, { dtr: false, rts: false });
};

const openRawSerialPort = (port: SerialPort) =>
  new Promise<void>((resolve, reject) => {
    port.open((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const closeRawSerialPort = (port: SerialPort) =>
  new Promise<void>((resolve) => {
    if (!port.isOpen) {
      resolve();
      return;
    }
    port.close(() => resolve());
  });

const writeRawSerialPort = (port: SerialPort, data: string) =>
  new Promise<void>((resolve, reject) => {
    port.write(data, (error) => {
      if (error) reject(error);
      else port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
    });
  });

const collectSerialData = (port: SerialPort, timeoutMs: number, stopPattern?: RegExp) =>
  new Promise<string>((resolve) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (stopPattern?.test(output)) {
        clearTimeout(timer);
        port.off("data", onData);
        resolve(output);
      }
    };
    const timer = setTimeout(() => {
      port.off("data", onData);
      resolve(output);
    }, timeoutMs);

    port.on("data", onData);
  });

const cleanSerialSample = (output: string) =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join("\n");

const probeGpsAtBaud = async (pathName: string, baudRate: number, timeoutMs: number) => {
  const existing = [...sessions.values()].find((session) => session.path === pathName);
  if (existing) {
    const sample = await collectSerialData(existing.port, timeoutMs, nmeaSentencePattern);
    return { sample, ok: nmeaSentencePattern.test(sample) };
  }

  const port = new SerialPort({
    path: pathName,
    baudRate,
    autoOpen: false
  });

  try {
    await openRawSerialPort(port);
    const sample = await collectSerialData(port, timeoutMs, nmeaSentencePattern);
    return { sample, ok: nmeaSentencePattern.test(sample) };
  } finally {
    await closeRawSerialPort(port);
  }
};

const probeGpsPort = async (pathName: string, baudRates: number[], timeoutMs: number): Promise<CommandResult> => {
  const command = `gps-probe --port ${pathName} --baud ${baudRates.join(",")}`;
  const failures: string[] = [];

  for (const baudRate of baudRates) {
    try {
      const result = await probeGpsAtBaud(pathName, baudRate, timeoutMs);
      const sample = cleanSerialSample(result.sample);
      if (result.ok) {
        return {
          ok: true,
          command,
          code: 0,
          stdout: [`GPS NMEA detected on ${pathName} at ${baudRate} baud.`, sample].filter(Boolean).join("\n\n"),
          stderr: ""
        };
      }
      failures.push(`${baudRate}: no NMEA${sample ? `\n${sample}` : ""}`);
    } catch (error) {
      failures.push(`${baudRate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: false,
    command,
    code: null,
    stdout: "",
    stderr: `No GPS NMEA sentences detected on ${pathName}.\n${failures.join("\n\n")}`
  };
};

const describeDongleCommand = (pathName: string, command: DongleCommandPayload) => {
  const { cmd, ...rest } = command;
  const details = Object.entries(rest)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return `tdongle --port ${pathName} ${cmd}${details ? ` ${details}` : ""}`;
};

const runDongleCommand = async (
  pathName: string,
  command: DongleCommandPayload,
  timeoutMs = 3200
): Promise<CommandResult> => {
  const commandLine = describeDongleCommand(pathName, command);
  const line = `${JSON.stringify(command)}\n`;
  const existing = [...sessions.values()].find((session) => session.path === pathName);
  let stdout = "";

  if (existing) {
    const onData = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    };
    existing.port.on("data", onData);
    try {
      await writeSerialPort(existing, line);
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    } finally {
      existing.port.off("data", onData);
    }

    return {
      ok: true,
      command: commandLine,
      code: 0,
      stdout: stdout.trim() || "Command sent to active T-Dongle serial session. Watch Live Traffic for the response.",
      stderr: ""
    };
  }

  const port = new SerialPort({
    path: pathName,
    baudRate: 115200,
    autoOpen: false
  });

  const onData = (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  };

  port.on("data", onData);
  try {
    await openRawSerialPort(port);
    await writeRawSerialPort(port, line);
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return {
      ok: true,
      command: commandLine,
      code: 0,
      stdout: stdout.trim() || "Command sent, but no T-Dongle response was received before timeout.",
      stderr: ""
    };
  } catch (error) {
    return {
      ok: false,
      command: commandLine,
      code: null,
      stdout: stdout.trim(),
      stderr: error instanceof Error ? error.message : String(error)
    };
  } finally {
    port.off("data", onData);
    await closeRawSerialPort(port);
  }
};

const downloadFile = (url: string, target: string, redirects = 0) =>
  new Promise<void>((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "NightGrid-Cyberdeck" } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location && redirects < 5) {
        response.resume();
        const nextUrl = new URL(location, url).toString();
        downloadFile(nextUrl, target, redirects + 1).then(resolve).catch(reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status}`));
        return;
      }

      const file = fs.createWriteStream(target, { mode: 0o755 });
      response.pipe(file);
      file.on("finish", () => file.close((error) => (error ? reject(error) : resolve())));
      file.on("error", reject);
    });

    request.on("error", reject);
  });

const writeLinuxDesktopEntry = async (target: string) => {
  const desktopDir = path.join(os.homedir(), ".local", "share", "applications");
  await fsp.mkdir(desktopDir, { recursive: true });
  const desktopFile = path.join(desktopDir, "nightgrid-cyberdeck.desktop");
  const entry = [
    "[Desktop Entry]",
    "Name=NightGrid Cyberdeck",
    "Comment=USB field console for Heltec, T-Deck, Flipper, GPS, Pico, and serial devices",
    `Exec=${target}`,
    "Terminal=false",
    "Type=Application",
    "Categories=Utility;Development;",
    ""
  ].join("\n");
  await fsp.writeFile(desktopFile, entry, "utf8");
};

const uniquePaths = (paths: string[]) => [...new Set(paths.filter(Boolean))];

const linuxAppImageTargetCandidates = () => {
  const configuredInstallDir = process.env.NIGHTGRID_INSTALL_DIR || process.env.XDG_BIN_HOME || path.join(os.homedir(), "Applications");
  const fallbackInstallDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "nightgrid-cyberdeck");
  return uniquePaths([
    process.env.APPIMAGE ?? "",
    path.join(configuredInstallDir, "NightGrid-Cyberdeck.AppImage"),
    path.join(fallbackInstallDir, "NightGrid-Cyberdeck.AppImage")
  ]);
};

const assertWritableDirectory = async (dir: string) => {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.access(dir, fs.constants.W_OK);
  const probe = path.join(dir, `.nightgrid-write-test-${process.pid}-${Date.now()}`);
  await fsp.writeFile(probe, "");
  await fsp.rm(probe, { force: true });
};

const replaceLinuxAppImage = async (source: string, target: string) => {
  const installDir = path.dirname(target);
  await assertWritableDirectory(installDir);
  const tmp = path.join(installDir, `.NightGrid-Cyberdeck.AppImage.${process.pid}.${Date.now()}.download`);

  try {
    await fsp.copyFile(source, tmp);
    await fsp.chmod(tmp, 0o755);
    await fsp.rename(tmp, target);
    await fsp.chmod(target, 0o755);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
};

const installLinuxUpdate = async (): Promise<UpdateResult> => {
  const url = `${releaseBaseUrl}/${linuxAppImageAsset}`;
  const stagingDir = path.join(app.getPath("temp"), "nightgrid-cyberdeck-updates");
  await fsp.mkdir(stagingDir, { recursive: true });
  const download = path.join(stagingDir, `NightGrid-Cyberdeck.AppImage.${process.pid}.${Date.now()}.download`);
  const targets = linuxAppImageTargetCandidates();
  const firstTarget = targets[0];
  const failures: string[] = [];

  try {
    await downloadFile(url, download);
    await fsp.chmod(download, 0o755);

    for (const target of targets) {
      try {
        await replaceLinuxAppImage(download, target);
        await writeLinuxDesktopEntry(target);

        const moved = target !== firstTarget;
        return {
          ok: true,
          platform: process.platform,
          version: app.getVersion(),
          target,
          url,
          restartRequired: true,
          message: moved
            ? `Updated NightGrid at ${target}. The current AppImage location was not writable, so the launcher was moved. Restart the app from the menu to run the new version.`
            : `Updated NightGrid at ${target}. Restart the app to run the new version.`
        };
      } catch (error) {
        failures.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await fsp.rm(download, { force: true }).catch(() => undefined);
  }

  throw new Error(`Could not install the update. Tried ${failures.join(" | ")}`);
};

const installWindowsUpdate = async (): Promise<UpdateResult> => {
  const url = `${releaseBaseUrl}/${windowsSetupAsset}`;
  const target = path.join(app.getPath("temp"), `NightGrid-Cyberdeck-Setup-${Date.now()}.exe`);
  await downloadFile(url, target);
  const child = spawn(target, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();

  return {
    ok: true,
    platform: process.platform,
    version: app.getVersion(),
    target,
    url,
    restartRequired: true,
    message: "Downloaded and launched the latest Windows setup. Close NightGrid if the installer asks before updating."
  };
};

const installLatestUpdate = async (): Promise<UpdateResult> => {
  if (process.platform === "linux") return installLinuxUpdate();
  if (process.platform === "win32") return installWindowsUpdate();

  return {
    ok: false,
    platform: process.platform,
    version: app.getVersion(),
    url: "https://its-ze.github.io/nightgrid-cyberdeck/",
    restartRequired: false,
    message: "Automatic updates are available for Linux AppImage and Windows setup builds only."
  };
};

const registerIpc = () => {
  ipcMain.handle("devices:list", async () => {
    const ports = await SerialPort.list();
    return ports.map(classifyPort).sort((a, b) => a.path.localeCompare(b.path));
  });

  ipcMain.handle("devices:connect", async (_, request: { path: string; baudRate: number; role: DeviceRole }) => {
    const existing = [...sessions.values()].find((session) => session.path === request.path);
    if (existing) return existing;

    const id = Buffer.from(`${request.path}:${Date.now()}`).toString("base64url");
    const session: LiveSession = {
      id,
      path: request.path,
      baudRate: request.baudRate,
      role: request.role,
      openedAt: now(),
      lineBuffer: "",
      displayBuffer: "",
      port: new SerialPort({
        path: request.path,
        baudRate: request.baudRate,
        autoOpen: false
      })
    };

    session.port.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      queueSerialDisplay(session, text);

      session.lineBuffer += text;
      const lines = session.lineBuffer.split(/\r?\n/);
      session.lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const gps = parseNmea(line, session);
        if (gps) sendToWindows("gps:fix", gps);
      }
    });

    session.port.on("error", (error) => {
      emitStatus({
        sessionId: session.id,
        path: session.path,
        status: "error",
        message: error.message
      });
    });

    session.port.on("close", () => {
      flushSerialDisplay(session);
      sessions.delete(session.id);
      emitStatus({
        sessionId: session.id,
        path: session.path,
        status: "disconnected",
        message: `${session.path} disconnected`
      });
    });

    await openSerialPort(session);
    sessions.set(id, session);
    emitStatus({
      sessionId: id,
      path: request.path,
      status: "connected",
      message: `${request.path} connected at ${request.baudRate}`
    });

    return {
      id: session.id,
      path: session.path,
      baudRate: session.baudRate,
      role: session.role,
      openedAt: session.openedAt
    } satisfies SerialSession;
  });

  ipcMain.handle("devices:disconnect", async (_, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    flushSerialDisplay(session);
    await closeSerialPort(session);
    sessions.delete(sessionId);
  });

  ipcMain.handle("devices:write", async (_, request: { sessionId: string; data: string }) => {
    const session = sessions.get(request.sessionId);
    if (!session) throw new Error("Serial session is not connected.");
    await writeSerialPort(session, request.data);
  });

  ipcMain.handle("devices:esp32-reset", async (_, request: { sessionId: string }) => {
    const session = sessions.get(request.sessionId);
    if (!session) throw new Error("ESP32 serial session is not connected.");
    await pulseEsp32Reset(session);
    emitStatus({
      sessionId: session.id,
      path: session.path,
      status: "message",
      message: `ESP32 reset signal sent to ${session.path}`
    });
  });

  ipcMain.handle("devices:esp32-bootloader", async (_, request: { sessionId: string }) => {
    const session = sessions.get(request.sessionId);
    if (!session) throw new Error("ESP32 serial session is not connected.");
    await enterEsp32Bootloader(session);
    emitStatus({
      sessionId: session.id,
      path: session.path,
      status: "message",
      message: `ESP32 bootloader signal sent to ${session.path}`
    });
  });

  ipcMain.handle("mesh:probe", async () => runMeshtastic([], 12000));
  ipcMain.handle("mesh:info", async (_, request: { path: string }) =>
    runMeshtastic(["--port", request.path, "--no-nodes", "--info"], 30000)
  );
  ipcMain.handle("mesh:nodes", async (_, request: { path: string }) =>
    runMeshtastic(["--port", request.path, "--nodes"], 45000)
  );
  ipcMain.handle("mesh:send-text", async (_, request: { path: string; message: string; channelIndex?: number }) => {
    const args = ["--port", request.path, "--sendtext", request.message];
    if (typeof request.channelIndex === "number" && Number.isFinite(request.channelIndex)) {
      args.push("--ch-index", String(request.channelIndex));
    }
    return runMeshtastic(args, 45000);
  });

  ipcMain.handle("gps:probe", async (_, request: { path: string; baudRates?: number[]; timeoutMs?: number }) => {
    if (!request?.path) throw new Error("GPS serial port is required.");
    const baudRates = (request.baudRates?.length ? request.baudRates : gpsProbeBaudRates)
      .map((baud) => Number(baud))
      .filter((baud) => Number.isFinite(baud) && baud > 0 && baud <= 921600)
      .slice(0, 6);
    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 2400, 800), 8000);
    return probeGpsPort(request.path, baudRates.length ? baudRates : gpsProbeBaudRates, timeoutMs);
  });

  ipcMain.handle("dongle:command", async (_, request: { path: string; command: DongleCommandPayload; timeoutMs?: number }) => {
    if (!request?.path) throw new Error("T-Dongle port is required.");
    if (!request.command || typeof request.command !== "object" || typeof request.command.cmd !== "string") {
      throw new Error("T-Dongle command must include a cmd string.");
    }
    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 3200, 800), 12000);
    return runDongleCommand(request.path, request.command, timeoutMs);
  });

  ipcMain.handle("system:platform", async () => ({
    platform: process.platform,
    version: app.getVersion()
  }));

  ipcMain.handle("system:install-update", async () => installLatestUpdate());

  ipcMain.handle("system:open-external", async (_, url: string) => {
    if (!url.startsWith("https://") && !url.startsWith("http://")) return;
    await shell.openExternal(url);
  });
};

const commandCandidates = () => {
  const candidates: { command: string; baseArgs: string[] }[] = [];
  const configuredPython = process.env.NIGHTGRID_MESHTASTIC_PYTHON;
  if (configuredPython) candidates.push({ command: configuredPython, baseArgs: ["-m", "meshtastic"] });

  const venvPython = meshtasticVenvPython();
  if (fs.existsSync(venvPython)) candidates.push({ command: venvPython, baseArgs: ["-m", "meshtastic"] });

  if (process.platform === "win32") {
    candidates.push(
      { command: "py", baseArgs: ["-m", "meshtastic"] },
      { command: "python", baseArgs: ["-m", "meshtastic"] },
      { command: "meshtastic", baseArgs: [] }
    );
    return candidates;
  }

  candidates.push(
    { command: "python3", baseArgs: ["-m", "meshtastic"] },
    { command: "python", baseArgs: ["-m", "meshtastic"] },
    { command: "meshtastic", baseArgs: [] }
  );
  return candidates;
};

const meshtasticInstallHint = () => {
  if (process.platform === "win32") {
    return [
      "Meshtastic CLI is not installed or is not visible to NightGrid.",
      "Install it with: py -m pip install --user meshtastic",
      "Then restart NightGrid."
    ].join("\n");
  }

  const venv = path.join(nightgridDataDir(), "meshtastic-venv");
  return [
    "Meshtastic CLI is not installed or is not visible to NightGrid.",
    "Run the NightGrid Linux installer again to create the managed CLI venv:",
    "  curl -fsSL https://its-ze.github.io/nightgrid-cyberdeck/install-linux.sh | bash",
    "Manual fallback:",
    `  python3 -m venv "${venv}"`,
    `  "${path.join(venv, "bin", "python")}" -m pip install --upgrade pip meshtastic`,
    "Then restart NightGrid."
  ].join("\n");
};

const isMissingMeshtastic = (result: CommandResult) => {
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return output.includes("no module named meshtastic") || output.includes("enoent");
};

const runProcess = (command: string, args: string[], timeoutMs: number) =>
  new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false
    });

    let stdout = "";
    let stderr = "";
    const displayCommand = [command, ...args].join(" ");
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        ok: false,
        command: displayCommand,
        code: null,
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs} ms.`.trim()
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command: displayCommand,
        code: null,
        stdout,
        stderr: error.message
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        command: displayCommand,
        code,
        stdout,
        stderr
      });
    });
  });

const runMeshtastic = async (args: string[], timeoutMs: number): Promise<CommandResult> => {
  const failures: string[] = [];
  for (const candidate of commandCandidates()) {
    const finalArgs = [...candidate.baseArgs, ...(args.length === 0 ? ["--version"] : args)];
    const result = await runProcess(candidate.command, finalArgs, timeoutMs);
    if (result.ok) return result;
    if (!isMissingMeshtastic(result)) return result;
    failures.push(`${result.command}\n${result.stderr || result.stdout || "Command failed."}`);
  }

  return {
    ok: false,
    command: "meshtastic probe",
    code: null,
    stdout: "",
    stderr: `${failures.join("\n\n")}\n\n${meshtasticInstallHint()}`
  };
};

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  for (const session of sessions.values()) {
    if (session.port.isOpen) {
      session.port.close();
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
