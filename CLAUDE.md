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
- **The active rebuild is `dashboard_v2/`** — a ground-up v2: a mobile-first React/TS/Vite **PWA**
  backed by a **FastAPI + Uvicorn** service, porting the **Vapor** design
  (`ctrl-b (Vapor)/variations/vapor.html`). Read **`dashboard_v2/docs/`** first — `DECISIONS.md`,
  `ARCHITECTURE.md`, `RESEARCH.md`, `TODO.md`. All v2 work happens there.
- The earlier prototype folders (`ws_claude/`, `ws_claude_2/`, `ws_codex*/`) and `ctrl-b (Vapor)/`
  are **reference only** — superseded by `dashboard_v2/`. Don't import or modify them or the live
  Flask app; the live app keeps running until cutover.

## Environment

- Host OS is **Windows 11**; the default shell here is **PowerShell** (use `$null`, `$env:VAR`,
  backtick continuation). A Bash tool is also available for POSIX scripts.
- Python **3.11**, venv in `.venv/`. Install via `./install.bat`, run via `./start_wol_server.bat`.
- No tests, linter, or CI exist. If you add code, prefer to also add a minimal way to verify it.

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

Default to **`dashboard_v2/`** and its docs (`docs/DECISIONS.md`, `docs/ARCHITECTURE.md`,
`docs/TODO.md`). The agreed shape: mobile-first React + TS + Vite **PWA** (TanStack Query,
lucide-react), porting the **Vapor** design; **FastAPI + Uvicorn** backend; **typed-action
registry** as the primary execution path with a guarded `$` raw-shell escape hatch; **SQLite**
for chat/memory/events + **YAML** for config; voice via OpenAI-compatible **STT/TTS** and chat
via OpenAI-compatible **llama.cpp**/cloud. The owner connects from Android — keep changes testable
at narrow viewport widths (mic needs HTTPS via Tailscale Serve). Don't re-theme the old Bootstrap UI.

## Commit message footer

End commit messages with:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```
