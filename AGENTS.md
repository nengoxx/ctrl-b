# AGENTS.md — ctrl-b

Canonical guide for any AI agent (Claude Code, Codex, etc.) working in this repo.
Claude-specific notes live in `CLAUDE.md`, which defers to this file for everything below.

> **▶ Where to start:** the app IS this repo (**ctrl-b v1.0**). For live status + next steps,
> **start at [`docs/HANDOFF.md`](./docs/HANDOFF.md)**; architecture/decisions are in [`docs/`](./docs/).
> *(Dev docs say "v2"/"dashboard_v2" — the development name for what ships as ctrl-b v1.0.)* The earlier
> hand-built **Flask** app is archived under [`archive/v0.1-flask/`](./archive/v0.1-flask/) (= v0.1).

---

## 1. What this project is

`ctrl-b` is a small **single-user** self-hosted control panel for a personal fleet of machines. The
owner runs several PCs — some Windows, some Linux — reachable over the LAN and over **Tailscale**
(MagicDNS names like `corsair`, `vault`, `g5`, `emma`, or direct Tailscale IPs). **No ports are open
to the internet**; access is Tailscale-only. The typical flow: an Android phone joins the tailnet, the
dashboard wakes/monitors the machines, and the owner manages services and talks to an LLM agent from
one mobile-first page.

Current capabilities (the v1.0 app):

- **Fleet monitoring** — ping each host, show awake/asleep; per-host services with status.
- **Wake-on-LAN / remote shutdown / reboot** — magic packets + SSH (`os_type`-aware commands).
- **Agent** — a tool-using LLM chat: the model sees a **typed-action registry** as function-calling
  tools and runs them through the same gated `ActionService` the UI buttons use (validate → risk/
  privilege gate → confirm-bubble for med/high risk → execute → audit). Integrations: SearXNG web
  search, an MCP client (Streamable-HTTP + stdio), curated open-terminal shell/file tools, a generic
  OpenAPI provider, embeddings; plus **skills** and **agents/subagents**.
- **Voice** — STT in / TTS out via OpenAI-compatible endpoints; push-to-talk mic (needs HTTPS).
- **Utilities** — the Tools tab registry (YouTube captions, etc.).
- **Conf** — manage settings, hosts/services, integrations, agents, skills, prompts through the UI
  (round-trips `config.yaml`); no hand-edited YAML for those.

---

## 2. Repository map

```
backend/                FastAPI + Uvicorn service (port 5433). Layered:
  app/domain/           Pydantic models (Host, Service, Action, Event, AgentDef, …) — the typed entities
  app/core/             the typed-action registry + tool abstraction
  app/adapters/         host/SSH/WOL/inference/MCP/OpenAPI adapters
  app/services/         ActionService (gate+audit), the agent loop (services/agent/), fleet, svc, …
  app/api/              FastAPI routers (JSON + SSE)
  app/config.py         config.yaml/.env loading; _PROJECT_ROOT = repo root; CTRLB_HOME relocates data
  app/main.py           lifespan (db) + StaticFiles serving frontend/dist + SPA fallback
  tests/                pytest (count: QUALITY.md) — conftest auto-isolates CTRLB_HOME; temp configs via CTRLB_CONFIG/CTRLB_DB
  pyproject.toml        editable install (pip install -e .)
frontend/               React 19 + TS + Vite 7 PWA. store/ hooks/ components/ tabs/ lib/ theme-engine/ themes/
docs/                   HANDOFF (start here) · DECISIONS · ARCHITECTURE · DESIGN · SPEC · ROADMAP · TODO · THEME_ENGINE · audits (UI_AUDIT · SYSTEM_AUDIT · AGENT_CHAT_AUDIT · PROMPTS_AUDIT) · …
docs/research/          field-research dossiers (how OTHER projects solve a problem) — READ BEFORE re-running a deep research pass; RESEARCH.md is our own library-pin rationale, a different thing
deploy/                 bootstrap.py (Win→Linux SSH orchestrator) + linux/ (systemd) + windows/ (double-click)
tools/                  dev launchers (NOT deploy): start-claude.sh (Linux), claude-{fable,opus}.{ps1,cmd} (Windows), add-dev-worktree.sh
design/                 source design prototypes + the Vapor visual spec (design/prototypes/variations/vapor.html)
agents/   skills/        bundled agent definitions + file-discovered skills (read from CTRLB_HOME at runtime)
config.yaml             ★ live config (gitignored). Copy from config.example.yaml. nested secrets, UI-managed
config.example.yaml     template: computers{} + inference endpoints/keys + integrations
.env.example            optional bootstrap (.env, gitignored): CTRLB_HOME/CONFIG/DB + CTRLB_<SECTION>__<KEY> overrides
ctrlb.db                ★ SQLite (gitignored): chat / memory / events. Created on first run
memories/               ★ agent memory (gitignored, personal data)
assets/                 local demo videos (gitignored — the README embeds a GitHub user-attachment)
archive/                v0.1-flask/ (the old Flask app + scripts) · v0.1-inference/ · ui-prototypes/ (ws_*)
```

