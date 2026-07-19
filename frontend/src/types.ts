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
  has_password?: boolean; // Phase 7b: whether an ssh_password is stored (the value is never sent)
  services?: HostServiceCfg[]; // Phase 7b: the host's declared services, for the Conf editor
  // Per-host, per-theme presentation override (D28 §9.9) — the OPEN pass-through blob a spatial theme owns
  // the schema for, keyed by themeId (mirrors backend `ComputerCfg.appearance`). Open by design: the app/DTO
  // never type the inner shape (a theme's present() validates it). First consumer = frontier's present()
  // (`appearance.frontier = { image?, x?, y? }`).
  appearance?: Record<string, Record<string, unknown>>;
  // FACT from the backend: this fleet entry IS the machine ctrl-b runs on (name == server hostname,
  // casefolded). The presentation layer (useHosts' select) sorts self FIRST, so every theme gives the
  // agent's own rig the distinguished slot (frontier: beside the hero figure; cosmos: innermost orbit).
  self?: boolean;
}

// One service as declared in config.yaml (Phase 7b machine-form editor). Distinct from the derived
// `Service` DTO above (which carries live status/url/controls); this is the raw editable config.
export interface HostServiceCfg {
  name: string;
  kind: string | null;
  port: number | null;
  path: string;
  autostart: boolean;
  cmd: Record<string, Record<string, string>>; // {action: {os_type: command}} — round-trips verbatim
}

export interface ServerInfo {
  port: number;
  debug: boolean;
  poll_seconds: number;
  feature_cycle_seconds: number;
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
  | "awaiting_answer"
  | "running"
  | "ok"
  | "error"
  | "denied"
  | "skipped"
  | "timeout"
  | "cancelled";

export interface ToolResult {
  state: RunState;
  summary: string;
  data: Record<string, unknown>;
  output: string | null;
  error: string | null;
  artifacts: unknown[];
  duration_ms: number | null;
}

/** The tri-state agent-access mode for a tool (Phase 8b, D22). core = always reachable (bypasses the
 *  per-agent allowlist + skill narrowing); enabled = in the general toolset; disabled = never offered. */
export type AgentMode = "core" | "enabled" | "disabled";

/** A per-tool override (Phase 8b, D22) — the unified object keyed by tool name in
 *  `Settings.tool_overrides`. Each field falls back to the tool's compile-time default when unset. */
export interface ToolOverride {
  description?: string | null;
  agent_mode?: AgentMode | null;
}

export interface ActionSpec {
  name: string;
  title: string;
  description: string;
  icon: string | null;
  category: string;
  risk: Risk;
  confirm: boolean;
  /** Safe to blindly re-run — read-only or idempotent (MCP `readOnlyHint`/`idempotentHint`). Gates the
   *  failed-turn retry UX (I4): a turn that ran a non-retry-safe tool is copied to the composer for
   *  review instead of auto-resent, so a retry can't silently repeat reboot/restart/shell/spawn. */
  retry_safe: boolean;
  ui_exposed: boolean;
  agent_exposed: boolean;
  /** Whether the tool is a `core` builtin (bypasses allowlist + skill narrowing). */
  core: boolean;
  /** The tri-state mode the tool's compile-time `(agent_exposed, core)` represents — lets the
   *  catalog mark defaults, store only deviations, and reset (Phase 8b). */
  default_agent_mode?: AgentMode;
  input_schema: Record<string, unknown>;
}

/** A utility tool shown as a Tools-tab card (`GET /api/tools`) — same DTO shape as ActionSpec. */
export type UtilTool = ActionSpec;

/** `POST /api/tools/{name}` response — the executed result + audit event (no confirm dance). */
export interface ToolInvokeResponse {
  result: ToolResult | null;
  event: CtrlEvent | null;
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

/** One web_search hit (Phase 4f) — carried in a web_search ToolResult's `data.results`.
 *  Mirrors adapters/searxng.py SearchResult. */
export interface WebSearchHit {
  title: string;
  url: string;
  content: string;
  engine: string | null;
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
  agent?: string | null; // which AgentDef produced this assistant turn (7e-c); null on user/default
  // D41/Slice 5 — a client-only marker for a QUEUED steer bubble (a mid-turn message/`!exec` accepted
  // with a 202 while a turn is live): the server-assigned `entry_id`. Present → render muted + a "queued"
  // chip; cleared (or the bubble dropped) when the entry drains (`steer.applied`), is harvested (Stop),
  // or is removed (DELETE). Never set by the durable messages endpoint — it's optimistic-only.
  queued?: string;
}

export interface Thread {
  id: string;
  title: string | null;
  agent: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
}
