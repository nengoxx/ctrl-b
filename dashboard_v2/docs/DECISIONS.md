# Decisions log — dashboard_v2

Locked-in choices for the rebuild, with the reasoning. Anything not listed here is open and
should be decided in `TODO.md` / `ARCHITECTURE.md` before it's built. Date: 2026-05-27.

---

## D1 — Target: mobile-first PWA, desktop too ✅

One responsive React SPA, **mobile-first** (it ports the already-mobile-first Vapor design),
widening gracefully on desktop. Shipped as an **installable PWA** (`vite-plugin-pwa`: web
manifest + service-worker app-shell cache).

**Why:** every privileged operation (WOL, SSH, ping, LLM/STT/TTS) is server-side, so the
client is thin — Android support is a UI concern, not an architectural one, and the Vapor
design is already mobile-first, so "Android" costs almost nothing extra.

**The one real constraint — secure context for the mic:** browser mic capture (`getUserMedia` /
`MediaRecorder`) only works in a **secure context**, which means **HTTPS** *or* **loopback**
(`localhost`/`127.0.0.1`/`*.localhost`). A Tailscale IP (`100.x.x.x`) and LAN IPs (`192.168.x`)
are **not** loopback, so plain `http://100.x:5432` is **not** secure → mic blocked on the phone.

