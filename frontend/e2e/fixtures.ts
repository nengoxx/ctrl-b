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
    id: "vault",
    name: "vault",
    ip: "192.168.1.137",
    mac: "aa:bb:cc:dd:ee:ff",
    os_type: "linux",
    role: "server",
    tags: ["nas"],
    status: { online: true, latency_ms: 3, checked_at: "2026-06-24T00:00:00Z" },
  },
  {
    id: "corsair",
    name: "corsair",
    ip: "192.168.1.128",
    mac: null,
    os_type: "windows",
    role: "desktop",
    tags: [],
    status: { online: false, latency_ms: null, checked_at: "2026-06-24T00:00:00Z" },
  },
];

const SERVICES = [
  {
    id: "vault.ssh",
    host_id: "vault",
    name: "ssh",
    url: null,
    online: true,
    addr: "192.168.1.137:22",
  },
  {
    id: "vault.web",
    host_id: "vault",
    name: "web",
    url: "http://192.168.1.137:8080",
    online: false,
    addr: "192.168.1.137:8080",
  },
];

const util = (name: string, title: string, icon: string) => ({
  name,
  title,
  description: `${title} utility`,
  icon,
  category: "utility",
  risk: "low",
  confirm: false,
  ui_exposed: true,
  agent_exposed: true,
  core: false,
  default_agent_mode: "enabled",
  input_schema: { type: "object", properties: { q: { type: "string", title: "q" } }, required: [] },
});

const TOOLS = [
  util("yt_captions", "Yt Captions", "yt"),
  util("ip_info", "Ip Info", "globe"),
  util("dns_trace", "Dns Trace", "globe"),
];

const ACTIONS = [
  {
    name: "wake_host",
    title: "Wake Host",
    description: "Wake a host",
    icon: null,
    category: "action",
    risk: "low",
    confirm: false,
    ui_exposed: true,
    agent_exposed: true,
    core: false,
    default_agent_mode: "enabled",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "shutdown_host",
    title: "Shutdown Host",
    description: "Shut down a host",
    icon: null,
    category: "action",
    risk: "high",
    confirm: true,
    ui_exposed: true,
    agent_exposed: true,
    core: false,
    default_agent_mode: "enabled",
    input_schema: { type: "object", properties: {} },
  },
  ...TOOLS,
];

// A11/D48 Slice 2 — a voice/embeddings service is now a registry ref (flat primary + fallbacks) plus
// its section knobs; the legacy primary/fallback endpoint slots are retired.
const voiceSvc = {
  provider: null as string | null,
  model: null as string | null,
  fallbacks: [] as { provider: string; model: string | null }[],
  connect_timeout_s: 3,
  timeout_s: 30,
  extra_body: {},
};

/** The settings doc `GET /api/settings` answers with. **Exported** because a spec that drives a settings
 *  WRITE has to echo a whole doc back: `useSaveSettings` adopts the PUT's response as the settings cache,
 *  and the real endpoint always returns the complete masked config — so an echo missing a section (voice,
 *  say) hands Conf a doc it then reads a field off and throws on. Spread it, override the section under
 *  test. */
