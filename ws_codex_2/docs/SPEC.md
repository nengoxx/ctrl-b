# ctrl-b Dashboard Prototype Specification

## Scope

This folder is a standalone UI experiment for the next version of `ctrl-b`. It does not import or modify the existing Flask app. The prototype uses mocked data so the design can be tested before any backend migration.

The goal is a compact dashboard for servers and services available over LAN and Tailscale MagicDNS, with text and voice access to an agent. The first version should stay small: React, TypeScript, Vite, plain CSS, and a small icon library.

## Product Goals

- Show every important host at a glance.
- Make service state and service actions visible without digging through pages.
- Work well on desktop and Android.
- Keep high-risk actions confirmable and auditable.
- Let the agent prepare actions, but route execution through typed backend actions.
- Support future growth without turning the project into a large platform.

## Non-Goals

- No public internet exposure.
- No database until editing hosts/services in the UI becomes necessary.
- No WebSocket requirement until streaming logs, long-running commands, or realtime voice require it.
- No complex component framework in the first UI pass.
- No freeform shell execution as the main UX.

## Information Architecture

Primary entities:

- Host: `name`, `role`, `os`, `magicDnsName`, `lanIp`, `status`, `metrics`, `tags`.
- Service: `host`, `name`, `kind`, `port`, `state`, `endpoint`, `actions`.
- Action: `target`, `type`, `risk`, `inputs`, `confirmationRequired`, `status`.
- Event: immutable activity entry from status checks, user actions, and agent-prepared operations.
- Agent session: text or voice conversation with tool calls routed to the same action registry as UI buttons.

Desktop layout:

- Left navigation: hosts, services, agent, activity.
- Top bar: count summary, search, refresh, settings.
- Main area: host list, selected-host service table, agent panel, activity feed.
- Right inspector: selected host details and common actions.

Mobile layout:

- Bottom navigation with four top-level views.
- Single active view at a time.
- Host rows lead into service detail.
- Agent input stays thumb-friendly with a voice button.

## Recommended API Shape

Keep Flask initially and expose JSON endpoints that a React app can consume:

```text
GET    /api/hosts
GET    /api/hosts/:hostId
GET    /api/hosts/:hostId/status
POST   /api/hosts/:hostId/wake
POST   /api/hosts/:hostId/shutdown
GET    /api/services
POST   /api/services/:serviceId/actions/:actionId
GET    /api/events
POST   /api/agent/chat
POST   /api/voice/stt
POST   /api/voice/tts
```

Suggested typed action examples:

- `wake_host`
- `shutdown_host`
- `restart_service`
- `start_service`
- `stop_service`
- `open_service_url`
- `switch_gpu_workload`
- `run_health_check`

Avoid letting the UI or agent send arbitrary shell text directly to privileged execution paths. The backend can still execute commands internally, but only through allowlisted actions.

## Design Direction

The prototype intentionally avoids common generated-dashboard habits: oversized hero panels, glowing gradients, floating glass shells, random KPI cards, and decorative "control room" language. The visual direction is closer to a local admin console: dense, quiet, clear, and direct.

Design rules:

- Use real infrastructure concepts as the visual hierarchy.
- Keep cards and controls at 8px radius or less.
- Prefer tables and rows over decorative metric tiles.
- Use color for state only: online, warning, sleeping/stopped.
- Keep mobile navigation at the bottom with 3-5 top-level destinations.
- Keep text short and operational.
- Use confirmation for shutdown/restart/kill actions.
- Keep action history visible.

## Research Notes

- Material guidance treats bottom navigation as useful on mobile for three to five top-level destinations and suggests side navigation for desktop: https://m3.material.io/components/navigation-bar/overview
- Android responsive navigation guidance describes bottom navigation on compact widths, navigation rail on medium widths, and persistent drawer/sidebar on expanded widths: https://developer.android.com/develop/ui/views/layout/build-responsive-navigation
- GitHub Primer's data table patterns are a good reference for dense admin data rather than decorative cards: https://www.primer.style/components/data-table/
- Radix accessibility guidance is useful if the prototype later adopts dialogs, menus, and sheets: https://www.radix-ui.com/primitives/docs/overview/accessibility
- TanStack Query remains a good next dependency when real polling/mutations replace mocked data: https://tanstack.com/query/latest/docs/react/overview

## Implementation Notes

Current prototype files:

- `src/App.tsx`: mocked data and interactive dashboard state.
- `src/styles.css`: full responsive layout and visual system.
- `public/logo.png`: copied local project logo.
- `public/favicon.ico`: copied local favicon.

Run locally:

```powershell
npm install
npm run dev
```

Build:

```powershell
npm run build
```

## Next Steps

1. Connect host and service rows to `/api/hosts` and `/api/services`.
2. Add confirmation dialogs for `wake`, `shutdown`, `start`, and `stop`.
3. Add TanStack Query for polling and action mutations.
4. Add push-to-talk STT and TTS using your existing OpenAI-compatible backend.
5. Add Playwright smoke tests for desktop and Android-sized viewports.
