# Research notes — dashboard_v2

Framework/library survey backing the choices in `DECISIONS.md`. Versions are current as of
**2026-05**; treat them as starting pins, bump at scaffold time. Sources at the bottom.

---

## Frontend

### Framework — React 19 + TypeScript + Vite 7 (chosen)

- The three prior prototypes (`ws_claude`, `ws_claude_2`, `ws_codex_2`) all converged on
  **React 19.2 + Vite 7.2 + TS 5.9 + TanStack Query 5.62 + lucide-react 0.468**. Reuse that
  baseline — it's proven against this exact design and the team already knows it.
- "Snappy on Android" is **not** primarily a framework problem here. The app is small (4 tabs,
  a list, a chat log). React 19's compiler + Vite's code-splitting are more than enough. The
  wins that actually matter on a phone:
  - Ship a **small bundle** (tree-shake icons — import individual `lucide-react` icons, not the
    barrel; the Vapor design uses inline SVG masks for most glyphs anyway, so the icon dep stays
    tiny).
  - **No layout thrash** in the chat log / status poll (virtualize only if a thread gets huge).
  - **PWA app-shell caching** so repeat opens are instant.
- Lighter alternatives (Svelte 5, SolidJS) would shave a few KB and micro-bench faster, but
  abandon the working prototypes, the team's familiarity, and TanStack Query's maturity. Not
  worth it for this size. **Decision: React.**

### State & data

- **TanStack Query** for all server state: host status polling (replaces the old
  `setInterval`/`eval` mess in `libDyn.js`), action mutations, settings, threads. Built-in
  caching, refetch intervals, and request dedup.
- **UI-only state** (active tab, theme, tts-on, composer text): React context or a tiny
  `zustand` store. No Redux.
- **Streaming chat:** consume the agent SSE endpoint with `fetch` + `ReadableStream` (or
  `EventSource` for GET). Append tokens to the active message.

### PWA + voice

- **`vite-plugin-pwa`** (Workbox under the hood) for the manifest + service worker (app-shell
  precache, offline shell). Keep runtime caching conservative — never cache `/api` mutations.
- **Mic capture:** `navigator.mediaDevices.getUserMedia({audio:true})` → `MediaRecorder`
  (webm/opus or mp4 depending on platform) → upload blob to `/api/voice/stt`. Push-to-talk:
  start on press, stop on release.
  - ⚠️ **Secure-context requirement** — works on `localhost` and HTTPS only. On Android over
    Tailscale this **mandates HTTPS** (Tailscale Serve cert). This is the single biggest
    Android gotcha; see `DECISIONS.md` D1.
- **TTS playback:** `/api/voice/tts` returns audio (wav/mp3); play via an `<audio>` element or
  Web Audio `AudioContext`. Auto-speak gated by the header TTS toggle (Vapor `#ttsToggle`).

### Secure context for the mic (the Android HTTPS question)

`getUserMedia`/`MediaRecorder` are gated on a **secure context**. Per MDN, a context is secure
if it's **HTTPS** *or* **loopback** (`http://localhost`, `http://127.0.0.1`, `http://*.localhost`).
Crucially, **Tailscale `100.x` and LAN `192.168.x` are not loopback** → plain HTTP to them is
**not** secure → mic blocked on the phone. Routes to a secure context, ranked:

1. **Tailscale Serve (chosen).** Real auto-renewed Let's Encrypt cert for `https://<host>.<tailnet>.ts.net`,
   **tailnet-only** — the device must be on the tailnet to reach it; nothing is public.
   - *Serve vs Funnel:* **Serve = private/tailnet-only; Funnel = public** (routes internet traffic
     in via Tailscale relays, listens only on 443/8443/10000). We use Serve, never Funnel.
   - FastAPI binds `127.0.0.1:5432`; Serve fronts HTTPS on the `ts.net` name. SPA + `/api` on one
     origin ⇒ no mixed content. Bookmark the `ts.net` URL on the phone, not the `100.x` IP.
   - Cost: enable MagicDNS + HTTPS in the tailnet (one-time), then a `tailscale serve` config.
2. **Loopback (Termux profile only).** If the phone *is* the server, `http://localhost:5432` is a
   secure context → mic works with no HTTPS and no flag. N/A when the phone is just a client.
