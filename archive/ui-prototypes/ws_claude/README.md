# ctrl-b · ws_claude

Standalone React + TypeScript + Vite workspace for the next-gen `ctrl-b` dashboard.
It does **not** import or modify the live Flask app; assets are copied, not shared.

```powershell
npm install
npm run dev      # http://127.0.0.1:5173  (also on 0.0.0.0 for LAN/Tailscale access)
npm run build    # type-check + production build to dist/
```

## What this is

A dense local-admin console for the fleet (`corsair`, `vault`, `g5`, `emma`), with text +
voice access to an agent. Design follows `../ws_codex_2/docs/SPEC.md`: tables/rows over
decorative tiles, color reserved for state, sidebar on desktop / bottom nav on Android,
confirmation on destructive actions.

## Structure

```
src/
  types.ts            domain model (Host, Service, Action, Event, ChatMessage)
  api/
    client.ts         CtrlbApi interface the UI depends on
    mock.ts           in-memory mock fleet (current data source)
    queries.ts        TanStack Query hooks (polling + mutations)
  components/common.tsx   StatusDot, ConfirmModal, time helpers
  views/              HostsView, ServicesView, ActivityView, AgentView
  App.tsx             shell: sidebar / topbar / bottom nav + view routing
  index.css           design system (tokens + layout + components)
```

## Going live (FastAPI backend)

The UI talks only to the `CtrlbApi` interface. To connect the real backend:

1. Implement `CtrlbApi` with `fetch` against the FastAPI JSON API
   (`/api/hosts`, `/api/services`, `/api/.../actions/...`, `/api/events`, `/api/agent/chat`).
2. Swap `const api = mockApi` in `src/api/queries.ts` for the HTTP client.
3. Uncomment the `/api` proxy in `vite.config.ts` (points at the FastAPI dev server).
4. Replace the browser Web Speech STT/TTS in `AgentView` with `/api/voice/stt` (Whisper)
   and `/api/voice/tts` audio playback against your OpenAI-compatible endpoints.

Execution stays behind a **typed action registry** — the UI and agent request named,
allowlisted actions, never raw shell.