**Chosen fix: Tailscale Serve.** `tailscale serve` fronts the local app as
`https://<host>.<tailnet>.ts.net` with a **real, auto-renewed Let's Encrypt cert** — no cert
management. It is **tailnet-only** (you must be connected to the tailnet to reach it; nothing is
exposed to the public internet — that's *Funnel*, which we do **not** enable). Because FastAPI
serves the SPA **and** `/api` on that single origin, there's **no mixed-content** issue. FastAPI
binds `127.0.0.1:5432`; Serve exposes HTTPS on the `ts.net` name. First-class task in `TODO.md`.

**No-HTTPS alternatives (narrower, documented for completeness):**
- *Phone-as-server (Termux profile):* open `http://localhost:5432` on the phone → loopback →
  secure context → mic works with **no HTTPS, no flag**. Only when the phone hosts the server.
- *Native wrapper:* WebView runs from a secure-context origin (mic works) but then needs
  cleartext-to-API config. Only worth it if going native anyway.
- *Chrome `unsafely-treat-insecure-origin-as-secure` flag:* **not viable on stock Android**
  (needs a rooted/dev device; the flag is being removed). Don't design around it.

See `RESEARCH.md` → "Secure context for the mic" for the full breakdown + sources.

**Deferred:** a native wrapper (Capacitor/Tauri). Only worth it for app-store APK / push /
background. The API is designed client-agnostic so a native client can consume it later
without backend changes. See D5.

## D2 — Backend: Python + FastAPI + Uvicorn ✅

**Why (and why not Node):** the workload is I/O-bound (SSH round-trips, fleet pings, LLM/audio
streaming) — FastAPI's async handles it as well as Node; the framework is never the
bottleneck, the network is. The deciding factor is the **existing, working Python glue**
(`paramiko`, `wakeonlan`, `openai`, `youtube-transcript-api`, `beautifulsoup4`) — rewriting it
in Node buys nothing at one-user/~5-host scale. Pydantic models map 1:1 onto the typed-action
registry (validation + OpenAPI + agent tool schemas from one definition). Go/Rust would be
throughput overkill never approached here.

Concrete win over the old server: pings run **concurrently** (async) instead of the current
serial `is_awake()` loop that blocks status for the whole fleet.

## D3 — Execution model: hybrid (typed actions + guarded `$`) ✅

- **Primary path = a typed-action registry.** Each action is a Python function + Pydantic input
  model + risk level + optional confirmation, returning **structured, captured** output. UI
  buttons *and* agent tool-calls route through the same registry. Everything is logged to an
  Event table.
- **Escape hatch = one guarded raw-exec action.** Redesigned vs today's
  `subprocess.Popen(['cmd','/k', …])`: it **captures stdout/stderr with a timeout**, can target
  the local host or a remote host (SSH), is explicitly **dangerous-flagged**, is logged, and is
  **off-limits to the agent by default** (gated by a setting). This preserves the Vapor `$`
  power-user UX without making arbitrary shell the agent's casual default.

**Why:** today's `/execute` is Windows-only (`cmd /k` pops a GUI window — meaningless headless
on Ubuntu), captures no output (the agent can't see results), and is RCE-by-design. Typed
actions are OS-abstracted, validatable, loggable, and streamable.

**Honest limitation:** actions that wrap shell underneath (`start_service` → `systemctl` vs
`Start-Service`) still need **per-OS command maps**, and "services" are **net-new modeling** —
they don't exist in the current `config.yaml` (the Vapor design already anticipates them).

## D4 — Persistence: SQLite (chat/memory/events) + YAML (config) ✅

- **SQLite** for chat threads, messages, agent memory, and the event/audit log — easy querying,
  history pruning/management from the Conf tab, single-file, cross-OS, no server process.
- **YAML** for human-editable config (hosts, inference/STT/TTS endpoints + keys, server, voice),
  staying compatible with the current `config.yaml` shape so migration is mechanical. Editable
  in the Conf tab *and* in a text editor.

**Why not all-SQLite:** keeps config hand-editable outside the UI (matches current workflow,
good for headless/Termux). **Why not all-files:** chat history search/prune gets clumsy as it
grows.

## D5 — Deployment profiles, not forks ✅

The same pure-Python server targets three profiles; only launch + power notes differ:

1. **Windows 11** — `uvicorn`, autostart via Task Scheduler / `.bat`.
2. **Ubuntu 26 LTS** — `uvicorn` under a `systemd` unit (mirrors the existing
   `wol_server.service`).
3. **Android / Termux (experimental)** — phone *is* the dashboard host, broadcasting WOL on its
   own LAN. Needs `termux-wake-lock` + a foreground service + the phone plugged in; high port
   bind (5432) avoids root. Documented as a profile, not a separate build.

Keeping the backend dependency-light and OS-abstracted (no hard Windows/Linux-only imports at
import time) is what keeps profile 3 feasible. A future **native Android client** is a separate,
optional track that consumes the same API.

## D6 — Don't touch the old project ✅

`wol_server/` keeps running until cutover. `ws_claude*/`, `ws_codex*/`, `ctrl-b (Vapor)/` are
reference only. All v2 work lives under `dashboard_v2/`. The Vapor HTML is the **visual source
of truth**; copy assets (logo/favicon), don't import.

## D7 — Pixel-exact Vapor visual fidelity ✅ (hard requirement)

The UI must **match `ctrl-b (Vapor)/variations/vapor.html` exactly** — a faithful port, not an
interpretation. **Lift the CSS verbatim** (the `:root`/`[data-theme]` variable system), keep all
three palettes (vapor/aqua/ember), the exact fonts (JetBrains Mono + Major Mono Display), **all
animations** (hero sun/stripes/stars/grid, skyline SVGs, LED heartbeat, equalizer, live waveform,
sliding tab indicator), and every component (appbar+TTS toggle, hero panel, device rows + dropdown,
fleet summary, chat/command bubbles, `.util` cards, Conf rows/segments/switches, fixed composer).
Componentize into React, but the rendered result must be **visually indistinguishable** from the
prototype; verify side-by-side at phone width. Full checklist in `ARCHITECTURE.md` §5. **Why:** the
owner designed this deliberately and wants it preserved precisely — design is a fixed spec, not a
v1 approximation.

## D8 — Extensible tool registry (Utils) ✅

Utilities are a **pluggable registry**, not one-off endpoints. A tool = handler + Pydantic input
+ display metadata + `agent_exposed` flag; registering it auto-creates the REST endpoint
(`/api/tools/{name}`), the Utils-tab card (rendered generically), and (optionally) an agent tool —
**from one file**. v1 ports `yt_captions` + `ip_info` and adds **`dns_trace`** as the first new
tool to prove the path. **Why:** the owner wants to add tools (DNS trace, whois, port check,
speedtest, …) "relatively easily" — so make extension a first-class pattern, mirroring the action
registry. Detail in `ARCHITECTURE.md` §1 (Tools/Utils).

## D9 — Configurable agent integrations: MCP, SearXNG, embeddings ✅

The owner already runs these and wants them **all configurable in Conf**:

- **MCP client** — the agent connects to multiple **MCP servers** over **stdio** *and* **Streamable
  HTTP** transports; their tools merge (namespaced) into the agent's aggregated toolset. Per-server
  config (`name`, transport, `command+args+env` or `url+headers`, `enabled`), tool discovery, and
  failure isolation so one bad server can't break the agent. Use an MCP client lib (official Python
  MCP SDK).
