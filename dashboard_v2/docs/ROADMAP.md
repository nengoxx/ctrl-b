# Roadmap & future additions — dashboard_v2

Features the owner wants *eventually*. They're recorded here so the **v1 architecture leaves room
for them** — the "build it extensibly now, implement later" list. Nothing here is v1 scope unless
also in `TODO.md`. Each item: **what · why/UX · design implication · open questions.**

Guiding principle: build the v1 seams (pluggable memory, action risk levels, typed chat-message
kinds, streaming-or-not endpoint, a settings/policy layer) so these slot in without a rewrite.

---

## A. Agent capability & control

### A1. Agent privilege levels (like Claude Code / Codex)

- **What:** a selector for how much the agent may do on its own, from read-only up to full
  autonomy. Suggested ladder:
  1. **Read-only / Plan** — can inspect + suggest, runs nothing.
  2. **Confirm each** — proposes every action as a bubble; user approves each (Claude Code "ask").
  3. **Auto low-risk** — runs `risk=low` actions automatically, confirms `med`/`high`.
  4. **Full privileges** — runs everything automatically, **including the guarded `run_shell`**
     (the "YOLO" mode; clearly labeled dangerous).
- **Design implication:** this is a **policy layer over the action registry** — every action
  already carries a `risk` level (see `ARCHITECTURE.md` §1), so privilege = "auto-run threshold +
  whether `run_shell` is unlocked." Set globally, **overridable per chat session and per
  automation** (see A3). Persist in settings; surface the active level in the composer/header.
- **Open:** per-host privilege overrides? a time-boxed "full for next 10 min" escalation?

### A2. Agent asks questions (clarifications, not just commands)

- **What:** the agent can ask the user a question mid-task — for missing info or to disambiguate —
  exactly like Claude Code's question prompts, optionally with suggested answers.
- **Design implication:** the chat protocol must be **typed message kinds**, not just text. v1
  already plans `text` / `command|action` bubbles; add a **`question`** kind (prompt + optional
  choice chips + free text), and the agent loop must **pause for the answer** and resume. This is
  the same shape as the action-confirm flow, so build the chat loop turn-based from day one.
- **Notify when blocked (ties A1+A3+F1):** when the agent needs input — a clarifying **question**,
  or a **confirm** it lacks privilege for — and **no human is present** (low-privilege mode or a
  headless automation), **fire a notification** (F1) and park the turn until the user answers, then
  resume. This is the key bridge: a low-privilege or scheduled agent that hits a decision point
  pings the phone, the user opens the app, answers, the agent continues.
- **Open:** timeout/abandon behavior; per-automation fallback when unattended (notify-and-wait /
  use-default / skip).

### A4. Composer as a console — prefix routing & slash commands

- **What:** the chat composer doubles as a command console (Claude-Code-style):
  - `!<cmd>` → run shell directly via guarded `run_shell`. **Only** command prefix; sigil
    **configurable in settings** (default `!`). No `$`/`>`.
  - `/<command> [args]` → **slash commands** for app/agent verbs (`/wake`, `/sleep`, `/clear`,
    `/model`, `/help`, …) → typed actions or UI ops, **including `/local` and `/cloud`** to force
    the inference backend for one message (replaces the disliked `k:`/`o:`). Extensible/custom
    slash commands managed in settings (Integrations).
- **Design implication:** a small **input router** in the composer maps prefixes → handlers; bot
  replies render **markdown** with **copy / send-to-composer** on code blocks (generalize Vapor
  `editCmd`/`cmdInto`). See `ARCHITECTURE.md` §5. *(Prefix routing + formatting + `/local`,`/cloud`
  is effectively v1; custom/extensible slash commands are the post-v1 part.)*
- **Open:** slash-command registry shape; how custom commands are defined (config vs UI);
  configurable command sigil storage.

### A3. Scheduled agent automations (cron triggers)

- **What:** define automations that **invoke the agent on a schedule with a configurable prompt**
  (the "openclaw"-style pattern: cron + a saved prompt + a privilege level → the agent runs the
  task unattended). E.g. "every night at 2am, check the fleet and sleep idle GPU boxes," "on
  Monday 8am summarize the week's events."
- **Design implication:** a new **scheduler subsystem** — stored `Automation { id, name, cron,
  prompt, privilege_level, target_thread, enabled, last_run, last_status }` in SQLite; a runner
  (APScheduler-style or a simple async cron loop in the FastAPI process). Reuses the same agent +
  action registry as interactive chat, just headless. Results land in the Event log + a thread.
- **Open:** what happens when an automation hits a `question` (A2) or a `confirm` action with no
  human → per-automation policy (skip / use default / notify and wait). Concurrency limits. This is
  a sizeable module — likely its own post-v1 phase.

---

## B. Memory (configurable, pluggable)

### B1. Selectable memory backends

