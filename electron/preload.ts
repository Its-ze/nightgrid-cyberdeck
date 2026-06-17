import { contextBridge, ipcRenderer } from "electron";
import type {
  CommandResult,
  DevicePort,
  DeviceRole,
  DongleCommandPayload,
  GpsFix,
  NightGridApi,
  SerialEvent,
  SerialSession,
  SerialStatusEvent,
  UpdateResult
} from "../src/types";

const on = <T>(channel: string, callback: (event: T) => void) => {
  const handler = (_: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: NightGridApi = {
  listDevices: () => ipcRenderer.invoke("devices:list") as Promise<DevicePort[]>,
  connectDevice: (request: { path: string; baudRate: number; role: DeviceRole }) =>
    ipcRenderer.invoke("devices:connect", request) as Promise<SerialSession>,
  disconnectDevice: (sessionId: string) => ipcRenderer.invoke("devices:disconnect", sessionId) as Promise<void>,
  writeDevice: (request: { sessionId: string; data: string }) =>
    ipcRenderer.invoke("devices:write", request) as Promise<void>,
  probeMeshCli: () => ipcRenderer.invoke("mesh:probe") as Promise<CommandResult>,
  meshInfo: (request: { path: string }) => ipcRenderer.invoke("mesh:info", request) as Promise<CommandResult>,
  meshNodes: (request: { path: string }) => ipcRenderer.invoke("mesh:nodes", request) as Promise<CommandResult>,
  meshSendText: (request: { path: string; message: string; channelIndex?: number }) =>
    ipcRenderer.invoke("mesh:send-text", request) as Promise<CommandResult>,
  probeGps: (request: { path: string; baudRates?: number[]; timeoutMs?: number }) =>
    ipcRenderer.invoke("gps:probe", request) as Promise<CommandResult>,
  dongleCommand: (request: { path: string; command: DongleCommandPayload; timeoutMs?: number }) =>
    ipcRenderer.invoke("dongle:command", request) as Promise<CommandResult>,
  getPlatform: () => ipcRenderer.invoke("system:platform") as Promise<{ platform: NodeJS.Platform; version: string }>,
  installUpdate: () => ipcRenderer.invoke("system:install-update") as Promise<UpdateResult>,
  openExternal: (url: string) => ipcRenderer.invoke("system:open-external", url) as Promise<void>,
  onSerialData: (callback: (event: SerialEvent) => void) => on("serial:data", callback),
  onSerialStatus: (callback: (event: SerialStatusEvent) => void) => on("serial:status", callback),
  onGpsFix: (callback: (event: GpsFix) => void) => on("gps:fix", callback)
};

contextBridge.exposeInMainWorld("nightgrid", api);