- **SearXNG** — configurable endpoint of the owner's local instance powers a built-in `web_search`
  tool (`format=json`); optionally consumable via a SearXNG MCP server instead. Settles the old
  "SearXNG MCP v1 or later?" open item: **in, and configurable.**
- **Embeddings** — configurable OpenAI-compatible `/v1/embeddings` base URL (the owner's llama.cpp
  embedding model) feeds the **vector** `MemoryProvider` (D4/B1) and future semantic search.

Config shape in `ARCHITECTURE.md` §3 (`searxng{}`, `embeddings{}`, `mcp_servers[]`); UI in Conf →
Inference (embeddings) + Integrations (MCP servers, SearXNG). **Why:** these are existing,
owner-operated services — wiring them as first-class configurable integrations (not hardcoded) is
what makes the agent genuinely useful and keeps secrets in masked YAML.

---

## Still open (decide before building the relevant phase)

- Agent tool-calling format: OpenAI `tools`/function-calling vs a lightweight JSON protocol for
  models that don't support tools well (some local GGUFs). Likely: detect capability, fall back.
- Memory backend(s): none / file (`MEMORY.md`-style) / vector / both — pluggable provider; v1 ships
  none+file, vector later. Embeddings endpoint = the owner's llama.cpp `/v1/embeddings` (D9).
- Auth: stay none (Tailscale-only) for v1; revisit only if exposure model ever changes.
- Frontend routing: simple tab state vs `react-router` (lean tab state unless deep-linking is wanted).
- MCP: how much of the client to ship in v1 vs v1.x (transports both wanted; start with one server
  working end-to-end, then generalize). Tool-namespacing + per-server failure isolation.

## Future additions (design-shaping, captured in ROADMAP.md)

These are **not v1 scope**, but v1 must leave the seams for them (see `ROADMAP.md` for detail).
The owner explicitly wants them eventually:

- **Agent privilege levels** (read-only → full, Claude-Code/Codex-style) — policy layer over the
  action `risk` field (A1).
- **Agent asks clarifying questions** — typed `question` message kind + turn-based loop (A2). When
  unattended/low-privilege, **notify and wait** for the answer (bridges A1+A3+F1).
- **Scheduled agent automations** (cron + saved prompt + privilege) — new scheduler subsystem (A3).
- **Composer-as-console** (A4): `!` (configurable sigil, the only command prefix) → guarded shell;
  `/` → slash commands incl. **`/local`,`/cloud`** for backend (replacing the disliked `k:`/`o:`);
  markdown bot replies + copy/send-to-composer on code blocks. *(Prefix routing + formatting +
  `/local`,`/cloud` ≈ v1; custom slash commands post-v1.)*
- **Streaming + non-streaming fallback** — endpoint supports both from day one (C1).
- **Wake word** — client-side, audio stays local until trigger (C2).
- **Idle shutdown/sleep per host** (Win + Linux) — **optional/opt-in**; needs a real-idle detection
  mechanism, the hard part (D1). **Wake-on-connection** (D2).
- **Discord/Telegram bots** as thin clients to the same API (E1).
- **Notifications** (F1): whole feature **optional (master toggle)**; when on, **PWA-native is the
  default, auto** — foreground (Notifications API via SSE) when open + **Web Push** (VAPID) when
  closed. **ntfy** + **Telegram/Discord** are optional extra channels. Per-event toggles. Includes
  the agent-needs-input channel. No native app required.
- **Security hardening** (G) — known_hosts pinning, per-action tokens, secret encryption-at-rest.

→ v1 seams to build now so these slot in: pluggable `MemoryProvider`, action `risk` levels,
typed chat-message kinds, streaming-or-buffered chat endpoint, a settings/policy layer, and a
functionally-grouped Conf tab.