- **What:** options in settings to choose how the agent remembers — and to manage it there:
  - **None** — stateless beyond the current thread.
  - **File-based** — a human-editable markdown file (`MEMORY.md` / `CLAUDE.md`-style; pinned facts,
    durable prefs). Git-diffable, transparent, exactly like Claude Code's memory.
  - **Vector** — embeddings store for semantic recall over past conversations/events.
  - **Both** — file for durable curated facts + vector for fuzzy recall.
  - (Orthogonal) **rolling summary** — compress old turns to stay in context; can pair with any of
    the above.
- **Design implication:** define a **`MemoryProvider` interface** in v1 (`load_context()`,
  `remember(item)`, `forget(id)`, `list()`) with a `none`/`file` impl first; `vector` is a drop-in
  later (needs an embeddings endpoint — could be another OpenAI-compatible `/v1/embeddings` base
  URL, fitting the existing pattern). Don't hardcode a single memory mechanism.
- **Open:** which embeddings backend; chunking strategy; whether memory is global vs per-thread vs
  per-project; retention/pruning UI.

---

## C. Voice

### C1. Streaming with non-streaming fallback (chat + voice)

- **What:** streaming responses by default, with a **toggle** (`auto | on | off`) and graceful
  fallback when a backend doesn't support SSE/streaming.
- **Design implication:** the `/api/agent/chat` endpoint supports **both** a streaming (SSE) and a
  buffered (single JSON) response from day one; the client honors the setting. Same idea for STT
  (record-then-send vs streaming transcription) and TTS (full-clip vs chunked playback). Build the
  contract so non-streaming is a first-class path, not an afterthought.

### C2. Wake word

- **What:** optional always-listening **wake word** ("hey ctrl-b") to start dictation hands-free.
- **Design implication:** runs **client-side in the browser** (e.g. openWakeWord / Porcupine WASM)
  so **no audio leaves the device** until the wake word fires — then it opens the mic and routes to
  the existing STT path. Off by default; a settings toggle + sensitivity.
- **Open:** browser background-listening reliability on Android (tab must be foregrounded / PWA
  active); battery; secure-context still required (same Tailscale-Serve HTTPS need as the mic).
  Feasibility flagged — "if possible."

---

## D. Fleet automation

### D1. Idle shutdown / sleep (per-host, Windows + Linux) — **optional / opt-in**

- **What:** a per-host **opt-in** toggle — on idle for *N* minutes, **sleep** or **shut down** the
  host. Configurable action + threshold, independently for Windows and Linux machines. Off by
  default; enabled per host.
- **Design implication:** new `Host` fields (`idle_action: none|sleep|shutdown`, `idle_minutes`)
  surfaced in the Conf machine form; enforced by the scheduler (A3) or a dedicated monitor loop.
  Actions map per-OS (`shutdown`/`rundll32 powrprof` or `psshutdown` on Windows; `systemctl
  suspend`/`shutdown` on Linux).
- **⚠️ Hard part — detecting *real* idle remotely:** GUI/input idle time isn't cleanly queryable
  over SSH (CPU% and TTY idle aren't the same as "user is away"). Likely needs a **tiny helper
  agent on each host** reporting last-input/idle (Windows `GetLastInputInfo`; Linux `xprintidle`/
  loginctl), or a heuristic (no active sessions + low CPU). **Open + non-trivial** — decide the
  detection mechanism before building.

### D2. Wake-on-connection

- **What:** (from the old README TODO) auto-wake chosen hosts when the phone/owner joins the
  LAN/tailnet.
- **Design implication:** needs a trigger on tailnet/LAN join — a tailnet event hook or a poll for
  the owner's device coming online → fire `wake_host`. Pairs with the scheduler.
- **Open:** how to detect "owner is back" reliably without a public surface.

---

## E0. More tools (the extensible Utils registry — D8)

- **What:** the Utils tab is a **tool registry** (one file per tool → endpoint + card + optional
  agent tool; see `ARCHITECTURE.md` §1). v1 ships `yt_captions`, `ip_info`, and `dns_trace`.
- **Easy future drop-ins:** whois, reverse-DNS / PTR, port check, ping/MTR, HTTP header inspector,
  TLS-cert info, speedtest, subnet calculator, MAC-vendor lookup, "wake-and-open" combos. Each is a
  handler + Pydantic input + metadata — no routing/UI/agent wiring by hand.
- **Open:** which tools to prioritize; whether any need long-running/streaming output (reuse SSE).

## E. Alternate frontends

### E1. Discord / Telegram bots as thin clients

- **What:** revive the old `ctrl+discord.py` / `ctrl+telegram.py` stubs — but as **thin clients to
  the same FastAPI**, not separate logic. Chat with the agent / trigger actions from Discord or
  Telegram.
- **Design implication:** because all logic lives behind the typed API + action registry, a bot is
  just another client calling `/api/agent/chat` + `/api/actions/*`. Keep the API the single source
  of truth so frontends stay thin (browser PWA, native app, bots, automations all share it).
- **Open:** auth/identity for bot channels (still tailnet-only? a bot bridges *out* to Discord/TG —
  reconcile with the no-public-exposure model: the bot process runs on the tailnet and polls those
  services outbound, which is fine).

---

## F. Notifications

### F1. Push to phone on fleet events

- **What:** notify when a host wakes/dies, an automation finishes, an action fails, or — key —
  **the agent needs input it can't get** (a `question` or a `confirm` it lacks privilege for, while
  unattended; see A2). That last one turns notifications into the response channel for a
  low-privilege/headless agent.
