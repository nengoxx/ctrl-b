// Domain model for the ctrl-b fleet console.
// One shape shared by the mock layer and the future FastAPI backend so the
// swap is a one-line client change, not a refactor. Mirrors the entities in
// ws_codex_2/docs/SPEC.md (Host / Service / Action / Event / AgentSession),
// extended with a `Project` grouping so the fleet scales past a handful of
// hand-listed hosts.

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
  projectId: string;
  magicDnsName: string;
  lanIp: string;
  tailscaleIp?: string;
  status: HostStatus;
  metrics: HostMetrics;
  tags: string[];
  lastSeen: string; // ISO
}

export type ServiceKind = "llm" | "web" | "search" | "media" | "system" | "other";

export type ActionType =
  | "wake_host"
  | "shutdown_host"
  | "start_service"
  | "stop_service"
  | "restart_service"
  | "open_service_url"
  | "switch_gpu_workload"
  | "run_health_check";

export interface ServiceAction {
  id: string;
  label: string;
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

// A Project groups hosts + services into one logical stack (e.g. "Homelab core",
// "AI / inference"). Adding a project is how the console scales without code
// changes — the nav, overview, and filters all read from this list.
export interface Project {
  id: string;
  name: string;
  description: string;
  accent: string; // CSS color token used as the project's accent
}

export interface ActivityEvent {
  id: string;
  ts: string; // ISO
  source: "status" | "user" | "agent";
  level: "info" | "success" | "warning" | "error";
  target?: string; // host or service name
  message: string;
}

export type ChatRole = "user" | "assistant";

// A tool call the agent made (or proposed) while answering — always one of the
// allowlisted typed actions, never raw shell. Surfaced as a chip in the chat.
export interface ToolCall {
  action: ActionType | "web_search";
  target: string;
  status: "proposed" | "ran" | "failed";
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  ts: string;
  pending?: boolean;
  toolCalls?: ToolCall[];
}
