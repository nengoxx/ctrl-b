// In-memory mock backed by the owner's real fleet names (corsair, vault, g5, emma).
// Mutates local state so actions feel live during design. Replace with HTTP later.

import type { CtrlbApi } from "./client";
import type { ActivityEvent, ChatMessage, Host, Service } from "../types";

const now = () => new Date().toISOString();
const id = () => Math.random().toString(36).slice(2, 10);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let hosts: Host[] = [
  {
    id: "corsair",
    name: "corsair",
    role: "Inference / GPU",
    os: "windows",
    magicDnsName: "corsair",
    lanIp: "192.168.1.20",
    tailscaleIp: "100.74.123.22",
    status: "online",
    metrics: { cpu: 18, memory: 41, gpu: 87, uptimeSeconds: 320400 },
    tags: ["gpu", "koboldcpp", "sd-webui"],
    lastSeen: now(),
  },
  {
    id: "vault",
    name: "vault",
    role: "Storage / NAS",
    os: "linux",
    magicDnsName: "vault",
    lanIp: "192.168.1.21",
    tailscaleIp: "100.87.43.22",
    status: "online",
    metrics: { cpu: 6, memory: 33, uptimeSeconds: 1820400 },
    tags: ["storage", "backups"],
    lastSeen: now(),
  },
  {
    id: "g5",
    name: "g5",
    role: "Workstation",
    os: "windows",
    magicDnsName: "g5",
    lanIp: "192.168.1.22",
    tailscaleIp: "100.65.10.4",
    status: "sleeping",
    metrics: {},
    tags: ["desktop"],
    lastSeen: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  },
  {
    id: "emma",
    name: "emma",
    role: "Services / Web",
    os: "linux",
    magicDnsName: "emma",
    lanIp: "192.168.1.23",
    tailscaleIp: "100.99.2.8",
    status: "warning",
    metrics: { cpu: 71, memory: 88, uptimeSeconds: 90400 },
    tags: ["searxng", "web"],
    lastSeen: now(),
  },
];

let services: Service[] = [
  {
    id: "kobold",
    hostId: "corsair",
    name: "KoboldCpp",
    kind: "llm",
    state: "running",
    port: 5001,
    endpoint: "http://corsair:5001",
    actions: [
      { id: "restart", label: "Restart", type: "restart_service", risk: "medium" },
      { id: "stop", label: "Stop", type: "stop_service", risk: "medium" },
      { id: "switch", label: "Switch model", type: "switch_gpu_workload", risk: "medium" },
    ],
  },
  {
    id: "sdwebui",
    hostId: "corsair",
    name: "SD WebUI",
    kind: "media",
    state: "stopped",
    port: 7860,
    actions: [
      { id: "start", label: "Start", type: "start_service", risk: "low" },
      { id: "switch", label: "Switch workload", type: "switch_gpu_workload", risk: "medium" },
    ],
  },
  {
    id: "searxng",
    hostId: "emma",
    name: "SearXNG",
    kind: "search",
    state: "degraded",
    port: 8080,
    endpoint: "http://emma:8080",
    actions: [
      { id: "restart", label: "Restart", type: "restart_service", risk: "medium" },
      { id: "health", label: "Health check", type: "run_health_check", risk: "low" },
    ],
  },
  {
    id: "nas",
    hostId: "vault",
    name: "File shares",
    kind: "system",
    state: "running",
    port: 445,
    actions: [{ id: "health", label: "Health check", type: "run_health_check", risk: "low" }],
  },
];

let events: ActivityEvent[] = [
  { id: id(), ts: now(), source: "status", level: "warning", target: "emma", message: "Memory at 88% — degraded SearXNG" },
  { id: id(), ts: new Date(Date.now() - 1000 * 60 * 6).toISOString(), source: "status", level: "info", target: "g5", message: "Host went to sleep" },
  { id: id(), ts: new Date(Date.now() - 1000 * 60 * 30).toISOString(), source: "user", level: "success", target: "corsair", message: "KoboldCpp restarted" },
];

function hostName(hostId?: string) {
  return hosts.find((h) => h.id === hostId)?.name ?? hostId ?? "?";
}

function pushEvent(e: Omit<ActivityEvent, "id" | "ts">): ActivityEvent {
  const full: ActivityEvent = { ...e, id: id(), ts: now() };
  events = [full, ...events].slice(0, 100);
  return full;
}

export const mockApi: CtrlbApi = {
  async listHosts() {
    await delay(180);
    // jitter live metrics a little so polling visibly updates
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
      if (action === "wake_host") host.status = "online";
      if (action === "shutdown_host") host.status = "sleeping";
    }
    const verb = action === "wake_host" ? "Wake packet sent to" : "Shutdown sent to";
    return pushEvent({ source: "user", level: "success", target: hostName(hostId), message: `${verb} ${hostName(hostId)}` });
  },

  async runServiceAction(serviceId, action) {
    await delay(500);
    const svc = services.find((s) => s.id === serviceId);
    if (svc) {
      if (action === "start_service") svc.state = "running";
      if (action === "stop_service") svc.state = "stopped";
      if (action === "restart_service") svc.state = "running";
    }
    const label = action.replace("_service", "").replace("run_", "");
    return pushEvent({ source: "user", level: "success", target: svc?.name, message: `${cap(label)} → ${svc?.name}` });
  },

  async sendChat(content) {
    await delay(650);
    const reply: ChatMessage = {
      id: id(),
      role: "assistant",
      ts: now(),
      content:
        `Mocked agent reply. In the real build this routes to your OpenAI-compatible endpoint ` +
        `with the typed action registry + SearXNG MCP as tools. You said: "${content.slice(0, 120)}"`,
    };
    return reply;
  },
};

function jitter(v?: number) {
  if (v == null) return v;
  return Math.max(0, Math.min(100, Math.round(v + (Math.random() * 10 - 5))));
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
