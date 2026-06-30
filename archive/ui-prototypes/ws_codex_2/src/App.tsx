import {
  Activity,
  Bot,
  ChevronRight,
  CirclePower,
  Command,
  Gauge,
  HardDrive,
  Home,
  MessageSquare,
  Mic,
  Monitor,
  Network,
  Pause,
  Play,
  RefreshCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Volume2,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

type HostStatus = "online" | "sleeping" | "warning";
type ServiceState = "running" | "stopped" | "degraded";
type MobileView = "hosts" | "services" | "agent" | "activity";

type Service = {
  id: string;
  name: string;
  kind: string;
  port: number;
  state: ServiceState;
  endpoint: string;
  note: string;
};

type Host = {
  id: string;
  name: string;
  role: string;
  os: string;
  address: string;
  lan: string;
  status: HostStatus;
  latency: number | null;
  uptime: string;
  cpu: number;
  memory: number;
  storage: number;
  tags: string[];
  services: Service[];
};

type LogEntry = {
  id: number;
  time: string;
  target: string;
  action: string;
  state: "done" | "pending" | "blocked";
};

type Message = {
  id: number;
  sender: "you" | "agent";
  text: string;
};

const hosts: Host[] = [
  {
    id: "corsair",
    name: "corsair",
    role: "Windows workstation",
    os: "Windows 11",
    address: "corsair.tailnet",
    lan: "192.168.1.42",
    status: "online",
    latency: 22,
    uptime: "6h 14m",
    cpu: 38,
    memory: 61,
    storage: 74,
    tags: ["gpu", "desktop", "voice"],
    services: [
      {
        id: "kobold",
        name: "KoboldCPP",
        kind: "LLM",
        port: 5001,
        state: "running",
        endpoint: "http://corsair:5001/api/v1/generate",
        note: "Local command drafting and chat fallback",
      },
      {
        id: "sd",
        name: "Stable Diffusion WebUI",
        kind: "Images",
        port: 7860,
        state: "stopped",
        endpoint: "http://corsair:7860",
        note: "Started on demand when GPU is free",
      },
      {
        id: "wol",
        name: "ctrl-b Flask",
        kind: "Control",
        port: 5432,
        state: "running",
        endpoint: "http://corsair:5432",
        note: "Legacy control plane",
      },
    ],
  },
  {
    id: "vault",
    name: "vault",
    role: "Linux storage",
    os: "Debian",
    address: "vault.tailnet",
    lan: "192.168.1.16",
    status: "online",
    latency: 31,
    uptime: "14d 9h",
    cpu: 12,
    memory: 44,
    storage: 82,
    tags: ["nas", "backups"],
    services: [
      {
        id: "smb",
        name: "SMB shares",
        kind: "Files",
        port: 445,
        state: "running",
        endpoint: "smb://vault",
        note: "Project storage and media staging",
      },
      {
        id: "searxng",
        name: "SearXNG MCP",
        kind: "Search",
        port: 8080,
        state: "running",
        endpoint: "http://vault:8080",
        note: "Private search connector for the agent",
      },
    ],
  },
  {
    id: "g5",
    name: "g5",
    role: "Linux compute",
    os: "Ubuntu",
    address: "g5.tailnet",
    lan: "192.168.1.27",
    status: "warning",
    latency: 58,
    uptime: "2d 3h",
    cpu: 76,
    memory: 69,
    storage: 48,
    tags: ["compute", "lab"],
    services: [
      {
        id: "docker",
        name: "Docker daemon",
        kind: "Runtime",
        port: 2375,
        state: "degraded",
        endpoint: "unix:///var/run/docker.sock",
        note: "Two containers are restarting",
      },
      {
        id: "metrics",
        name: "Node exporter",
        kind: "Metrics",
        port: 9100,
        state: "running",
        endpoint: "http://g5:9100",
        note: "Host metrics collector",
      },
    ],
  },
  {
    id: "emma",
    name: "emma",
    role: "Windows laptop",
    os: "Windows 11",
    address: "emma.tailnet",
    lan: "192.168.1.63",
    status: "sleeping",
    latency: null,
    uptime: "asleep",
    cpu: 0,
    memory: 0,
    storage: 57,
    tags: ["portable", "wakeable"],
    services: [
      {
        id: "rdp",
        name: "Remote Desktop",
        kind: "Access",
        port: 3389,
        state: "stopped",
        endpoint: "rdp://emma",
        note: "Available after wake",
      },
    ],
  },
];

const initialLog: LogEntry[] = [
  { id: 1, time: "20:12", target: "corsair", action: "Checked KoboldCPP health", state: "done" },
  { id: 2, time: "20:09", target: "vault", action: "Confirmed SearXNG MCP", state: "done" },
  { id: 3, time: "20:05", target: "g5", action: "Docker restart needs approval", state: "blocked" },
  { id: 4, time: "19:58", target: "emma", action: "Wake packet queued", state: "pending" },
];

const navItems = [
  { id: "hosts" as MobileView, label: "Hosts", icon: Home },
  { id: "services" as MobileView, label: "Services", icon: Server },
  { id: "agent" as MobileView, label: "Agent", icon: Bot },
  { id: "activity" as MobileView, label: "Activity", icon: Activity },
];

function App() {
  const [selectedHostId, setSelectedHostId] = useState(hosts[0].id);
  const [mobileView, setMobileView] = useState<MobileView>("hosts");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      sender: "agent",
      text: "Ready. I can check hosts, prepare service actions, or explain what is failing before you approve anything.",
    },
  ]);
  const [logs, setLogs] = useState(initialLog);

  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? hosts[0],
    [selectedHostId],
  );

  const services = hosts.flatMap((host) =>
    host.services.map((service) => ({
      ...service,
      host: host.name,
      hostStatus: host.status,
    })),
  );

  const onlineCount = hosts.filter((host) => host.status === "online").length;
  const runningCount = services.filter((service) => service.state === "running").length;

  function pushLog(target: string, action: string, state: LogEntry["state"] = "pending") {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setLogs((current) => [{ id: Date.now(), time: stamp, target, action, state }, ...current]);
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setMessages((current) => [
      ...current,
      { id: Date.now(), sender: "you", text },
      {
        id: Date.now() + 1,
        sender: "agent",
        text: `I would turn "${text}" into a typed action plan first, then ask for confirmation before touching a host.`,
      },
    ]);
    pushLog("agent", "Prepared typed action plan", "done");
    setDraft("");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-row">
          <img src="/logo.png" alt="ctrl-b" />
          <div>
            <strong>ctrl-b</strong>
            <span>tailnet console</span>
          </div>
        </div>

        <nav className="nav-stack">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={mobileView === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setMobileView(item.id)}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <ShieldCheck size={17} />
          <div>
            <strong>Tailscale only</strong>
            <span>No public ports</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Servers</h1>
            <p>
              {onlineCount}/{hosts.length} online, {runningCount} services running
            </p>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} />
              <input placeholder="Search host, service, port" />
            </label>
            <button className="icon-button" aria-label="Refresh statuses" onClick={() => pushLog("all", "Manual refresh", "done")}>
              <RefreshCcw size={18} />
            </button>
            <button className="icon-button" aria-label="Settings">
              <Settings size={18} />
            </button>
          </div>
        </header>

        <section className={`content-grid view-${mobileView}`}>
          <section className="panel hosts-panel" aria-label="Hosts">
            <div className="panel-heading">
              <h2>Hosts</h2>
              <button onClick={() => pushLog("tailnet", "Discovery scan started")}>Scan</button>
            </div>
            <div className="host-list">
              {hosts.map((host) => (
                <button
                  key={host.id}
                  className={selectedHost.id === host.id ? "host-row selected" : "host-row"}
                  onClick={() => {
                    setSelectedHostId(host.id);
                    setMobileView("services");
                  }}
                >
                  <span className={`status-mark ${host.status}`} aria-hidden="true" />
                  <span className="host-main">
                    <strong>{host.name}</strong>
                    <span>{host.role}</span>
                  </span>
                  <span className="host-meta">
                    <span>{host.address}</span>
                    <span>{host.latency ? `${host.latency} ms` : "offline"}</span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </section>

          <section className="panel services-panel" aria-label="Services">
            <div className="panel-heading">
              <h2>{selectedHost.name}</h2>
              <div className="segmented">
                <button className="active">Services</button>
                <button>Logs</button>
              </div>
            </div>

            <div className="host-summary">
              <Metric icon={Monitor} label="OS" value={selectedHost.os} />
              <Metric icon={Network} label="Route" value={selectedHost.address} />
              <Metric icon={Gauge} label="CPU" value={`${selectedHost.cpu}%`} meter={selectedHost.cpu} />
              <Metric icon={HardDrive} label="Storage" value={`${selectedHost.storage}%`} meter={selectedHost.storage} />
            </div>

            <div className="service-table" role="table" aria-label="Services on selected host">
              <div className="service-head" role="row">
                <span>Service</span>
                <span>Port</span>
                <span>State</span>
                <span>Action</span>
              </div>
              {selectedHost.services.map((service) => (
                <div className="service-row" role="row" key={service.id}>
                  <span>
                    <strong>{service.name}</strong>
                    <em>{service.note}</em>
                  </span>
                  <span>{service.port}</span>
                  <span className={`state-text ${service.state}`}>{service.state}</span>
                  <span className="row-actions">
                    <button
                      aria-label={`Start ${service.name}`}
                      onClick={() => pushLog(selectedHost.name, `Start ${service.name}`)}
                    >
                      <Play size={15} />
                    </button>
                    <button
                      aria-label={`Pause ${service.name}`}
                      onClick={() => pushLog(selectedHost.name, `Stop ${service.name}`)}
                    >
                      <Pause size={15} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel agent-panel" aria-label="Agent">
            <div className="panel-heading">
              <h2>Agent</h2>
              <div className="agent-toggles">
                <button className={!voiceEnabled ? "active" : ""} onClick={() => setVoiceEnabled(false)}>
                  <MessageSquare size={15} />
                  Text
                </button>
                <button className={voiceEnabled ? "active" : ""} onClick={() => setVoiceEnabled(true)}>
                  <Mic size={15} />
                  Voice
                </button>
              </div>
            </div>

            <div className="message-list">
              {messages.map((message) => (
                <div key={message.id} className={`message ${message.sender}`}>
                  {message.text}
                </div>
              ))}
            </div>

            <form className="agent-input" onSubmit={submitMessage}>
              <button
                type="button"
                className={voiceEnabled ? "voice-button recording" : "voice-button"}
                aria-label="Push to talk"
                onClick={() => {
                  setVoiceEnabled(true);
                  pushLog("agent", "Voice capture opened");
                }}
              >
                {voiceEnabled ? <Volume2 size={18} /> : <Mic size={18} />}
              </button>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask about hosts or prepare an action"
              />
              <button type="submit" aria-label="Send message">
                <Command size={17} />
              </button>
            </form>
          </section>

          <section className="panel activity-panel" aria-label="Activity">
            <div className="panel-heading">
              <h2>Activity</h2>
              <button onClick={() => setLogs([])}>Clear</button>
            </div>
            <div className="activity-list">
              {logs.map((entry) => (
                <div key={entry.id} className="activity-row">
                  <span>{entry.time}</span>
                  <strong>{entry.target}</strong>
                  <p>{entry.action}</p>
                  <em className={entry.state}>{entry.state}</em>
                </div>
              ))}
            </div>
          </section>
        </section>
      </main>

      <aside className="inspector" aria-label="Selected host detail">
        <div className="inspector-card">
          <span className={`status-mark large ${selectedHost.status}`} />
          <h2>{selectedHost.name}</h2>
          <p>{selectedHost.role}</p>
          <dl>
            <div>
              <dt>MagicDNS</dt>
              <dd>{selectedHost.address}</dd>
            </div>
            <div>
              <dt>LAN IP</dt>
              <dd>{selectedHost.lan}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{selectedHost.uptime}</dd>
            </div>
          </dl>
          <div className="tag-list">
            {selectedHost.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <div className="inspector-actions">
            <button onClick={() => pushLog(selectedHost.name, "Wake packet sent")}>
              <CirclePower size={16} />
              Wake
            </button>
            <button onClick={() => pushLog(selectedHost.name, "Terminal session requested")}>
              <SquareTerminal size={16} />
              Shell
            </button>
          </div>
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={mobileView === item.id ? "active" : ""}
              onClick={() => setMobileView(item.id)}
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  meter,
}: {
  icon: typeof Monitor;
  label: string;
  value: string;
  meter?: number;
}) {
  return (
    <div className="metric">
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof meter === "number" ? (
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${meter}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export default App;
