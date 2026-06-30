// In-memory mock backed by the owner's real fleet (corsair, vault, g5, emma).
// It mutates local state so wake/shutdown/start/stop feel live while the UI is
// being designed, and jitters metrics so polling visibly updates. Replace with
// an HTTP client implementing CtrlbApi — see client.ts.

import type { AgentReply, CtrlbApi } from "./client";
import type {
  ActivityEvent,
  Host,
  Project,
  Service,
  ToolCall,
} from "../types";

const now = () => new Date().toISOString();
const id = () => Math.random().toString(36).slice(2, 10);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const projects: Project[] = [
  { id: "core", name: "Homelab core", description: "Storage, web services, search", accent: "var(--accent)" },
  { id: "ai", name: "AI / inference", description: "GPU workloads, model serving", accent: "var(--violet)" },
  { id: "desk", name: "Workstations", description: "On-demand desktops", accent: "var(--amber)" },
];

let hosts: Host[] = [
  {
    id: "corsair", name: "corsair", role: "Inference / GPU", os: "windows", projectId: "ai",
    magicDnsName: "corsair", lanIp: "192.168.1.20", tailscaleIp: "100.74.123.22",
    status: "online", metrics: { cpu: 18, memory: 41, gpu: 87, uptimeSeconds: 320_400 },
    tags: ["gpu", "koboldcpp", "sd-webui"], lastSeen: now(),
  },
  {
    id: "vault", name: "vault", role: "Storage / NAS", os: "linux", projectId: "core",
    magicDnsName: "vault", lanIp: "192.168.1.21", tailscaleIp: "100.87.43.22",
    status: "online", metrics: { cpu: 6, memory: 33, uptimeSeconds: 1_820_400 },
    tags: ["storage", "backups", "smb"], lastSeen: now(),
  },
  {
    id: "emma", name: "emma", role: "Services / Web", os: "linux", projectId: "core",
    magicDnsName: "emma", lanIp: "192.168.1.23", tailscaleIp: "100.99.2.8",
    status: "warning", metrics: { cpu: 71, memory: 88, uptimeSeconds: 90_400 },
    tags: ["searxng", "web", "docker"], lastSeen: now(),
  },
  {
    id: "g5", name: "g5", role: "Workstation", os: "windows", projectId: "desk",
    magicDnsName: "g5", lanIp: "192.168.1.22", tailscaleIp: "100.65.10.4",
    status: "sleeping", metrics: {}, tags: ["desktop", "wol"], lastSeen: ago(42),
  },
];

let services: Service[] = [
  {
    id: "kobold", hostId: "corsair", name: "KoboldCpp", kind: "llm", state: "running",
    port: 5001, endpoint: "http://corsair:5001",
    actions: [
      { id: "restart", label: "Restart", type: "restart_service", risk: "medium" },
      { id: "stop", label: "Stop", type: "stop_service", risk: "medium" },
      { id: "switch", label: "Switch model", type: "switch_gpu_workload", risk: "medium" },
    ],
  },
  {
    id: "sdwebui", hostId: "corsair", name: "SD WebUI", kind: "media", state: "stopped",
    port: 7860,
    actions: [
      { id: "start", label: "Start", type: "start_service", risk: "low" },
      { id: "switch", label: "Take GPU", type: "switch_gpu_workload", risk: "medium" },
    ],
  },
  {
    id: "searxng", hostId: "emma", name: "SearXNG", kind: "search", state: "degraded",
    port: 8080, endpoint: "http://emma:8080",
    actions: [
      { id: "restart", label: "Restart", type: "restart_service", risk: "medium" },
      { id: "health", label: "Health check", type: "run_health_check", risk: "low" },
    ],
  },
  {
    id: "caddy", hostId: "emma", name: "Caddy", kind: "web", state: "running",
    port: 443, endpoint: "https://emma",
    actions: [
      { id: "restart", label: "Restart", type: "restart_service", risk: "medium" },
      { id: "health", label: "Health check", type: "run_health_check", risk: "low" },
    ],
  },
  {
    id: "nas", hostId: "vault", name: "SMB shares", kind: "system", state: "running",
    port: 445,
    actions: [{ id: "health", label: "Health check", type: "run_health_check", risk: "low" }],
  },
  {
    id: "backups", hostId: "vault", name: "Restic backups", kind: "system", state: "running",
    actions: [{ id: "health", label: "Run now", type: "run_health_check", risk: "low" }],
  },
];