- **A native app is NOT required.** Three delivery channels, by scenario:
  1. **App open/foregrounded → Notifications API** triggered by the existing SSE stream. Pure
     client-side, no external dependency. *(v1-trivial.)*
  2. **App closed/backgrounded → Web Push** (service worker + VAPID; server sends outbound to the
     push service, FCM on Android). Survives a closed tab on an **installed Android PWA**. Delivers
     even when the phone is off the tailnet; no inbound exposure (server→FCM is outbound, payloads
     E2E-encrypted). Cost: depends on Google FCM + subscription plumbing. Needs HTTPS (already have
     it via Tailscale Serve).
  3. **Self-hosted ntfy or Telegram/Discord bot (recommended for background).** ntfy: tiny
     pub/sub on the tailnet, server POSTs, ntfy Android app receives — **instant delivery without
     Google FCM** (its app holds a persistent connection; phone must be on the tailnet to receive).
     Bot (E1): runs on the tailnet, connects outbound to Telegram/Discord → rock-solid background
     push anywhere, zero new infra, doubles as an alternate frontend.
- **Decided defaults:** the whole notifications feature is **optional — master toggle in
  settings** (off = nothing fires). When enabled, the **PWA-native stack is the default and is
  wired automatically**:
  - **app open → foreground** Notifications API driven by the SSE stream;
  - **app closed → Web Push** (service worker + VAPID).
  Both on by default once notifications are enabled; no extra infra beyond generating VAPID keys.
  **ntfy (self-hosted)** and the **Telegram/Discord bot** are **optional** extra channels (for
  no-FCM / off-tailnet / chat-app delivery), off unless configured. **Per-event toggles** in
  settings decide *which* events notify. A native app is never required.

> **How Web Push works (and why FCM + VAPID).** Four actors: the **PWA**, its **service worker**
> (background script that survives the tab closing and shows the notification), the **push
> service** (run by the *browser vendor* — FCM for Chrome/Android, Mozilla for Firefox, Apple for
> Safari; you don't choose it), and your **backend**. A phone can't be reached directly (NAT,
> asleep, battery), so the OS keeps **one** persistent push connection to the vendor's service and
> every site shares it — on Android that pipe is **FCM**, which is why it's unavoidable there.
> Flow: (1) PWA requests permission; service worker `subscribe()`s → browser returns a
> **subscription** = an endpoint URL at FCM + encryption keys; (2) PWA stores that on your backend;
> (3) to notify, backend **encrypts** the payload with the subscription key, **signs** with its
> **VAPID** private key, POSTs to the FCM endpoint; (4) FCM wakes the service worker →
> `showNotification()`. **VAPID** = a self-issued identity keypair so the push service trusts your
> messages (rejects spoofers) and — crucially — lets you send **without a Firebase project**, just
> your own keys (`pywebpush`/`web-push`). Server calls are **outbound-only** (no inbound exposure),
> payloads are **E2E-encrypted** (FCM relays ciphertext), needs HTTPS (Tailscale Serve covers it),
> and it delivers **even when the phone is off the tailnet** — the main edge over self-hosted ntfy.
- **Open:** which channel(s) to wire first; which events are notify-worthy (user-configurable);
  ntfy tailnet-only vs needing off-tailnet delivery (→ Web Push or bot for that).

---

## G. Security hardening (post-v1)

- SSH `known_hosts` pinning instead of `AutoAddPolicy` (note in `ARCHITECTURE.md` §7).
- Per-action confirmation tokens / signed action requests.
- Audit-log export + retention controls.
- Optional encryption-at-rest for secrets in `config.yaml` (vs plaintext today).

---

## Settings tab — organized by functionality (informs v1 Conf layout)

Even pre-implementation, lay out the Conf tab in **functional groups** so these land in obvious
homes later:

- **Inference** — backend mode (local llama.cpp / cloud), endpoints, keys, models, embeddings URL.
- **Agent** — privilege level (A1), streaming mode (C1), prompts (system/command/post), tool/action
  allowlist, ask-questions behavior (A2).
- **Memory** — backend selector (B1: none/file/vector/both), rolling-summary toggle, view/edit
  file memory, prune/clear, vector store status.
- **Voice** — STT endpoint/model, TTS endpoint/voice/model, auto-TTS, wake word (C2).
- **Automations** — scheduled agent tasks (A3): list, cron, prompt, privilege, enable/disable.
- **Fleet / Hosts** — host CRUD + per-host idle action & threshold (D1), wake-on-connection (D2).
- **Server** — host/port, poll interval, debug, Tailscale-Serve/HTTPS status.
- **Notifications** — master on/off; default PWA-native (foreground + Web Push, auto); optional
  ntfy / Telegram-Discord channels; per-event toggles (F1).
- **Appearance** — theme, skyline, hero, waveform (from Vapor).
- **Integrations** — Discord/Telegram bots (E1), SearXNG MCP.