`.gitignore` excludes secrets + runtime: `config.yaml`, `clients`, `*_prompt.*`, `.env*`, `*.db*`,
`memories/`, `agents/*/memories/`, `node_modules/`, `dist/`, `.venv/`, `assets/*.mp4`. Keep it that way.

---

## 3. Run / build / test

**Backend:** Python **3.14+** (the code uses 3.14-only syntax — PEP 758 `except`, ruff `target-version
= py314`; emma deploys native 3.14), venv at `backend/.venv`. Port **5433**.

```bash
# Linux (the primary environment — emma) — --reload is safe here. Or just: deploy/linux/run.sh dev
# On emma the dev instance already runs as systemd units (:5434 + Vite :5173) — restart those instead
# of spawning duplicates:  systemctl --user restart ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web
cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --reload --port 5433
```
```powershell
# Windows (the frozen corsair clone; do NOT pass --reload — see §8 gotcha). [dev] = ruff/pyright/pytest
cd backend; py -3 -m venv .venv; .venv\Scripts\python.exe -m pip install -e ".[dev]"
.venv\Scripts\python.exe -m uvicorn app.main:app --port 5433        # http://127.0.0.1:5433
cd ..\frontend; npm install; npm run dev                            # http://localhost:5173 (proxies /api → 5433)
```

- **One-command runners:** `deploy/linux/run.sh [prod|dev]` (manual) · `python deploy/bootstrap.py`
  (Linux server, systemd + HTTPS — **executed 2026-07-10: v1.0.0 live on emma**) ·
  `deploy/windows/start.cmd` (Windows). See [`deploy/README.md`](./deploy/README.md).
- **Tests:** from `backend/`, `.venv/Scripts/python.exe -m pytest -q`. Frontend: `npm test`
  (vitest) · `npm run test:e2e` (playwright) · `npm run build`.
- **Quality harness:** one command answers "is the repo green?" — **`python tools/check.py`** (runs
  everything in parallel: BE `ruff` lint+format · `pyright` (type check) · `pytest`; FE `npm run
  check-all` = `tsc` + ESLint + stylelint + Prettier + `vitest`). Flags: `--backend`/`--frontend`/`--fast`. The
  layered standard + conventions live in [`docs/QUALITY.md`](./docs/QUALITY.md); the sliced rollout is
  [`docs/PRE_DEPLOY.md`](./docs/PRE_DEPLOY.md) §1 (1a–1d shipped). Backend pyright deps:
  `pip install -e "backend/.[dev]"` (installs `pyright[nodejs]`).
- **Git-hook gate (1d):** tracked `.githooks/` via `core.hooksPath` — **pre-commit** runs `check.py --fast`
  (ruff + FE prettier, instant), **pre-push** runs the full `check.py`. `deploy/linux/install.sh` enables it
  on emma; **on Windows enable once per clone:** `git config core.hooksPath .githooks`. Bypass an emergency
  commit/push with `--no-verify`. To gate commits on the *full* suite, drop `--fast` from `.githooks/pre-commit`.
