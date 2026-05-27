# AGENTS.md — ctrl-b

Canonical guide for any AI agent (Claude Code, Codex, etc.) working in this repo.
Claude-specific notes live in `CLAUDE.md`, which defers to this file for everything below.

> **▶ Active project:** the current work is the ground-up rebuild in `dashboard_v2/`. For status
> and next steps, **start at [`dashboard_v2/docs/HANDOFF.md`](./dashboard_v2/docs/HANDOFF.md)**.
> This file describes the legacy Flask app + the target architecture; v2 detail lives in
> `dashboard_v2/docs/`.

---

## 1. What this project is

`ctrl-b` (titled "AI Dashboard" in the README) is a small self-hosted control panel for a
personal fleet of machines. The owner runs several PCs — some Windows, some Linux — reachable
over the LAN and over **Tailscale** (MagicDNS names like `corsair`, `vault`, `g5`, `emma`, or
direct Tailscale IPs). **No ports are open to the internet**; access is Tailscale-only. The
typical flow: an Android phone joins the tailnet, the dashboard wakes/monitors the machines, and
the owner manages services and talks to an LLM agent from one page.

Current capabilities:

- **Fleet monitoring** — ping each host, show awake/asleep.
- **Wake-on-LAN** — send magic packets.
- **Remote shutdown** — over SSH (Windows `shutdown /s /f /t 0`, Linux `sudo shutdown now`).
- **Command box** — type a shell command directly (prefix `$` or `>`), or describe intent in
  natural language and an LLM drafts the command into the input for review before sending.
- **Chat** — conversational page backed by an OpenAI-compatible endpoint.
- **Utilities** — YouTube caption download, an IP-lookup placeholder.
- **GPU box helpers** (`inference_server/`) — batch/PowerShell scripts to switch KoboldCpp
  models, run Stable Diffusion WebUI, and prevent idle sleep on the inference machine.

---

## 2. Repository map

```
wol_server/
  wol_server_win.py     # ★ PRIMARY server. Flask, Windows. All current features live here.
  wol_server.py         # Linux server. WOL + monitor + SSH shutdown ONLY. Outdated, lacks LLM/chat/utils.
  wol_server.service    # systemd unit (Linux/Raspberry Pi deployment)
  ping&wol.sh, ping&shutdown.sh   # Linux WOL/shutdown helper scripts
  templates/            # Jinja2 + Bootstrap pages (index, dashboard, chat, yt_caption, ip_info; old_ver/ archived)
  static/               # libDyn.js (front-end logic), logo/img/favicon

inference_server/       # GPU machine utilities: KoboldCpp model-switch .bat files, SD WebUI launch, idle prevention
wol_server (root file: "clients")  # NOTE: confusingly, ./clients and ./clients_sample are root files, not dirs

config.yaml             # ★ live config (gitignored). Copied from config_sample.yaml on first run.
config_sample.yaml      # template: computers{} + inference endpoints/keys
prompt_sample.txt       # default system prompt for the COMMAND-drafting LLM
command_prompt.txt      # active command system prompt (gitignored via *_prompt.*); falls back to prompt_sample.txt
command_post_prompt.txt # optional text appended after user input for command drafting
system_prompt.txt       # optional system prompt for the CHAT page
post_prompt.txt         # optional appended prompt for the CHAT page (referenced; may not exist)

ctrl+discord.py         # Discord bot — STUB (boilerplate, not wired in)
ctrl+telegram.py        # Telegram bot — STUB (literally "#TODO")
install.bat / install.sh, start_wol_server*.{bat,sh}   # setup & launch
start_claude_remote.ps1 / .cmd   # launch Claude Code in remote-control mode for this repo

ctrl-b (Vapor)/         # UNTRACKED. Final UI design: vapor.html (mobile-first vaporwave SPA, 4 tabs).
                        #   ★ visual source of truth for dashboard_v2. variations/ has alternates.
dashboard_v2/           # ★ ACTIVE REBUILD (planning). React+TS+Vite PWA + FastAPI. See dashboard_v2/docs/.
ws_claude/, ws_claude_2/  # UNTRACKED. Earlier React/Vite/TS UI prototypes (reference only, superseded).
ws_codex/, ws_codex_2/    # UNTRACKED. Earlier Codex prototypes; ws_codex_2/docs/SPEC.md is prior design notes.
```

