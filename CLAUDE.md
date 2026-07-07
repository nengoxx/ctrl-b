# CLAUDE.md

Guidance for Claude Code working in this repo.

## Source of truth

**Read [`AGENTS.md`](./AGENTS.md) first.** It is the canonical, agent-agnostic guide and covers:
project purpose, repository map, run/build commands, backend & frontend architecture, the
**security model**, conventions, and known gotchas.

Everything in `AGENTS.md` applies to Claude. This file only adds Claude-Code-specific notes so the
two don't drift — when project facts change, **update `AGENTS.md`, not this file**.

## TL;DR for a new session

- This is a **single-user homelab control panel** for waking/monitoring/managing PCs over LAN +
  Tailscale, with a tool-using LLM agent + voice. No internet exposure; Tailscale-only.
- **The app IS this repo (ctrl-b v1.0)** — a mobile-first React/TS/Vite **PWA** backed by a
  **FastAPI + Uvicorn** service (`backend/app/main.py`, port 5433), porting the **Vapor** design
  (`design/prototypes/variations/vapor.html`). **START AT [`docs/HANDOFF.md`](./docs/HANDOFF.md)** —
  the single source for current status + next steps. *(Dev docs say "v2"/"dashboard_v2" — the
  development name for what ships as v1.0.)* The old Flask app is in `archive/v0.1-flask/`.

  **Doc map — read these before designing or implementing a feature:**
  | File | Use it for |
  |---|---|
  | [`docs/HANDOFF.md`](./docs/HANDOFF.md) | Current status + the locked next slice. **Always read first.** |
  | [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Locked architectural choices (D1–D34) — don't relitigate. |
  | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | System design: backend/frontend layers, deployment, security. |
  | [`docs/DESIGN.md`](./docs/DESIGN.md) | Concrete code design: data structures, registry, agent loop, SSE wire protocol, extension cookbook. |
  | [`docs/SPEC.md`](./docs/SPEC.md) | Visual one-stop system spec (C4 diagrams, flows, inventories) — complements ARCHITECTURE/DESIGN; on conflict DECISIONS wins. |
  | [`docs/TODO.md`](./docs/TODO.md) | Phased checkbox plan — find the right phase, follow the slice. |
  | [`docs/ROADMAP.md`](./docs/ROADMAP.md) | **Future features** + the v1 seams to keep cheap. Start here for anything not in TODO. |
  | [`docs/THEME_ENGINE.md`](./docs/THEME_ENGINE.md) | The theme engine (Swappable Surfaces, D31) — read before themeable UI. |
  | [`docs/VAPOR_PATTERNS.md`](./docs/VAPOR_PATTERNS.md) | Vapor design tokens/components — read **before** styling any net-new UI. |
  | [`docs/RESEARCH.md`](./docs/RESEARCH.md) | Library/version pins + sourced rationale (incl. the mic secure-context analysis). |
  | [`docs/UI_AUDIT.md`](./docs/UI_AUDIT.md) | Two-pass frontend audit (perf F1–F13 + a11y/resilience F14–F29). |
  | [`docs/SYSTEM_AUDIT.md`](./docs/SYSTEM_AUDIT.md) | Code-verified architecture audit (SYS-# findings; excludes the chat loop). |
  | [`docs/AGENT_CHAT_AUDIT.md`](./docs/AGENT_CHAT_AUDIT.md) | Agent-chat audit + 8-agent comparative analysis + the ACA improvement plan (Slices 0–8). |
  | [`docs/PRE_DEPLOY.md`](./docs/PRE_DEPLOY.md) | The pre-deploy hardening gate record (steps 1–5) + the deploy-readiness checklist. |
  | [`docs/QH_AUDIT.md`](./docs/QH_AUDIT.md) | The quality-harness audit (QH-#): brief + report — is the harness itself trustworthy for commit/merge/deploy? |
  | [`docs/DEPLOY_EMMA.md`](./docs/DEPLOY_EMMA.md) | The emma (Linux) deploy runbook + topology (D32). |
  | [`docs/QUALITY.md`](./docs/QUALITY.md) | The code-quality harness (lint/format/typecheck/test + `check-all` + conventions). Read before touching tooling. |
  | [`docs/SECURITY_MODEL.md`](./docs/SECURITY_MODEL.md) | The trust boundary, privilege gate, confirm-tokens, secret handling + safe-defaults checklist. Read before touching anything that executes or handles secrets. |

  When designing a new feature, the canonical flow is: **HANDOFF (where we are) → ROADMAP (is this listed? what seams already exist?) → DECISIONS (any locked choice that constrains it?) → DESIGN/ARCHITECTURE (how does it slot in?) → TODO (which phase owns it? add the slice).** If a feature isn't in any of these, propose where it goes *before* coding.
- The earlier prototype folders and the old Flask app are **archived** under `archive/` — reference
  only. Don't import or modify them.

## Environment

- Host OS is **Windows 11** today (corsair); the owner is **migrating to emma (Linux)** for deploy.
  Default shell here is **PowerShell** (use `$null`, `$env:VAR`, backtick continuation); a Bash tool
  is also available for POSIX scripts. **Keep all code OS-agnostic** — branch on `host.os_type`
  (managed host), never on the server's OS. The only legitimate server-OS branch is the local ping
  syntax (`fleet._ping_cmd`); see `docs/ARCHITECTURE.md` §6 for the design invariant.
- Python **3.14+** (the codebase uses 3.14 syntax — e.g. PEP 758 unparenthesized `except`; ruff
  `target-version = py314`; emma deploys native 3.14). Backend venv at `backend/.venv`. Run:
  `uvicorn app.main:app --port 5433` from `backend/`. One-command: `deploy/windows/start.cmd` /
  `deploy/linux/run.sh`.
- **Windows gotcha:** do **not** run the backend with `uvicorn --reload` on Windows — the reload
  worker uses an event loop that breaks `asyncio.create_subprocess_exec`, so `fleet.ping_host` returns
  empty output and every host shows offline. Linux/macOS reload is fine. (Documented in `README.md`
  + `docs/ARCHITECTURE.md` §6.)
- Tests live in `backend/tests/`; run with the venv's `pytest` (250). No CI gate beyond `ruff` — if
  you add code, add a minimal way to verify it. Never live-test config writes against the real
  `config.yaml`; use `CTRLB_CONFIG`/`CTRLB_DB` to point at a temp copy.

## Hard rules (see AGENTS.md §6 for full security model)

- **Never weaken the security boundary.** No public bind, no auth removal, no exposing a raw-shell
  path beyond the tailnet. Prefer the typed-action approach for new execution paths.
- **Never commit or echo secrets.** `config.yaml`, `clients`, `*_prompt.*`, `.env` are gitignored and
  contain SSH passwords / API keys. Keep them out of code, logs, and commit messages.
- **Don't duplicate existing patterns — in either direction.** Before writing new code or adding
  a dep for X, find how X is already done in this codebase and extend it. Two failure modes to
  avoid: *different code for similar things* (a parallel implementation that bypasses an existing
  pattern — e.g. an OS-driven `@media (prefers-reduced-motion)` block when `UIState` + an
  Appearance Switch already model user prefs), and *similar code for the same thing we already
  own* (e.g. pulling in `react-error-boundary` when our `ErrorBoundary.tsx` already provides the
  same render-prop API). Read the touch points first, match the pattern, and propose any
  deviation in the design before coding.
- **Shape data/config to extend, not to migrate (owner directive 2026-06-24).** When a feature adds
  a dimension to something that will grow more dimensions later (per-tool overrides, per-host config,
  per-agent settings, any `{name: …}` map), prefer **one unified per-item object you extend with an
  optional field** over **parallel sibling maps keyed by the same name**. Sibling maps look cheaper
  ("zero migration now") but they *defer and enlarge* the migration: every new dimension is a new
  top-level map plus new read/merge/overlay code, and you pay it when the data is no longer empty. A
  unified object makes the next dimension a purely additive field with a default (Open/Closed; the
  "parameter/options object" refactor). Concrete precedent: Phase 8 `tool_overrides:
  {<tool>: {description, agent_mode, settings?}}` — *not* `tool_descriptions{}` + `tool_agent_mode{}`
  + `tool_settings{}`. Before adding a second name-keyed map next to an existing one, stop and ask
  whether the two belong in one object; if migrating now is cheap (the map is sparse/empty), do it now.
- **Check the design before you implement — mandatory pre-flight (owner directive 2026-06-16; full
  text in AGENTS.md §8).** A feature starts by *reading* the code it touches, not writing code.
  Confirm you're reusing the existing **data structures/classes/functions**, slotting into the
  right **architecture layer** (don't bypass a chokepoint), with **no hardcoding** (tunables →
  config/AgentDef/Settings) and **no duplicated/near-duplicate code** (one source of truth).
  Surface the seams you'll reuse + any deviation, and confirm **before** coding.
- **Commit only when asked**, scope commits tightly.
- Confirm before destructive/hard-to-reverse actions (rewriting shared architecture, deleting
  docs, force-push).

## When asked to improve the dashboard

Default to this repo and follow the doc map above — `HANDOFF` → `ROADMAP` → `DECISIONS` →
`DESIGN`/`ARCHITECTURE` → `TODO`. The shape: mobile-first React + TS + Vite **PWA** (TanStack Query,
lucide-react), porting the **Vapor** design (`VAPOR_PATTERNS.md` governs net-new UI); **FastAPI +
Uvicorn** backend; **typed-action registry** as the primary execution path plus a guarded `!`
local-shell escape hatch (Phase 5, **built**; user `!` on by default, the agent's `run_shell`
off-by-default — `shell.*_exec` toggles; open-terminal provides *remote* shell);
**SQLite** for chat/memory/events + **YAML** for config; voice via OpenAI-compatible **STT/TTS** and
chat via OpenAI-compatible **llama.cpp**/cloud. The owner connects from Android — keep changes
testable at narrow viewport widths (mic needs HTTPS via Tailscale Serve).

**Future-feature workflow.** If the request isn't a phase in `TODO.md`, check `ROADMAP.md` first —
most future features (privilege levels, automations, scheduled agents, wake word, idle shutdown,
notifications, memory backends, …) have a v1 seam already designed there. Implement against that
seam; if the seam is missing, propose one in `DECISIONS.md` (new D-entry) before coding.

## Commit message footer

End commit messages with:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