- **Config:** hybrid (`docs/DESIGN.md §9`). `config.yaml` (UI-managed, incl. nested secrets) is the source
  of truth; `.env` adds bootstrap paths + scalar `CTRLB_<SECTION>__<KEY>` overrides that win over the YAML.
  Both optional — built-in defaults apply. **Never live-test config writes against the real `config.yaml`;
  point `CTRLB_CONFIG`/`CTRLB_DB` at a temp copy.**

---

## 4. Backend architecture

A **decoupled** FastAPI service + SPA. The agent turn is **one async generator of `AgentEvent`s**; every
transport (SSE today) drains *that* — it never re-implements the loop. UI buttons and agent tool-calls both
route through the **same typed-action registry → `ActionService`** (validate → risk/privilege gate →
execute → audit). Hosts/services/actions/events/agents are first-class Pydantic entities in `app/domain/`.
SQLite holds chat/memory/events; YAML holds config (round-tripped by the Conf tab via a single write path).
Streaming is **SSE**. `uvicorn` serves the API and the built `frontend/dist` (SPA fallback). Design detail:
`docs/ARCHITECTURE.md` + `docs/DESIGN.md`.

**OS-agnostic invariant.** Branch on the managed **host's** `os_type` (ping/SSH command shape), never on the
*server's* OS. Server-OS branches are a **closed allowlist** (`fleet._ping_cmd` ping syntax · `run_shell`'s
per-OS shell · `memory._fsync_dir` no-op · `tools/check.py`), pinned by `test_arch_invariants_qh9.py`. See
`docs/ARCHITECTURE.md §6` (the owner of this list).

---

## 5. Frontend architecture

Mobile-first **React + TS + Vite** PWA. TanStack Query for fleet polling + action mutations;
lucide-react icons; a token-driven **theme-engine** (Swappable Surfaces, DECISIONS D31 —
`docs/THEME_ENGINE.md`; cosmos default, per-theme fidelity D7, theme build records in their plan
docs). Layers: `store/` (dep-free createStore) · `hooks/` ·
`components/`/`tabs/` · `lib/`. Bottom-tab nav (Fleet/Agent/Utils/Conf), per-host service rows, a shared
composer with push-to-talk + auto-TTS. Net-new UI follows `docs/VAPOR_PATTERNS.md`.

---

## 6. ⚠️ Security model — read before touching anything that executes

> **Full model + rationale + residual-risk register + safe-defaults checklist:
> [`docs/SECURITY_MODEL.md`](./docs/SECURITY_MODEL.md).** This section is the enforced-rules TL;DR.

The app's safety rests **entirely** on Tailscale + no open ports + single trusted user. Within that
boundary it is permissive, but several things are genuinely dangerous and any agent must **preserve or
improve — never weaken** them:

- **No public bind, no auth removal, no Tailscale assumption removed.** The backend binds **127.0.0.1**;
  the tailnet (via **Tailscale Serve** HTTPS) is the sole ingress. Egress (SSH/ping/WOL to the fleet) is
  unaffected by the bind.
- **Typed actions are the primary execution path.** Agent + UI request named, allowlisted actions
  (`wake_host`, `shutdown_host`, `restart_service`, …) that pass the **risk/privilege gate**; med/high-risk
  calls **suspend on a confirm bubble**. A raw `$` shell escape hatch is **deferred + agent-excluded by
  default** (Phase 5) — don't expose arbitrary shell beyond the tailnet, don't bypass the gate.
- **SSH credentials + API keys live in `config.yaml`** (gitignored, masked on API read). Never commit or
  echo them. `paramiko` uses `AutoAddPolicy` — acceptable only inside the trusted tailnet.