`.gitignore` excludes: `config.yaml`, `clients`, `*_prompt.*`, `assets/demo.mp4`, `.venv`.
So secrets and live prompts are not committed. Keep it that way.

---

## 3. Run / build / test

**Python env:** Python 3.11, virtualenv in `.venv/`.

```powershell
# Windows (primary)
./install.bat                       # creates .venv, installs requirements.txt
./start_wol_server.bat              # runs wol_server_win.py
# Server listens on http://0.0.0.0:5432  -> open http://127.0.0.1:5432
```

```bash
# Linux (monitor/WOL only — feature-incomplete)
./install.sh
./start_wol_server.sh
```

There is **no test suite, linter, or CI**. `requirements.txt` is unpinned
(`flask`, `pyyaml`, `paramiko`, `wakeonlan`, `requests`, `openai`,
`youtube-transcript-api`, `beautifulsoup4`, `discord.py`).

First run auto-copies `config_sample.yaml` → `config.yaml` and
`prompt_sample.txt` → `command_prompt.txt` if missing.

---

## 4. Backend architecture (current)

- Single `WolServer` class in `wol_server_win.py` holds a dict of `Computer` objects built from
  `config['computers']`. Routes are registered two ways — via `app.add_url_rule(...)` in
  `__init__` **and** via `@app.route` decorators on methods. This is inconsistent; the
  decorated handlers (`chat_api`, `yt_caption*`, `ip_info`, `chat`, `settings`) reference a
  module-global `wol_server` instance.
- `app.run(debug=True)` — Flask debug/reloader is on.

Key routes (`wol_server_win.py`):

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | App shell (`index.html`), loads `/dashboard` via JS |
| `/dashboard` | GET | Host list fragment |
| `/status` | GET | JSON `{host: bool}` awake map |
| `/wake/<name>` | GET | Send WOL packet |
| `/shutdown/<name>` | GET | SSH shutdown |
| `/execute` | POST | **Runs an arbitrary command** via `cmd /k` on the host |
| `/prompt` | POST | Command box: routes `$`/`>`→execute, `k:`→Kobold, `o:`→OpenAI, else→draft |
| `/chat_api` | POST | Chat page → OpenAI-compatible endpoint |
| `/yt_caption`, `/yt_caption_api` | GET/POST | YouTube transcript download |
| `/ip_info` | GET | IP lookup placeholder |
| `/settings` | GET | Renders `settings.html` — **template does not exist yet** |

LLM access: `query_kobold_cpp` (raw `/api/v1/generate`) and `query_openai`
(OpenAI SDK against `cloud_inference_endpoint`, e.g. OpenRouter). `local_inference`
config flag picks the default backend.

---

## 5. Frontend architecture (current)

Server-rendered Jinja fragments + **Bootstrap 5.3** + Font Awesome, all from CDNs. `index.html`
is the shell; `static/libDyn.js` intercepts nav clicks, `fetch`es a route, drops the HTML into
`#content-area` via `innerHTML`, and — for `/chat`, `/ip_info`, `/yt_caption` — **`eval()`s the
`<script>` tags** in the fetched fragment to "activate" them. Status polling is `setInterval`
every 30s.

This works but has real limits: `eval()` of fragments, `setInterval` stacking on repeated
navigation, no state management, no build step, no bundling, CDN dependency, inline styles
duplicated across templates.

---

## 6. ⚠️ Security model — read before touching anything that executes

The app's safety rests **entirely** on Tailscale + no open ports + single trusted user. Within
that boundary it is intentionally permissive, but several things are genuinely dangerous and any
agent must preserve or improve — never weaken — them:

