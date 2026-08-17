# Architecture — ctrl-b

How the pieces fit. Reflects the locked decisions in `DECISIONS.md`. A themed React PWA
(`THEME_ENGINE.md`; cosmos default) mapped onto a real, typed backend. *(Dev docs say
"v2"/"dashboard_v2" — the development name for ctrl-b v1.0.)*

> **📌 Role of this doc (re-scoped 2026-07-07, doc-consistency pass).** This began as the pre-build
> system sketch; the system has since shipped and is specified **as-built** elsewhere. What this doc
> still **owns**: **§6 deployment profiles + the `$CTRLB_HOME` data
> root + the OS-branch allowlist** (test-pinned). Everything else is a pointer stub below — the
> authoritative detail lives in [`DESIGN.md`](./DESIGN.md) (code-level contracts),
> [`SPEC.md`](./SPEC.md) (verified as-built inventories + C4 diagrams), and
> [`SECURITY_MODEL.md`](./SECURITY_MODEL.md). The original 2026-05 sketch (with its 2026-06-14
> reconciliation note) is preserved in git history — `git log -- docs/ARCHITECTURE.md`.

System picture: [`README.md`](../README.md) (mermaid overview) · [`SPEC.md`](./SPEC.md) §2/§4.1
(C4, verified against code).

---

## 1. Backend (FastAPI)

**As-built layers** (dependencies point down only; `core/` never imports `services/` — pinned by
`test_arch_invariants_qh9.py`):

```
app/api/        one router per resource (JSON + SSE)          → SPEC §8.2 (router table)
app/services/   ActionService (gate+audit) · agent/ (session loop, subagents, memory,
                compaction) · fleet.py / svc.py pollers · actions/ · tools/
app/core/       tool registry · permissions.decide() · redact · skills/memory/agents Protocols
app/adapters/   ssh · wol · inference · voice · mcp_client · openapi_tools · searxng ·
                embeddings · openterminal (one construction site each; runtime.reconfigure)
app/domain/     Risk/Privilege/OSType enums · Host/Service/Conversation/Plan models
```

Authoritative detail: **`DESIGN.md`** — §1 layout · §3 the unified `Tool`/`ToolSpec` registry +
`decide()` gate · §5 the agent loop (state machine, subagent bounds) · §7 inference · §16 the
extension cookbook ("add an action/tool/skill/agent/MCP server = one file/row"). Inventories:
**`SPEC.md`** §4 (execution chain), §5 (agent flows).

## 2. API surface

Superseded sketch — the **real router inventory** is `backend/app/api/` (14 routers: access ·
actions · agent · automations · events · health · hosts · integrations · media · prompts ·
services · settings · tools · voice)
and the verified table in **`SPEC.md` §8.2**. The SSE wire contract is **`DESIGN.md` §12**
(lockstep-guarded against `session.py` by `test_sse_event_lockstep_qh7.py`).

## 3. Data model

Superseded sketch — authoritative models live in **`DESIGN.md`** (§2 domain entities · §4 message
`parts[]` · §9 the `Settings` config inventory, 15 sections) and **`SPEC.md` §6** (as-built config
section table + SQLite schema). Secrets: `*`-marked fields are gitignored in YAML, masked on API
read, redacted from output — the full model is **`SECURITY_MODEL.md` §4**.

## 4. Agent memory (pluggable — configurable in Conf)

Superseded sketch — v1 memory is the **Hermes-style file model** locked in **DECISIONS D14 + D15
#4–#7** (per-agent `memories/MEMORY.md` + global `USER.md` under `$CTRLB_HOME`, injected into the
system prompt, self-curated via the `memory` tool, git-backed per **D26**, store registry per
**D27**). The `MemoryProvider` Protocol (`core/memory.py`) remains the swap seam; `session_search`
(FTS5, redacted) is the recall tier; the vector store is the named later mode. Detail:
**`DESIGN.md` §6**.

## 5. Frontend (React PWA)

Superseded sketch — the frontend shipped Phases 2–8; as-built structure: **`SPEC.md` §7** (render
discipline) · **`DESIGN.md` §13** (TS state) · **`THEME_ENGINE.md` §14** (the theme layer: tokens ·
Kit · Surfaces) · **`VAPOR_PATTERNS.md`** (tokens/recipes for net-new UI).

Visual fidelity (**D7**) applies **per theme** — every theme is a faithful execution of its own
prototype; the living bar + build checklist are in **`THEME_ENGINE.md`** (§13 + the §14.13
slot-in contract; vapor byte-frozen per the §14.15.3 ladder / D51). The original vapor-port checklist that stood here:
`HANDOFF_ARCHIVE.md` (the standing-mandate block) + git history. Theme build records:
`VAPOR_ASSIMILATION_PLAN.md` · `COSMOS_HANDOFF.md` · `FRONTIER_PLAN.md` · `GACHA_PLAN.md`.

