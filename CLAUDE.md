# CLAUDE.md

Guidance for Claude Code working in this repo.

## Source of truth

**Read [`AGENTS.md`](./AGENTS.md) first.** It is the canonical, agent-agnostic guide and covers:
project purpose, repository map, run/build commands, current backend & frontend architecture, the
**security model**, the **target architecture** (React + TS + Vite UI, typed action registry,
voice via OpenAI-compatible STT/TTS, SearXNG MCP), conventions, and known gotchas.

Everything in `AGENTS.md` applies to Claude. This file only adds Claude-Code-specific notes so the
two don't drift — when project facts change, **update `AGENTS.md`, not this file**.

## TL;DR for a new session

- This is a **single-user homelab control panel** (Flask) for waking/monitoring/managing PCs over
  LAN + Tailscale, with an LLM command box and chat. No internet exposure; Tailscale-only.
- The live server is **`wol_server/wol_server_win.py`** (Windows, port 5432). `wol_server.py` is an
  outdated Linux variant — don't edit it unless the task is explicitly Linux WOL/monitor.
- **The active rebuild is `dashboard_v2/` — START AT [`dashboard_v2/docs/HANDOFF.md`](./dashboard_v2/docs/HANDOFF.md)**,
  the single source for current status + next steps. It's a ground-up v2: a mobile-first
  React/TS/Vite **PWA** backed by a **FastAPI + Uvicorn** service, porting the **Vapor** design
  (`ctrl-b (Vapor)/variations/vapor.html`). Phases 0–4.5 + 7a–7d are shipped (fleet, agent
  tool-loop, integrations, Conf settings/hosts/services/integrations/agents/skills); 7e (prompts
  editors + memory panel) is the active follow-up. All v2 work happens in `dashboard_v2/`.

  **Doc map — read these before designing or implementing a v2 feature:**
  | File | Use it for |
  |---|---|
  | [`dashboard_v2/docs/HANDOFF.md`](./dashboard_v2/docs/HANDOFF.md) | Current status + the locked next slice. **Always read first.** |
  | [`dashboard_v2/docs/DECISIONS.md`](./dashboard_v2/docs/DECISIONS.md) | Locked architectural choices (D1–D13) — don't relitigate. |
  | [`dashboard_v2/docs/ARCHITECTURE.md`](./dashboard_v2/docs/ARCHITECTURE.md) | System design: backend/frontend layers, deployment profiles, security. |
  | [`dashboard_v2/docs/DESIGN.md`](./dashboard_v2/docs/DESIGN.md) | Concrete code design: data structures, registry, agent loop, SSE wire protocol, extension cookbook. |
  | [`dashboard_v2/docs/TODO.md`](./dashboard_v2/docs/TODO.md) | Phased checkbox plan — find the right phase, follow the slice. |
  | [`dashboard_v2/docs/ROADMAP.md`](./dashboard_v2/docs/ROADMAP.md) | **Future features** + the v1 seams to keep cheap. Start here for anything not in TODO. |
  | [`dashboard_v2/docs/VAPOR_PATTERNS.md`](./dashboard_v2/docs/VAPOR_PATTERNS.md) | Vapor design tokens/components — read **before** styling any net-new UI. |
  | [`dashboard_v2/docs/RESEARCH.md`](./dashboard_v2/docs/RESEARCH.md) | Library/version pins + sourced rationale (incl. the mic secure-context analysis). |
  | [`dashboard_v2/docs/AUDIT_settings.md`](./dashboard_v2/docs/AUDIT_settings.md) | Historical pre-7a audit; findings already folded in. Reference, not a checklist. |
  | [`dashboard_v2/docs/UI_AUDIT.md`](./dashboard_v2/docs/UI_AUDIT.md) | Two-pass frontend audit. §1–6b: perf + best-practices pass (F1–F13) — Slices 1–8 all shipped (10 of 13 closed; F9/F13 deferred). §6c: a11y/resilience/UX follow-up audit (F14–F26) — documented, not implemented; the next backlog. Recommended implementation order in the doc footer. |

  When designing a new feature, the canonical flow is: **HANDOFF (where we are) → ROADMAP (is this listed? what seams already exist?) → DECISIONS (any locked choice that constrains it?) → DESIGN/ARCHITECTURE (how does it slot in?) → TODO (which phase owns it? add the slice).** If a feature isn't in any of these, propose where it goes *before* coding.
