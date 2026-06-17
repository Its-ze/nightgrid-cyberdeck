export type DeviceRole = "heltec" | "tdeck" | "tdongle" | "esp32" | "gps" | "pico" | "flipper" | "console";

export interface DevicePort {
  path: string;
  friendlyName: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  pnpId?: string;
  suggestedRole: DeviceRole;
  tags: string[];
  isKnownBoard: boolean;
}

export interface SerialSession {
  id: string;
  path: string;
  baudRate: number;
  role: DeviceRole;
  openedAt: string;
}

export interface SerialEvent {
  sessionId: string;
  path: string;
  role: DeviceRole;
  text: string;
  at: string;
}

export interface SerialStatusEvent {
  sessionId?: string;
  path?: string;
  status: "connected" | "disconnected" | "error" | "message";
  message: string;
  at: string;
}

export interface GpsFix {
  sessionId: string;
  path: string;
  lat?: number;
  lon?: number;
  altitudeMeters?: number;
  speedKnots?: number;
  satellites?: number;
  fixQuality?: string;
  utcTime?: string;
  raw: string;
  updatedAt: string;
}

export interface CommandResult {
  ok: boolean;
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface WarDriveRecord {
  id: string;
  seenAt: string;
  nodeId: string;
  nodeName?: string;
  meshPath: string;
  raw: string;
  gpsPath?: string;
  lat?: number;
  lon?: number;
  altitudeMeters?: number;
  satellites?: number;
  gpsStatus: string;
  gpsFixAgeMs?: number;
  cliCommand?: string;
}

export interface WarDriveSaveResult {
  ok: boolean;
  count: number;
  directory: string;
  jsonlPath: string;
  csvPath: string;
  message: string;
}

export type DongleCommandPayload = {
  cmd: string;
  [key: string]: string | number | boolean | undefined;
};

export interface UpdateResult {
  ok: boolean;
  platform: NodeJS.Platform;
  version: string;
  message: string;
  target?: string;
  url?: string;
  restartRequired: boolean;
}

export interface NightGridApi {
  listDevices: () => Promise<DevicePort[]>;
  connectDevice: (request: { path: string; baudRate: number; role: DeviceRole }) => Promise<SerialSession>;
  disconnectDevice: (sessionId: string) => Promise<void>;
  writeDevice: (request: { sessionId: string; data: string }) => Promise<void>;
  esp32Reset: (request: { sessionId: string }) => Promise<void>;
  esp32Bootloader: (request: { sessionId: string }) => Promise<void>;
  probeMeshCli: () => Promise<CommandResult>;
  meshInfo: (request: { path: string }) => Promise<CommandResult>;
  meshNodes: (request: { path: string }) => Promise<CommandResult>;
  meshSendText: (request: { path: string; message: string; channelIndex?: number }) => Promise<CommandResult>;
  saveWarDriveLog: (request: { records: WarDriveRecord[] }) => Promise<WarDriveSaveResult>;
  probeGps: (request: { path: string; baudRates?: number[]; timeoutMs?: number }) => Promise<CommandResult>;
  dongleCommand: (request: { path: string; command: DongleCommandPayload; timeoutMs?: number }) => Promise<CommandResult>;
  getPlatform: () => Promise<{ platform: NodeJS.Platform; version: string }>;
  installUpdate: () => Promise<UpdateResult>;
  openExternal: (url: string) => Promise<void>;
  onSerialData: (callback: (event: SerialEvent) => void) => () => void;
  onSerialStatus: (callback: (event: SerialStatusEvent) => void) => () => void;
  onGpsFix: (callback: (event: GpsFix) => void) => () => void;
}

declare global {
  interface Window {
    nightgrid: NightGridApi;
  }
}
