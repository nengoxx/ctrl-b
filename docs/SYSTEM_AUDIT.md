# System Architecture Audit (SYS)

> **What this is.** A code-verified audit of ctrl-b's **overall architecture and design patterns**
> — layering, composition, config system, persistence, fleet/service polling, frontend store/theme
> architecture, deploy topology — deliberately **excluding the agent chat loop**, which has its own
> audit + plan in [`AGENT_CHAT_AUDIT.md`](./AGENT_CHAT_AUDIT.md) (ACA). Finding ids are **SYS-#**.
>
> **Status:** v1.1 — deep pass complete (voice · theme-kit internals · test suite & quality
> guardrails, per owner request 2026-07-07) · **one user-facing bug found (SYS-13)** · **reviewed
> by the owner 2026-07-07** — SYS-13 (fix) + SYS-14 (Linux CI) are scheduled pre-deploy in
> `TODO.md` Phase 9; the remaining findings route per the §4 priority map.
> **Method:** main-session code reading (Fable, high): `main.py`, `config.py` (full),
> `runtime.py`, `db.py`, `services/{fleet,svc,deps,events,conversation,action_service}.py`,
> `core/{tool,permissions,events,failover,memory}.py`, `api/{settings,integrations,events,agent,voice}.py`,
> `adapters/{inference,mcp_client,ssh,voice}.py`, the frontend keystones (`App.tsx`,
> `store/{createStore,composer,chat}.ts`, `lib/{composer,audioController}.ts`,
> `hooks/{useComposer,useEvents,useDictation,useAutoTts}.ts`, `api/client.ts`, `vite.config.ts`),
> the theme engine (`theme-engine/{registry,types,resolve,lazyRoot,switchTheme,tabs}.ts`,
> `ThemeProvider`, `kit/{DefaultRoot,composer/Composer}.tsx`, `components/Composer.tsx`), and the
> quality harness (`tools/check.py`, `.githooks/*`, `backend/pyproject.toml` ruff/pyright config,
> `package.json` scripts, `backend/tests/` inventory + `_async.py`, `frontend/tests` + `e2e/`
> inventory). **Still not deep-read:** `adapters/{wol,searxng,openterminal,openapi_tools}.py`
> (covered by the earlier verified tool-path research), `heroScene.ts`/cosmos canvas internals,
> individual test file contents beyond targeted greps. Chat-loop files were read in the ACA pass.

---

## 1. Architecture map (as built — verified)

**Backend: a clean ports-and-adapters layering** with real import discipline:

```
api/        thin routers — validate, delegate, map errors (verified: settings.py is exemplary)
services/   orchestration — ActionService, Fleet/ServiceService, repos, agent runtime
core/       pure logic + Protocols — tool registry, permissions, failover, EventBus, memory/skills
            protocols. NO service imports (Deps is structurally typed at the boundary)
adapters/   I/O clients — ssh, inference, mcp, voice… all failures normalized to typed results
domain/     pure pydantic models — Host, Service, Message/Part, AgentDef, enums
```

Cross-cutting spines: **one** tool registry feeding UI + agent (`core/tool.py`), **one** execution
gate (`ActionService` → `decide()` → Event audit), **one** config-write chokepoint
(`edit_config_yaml` — comment/format/EOL-preserving), **one** event bus + audit trail
(`EventService.record` = persist + publish), **one** DB with WAL + a process write lock.

**Composition root:** `main.py::lifespan` builds everything in dependency order and stashes it on
`app.state`; `runtime.py` is the single reconstruction seam (`set_*` helpers shared by lifespan and
`reconfigure` — the documented anti-drift rule, verified to hold).

**Frontend:** thin-host `App` (renders `<ActiveRoot/>` + app-global effects only) + null-rendering
`AppEngines` for data subscriptions (D29); dep-free `createStore` singletons (D23) beside TanStack
Query for server state; theme registry with lazy non-default roots; PWA via vite-plugin-pwa with
`/api` excluded from caching.