- **`/execute` runs arbitrary shell commands** as the server user (`cmd /k`, `shell=True`). There
  is **no authentication** on any route. Do not expose this server beyond the tailnet, do not add
  a public bind, do not remove the Tailscale assumption.
- **SSH credentials are stored in plaintext** in `config.yaml` and used with
  `AutoAddPolicy()` (no host-key verification). `config.yaml` is gitignored — keep it so.
- `debug=True` exposes the Werkzeug debugger (RCE if reachable). Fine for trusted LAN; never ship
  it to anything exposed.
- The `eval()` of fetched script fragments would be an XSS vector if any fetched content were
  attacker-influenced.

When improving this, prefer the **typed-action** approach (Section 7): the agent and UI request
named, allowlisted actions (`wake_host`, `restart_service`, …) instead of sending raw shell text
to a privileged path.

---

## 7. Where this is going — target architecture

The owner wants a **sleek, fast, responsive dashboard** for servers and their services, with
text + voice chat to an agent (STT + TTS via existing OpenAI-compatible backends, plus a SearXNG
MCP), that scales to more hosts/projects, and feels great on **both desktop and Android**.

> **As of 2026-05-27 this is being built ground-up in `dashboard_v2/`.** The canonical, decided
> plan lives in **`dashboard_v2/docs/`** (`DECISIONS.md`, `ARCHITECTURE.md`, `RESEARCH.md`,
> `TODO.md`) — **treat those as the source of truth** for the rebuild. The **Vapor** prototype
> (`ctrl-b (Vapor)/variations/vapor.html`) is the **visual** source of truth. The older
> `ws_codex_2/docs/SPEC.md` is earlier design notes, superseded by `dashboard_v2/docs/`.

Locked decisions (see `dashboard_v2/docs/DECISIONS.md`): mobile-first **PWA** (React+TS+Vite),
**FastAPI+Uvicorn** backend, **hybrid execution** (typed-action registry primary + one guarded,
logged, agent-excluded-by-default `run_shell` for the `$` escape hatch), **SQLite** for
chat/memory/events + **YAML** for config, three **deployment profiles** (Windows / Ubuntu /
Termux) off one Python codebase, chat via OpenAI-compatible **llama.cpp**`llama-server`/cloud,
voice via OpenAI-compatible **STT** (faster-whisper) + **TTS** (Kokoro/openedai-speech). Mic
needs a **secure context** → serve over HTTPS via **Tailscale Serve**.

Summary of the agreed direction (still applies, now realized in `dashboard_v2/`):

**Frontend**
- **React + TypeScript + Vite** (the prototypes already use React 19 / Vite 7 / TS). Build to
  static assets; Flask/the API can serve them.
- **TanStack Query** for polling host status and running action mutations (replaces ad-hoc
  `fetch` + `setInterval`).
- **lucide-react** for icons; plain CSS (or a small system) over heavy UI frameworks for v1.
- **Design language: dense local-admin console**, not a "control-room" glass dashboard.
  Tables/rows over decorative KPI tiles, ≤8px radii, color used only for state
  (online / warning / sleeping-stopped), short operational text, visible action history,
  confirmation dialogs for shutdown/restart/kill.
- **Responsive nav:** sidebar on desktop, **bottom navigation (3–5 destinations) on Android**.
- Optional: Radix primitives for accessible dialogs/menus/sheets when needed.

**Backend (decided: decoupled API + SPA, Python via FastAPI)**
- The rebuild uses a **decoupled architecture**: a Python **FastAPI** service exposes a JSON API +
  WebSocket/SSE, and the React SPA is a separate client. FastAPI over Flask for the rebuild because
  of async (concurrent host pings/SSH/streaming), native WebSocket, Pydantic typed models that map
  onto the typed-action registry, and auto-generated OpenAPI. Run with Uvicorn.
