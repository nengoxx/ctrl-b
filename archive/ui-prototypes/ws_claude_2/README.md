# ws_claude_2 — ctrl-b fleet console (prototype)

A standalone React + TypeScript + Vite prototype of the next ctrl-b UI: a dense,
fast, responsive console for the homelab fleet (corsair / vault / g5 / emma) with a
text + voice agent docked alongside it. It does **not** import or modify the live
Flask app (`wol_server/wol_server_win.py`) and runs entirely on mocked data.

## Run

```powershell
cd ws_claude_2
npm install
npm run dev        # http://localhost:5173  (also on 0.0.0.0 for the phone via Tailscale)
```

Or from the repo root, double-click / run **`start_ws_claude_2.cmd`** — it installs
deps on first run and starts the dev server.

```powershell
npm run build      # typecheck + production build to dist/
npm run typecheck  # types only
```

## What's here

- **Dense admin-console layout** — sidebar (desktop) / bottom nav (Android), top bar
  with live fleet counts, search, theme toggle, refresh, and an agent toggle. Color is
  used only for state (online / warning / sleeping-stopped / danger).
- **Hosts** — cards with status, LAN + Tailscale addresses, CPU/MEM/GPU meters, uptime,
  tags, and wake / shutdown (shutdown is confirmed).
- **Services** — grouped by host, typed actions (start / stop / restart / health check /
  switch GPU workload), open-endpoint links. Destructive actions are confirmed.
- **Agent dock** — persistent right rail (floats over content on narrow viewports). Text
  + push-to-talk voice (Web Speech API stand-in) + TTS toggle. Agent replies show the
  **typed tool calls** they made — never raw shell.
- **Command palette** — `Ctrl/⌘ K`: jump to a view, wake/shutdown any host, restart any
  service, toggle theme.
- **Projects** — hosts/services group into projects so the fleet scales without code
  changes.
- **Overview / Activity / Settings** — fleet summary, event feed, and an endpoint/voice
  settings scaffold.

## Architecture & the path to a real backend

- `src/types.ts` — the domain model (Host / Service / Action / Event / Project / ChatMessage),
  shared by the mock and the future backend.
- `src/api/client.ts` — the `CtrlbApi` interface every view depends on.
- `src/api/mock.ts` — in-memory implementation with the real fleet names. Actions mutate
  state and metrics jitter so polling visibly updates.
- `src/api/queries.ts` — TanStack Query hooks. **All polling lives here** (replacing the old
  `setInterval` stacking) and mutations invalidate the right caches.

**Going live:** write one object implementing `CtrlbApi` over `fetch` against the FastAPI
routes in `ws_codex_2/docs/SPEC.md` (`/api/hosts`, `/api/services/:id/actions/:action`,
`/api/agent/chat`, `/api/voice/stt`, `/api/voice/tts`), swap the `api` constant in
`queries.ts`, and point Vite's dev proxy at the backend (commented in `vite.config.ts`).
No view changes required.

The voice layer (`src/lib/voice.ts`) already isolates STT/TTS: the browser stand-ins sit
behind the same functions that will call `/api/voice/stt` (Whisper) and `/api/voice/tts`.

## Security stance

Mirrors the project's model: typed actions only — the UI and the agent both request
allowlisted operations, never raw shell. Tailscale-only, no public exposure.
