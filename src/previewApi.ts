import type {
  CommandResult,
  DevicePort,
  DeviceRole,
  GpsFix,
  NightGridApi,
  SerialEvent,
  SerialSession,
  SerialStatusEvent
} from "./types";

type Listener<T> = (event: T) => void;

const previewPorts: DevicePort[] = [
  {
    path: "/dev/ttyUSB0",
    friendlyName: "Heltec Wireless Stick V3 10C4:EA60",
    manufacturer: "Silicon Labs CP210x",
    vendorId: "10C4",
    productId: "EA60",
    suggestedRole: "heltec",
    tags: ["ESP32", "Heltec/Mesh", "CP210x"],
    isKnownBoard: true
  },
  {
    path: "/dev/ttyACM2",
    friendlyName: "Espressif Systems LILYGO ESP32-S3 T-Deck/T-Dongle 303A:1001",
    manufacturer: "Espressif Systems LILYGO ESP32-S3",
    vendorId: "303A",
    productId: "1001",
    suggestedRole: "tdeck",
    tags: ["LILYGO ESP32-S3", "T-Deck/T-Dongle", "USB serial"],
    isKnownBoard: true
  },
  {
    path: "/dev/ttyACM3",
    friendlyName: "LILYGO T-Dongle S3 USB serial 303A:1001",
    manufacturer: "LILYGO T-Dongle S3",
    vendorId: "303A",
    productId: "1001",
    suggestedRole: "tdongle",
    tags: ["T-Dongle", "ESP32-S3", "USB serial"],
    isKnownBoard: true
  },
  {
    path: "/dev/ttyACM0",
    friendlyName: "Raspberry Pi Pico 2E8A:0005",
    manufacturer: "Raspberry Pi",
    vendorId: "2E8A",
    productId: "0005",
    suggestedRole: "pico",
    tags: ["Pico"],
    isKnownBoard: true
  },
  {
    path: "/dev/ttyACM1",
    friendlyName: "Flipper Zero USB CLI 0483:5740",
    manufacturer: "Flipper Devices Inc.",
    vendorId: "0483",
    productId: "5740",
    suggestedRole: "flipper",
    tags: ["Flipper Zero", "CLI"],
    isKnownBoard: true
  },
  {
    path: "/dev/ttyUSB1",
    friendlyName: "u-blox GPS receiver 1546:01A8",
    manufacturer: "u-blox",
    vendorId: "1546",
    productId: "01A8",
    suggestedRole: "gps",
    tags: ["GPS", "NMEA"],
    isKnownBoard: true
  }
];

const result = (command: string, stdout: string): CommandResult => ({
  ok: true,
  command,
  code: 0,
  stdout,
  stderr: ""
});

export const createPreviewApi = (): NightGridApi => {
  const dataListeners = new Set<Listener<SerialEvent>>();
  const statusListeners = new Set<Listener<SerialStatusEvent>>();
  const gpsListeners = new Set<Listener<GpsFix>>();
  const sessions = new Map<string, SerialSession>();

  const emitStatus = (event: Omit<SerialStatusEvent, "at">) => {
    const payload = { ...event, at: new Date().toISOString() };
    statusListeners.forEach((listener) => listener(payload));
  };

  const emitData = (session: SerialSession, text: string) => {
    const payload: SerialEvent = {
      sessionId: session.id,
      path: session.path,
      role: session.role,
      text,
      at: new Date().toISOString()
    };
    dataListeners.forEach((listener) => listener(payload));
  };

  return {
    listDevices: async () => previewPorts,
    connectDevice: async ({ path, baudRate, role }: { path: string; baudRate: number; role: DeviceRole }) => {
      const session: SerialSession = {
        id: `preview-${path}`,
        path,
        baudRate,
        role,
        openedAt: new Date().toISOString()
      };
      sessions.set(session.id, session);
      emitStatus({ sessionId: session.id, path, status: "connected", message: `${path} connected in preview mode` });
      const greeting =
        role === "pico"
          ? "MicroPython v1.x on Raspberry Pi Pico\r\n>>>"
          : role === "flipper"
            ? "Flipper Zero CLI preview\r\n>: "
            : role === "tdongle"
              ? "T-Dongle USB serial preview ready\r\n"
            : role === "tdeck"
              ? "T-Deck / ESP32-S3 USB serial preview ready\r\n"
              : "NightGrid preview stream ready\r\n";
      emitData(session, greeting);
      if (role === "gps") {
        const fix: GpsFix = {
          sessionId: session.id,
          path,
          lat: 38.897957,
          lon: -77.03656,
          satellites: 9,
          altitudeMeters: 18.2,
          speedKnots: 0.3,
          fixQuality: "Fix 1",
          utcTime: "162500",
          raw: "$GPGGA,162500,3853.8774,N,07702.1936,W,1,09,0.9,18.2,M,0.0,M,,",
          updatedAt: new Date().toISOString()
        };
        gpsListeners.forEach((listener) => listener(fix));
      }
      return session;
    },
    disconnectDevice: async (sessionId: string) => {
      const session = sessions.get(sessionId);
      sessions.delete(sessionId);
      emitStatus({
        sessionId,
        path: session?.path,
        status: "disconnected",
        message: `${session?.path ?? "preview session"} disconnected`
      });
    },
    writeDevice: async ({ sessionId, data }: { sessionId: string; data: string }) => {
      const session = sessions.get(sessionId);
      if (session) emitData(session, `echo: ${data}`);
    },
    probeMeshCli: async () => result("meshtastic --version", "Meshtastic CLI preview available\n"),
    meshInfo: async ({ path }: { path: string }) =>
      result(`meshtastic --port ${path} --info`, "Preview mesh radio\nhardware: Heltec V3 or T-Deck / ESP32-S3\nfirmware: meshtastic\nrole: CLIENT\n"),
    meshNodes: async ({ path }: { path: string }) =>
      result(`meshtastic --port ${path} --nodes`, "!preview Node, last heard now, SNR 8.5\n"),
    meshSendText: async ({ path, message }: { path: string; message: string; channelIndex?: number }) =>
      result(`meshtastic --port ${path} --sendtext ${message}`, "Preview message queued\n"),
    getPlatform: async () => ({ platform: "browser" as NodeJS.Platform, version: "preview" }),
    installUpdate: async () => ({
      ok: true,
      platform: "browser" as NodeJS.Platform,
      version: "preview",
      restartRequired: false,
      url: "https://its-ze.github.io/nightgrid-cyberdeck/",
      message: "Preview updater ready. The installed app uses this button to update itself."
    }),
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onSerialData: (callback: Listener<SerialEvent>) => {
      dataListeners.add(callback);
      return () => dataListeners.delete(callback);
    },
    onSerialStatus: (callback: Listener<SerialStatusEvent>) => {
      statusListeners.add(callback);
      return () => statusListeners.delete(callback);
    },
    onGpsFix: (callback: Listener<GpsFix>) => {
      gpsListeners.add(callback);
      return () => gpsListeners.delete(callback);
    }
  };
};