## 6. Deployment profiles

| Profile | Launch | Notes |
|---|---|---|
| **Ubuntu 26 LTS** *(emma — dev + deploy host)* | `systemd` **user** units from `deploy/linux/systemd/` (`ctrl-b-dashboard.service` prod :5433, `ctrl-b-dashboard-dev{,-web}.service` on-demand); `--reload` ok for dev | **primary today**; the live topology (D32) |
| **Windows 11** | `uvicorn app.main:app` via `.bat` / Task Scheduler — **no `--reload`** | frozen reference (corsair is a managed fleet host now); see gotcha below |
| **macOS** | `uvicorn app.main:app` (`--reload` ok for dev) | sibling POSIX path |
| **Android / Termux** *(exp.)* | `uvicorn` in Termux + `termux-wake-lock` + foreground service, charger | phone = host; WOL only on its LAN; high port (no root) |

**Serving the SPA (D55).** In **dev** Vite owns the SPA and proxies `/api` to uvicorn. In **prod**
there is no Vite: uvicorn serves `frontend/dist` single-origin via FastAPI's native `app.frontend()`
(a low-priority route consulted only after every path operation and mount), so build artifacts keep
their own content types. After the API routers come the owner-media mounts, then the SYS-5 `/api`
guard, which must remain the final normal route. This path exists **only** in prod, which is why a bug in it stayed invisible to
dev, to the Playwright suite (it runs against `vite preview`, which serves `dist` correctly) and to
every status-code health check for the app's whole life — see SYS-19.

**Data root (`$CTRLB_HOME`, D15 #2).** All data — `config.yaml`, `ctrlb.db`, `SOUL.md`, `memories/`,
`skills/`, `agents/` — lives under one relocatable root (env `CTRLB_HOME`; mirrors Hermes' `HERMES_HOME`).
Resolution: explicit `CTRLB_CONFIG`/`CTRLB_DB` override their specific path (back-compat + temp-config
tests) → else derive from `CTRLB_HOME` → else today's project-root default. **emma/new installs set
`CTRLB_HOME=~/.ctrl-b`**; corsair keeps working with nothing set.

**OS-agnostic by design.** All target-OS branching keys off `host.os_type` (the *managed* host),
never the server's OS — so an Ubuntu server on emma running a Windows host is the same code path
as a Windows server on corsair running a Linux host. The server-OS branches are a **closed
allowlist** (pinned by the drift-guard `backend/tests/test_arch_invariants_qh9.py`):
`fleet._ping_cmd` (local ping syntax — Windows `-n`/`-w`, Linux `-c`/`-W`, BSD/macOS `-c`/`-t`,
decided at call time so a Termux profile stays alive) · `run_shell`'s per-OS shell
(`services/actions/shell.py`) · `core/fsutil._fsync_dir` (directory-fsync durability no-op on Windows —
git is the durable record regardless) · `tools/check.py` (venv/npm resolution, the runner's one OS
chokepoint, outside the app). Any new server-OS branch must be consciously added to both the guard
and this list. Paths use `pathlib`; the YAML writer preserves the existing file's CRLF/LF so a
Windows host can't churn an LF config to CRLF.

**Gotcha — Windows + `uvicorn --reload`.** On Windows, uvicorn's reload worker uses an event
loop that does not properly support `asyncio.create_subprocess_exec`. `fleet.ping_host` shells
out to `ping`, captures empty output under reload, and every host reports offline (no error,
just silent failure). **Run plain `uvicorn app.main:app --port 5433` on Windows** (or use
`watchfiles` externally to restart). Linux/macOS reload mode is fine — those loops have full
subprocess support.

**HTTPS for mic:** front any profile the phone reaches with **Tailscale Serve** so the PWA gets
a secure context (`getUserMedia` needs HTTPS off-localhost). Runbooks: `HTTPS_TAILSCALE.md` ·
`DEPLOY_EMMA.md` (the D32 two-instance emma topology).

## 7. Security model

Owned by **[`SECURITY_MODEL.md`](./SECURITY_MODEL.md)** (trust boundary, the `decide()` gate,
confirm-tokens, secret handling, the safe-defaults checklist). Two load-bearing facts kept here
because code/config comment-anchors cite "§7": the backend binds **`127.0.0.1`** with Tailscale
Serve as the only ingress, and **`debug=False` by default — an enabled debugger is a
remote-code-execution surface**; never enable it on anything reachable.
