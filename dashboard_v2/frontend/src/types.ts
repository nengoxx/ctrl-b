// Mirror of the backend domain (DESIGN.md §2, §13). Phase 1 = fleet read path only.

export type OSType = "windows" | "linux" | "macos";

export interface HostStatus {
  host_id: string;
  online: boolean;
  ping_ms: number | null;
  last_seen: string | null; // ISO 8601 UTC
  checked_at: string;
  error: string | null;
}

export interface Host {
  id: string;
  name: string;
  ip: string;
  mac: string | null;
  ssh_username: string | null;
  ssh_port: number;
  os_type: OSType;
  role: string | null;
  tags: string[];
  status: HostStatus | null;
}

export interface ServerInfo {
  port: number;
  debug: boolean;
  poll_seconds: number;
}

// ── Services (Phase 3). Mirror of domain/service.py + api/services.py DTO. ──

export interface ServiceStatus {
  service_id: string;
  online: boolean; // port reachable (or host up, for a port-less service)
  checked_at: string;
  error: string | null;
}

export interface Service {
  id: string;
  host_id: string;
  name: string;
  kind: string | null;
  port: number | null;
  path: string;
  autostart: boolean;
  url: string | null; // http://host:port/path, when resolvable
  controls: string[]; // control actions configured for the host's OS (start/stop/restart)
  status: ServiceStatus | null;
}

// ── Actions (Phase 2). Mirror of core/tool.py + domain/result.py + domain/event.py. ──

export type Risk = "low" | "med" | "high";

export type RunState =
  | "pending"
  | "awaiting_confirm"
  | "running"
  | "ok"
  | "error"
  | "denied"
  | "skipped"
  | "timeout";

export interface ToolResult {
  state: RunState;
  summary: string;
  data: Record<string, unknown>;
  output: string | null;
  error: string | null;
  artifacts: unknown[];
  duration_ms: number | null;
}

export interface ActionSpec {
  name: string;
  title: string;
  description: string;
  icon: string | null;
  category: string;
  risk: Risk;
  confirm: boolean;
  ui_exposed: boolean;
  agent_exposed: boolean;
  input_schema: Record<string, unknown>;
}

export interface CtrlEvent {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  status: RunState;
  summary: string | null;
  output: string | null;
}

/** `POST /api/actions/{name}` response — either a confirm prompt or an executed result. */
export interface InvokeResponse {
  needs_confirm: boolean;
  confirm_token?: string;
  prompt?: string;
  result?: ToolResult;
  event?: CtrlEvent;
}

// ── Plan (Phase 4d). Mirror of domain/plan.py — carried in a task_plan ToolResult's `data.plan`. ──

export type PlanStepStatus = "pending" | "active" | "done";

export interface PlanStep {
  text: string;
  status: PlanStepStatus;
}

export interface Plan {
  steps: PlanStep[];
}

// ── Agent chat (Phase 4a). Mirror of domain/conversation.py + the SSE wire protocol (DESIGN §12). ──

export type Role = "user" | "assistant" | "system" | "tool";

export interface ToolCallPart {
  type: "tool_call";
  call_id: string;
  tool: string;
  args: Record<string, unknown>;
  state: RunState;
}

export interface ToolResultPart {
  type: "tool_result";
  call_id: string;
  result: ToolResult;
}

export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | ToolCallPart
  | ToolResultPart
  | { type: "error"; message: string; retryable: boolean };

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: Role;
  parts: Part[];
  actor: string;
  ts: string;
  tokens: number | null;
  compacted: boolean;
}

export interface Thread {
  id: string;
  title: string | null;
  agent: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
}