**State doctrine** (consistent everywhere, and worth naming as the project's signature pattern):
*config declares, probes derive, nothing stateful is stored that can be recomputed* — host/service
status probed + TTL-cached, never persisted; skills/agents/memory read fresh from files per use;
`tailscale serve status` read live rather than a stored flag; appearance the one deliberate
exception (server-stamped LWW).

## 2. What is exemplary (verified — preserve; several are ⭐ reference-grade)

| Pattern | Where | Note |
|---|---|---|
| ⭐ Config secret model | `config.py:60‑78, 1019‑1138` | Two disjoint rules (declared leaf keys + hint-matched credential-map subkeys), a drift-guard test hint set, mask-on-read, **unmask-on-write with identity-matched list carry-over** (`base_url`/`url`/`name`) so reordering `fallbacks` can't clobber a stored key with a mask. |
| ⭐ Comment-preserving config writes | `config.py:943‑1016`, `api/settings.py:104‑106` | `prune_unchanged` → `unmask_secrets` → ruamel round-trip via the single `edit_config_yaml` chokepoint; EOL detected from raw bytes so Windows never churns an LF file. PUTs serialized by a write lock. |
| ⭐ Runtime reconfigure seam | `runtime.py` | One construction site per adapter, shared by lifespan + `reconfigure`; live-read vs captured-client distinction explicitly documented per subsystem; `restart_required` surfaced for the three truly-unappliable paths. |
| Single-flight TTL caches | `fleet.py:105‑115`, `svc.py:77‑100` | N polling clients share one sweep (lock + monotonic TTL); service liveness derives from the shared fleet cache so the two stay coherent; OS ping syntax branched at call time (keeps Termux alive), TTL-based reply parsing more honest than exit codes. |
| Protocol-swappable strategies | `core/{skills,memory,agents}.py`, `subagents.py` | SkillProvider/Selector, MemoryProvider/Backup, AgentSelector, Orchestrator — one consistent D11 shape; every default is file-based + stateless with live re-read. |
| Unified per-item config objects | `ToolOverride` (`config.py:573‑589`) + `_fold_legacy_tool_descriptions` | The owner's shape-to-extend directive, implemented with a zero-touch legacy fold that respects an explicit `""` as "restore default". |
| Migration discipline | `db.py:21‑126` | Numbered append-only migrations; FTS kept in sync by triggers deriving from the JSON `parts` column so the schema has one source of truth. |
| Frontend store discipline | `createStore.ts`, `App.tsx`, `store/composer.ts` | Documented snapshot contract; engines isolated from the theme tree; drafts hoisted + persisted with an explicit "single global slot" decision and its named future seam. |
| Test traceability | `backend/tests/test_*_{d17,d26,d27,j3,i4…}.py` | Tests named for the decisions they pin — drift-guard tests (e.g. `test_memory_registry_d27`) turn doc claims into gate assertions. |
| ⭐ Voice stack (v1.1 pass) | `adapters/voice.py`, `api/voice.py`, `useDictation.ts`, `audioController.ts` | Server-side proxy keeps keys out of the browser; split connect/read timeouts make failover snappy; the dictation hook is a real 5-state machine with re-entrancy guard, stream release on every exit path, and mime↔extension agreement derived from the recorder's *actual* container; the TTS singleton uses `reqSeq` guards against out-of-order async settles and mirrors the `<audio>` element as truth. Production-grade UX engineering. |
| ⭐ Theme engine (v1.1 pass) | `theme-engine/{lazyRoot,switchTheme}.ts`, `kit/DefaultRoot.tsx` | `preloadableRoot` fixes the React.lazy one-tick Suspense flash under `flushSync` (a subtle, correctly-diagnosed interaction); View Transitions with slow-work-first + motion-flag gating + graceful no-support path; ThemeDef registry mirrors the backend action-registry pattern; per-theme settings mirror VS Code's configuration contributions. |
| Quality gate (v1.1 pass) | `tools/check.py`, `.githooks/*` | One data-driven runner (adding a check = one `Check(...)` row), parallel with grouped output, run-all-and-summarise, preflight with actionable fixes, fast/full split matched to hook latency budgets, e2e deliberately serialized (documented flake rationale). The venv-first interpreter resolution dodges the Windows Store-python stub. |
| Async test infra (v1.1 pass) | `backend/tests/_async.py` | A single `asyncio.Runner` shared across sync tests — the documented-correct 3.14 pattern, with the deprecated-API history and the pytest-asyncio migration explicitly recorded as future work (TRIAGE-2). |

## 3. Findings ledger

### SYS-1 · Multi-statement write sequences are not transactional — **MED (top finding)**

`Database.execute` commits **per statement** under the write lock (`db.py:168‑173`); there is no
transaction helper. Several flows are read-modify-write *sequences* of such statements, and a crash
(power loss, OOM-kill, deploy restart) between them leaves torn state:

- **Compaction is the sharpest case** (`compaction.py:110‑123`): it `add`s the summary message,
  *then* flips each folded original `compacted=True` in a loop — one commit each. A crash after the
  summary lands but before the flags flip leaves **both the summary and the unfolded originals** in
  the working context → duplicated content next turn (partially self-healing on a later compaction,
  but the thread runs inflated until then).
- `POST /agent/plan`'s fresh-pair path and `/api/exec` each add two messages (call + result);
  `/agent/apply` updates two rows. Their torn states are graceful (`_assemble` synthesizes results
  for orphaned calls) but still inconsistent-on-disk.

**Improvement:** a `Database.transaction()` async context manager (BEGIN…COMMIT under the existing
write lock; rollback on error), adopted by the 3–4 multi-write flows. Small, self-contained, and it
hardens exactly the layer everything else trusts. *(Rider: the docstring "reads use `query`
lock-free (WAL)" overstates — all ops share **one** aiosqlite connection whose worker thread
serializes them anyway; WAL's read concurrency is unused. Not a bug — it actually makes
`SQLITE_BUSY` impossible — but the comment should say so, and a reader-pool is the named seam if
read latency ever matters.)*

### SYS-2 · Two-phase `Deps` initialization makes invalid states representable — **LOW-MED (design debt)**

`Deps` is constructed early with seven fields, then **back-filled** with seven more
(`main.py:183‑189`) after the chat stack exists, because of the `deps ↔ action_service` import
cycle (`deps.py:25‑26`). Consequences: every agent-runtime field is `Optional` forever, guard
checks are scattered (`subagents.py:174‑181` "subagent runtime is not fully wired",
`session_search`, `memory` tool), and nothing but convention prevents a future tool from reaching
a not-yet-filled handle during lifespan. The cycle is the smell: `ActionService` needs `Deps`, and
`Deps` wants to carry `ActionService` back to tools. **Improvement (refactor-sized, not urgent):**
split the bundle — a complete-at-construction `CoreDeps` plus an `AgentRuntime` built after the
chat stack (non-Optional fields), or have tools receive the ActionService via
`InvocationContext` only (it's already there implicitly — the invoking service could inject
itself), letting `Deps` drop the back-reference and the cycle with it.

**STATUS 2026-07-20 — STILL OPEN, UNSCHEDULED (re-homed).** This was parked on "pairs with ACA
Slice 3 (both touch lifespan wiring)". **Slice 3 shipped 2026-07-18 without it** — durable turns
reshaped who *iterates* the loop, not how `Deps` is assembled — and Phase 12 has since closed at
Slice 8, so the parking slot is gone. Nothing here regressed and nothing is blocked: the finding is
design debt, not a defect, and the "subagent runtime is not fully wired" guards still read correctly
at runtime. **Next home:** it is a post-ACA refactor-wave candidate with no owning phase — pick it up
opportunistically alongside any other lifespan/`main.py` wiring change (that adjacency, not a slice,
is the real trigger). Tracked in §4's table; **not** in `TODO.md` — deliberately, since scheduling it
is an owner call, not a bookkeeping one.

### SYS-3 · Tool overrides mutate shared registry specs in place — **LOW-MED (ties into ACA-17)**

`apply_tool_overrides` (`runtime.py:114‑144`) overwrites `spec.description`/`agent_exposed`/`core`
on the **live registered `ToolSpec` objects**, with originals stashed in an `app.state`
side-table. It works, and mutating the one seam reaches model + UI at once (the documented
rationale) — but it's shared mutable state read concurrently by turns, and it's half of why the
ACA-17 rediscovery race matters (specs can change under a reader). **Improvement:** when ACA
Slice 2 gates rediscovery, consider inverting this to an **overlay-at-read** (resolve overrides in
`to_openai_tools` + the catalog DTO from `settings.tool_overrides` directly) so specs become
immutable after registration and the side-table (`tool_spec_orig`) disappears. Decide there —
don't fix twice.

**STATUS 2026-07-20 — the RACE is closed; the STRUCTURE is still open.**
- ✅ **Race closed** (`f0bbef4`). `PUT /api/settings` now **409s on a `tool_overrides` patch while any
  turn is live**, reusing the D38 turn-marker registry as the single busy-truth — the same gate and
  the same 409 shape as `POST /api/integrations/rediscover` (the ACA-17 precedent), so there is no
  parallel mechanism. Deliberately **scoped**, and the scoping is the load-bearing part: the trigger
  is the *presence* of the `tool_overrides` key on the raw patch, so appearance/inference/voice/memory
  writes are untouched (appearance sync is frequent + cross-device — a blanket 409 would be a real UX
  regression); and the gate lives **in the API handler, not in `apply_settings_patch`/the write lock**,
  because D44's `runtime.grant_approval` writes a `tool_overrides` patch *during* a live turn by design
  from the resume path. **Do not hoist this check into the shared core — that would break the "always
  allow" grant.** Tests: `test_settings_7a.py` + `test_approvals_grant_w2.py`.
- 🔓 **Still open, unscheduled: the overlay-at-read improvement itself.** Resolving overrides at
  `to_openai_tools`/catalog-DTO time (so registered `ToolSpec`s are immutable and `tool_spec_orig`
  disappears) removes the shared mutable state rather than serializing access to it. It is now a
  standalone refactor, no longer "decide inside Slice 2" — ACA is closed and Slice 2 shipped the
  interim gate instead. Size M; home = the table in §4 below.

### SYS-4 · Dev topology quietly widens the security boundary — **LOW-MED (documentation + one default)**

Prod is sound: backend binds `127.0.0.1`, uvicorn serves `dist`, Tailscale Serve is the only
ingress. But **dev** runs Vite on `0.0.0.0` with `allowedHosts: true` (`vite.config.ts:59‑65`) and
proxies `/api` → the loopback backend — i.e. on the LAN, the backend's careful loopback bind is
bypassed through the dev server, unauthenticated. Acceptable on a trusted home LAN and consistent
with the tailnet trust model, but it is **not written down** — `SECURITY_MODEL.md` should carry a
"dev-mode exposure" line so the boundary is a decision, not an accident. Rider:
`TailscaleCfg.target_port` defaults to **5173** (the dev frontend); on emma prod, Serve should
front the backend-served SPA (5433) — `DEPLOY_EMMA.md` presumably sets it, but the *default*
encodes the dev topology, which is the wrong safe-default direction.

### SYS-5 · SPA fallback swallows unknown `/api/*` into `index.html` — **LOW**

`create_app`'s catch-all (`main.py:235‑237`) returns `index.html` (HTTP 200) for **any** unmatched
path when `dist` exists — including a typo'd `/api/...`. A misspelled endpoint in prod returns
200 + HTML where the client expects JSON (the `client.ts` error path then reports a confusing
parse failure instead of a 404). One-line guard: 404 when `full_path.startswith("api/")`.

### SYS-6 · `save_settings` is a comment-destroying writer kept alive as public API — **LOW (footgun)**

`config.py:888‑904` dumps via `yaml.safe_dump` — which strips every comment, reorders nothing but
expands defaults, and would wreck the operator's curated `config.yaml`. Grep-verified it is
**tests-only** today; every live write goes through `edit_config_yaml`. But it sits exported in
`__all__` next to the real write path, one careless import away from undoing the round-trip
discipline. Rename to `_save_settings_for_tests` / move to a test helper / or docstring-ban it
from production paths.

### SYS-7 · Hardcoded operational tunables in the polling layer — **LOW (owner-directive consistency)**

Same class as ACA-8: `fleet.py` `_DEFAULT_TIMEOUT_S = 2.0` / `_MAX_CONCURRENT = 16`, `svc.py`
`_PROBE_TIMEOUT_S = 1.5` / `_MAX_CONCURRENT = 16` are module constants while their sibling
cadence (`poll_seconds`) is config. A slow-WAN host (future `vpn_host`/D3 work makes this real —
pings over Tailscale routinely exceed 2 s) can't be accommodated without a code edit. Fold into
`ServerCfg` (e.g. `ping_timeout_s`, `probe_timeout_s`, `sweep_concurrency`) when D3 lands.

### SYS-8 · Config projections + agent resolution re-do filesystem/CPU work per call — **LOW (scale ceiling, no action)**

`Settings.hosts()`/`services()` rebuild pydantic objects on every call (per sweep, per roster, per
action lookup — with linear `next(...)` scans in `FleetService.host`/`ServiceService.service`);
`resolve_agent`/`load_agent` do fresh `is_dir` + YAML parse + SOUL.md read per call, and
`select_agent` loads **every** specialist per message when `auto_rotate` is on. All deliberate
(live-edit semantics, "stateless across turns") and all fine at ≤10 hosts / a handful of agents.
Recorded so the ceiling is known: the named seam is an mtime-keyed memo on the loaders, **not**
caching Settings projections (that would break the live-read contract).

### SYS-9 · Frontend cross-module contracts that only convention enforces — **LOW**

1. ~~`fillComposer` reaches for `#cmd-input` by DOM id…~~ **Superseded by SYS-13** — the v1.1 deep
   pass found this is not a fragile contract but an actual bug on today's composers.
2. `loadSkills`/`loadAgents` populate module-level sets **once at import** (`lib/composer.ts:47,66`
   — the comment says "refreshed each time the composer module is used," which import semantics
   don't deliver). A skill/agent added mid-session may route as "unknown command" until reload
   unless the editors re-call the loaders — verify the Conf editors do (and if so, note it there;
   if not, one `loadSkills()` call after a successful save fixes it).
3. `store/chat.ts` uses raw `fetch` while the rest of the app uses `api/client.ts` — justified for
   SSE (streaming body) but `initChat`/`reloadChat`/`compactThread` are plain JSON calls that
   bypass the client's error-detail surfacing. Consistency nit, not a bug.

### SYS-10 · Default-theme literal lives in two codebases — **LOW (consistency)**

`AppearanceCfg.theme = "vapor"` (`config.py:613`) bakes the default theme id server-side while the
frontend governs it via its own `DEFAULT_THEME` (per the assimilation directive: no `"vapor"`
literals). Cross-device LWW means the server value *is* authored state, so this mostly matters on
first-boot-before-seed — but the two defaults can drift silently. Either read the served default
from one place (frontend constant mirrored into config default by a drift-guard test) or note the
pairing in THEME_ENGINE.

### SYS-11 · Observability is logs-only, with no logging configuration seam — **INFO**

Adapters/services log via module loggers (failover hops, MCP discovery, sweep failures), but
`main.py` never configures logging — level/format is whatever uvicorn defaults provide, and
there's no config knob (e.g. `server.log_level`) nor a request-log switch. Fine for a homelab
(journald on emma captures stdout), but the first debugging session on emma will want
`log_level: debug` without a code edit. One `ServerCfg` field + a `logging.basicConfig` in
lifespan. (Metrics/tracing: correctly out of scope for this product; the Events feed *is* the
domain-level audit trail.)

### SYS-12 · Riders already tracked elsewhere (no double-fix)

The chat-side architecture findings (turn lifetime, per-thread races, registry rebuild race
ACA-17, spec `timeout_s` policy) live in ACA — this audit deliberately defers to it. UI
performance/a11y is `UI_AUDIT.md`. Deploy-gate items are `PRE_DEPLOY.md`/`DEPLOY_EMMA.md`.

---

*Findings below are from the v1.1 deep pass (voice · theme-kit · quality guardrails).*

### SYS-13 · `fillComposer` is broken against the now-controlled textareas — **MED-HIGH (confirmed user-facing bug)**

**The one real bug this audit found.** `fillComposer` (`lib/composer.ts:84‑90`) writes
`ta.value = text` and dispatches a synthetic `input` event; its comment still says *"the textarea
is uncontrolled."* That was true pre-F28 — but **both** composers are controlled now
(`value={draft}` + `onChange→setDraft`: vapor `components/Composer.tsx:73‑80` with the F28 comment
saying exactly this, kit `theme-engine/kit/composer/Composer.tsx:67‑75`). Against a controlled
React input, the direct `.value` assignment goes through React's instance value-tracker descriptor,
so when the synthetic `input` event arrives, React's change plugin sees node-value == tracker-value
and **swallows the event — `onChange` never fires, `setDraft` is never called**. Grep-verified no
native-prototype-setter workaround exists anywhere. Consequences:
- The store draft never updates, and `send()` reads **the store** (`useComposer.ts:40`
  `getDraft()`), so even while the injected text is *visible*, pressing send transmits the **stale
  draft** — a visible-vs-sent mismatch, the worst failure shape for a control that feeds a
  shell/action string.
- Any later React render snaps the textarea back to the store draft — the injected text vanishes.

**Affected callers (both user-facing):** the confirm bubble's **edit** button
(`AgentTab.tsx:226` — "tweak the command before running") and the markdown code-block
**send-to-composer** button (`lib/markdown.tsx:105`). Affected on **all themes** since F28.
**Fix (trivial, and it deletes the DOM coupling):** `fillComposer` = `setDraft(text)` + focus the
textarea (the id can stay for focus only, or a ref registry). **Add the regression test that was
missing:** a jsdom test that renders a controlled composer, calls `fillComposer`, and asserts the
*store* draft — the existing `tests/lib/composer.test.ts` covers routing only, which is exactly why
this survived. (Also a one-line e2e: tap edit on a confirm bubble → send → assert the sent body.)

### SYS-14 · No CI, and the gate never runs on the deploy OS — **MED (production-readiness)**

Grep-verified: `.github/workflows` does not exist. The entire quality bar is local git hooks
(`.githooks/` pre-commit `--fast` / pre-push full) — excellent design (SYS §2), but (a) one
`--no-verify` bypasses it with no backstop, and (b) **every check has only ever run on Windows**,
while the deploy target is emma (Linux). The codebase is deliberately OS-agnostic and the risk is
correspondingly *moderate*, but the platform-sensitive seams are real: `fleet._ping_cmd` OS
branches, `asyncio.create_subprocess_exec` behavior, path/EOL handling (`edit_config_yaml`'s CRLF
logic), the git-backup subprocess layer, `os.replace` semantics. **Improvement (S):** one GitHub
Actions workflow running `python tools/check.py` on `ubuntu-latest` (matrix-add `windows-latest`
if desired) — the runner is already cwd-independent and self-preflighting, so the workflow is
~15 lines. Sensibly lands **before** the emma deploy: it is the only way today's code gets
exercised on Linux before it *is* production.

### SYS-15 · Test-suite blind spots (inventory-verified) — **MED**

The suite (35 backend files, ~229 tests + 30 frontend files + 3 e2e specs; *point-in-time — 2026-07-10: 254 backend, 267 FE unit, 5 e2e specs*) is strong where it
looks — decision-pinned, API-driven, with real concurrency tests (`test_memory_concurrency_d27`)
— and the agent loop is well exercised *via* integration tests (7+ files drive `AgentSession`).
But content greps confirm whole subsystems have **zero behavioral coverage**:
- **`Compactor` — untested.** No test exercises the fold/split/turn-boundary/rolling-summary/
  truncation-fallback logic ("compact" appears only incidentally in two unrelated files). This is
  the scariest gap: compaction silently rewrites what the model sees, its bugs look like "the
  model got dumber," and ACA Slice 6 is about to make it *more* complex. Write the
  characterization tests **before** that slice.
- **`adapters/mcp_client.py` + `openapi_tools.py` — zero test references.** Discovery mapping
  (risk/annotation → spec), namespacing, error normalization, truncation — all unpinned; these are
  also where ACA-3's timeout work lands, which needs a test harness anyway.
- **`fleet.py`/`svc.py` parsing — untested.** `_PING_TIME_RE` (the `time<1ms` operator nuance),
  the three OS command branches, TTL-based online detection, `probe_port` — all pure/cheap to pin,
  all platform-sensitive (compounds SYS-14).
- **Subagent orchestration — spec-level mentions only.** No behavioral test for privilege clamping,
  depth caps, per-child timeout, sibling isolation on failure, or the global semaphore.
- **No coverage measurement anywhere** (no pytest-cov, no vitest coverage) — these gaps are
  invisible to the gate; the inventory grep above is currently the only way to see them.
**Improvement (M, phased):** (1) add coverage reporting to both runners — *measure first*, no
threshold gate yet; (2) characterization tests for Compactor + fleet/svc parsing (pure functions,
cheap); (3) adapter tests ride along with ACA Slice 1's MCP work; (4) subagent behavioral tests
ride with ACA Slice 3 (cancellation semantics need them regardless).

### SYS-16 · The documented lint/type ratchets haven't been pulled — **LOW-MED**

All three baselines say "start small, ratchet later" and none has ratcheted: **ruff** selects only
`E,F,I` with `E501` ignored (`pyproject.toml` — no `B` bugbear, no `ASYNC`, no `SIM`/`UP`);
**pyright** is `typeCheckingMode: basic`; **eslint** carries 29 deferred warnings (re-counted 2026-07-16; the F13
Compiler-prep backlog). For an async-heavy production backend the cheapest high-value pull is
**`ASYNC` (flake8-async) + `B` (bugbear)**: ASYNC statically flags blocking-calls-in-async-context
— the exact defect class this audit and ACA keep finding by hand (sync file reads on the loop,
missing awaits) — and B catches mutable-default/loop-var classes. Expect a small, mostly-mechanical
fix wave. Pyright `strict` is a bigger lift; schedule it as its own slice post-emma (QUALITY.md
already names it). Pull the ruff rules **before** the ACA build waves so new code is born under the
stricter bar.

**ADDENDUM (pre-flight, 2026-07-16 — the ratchet's measured reality + blind spots).** The dry run
found exactly **3** findings (2× ASYNC240 in `memory_backup.py` `commit`/`_ensure_repo`, 1× B007 in
`dns_trace.py`) — far smaller than the predicted wave; fix shapes are pinned in the HANDOFF banner
slice. ⚠ **ASYNC240 is lexical**: it fires only on a statically-known `Path` receiver (a `Path(...)`
call or a `Path`-annotated name) and **misses BinOp receivers** (`(root / ".git").is_dir()`) **and
sync helpers called from async** — so ratchet-green ≠ "async-audited". Known unflagged
async-blocking sites (→ the ACA Phase-12 deep pass, recorded so the gap is visible): `db.py:159`
`connect` mkdir · `services/agent/memory.py:271-272` `overwrite` is_file/unlink (under guard) ·
`memory_backup.py` `reconcile` :121 `.exists()` + `_mtime_iso` stat · `api/agent.py` agent/skill
CRUD cluster (~:377-520, `.read_text()`/`.mkdir()`/`.unlink()` — the largest) ·
`services/actions/terminal.py:184` remote glob. Also recorded: ruff `--preview` would add 2 ASYNC
yield-in-async-generator findings in `events.py` (preview stays OFF); B008/`Depends()`-in-default
count today = 0 — a future hit resolves via `Annotated[...]`, never a project-wide ignore.

**✅ CLOSED 2026-07-20 — the deep pass ran (`1b47e50` + `f550a2d`).** The ratchet itself was pulled
2026-07-16 (`f5c8e05`, its 3 findings fixed); this closes the *deferred blind-spot list* above — the
item that was addressed to "the ACA Phase-12 deep pass" and that no ACA slice ever owned. Every site
moved off the loop with the convention already in the tree (`memory_backup._prep_repo_dir`): hoist the
whole blocking sequence into ONE module-level sync helper reached by a single `asyncio.to_thread` hop,
rather than wrapping each call (fewer thread hops, and it does not widen the is_file/unlink and
mkdir/write TOCTOU windows). No behavior or error-semantics change — the 404/422 paths are preserved
by a sentinel return. Sites: the `api/agent.py` agent/skill CRUD cluster (the largest — **note the
addendum's `~:377-520` line refs were already stale; the cluster sat at ~:1183-1338 before the fix**) ·
`services/agent/memory.py` `overwrite` **and `write`** · `memory_backup.reconcile`. Two entries above
did **not** need work: `db.py` connect-time mkdir is deliberately left on the loop (startup, before
traffic — it is the guard's one allowlist entry), and `services/actions/terminal.py:184` was a false
positive (an `await`ed *remote* HTTP glob, never blocking).

The durable part is **`backend/tests/test_arch_invariants_sys16.py`** — a QH-9-style AST drift guard
with **two** invariants, one per blind spot the addendum named: (1) direct blocking fs calls lexically
inside an `async def` (excluding nested sync defs and awaited calls), and (2) an `async def` calling a
module-level sync helper that transitively does blocking fs work — the shape ruff can never see.
Both fail on anything not explicitly allowlisted-with-a-reason, and both also fail on a *stale*
allowlist entry so it can't rot. Invariant (2) earned its keep immediately: it found **2 sites the
hand audit missed** — `memory.write` (the agent's own memory-tool write path, sibling of the
`overwrite` fixed in the parent commit; its whole read-merge-cap-write critical section is now one
hop) and `tailscale._bin`'s `shutil.which`/`os.path.exists` PATH probe. 715 backend tests green.
*(Ratchet-green still ≠ async-audited for non-fs blocking — network/CPU sync calls are out of this
guard's scope; the note above stands as the reason ruff alone is insufficient.)*

(a) `POST /voice/tts` accepts unbounded `text` (`api/voice.py:61‑67`) — an accidental huge input
synthesizes a huge clip fully in memory (the buffered-clip design is deliberate; the missing piece
is just a char cap → 422, mirroring the memory caps' floor pattern). (b) `POST /voice/stt` reads
the whole upload into memory with no size cap (`file.read()`, `api/voice.py:43`) — same shape,
same fix (cap → 413/422). (c) The TTS blob cache revokes object URLs only on `/clear`
(`audioController.ts:163‑167`) — a very long session accumulates one blob per spoken reply;
fine in practice, worth an LRU cap if auto-TTS + long sessions become the norm. All three are
single-user-benign; they matter as *robustness posture* for production.

### SYS-18 · Theme/kit + e2e riders — **INFO/LOW**

(a) The kit's measurement effects locate chrome by class contract
(`.kit-appbar`/`.kit-composer`, `DefaultRoot.tsx:76,94`) — same implicit-contract class as the old
SYS-9.1, but *internal* to the kit (both producer and consumer live in `theme-engine/kit/`), so
convention is acceptable; a one-line comment on each class in `kit.css` naming the dependents
would make it survive refactors. (b) DefaultRoot hardwires the four tab bodies — already a
*documented deliberate* deferral (`tabs.ts` header: the id→body registry is a named future seam,
D31 no-speculative-registry). Not a finding; recorded so nobody "fixes" it early. (c) The e2e
suite is smoke-scale (42-line a11y, 159-line flows, 31-line render vs a 3-theme × modes × 2-browser
matrix) — reskin confidence still rests on the manual side-by-side mandate (D7). Fine while themes
are hand-verified; the seam is per-theme render.spec cases parameterized over the registry, worth
expanding opportunistically as themes graduate the assimilation ladder.

---

## 4. Improvement plan (right-sized: riders, not a program)

Unlike ACA, nothing here warrants a multi-slice program. Map:

| Item | Size | When |
|---|---|---|
| **SYS-13 fix `fillComposer` → `setDraft`+focus, + the jsdom regression test** | **XS–S** | **Now — it's a live user-facing bug on every theme** (confirm-bubble edit sends stale text). |
| SYS-1 `Database.transaction()` + adopt in compaction/plan/exec/apply (+ docstring fix) | S–M | Standalone slice, promptly. Also a rider candidate for ACA Slice 2 (same integrity theme). |
| **SYS-14 CI workflow running `tools/check.py` on ubuntu-latest** | **S** | **Pre-emma-deploy** — the only way the code runs on Linux before Linux is production. |
| ~~SYS-16 pull the ruff `ASYNC`+`B` ratchet (+ fix wave)~~ | S–M | **✅ DONE.** Ratchet pulled 2026-07-16 (`f5c8e05`); the deferred blind-spot list closed 2026-07-20 by the deep pass + the two-invariant AST guard (`1b47e50`+`f550a2d`) — see the SYS-16 addendum. Pyright `strict` = still its own post-emma slice. |
| SYS-15 coverage reporting (measure-only) + Compactor & fleet/svc characterization tests | M | Coverage + pure-function tests promptly; Compactor tests **must precede ACA Slice 6**; adapter tests ride ACA Slice 1; subagent tests ride ACA Slice 3. |
| SYS-4 SECURITY_MODEL dev-exposure paragraph + `target_port` default decision | S | Doc-only + one default; pre-emma-deploy sensible. |
| SYS-17 voice caps (tts text / stt upload) | XS | Opportunistic robustness posture. |
| SYS-5 `/api` 404 guard in SPA fallback | XS | Opportunistic. |
| SYS-6 fence `save_settings` | XS | Opportunistic. |
| SYS-9.2 editor `loadSkills()` verify · SYS-18a kit-class comments | XS | Opportunistic. |
| SYS-3 overlay-at-read for tool overrides | M | **Still open, unscheduled.** The *race* was closed 2026-07-20 (`f0bbef4`: `PUT /api/settings` 409s on a `tool_overrides` patch while a turn is live). The structural inversion — resolve overrides at `to_openai_tools`/catalog time so specs are immutable and `tool_spec_orig` disappears — is now a standalone refactor; ACA is closed, so "decide inside Slice 2" no longer applies. |
| SYS-2 Deps split / context-injected ActionService | M | **Still open, unscheduled** — its parking slice (ACA Slice 3) shipped 2026-07-18 without it and Phase 12 has closed. Design debt, nothing blocked; pick it up opportunistically with the next lifespan/`main.py` wiring change. |
| SYS-7 polling tunables → `ServerCfg` | S | Fold into the ROADMAP D3 (`vpn_host`) slice. |
| SYS-8 / SYS-10 / SYS-11 / SYS-18c | S | Named seams; build on demand. |

## 5. Overall verdict

The architecture is **coherent, disciplined, and pattern-literate** — the layering is real (not
aspirational), the chokepoints are actually unique, the state doctrine is applied consistently,
and the config subsystem is better than most commercial tools' (secret round-tripping +
comment-preserving edits are genuinely hard to get right, and both are right). The v1.1 deep pass
confirmed the same standard holds in the corners: the voice stack and theme engine are
production-grade UX engineering, and the quality gate's *design* is exemplary.

**Production-readiness, specifically (the v1.1 question):** the code is ready; the *assurance
around it* has four gaps to close, in order: **SYS-13** (the one live bug — fix today),
**SYS-14** (no CI and zero Linux runs before a Linux deploy — close pre-emma), **SYS-15** (the
untested Compactor/adapters/parsers + no coverage measurement — the gate can be green while whole
subsystems are unpinned), and **SYS-16** (the ruff/pyright ratchets everyone agreed to pull
"later" — later is now, before the ACA build waves). SYS-1 (transactional writes) remains the one
runtime-robustness item that shouldn't wait.

Two meta-lessons this pass adds to the earlier one (*the pattern is only as strong as its
least-guarded exception*): **a refactor invalidates the comments that justified its callers** —
F28 flipped the composers to controlled and nobody re-audited `fillComposer`, whose stale
"uncontrolled" comment then read as assurance (SYS-13); and **a quality gate is only as strong as
what it measures** — 229 green tests coexist with an untested Compactor because nothing makes the
blind spots visible (SYS-15). Both argue for the same habit the repo already preaches: when a
contract changes, grep for everyone who relied on the old one.