- API surface: `/api/hosts`, `/api/hosts/:id`, `/api/hosts/:id/status`, `/api/hosts/:id/wake`,
  `/api/hosts/:id/shutdown`, `/api/services`, `/api/services/:id/actions/:action`, `/api/events`,
  `/api/agent/chat`, `/api/voice/stt`, `/api/voice/tts`.
- **Typed action registry**: UI buttons and agent tool-calls both route through the same
  allowlisted actions (`wake_host`, `shutdown_host`, `restart_service`, `start_service`,
  `stop_service`, `open_service_url`, `switch_gpu_workload`, `run_health_check`). No arbitrary
  shell as the primary UX.
- Model hosts/services as first-class entities (`Host`, `Service`, `Action`, `Event`,
  `AgentSession`) per the SPEC. No database until in-UI editing of hosts/services is needed.
- Use **SSE or WebSocket** for streaming logs / long commands / realtime voice.
- The existing **Flask app (`wol_server_win.py`) stays running until cutover** — FastAPI is the new
  service, not an in-place edit of the old one.

**Voice / agent**
- STT + TTS through OpenAI-compatible endpoints already owned (e.g. Whisper for STT;
  `openedai-speech` / Piper / Kokoro-style servers for TTS). Push-to-talk for STT, audio playback
  for TTS. Target sub-300ms perceived latency for natural feel where possible.
- Agent gets tools = the typed action registry + a **SearXNG MCP** for web search.

**Active workspace: `dashboard_v2/`** — the chosen, **self-contained** rebuild (decoupled
frontend + FastAPI backend in one folder). It copies needed assets (logo/favicon) rather than
importing them and does not touch the live Flask app. The earlier `ws_claude*/` and `ws_codex*/`
folders are prior UI experiments, **superseded** and reference-only; the Vapor HTML is the visual
target the v2 frontend ports.

**Migration stance:** `dashboard_v2/` is **standalone and must not import or modify the live Flask
app**. Build the FastAPI API + PWA there, run it alongside the old server, migrate `config.yaml`,
then cut over (see `dashboard_v2/docs/TODO.md` Phase 10). Don't break the working
`wol_server_win.py` while building v2.

---

## 8. Conventions & gotchas

- **Edit `wol_server_win.py`, not `wol_server.py`**, unless the task is explicitly Linux WOL/monitor.
  Don't assume the two are in sync — they aren't.
- Windows host: shell is **PowerShell**. Paths use backslashes. `subprocess` calls assume Windows
  in the win server, Linux in the Linux server.
- Secrets (`config.yaml`, `clients`, `*_prompt.*`) are gitignored — never commit them, never paste
  their contents into code or logs, never echo SSH passwords.
- `prompt_sample.txt`/`command_prompt.txt` drive *command drafting*; `system_prompt.txt` drives
  *chat*. They are different prompts for different features — don't conflate them.
- `ws_codex/` and `ws_codex_2/` are **untracked agent worktrees**. Don't commit them into the main
  tree without the owner's intent; they're experiments. If consolidating, fold the chosen design
  into a tracked `web/` (or similar) directory deliberately.
- `settings.html` is referenced by the `/settings` route but doesn't exist — that route 500s.
- Known rough edges to fix opportunistically: duplicated inline `<style>` blocks across templates,
  `setInterval` stacking in `libDyn.js`, unpinned `requirements.txt`, mixed route-registration
  styles, `query_openai` referencing `completion` in its `except` before assignment.

---

## 9. Working agreement for agents

- This is a **single-user homelab tool**, not production SaaS. Favor simple, direct solutions over
  enterprise scaffolding. But **never weaken the security boundary** in Section 6.
- When asked to "make the dashboard better," default to the Section 7 direction and `SPEC.md`
  rather than re-theming Bootstrap.
- Confirm before destructive or hard-to-reverse actions (deleting templates, rewriting the live
  server, force-pushing). The owner connects from Android — keep changes testable at narrow widths.
- Commit only when asked. Keep commits scoped; don't sweep the untracked `ws_codex*` dirs in.