- The earlier prototype folders (`ws_claude/`, `ws_claude_2/`, `ws_codex*/`) and `ctrl-b (Vapor)/`
  are **reference only** — superseded by `dashboard_v2/`. Don't import or modify them or the live
  Flask app; the live app keeps running until cutover.

## Environment

- Host OS is **Windows 11** today (corsair); the owner is **migrating dashboard_v2 to emma (Linux)**.
  Default shell here is **PowerShell** (use `$null`, `$env:VAR`, backtick continuation); a Bash tool
  is also available for POSIX scripts. **Keep all v2 code OS-agnostic** — branch on `host.os_type`
  (managed host), never on the server's OS. The only legitimate server-OS branch is the local ping
  syntax (`fleet._ping_cmd`); see `ARCHITECTURE.md` §6 for the design invariant.
- Python **3.11**, venv in `.venv/`. Legacy live server: install via `./install.bat`, run via
  `./start_wol_server.bat`. v2 backend: `dashboard_v2/backend/.venv` + `uvicorn app.main:app --port 5433`.
- **Windows gotcha:** do **not** run the v2 backend with `uvicorn --reload` on Windows — the reload
  worker uses an event loop that breaks `asyncio.create_subprocess_exec`, so `fleet.ping_host` returns
  empty output and every host shows offline. Linux/macOS reload is fine. (Documented in
  `dashboard_v2/README.md` + `ARCHITECTURE.md` §6.)
- Tests live in `dashboard_v2/backend/tests/`; run with the venv's `pytest`. No linter or CI yet — if
  you add code, add a minimal way to verify it. Never live-test config writes against the real
  `config.yaml`; use `CTRLB_CONFIG`/`CTRLB_DB` to point at a temp copy.

## Hard rules (see AGENTS.md §6 for full security model)

- **Never weaken the security boundary.** No public bind, no auth removal, no exposing `/execute`
  (arbitrary shell) beyond the tailnet. Prefer the typed-action approach for new execution paths.
- **Never commit or echo secrets.** `config.yaml`, `clients`, and `*_prompt.*` are gitignored and
  contain SSH passwords / API keys. Keep them out of code, logs, and commit messages.
- **Commit only when asked**, scope commits tightly, and **don't sweep the untracked `ws_codex*`
  dirs into a commit** unless that's the explicit intent.
- Confirm before destructive/hard-to-reverse actions (rewriting the live server, deleting
  templates, force-push).

## When asked to improve the dashboard

Default to **`dashboard_v2/`** and follow the doc map above — `HANDOFF` → `ROADMAP` → `DECISIONS` →
`DESIGN`/`ARCHITECTURE` → `TODO`. The agreed shape: mobile-first React + TS + Vite **PWA**
(TanStack Query, lucide-react), porting the **Vapor** design (`VAPOR_PATTERNS.md` governs net-new
UI); **FastAPI + Uvicorn** backend; **typed-action registry** as the primary execution path with a
deferred guarded `$` raw-shell escape hatch (Phase 5, deprioritized — open-terminal already provides
remote shell); **SQLite** for chat/memory/events + **YAML** for config; voice via OpenAI-compatible
**STT/TTS** and chat via OpenAI-compatible **llama.cpp**/cloud. The owner connects from Android —
keep changes testable at narrow viewport widths (mic needs HTTPS via Tailscale Serve). Don't
re-theme the old Bootstrap UI.

**Future-feature workflow.** If the request isn't a phase in `TODO.md`, check `ROADMAP.md` first —
most future features (privilege levels, automations, scheduled agents, wake word, idle shutdown,
notifications, memory backends, …) have a v1 seam already designed there. Implement against that
seam; if the seam is missing, propose one in `DECISIONS.md` (new D-entry) before coding.

## Commit message footer

End commit messages with:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```
