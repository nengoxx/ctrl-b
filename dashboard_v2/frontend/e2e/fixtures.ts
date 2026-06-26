import { test as base, expect, type Page, type Route } from "@playwright/test";

// D24 — deterministic `/api` mock at the browser level. Every spec gets `mockApi` auto-applied, so no
// request ever escapes to a real backend (the built app is served by `vite preview`, which doesn't
// proxy `/api`). Shapes mirror the real DTOs; per-test overrides (e.g. a streamed chat reply) layer on
// top via `page.route` registered AFTER this (last-registered wins in Playwright).

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// A couple of fixture hosts so the Fleet tab renders real rows (online + offline service each).
const HOSTS = [
  {
    id: "vault", name: "vault", ip: "192.168.1.137", mac: "aa:bb:cc:dd:ee:ff",
    os_type: "linux", role: "server", tags: ["nas"],
    status: { online: true, latency_ms: 3, checked_at: "2026-06-24T00:00:00Z" },
  },
  {
    id: "corsair", name: "corsair", ip: "192.168.1.128", mac: null,
    os_type: "windows", role: "desktop", tags: [],
    status: { online: false, latency_ms: null, checked_at: "2026-06-24T00:00:00Z" },
  },
];

const SERVICES = [
  { id: "vault.ssh", host_id: "vault", name: "ssh", url: null, online: true, addr: "192.168.1.137:22" },
  { id: "vault.web", host_id: "vault", name: "web", url: "http://192.168.1.137:8080", online: false, addr: "192.168.1.137:8080" },
];

const util = (name: string, title: string, icon: string) => ({
  name, title, description: `${title} utility`, icon, category: "utility",
  risk: "low", confirm: false, ui_exposed: true, agent_exposed: true, core: false,
  default_agent_mode: "enabled",
  input_schema: { type: "object", properties: { q: { type: "string", title: "q" } }, required: [] },
});

const TOOLS = [util("yt_captions", "Yt Captions", "yt"), util("ip_info", "Ip Info", "globe"), util("dns_trace", "Dns Trace", "globe")];

const ACTIONS = [
  { name: "wake_host", title: "Wake Host", description: "Wake a host", icon: null, category: "action", risk: "low", confirm: false, ui_exposed: true, agent_exposed: true, core: false, default_agent_mode: "enabled", input_schema: { type: "object", properties: {} } },
  { name: "shutdown_host", title: "Shutdown Host", description: "Shut down a host", icon: null, category: "action", risk: "high", confirm: true, ui_exposed: true, agent_exposed: true, core: false, default_agent_mode: "enabled", input_schema: { type: "object", properties: {} } },
  ...TOOLS,
];

const endpoint = (b: Record<string, unknown>) => ({ base_url: "", api_key: null, model: "", ...b });
const voiceSvc = { connect_timeout_s: 3, timeout_s: 30, extra_body: {}, primary: endpoint({}), fallback: endpoint({}) };

const SETTINGS = {
  server: { host: "0.0.0.0", port: 5433, poll_seconds: 5, feature_cycle_seconds: 8, debug: false },
  inference: {
    default_mode: "local", request_timeout_s: 120, system_prompt: "", system_prompt_append: "",
    failover: true, local: endpoint({}), cloud: endpoint({}), fallbacks: [],
  },
  searxng: { base_url: "", enabled: false, language: null },
  embeddings: { base_url: "", api_key: null, model: "", enabled: false, dim: null },
  open_terminal: { base_url: "", api_key: null, enabled: false, exec_risk: "high", write_risk: "med", read_risk: "low" },
  shell: { enabled: true, user_exec_enabled: true, agent_exec_enabled: false, workdir: "", timeout_s: 60, max_output_chars: 6000 },
  voice: { enabled: false, stt: { ...voiceSvc, language: "en", vad_filter: true, hotwords: "", auto_send: false }, tts: { ...voiceSvc, format: "mp3" } },
  mcp_servers: [], openapi_servers: [],
  agent: {
    default_agent: "", default_title: "", defaults: {}, global_subagent_limit: 6,
    subagent_clamp_privilege: true, auto_rotate: false, auto_rotate_min_overlap: 2,
    streaming: "auto", skills_enabled: true, skills_auto_write: true,
  },
  memory: { enabled: true, auto_write: true, user_profile_enabled: true, max_chars: 8000, max_user_chars: 4000 },
  tailscale: { target_port: 5173, enabled: false, timeout_s: 5 },
  tool_overrides: {}, computers: {},
};

/** Route table for on-load GETs. Keys are matched by `pathname.endsWith` (longest first). */
const ROUTES: Record<string, unknown> = {
  "/api/health": { status: "ok", version: "test", poll_seconds: 5 },
  "/api/hosts": HOSTS,
  "/api/services": SERVICES,
  "/api/voice/status": { stt: false, tts: false },
  "/api/actions": ACTIONS,
  "/api/tools": TOOLS,
  "/api/settings": SETTINGS,
  "/api/agents": { agents: [], default: "" },
  "/api/skills": [],
  "/api/integrations/status": { mcp: [], openapi: [], dirty: false },
  "/api/threads": [],
  "/api/agent/default-prompt": "You are a helpful homelab assistant.",
  "/api/access/status": { available: false, serving: false, url: null, reason: "cli unavailable" },
  "/api/memory/user": { content: "" },
};

/** Install the baseline mock. Unmatched `/api/*` GETs default to `[]`/`{}` (logged); the SSE stream is
 *  fulfilled empty (the connection badge may read "reconnecting" — irrelevant to render/a11y). The
 *  appearance selection (D28 §9.11) is STATEFUL per page — a `PUT /api/settings {appearance}` updates it
 *  and `GET /api/appearance` returns it — so the theme-engine's optimistic-write→reconcile round-trip is
 *  deterministic (a static mock would let the always-on reconcile revert a just-made change). */
export async function mockApi(page: Page): Promise<void> {
  let appearance: { theme: string; mode: string; accent: string; updated_at: string | null } = {
    theme: "vapor",
    mode: "dark",
    accent: "dark",
    updated_at: null,
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") {
      // Capture an appearance write so the subsequent reconcile read reflects it (server-stamped LWW).
      if (path.endsWith("/api/settings")) {
        try {
          const body = req.postDataJSON() as { appearance?: Record<string, string> };
          if (body?.appearance) {
            appearance = { ...appearance, ...body.appearance, updated_at: new Date().toISOString() };
          }
        } catch {
          /* non-JSON body — ignore */
        }
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (path.endsWith("/api/events/stream")) {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    }
    if (path.endsWith("/api/appearance")) return json(route, appearance);
    const key = Object.keys(ROUTES).find((k) => path.endsWith(k));
    if (key) return json(route, ROUTES[key]);
    // eslint-disable-next-line no-console
    console.warn(`[mockApi] unmocked GET ${path} → default {}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

/** Spec base. The API mock is applied via a `page` override so EVERY test gets it (a fixture that only
 *  runs when destructured would miss specs that take just `{ page }` — e.g. the a11y scans). `pageErrors`
 *  collects uncaught page exceptions (the real "app crashed / blank screen" signal — more robust than
 *  asserting zero console.error, which network/SW noise pollutes). */
export const test = base.extend<{ pageErrors: string[] }>({
  page: async ({ page }, use) => {
    await mockApi(page);
    await use(page);
  },
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await use(errors);
  },
});

export { expect };
