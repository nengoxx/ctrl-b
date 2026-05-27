// Domain model for the ctrl-b dashboard.
// Mirrors the entities in ws_codex_2/docs/SPEC.md so the mock layer and the
// future FastAPI backend share one shape.

export type HostStatus = "online" | "sleeping" | "warning" | "unreachable";
export type ServiceState = "running" | "stopped" | "degraded" | "unknown";
export type OS = "windows" | "linux";

export interface HostMetrics {
  cpu?: number; // 0-100
  memory?: number; // 0-100
  gpu?: number; // 0-100
  uptimeSeconds?: number;
}

export interface Host {
  id: string;
  name: string; // MagicDNS name, e.g. "corsair"
  role: string; // human label, e.g. "Inference / GPU"
  os: OS;
  magicDnsName: string;
  lanIp: string;
  tailscaleIp?: string;
  status: HostStatus;
  metrics: HostMetrics;
  tags: string[];
  lastSeen: string; // ISO
}

export type ServiceKind = "llm" | "web" | "search" | "media" | "system" | "other";

export interface ServiceAction {
  id: string; // e.g. "restart"
  label: string; // e.g. "Restart"
  type: ActionType;
  risk: "low" | "medium" | "high";
}

export interface Service {
  id: string;
  hostId: string;
  name: string;
  kind: ServiceKind;
  state: ServiceState;
  port?: number;
  endpoint?: string; // clickable URL when reachable
  actions: ServiceAction[];
}

export type ActionType =
  | "wake_host"
  | "shutdown_host"
  | "start_service"
  | "stop_service"
  | "restart_service"
  | "open_service_url"
  | "switch_gpu_workload"
  | "run_health_check";

export interface ActivityEvent {
  id: string;
  ts: string; // ISO
  source: "status" | "user" | "agent";
  level: "info" | "success" | "warning" | "error";
  target?: string; // host or service name
  message: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  ts: string;
  pending?: boolean;
}