let events: ActivityEvent[] = [
  { id: id(), ts: now(), source: "status", level: "warning", target: "emma", message: "Memory at 88% — SearXNG degraded" },
  { id: id(), ts: ago(6), source: "status", level: "info", target: "g5", message: "Host went to sleep" },
  { id: id(), ts: ago(30), source: "user", level: "success", target: "corsair", message: "KoboldCpp restarted" },
  { id: id(), ts: ago(95), source: "agent", level: "success", target: "vault", message: "Health check passed (6/6 shares)" },
];

const hostName = (hostId?: string) => hosts.find((h) => h.id === hostId)?.name ?? hostId ?? "?";

function pushEvent(e: Omit<ActivityEvent, "id" | "ts">): ActivityEvent {
  const full: ActivityEvent = { ...e, id: id(), ts: now() };
  events = [full, ...events].slice(0, 120);
  return full;
}

const jitter = (v?: number) =>
  v == null ? v : Math.max(0, Math.min(100, Math.round(v + (Math.random() * 10 - 5))));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const mockApi: CtrlbApi = {
  async listProjects() {
    await delay(60);
    return structuredClone(projects);
  },

  async listHosts() {
    await delay(180);
    hosts = hosts.map((h) =>
      h.status === "online" || h.status === "warning"
        ? { ...h, metrics: { ...h.metrics, cpu: jitter(h.metrics.cpu), gpu: jitter(h.metrics.gpu) }, lastSeen: now() }
        : h,
    );
    return structuredClone(hosts);
  },

  async listServices() {
    await delay(120);
    return structuredClone(services);
  },

  async listEvents() {
    await delay(100);
    return structuredClone(events);
  },

  async runHostAction(hostId, action) {
    await delay(500);
    const host = hosts.find((h) => h.id === hostId);
    if (host) {
      if (action === "wake_host") {
        host.status = "online";
        host.metrics = { cpu: 9, memory: 22, uptimeSeconds: 30 };
      }
      if (action === "shutdown_host") {
        host.status = "sleeping";
        host.metrics = {};
      }
      host.lastSeen = now();
    }
    const verb = action === "wake_host" ? "Wake packet sent to" : "Shutdown sent to";
    return pushEvent({ source: "user", level: "success", target: hostName(hostId), message: `${verb} ${hostName(hostId)}` });
  },

  async runServiceAction(serviceId, action) {
    await delay(500);
    const svc = services.find((s) => s.id === serviceId);
    if (svc) {
      if (action === "start_service" || action === "restart_service") svc.state = "running";
      if (action === "stop_service") svc.state = "stopped";
    }
    const label = action.replace("_service", "").replace("run_", "").replace("_", " ");
    return pushEvent({ source: "user", level: "success", target: svc?.name, message: `${cap(label)} → ${svc?.name}` });
  },

  async sendChat(content): Promise<AgentReply> {
    await delay(650);
    const lower = content.toLowerCase();
    const toolCalls: ToolCall[] = [];
    const producedEvents: ActivityEvent[] = [];

    // Cheap intent shim so the mock feels connected to the fleet. The real
    // backend lets the model choose these tools; here we pattern-match a few.
    if (/(wake|turn on|start up).*(g5|workstation)/.test(lower)) {
      const ev = await this.runHostAction("g5", "wake_host");
      toolCalls.push({ action: "wake_host", target: "g5", status: "ran" });
      producedEvents.push(ev);
    } else if (/restart.*(searxng|search)/.test(lower)) {
      const ev = await this.runServiceAction("searxng", "restart_service");
      toolCalls.push({ action: "restart_service", target: "SearXNG", status: "ran" });
      producedEvents.push(ev);
    } else if (/search|look up|google|find/.test(lower)) {
      toolCalls.push({ action: "web_search", target: content.slice(0, 40), status: "ran" });
    }

    const reply: AgentReply = {
      message: {
        id: id(),
        role: "assistant",
        ts: now(),
        content: toolCalls.length
          ? `Done. ${toolCalls.map((t) => describeTool(t)).join(" ")} (mocked — the real build runs this through your OpenAI-compatible endpoint with the typed action registry + SearXNG MCP.)`
          : `Mocked reply. The real agent answers through your OpenAI-compatible endpoint and can wake hosts, restart services, or search via SearXNG — all as typed actions. You said: "${content.slice(0, 120)}"`,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      },
      events: producedEvents,
    };
    return reply;
  },
};

function describeTool(t: ToolCall): string {
  if (t.action === "web_search") return `Searched the web for "${t.target}".`;
  return `Ran ${t.action.replace(/_/g, " ")} on ${t.target}.`;
}
