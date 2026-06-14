import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import { SerialPort } from "serialport";
import type {
  CommandResult,
  DevicePort,
  DeviceRole,
  GpsFix,
  SerialEvent,
  SerialSession,
  SerialStatusEvent
} from "../src/types";

type ListedPort = Awaited<ReturnType<typeof SerialPort.list>>[number];

interface LiveSession extends SerialSession {
  port: SerialPort;
  lineBuffer: string;
}

const sessions = new Map<string, LiveSession>();

const now = () => new Date().toISOString();

const sendToWindows = (channel: string, payload: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

const emitStatus = (event: Omit<SerialStatusEvent, "at">) => {
  sendToWindows("serial:status", { ...event, at: now() });
};

const normalizeUsbId = (value?: string) => value?.toUpperCase().padStart(4, "0");

const classifyPort = (port: ListedPort): DevicePort => {
  const manufacturer = port.manufacturer ?? "";
  const listedName = "friendlyName" in port && typeof port.friendlyName === "string" ? port.friendlyName : "";
  const vendorId = normalizeUsbId(port.vendorId);
  const productId = normalizeUsbId(port.productId);
  const pnpId = port.pnpId ?? "";
  const haystack = `${manufacturer} ${listedName} ${port.path} ${pnpId} ${vendorId ?? ""}:${productId ?? ""}`.toLowerCase();
  const tags: string[] = [];
  let suggestedRole: DeviceRole = "console";

  const isTDeck =
    haystack.includes("t-deck") ||
    haystack.includes("tdeck") ||
    haystack.includes("lilygo t-deck") ||
    (vendorId === "303A" && productId === "1001");
  const isFlipper = haystack.includes("flipper") || (vendorId === "0483" && productId === "5740");

  if (isTDeck) {
    tags.push("T-Deck", "ESP32-S3", "Meshtastic");
    suggestedRole = "tdeck";
  } else if (isFlipper) {
    tags.push("Flipper Zero", "CLI");
    suggestedRole = "flipper";
  } else if (haystack.includes("heltec") || haystack.includes("cp210") || haystack.includes("esp32") || vendorId === "303A") {
    tags.push("ESP32", "Heltec/Mesh");
    suggestedRole = "heltec";
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
      port: new SerialPort({
        path: request.path,
        baudRate: request.baudRate,
        autoOpen: false
      })
    };

    session.port.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const serialEvent: SerialEvent = {
        sessionId: session.id,
        path: session.path,
        role: session.role,
        text,
        at: now()
      };
      sendToWindows("serial:data", serialEvent);

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
    await closeSerialPort(session);
    sessions.delete(sessionId);
  });

  ipcMain.handle("devices:write", async (_, request: { sessionId: string; data: string }) => {
    const session = sessions.get(request.sessionId);
    if (!session) throw new Error("Serial session is not connected.");
    await writeSerialPort(session, request.data);
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

  ipcMain.handle("system:platform", async () => ({
    platform: process.platform,
    version: app.getVersion()
  }));

  ipcMain.handle("system:open-external", async (_, url: string) => {
    if (!url.startsWith("https://") && !url.startsWith("http://")) return;
    await shell.openExternal(url);
  });
};

const commandCandidates = () => {
  if (process.platform === "win32") {
    return [
      { command: "py", baseArgs: ["-m", "meshtastic"] },
      { command: "python", baseArgs: ["-m", "meshtastic"] },
      { command: "meshtastic", baseArgs: [] }
    ];
  }

  return [
    { command: "python3", baseArgs: ["-m", "meshtastic"] },
    { command: "python", baseArgs: ["-m", "meshtastic"] },
    { command: "meshtastic", baseArgs: [] }
  ];
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
    failures.push(`${result.command}\n${result.stderr || result.stdout || "Command failed."}`);
  }

  return {
    ok: false,
    command: "meshtastic probe",
    code: null,
    stdout: "",
    stderr: failures.join("\n\n")
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