3. **Native WebView wrapper.** Capacitor/Tauri WebView runs from a secure-context origin (mic OK),
   but you must permit cleartext to the `http://100.x` API. Only if going native anyway.
4. **Chrome `unsafely-treat-insecure-origin-as-secure` — NOT viable on stock Android.** The
   command-line flag needs a rooted/dev device (you can't pass Chrome flags on a normal phone), and
   the `chrome://flags` entry is being deprecated/removed. Don't rely on it.

Self-signed certs + installing a custom CA on the phone would also work but are strictly more work
than Serve's free trusted cert, so they're not worth it.

### Design system

- Port the Vapor CSS variable system verbatim: three palettes via `[data-theme]`
  (`vapor`/`aqua`/`ember`), skyline `city`/`mountains`, animated hero (toggleable), bottom tab
  bar with sliding indicator, command-bubble styling. It's already responsive and touch-sized.
- Material guidance backs the layout split: **bottom navigation** for 3–5 destinations on
  compact widths, side nav on expanded widths.
- Radix primitives only if/when accessible dialogs/menus/sheets are needed (confirmation
  dialogs for shutdown/kill are a good candidate).

---

## Backend

### FastAPI stack (chosen)

| Dep | Role | Note |
|---|---|---|
| `fastapi` + `uvicorn[standard]` | API + ASGI server | async; WebSocket/SSE native |
| `pydantic` v2 + `pydantic-settings` | typed models, settings | one source for validation + OpenAPI + agent tool schemas |
| `sse-starlette` | Server-Sent Events | streaming chat / event feed / live logs |
| `paramiko` | SSH (shutdown, remote exec) | already used; keep `AutoAddPolicy` note in security model |
| `wakeonlan` | WOL magic packets | already used; cross-platform UDP |
| `openai` | chat / STT / TTS clients | one SDK, different `base_url` per backend |
| `httpx` | async HTTP | for llama.cpp raw `/completion` or anything non-SDK |
| `pyyaml` | config read/write | keep `config.yaml` shape |
| `python-multipart` | audio upload parsing | `/voice/stt` receives a file |
| `youtube-transcript-api`, `beautifulsoup4` | Utils: YT captions | port as-is |
| `aiosqlite` *or* stdlib `sqlite3` | persistence | threads/messages/memory/events |

- Use `pyproject.toml` with **pinned** versions (the old `requirements.txt` is unpinned — fix
  that). Optionally `uv` for fast, reproducible installs on both OSes.
- **SPA serving:** in prod, FastAPI serves the built `frontend/dist` via `StaticFiles` with an
  SPA fallback to `index.html`; in dev, Vite dev server proxies `/api` → uvicorn. Single origin
  in prod keeps cookies/CORS/secure-context simple.

### LLM backends — all OpenAI-compatible, just different base URLs

- **Cloud chat:** OpenAI-compatible endpoint you already use (e.g. OpenRouter) →
  `/v1/chat/completions`.
- **Local llama.cpp:** `llama-server` exposes a standard **`/v1/chat/completions`** (default
  ChatML template; port 8080 by default). Point the same `openai` client at
  `http://<gpu-box>:8080/v1`. (It also has a native `/completion` if you want raw control — use
  `httpx` for that.) This replaces the old KoboldCpp `/api/v1/generate` path; KoboldCpp can stay
  as a secondary option since it *also* offers an OpenAI-compatible route.
- **STT (voice in):** a self-hosted **faster-whisper** server exposes OpenAI-compatible
  **`/v1/audio/transcriptions`** (e.g. `Speaches`, `hwdsl2/docker-whisper`). Send the recorded
  blob, get text.
- **TTS (voice out):** **Kokoro-FastAPI** or **openedai-speech** expose OpenAI-compatible
  **`/v1/audio/speech`** (`{model, input, voice, response_format}` → audio). 50+ voices, runs on
  CPU or GPU.

Net: **one `openai` client shape** covers chat (cloud + local), STT, and TTS — each is just a
configurable `base_url` + key + model + (for voice) voice-name in `config.yaml`, surfaced in the
Conf tab.

### Agent / tool-calling

- Expose the typed-action registry as OpenAI **`tools`** (function-calling). Pydantic input
  models → JSON Schema for free.
- Capability fallback: some local GGUF models do tool-calling poorly. Detect/configure per
  backend; for weak models, fall back to the Vapor pattern — the model *drafts* a command/action
  into a reviewable bubble and the human confirms (mirrors today's command-box UX).
- **Aggregated toolset:** the model sees typed actions + `agent_exposed` utility tools + MCP tools
  as one tool list (namespaced to avoid collisions).
- **MCP client (D9):** use the **official Python MCP SDK** to connect as a client to the owner's
  servers over **stdio** and **Streamable HTTP** (the current spec transport; supersedes the old
  HTTP+SSE transport). Discover tools per server; namespace + merge into the toolset; isolate
  per-server failures. `embeddings` = OpenAI-compatible `/v1/embeddings` (llama.cpp), configurable.
- **SearXNG:** the owner runs a local instance — a built-in `web_search` tool hits its
  `format=json` API (configurable URL); optionally consume a SearXNG MCP server instead.

---

## Cross-OS / deployment

- Python 3.11+ identical on Win11 and Ubuntu 26; `uvicorn` runs on both. WOL is cross-platform
  UDP. The only OS-specific bits — ping flags (`-n` vs `-c`) and service commands
  (`Start-Service` vs `systemctl`) — live behind the action layer / a small `platform` shim.
- Ubuntu: `systemd` unit (model on the existing `wol_server/wol_server.service`).
- Android/Termux: Python + FastAPI run under Termux; `termux-wake-lock` + foreground service +
  charger to survive Doze; bind high port. WOL works only while the phone is on the target LAN.

---

## Sources

- llama.cpp server (OpenAI-compatible `/v1/chat/completions`): <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
- llama-server + OpenAI endpoint deployment guide: <https://unsloth.ai/docs/basics/inference-and-deployment/llama-server-and-openai-endpoint>
- Self-hosted Whisper STT, OpenAI-compatible `/v1/audio/transcriptions` (faster-whisper): <https://github.com/hwdsl2/docker-whisper>
- Whisper installer (OpenAI-compatible STT API): <https://github.com/hwdsl2/whisper-install>
- Kokoro-FastAPI TTS, OpenAI-compatible `/v1/audio/speech`: <https://github.com/hwdsl2/docker-kokoro/>
- openedai-speech (xtts_v2 / piper, OpenAI TTS-compatible): <https://github.com/matatonic/openedai-speech>
- LibreChat STT/TTS config (reference for OpenAI-compatible voice wiring): <https://www.librechat.ai/docs/configuration/stt_tts>
- Material 3 navigation bar (bottom nav for 3–5 destinations): <https://m3.material.io/components/navigation-bar/overview>
- Android responsive navigation guidance: <https://developer.android.com/develop/ui/views/layout/build-responsive-navigation>
- Radix primitives accessibility: <https://www.radix-ui.com/primitives/docs/overview/accessibility>
- TanStack Query: <https://tanstack.com/query/latest/docs/react/overview>
- vite-plugin-pwa: <https://vite-pwa-org.netlify.app/>
- MDN `getUserMedia` secure-context requirement: <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia>
- MDN Secure Contexts (HTTPS + loopback exceptions): <https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts>
- Tailscale Serve (HTTPS, tailnet-only): <https://tailscale.com/kb/1312/serve>
- Model Context Protocol — transports (stdio + Streamable HTTP): <https://modelcontextprotocol.io/docs/concepts/transports>
- MCP Python SDK (client): <https://github.com/modelcontextprotocol/python-sdk>
- SearXNG search API (`format=json`): <https://docs.searxng.org/dev/search_api.html>
- Tailscale enabling HTTPS / cert provisioning: <https://tailscale.com/docs/how-to/set-up-https-certificates>
- Tailscale Funnel (public exposure — the thing we do NOT enable): <https://tailscale.com/docs/features/tailscale-funnel>
- Chromium: deprecating powerful features on insecure origins (why the flag route is dead on Android): <https://www.chromium.org/Home/chromium-security/deprecating-powerful-features-on-insecure-origins/>