export const SETTINGS = {
  server: { host: "0.0.0.0", port: 5433, poll_seconds: 5, feature_cycle_seconds: 8, debug: false },
  // A11/D48 — the unified provider registry; inference, voice, and embeddings all point at it.
  providers: {
    llamacpp: {
      base_url: "http://h/v1",
      api_key: null,
      api_mode: "llamacpp",
      models: { "minig+": { context_window: 32768 } },
    },
    openrouter: {
      base_url: "https://openrouter.ai/api/v1",
      api_key: "sk…yz",
      api_mode: "openrouter",
      models: {
        "qwen3.5": { id: "qwen/qwen3.5", context_window: 262144 },
        "qwen-embed": { id: "qwen/qwen3-embedding", dim: 2560 },
        whisper: { id: "whisper-1" },
        kokoro: { id: "kokoro", voice: "bf_isabella", speed: 1, format: "mp3" },
      },
    },
  },
  inference: {
    provider: "llamacpp",
    model: null,
    fallbacks: [{ provider: "openrouter", model: "qwen3.5" }],
    request_timeout_s: 120,
    system_prompt: "",
    system_prompt_append: "",
    failover: true,
  },
  searxng: { base_url: "", enabled: false, language: null },
  embeddings: {
    provider: "openrouter",
    model: "qwen-embed",
    fallbacks: [] as { provider: string; model: string | null }[],
    enabled: false,
    timeout_s: 60,
  },
  open_terminal: {
    base_url: "",
    api_key: null,
    enabled: false,
    exec_risk: "high",
    write_risk: "med",
    read_risk: "low",
  },
  shell: {
    enabled: true,
    user_exec_enabled: true,
    agent_exec_enabled: false,
    workdir: "",
    timeout_s: 60,
    max_output_chars: 6000,
  },
  voice: {
    enabled: false,
    stt: {
      ...voiceSvc,
      provider: "openrouter",
      model: "whisper",
      language: "en",
      vad_filter: true,
      hotwords: "",
      auto_send: false,
    },
    tts: { ...voiceSvc, provider: "openrouter", model: "kokoro", format: "mp3" },
  },
  mcp_servers: [],
  openapi_servers: [],
  agent: {
    default_agent: "",
    default_title: "",
    defaults: {},
    global_subagent_limit: 6,
    subagent_clamp_privilege: true,
    auto_rotate: false,
    auto_rotate_min_overlap: 2,
    streaming: "auto",
    skills_enabled: true,
    skills_auto_write: true,
  },
  memory: {
    enabled: true,
    auto_write: true,
    user_profile_enabled: true,
    max_chars: 8000,
    max_user_chars: 4000,
  },
  tailscale: { target_port: 5173, enabled: false, timeout_s: 5 },
  tool_overrides: {},
  computers: {},
};