- **`debug` is off by default** (it's an RCE surface). Keep it off for anything reachable.
- **MCP/OpenAPI tool providers** are external surfaces — risk-annotate their tools; don't grant blanket ALLOW.

When adding an execution path, prefer a new **typed action** over widening a raw path.

---

## 7. Conventions & gotchas

- **The live server is `backend/app/main.py` (FastAPI, :5433).** The old Flask app is in
  `archive/v0.1-flask/` — don't edit it unless the task is explicitly about that legacy code.
- **The working environment is emma (Linux, bash) since the 2026-07-10 deploy** — the Windows checkout
  (corsair) is a frozen plain clone; there the default shell is PowerShell (`$null`, `$env:VAR`, backtick
  continuation) with a Bash tool available. Keep all code **OS-agnostic** (branch on `host.os_type`,
  never the server OS — §4).
- **Windows `--reload` gotcha:** don't run uvicorn with `--reload` on Windows — the reload worker's event
  loop breaks `asyncio.create_subprocess_exec`, so `fleet.ping_host` returns empty and every host shows
  offline. Linux/macOS are fine. (Documented in `README.md` + `docs/ARCHITECTURE.md §6`.)
- Secrets (`config.yaml`, `clients`, `*_prompt.*`, `.env`) are gitignored — never commit or echo them.
- **Shape data/config to extend, not migrate** (owner directive): a feature adding a dimension to a
  name-keyed map prefers **one unified per-item object with an optional field** over parallel sibling maps.
- Deploy paths: `deploy/bootstrap.py` (orchestrator), `deploy/linux/` (systemd kit), `deploy/windows/`
  (double-click). Dev launchers are in `tools/` (not deploy). Topology: DECISIONS **D32**.

---

## 8. Working agreement for agents

- This is a **single-user homelab tool**, not production SaaS. Favor simple, direct solutions over
  enterprise scaffolding. But **never weaken the security boundary** in §6.
- When asked to "make the dashboard better," default to **this repo** and the doc map
  (`docs/HANDOFF.md` → `ROADMAP` → `DECISIONS` → `DESIGN`/`ARCHITECTURE` → `TODO`); net-new UI
  follows `docs/VAPOR_PATTERNS.md`; don't re-theme anything in `archive/`.
- **Don't duplicate existing patterns — in either direction.** Before introducing new code or a new
  dependency for X, find how X is already done here and extend it. Two failure modes to avoid: writing
  *different code for similar things* (a parallel implementation that bypasses an existing pattern — e.g. an
  OS-driven `@media (prefers-reduced-motion)` block when the project already has a `UIState` +
  Appearance-Switch model for user prefs), and pulling in a dep for *similar code for the same thing we
  already own* (e.g. adding `react-error-boundary` when our `ErrorBoundary.tsx` already provides the same
  render-prop API). Read the touch points first, match the existing pattern, and propose any deviation in
  the design before coding. Consistency by construction beats cleanup after the fact.
- **Check the design before you implement — mandatory pre-flight (owner directive 2026-06-16).**
  Implementing a feature does **not** start with writing code. It starts with reading the code the feature
  touches and confirming you will reuse it. Before any feature, verify:
  1. **Existing data structures / classes / functions** — does a model, service, adapter, store, or helper
     for this already exist? Reuse it; don't introduce a parallel shape. (E.g. the agent turn is one async
     generator of `AgentEvent`s — a new transport drains *that*, it never re-implements the loop.)
  2. **The current architecture & layering** — which layer owns this (`domain`/`core`/`adapters`/`services`/
     `api` on the backend; `store`/`hooks`/`components`/`lib` on the frontend)? Slot it in at the right
     layer; don't bypass a chokepoint (the YAML write path, the action registry, the permission gate).
  3. **No hardcoding** — tunables go in config / `AgentDef` / Settings, never magic numbers or inline literals.
  4. **No duplicated / near-duplicate code** — one source of truth for each behavior.
  When in doubt, surface the design (the seams you'll reuse + any deviation) and confirm **before** coding.
  The cost of reading first is always less than the cost of an inconsistent parallel path.
- Confirm before destructive or hard-to-reverse actions (deleting docs, rewriting shared architecture,
  force-pushing). The owner connects from Android — keep changes testable at narrow widths.
- Commit only when asked. Keep commits scoped.
