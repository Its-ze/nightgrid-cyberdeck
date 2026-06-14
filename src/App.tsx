import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cable,
  Cpu,
  Crosshair,
  Download,
  MapPin,
  Plug,
  Power,
  Radio,
  RefreshCw,
  Satellite,
  Send,
  ShieldCheck,
  Terminal,
  Usb
} from "lucide-react";
import { createPreviewApi } from "./previewApi";
import type {
  CommandResult,
  DevicePort,
  DeviceRole,
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

const baudRates = [9600, 38400, 57600, 115200, 230400, 460800, 921600];

const roleLabels: Record<DeviceRole, string> = {
  heltec: "Heltec mesh",
  tdeck: "T-Deck mesh",
  gps: "GPS NMEA",
  pico: "Pico console",
  flipper: "Flipper Zero",
  console: "Serial console"
};

const roleIcons: Record<DeviceRole, typeof Radio> = {
  heltec: Radio,
  tdeck: Radio,
  gps: Satellite,
  pico: Cpu,
  flipper: Cpu,
  console: Terminal
};

const defaultBaud = (role: DeviceRole) => (role === "gps" ? 9600 : 115200);

const isMeshRole = (role?: DeviceRole) => role === "heltec" || role === "tdeck";

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(iso));

const formatCoord = (value?: number) => (typeof value === "number" ? value.toFixed(6) : "No fix");

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
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null);
  const [serialInput, setSerialInput] = useState("");
  const [lineEnding, setLineEnding] = useState<"none" | "lf" | "crlf">("lf");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [meshBusy, setMeshBusy] = useState(false);
  const [meshOutput, setMeshOutput] = useState("Meshtastic CLI output will appear here.");
  const [meshMessage, setMeshMessage] = useState("");
  const [meshChannel, setMeshChannel] = useState("0");
  const [meshPath, setMeshPath] = useState("");
  const [platform, setPlatform] = useState<{ platform: NodeJS.Platform; version: string } | null>(null);
  const logCounter = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];
  const connectedPaths = new Set(sessions.map((session) => session.path));
  const meshPorts = ports.filter((port) => isMeshRole(port.suggestedRole) || isMeshRole(roleByPath[port.path]));

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

  const refreshDevices = async () => {
    setIsRefreshing(true);
    try {
      const nextPorts = await api.listDevices();
      setPorts(nextPorts);
      setRoleByPath((current) => {
        const next = { ...current };
        for (const port of nextPorts) {
          next[port.path] ??= port.suggestedRole;
        }
        return next;
      });
      setBaudByPath((current) => {
        const next = { ...current };
        for (const port of nextPorts) {
          next[port.path] ??= defaultBaud(port.suggestedRole);
        }
        return next;
      });
      if (!meshPath) {
        const meshPort = nextPorts.find((port) => isMeshRole(port.suggestedRole));
        if (meshPort) setMeshPath(meshPort.path);
      }
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        text: `Scanned ${nextPorts.length} serial port${nextPorts.length === 1 ? "" : "s"}.`
      });
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

  const connectPort = async (port: DevicePort) => {
    const role = roleByPath[port.path] ?? port.suggestedRole;
    const baudRate = baudByPath[port.path] ?? defaultBaud(role);
    try {
      const session = await api.connectDevice({ path: port.path, baudRate, role });
      setSessions((current) => (current.some((item) => item.id === session.id) ? current : [...current, session]));
      setSelectedSessionId(session.id);
    } catch (error) {
      addLog({
        channel: "status",
        at: new Date().toISOString(),
        path: port.path,
        role,
        text: error instanceof Error ? error.message : "Connection failed."
      });
    }
  };

  const disconnectSession = async (sessionId: string) => {
    await api.disconnectDevice(sessionId);
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    if (selectedSessionId === sessionId) setSelectedSessionId("");
  };

  const writeSelected = async (data?: string) => {
    if (!selectedSession) return;
    const suffix = lineEnding === "crlf" ? "\r\n" : lineEnding === "lf" ? "\n" : "";
    const payload = data ?? `${serialInput}${suffix}`;
    if (!payload) return;
    await api.writeDevice({ sessionId: selectedSession.id, data: payload });
    addLog({
      channel: "tx",
      at: new Date().toISOString(),
      path: selectedSession.path,
      role: selectedSession.role,
      text: payload
    });
    if (!data) setSerialInput("");
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
        setSessions((current) => current.filter((session) => session.id !== event.sessionId));
      }
    });

    const offGps = api.onGpsFix((event: GpsFix) => {
      setGpsFix(event);
    });

    return () => {
      offData();
      offStatus();
      offGps();
    };
  }, [api]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">USB field console</p>
          <h1>NightGrid Cyberdeck</h1>
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
          <button className="icon-button primary" onClick={refreshDevices} disabled={isRefreshing}>
            <RefreshCw size={18} className={isRefreshing ? "spin" : ""} />
            Scan
          </button>
        </div>
      </header>

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
                  <article className={`device-card ${connected ? "connected" : ""}`} key={port.path}>
                    <div className="device-main">
                      <RoleIcon size={20} />
                      <div>
                        <h3>{port.path}</h3>
                        <p>{port.friendlyName || port.manufacturer}</p>
                      </div>
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

          <div className="terminal-window" ref={logRef}>
            {logs.length === 0 ? (
              <p className="terminal-muted">Waiting for traffic.</p>
            ) : (
              logs.map((entry) => (
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
              <Metric label="Altitude" value={gpsFix?.altitudeMeters ? `${gpsFix.altitudeMeters.toFixed(1)} m` : "Unknown"} />
              <Metric label="Speed" value={gpsFix?.speedKnots ? `${gpsFix.speedKnots.toFixed(1)} kt` : "Unknown"} />
              <Metric label="Status" value={gpsFix?.fixQuality ?? "Waiting"} />
            </div>
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