/** Route table for on-load GETs. Keys are matched by `pathname.endsWith` (longest first). */
const ROUTES: Record<string, unknown> = {
  "/api/health": { status: "ok", version: "test", poll_seconds: 5 },
  "/api/hosts": HOSTS,
  "/api/services": SERVICES,
  "/api/voice/status": { stt: false, tts: false },
  // G5 — the owner media index. Mocked EMPTY on purpose: no owner files is the state a fresh install is
  // in, so every gacha spec renders the BUNDLED art and stays independent of what sits in the dev box's
  // `$CTRLB_HOME/media/`. The path is namespaced, so a second art-bearing theme adds its own row.
  "/api/media/gacha": {
    ns: "gacha",
    collation: "library-v1",
    roles: { characters: [], banner: [], reel: [], oracle: [] },
    slots: {},
  },
  // D53 M2 — the same shape for frontier's rows (empty for the same reason: the specs assert the
  // BUNDLED map cover, rig cards and stack layers, which is the fresh-install rendering).
  "/api/media/frontier": {
    ns: "frontier",
    collation: "library-v1",
    roles: { rigs: [], hero: [], stack: [] },
    slots: {},
  },
  // D53 M3 + the Kit Art System — the kit's shared art. This one is read under EVERY theme (the service
  // rows are the consumer, not a theme's art), so the empty baseline is what keeps every other spec's
  // rows, sheets and shells in their fresh-install shape: no icons, no banners, no machine pictures and
  // no shared background layer. The specs that prove any of them land override it.
  "/api/media/kit": {
    ns: "kit",
    collation: "library-v1",
    roles: { services: [], "service-banners": [], hosts: [], background: [], brand: [] },
    slots: {},
  },
  "/api/actions": ACTIONS,
  "/api/tools": TOOLS,
  "/api/settings": SETTINGS,
  "/api/providers": {
    providers: {
      llamacpp: { api_mode: "llamacpp", models: ["minig+"] },
      openrouter: {
        api_mode: "openrouter",
        models: ["qwen3.5", "qwen-embed", "whisper", "kokoro"],
      },
    },
    rev: "revA",
    sections: {
      inference: {
        provider: "llamacpp",
        model: null,
        fallbacks: [{ provider: "openrouter", model: "qwen3.5" }],
      },
      stt: { provider: "openrouter", model: "whisper", fallbacks: [] },
      tts: { provider: "openrouter", model: "kokoro", fallbacks: [] },
      embeddings: { provider: "openrouter", model: "qwen-embed", fallbacks: [] },
    },
    // openrouter appears in the inference chain, so it's a chat verb; the voice-only whisper/kokoro
    // models don't add verbs (R9 — a voice-only provider isn't a chat verb).
    reserved_verbs: ["agent", "privilege", "priv", "clear", "compact", "help"],
    verbs: ["llamacpp", "openrouter"],
    warnings: [],
  },
  // A3 14c — the automations list envelope (empty roster; the feature-level facts the editor reads).
  // Mocked so Conf renders the real group rather than the catch-all `{}` — which is ALSO defended in
  // code now (automationsSummary/the panel array-prove the payload), because that `{}` once crashed
  // the whole Conf tab at the v1.4.2 release gate.
  "/api/automations": {
    automations: [],
    enabled: true,
    busy: false,
    max_count: 20,
    server_tz: "UTC",
    default_timeout_s: 300,
  },
  // Phase 18 / D56 — the prompt registry. Two representative rows: one CUSTOMIZED (badge + restore +
  // an `override` that makes `current` differ from the default) and one carrying derived placeholders
  // and the registry's literal "Coupling: " marker, which the pair editor splits into a warning line.
  "/api/prompts": {
    prompts: [
      {
        id: "memory_intro",
        label: "Memory Intro",
        description: "Frames the durable-memory block injected each turn.",
        default_text: "Context you carry across sessions.",
        override: "My own framing of memory.",
        append: null,
        current: "My own framing of memory.",
        is_customized: true,
        placeholders: [],
      },
      {
        id: "per_tool_cap",
        label: "Per Tool Cap",
        description:
          "Told to the model when one tool hits its cap. Coupling: the loop guard counts it.",
        default_text: "{{tool}} already ran {{count}} times — vary the call or move on.",
        override: null,
        append: null,
        current: "{{tool}} already ran {{count}} times — vary the call or move on.",
        is_customized: false,
        placeholders: ["tool", "count"],
      },
    ],
    warnings: [],
  },
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
  // Mirrors the backend AppearanceCfg shape (M3 §14.3: + motion/perf/theme_settings) — including its
  // unwritten skin triple (cosmos/dark/violet since D51 V0). The M3 fields default null ("unseeded") like
  // the real backend — a write spreads concrete values in (and stamps updated_at). While `updated_at` is
  // null the reconcile keeps LOCAL, so a spec's seeded pick always wins over these.
  let appearance: Record<string, unknown> = {
    theme: "cosmos",
    mode: "dark",
    accent: "violet",
    motion: null,
    perf: null,
    theme_settings: null,
    kit_background_visible: null, // the Kit Art System's shared-background switch — unseeded like the rest
    appbar_subtitle_visible: null, // the app bar's brand-subtitle switch — unseeded like the rest
    updated_at: null,
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") {
      // Capture an appearance write so the subsequent reconcile read reflects it (server-stamped LWW).
      if (path.endsWith("/api/settings")) {
        try {
          const body = req.postDataJSON() as { appearance?: Record<string, unknown> };
          if (body?.appearance) {
            appearance = {
              ...appearance,
              ...body.appearance,
              updated_at: new Date().toISOString(),
            };
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
    console.warn(`[mockApi] unmocked GET ${path} → default {}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

/** Seed the persisted `ctrlb.ui` blob BEFORE any page script — the one place the addInitScript pattern
 *  every spec used inline now lives. Pass `v: 1` (the current persisted-schema version) so the migration
 *  chain is skipped and the blob applies verbatim. Since D51 V0 a spec that wants VAPOR (or any non-default
 *  skin) must seed it explicitly: an unseeded boot lands on the cosmos default. The appearance server-mock
 *  is unseeded (`updated_at: null`), so the reconcile round-trip HOLDS the seeded pick. */
export async function seedUI(page: Page, ui: Record<string, unknown>): Promise<void> {
  await page.addInitScript((blob) => {
    localStorage.setItem("ctrlb.ui", JSON.stringify(blob));
  }, ui);
}

/** The vapor skin triple, for the specs that drive vapor's bespoke chrome (its Fleet rows/waveform, its
 *  `.composer`, its dark/aqua/ember palettes). Spread into a `seedUI` blob with the wanted `tab`. */
export const VAPOR_UI = { theme: "vapor", mode: "dark", accent: "dark", v: 1 } as const;

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
