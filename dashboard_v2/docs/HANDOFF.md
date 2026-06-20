# Handoff — start here for a fresh session

**Purpose:** **Phases 0–3, 4a (text round-trip), 4b (agent tools + confirm bubbles), 4c (composer
prefix routing + markdown), 4d (`task_plan` + plan panel), and now 4e (context compaction) are
done** — the Vapor Fleet tab drives real fleet/action/service typed-actions, and the **Agent tab is
a live tool-using chat**: the model sees the action registry as OpenAI `tools`, the loop runs ALLOW
calls through the existing `ActionService` and **suspends on a confirm-gated call** (med/high risk)
rendering a Vapor `.b.cmd` **command bubble** with execute/dismiss — resume re-opens the stream and
continues. **4c** added the shared composer's **prefix routing** (`!`→guarded shell [Phase-5 stub] ·
`/`→slash incl. `/local`//`/cloud` · else→agent), per-message inference-mode switching, and
**markdown bot replies** (hand-rolled, dep-free) with copy + send-to-composer on code blocks. **4d**
added the agent-only **`task_plan`** builtin + a live **plan panel** (TodoWrite-style checklist).
**4e** added **context compaction**: before each model call the loop folds the oldest complete turns
into a summary system message when the working context exceeds a configurable token threshold (or on
manual `/compact`), keeping full history in SQLite — with a **separately selectable summarizer
model**. **Phase 4f is essentially complete** — the agent gained: (1) SearXNG **`web_search`**
(collapsible result links), (2) an **MCP client** (Streamable HTTP, annotation-aware risk) merging
emma's `web-tools` (5 crawl4ai/SearXNG tools), (3) curated **open-terminal** shell/file tools
(configurable per-op risk), (4) a **generic OpenAPI tool provider** (for Open WebUI tool servers /
any OpenAPI service), and (5) an **embeddings client** (OpenRouter `qwen/qwen3-embedding-4b`,
verified live). All flow through the one registry → `ActionService` → gate → `.b.cmd` bubble. The
MCP supports **both transports** (Streamable HTTP + stdio, both live-verified). **Phase 4.5 (skills +
agents/subagents, D10/D11) backend is now DONE** — the loop is driven by a configurable `AgentDef`
(`agents[]`), file-discovered **skills** (`skills/<name>/SKILL.md`) inject instructions + narrow the
toolset (model-invoked by description · user-invoked via `/skill-name`), and **`spawn_subagents`**
delegates a batch of tasks to child agents run in bounded parallel (headless, depth-capped,
privilege-clamped). **Since then (see the 2026-05-28 session block below):** cloud chat is wired
(`inference.cloud` → OpenRouter Gemma 4 free, `default_mode` stays `local`); an **agent capability
layer** (loop-discipline guards + tool-selection routing) was added; a **`fleet` intent-skill**
auto-narrows the toolset so the weak local model behaves (the big finding — `minig+` isn't too weak,
the 21-tool namespaced set confused it); a **`check_service`** liveness tool + a **`reboot_host`**
action (with a device-row button); **clickable plan-step dots** (persistent, agent-aware); and an
**OS-compatibility pass** (ping/commands detect the host OS). **Phase 7 is sliced 7a–7e; 7a (settings
foundation + Inference/Server groups) and 7b (hosts + services CRUD machine editor) are built +
verified — see the two 2026-05-29 blocks below.** **7c (integrations: SearXNG/embeddings/open-terminal
hot-apply + MCP/OpenAPI managers with between-turn rediscovery) is built + verified. 7d (skills/agents
management UI + per-tool description overrides) is built + verified + committed (see the 7d block
below). Next up: 7e (prompts editors + memory panel). **The UI perf pass tracked in [`UI_AUDIT.md`](./UI_AUDIT.md) is now complete — Slices 1–8 shipped (10 of 13 findings landed; F9 `useTransition` and F13 React Compiler deferred until measured pressure warrants).**
This doc is the orientation; canonical detail is in the other `docs/` files. **The pixel-exact Vapor
fidelity mandate (D7) still governs every new component.**

> ## ⭐ The standing Vapor-fidelity mandate (D7) — applies to every phase
> The owner's priority is a **faithful, pixel-exact execution of `vapor.html`** — not "inspired by."
> Before writing any component:
> 1. **Open `../../ctrl-b (Vapor)/variations/vapor.html` in a browser at ~390px** and study the real
>    thing — the hero (sun bob + retrowave stripes, twinkling stars, moving neon grid, city/mountains
>    skyline SVG, live waveform canvas), the appbar (logo lozenge + auto-TTS toggle), device rows with
>    the expandable dropdown (services + kv detail + wake/stop mask-icon buttons), the fleet summary,
>    and the bottom tab bar with its sliding indicator.
> 2. **The CSS is already lifted verbatim** into `frontend/src/theme/vapor.css` (the 1064-line
>    `<style>` block — `:root`/`[data-theme]` variables + all component CSS). **Reuse those exact
>    class names and variables; do not re-derive colors/spacing/animations.** Componentize the
>    *markup* into React, keep the *styles* as-is.
> 3. **Read `vapor.html`'s markup + JS** (the part after `</style>`, ~line 1077+) to copy the exact
>    DOM structure and the animation logic (waveform canvas draw loop, tab indicator slide, hero
>    toggles) — port it, don't reinvent it.
> 4. **Verify side-by-side** against `vapor.html` at phone width before calling any piece done.
>    "Visually indistinguishable" is the acceptance test.
> 5. **Read [`VAPOR_PATTERNS.md`](./VAPOR_PATTERNS.md) before styling anything** — the distilled
>    design language (tokens, button taxonomy, the per-theme danger-color philosophy, and the
>    per-component decisions from the `ctrl-b (Vapor)/chats/`). It exists so net-new components
>    (which have no `vapor.html` markup to copy) stay consistent by construction.

## Read order (5 min)

1. `DECISIONS.md` — every locked choice + reasoning, the open items, and the future-additions list.
2. `ARCHITECTURE.md` — backend/frontend/data-model/action-registry/agent/voice/deploy design.
3. `DESIGN.md` — **concrete code design**: data structures, the unified capability/registry model,
   the agent loop state machine, concurrency (incl. concurrent subagents), persistence, the SSE
   wire protocol, end-to-end flows, edge cases, and the extension cookbook. Build against this.
4. `TODO.md` — the phased build plan. **Begin at Phase 0.**
5. `RESEARCH.md` — library/version pins + sources (incl. the secure-context/mic analysis).
6. `ROADMAP.md` — post-v1 features + the v1 seams to build now so they slot in.

The **visual source of truth** is `../../ctrl-b (Vapor)/variations/vapor.html` (mobile-first
vaporwave SPA: 4 tabs Fleet/Agent/Utils/Conf, per-host services, themes, composer w/ mic +
auto-TTS, command bubbles). Port it; copy assets (logo/favicon), don't import.

## Current state (7e-d ✅ · 7e-e ✅ · **7e-f sub-sliced: f-1 ✅ · f-2 ✅ committed (unpushed) · f-3 propose-UI = NEXT, needs own pre-flight**)

> **7e-f-2 is committed locally as `fc1aec2` (NOT yet pushed — push needs the owner's OK).** Everything
> before it is on `origin/main` (HEAD `6dc06db`). **7e-f-2 (core builtins + `skill_manage` + skill-write
> de-dup) shipped this session:** (1) `ToolSpec.core` + `@action(core=…)`; `for_agent` unions the `core`
> set so it survives any `tools` allowlist *and* skill narrowing; marked `task_plan`/`memory`/
> `session_search` `core=True` (resolves deep-audit finding #1 — `coder` no longer silently lacks
> memory/session_search). (2) `services/agent/skill_tool.py` `skill_manage` builtin (agent-only, LOW,
> **not** core): save|remove a SKILL.md in the agent's own skills folder; gating `skills_enabled` →
> new `AgentCfg.skills_auto_write` (off → propose-only, returns `data["proposed"]` for f-3). (3) De-dup:
> extracted `core/fsutil.py` `write_text_eol`; added `agent_skills_root`/`write_skill_md`/
> `remove_skill_md` + shared `valid_skill_slug` to `services/agent/skills.py`; refactored `/api/skills`
> + `/api/agents` to reuse them. Tests: `test_core_builtins_7e.py` (5) + `test_skill_manage_7e.py` (8);
> **full suite green (15 files)**, compileall clean, **live boot on 5433 verified** (`/api/actions` shows
> `skill_manage` builtin/core=False + the three core flags True). Write paths exercised on a temp
> `$CTRLB_HOME` only.
>
> **Next: 7e-f-3 — the shared Approve-to-apply propose-UI** (frontend). Both `memory` (`auto_write` off)
> and `skill_manage` (`skills_auto_write` off) now feed `data["proposed"]`; f-3 renders it as an
> Approve/Dismiss affordance on the tool bubble + an apply endpoint. **Needs its own pre-flight** over
> the AgentTab `.b.cmd` command-bubble + confirm-resume frontend — don't start it cold.
>
> **7e-d (file memory), 7e-e (`session_search`), and 7e-f-1 (per-agent skills) are done.** 7e-d: read path (`16bde75`) + the
> **`memory`** write tool (`e5ebcaa`/`ed1dfa8`) + the **Conf Memory panel** (`2e18638`). 7e-e
> (`003bad3`): migration #3 FTS5 `messages_fts` + `MessageRepo.search` + the **`session_search`**
> builtin (global + secret-redacted). **7e-f-1 (`6dc06db`)**: `available_skills(global_provider,
> settings, agent)` — a specialist's own `agents/<name>/skills/` is always available, merged over the
> global `skills/` it inherits via its existing **`skills` allowlist** (`*`/list/`[]` = all/subset/none —
> **no new field**, the reuse decision); own overrides inherited by name; default agent = the global set.
> `resolve_skills` refactored to take the precomputed set; `_activate_skills` rewired. Default-agent
> behaviour byte-identical. Verified: **full backend suite green (13 files)**, live boot clean. Tree
> clean except `start_claude_remote.ps1`.
>
> **7e-f is sub-sliced (owner's call): f-1 per-agent skills ✅ → f-2 `skill_manage` + core-builtins (NEXT)
> → f-3 shared propose-UI.** **7e-f-2 is fully pre-flighted and design-locked this session** (build it
> next):
> 1. **Core-builtin reachability (resolves the deep-audit finding #1).** Add **`core: bool = False` to
>    `ToolSpec`** + a `core=` param on `@action`; mark **`task_plan`, `memory`, `session_search`** as
>    `core=True` (owner's pick: the cognitive set — *not* `spawn_subagents`/`skill_manage`, those stay
>    explicit-grant). **`ToolRegistry.for_agent()` always unions the `core` tools** → they survive any
>    `tools` allowlist *and* any skill narrowing, in one place (fixes the `coder` agent silently lacking
>    `memory`/`session_search`).
> 2. **`skill_manage` builtin** (mirror `memory_tool.py`; **not** core): `@action("skill_manage",
>    category="builtin", risk=LOW, ui_exposed=False)`, `action: save|remove` · `name` (slug) · `content`
>    (full SKILL.md). Writes to the agent's **own** skills folder (specialist → `agents/<name>/skills/<slug>/`;
>    default → global `skills/`) — the `available_skills` mirror. Gating `skills_enabled` →
>    **`skills_auto_write`** (OFF → propose-only, returns `data["proposed"]` for f-3). Slug-validated →
>    ERROR on bad name; auto-audited via `ActionService._record`.
> 3. **Config:** add **`AgentCfg.skills_auto_write: bool = True`** next to `skills_enabled` (skills config
>    already lives under `agent.*` — no new `SkillsCfg`).
> 4. **De-dup the skill-file write:** extract the generic `_write_text_eol` from `api/agent.py` to a small
>    **`core/fsutil.py`**; add **`write_skill_md(root, name, content)` / `remove_skill_md(root, name)`** +
>    a shared slug validator to `services/agent/skills.py`; refactor the existing `/api/skills` endpoints
>    to use them (one source of truth). **Pre-flight already done** (skills subsystem, `memory_tool.py`,
>    skills API, config all read). Test on a **temp `$CTRLB_HOME`**.
>
> **Then f-3 — the shared Approve-to-apply propose-UI** (frontend): render `data["proposed"]` from *both*
> `memory` and `skill_manage` as an Approve/Dismiss affordance on the tool bubble + an apply endpoint.
> Needs its **own pre-flight** over the tool-bubble / confirm-resume frontend code (AgentTab `.b.cmd`
> command bubble + the resume flow). Biggest new frontend surface of 7e-f.
>
> **Deep-audit nuances still open (low, non-blocking — full detail two session blocks below):** (2) FTS
> triggers key on `messages.rowid` (VACUUM-fragile; INNER JOIN protects correctness; migration #4 only
> if ever needed). (3) `session_search` snippet truncation could leak a secret *fragment* (secrets rarely
> in chat text). Finding (1) is being resolved in f-2 above; the `ge=1` cap floor already landed (`d422dcc`).
>
> **The 7e sequence (D14/D15):** 7e-a✅ → 7e-b✅ → 7e-c✅ → 7e-d✅ → 7e-e✅ → **7e-f** (f-1✅ · **f-2 NEXT** ·
> f-3) → **7e-g** (optional `AgentSelector`).
>
> **Decided-but-deferred builds** (all design-locked): C1 dual-mode chat (D17), A1 privilege selection
> (D16), A2 question kind, F29 opt A (UI_AUDIT.md §6b).
>
> **Servers:** backend uvicorn **5433** (no `--reload`, venv), frontend Vite **5173** (HMR; `npm run
> dev` defaults to 5173 unless `--port 5190`). Phone: `http://corsair:5173`. Both tearable down
> without state loss. **Heads-up:** pytest is **not installed** in the backend venv — every test file
> has a `__main__` runner; run `./.venv/Scripts/python.exe tests/<file>.py`.

### ⭐ Session update — 2026-06-20 (build session #4 — **7e-f-2 shipped: core builtins + `skill_manage` + skill-write de-dup** · committed `fc1aec2`, **unpushed**)

Built 7e-f-2 end-to-end off the design lock from build-session #3 (re-read every touch point cold first,
per the pre-implementation directive — `core/tool.py`, `memory_tool.py`, `skills.py`, `config.py`,
`api/agent.py` skill/agent file CRUD, the builtin registration). One commit `fc1aec2` on `main`,
**not pushed** (push awaits the owner's OK). Tree clean except the standing `start_claude_remote.ps1`.

**Three pieces (all locked specs):**
- **Core-builtin reachability.** `ToolSpec.core: bool` + `@action(core=…)`; `ToolRegistry.for_agent`
  unions every `core` tool on top of the allowlist match — and since the *narrowed* allowlist is fed
  back through `for_agent`, core survives skill narrowing too. `task_plan`/`memory`/`session_search`
  are `core=True`. `for_agent` starts from `agent_tools()` (already `agent_exposed`-filtered), so core
  can never surface a non-exposed tool — no security-boundary change (all three are LOW read/cognitive
  ops still gated by ActionService). Resolves deep-audit finding #1. `spec_to_dict` carries `core`.
- **`skill_manage` builtin** (`services/agent/skill_tool.py`, mirrors `memory_tool.py`) — agent-only,
  LOW, **not** core (self-authoring is an explicit grant). `save|remove` a SKILL.md in the agent's own
  skills folder (`agent_skills_root`: default → global `skills/`, specialist → `agents/<slug>/skills/`).
  Gating: `agent.skills_enabled` → new **`AgentCfg.skills_auto_write`** (off → propose-only, returns
  `data["proposed"]`). Bad slug / empty `save` body → ERROR; auto-audited via `ActionService._record`.
  Registered in `services/actions/__init__.py`.
- **De-dup the skill-file write.** Extracted the EOL-preserving atomic writer to **`core/fsutil.py`**
  (`write_text_eol`); added `agent_skills_root`/`write_skill_md`/`remove_skill_md` + a shared
  `valid_skill_slug` (+ `SKILL_SLUG`) to `services/agent/skills.py`; refactored `/api/skills` (dropped
  the local `_SKILL_NAME`/`_skill_md_path`/inline writer) and `/api/agents` (uses the relocated
  `write_text_eol`) to reuse them — one source of truth, no parallel writer.

**Verified:** `test_core_builtins_7e.py` (5) + `test_skill_manage_7e.py` (8); **full backend suite green
(15 files)**, `compileall` clean. Backend restarted on **5433** (no `--reload`) — `/api/actions` shows
`skill_manage` (builtin, core=False, ui_exposed=False) + `task_plan`/`memory`/`session_search` core=True,
`spawn_subagents` core=False; `/api/settings` round-trips `agent.skills_auto_write`. All write-tests on a
temp `$CTRLB_HOME` (never the real config/skills). Frontend untouched this slice (5173 left as-is).

**Start here next session: 7e-f-3 — the shared Approve-to-apply propose-UI** (frontend, the biggest new
surface of 7e-f). Both `memory` and `skill_manage` already emit `data["proposed"]` when their auto-write
switch is off. **Pre-flight its own touch points first** — the AgentTab `.b.cmd` command bubble + the
confirm/resume flow + an apply endpoint. Don't start cold. **Also pending: push `fc1aec2`** once cleared.

### ⭐ Session update — 2026-06-20 (build session #3 — **7e-f-1 per-agent skills** + **7e-f-2 pre-flight/design-lock** · pushed)

Sub-sliced 7e-f (owner's call: f-1 per-agent skills → f-2 `skill_manage` + core-builtins → f-3 shared
propose-UI), built f-1, and fully pre-flighted + design-locked f-2. `6dc06db` (f-1) + this docs commit,
pushed. Tree clean except `start_claude_remote.ps1`.

**7e-f-1 — per-agent skills + inheritance (`6dc06db`).** Reuse decision (locked with owner): **no new
`skills_inherit` field** — the existing `AgentDef.skills` allowlist already expresses all/subset/none,
so it *is* the global-inheritance knob; a specialist's own `agents/<name>/skills/` is always available
on top.
- `services/agent/skills.py`: new **`available_skills(global_provider, settings, agent)`** = global
  `list()` filtered by `agent.skills` ∪ the agent's own-folder skills (specialist only), own-overrides-
  inherited by name. **`resolve_skills` refactored** to take that precomputed set (allowlist filtering
  moved out of it). The AgentsEditor Skills tick-grid (already bound to `agent.skills`) now reads as the
  inheritance selection — **no frontend change**.
- `services/agent/session.py`: `_activate_skills` builds the per-agent set via `available_skills`;
  subagents inherit the same path via `deps.skills`. **Default-agent behaviour byte-identical** (own=[],
  global filtered by its allowlist). The only semantic shift — `skills=[]` now means "no *inherited*
  global, own folder still on" — affects no current agent (own folders are new this slice).
- Tests `test_skills_per_agent_7e.py` (6). Full suite green (13 files); live boot clean.

**7e-f-2 — pre-flighted + design-locked (build next).** Two owner decisions taken: (a) **core builtins =
the cognitive set `task_plan`/`memory`/`session_search`** (not `spawn_subagents`/`skill_manage`),
bypassing both the agent allowlist and skill narrowing via a `core=True` `ToolSpec` flag honored in
`for_agent`; (b) **`skills_auto_write` lives in `AgentCfg`** (next to `skills_enabled`, no new section).
Full locked spec + the de-dup plan (extract `_write_text_eol` → `core/fsutil.py`; `write_skill_md`/
`remove_skill_md` in skills.py; refactor `/api/skills` to use them) is in the "Current state" block
above. No code written for f-2 yet.

**Heads-up for the propose-UI (f-3):** it's the shared Approve-to-apply affordance that both `memory`
(`auto_write=OFF`) and `skill_manage` (`skills_auto_write=OFF`) already feed via `data["proposed"]`. It
needs its own pre-flight over the AgentTab command-bubble (`.b.cmd`) + confirm-resume frontend before
building — don't start it cold.

### ⭐ Session update — 2026-06-20 (build session #2 — **7e-e `session_search`** + a **deep audit pass** · pushed)

Built 7e-e end-to-end (pre-flight → design → build → verify → review), then ran a deep audit over the
session's surface (7e-d-2/d-3 + 7e-e) at the owner's request. `003bad3` (7e-e) + an audit-hardening
commit + this docs commit, all pushed.

**7e-e — `session_search` (`003bad3`).** Pre-flight read `db.py`, `domain/conversation.py`,
`services/conversation.py`, and de-risked the FTS5+`json_each`-in-trigger approach with a throwaway
SQLite check before recommending it.
- **db migration #3:** `messages_fts` FTS5 over user/assistant message *text*. Kept in sync by AI/AU/AD
  triggers that extract the concatenated `TextPart` text from the JSON `parts` via `json_each`
  (reasoning/tool/system excluded by a `WHEN role IN ('user','assistant')` guard) + a one-pass backfill
  of existing rows. Pure SQL — no `MessageRepo` coupling; `parts` stays the single source of truth.
- **`MessageRepo.search`:** FTS5 `MATCH … ORDER BY rank` + `snippet()`, joins thread context, excludes
  archived (ephemeral subagent) threads at *query* time. `_fts_query` sanitizes each word to a quoted
  literal term so a model query with FTS operators can't throw.
- **`session_search` builtin** (LOW, `ui_exposed=False`): global recall; each snippet redacted via
  `core.redact` against **`Settings.secret_values()`** (a new value-level collector mirroring
  `mask_secrets`). Formats like `web_search`.
- Tests `test_session_search_7e.py` (8). Live: migration applied to the real db — **schema_version 3,
  backfill 368/368**, tool registered, snippets render.

**Deep audit findings (surfaced; none blocking):**
1. **Builtin reachability (inconsistency — owner decision).** The agent toolset is `for_agent(allowlist)`
   intersected with skill narrowing; there is **no always-on core-builtin notion**. So a specialist with
   an explicit `tools` list (the `coder` agent lists `task_plan`/`spawn_subagents`/terminal/web_search
   but **not** `memory`/`session_search`) silently can't use the new builtins, and every future builtin
   needs each specialist's allowlist updated. Pre-existing property, amplified by adding builtins.
   Recommend deciding in 7e-f: implicitly grant a core-builtin set, or document the requirement.
2. **FTS rowid coupling (latent fragility — low).** Triggers key on `messages.rowid`, not stable across
   `VACUUM` (messages has a TEXT PK). The app never VACUUMs, and the search `INNER JOIN messages ON
   m.id = f.message_id` means orphaned/stale FTS rows can't produce wrong results — only the
   trigger-resync would target a stale rowid post-VACUUM. Robust fix = key triggers on `message_id`
   (needs a migration #4); deferred (no VACUUM in the codebase).
3. **Snippet fragment redaction (nuance — low).** Redaction replaces whole secret strings, but `snippet()`
   truncates at token boundaries, so a secret split by word-boundary chars (e.g. `sk-…`) could leak a
   *fragment*. Low severity (secrets rarely live in chat text; tool outputs are pre-redacted at write
   time; a fragment isn't usable). Documented limitation.
4. **FK-cascade delete (verified non-issue).** A thread delete may not fire the AD trigger (orphaned FTS
   rows), but the search INNER JOIN filters orphans → no wrong results, only potential bloat. No action.
5. **Applied hardening:** `MemoryCfg.memory_char_limit`/`user_char_limit` floored `Field(…, ge=1)` — a
   blanked Conf cap field (→ 0) used to silently wedge all agent memory writes (every write over-caps);
   now the PUT 422s. Suite re-verified green.

**Start here next session: build 7e-f** (per-agent skills + `skill_manage` + the shared propose-UI; and
likely resolve audit finding #1). Pre-flight list is in the "Current state" block above.

### ⭐ Session update — 2026-06-20 (build session #1 — **7e-d-2 + 7e-d-3 → 7e-d file memory COMPLETE** · 3 commits, all pushed `2e18638`)

Build session following the pre-flight read→design→build→review loop end-to-end. Finished file
memory: the write tool, a review-driven hardening, and the Conf panel. **3 commits on `main`, pushed**
(`e5ebcaa` → `ed1dfa8` → `2e18638`). Tree clean except the standing `start_claude_remote.ps1`.

**7e-d-2 — `memory` write tool (`e5ebcaa`).** Pre-flight read `planning.py`/`subagents.py` (builtin
patterns), `core/tool.py`, `services/agent/memory.py`, `action_service.py` (`_record` audit) before
writing. New `services/agent/memory_tool.py`: `@action("memory", category="builtin", risk=LOW,
ui_exposed=False)` — `add`/`replace`/`remove`, `target: memory|user`, substring `old_text`, **no read**
(content injected by d-1). `FileMemoryProvider.write` does the file edit (`§`-delimited add; first-match
replace/remove; blank-run collapse; over-cap → `MemoryCapError`). Gating order in the tool: master
switch → `user` profile switch → `auto_write` (OFF = propose-only/non-blocking, returns `data["proposed"]`,
Approve-UI deferred to 7e-f). Auto-audited via `ActionService._record`. Tests `test_memory_tool_7e.py`
(11). Registered alongside `planning`/`subagents`; live `/api/actions` confirms `category=builtin
risk=low agent_exposed=True ui_exposed=False`.

**Hardening (`ed1dfa8`).** Self-review/code-review of the d-2 diff caught a latent footgun: `needle =
old_text or ""` meant an empty `old_text` for replace/remove matched the always-present empty substring
(prepend / no-op) instead of erroring. The tool guards it today, but the provider gains a Conf-panel
caller in d-3, so made `write` self-protecting (reject empty `old_text`). Confirmed: **no concurrency
risk** — the sync `write` has no `await` between read and write, so parallel subagents serialize cleanly.

**7e-d-3 — Conf Memory panel (`2e18638`).** Provider `read_raw` + `overwrite` (blank clears; **uncapped**
— manual owner edits aren't bound by the agent's auto-write cap, owner's "soft cap" call) + protocol
additions. File API mirrors the skills/SOUL.md endpoints: `GET/PUT /api/agents/{name}/memory` (incl.
`default` → root) + `GET/PUT /api/memory/user`, slug-guarded via `_agent_folder`, paths delegated to the
provider. Frontend: `hooks/useMemory` (a `MemorySlot` abstraction + `useMemoryContent`/`useSaveMemory`,
mirroring `useSkills`), `components/MemoryEditor` (toggles direct-mutate `memory.*` like the Skills master
switch; caps in a local draft + Save; one editable row per file reusing `.kv-text.skill-md` + a cap-usage
counter), new Conf **Memory** group (#10; Agent tools/Computers/Appearance renumbered 11–13). Tests
`test_memory_panel_7e.py` (8). `tsc` clean; net-new CSS (`.mem-md-bar`/`.mem-count`) in `extras.css`
(vapor.css untouched, D7).

**Verified:** full backend suite green (11 files), `tsc` clean, backend rebooted on 5433 (read-only
endpoint smoke: default/user/coder → 200, bad slug → 422), frontend live on 5173 (HMR). Write paths
proven on **temp `$CTRLB_HOME`** workspaces — never the real `memories/`/config.

**Start here next session: build 7e-e — `session_search`** (FTS5 over `messages` + a builtin tool,
global + redacted, D15 #7). Pre-flight reading list is in the "Current state" block above.

### ⭐ Session update — 2026-06-16 (build session #2 — **7e-d-1 file-memory read path** + hook fix · cut off by a connection drop, handed off clean)

Build session, ended by a connection drop mid-way through "continue to 7e-d-2" — **no 7e-d-2 code was
written**, tree is clean at `16bde75`, everything pushed. What landed:

**7e-d sub-sliced (owner's call): d-1 (read path) → d-2 (write tool) → d-3 (Conf panel).** Plus two
locked decisions for the tool: `auto_write` OFF = **propose-only, no write, no block**; the
Approve-to-apply **UI affordance is deferred to 7e-f** (shared with `skill_manage`).

**7e-d-1 — file memory read path (`16bde75`).** The file impl of the ROADMAP B1 `MemoryProvider`,
injecting saved notes into every turn:
- `config.py` **`MemoryCfg`** (`Settings.memory`): `enabled` · `user_profile_enabled` · `auto_write`
  · `memory_char_limit` 2200 · `user_char_limit` 1375 (Hermes-named, `extra="allow"`).
- `core/memory.py` **`MemoryProvider`** Protocol (`load_context(agent) -> str`) — mirrors
  `core/skills.py`'s `SkillProvider`.
- `services/agent/memory.py` **`FileMemoryProvider.load_context`** — reads per-agent MEMORY.md (default
  agent → `$CTRLB_HOME/memories/`; specialist → `agents/<slug>/memories/`) + global `memories/USER.md`,
  formats each as a Hermes-style section (`## Agent memory (1% — 24/2,200)`). Stateless (paths/caps from
  live Settings each call → edits land with no restart).
- Wired on **`Deps.memory`** + **`app.state.memory`** (main.py, like `skills`); **`AgentSession` gains
  `memory=`**, injected in **`_assemble` right after `_appends()`** (D15 #4) via a `_memory_block()`
  helper; subagents pass `deps.memory`. `memory=None` → byte-identical prior behaviour.
- **`memories/` + `agents/*/memories/` gitignored** (personal data, D14) — landed *before* any file is created.
- `tests/test_memory_7e.py` (6): inject order, usage header, profile toggle, master switch, empty, per-agent isolation.

**Hook fix (`f2002c0`).** The commit-time post-flight reminder hook (`94f7bf8`) was **over-firing on
non-commit Bash** — the `if: Bash(git commit*)` gate mishandled compound `cd … && …` commands. Fixed by
dropping the gate; the command now greps its own stdin for `git commit` and emits the reminder only
then. Pipe-tested both ways (clean → silent, commit → reminder, exit 0). The hook is working as
intended now — you'll see it fire only on real `git commit` calls.

**Verified:** 38 backend tests green (6 new), `compileall` clean, backend rebooted on 5433 with the new
wiring, `/api/settings` confirms the live `memory` section. No frontend in d-1.

**Start here next session: build 7e-d-2** (the `memory` tool / write path) — full spec + pre-flight
reading list is in the "Current state" block above. Apply the coding-discipline loop; the commit-time
hook will remind you of the post-flight.

### ⭐ Session update — 2026-06-16 (build session #1 — shipped **7e-c `messages.agent`** + the `coder` example agent · 3 commits)

Build session, following the new pre-implementation directive end-to-end (read every touch point
before writing). Closed out 7e-c, added a real specialist agent as the live fixture, and recorded a
reusable engineering-discipline skill. Three commits on `main`, pushed with this handoff.

**7e-c — per-turn agent attribution (`messages.agent`, D15 #5) — `680b310`.** Records which AgentDef
produced each assistant turn so a restored thread shows the agent per-turn across `/agent` switches,
and resume continues as the last turn's agent.
- **db**: additive **migration #2** (`ALTER TABLE messages ADD COLUMN agent TEXT`, nullable — `null`
  = legacy rows / non-assistant turns). Applied live to the real `ctrlb.db` on restart (66 legacy
  rows → `null`).
- **domain/repo**: `Message.agent` round-trips through `MessageRepo.add`/`_row` (`update` left alone —
  agent is set at insert, immutable).
- **session.py**: stamp `self._agent.name` on the assistant turn in **both** `_drive` and `_finalize`
  (the forced-final-answer path — caught by the post-flight diff review, which is why both got it),
  and carry `agent` on the **`message.start`** SSE event so a live specialist turn is labelled
  immediately, not only after reload.
- **api/agent.py**: `resume()` resolves the **last assistant turn's `agent`** (→ `thread.agent` →
  default). Resume-only — a bare `/agent` clears the sticky session agent to `null` on the chat path,
  so applying the last-agent fallback there would break clear-to-default (verified in `composer.ts`).
- **frontend**: `ChatMessage.agent`; `AgentTab` labels a turn with its agent **only when it differs
  from the resolved default** (new always-on `useAgentRoster()`, reusing the `["agents"]` query key the
  mutations already invalidate); `store/chat.ts` carries the `message.start` agent onto the live bubble.
- **tests**: `test_messages_agent_7e.py` — 5 tests (migration + round-trip, restore API shape, resume
  prefers last-assistant agent over thread, latest-wins after switch, fall-through). Suite **32 green**,
  `tsc` clean. Run via the venv's `python tests/<file>.py` (**pytest is not installed in this venv** —
  every test file has a `__main__` runner; heads-up vs the docs that say "run with pytest").

**`coder` example specialist agent — `fe2cbe5`** (`dashboard_v2/agents/coder/`). Created through the
**file API** (`PUT /api/agents/coder` + `…/soul`) — the validated chokepoint, not hand-written files.
Scoped toolset (terminal read/list/grep/glob/write/exec + `web_search` + `task_plan` +
`spawn_subagents` + `mcp__web-tools__*` glob; **no** fleet/service controls — also exercises the
`tools` allowlist), `privilege=confirm`, `max_iterations:20`, `max_calls_per_tool:10`, and a
read-before-write coding persona in `SOUL.md`. `agents/` is **not** gitignored, so it's tracked.
Doubles as the live attribution fixture. (Reminder confirmed: agents are **folder-only** now — the
`agents:[]` config vector was removed in D15 #3; `$CTRLB_HOME` = project root = `dashboard_v2/` on
corsair, so the folder is `dashboard_v2/agents/coder/`.)

**`coding-discipline` skill — `cdace1b`** (`.agents/skills/coding-discipline/SKILL.md`). An always-on
engineering loop (pre-flight read/reuse/pattern/no-hardcoding → clean build → review/audit/debug/verify)
with a trivial fast-path; delegates depth to the existing audit/debug/karpathy/refactor/commit skills
rather than duplicating them. Claude-Code tooling, not a dashboard runtime skill.

**Heads-up / housekeeping:** the live attribution test left one throwaway chat thread (an "ok" turn)
in `ctrlb.db` — harmless, `/clear` drops it. Servers left up: backend **5433** (no `--reload`),
frontend **5173**.

### ⭐ Session update — 2026-06-15/16 (design/decisions session — **unresolved-items backlog closed**; no feature code)

Pure planning + decision session (per [[pause-between-phases-for-review]] + the new pre-implementation
directive). Walked the open-questions/loose-specs across HANDOFF/TODO/UI_AUDIT/DECISIONS one by one
with the owner and **locked every live decision**, grounding each in the actual code so the eventual
builds reuse existing seams (no parallel paths). **All pushed** (`f9c6315` → `ea03495` → `349dfcc` →
`11ce86a` + this handoff). Tree clean except the standing `start_claude_remote.ps1`.

**Decisions locked (each cites the seam it reuses):**
- **A1 privilege selection → D16.** Global default = **`agent.defaults.privilege`** (already wired —
  *no new `agent.default_privilege` field*; that was explicitly rejected as redundant), per-agent =
  `AgentDef.privilege` (shipped), per-session = a new **`ChatRequest.privilege`** override (`model_copy`,
  mirrors `ChatRequest.agent`); surfaced via a header chip + sticky `/privilege` verb (reuses the
  `/local`//`/cloud` plumbing). `core/permissions.decide()` already implements the full ladder — no new
  engine. Standalone slice, **not** 7e. Per-host + time-boxed escalation deferred.
- **Dual-mode chat → D17 (build).** Buffered mode is a **second consumer** of the existing
  `run_turn`/`resume` `AgentEvent` generator via a new `collect_turn(events)` collector — **the loop is
  not forked**. `AgentCfg.streaming: auto|on|off`; `auto` = Accept-header negotiation; setting
  authoritative (`off` buffers the PWA too); one content-negotiated endpoint; client branches on
  response content-type and reuses the reload render path. Chat only.
- **C1 STT/TTS → decoupled per-transport** (ROADMAP C1): chat = D17's `AgentCfg.streaming`; **TTS** =
  own chunked-playback knob (Phase 6); **STT** = always buffered, no toggle. No single global toggle.
- **Prompted-JSON tool-calling fallback → DROPPED** (native-only; the weak-model fix was the `fleet`
  skill + loop guards, not the call format).
- **A2 `question` kind → design locked, build deferred** (ROADMAP A2): a `question` builtin (sibling of
  `task_plan`) → `RunState.AWAITING_ANSWER` suspend → `tool.question` event → question bubble →
  **extends** `/api/agent/resume` with `decision="answer"`. Reuses the confirm-suspend machinery.
- **7e-g AgentSelector → default `KeywordAgentSelector`** (mirrors `KeywordSkillSelector`), protocol
  swappable (D15 #8).
- **F29 option A → sub-decisions locked, build deferred** (UI_AUDIT §6b): conflict policy = restore +
  toast (user resolves); scope key = `<editor-type>:<instance-id>`.
- **D1 idle → OS-native sleep** (let each host's own power plan do it; ctrl-b builds no remote idle
  detection). **Compute-aware idle** (don't sleep during GPU jobs) = the only future variant worth
  ctrl-b involvement; deferred.
- **D2 wake-on-connection → Tailscale-status poll** (primary; reuses tailnet + the fleet monitor-loop
  pattern, no public surface) **+ PWA-connect trigger** (near-free MVP). Pairs with the A3 scheduler.
- **Stale DECISIONS "Still open" reconciled** — MCP (both transports shipped), routing (tab state),
  auth (standing decision), memory (D14) all marked resolved.

**New standing rule (owner directive 2026-06-16): check the design before implementing.** A feature
starts by *reading* the code it touches; reuse existing data structures/classes/architecture layers,
no hardcoding, no duplicate/near-duplicate paths; surface the seams + any deviation and confirm before
coding. Recorded in **AGENTS.md §9 + CLAUDE.md Hard rules** + memory [[check-patterns-before-implementing]].

**Dependency security cleanup (same session, `07d64da` + `a06e3b5`).** Cleared the Dependabot
backlog: **frontend** `package.json` gained `overrides: { esbuild: ^0.28.1 }` (vite 7.3.3 capped it at
`^0.27.0`) and vite bumped 7.3.3 → **7.3.5** (`npm audit` → 0 vulns, build verified); **backend**
`python-multipart` 0.0.29 → **0.0.31** (venv reinstalled, `pip check` clean, `app.main` imports). The
15 alerts on the dead `ws_*` prototype dirs were **dismissed as "not used"**. Heads-up for a fresh
checkout: a clean `npm install` honors the esbuild override; the backend venv already has 0.0.31. (The
GitHub banner may briefly still show the 4 python-multipart alerts until Dependabot re-scans `main`.)

**Start here in a fresh session — back to *building* 7e-c:**
1. **Finish 7e-c — the `messages.agent` column** (the only remaining 7e-c item, D15 #5). Additive
   migration in `db.py` (`messages` has no `agent` col yet, only `threads`); set it to the resolved
   AgentDef name on each assistant turn; **resume order** = explicit → last assistant turn's `agent` →
   `thread.agent` → default; restore shows the per-turn agent. Backend-led, small frontend touch.
   **Apply the new directive:** read `session.py` (`_drive`/`run_turn`/`resume`), `api/agent.py`
   (`_session`), `domain/conversation.py` (`Message`/`Thread`), and `db.py`'s migration applier first;
   reuse them, don't add a parallel path.
2. **Then 7e-d** (file memory) — fully specced by D15 #4/#6; `agents_dir_path()`/`memories_dir_path()`
   seams already exist. The next big slice.
3. **Decided-but-deferred builds** (pick when wanted, all design-locked above): C1 dual-mode chat (D17),
   A1 privilege selection (D16), A2 question kind, F29 opt A.

**Servers:** backend uvicorn **5433** (no `--reload`, venv), frontend Vite **5173** (HMR; `npm run dev`
defaults to 5173 unless `--port 5190`). Phone: `http://corsair:5173`. Tearable down without state loss.

### ⭐ Session update — 2026-06-14 (evening) (shipped **7e-b** + **7e-c agents-as-folders** · all pushed `b202f5b`)

Build session. Shipped 7e-b end-to-end and the larger half of 7e-c, all pushed to `origin/main`
(`62935af..b202f5b`). Tree clean (except the standing `start_claude_remote.ps1`).

#### 7e-b — `<PromptModal>` + Conf-sizing (commits `d92aff6`, `62935af`)
- **`<PromptModal>`** (`components/PromptModal.tsx`) — the one reusable full-page prompt/markdown
  editor, opened imperatively via **`requestPrompt()`** (`store/prompt.ts`, the same store/host
  pattern as `ConfirmDialog`). Sizes to the `--app-h` shell (Android keyboard), focus-trap/Escape/
  restore mirror F17, char counter only, `[Load default]`/`[Restore default]` only when `defaultText`
  is passed (`useDefaultPrompt` → `/api/agent/default-prompt`). Text seeded **during render** (no
  stale-frame flash). Inline prompt rows shrank to a preview (`lib/promptPreview.ts`) + opener.
- **Wired**: Conf → Inference System prompt (+ new **append**), per-agent Prompt (+ **append** +
  `inherit_append` Seg), Skills SKILL.md keeps its inline editor + a fullscreen opener.
- **Conf-sizing refine** (`62935af`): `.mform` label col 90→104px, Limits grid 2-col @≤420px,
  `.confrow .k .label` overflow-wrap. All net-new CSS in `extras.css`; **vapor.css untouched (D7)**.

#### 7e-c — agents are folder-only (commits `0a30375` backend, `3e34d9c` frontend, `fc15ceb`+`e417859` refine/fix, `b202f5b` docs)
- **Backend (`0a30375`)**: `$CTRLB_HOME` root (`home_path()`, env `CTRLB_HOME`, **default = project
  root** so corsair is unchanged; `CTRLB_CONFIG`/`CTRLB_DB` still override). `config_path()`/`db_path()`
  layer on it; new `agents_dir_path()`/`memories_dir_path()`. **`agent.defaults`** inheritance base +
  `deep_merge` load; **`agents:[]` removed from the Settings schema** (D15 #3 — no migration; the live
  v2 config had no `agents:`/`agent:` block, confirmed no-op). `resolve_agent`/`list_agent_names` read
  folders; **SOUL.md → `AgentDef.prompt`** (so `_system_prompt()` is unchanged). **File API**:
  `GET/PUT/DELETE /api/agents/{name}` (+ `…/soul`); the default/root agent can't be created/deleted
  here (its fields live in Conf, persona = root SOUL.md). Tests rewritten/migrated, **27/27 green**.
- **Display names (`3e34d9c`)**: optional **`AgentDef.title`** (in agent.yaml) + **`agent.default_title`**
  for the root agent. The folder **slug stays the `/agent` id**; UI shows `title || slug`; `title`
  never inherits from `agent.defaults` (popped before the merge).
- **Frontend (`3e34d9c`)**: `AgentsEditor` rewritten off the file API (`useAgentList`/`useAgent`/
  `useSaveAgent`/`useDeleteAgent`/`useSaveAgentSoul`). **Unified list (owner's pick)**: default/root
  agent first row (fields ↔ `agent.defaults`, title ↔ `default_title`, persona ↔ root SOUL.md),
  specialists below (own `agent.yaml` + SOUL.md). SOUL saves **directly** (file-backed) through the
  PromptModal; add-agent takes a **slug + optional display name**, scaffolds, opens.
- **Two refinements after owner feedback**: `fc15ceb` made the fields **explicit about what they
  edit** (a storage caption `agents/<slug>/ · agent.yaml + SOUL.md` or `config.yaml · agent.defaults +
  root SOUL.md`; labels `Persona · SOUL.md`, `Prompt append`, `Inherit global append`). `e417859`
  **fixed the Skills control**: the old All/None/Custom Seg made Custom unreachable (empty Custom ==
  None); now it's an "all skills" Switch + tick-grid, identical to the Tools control.

#### Process notes / heads-up for next session
- **Live write-test slip + remediation**: a backend API smoke-test ran against the **real**
  `dashboard_v2/config.yaml` (no `CTRLB_HOME` set), briefly writing `agent.default_title: Atlas` +
  creating `agents/`. Caught, **reverted, dir removed, backend restarted clean** ([[test-write-endpoints-on-temp-config]]).
  **Next session: set `CTRLB_HOME` to a temp dir for any live write-test of the agents/memory APIs.**
- **Remaining 7e-c = `messages.agent`** (see Current state #1). Then **7e-d** (file memory) is the big
  one; the `memories_dir_path()` seam is already in place.

### ⭐ Session update — 2026-06-14 (pushed 7e-a · verified · **reshaped 7e into the D14 agent-workspace design**)

Planning + housekeeping session. Pushed the pending work, live-verified 7e-a, then researched
**Hermes Agent** + **OpenClaw** memory/agent models and reshaped Phase 7e around a **file-based,
portable, per-agent-workspace** design — locked as **D14**. No feature code (per
[[pause-between-phases-for-review]]); the artifacts are the doc updates.

#### Housekeeping done
- **Pushed** `615c694..6d212a9` → `origin/main`: `d4cd25c` (7e-a) + a new `6d212a9` docs commit
  recording the 7e-a ship. `start_claude_remote.ps1` left untouched (standing rule).
- **Backend restarted on 5433** (no `--reload`, venv) and **7e-a verified live** —
  `GET /api/agent/default-prompt` → baked `DEFAULT_SYSTEM_PROMPT` (1739 chars). Frontend on 5190 up.

#### The D14 design (canonical detail in `DECISIONS.md` D14 + `TODO.md` 7e)
Researched that **Hermes profiles** and **OpenClaw workspaces** are both *single-agent-per-process*
(separate `HERMES_HOME`/gateway/bot-token, or one agent per Gateway). We **keep our in-process
multi-agent runtime** (`resolve_agent` + in-process `spawn_subagents` — strictly more capable for
"a generalist that *uses* specialists") and adopt only their **folder convention**:

- **Relocatable root `$CTRLB_HOME`** (env, default `~/.ctrl-b/`; composes with `CTRLB_CONFIG`/`CTRLB_DB`)
  holds `config.yaml` + `ctrlb.db` + `SOUL.md` + `memories/` + `skills/` + `agents/` — mirrors `HERMES_HOME`,
  sets up the emma deploy.
- **Default agent = the root** (root `SOUL.md`/`memories/`/`skills/`, **no `agent.yaml`** — it *is* the
  config.yaml globals). **`agents/<name>/` = specialists only** (`fleet` stays a *skill*, not an agent):
  `agent.yaml` (overrides only — absent fields inherit a config.yaml `agent.defaults` block via
  `deep_merge` at load) + `SOUL.md` + `memories/MEMORY.md` + `skills/`. Scan-discovered, live-reloaded.
- **Agents are folder-only** (D15 #3, owner-clarified 2026-06-14): **no migration feature** —
  `agents:[]` is removed from the schema; agents are read exclusively from folders; any existing
  live-config entries are relocated by hand during 7e-c (one-time dev step, likely a no-op).
- **`SOUL.md`**: scaffold-if-missing from the baked default + a setting to disable the baked default
  entirely (empty = empty). Portable to/from Hermes/OpenClaw.
- **Memory**: file impl of the ROADMAP B1 `MemoryProvider` — per-agent `memories/MEMORY.md` + **global**
  `memories/USER.md` (gitignored); a Hermes-shaped **`memory` tool** (add/replace/remove · target
  memory|user · substring old_text · no read), **autonomous auto-write** + `memory.auto_write` kill
  switch, configurable caps (2200/1375 default), over-cap → consolidate, injected via 7e-a's machinery,
  audited as Events. Vector = later "both" mode over the unused `memory` table + 4f embeddings.
- **`session_search`** = FTS5 over `messages` + a builtin tool. **Sessions stay central + agent-
  agnostic in `ctrlb.db`** — a *deliberate divergence* from Hermes/OpenClaw (preserves `/agent`
  mid-thread switching + cross-agent search).
- **Session attribution** (7e-c): nullable **`messages.agent`** column (additive migration) records
  the resolved agent per assistant turn → restore shows the per-turn agent across `/agent` switches,
  resume prefers the last turn's agent, `session_search` can filter by agent. `threads.agent` stays
  the thread's primary/default.
- **Skills**: per-agent (global `skills/` = the default agent's set; each agent its own folder);
  `agent.yaml` `skills_inherit` = all | specific subset | none. Plus a **`skill_manage` agent tool**
  (sibling of `memory`: self-author `SKILL.md`, auto-write + `skills.auto_write` kill switch) — built
  in 7e-f, Hermes-style self-improvement.
- **Skipped vs the Hermes home**: `auth.json` (no OAuth), `.env` split (secrets stay in masked
  `config.yaml` + `CTRLB_*__*` env), `sessions/` + `logs/` (central `ctrlb.db` + the `events` table /
  process journal). Hermes' `cron/` → ROADMAP A3 (reserve seam).
- **Invocation**: explicit `/agent` + `spawn_subagents` primary; optional `AgentSelector` auto-rotate
  (mirrors `SkillSelector`), default off.
- **UI**: `AgentsEditor` repointed to a file-per-agent API with a first-class **add-agent** flow
  (scaffolds the folder) + edit/delete, well-designed @390px.

#### 7e-b decisions locked (2026-06-14)
The six open questions from the 2026-06-09 block are answered (all the "recommended" options):
1. **`[Load default]` placement** — **modal-only** (inline rows stay terse: preview + opener).
2. **Modal Save semantics** — **draft-update + close** for settings-backed fields (Inference /
   per-agent append → group Save persists); **file-backed editors** (`SOUL.md`/`MEMORY.md`/`SKILL.md`,
   7e-c+) **save directly** via their file API. The modal supports both modes.
3. **`[Load default]` on append fields** — **no** (append default is `""`); only the *replace*
   fields (System prompt → `SOUL.md`) get Load/Restore default, fed by `/api/agent/default-prompt`.
4. **`inherit_append` UI** — **Seg** (`Inherit`/`Ignore`), matching the other `AgentsEditor` knobs.
5. **Skills `SKILL.md`** — keep the **320px inline editor + `Open fullscreen ↗`** opener.
6. **Counter** — **char counter only** (no token dep). Renders chars/cap + % like Hermes
   (`67% — 1,474/2,200`); the 7e-d memory panel reuses it against the configurable caps.

**Hermes caps verified (2026-06-14):** `MEMORY.md` 2,200 chars (~800 tok, `memory_char_limit`),
`USER.md` 1,375 chars (~500 tok, `user_char_limit`), both configurable — our D14 defaults match
exactly. 7e-d should mirror Hermes' config-key names for cross-tool portability.

#### Design audit + D15 (2026-06-14)
A whole-project review (docs vs shipped code) found doc↔code drift and loose specs. **All findings
are tracked in `TODO.md` → "Design audit — 2026-06-14"**; the 7e-blocking specs are **locked in
`DECISIONS.md` D15** (`agent.defaults` merge · `CTRLB_HOME` · agents folder-only (no migration) · `MemoryProvider`
interface + injection · `messages.agent`/resume · `skill_manage` · `session_search` scope/redaction ·
`AgentSelector` seam). Headlines: **`ARCHITECTURE.md`/`DESIGN.md` need a reconciliation pass** (they
predate 7a–7d + D14); the **A1 privilege ladder is already built** in `permissions.decide()`
(downgrade to UX-only); **C1 streaming-both-ways + A2 `question` kind** are doc "day-one" claims that
aren't built; **Utils/D8 registry should reuse `core/tool.py`**; **Phase 5 `run_shell`** — decide
drop vs keep. **Recommended order:** lock D15 ✓ → reconcile `ARCHITECTURE.md`/`DESIGN.md` ✓
(2026-06-14: status banners + D14/D15 fixes; C1/A2 overclaims corrected; A1 downgraded; D8-unify
confirmed) → **build 7e-b (next)**.

#### D15 ratified one-by-one (2026-06-14)
All eight D15 specs were decided with the owner (marked ✅ inline in D15): #1 `agent.defaults` block
(model included) · #2 `CTRLB_HOME` layered/project-root default · **#3 agents folder-only — NO
migration feature** (`agents:[]` removed from schema; existing entries relocated by hand in 7e-c) ·
#4 memory injection mirrors Hermes' format · #5 resume = continue as last turn's agent · #6
`skill_manage` default OFF + **non-blocking propose** (memory same when off) · #7 `session_search`
global + redacted · #8 `AgentSelector` seam locked, algorithm at 7e-g. **Also noted:** composer
**autocomplete/typeahead** for `/`-commands, `/agent`, `/skill` (frontend-only, reuses existing
endpoints) → recorded in ROADMAP A4, lands as a small slice once 7e makes the lists real.

#### State of the tree
- **`origin/main` HEAD `5df69be`** — everything from this session is **pushed**: 7e-a (`d4cd25c`),
  D14 + refinements, D15 + the 8 ratified specs, the whole-project design audit, and the
  ARCHITECTURE/DESIGN reconciliation. Nothing local pending.
- Tree clean except `start_claude_remote.ps1` (owner's launcher tweak — leave it).
- Servers: backend uvicorn **5433** (live, 7e-a verified), frontend Vite **5190** (`--host 0.0.0.0`).
  Tearable down without state loss (config in `config.yaml`, data in `ctrlb.db`).

#### Start here in a fresh session — **build 7e-b**
1. **Build 7e-b** (`<PromptModal>` full-page editor + the 4-item Conf-sizing refine). The **six design
   questions are answered + locked** ("7e-b decisions locked" subsection above) — no blockers. New file
   `frontend/src/components/PromptModal.tsx`; net-new CSS in `extras.css` (vapor.css untouched, D7).
   Wire the four callsites + the `inherit_append` Seg; char counter only. Separate `refine` commit for
   the Conf-sizing items. Verify @390px ×3 themes before calling it done.
2. Then **7e-c → 7e-d → 7e-e → 7e-f → 7e-g** per `TODO.md` + **D14/D15** (the build specs). Note 7e-c
   makes agents **folder-only** (no migration; `agents:[]` removed from schema) and adds `$CTRLB_HOME`
   + the `messages.agent` column.
3. **Both former open items are now decided (2026-06-14):** **Phase 5 = KEEP + build** — the `!`
   prefix is the user-driven **local shell on the backend host** (Claude-Code model: `!git status`),
   target local-only · cwd `shell.workdir` default `$CTRLB_HOME` · output→agent-context · enabled by
   default (`shell.user_exec_enabled`); the agent's `run_shell` stays excluded-by-default. Spec in
   `TODO.md` Phase 5 + D3. **Voice (Phase 6)** confirmed still planned as designed; its config block
   lands when Phase 6 is built. **No open design decisions remain.**

### ⭐ Session update — 2026-06-09 (7e-a backend shipped · 7e-b design discussion locked, paused for review)

Half-session. **7e-a (additive system-prompt axis + show-the-baked-default endpoint) is
committed locally as `d4cd25c`, not pushed.** Then we designed 7e-b out loud — the
`<PromptModal>` shape, callsite list, save semantics, and a 4-item Conf-sizing refine.
**Paused before writing any frontend code** so the owner can answer six design questions
([[pause-between-phases-for-review]]).

#### 7e-a — what shipped (`d4cd25c`)

The 2026-05-30 plan's three open decisions were closed by the owner at the start of session:

1. **Per-agent append vs. global append:** **both apply** with a per-agent `inherit_append: bool`
   opt-out. Mirrors Claude Code's CLAUDE.md model (always added, persona independent).
   Default `True`; flip to `False` for a sandboxed/clean-room persona.
2. **Append as a separate `system` message** (yes): emitted *after* the base prompt, *before*
   the roster and the skills note. Order in `_assemble`: **base → global append → per-agent
   append → roster → skills note → history**. Keeps the base stable as a future cache-key
   candidate; makes the extra easy to attribute when reading logs.
3. **Home phase:** 7e (this is `7e-a`).

##### Files touched

| File | Change |
|---|---|
| `app/config.py` | `InferenceCfg.system_prompt_append: str = ""` |
| `app/domain/agent.py` | `AgentDef.prompt_append: str = ""` + `AgentDef.inherit_append: bool = True` (with docstrings) |
| `app/services/agent/session.py` | New `_appends()` helper; `_assemble` emits 0-2 extra `system` messages right after the base |
| `app/api/agent.py` | New `GET /api/agent/default-prompt` → `{"text": DEFAULT_SYSTEM_PROMPT}` for the editor's `[Load default]` / `[Restore default]` |
| `backend/tests/test_prompt_append_7e.py` | **New, 8 tests** — happy path, whitespace trim, clear-falls-back, built-in default inheritance, per-agent isolation, GET/PUT API shape, multi-line YAML round-trip, default-prompt endpoint |

##### Invariants verified during design

- `apply_settings_inplace` rebinds `cur.inference = new.inference` → `_appends()` reads
  `self._settings.inference.system_prompt_append` lazily, so a hot-apply lands immediately.
- `_finalize` adds its wrap-up `system` message **after** `_assemble`, so appends still lead.
- Compaction operates on **persisted** messages only; new system blocks are constructed fresh
  per turn from live Settings → no interaction with the rolling summary.
- The resume path goes through `_drive` → `_assemble`, so resumed turns also see appends.

##### Test status

All backend suites green: **7a 7 · 7b 2 · 7c 4 · 7d 2+1+1 · 7e 8**; `compileall` clean.
Writes were exercised against `tempfile.mkdtemp()` via `CTRLB_CONFIG` / `CTRLB_DB`
(per [[test-write-endpoints-on-temp-config]]) — **never the real `config.yaml`**.

##### Live verification status

**Not yet live-verified.** Backend on 5433 is still running the pre-`d4cd25c` build — needs a
restart to load the new endpoint + the `_appends()` plumbing. Restart command (per the Windows
`--reload` gotcha):

```powershell
# kill the running uvicorn on 5433, then:
cd dashboard_v2/backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 5433
```

The smoke checks worth doing after restart:
1. `GET /api/agent/default-prompt` returns the baked `DEFAULT_SYSTEM_PROMPT` text.
2. Send a chat turn with `inference.system_prompt_append` set → confirm the model honors it
   (e.g. set append = "Always sign off with 'cheers'." and watch the reply).
3. Set `AgentDef.inherit_append=False` on one agent + global append set → that agent doesn't
   inherit; default agent does.

#### 7e-b — design discussion (paused for owner review)

**Scope:** one reusable `<PromptModal>` + wire 7e-a's UI fields + 4-item Conf-sizing refine.
The original 7-item Conf-sizing list collapses: items 1-3 (System prompt / per-agent Prompt /
SKILL.md textareas) are absorbed into the modal pattern, item 7 is moot.

##### `<PromptModal>` proposed shape

```
┌──────────────────────────────────────────┐
│ ‹ Title (e.g. "System prompt")       ✕  │  ← .mhead style
├──────────────────────────────────────────┤
│  [ monospace textarea, fills viewport ] │
├──────────────────────────────────────────┤
│  1,247 chars                            │  ← char counter, dim
│  [Load default] [Restore default]       │  ← contextual (System prompt only)
│  [Cancel]                       [Save]  │
└──────────────────────────────────────────┘
```

- Reuses the existing `100dvh` + `--app-h` viewport shell from `App.tsx` (Android keyboard).
- Focus trap + Escape-to-cancel + focus restore on close — same pattern as ConfirmDialog (F17).
- **Net-new CSS lives in `extras.css`; `vapor.css` stays untouched** (D7).

##### Callsite inventory

| Where | Inline shows | Modal opens with |
|---|---|---|
| Conf → Inference → System prompt | Preview ("override active · 1.2k chars · 'You are…'" or "empty — using baked default") + `Edit fullscreen ↗` | Title "System prompt"; footer `[Load default]` + `[Restore default]` |
| Conf → Inference → System prompt append **(new, 7e-a)** | Preview + opener | Title "System prompt append"; plain footer (no Load default — see Q3) |
| Conf → Agents → per-agent Prompt | Preview + opener | Title "Agent prompt: \<name\>"; footer `[Load default]` |
| Conf → Agents → per-agent Append **(new, 7e-a)** | Preview + opener; paired with the `inherit_append` Seg | Title "Agent prompt append: \<name\>" |
| Conf → Skills → SKILL.md editor | **Keep** existing 320px inline + add `Open fullscreen ↗` opener | Title "Skill: \<name\>"; footer `[Remove skill]` |

##### Save semantics

Modal `[Save]` updates the **parent Conf group's draft state**, then closes. The user still
hits the group-level `Save` button to persist. This matches the existing Inference/Agents/
Skills group-save pattern. Modal `Save` does **not** hit the backend directly. `Cancel`
discards the modal-local edit. (The `beforeunload` listener from F19 catches reload-with-dirty
if the user forgets the group Save — known limitation of F29 option A not being shipped yet.)

##### Conf-sizing refine — the 4-item list to bundle

1. `.mform` label column — widen 90 → 100-110px or allow `label` to wrap to 2 lines (long
   labels like "Subagent fan-out limit" wrap awkwardly @390px).
2. Agents → Limits grid — switch 3-col → 2-col at viewport ≤ 420px.
3. `.confrow` `word-break` audit on masked secrets / long URLs that don't render through
   `.k .desc` (which vapor already breaks).
4. Decision: separate `refine(dashboard_v2): 7e Conf sizing` commit so the modal slice's diff
   stays focused.

##### Six design questions waiting on owner

1. **`[Load default]` placement:** modal-only (recommended — keeps inline rows terse) vs.
   inline next to the field as well?
2. **Modal Save semantics:** draft-update + close (recommended — matches current Conf group
   flow) vs. direct backend write per-field?
3. **`[Load default]` on append fields?** Recommended **no** — the default of an *append* is
   `""`, there's nothing to load. The replace fields (System prompt, per-agent Prompt) get it.
4. **`inherit_append` UI shape:** Seg (`Inherit` / `Ignore`, matching how other bool/enum knobs
   render in `AgentsEditor`) vs. plain checkbox row? Recommended Seg for consistency.
5. **Skills SKILL.md:** keep 320px inline **plus** `Open fullscreen ↗` (recommended — SKILL.md
   benefits from in-place editing) vs. shrink to preview + opener like the others?
6. **Char counter only**, no token counter? (Token counter would need the tokenizer + isn't
   worth the dep.)

#### State of the tree

- **Local HEAD: `d4cd25c`** (1 commit past `origin/main`'s `40f94e8`). **Not pushed**;
  push needs owner go-ahead.
- Tree clean except `M start_claude_remote.ps1` (owner's launcher tweak — see the
  2026-06-08 block + standing rule: leave it untouched).
- **Servers up:** backend uvicorn on **5433** (corsair, no `--reload`) — **but still serving
  pre-`d4cd25c` code**, restart needed to live-verify 7e-a (see command above). Frontend Vite
  dev on **5190** (`--host 0.0.0.0` for Tailscale phone access). Either tearable down without
  state loss.
- **Phone access URL (Tailscale):** `http://corsair:5190` (or `http://100.76.212.35:5190`).

#### Start here in a fresh session

1. **Answer the six 7e-b design questions** at the bottom of the 2026-06-09 block. ~5 min;
   recommendations are pre-filled, so just confirm or override.
2. **Restart backend 5433** to live-verify 7e-a (command above). Smoke checks listed.
3. **Build `<PromptModal>` (7e-b)** following the locked answers. New file
   `frontend/src/components/PromptModal.tsx`; net-new CSS in `extras.css`. Wire the four
   callsites + the new `inherit_append` Seg. Char counter (no token counter).
4. **Bundle the 4-item Conf-sizing refine** as a separate commit (see list above).
5. **Push `d4cd25c` + the 7e-b commits** after the owner D7 eyeball at 390px × 3 themes.
6. Next: 7e-c (`prompts/*.md` editors), then 7e-d (memory panel on the 4f embeddings seam).

### ⭐ Session update — 2026-06-08 (UI_AUDIT.md §6c F14–F26 a11y/resilience backlog — closed end-to-end)

Long session. Closed the entire F14–F26 backlog the 2026-06-02 audit had filed, plus a
discovered F28/F29 and a UX miss on the Conf Save button. **13 commits, all pushed to
`origin/main` (HEAD `40f94e8`)**, tree clean.

#### What shipped (in chronological order)

| # | Slice | Audit ID | Commit | One-line |
|---|---|---|---|---|
| 1 | A1 | F25 | `ab24a27` | Global `:focus-visible` magenta ring — WCAG 2.4.7 fix on ~30 buttons that were doing `all: unset`. |
| 2 | A2 | F14 | `ab24a27` | DeviceRow `.top` ARIA button pattern (can't be `<button>` because of nested action buttons); Hero `.now-dots` → real `<button>`s. |
| 3 | B | F15 | `fa0742d` | "Motion" toggle in Conf → Appearance (not OS-driven `@media (prefers-reduced-motion)` — owner reframed it as a per-user preference). First-install default honors the OS query. |
| 4 | C1 | F23 | `98f30f0` | Root ErrorBoundary inside QueryClientProvider + React 19's `createRoot` `onUncaughtError`/`onCaughtError` hooks. Researched react-error-boundary lib — chose to keep the custom 50-LOC component (the "similar code for the same thing we already own" trap). |
| 5 | C2 | F22 | `f647ee7` | `aria-hidden` sweep on 13 decorative `.chev`/`.arrow`/`.svc-chev`/`.conf-chev` sites. |
| 6 | D1 | F17 | `c7bd0d9` | ConfirmDialog focus trap (Tab ↔ Cancel/Confirm) + focus restoration + scoped keydown (was on window) + `aria-labelledby`/`aria-describedby`. Did NOT migrate to native `<dialog>` — CSS port risk against the Vapor design. |
| 7 | D2 | F18 | `25d942c` | TabBar WAI-ARIA tabs pattern: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, roving tabindex, arrow-key nav (auto-activation). Each top-level tab container gets `role="tabpanel"` + `aria-labelledby`. |
| 8 | E0 | F28 | `3b2e45c` | **Discovered mid-session by owner:** composer textarea was uncontrolled; switching to Conf/Utils dropped the draft. New `store/composer.ts` (mirrors `store/ui.ts`) — controlled textarea, persisted to localStorage. Survives tab-switch + reload. |
| 9 | E1 | F19 | `4ea10a9` | New `store/dirty.ts` cross-editor dirty registry + `beforeunload` listener in App.tsx. Conf / Agents / Skills editors each register their existing `dirty` expression via `useRegisterDirty()`. |
| 10 | F29-fix | F29 | `6f6c7e9` | **Discovered while wiring E1:** `ConfGroup` was `{!collapsed && children}`, so collapsing a group mid-edit unmounted the editor and dropped the draft. Fixed via option B (keep children mounted, CSS-hide the body). |
| 11 | E3 | F26 | `76b8490` | `useRegisterSW({ onNeedRefresh })` → sticky info toast with a "refresh" action. Extended `store/toast.ts` with optional `action` + `sticky` (backwards-compatible). |
| 12 | F1 | F16 | `be86f40` | SSE event-stream error handler + manual exponential-backoff reconnect (browser stops auto-retrying at `readyState=CLOSED` once Vite's proxy returns 5xx). New `store/connection.ts` + `.conn-badge` in AppBar (`role="status"`, magenta pulsing dot for "reconnecting", danger-rgb dot for "disconnected"). Reconcile-after-reconnect calls `qc.invalidateQueries()` *and* `reloadChat()` (chat isn't a React Query consumer). **Second connection-health signal added in F2 below.** |
| 13 | F2 | F20 | `40f94e8` | Chat-stream retry affordance. **Audit's fix-sketch was wrong**: `/api/agent/resume` is only for confirm-gated suspension (`call_id`+`confirm_token`), not network drops. Phase A landed: `retryLastTurn()` walks back to the user message, truncates the failed turn, calls `sendMessage()` for a clean re-run. `failStream` now also fires when the loop exits with `!settled` (server killed mid-stream without a terminal event). Cross-channel `setConnection("reconnecting")` on chat-fetch failure. Plus: global React Query QueryCache observer in `useEvents.ts` — any cache entry in error state → "reconnecting" — much more reliable than EventSource's silent-drop detection. |
| + | UX fix | — | `dc98486` | Owner caught: Save button was only at the bottom of `Open-terminal` (the 5th of 5 saveable Conf groups). Refactored to render `{saveBar}` at the bottom of each: Inference / Server / SearXNG / Embeddings / Open-terminal. |

#### Deferrals + future-only notes

- **F21 → Phase 6.** The mic stub honest-disable was reframed as Phase 6 (Voice / STT / TTS).
  Owner's call: "I want the features and issues handled in their own phase if possible."
  TODO.md Phase 6 gains the explicit mic-button state-machine checkbox; UI_AUDIT.md F21 is
  marked `🟦 DEFERRED TO PHASE 6` with a resolution block. **New feedback memory recorded:**
  [[fix-in-the-owning-phase]].
- **F29 option A** (reload-survival for sub-editor drafts via `store/composer.ts`-style
  lifting) — recorded in UI_AUDIT.md §6b. Two design decisions to lock when it ships:
  conflict policy when server-persisted state diverges, and scope key for multi-instance
  editors.
- **F27** (offline-row screen-reader indicator) — recorded in UI_AUDIT.md §6c.
- **F24** (axe-core CI gate) — Phase 9 already owns it.
- **HMR-safe store modules** — recorded in UI_AUDIT.md §6b. **Dev-only ergonomics, zero
  production impact.** We hit this hard during live F2 testing in Firefox: editing
  `store/chat.ts` left React subscribers attached to the old module's listeners Set while
  the new module's `set()` calls notified an empty new Set, so UI silently didn't update.
  Verified F2 works end-to-end via **Playwright headless Chromium** (debug-f2.mjs, since
  deleted). Fix is `if (import.meta.hot) { import.meta.hot.dispose(data => …); }` — ~12
  lines per store. Apply to `chat.ts` first if it bites again.

#### Recurring feedback memories saved this session

- **[[pause-between-phases-for-review]]** — after each slice, summarize what changed +
  wait silently for go-ahead. No batching, no momentum-continue. Owner caught me drifting
  into a parallel preference channel (OS `@media` motion gate) when `UIState` + an
  Appearance Switch already modeled user prefs. Compounded by the existing
  [[commit-autonomously-clearly]].
- **[[fix-in-the-owning-phase]]** — see F21 above.
- **CLAUDE.md + AGENTS.md** both gained a new Hard Rule: *"Don't duplicate existing
  patterns — in either direction."* Two failure modes named: (1) different code for similar
  things (parallel implementation bypassing an existing pattern); (2) similar code for the
  same thing we already own (pulling in a dep that overlaps with our own code). Consistency
  by construction beats cleanup after the fact.

#### State of the tree

- **Origin/main HEAD: `40f94e8`** (10 + 3 commits past `3ca412a` at session start).
- Tree clean; no uncommitted work; nothing local pending push. **Includes the launcher's
  `start_claude_remote.ps1` effort-tweak left untouched** (owner's personal config).
- **Servers left running:** backend uvicorn on **5433** (corsair, no `--reload`, venv at
  `dashboard_v2/backend/.venv` — restarted many times during F1/F2 live testing). Frontend
  Vite dev on **5190**, `--host 0.0.0.0` for Tailscale phone access. Either can be torn
  down without state loss — config in `config.yaml`, chat/events/memory in `ctrlb.db`.
- **Phone access URL (Tailscale):** `http://corsair:5190` (or `http://100.76.212.35:5190`).

#### Start here in a fresh session

1. **Pick the next focus** (ranked at the top of this block):
   - **Recommended: prompt-append + Conf-sizing (7e-a).** Direction locked 2026-05-30 — go
     read that block below for the three decisions to confirm + the seven-item Conf-sizing
     checklist. Should be a clean, ~half-day slice.
   - **Then: 7e proper** (prompts editors for arbitrary `prompts/*.md` + memory panel on
     the 4f embeddings seam).
2. **Heads-up on dev workflow:** if you find yourself editing `store/*.ts` modules
   repeatedly and the UI behaves oddly between edits, hard-quit the browser (not just
   refresh). Or ship the HMR-safe pattern from UI_AUDIT.md §6b first.
3. **No live verification regrets:** F1's reconnect badge was verified live; F2's retry
   button was verified via Playwright. If a future session wants a live-Firefox check of
   F2, kill the backend, send a chat message, and the bubble should show
   `// <error> [retry]` within a couple of seconds.

### ⭐ Session update — 2026-06-02 (UI perf pass shipped end-to-end + follow-up audit recorded)

Long session. Two distinct things shipped:

**Part 1 — UI perf pass complete (Slices 1–8 of `docs/UI_AUDIT.md`).** Eight commits closed
10 of the 13 perf-pass findings. Commits, in order:
- `5906ba3` — Slices 1–6 + cross-OS docs (the bulk). Bundle analyzer, PWA icon fan-out,
  hoist constants, AgentTab memoize, Hero/NowPanel/FleetSummary memo (Waveform deliberately
  not — see F2 caveat), transition audit (3 surgical edits), body-attr mirroring into
  `setUI()`, `useScopedQuery` for Conf-only queries, lazy `ConfTab` + Suspense + idle
  prefetch. Plus the OS-agnostic docs + the Windows `--reload` ping gotcha (documented in
  CLAUDE.md, ARCHITECTURE.md §6, README.md, main.py). Plus configurable
  `feature_cycle_seconds`, sub-millisecond ping precision (corsair self-ping reports 0.5ms
  now), Vapor-themed conic-gradient busy spinner.
- `40cc5fa` — Slice 6 follow-up. The first ship of Slice 6 had two bugs found in a
  post-implementation audit (chunk fetched on mount instead of on intent; Suspense
  fallback overlaid the active tab during download). Fixed via conditional-mount
  (`confMounted` state) + a small reusable `components/ErrorBoundary.tsx` that catches
  stale-chunk-after-deploy failures.
- `d915d57` — Slice 7 (`useUISlice` selector pattern). Audit had claimed 25 `useUI()`
  consumers; actual count was 5 (App, TabBar, AppBar, FleetTab, ConfTab). All migrated;
  `useTabActive` rewritten as a one-line wrapper over `useUISlice`; `useUI()` kept
  `@deprecated` as an escape hatch.
- `e944ec7` — Slice 8 (F7 — `lucide-react` audit). Found the dep was dead (never imported;
  zero bytes in the build). Removed. Bundle hashes pre/post identical. Bundle is now
  ~70% React itself; no further legitimate trim targets.

Final bundle: main 282 KB / 86.7 KB gz · lazy ConfTab 45 KB / 11.4 KB gz · CSS 60.8 KB /
11.5 KB gz. First-paint cost ≈ 99 KB gz (Main JS + CSS).

**Part 2 — Follow-up audit recorded (`1c4a35e`).** A second pass focused on areas the
perf pass deliberately deferred: **accessibility, resilience, edge-case correctness**.
13 new findings (F14–F26) documented in `docs/UI_AUDIT.md` section 6c. No implementation
in this pass — pure documentation with severity, mechanism, safety verdict, and a fix
sketch each. Critical ones (🔴, keyboard users functionally blocked today): **F25** (`all:
unset` wipes focus outlines on ~30 buttons — WCAG 2.4.7 AA fail), **F14** (interactive
`<div>`s in DeviceRow + Hero now-dots — keyboard skips them), **F15** (37 animations
ignore `prefers-reduced-motion`). Resilience (🟡): **F16/F20** (SSE + chat-stream have no
reconnect signals), **F23** (no root `ErrorBoundary` outside the Conf lazy chunk).
Polish/UX/future-proofing (mostly 🟢): F17 (ConfirmDialog focus trap), F18 (TabBar ARIA
tablist + arrow keys), F19 (`beforeunload` on dirty Conf), F21 (mic stub disable), F22
(decorative-glyph `aria-hidden`), F24 (axe-core CI gate — already TODO Phase 9), F26 (SW
update toast). UI_AUDIT.md footer documents the recommended implementation order.

#### State of the tree
- Eight commits ahead of `origin/main`. All 7d/perf/audit work is local. Pushing all
  needs owner confirmation (per the standing rule).
- No uncommitted changes (working tree clean as of this session end).
- Servers as left running this session: backend on **5433** (corsair, no `--reload` per
  the Windows gotcha; venv at `dashboard_v2/backend/.venv`); frontend Vite dev on **5190**
  with HMR. Either can be torn down without state loss — config in `config.yaml`,
  chat/events/memory in `ctrlb.db`. The dev server has cycled HMR through most files
  many times this session — all clean.

#### Start here in a fresh session
1. **Decide pushing the eight local commits.** Tree is clean at `1c4a35e`; safe to push.
2. **Pick the next direction:**
   - **a11y backlog (F14–F26)** — concrete fix sketches are in `docs/UI_AUDIT.md` §6c with
     a recommended order in the doc footer. F25 (one-line global focus rule) +
     F14 (interactive divs → buttons) + F15 (`prefers-reduced-motion` media block) are the
     highest-leverage; together they restore keyboard usability and reduced-motion
     respect.
   - **prompt-append + Conf-sizing (7d follow-up / 7e-a)** — direction locked 2026-05-30
     (block below). `Settings.inference.system_prompt_append` + optional per-agent
     `prompt_append` + a `<PromptModal>` full-page editor. See that block for the locked
     decisions and the seven-item Conf-sizing checklist.
   - **7e proper** — prompt-file editors for arbitrary `prompts/*.md` + a memory panel
     built on the 4f embeddings seam.
3. **Bundle analyzer is wired** — every `npm run build` writes `dist/stats.html`. Open it
   if you ever want to see the treemap.

### ⭐ Session update — 2026-05-30 (planning · system-prompt direction set · 7d wrap)

A short planning session. No code shipped; direction locked for the next slice.

#### State of the tree
- **4 local commits on `main`, none pushed:** `c47bb1a` 7d-a · `16c160f` 7d-b · `293ee2f` 7d-c ·
  `eb5ce4a` docs. Push needs owner go-ahead (per the standing rule).
- **Two uncommitted Conf CSS refinements** sitting in the working tree (from late polish):
  1. **Skills · SKILL.md editor** restructured to render *outside* the `.mform` grid, self-styled,
     **320px min-height** (up from 200), 10px gap above the `.mfoot` so the editor sits clearly above
     the remove/save buttons. (`extras.css` `.kv-text.skill-md` rewritten as standalone.)
  2. **Agent tools · category heading** got `padding: 0 14px 4px` (matches `.confrow`) so the
     uppercase letter-spaced "FLEET" word clears `.conf-card`'s `border-radius: 14px` +
     `overflow: hidden`. Was being cropped on the left.
  Fold both into a single `refine(dashboard_v2): polish 7d Conf` commit at the start of tomorrow's
  session, before the new work.
- **Servers up:** backend on **5433** (venv, serving 7d code — relaunched today after killing the
  stale system-python that was on the port; see the same trap noted in the 2026-05-28 block) and
  frontend on **5190** (Vite HMR). Leave them up or restart in the fresh session — either is fine.
- **Owner D7 eyeball pending:** Agents / Skills / Agent-tools forms @390px × 3 themes. A live check
  that `/agent <name>` switches the agent and that an edited tool description shifts the model's pick.

#### Research delivered + direction locked
The owner asked how opencode, little-coder, and Claude Code handle the system prompt. Findings:

- **Claude Code (Agent SDK)** — baked `claude_code` preset (text not user-editable). Four
  customization layers, each explicitly *append* or *replace*: **`append`** to the preset (additive,
  recommended default · "lowest-risk"), **custom string** (full replace), **output styles** (markdown
  files; replace by default, `keep-coding-instructions: true` flips to extend), **CLAUDE.md** (injected
  as *conversation context*, not the system prompt — always additive, auto-discovered).
- **opencode** — assembles `AGENTS.md`/`CLAUDE.md` discovered instructions (additive, FS + URL) →
  then agent-specific prompt (defined in `opencode.json` or `.opencode/agents/*.md` frontmatter+body,
  replace). Same two-axis model.
- **little-coder** — deliberately **lean ~1000-token base** + 4 tools, then **30 markdown skill
  files** injected on demand by extensions. Whole thesis is "scaffold–model fit" for small local
  models (9.7B Qwen 19%→45% on Aider Polyglot). Validates our `fleet` intent-skill +
  `KeywordSkillSelector` approach: don't grow the base, lean harder on skills.

**Common pattern:** baked base · two customization axes (additive layer + replaceable persona) ·
specialization in injected fragments (skills), not the base.

**Where ctrl-b sits today:** baked `DEFAULT_SYSTEM_PROMPT` → `inference.system_prompt` (replace) →
`agent.prompt` (replace) + skills injection. **We're missing the additive axis** (the
`append`/AGENTS.md equivalent) and a way to *see* the baked default. That's the gap A + B close.

**Owner-locked plan:**
- **A — additive layer:** new `inference.system_prompt_append: str` (+ optional per-agent
  `prompt_append`). Effective context = base + an append, **emitted as its own `system` message**
  (separate from the base — mirrors how the roster and active skills are injected; keeps the base
  prompt stable for any future caching, makes the "extra" easy to attribute in logs).
- **B — show the default:** `GET /api/agent/default-prompt` returns the baked text + the prompt
  editor gets a "Load default" button (pre-fills the override field with a copy) and a "Restore
  default" button (clears the override → falls back to baked). Removes the "blank = mystery" UX.

**Decisions to lock at the start of tomorrow's session (~5 min):**
1. **Per-agent append vs. global append composition:** does `AgentDef.prompt_append` *layer onto*
   `inference.system_prompt_append`, or *replace* it? Claude Code's analog has them independent
   (CLAUDE.md always added, persona independent), suggesting **both apply** with an opt-out flag per
   agent (e.g. `inherit_append: false`). Confirm.
2. **Append as a separate `system` message** (lean: yes, clean + cache-friendly + visible in logs)
   vs. concatenated to the base. Confirm.
3. **Home phase:** A + B fit naturally in **7e** ("prompts editors + memory panel"); folding the
   baked default into a "default" prompt asset is also 7e-shaped (option D from the research). Confirm
   7e as the home so 7d stays the finished slice — or call it `7d-d`.

#### UX proposal — full-page prompt modal (the "small text fields" fix)

Owner reaction was right: textareas inside `.mform` rows / `.conf-textrow` are too small for a real
prompt. Proposal:

- **One reusable `<PromptModal>`** — full-viewport overlay, opened from any prompt field by an inline
  **"Edit fullscreen ↗"** button. Uses the same `100dvh` + `--app-h` (`visualViewport.height`) shell
  the app already runs (`App.tsx`), so the Android keyboard shrinks the modal correctly.
- **Layout:** header (title + close) · tall monospace `<textarea>` filling the body · char/token
  counter · footer `[Load default] [Restore default] [Cancel] [Save]`. For SKILL.md the footer adds
  `[Remove skill]`.
- **Opens from:** Conf → Inference → System prompt; Conf → Agents → per-agent Prompt; Conf → Skills
  → SKILL.md editor. The inline row keeps a 1-line preview (`override active · 1.2k chars · "you are
  ctrl-b, a concise assistant…"`) so the Conf list stays scannable.
- **Why a modal over a sub-page:** matches the mobile-first single-window design, reuses the shell,
  no tab-state plumbing. A "Prompts" sub-page can come later in 7e if the count of editable prompts
  grows.
- **Alternatives considered:** inline expand (fights with fixed composer/tab bar), bottom sheet
  (visually identical to a modal on mobile, more code).

#### Conf sizing/cropping inventory (one `refine` commit)

Group these into one `refine(dashboard_v2): conf sizing` commit so the diff is reviewable:

1. **Inference → System prompt textarea** (`.conf-textarea` 64px, max-width 62%) → replace with the
   "Edit fullscreen ↗" button + 1-line preview.
2. **Agents → per-agent Prompt** (`.kv-text` 48px inside `.mform`) → same opener.
3. **Skills → SKILL.md editor** — keep the inline 320px (already polished in the working tree) but
   add an "Open fullscreen ↗" button for long files.
4. **`.mform` grid** (90px label / 1fr value) — long labels ("Subagent fan-out limit", "Clamp
   subagent privilege") wrap awkwardly at 390px. Either widen the label column to 100–110px or allow
   `label` to wrap to 2 lines.
5. **Agents → Limits grid** (3 columns) — tight at 390px; switch to 2 columns at viewport ≤ 420px.
6. **Masked secrets / long URLs** in `.confrow` — audit `word-break` on values that don't render
   through `.k .desc` (which vapor already breaks).
7. **Fold the two CSS refinements in the working tree** (tooldesc heading padding + skill textarea
   bigger) into this same commit.

#### Start here tomorrow

1. **Lock the three decisions above** (yes/no in 5 min).
2. **`refine(dashboard_v2): polish 7d Conf` commit** — pick up the two uncommitted CSS refinements
   in the working tree (skills textarea standalone + 320px, tooldesc heading padding). Verify @390px.
3. **Push 7d (4 commits + polish)** to `origin/main` after the owner eyeball — or hold per the
   standing rule.
4. **Slice the prompt-append + default-prompt slice (`7d-d` or `7e-a`):**
   - Backend: `Settings.inference.system_prompt_append` + optional `AgentDef.prompt_append` + the
     inheritance flag. `_system_prompt()` returns the base; `_assemble()` emits a *second* `system`
     message carrying the append (and a third if per-agent append exists, depending on the
     compose decision). `GET /api/agent/default-prompt` returns the baked text. Tests:
     `test_prompt_append_7e.py` — base + global append + per-agent append round-trip through
     `_assemble`; endpoint returns the default text.
   - Frontend: `<PromptModal>` (one component), wired from Conf → Inference / Agents / (optionally)
     Skills SKILL.md. Inline rows shrink to "preview + Edit fullscreen ↗".
5. **Slice the Conf-sizing refine** (the 7-item list above) as a separate commit so the diff stays
   reviewable.
6. After both: the rest of **7e** (prompt-file editors for arbitrary `prompts/*.md` + the memory
   panel built on the 4f embeddings seam) is unblocked.

### ⭐ Session update — 2026-05-29 (Phase 7d — skills/agents management + per-tool descriptions)

**Built + verified + committed locally** (`7d-a` per-tool descriptions · `7d-b` agents UI · `7d-c`
skills UI; **not yet pushed**). Conf gains the last management groups so agents/skills/tool-wording
are all UI-editable — no more hand-edited YAML for these. The big lever here is that the agent picks
tools by their model-facing **description**, so editing those steers a weak local model (the
2026-05-28 finding) without code.

- **7d-a — per-tool description overrides:** `Settings.tool_descriptions` (name→text) +
  `runtime.apply_tool_descriptions` overlays them onto the **live registry specs** — the single seam
  both `GET /api/actions` and `to_openai_tools` read, so the model + the UI reflect a change at once.
  Originals are captured once on `app.state.tool_desc_orig` so **clearing an override restores the
  built-in**. Wired in lifespan (after every provider registers), `reconfigure` (when the section
  changed), and at the end of `rediscover_integrations` (fresh MCP/OpenAPI specs pick overrides up).
  Edited via the existing `PUT /api/settings`. Conf → **Agent tools** group (collapsed): agent-exposed
  tools grouped by category, editable description each, blank = reset.
- **7d-b — Agents management** (`components/AgentsEditor.tsx`, `hooks/useAgents.ts`): a group-level
  draft saved through `PUT /api/settings` — the **whole `agents` list is replaced** (deep_merge
  replaces lists) and the `agent` section deep-merges, in one PUT; the full agent objects round-trip
  so unexposed fields (compaction, extras) survive. Per-agent form: name (add-only), backend
  (inherit/local/cloud) + model id, privilege Seg, prompt, a **tools tick-grid** (all vs explicit
  subset), a **skills mode** (all/none/custom + tick-grid), and a **loop/subagent limit grid**. Plus
  default-agent select + subagent fan-out limit + clamp-privilege toggle. **`/agent <name>` composer
  switch** (sticky per session, bare = default — same non-persistent caveat as `/local`//`/cloud`):
  `ChatRequest.agent` → `_session(agent_name)` override (resume uses thread/default); `GET /api/agents`
  returns names+default for the composer + UI.
- **7d-c — Skills management** (`components/SkillsEditor.tsx`, `hooks/useSkills.ts`): master
  `skills_enabled` toggle (via `PUT /api/settings`), the discovered-skills list, a **raw `SKILL.md`
  editor** + add/remove via new **`GET/PUT/DELETE /api/skills/{name}`** (slug-guarded against
  traversal → 422; EOL-preserving; a blank PUT writes a frontmatter scaffold; DELETE removes the file
  + an empty folder, keeping sibling resources). The `FileSkillProvider` re-scans per call, so edits
  are **live, no restart**.
- **Frontend shape:** all three reuse the vapor `.mwrap`/`.mform`/`.mfoot` recipe + the 7a/7c
  `.conf-textarea`/`.kv-text` inputs; net-new CSS only (tick-grid, limits grid, `.skill-md`) in
  `extras.css` — **`vapor.css` untouched (D7)**. Conf groups renumbered 01–12 (Agents 08, Skills 09,
  Agent tools 10, Computers 11, Appearance 12); all collapsible with persisted state.
- **Verified:** `test_tool_descriptions_7d.py` 2/2 · `test_agents_7d.py` 1/1 (StrEnum privilege
  round-trip = audit A1 exercised live, hot-apply via `resolve_agent`, `/api/agents`, 422 on bad
  privilege, clear→built-in default) · `test_skills_7d.py` 1/1 (scaffold + live discovery, overwrite +
  re-parsed description/allowed_tools, slug-guard 422, delete + 404). **All backend suites green** (7a
  7 · 7b 2 · 7c 4 · 7d 2+1+1); `compileall` + `tsc -b` + `vite build` clean. **Writes tested on a temp
  config/skills dir only** (audit E3).
- **Owner D7 eyeball pending:** the **Agents**, **Skills**, and **Agent tools** forms @390px across
  vapor/aqua/ember — and a live check that `/agent <name>` switches the agent and an edited tool
  description actually changes the model's tool pick.

### Earlier baseline (Phase 4.5 + 2026-05-28 capability/UX session)

**Everything through Phase 4f is committed + pushed to `origin/main`** (4a `f9e9965` · 4b `6c2d181`
· 4c `b44c039` · 4d `df612e3` · 4e `60f8e68` · vite-host fix `f2774b8` · **4f**: web_search `05e5a48`
+ links `271c0b3` · MCP `e148a41` + risk `2ed987d` · open-terminal `c4ec84c` · OpenAPI `a4e3e86` ·
embeddings `97e4f89` · **Agent-tab polish**: collapse tool command bubbles by default `9d1b1e2` ·
group a thinking block with the tool call it produced `73fe813` · inset fix `5b41dfb` · **MCP stdio
transport `874cdb1`**). **Phase 4.5 (skills + agents/subagents) is committed + pushed to `origin/main`
(through `591cc5b`):** AgentDef spine `c964237` · skills `e2c90e8` · subagents `e84797f` · 4.5 docs
`ba11479` · **subagent parameter inheritance** `b407cec` + docs `70571c4` · **tool-description fallback
fix** `f72ccb0`. The 4e/4f file lists below are reference.

### ⭐ Session update — 2026-05-29 (Phase 7c — integrations panel)

**Built + verified + pushed to `origin/main`** (7c-a `455ae8c` · 7c-b `7804212` · collapsible-Conf
polish `e99ea49`; tree clean). Conf gains an integrations panel; the agent's external endpoints are
UI-managed. Two apply paths, by design (owner's call):

- **7c-a — scalars hot-apply** (`455ae8c`): SearXNG / embeddings /
  open-terminal groups edit through the existing `PUT /api/settings`. `runtime.py` gained async `set_searxng`/
  `set_embeddings`/`set_open_terminal` single-source builders (await old `aclose`, rebuild, repoint
  `app.state.*` **and** `deps.*`), called by both lifespan and `reconfigure` (no drift). `reconfigure`
  rebuilds each only when its section changed. No restart.
- **7c-b — MCP + OpenAPI managers + rediscover:** `api/integrations.py` (list CRUD keyed by name,
  comment/secret-safe via `edit_config_yaml`+`sync_mapping`; `_minimal` trims defaults so the YAML
  stays hand-written-style), `GET /integrations/status` (per-server discovered-tool summaries +
  `dirty` flag), `POST /integrations/rediscover`. **Apply between turns, never mid-turn** (the safe
  design for live-registry mutation): a write flips `app.state.integrations_dirty`; `api/agent.chat`
  re-discovers **before** building the turn's toolset when dirty; the manual **Rediscover** button
  applies on demand and **409s while `active_turns>0`** (counter bumped around `run_turn`).
  `ToolRegistry.remove`/`remove_category("mcp")` (MCP + OpenAPI both register as `"mcp"`) clears the
  bucket before re-running both providers' `discover()` under `app.state.discovery_lock`. No restart.
- **Frontend:** `components/ServerListEditor.tsx` (reuses the vapor `.mwrap`/`.mform`/`.mfoot` shell;
  MCP transport `Seg` toggles http url+headers ↔ stdio command+args+env; OpenAPI base/spec/auth/
  include; headers/env/args via compact `.kv-text` textareas — net-new in `extras.css`). Each row
  shows its discovered-tool count or error from the status. `hooks/useIntegrations.ts` (status +
  CRUD + rediscover); name is read-only on edit (rename = delete+add). `vapor.css` untouched (D7).
- **Verified:** `test_integrations_7c.py` (scalar hot-apply rebuilds client+deps; MCP CRUD + dirty +
  409 dup + 404; rediscover busy-409 + empty-ok clears dirty; registry remove). All suites green
  (7a 7/7, 7b 2/2, 7c 4/4); `compileall` + `tsc -b`/`vite build` clean. Backend relaunched on 5433 —
  `GET /integrations/status` works (emma's `web-tools` currently shows a discovery error since emma
  is unreachable right now — failure-isolation surfacing it; Rediscover when it's up).
- **Collapsible Conf sections** (`e99ea49`): all 9 `.confgroup` headers now collapse via a leading
  magenta `›` chevron (design unchanged); open/closed state persists per-section in `localStorage`
  (`store/collapse.ts`). Default expanded.
- **Note:** MCP discovery wraps connection failures as "unhandled errors in a TaskGroup (1 sub-
  exception)" — ugly but harmless (0 tools registered, surfaced in the row). Friendlier error
  extraction is a small follow-up. **Owner D7 eyeball pending:** integrations forms @390px ×3 themes.

### ⭐ Session update — 2026-05-29 (Phase 7b — hosts + services CRUD)

**Built + verified + pushed** (`e325468` + services-collapse `d80a1f1`). The Conf → Computers group
is now a real editor: add / edit / delete machines (Vapor machine forms) **and** their services.

- **Backend `api/hosts.py`:** `POST /api/hosts`, `PUT /api/hosts/{id}`, `DELETE /api/hosts/{id}`.
  GET `_host_dto` gained **`has_password`** (bool — never the value) + **`services[]`** (full `cmd`
  map). Blank password on PUT keeps the stored secret (audit A2). **Rename** re-keys the entry via
  `comps[new] = comps.pop(old)` (preserves the node's inner field comments) + re-slugs the id.
  Service add/remove handled by `sync_mapping` (removed keys disappear). Each op validates via
  `ComputerCfg.model_validate` (422) + semantic checks (name/ip required, slug uniqueness → 409,
  dup service name), then `edit_config_yaml(mutate)` + `reconfigure(app, load_settings())` to
  hot-apply + invalidate caches (audit B4) — new machine shows next poll, no restart. `asyncio.Lock`.
- **`config.py` generalized:** the 7a comment/EOL-preserving writer is now `edit_config_yaml(mutate,
  path)` (the single YAML-write chokepoint) + `sync_mapping(node, target)` (set-if-changed / add /
  delete, comment-preserving) + public `host_slug`. `apply_patch_to_yaml` delegates to it. This is
  the seam 7c's MCP/integration list editors will reuse.
- **Frontend:** `components/MachineEditor.tsx` ports vapor's `.mwrap`/`.mform`/`.mfoot` machine rows +
  add-machine row (CSS already in `vapor.css`); a **net-new services sub-editor** (`.svc-*` in
  `extras.css`, built from VAPOR_PATTERNS tokens — `vapor.css` untouched) edits name/kind/port/path/
  autostart + per-host-OS start/stop/restart `cmd`, carrying other-OS `cmd` through unchanged.
  `hooks/useHostMutations.ts` (create/update/delete → invalidate `['hosts']`+`['settings']` + toast);
  `del()` added to `api/client.ts`; delete goes through the existing `requestConfirm`.
- **Verified:** `tests/test_hosts_7b.py` 2/2 (TestClient on a **temp** config — add/edit/rename/
  delete/services-sync/multi-OS-cmd/secret-keep/409/422); 7a tests still 7/7; `compileall` + frontend
  `tsc -b`/`vite build` clean. Backend relaunched on 5433 (venv) — `GET /hosts` on the real config
  shows `has_password`/services with no secret leak. **Writes were tested only on a temp config
  (audit E3 — never the real `config.yaml`).**
- **Known limitation:** a comment *physically trailing a deleted element* is dropped with it (ruamel);
  leading section comments (the owner's style) survive sibling deletions.
- **Owner D7 eyeball pending:** machine form + the net-new services editor @390px in vapor/aqua/ember.

### ⭐ Session update — 2026-05-29 (Phase 7a — Conf settings read/write foundation)

**Phase 7 is now sliced 7a–7e (TODO.md); 7a is built + verified (commit pending — not yet pushed).**
Started with a **pre-implementation audit** ([`AUDIT_settings.md`](./AUDIT_settings.md)) of the
settings functionality + config→runtime design, then built the slice with the findings folded in.

- **`GET/PUT /api/settings`** (`api/settings.py`): GET returns the full config secret-masked; PUT
  takes a **partial deep-merge patch**, restores unchanged secrets, validates (422 on bad value),
  persists, and hot-applies. Conf tab's **Inference** + new **Server** groups are wired to it
  (`hooks/useSettings.ts`, `putJSON`, dirty-tracked Save + toast); Appearance stays UI-store-only.
- **Audit blocker caught (A1):** `save_settings` did `model_dump(mode="python")` → `yaml.safe_dump`,
  which **can't serialize a `StrEnum`** → would crash the first save once an `agents[]` entry (with
  its `privilege`) exists. Fixed with `mode="json"`. Latent only because `agents` was empty.
- **Secret safety (A2):** `unmask_secrets` — a masked/blank secret echoed back from the form is
  treated as unchanged (keeps the stored real value); a new value overwrites. No more wiping SSH
  passwords / API keys with the mask.
- **⭐ Runtime reconfigure seam (B1/B2, `app/runtime.py`):** the owner's concern was lifespan↔reload
  **drift**. Solved by design: **single-source `set_*(app, settings)` builders** that *both* lifespan
  and `reconfigure()` call — exactly one construction site per subsystem, can't drift. `reconfigure`
  updates the shared `Settings` in place (live readers fleet/services/deps see it), rebuilds
  `InferenceClient`, invalidates status caches; PUT is `asyncio.Lock`-guarded. This module is the
  future `build_runtime` home — 7c adds `set_searxng`/etc. here and extends `reconfigure`.
- **⭐ Comment/format preservation (E1, owner-approved):** the static audit under-rated this — live
  testing showed `save_settings` **normalized the whole file** (stripped comments, reordered,
  expanded defaults). Added **`ruamel.yaml` (pinned 0.18.10)** + a **patch-based writer**
  (`apply_patch_to_yaml`): a UI save edits only the changed leaves in place (`prune_unchanged`),
  keeping comments/order/quoting/minimal-style verbatim; unchanged lines (incl. secrets) untouched.
  **EOL preserved too (E2):** detects LF/CRLF from raw bytes, writes bytes directly (no Windows
  `\n`→`\r\n` churn). **Verified live:** a real PUT changed *only* the one `poll_seconds` line.
- **⚠️ Process note (E3):** during testing I briefly ran live PUTs against the owner's real
  `config.yaml` and it got normalized; **recovered losslessly** (reconstructed from the diff, proven
  byte-equivalent via validated `model_dump`s, comments restored). Lesson logged: write-endpoint
  live tests must use a throwaway `CTRLB_CONFIG`/`CTRLB_DB`, never the real config.
- **Verified:** `compileall` + app import clean; `tests/test_settings_7a.py` **7/7 pass**; frontend
  `tsc -b` + `vite build` clean; **live on 5433** — GET masks (`sk…2f`/`ne…go`), PUT preserves
  secrets+comments+EOL, `poll_seconds` applies without restart, port flags `restart_required`, bad
  value → 422. Backend relaunched on 5433 (venv), reachable via the 5190 Vite proxy.
- **Owner eyeball pending (D7):** the Conf **Inference + Server** forms @390px (Save pill mirrors
  vapor's `.mfoot button.save`; net-new CSS in `extras.css`, `vapor.css` untouched).

### ⭐ Session update — 2026-05-28 (committed + pushed; tree clean, in sync at `c6d3ff5`)

Everything below is on `origin/main`. **Servers were restarted many times; one clean backend now
runs on 5433 (venv python), frontend on 5190.** Watch out: a stale *system-python* backend had been
serving 5433 with pre-fix code earlier this session — always confirm the instance on 5433 is the
venv one running current code.

- **Cloud chat wired** (`c6577c6`): `inference.cloud` → OpenRouter `google/gemma-4-31b-it:free`,
  same key as `embeddings:`; `default_mode` stays `local` (`/cloud` is opt-in). Live-verified; the
  `:free` tier is heavily rate-limited (429s surface as a clean SSE error).
- **Agent capability layer** (`27529de`, `a0b8e5a`, `d112754`) — *C1 loop discipline*: per-turn
  duplicate-call suppression (`max_repeat_calls`), per-tool cap (`max_calls_per_tool`), result-based
  progress (a repeated outcome isn't progress), stall detection → **forced final answer** instead of
  a silent `capped` dead-end (the stall guard must NOT count narration text — that was a real bug).
  *C2 tool-selection*: routing rules in the prompt + sharper tool descriptions. Also **`task_plan`
  is now lenient** (repairs `status: in_progress`→active, alt field names, bare-string steps — fixed
  "broken task_plan call"). New knobs live on `AgentDef` (configurable, inherited by subagents).
- **⭐ The key finding (proven live): `minig+` is NOT too weak — the full 21-tool *namespaced* set
  confused it** (it hallucinated names like `mcp__fleet_ping`/`fleet.ping_host`, never called
  `task_plan`, spammed web search). **Fix = a `fleet` intent-skill** (`da9f6ff`,
  `skills/fleet/SKILL.md`) that **auto-activates** (KeywordSkillSelector, little-coder style) and
  narrows the toolset → the same prompt went from a 16-search spiral to **4 clean calls** (task_plan
  → ping_host → open_service_url ×2 → accurate answer). **Opt-out for capable models: set
  `skills: []` on an agent** → full toolset, model's own judgment (Claude-Code style). Documented in
  `config.example.yaml` + README; roadmap **A7** (`c61dd68`) tracks a Conf UI / `/agent` switch.
- **`check_service` liveness tool + `open_service_url` correctness fix** (`448249a`): the agent had
  no real service health check and was calling services "operational" off `open_service_url` (which
  only *builds* the URL — no probe). `check_service` does a live TCP probe (reports DOWN if the host
  is offline); descriptions updated so the model never conflates the two. Verified live with emma off.
- **`reboot_host` action + UI** (`1df085f` backend · `6a7770e` button · `7308cbf`/`42b8353` refine):
  OS-agnostic (per-target `os_type`), HIGH/confirm. Device-row button beside shutdown (wake-accent
  gradient, gapped rotate glyph), shown with shutdown when online, wake-only when offline; eq bars
  trimmed + buttons grouped in one `.acts` grid cell so they fit (vapor `.top` is a 5-col grid).
- **Clickable plan-step dots** (`b525553`, `0cc9e09`): tap a step's dot in the pinned plan panel to
  toggle done/undone — **persistent + agent-aware**. `POST /api/agent/plan` updates the latest
  `task_plan` call's *args* (what the model sees next turn) + its result *in place* (no breadcrumb
  spam). Reuses message history (no separate plan store). Dot keeps its original look.
- **OS-compatibility pass** (`c6d3ff5`): `fleet._ping_cmd` is a 3-way `platform.system()` branch
  (Windows `-n/-w ms` · Linux `-c/-W sec` · macOS/BSD `-c/-t sec`); shutdown/reboot OS-command
  lookups use `.get()` with a clean DENIED fallback. WOL/paths/SSH/sockets/HTTP were already
  portable. **Ready to run on emma/Linux at cutover.**
- **Housekeeping:** the 2 moderate Dependabot alerts (vite/esbuild in the dead `ws_codex_2`
  prototype) were **dismissed as not-used** — the active `dashboard_v2` already runs patched vite
  7.3.3 / esbuild 0.27.7.

**Still owner-eyeball (D7):** the reboot button + clickable plan dots @390px; the fleet-skill
behavior in the live UI (a fleet ask should now plan, use real tools, and render the plan panel).

**Live-probed against `minig+` this session (servers up on 5433/5190):** `web_search` ✅ (model
calls it, auto-runs, clean answer); forced skill `/web-research` ✅ (activates, narrows tools, fuller
synthesized answer); **subagent runtime ✅ live** — a direct `spawn_subagents` invocation (confirm
token → execute) ran a real 2-child fan-out (2/2 ok, both real `minig+` answers aggregated).
**Caveat:** `minig+` will **not *choose*** `spawn_subagents` in chat even when told to — it reaches
for the concrete `search_web`/`mcp__web-tools__search_web` instead (it *does* fan several searches in
one step on its own). That's the known weak-local-tool-calling limit (TODO 4c: prompted-JSON
fallback), not a wiring bug — the delegation plumbing is proven; a stronger/cloud model would pick it.
**Tool descriptions:** all 21 tools expose their own model-facing description (explicit / docstring /
MCP-remote); the docstring fallback now takes the first *paragraph* (no mid-sentence truncation), and
each description lives on `ToolSpec` — the seam a Phase-7 Conf per-tool override will overlay.

⭐ NEW in Phase 4.5 — agent definitions + skills + subagents (`backend/app/`):
```
  domain/agent.py              # ⭐ AgentDef (prompt/model/tools/skills/privilege + loop & subagent
                               #     limits) + ModelRef (moved here from config; re-exported there)
  config.py                    # ⭐ Settings.agents[] + resolve_agent(name); AgentCfg.default_agent /
                               #     global_subagent_limit / skills_dir / skills_enabled; skills_dir_path()
  core/tool.py                 # ⭐ ToolRegistry.for_agent(allow) (glob narrow); InvocationContext.depth+agent
  core/skills.py               # ⭐ Skill + SkillProvider/SkillSelector protocols (swappable seams)
  services/agent/skills.py     # ⭐ FileSkillProvider (SKILL.md frontmatter+body) + KeywordSkillSelector
                               #     (default) + resolve_skills / skills_prompt / narrow_tools
  services/agent/subagents.py  # ⭐ spawn_subagents builtin (MED) + Orchestrator/ParallelOrchestrator
                               #     (asyncio.TaskGroup, per-agent + tree-wide sems) + run_subagent
  services/agent/session.py    #   AgentSession driven by AgentDef (prompt/tools/privilege/model/iters);
                               #     per-turn skill activation; headless mode (interactive=False) +
                               #     depth forwarded to invoke
  services/action_service.py   #   invoke()/_execute thread actor/privilege/interactive/depth/agent → ctx
  services/deps.py             #   agent-runtime handles (inference/threads/messages/actions/skills/
                               #     selector/subagent_sem) for spawning children; back-filled in lifespan
  adapters/inference.py        #   stream_chat gains a model override (an AgentDef selects its model)
  api/agent.py                 #   _session resolves the thread's AgentDef; ChatRequest.skills; GET /api/skills
  main.py                      #   builds FileSkillProvider+KeywordSkillSelector; back-fills Deps + the sem
  ../skills/web-research/SKILL.md   # ⭐ worked example skill (search → summarize w/ sources)
```
**Design decisions made here (D11 strategies):** skill auto-selection default = **keyword/description
overlap** (`KeywordSkillSelector`) — deterministic + model-agnostic so it works with a weak local
model; the `SkillSelector` protocol keeps an LLM-based selector a drop-in. Subagent orchestration
default = **bounded parallel** (`ParallelOrchestrator` over `asyncio.TaskGroup`); `Orchestrator` is
the swappable seam (sequential/map-reduce later). The **default chat agent** is a *synthesized*
`AgentDef` (all agent tools, CONFIRM, chat backend) so behaviour is identical when no `agents[]` are
configured. Subagents run **headless** (a confirm-gated call denies in place — no UI to confirm),
with **depth** bounded by `max_subagent_depth`. `spawn_subagents` is MED-risk → the default CONFIRM
agent confirms a fan-out before spending tokens; an `auto_low`/`full` agent spawns silently.

**Subagents inherit every parameter from the parent** (owner request, `b407cec`): `resolve_child`
clones the parent's `AgentDef` — model, **context-window/compaction** (now per-`AgentDef`, falling
back to the global `agent.compaction`), privilege, tool/skill allowlists, iteration + fan-out caps —
and a *named* subagent def overlays **only the fields it explicitly set** (so "configure just the
prompt" inherits the rest); no name → a full clone. Privilege is clamped to the parent unless
`agent.subagent_clamp_privilege: false`. So to give subagents more autonomy, raise the *parent's*
privilege (they inherit it); the headless deny only bites at CONFIRM (which means "ask a human").

**Verified (Phase 4.5):** backend `compileall` + app import clean; `tsc -b` + `vite build` clean.
Unit/stub tests pass: agent resolver (default/named/unknown-fallback) + `for_agent` glob filtering +
a stubbed turn honoring a custom prompt/cloud-model override; skills (frontmatter parse, selector
match/no-match, resolve dedup + allowlist restriction, prompt injection, tool narrowing) + a stubbed
turn where an active skill narrows tools to `web_search` and injects its instructions while an
unrelated message keeps the full toolset; subagents (parallel 2/2 batch on archived threads, depth
DENY, privilege clamp, headless deny-in-place, interactive suspend still works); a minimal-config
TestClient boot (spawn_subagents registered, Deps back-filled). **Not yet eyeballed live against
`minig+`:** whether the model actually picks a skill / calls `spawn_subagents`, and the subagent
command bubble @390px (it renders in the existing `.b.cmd` bubble — the children's answers in the
output line; a richer subagent panel is later polish) — **owner to do the side-by-side.**

**Agent-tab UX (this session, `frontend/src/tabs/AgentTab.tsx` + `theme/extras.css`):** tool command
bubbles (`.b.cmd`) now **collapse the `$`-args by default** (tool name + outcome stay visible; tap
the chevron to expand; auto-opens while awaiting a confirm so the owner reviews before approving),
and a thinking model's **reasoning renders inside the command bubble it produced** (think→act in one
unit) — a shared `ThinkBlock` is hosted in the first non-`task_plan` call's bubble, falling back to a
standalone bot bubble only when there's no call to host it. `web_search` hit links were already a
collapsed disclosure. `vapor.css` stays untouched (D7); all net-new CSS is in `extras.css`.

**Dev servers (per the owner's standing preference):** backend uvicorn on **5433** (launch with LAN
access / sandbox disabled — see the run gotchas), frontend Vite on **5190**. Confirm health at
`/api/health` direct + via the `:5190/api` proxy. A Vite server may already be live on 5190 (HMR).
**Phase 4f essentially done: `web_search` (SearXNG), the MCP client, curated open-terminal tools, a
generic OpenAPI tool provider, and the embeddings client all landed** (see below); MCP supports both
Streamable HTTP and stdio. The 4e file list further down is reference for earlier work.

⭐ NEW in Phase 4f — embeddings client (`backend/app/`):
```
  config.py                    # ⭐ EmbeddingsCfg (base_url/api_key/model/dim/enabled) + Settings.embeddings
  adapters/embeddings.py       # ⭐ EmbeddingsClient — OpenAI-compatible /v1/embeddings; embed(texts)→vectors
  services/deps.py · main.py   #   Deps.embeddings; built on app.state, closed at shutdown
```
**Design:** the OpenAI-compatible `/v1/embeddings` sibling of the chat `InferenceClient` (same lazy
`AsyncOpenAI`), local or cloud. `embed()` returns one vector per input, input order preserved
(sorted by the API's `index`). **There is no consumer yet** — the vector `MemoryProvider` + semantic
recall are Phase 7 (DESIGN §6); this is the tested seam they plug into, sitting on `Deps`. Wired to
**OpenRouter `qwen/qwen3-embedding-4b`** using the same key as cloud chat (OpenRouter *does* serve
`/v1/embeddings` — confirmed) — the key lives in the gitignored `dashboard_v2/config.yaml`'s
`embeddings:` block. **Verified live:** 2560-dim vectors, cosine sanity (self 1.0, unrelated 0.52).
*(The same OpenRouter key now also fills `inference.cloud` (model `google/gemma-4-31b-it:free`) so
`/cloud` chat works — `default_mode` stays `local`; the `:free` tier is rate-limited, see the 4c note.)*

⭐ NEW in Phase 4f — generic OpenAPI tool provider (`backend/app/`):
```
  config.py                    # ⭐ OpenApiServerCfg (base_url/spec_url/api_key/auth/risk/include) + Settings.openapi_servers
  adapters/openapi_tools.py    # ⭐ OpenApiToolProvider.discover() fetches /openapi.json, registers an
                               #     OpenApiTool per operation (api__<server>__<opId>); call() splits args→path/query/body
  main.py                      #   lifespan discovers into the registry (app.state.openapi + openapi_summary)
```
**Design:** the HTTP sibling of the MCP client — for Open WebUI "tool servers" or any OpenAPI/REST
service. Each operation is registered into the **same registry** (→ ActionService + gate + bubble).
The model gets a **self-contained JSON Schema**: path/query params become top-level props, the
requestBody becomes a nested `body` prop, and `#/components/schemas/...` `$ref`s are rewritten to
local `$defs` (attached) so nothing needs external resolution — reuses the `ToolSpec.raw_schema`
seam. On call, the flat args are split back into path substitutions / query / headers / JSON body.
**Risk:** GET/HEAD auto-run (LOW — reads); mutating verbs use the per-server `risk` (default med →
confirm). Per-server failure isolation (a bad spec logs + registers nothing). **Verified live** by
pointing it at open-terminal's own `/openapi.json` (12 ops; `$defs`/ref-rewrite correct; a GET
auto-ran; a POST gated → token → ran). *(The owner has no `openapi_servers` configured yet — it's
there for when they wire their Open WebUI tool servers; `openapi_summary` is `[]` until then.)*

⭐ NEW in Phase 4f — open-terminal tools (`backend/app/`):
```
  config.py                       # ⭐ OpenTerminalCfg (base_url/api_key/*_risk/…) + Settings.open_terminal
  adapters/openterminal.py        # ⭐ OpenTerminalClient — httpx Bearer client over the REST API
                                  #     (/execute + /files/{read,list,grep,glob,write})
  services/actions/terminal.py    # ⭐ terminal_exec/read_file/list/grep/glob/write_file + register_openterminal(reg,cfg)
  services/deps.py · main.py      #   Deps.open_terminal; main registers the tools (risk from cfg) + closes the client
```
**What open-terminal is:** open-webui/open-terminal — a Bearer-auth **REST API** ("a computer you
can curl"), *not* an MCP server — so it's wired as **curated typed actions**, not via the MCP
client. The owner's instance is emma `:9999` (bare-metal, runs as user `emma` in `~/workspace`,
`--api-key 0`). **Design:** these register **dynamically** (`register_openterminal`, called in
lifespan) instead of `@action`-at-import, so **risk is per-operation and config-driven**
(`OpenTerminalCfg.{exec,write,read}_risk`): reads (read/list/grep/glob) default LOW → auto-run;
`terminal_exec` + writes default HIGH → confirm (it's arbitrary remote shell — the remote analog of
the Phase-5 guarded `run_shell`). Skipped entirely if unconfigured. **Verified** unit + **live
against emma**: read-only auto-runs, `exec` gates → confirm token (single-use, args-bound) → runs
(`whoami`/`pwd` etc.), nonzero exit → ERROR. The **api-key is `0`** (effectively open remote shell on
emma — fine under tailnet-only/no-public-bind, worth knowing; keep exec/writes gated).

⭐ NEW in Phase 4f — MCP client slice (`backend/app/`):
```
  config.py                    # ⭐ McpServerCfg (transport/url/headers/command/args/env/risk/…) + Settings.mcp_servers
  core/tool.py                 # ⭐ ToolSpec.raw_schema — native JSON Schema handed to the model when set
                               #     (to_openai_tools prefers it over input_model.model_json_schema())
  adapters/mcp_client.py       # ⭐ McpClient — discover() registers an McpTool per remote tool into the
                               #     shared registry; call() opens a fresh session per call; per-server
                               #     failure isolation; both transports wired (Streamable HTTP + stdio)
  main.py                      #   lifespan: build McpClient → discover into the registry → app.state.mcp(_summary)
  pyproject.toml               #   + mcp==1.27.1
```
**Design:** the agent must see MCP tools as just more entries in the one toolset (DESIGN §3), so each
discovered remote tool is wrapped as an `McpTool` (the `Tool` protocol) and **registered into the
same `ToolRegistry`** as built-in actions — it then flows through the existing `ActionService`
(validate → `decide()` gate → execute → audit Event) and renders in the same `.b.cmd` bubble; the
loop never special-cases MCP. Names are `mcp__<server>__<tool>` (sanitized to the OpenAI
function-name charset `[A-Za-z0-9_-]`, ≤64 chars — **colons from the DESIGN's `mcp:server:tool`
would be rejected by the API**, so `__` is used). The remote's native `inputSchema` is handed to the
model via the new `ToolSpec.raw_schema`; arg **validation is a permissive passthrough**
(`_PassthroughArgs`, `extra="allow"`) because the remote server validates — a faithful
JSON-Schema→pydantic build would be fragile. **Per-tool risk** (`_risk_for`): MCP **annotations**
win — `readOnlyHint` → LOW (auto-runs: search/crawl/file-read never gate), `destructiveHint` → HIGH
(always confirms, a safety floor even on a `low` server) — else the server's configured **`risk`**
(default `med`; the owner's `web-tools` is set `low` since it doesn't annotate and search/crawl are
read-only). Connection is
**per-call** (a fresh short-lived `streamablehttp_client` + `ClientSession` entered/exited in one
coroutine) — this dodges the SDK's anyio-task-group lifecycle pitfalls of holding sessions open
across the lifespan, and makes **failure isolation** trivial (a down server fails into a clean
`ToolResult`, never crashing the agent; discovery of a down server logs + registers 0 tools, startup
proceeds). **Verified:** unit (fake session — discovery, raw-schema passthrough to OpenAI tools,
call→ToolResult, `isError`→ERROR, down-server isolation, med-risk gating at agent privilege) + boot
(`/api/actions` lists the MCP tools) + **live against emma's `web-tools`** (`http://192.168.1.160:3003/mcp`:
5 tools discovered — search_web / search_and_crawl / crawl4ai_crawl / _crawl_stream / _markdown — and
a live `search_web` call returned real results) **+ stdio live** against
`@modelcontextprotocol/server-filesystem` via `npx` (14 tools; the server's `readOnlyHint`/
`destructiveHint` annotations drove reads→LOW/auto-run, writes→HIGH/confirm — proving `_risk_for`
against a server that actually annotates). **`_session()`** branches on `transport`: Streamable HTTP
(`url`/`headers`) or stdio (`StdioServerParameters` with the operator env merged onto
`get_default_environment()` so `PATH`/`npx`/`uvx` resolve). **Follow-ups:** hot re-discovery on a
config `PUT` (Phase 7); rendering MCP `output` in the bubble (arbitrary text/JSON — a generic
disclosure like `web_search`'s links, later polish).

⭐ NEW in Phase 4f — `web_search` slice (`backend/app/`):
```
  config.py                    # ⭐ SearxngCfg (base_url/enabled/timeout_s/language) + Settings.searxng
  adapters/searxng.py          # ⭐ SearxngClient — cached httpx.AsyncClient → /search?format=json;
                               #     normalizes hits to SearchResult; SearxngError on down/non-JSON/bad-status
  services/actions/web_search.py  # ⭐ @action web_search (utility, LOW, agent-only) — shapes input,
                               #     formats numbered results for the model, normalizes failures to ToolResult
  services/actions/__init__.py #   imports web_search to register it
  services/deps.py             #   + Deps.searxng (SearxngClient | None)
  main.py                      #   builds SearxngClient onto app.state + Deps; aclose() at shutdown
  ../config.example.yaml       #   documented `searxng:` block (JSON-format-required note)
```
**Design:** `web_search` is a normal `@action` — `category="utility"`, LOW risk, `ui_exposed=False`
(no Utils card until the Phase-8 registry), `agent_exposed=True` — so it **auto-runs in the agent
loop** (LOW → ALLOW, no confirm gate) through the same `ActionService`, and renders in the existing
Vapor `.b.cmd` bubble via the outcome line (no frontend change needed). The SearXNG round-trip lives
in `adapters/searxng.py`; the tool reaches it via `ctx.deps.searxng`. Unconfigured / disabled →
clean `DENIED` ("not configured"); a stock SearXNG that only serves HTML → `ERROR` telling the owner
to enable the JSON format. **Verified:** unit (mocked `httpx` transport — happy path w/ param +
count-cap assertions, empty, HTML-not-JSON, 403, unconfigured, disabled) + boot (real config parses
`searxng`, `/api/actions` lists it as utility/LOW/agent-only) + **live against emma's instance**
(`http://192.168.1.160:8888`, real results, JSON format enabled). *(A richer search-results panel
beside the bubble — like the plan panel — is later polish, not blocking the next slice.)*

**Dev-server host fix (`f2774b8`):** `vite.config.ts` now sets `server.allowedHosts: true`. Vite
≥5.4 otherwise rejects any `Host` header that isn't localhost/IP (a DNS-rebinding guard), which
blocked reaching the dev server by machine name (`http://corsair:5190`) and would block the
Tailscale Serve `*.ts.net` FQDN needed for the mic over HTTPS. Safe here — tailnet-only, no public
bind (AGENTS.md §6). *(Note: GitHub flagged 2 moderate Dependabot vulns on push — not yet triaged.)*

⭐ NEW in Phase 4e (`backend/app/`):
```
  config.py                    # ⭐ ModelRef + CompactionCfg (enabled/threshold_tokens/keep_last_messages
                               #     /summarizer) + AgentCfg; Settings.agent
  adapters/inference.py        # ⭐ InferenceClient.complete — buffered (non-stream) summary call w/
                               #     mode+model override (summarizer selectable, D11)
  services/agent/compaction.py # ⭐ Compactor.compact(force=) + estimate_tokens + transcript render;
                               #     turn-boundary-safe split, rolling re-fold, truncation fallback
  services/agent/session.py    #   builds Compactor; loop runs compact() before each model call →
                               #     `compaction` event; public compact() for the manual path
  api/agent.py                 # ⭐ POST /api/agent/compact (force-fold; {removed, summaryId?, truncated?})
```
⭐ NEW in Phase 4e (`frontend/src/`):
```
  store/chat.ts                # ⭐ compactThread() (POST /agent/compact + breadcrumb) + `compaction`
                               #     SSE case → sys note; compactionNote() helper
  lib/composer.ts              #   /compact verb routes to compactThread(); added to /help
```
**Design:** compaction shrinks only the model's **working context** (the repo's
`include_compacted=False` view), never the visible chat log or the DB. The cut is `keep_last_messages`
from the end, **snapped back to a `user` message** so an assistant `tool_calls` is never split from
its `tool` results (which would make the OpenAI context invalid) — complete turns fold, complete
turns stay. The summary is a real `system` message timestamped at the boundary (`tail[0].ts - 1µs`)
so it round-trips through `_assemble` + `GET /threads/{id}/messages` with no extra store. A prior
rolling summary in the head is fed back to the summarizer (single live summary). Summarizer failure →
a truncation **placeholder** (still flips `compacted` so the next call can't blow the window; DB rows
never deleted). The summarizer is `agent.compaction.summarizer{mode,model}` — both `None` by default,
so it inherits the chat backend (a cheap model can be set later). `estimate_tokens` is ~chars/4
(excludes reasoning, which `_assemble` already drops). The UI shows a `// compacted N messages`
breadcrumb (auto: from the `compaction` SSE event; manual: from the POST response) and does **not**
re-read history — surfacing the raw summary mid-log beside the originals would just confuse.

⭐ NEW in Phase 4d (`backend/app/`):
```
  domain/plan.py               # ⭐ Plan + PlanStep (status pending|active|done); .done count
  services/agent/planning.py   # ⭐ @action task_plan (builtin, LOW, agent-only) — echoes the plan in data["plan"]
  core/tool.py                 #   @action gained a `category` param (default "action"; task_plan uses "builtin")
  services/actions/__init__.py #   imports planning to register task_plan
  services/agent/session.py    #   system prompt now tells the model to use task_plan for multi-step work
```
⭐ NEW in Phase 4d (`frontend/src/`):
```
  types.ts                     #   + Plan / PlanStep / PlanStepStatus (mirror domain/plan.py)
  tabs/AgentTab.tsx            # ⭐ PlanBubble — task_plan call/result → checklist panel; latest = full,
                               #     superseded = "// plan revised" breadcrumb. planFrom() reads result.data.plan
                               #     (falls back to call.args.steps so it renders before the result lands)
  theme/extras.css             # ⭐ net-new `.b.plan` panel + per-step tick states (vapor tokens; vapor.css verbatim)
```
**Design:** `task_plan` is a normal `@action` (LOW risk, `category="builtin"`, `ui_exposed=False`,
`agent_exposed=True`) so it **auto-runs** in the loop (no confirm gate) and flows through the same
`ActionService`. It has **no side effects and no deps** — it validates the steps and returns the
structured plan in `ToolResult.data["plan"]`. **There is no separate Plan store**: the plan lives in
the `task_plan` tool_result part in the message history, so reload (`GET /threads/{id}/messages`) and
the agent's own assembled context both recover it for free. The model **rewrites the whole list each
call** (TodoWrite-style) → the most-recent call is the live plan; the UI renders that one as the full
panel and collapses earlier ones. *(`/api/actions` now lists `task_plan` too — harmless; nothing
renders a UI button for it since `ui_exposed=False`.)*

⭐ NEW in Phase 4c (`backend/app/`):
```
  api/agent.py                 # ⭐ ChatRequest.mode validator (junk→None, else local|cloud) + run_turn(mode=)
  services/agent/session.py    #   run_turn/_drive take `mode`; forwarded to stream_chat (resume uses default)
```
⭐ NEW in Phase 4c (`frontend/src/`):
```
  lib/composer.ts              # ⭐ runComposer prefix router (!shell stub · /slash · else agent) + shared fillComposer
  lib/markdown.tsx             # ⭐ hand-rolled dep-free markdown→React + CodeBlock (copy + send-to-composer)
  store/chat.ts                #   sendMessage(text,{mode}) + sticky sessionMode; pushSystemNote/pushUserEcho;
                               #     startNewThread (/clear); initChat no longer clobbers local-only notes
  components/Composer.tsx      #   send → runComposer (was sendMessage+setUI)
  tabs/AgentTab.tsx            #   bot text rendered via <Markdown>; fillComposer now imported from lib/composer
  theme/extras.css             # ⭐ net-new `.md` block/inline + `.md-code` bar styles (vapor tokens; vapor.css verbatim).
                               #     NB: fenced `<code>` is reset so it doesn't inherit the inline-code green lozenge
                               #     (that bug — a green box per wrapped word inside code blocks — was caught + fixed).
```
**Routing grammar** (the agreed v2 shape, ARCHITECTURE §Composer): `!<cmd>` → guarded shell — the
sigil is `!` (the *only* command prefix, no `$`/`>`), a const in `lib/composer.ts`, configurable in
Conf later (Phase 7); Phase 5 wires the real `run_shell`, so 4c **stubs** it (echo + "not wired"
note). `/local`//`/cloud` with a message force the backend for that one message; **bare** they set a
sticky `sessionMode` (module var in `store/chat.ts`) until changed. `/clear` → fresh thread (history
stays in SQLite; next send mints a new one). `/help` lists commands. `mode` rides `ChatRequest.mode`
→ `stream_chat(mode=…)`. **Markdown is React-node output (never innerHTML)** so it's XSS-safe by
construction; links are scheme-allowlisted (http/https/mailto only). Streams fine — re-parsing the
short text each token is cheap and a half-typed ``` fence still renders.

> **Cloud is now configured** — `inference.cloud` points at OpenRouter (`https://openrouter.ai/api/v1`,
> model `google/gemma-4-31b-it:free`, same key as `embeddings:`); `default_mode` stays `local` so
> `/cloud` is opt-in per message. **Caveat:** the `:free` tier is heavily rate-limited upstream
> (frequent 429s under back-to-back use) — wiring is proven (a live `stream_chat(mode="cloud")` returned
> `pong`; 429s surface as a clean SSE `error`, not a crash). For reliable cloud, BYOK a Google AI Studio
> key in OpenRouter or switch to a cheap paid model. **Resume runs on the default mode** (the
> per-message mode isn't carried across the confirm round-trip — only matters if the summary model
> would differ; acceptable for now).

**Runtime extras landed alongside 4b (same commit):**
- **Fleet roster injection** (`session._roster`): each turn the agent gets an id↔name map of hosts +
  services projected from config, so it resolves a named host/service to its slug `host_id`/
  `service_id` itself instead of asking the owner. Prompt updated to forbid asking for ids.
- **`sudo -S` over SSH** (`adapters/ssh.run_command` gained `stdin_data`): `shutdown_host` (POSIX) and
  the service control runner (`actions/_common._prepare_sudo`) rewrite `sudo`→`sudo -S -p ''` and pipe
  the SSH password as the sudo password (an exec channel has no TTY). Both now detect sudo-auth
  failure instead of reporting false success. Assumes SSH password == sudo password (true on emma).
- **Owner's real `config.yaml`** (gitignored, not in the commit) now declares real services
  (corsair: llamacpp/signal-bot · vault: whisper/tts · g5: open-webui/sillytavern/old-dashboard ·
  emma: open-webui/searxng/open-terminal) and **staged config for later phases**: `stt`/`tts`
  (vault, Phase 6 voice), `searxng` (emma:8888) + `mcp_servers` (emma `http://192.168.1.160:3003/mcp`,
  Streamable-HTTP crawl4ai) — **real targets for Phase 4f**. These extra sections round-trip via
  Settings `extra="allow"`; the typed `SttCfg`/`TtsCfg`/`SearxngCfg`/`McpServerCfg` models are still
  TODO (add them when 4f/6 consume the sections).

**Dev-run gotchas (this box):** the backend must run with **LAN access** (don't sandbox it) or every
ping/WOL/SSH fails and hosts read offline though the code is fine. Avoid `uvicorn --reload` when
launching detached — its child worker orphans and holds 5433; run plain and restart on changes.
Frontend pinned to **5190** (5173–5175 are other workspaces).

⭐ NEW in Phase 4b (`backend/app/`):
```
  domain/conversation.py       # ⭐ ToolCallPart (call_id/tool/args/state) + ToolResultPart in the Part union
  core/tool.py                 # ⭐ ToolRegistry.agent_tools() + to_openai_tools() (input_model → JSON-Schema fn defs)
  adapters/inference.py        # ⭐ ToolCallRequest + ChatDelta.tool_calls; stream_chat(tools=…) reassembles streamed calls
  services/conversation.py     #   + MessageRepo.update()/get() (flip a ToolCallPart's state in place)
  services/agent/session.py    # ⭐ run_turn = the tool loop (assemble incl. tool_calls/results in OpenAI shape →
                               #     call w/ tools → ALLOW via ActionService · DENY synth · CONFIRM suspend) + resume()
  api/agent.py                 # ⭐ POST /api/agent/resume (execute|dismiss + confirm_token) → fresh SSE stream
```
⭐ NEW in Phase 4b (`frontend/src/`):
```
  types.ts                     #   + ToolCallPart / ToolResultPart (extend Part)
  store/chat.ts                # ⭐ multi-message turns; part.added/tool.permission/tool.result; resumeCall(); shared streamTurn()
  tabs/AgentTab.tsx            # ⭐ Vapor .b.cmd command bubbles (pairs tool_call+result by id) + execute/edit/dismiss
  theme/extras.css             # ⭐ net-new: cmd-result outcome line (state-colored) + resolved/gate states (vapor tokens)
```
**Agent privilege = `CONFIRM`** (the AgentDef default, D11): low-risk tools (wake/ping/start_service/
open_service_url) **auto-run** in the loop; med/high (stop/restart_service, shutdown_host) **gate** on a
confirm bubble — identical to the UI's `decide()` policy, just `Actor.AGENT`. The confirm dance reuses
Phase 2's single-use TTL'd token (minted by `ActionService`, surfaced in the `tool.permission` SSE event,
sent back on resume). A **suspended** turn parks in the DB (`ToolCallPart.state=AWAITING_CONFIRM`); resume
finishes that step then loops so the model summarizes. `_assemble` round-trips persisted tool calls/results
into OpenAI `assistant.tool_calls` + `tool` messages, synthesizing a `skipped` result for any abandoned
confirm so the context is always API-valid. `MAX_ITERATIONS=8`. SSE events added: `part.added`,
`tool.permission`, `tool.result` (DESIGN §12). **`vapor.css` untouched** (D7) — the `.b.cmd` shell is
verbatim; the outcome line is net-new in `extras.css` (vapor's `.cmd.done::after` hardcodes a shell
message, so resolved bubbles render the real `ToolResult.summary` instead of using `.done`).

----

⭐ NEW in Phase 4a (`backend/app/`):
```
  adapters/inference.py        # ⭐ InferenceClient — AsyncOpenAI per mode; stream_chat → ChatDelta(text|reasoning)
  config.py                    #   + InferenceCfg (local/cloud endpoints, default_mode, timeout); config.yaml local=minig+
  domain/conversation.py       # ⭐ Thread + Message + Part union (text/reasoning/error)
  services/conversation.py     # ⭐ ThreadRepo + MessageRepo (parts as JSON over db.py)
  services/agent/session.py    # ⭐ AgentSession.run_turn — text-only loop, yields SSE AgentEvents
  api/agent.py                 # ⭐ GET/POST /api/threads · GET /threads/{id}/messages · POST /api/agent/chat (SSE)
  main.py                      #   wires InferenceClient + Thread/Message repos onto app.state; mounts agent router
```
⭐ NEW in Phase 4a (`frontend/src/`):
```
  types.ts                     #   + Role/Part/ChatMessage/Thread
  store/chat.ts                # ⭐ dep-free streaming store: messages + status + sendMessage (fetch ReadableStream SSE parser)
  tabs/AgentTab.tsx            #   live chat log (Vapor bubbles + dim reasoning disclosure + streaming caret), initChat history load
  components/Composer.tsx      #   send → sendMessage + jump to Agent tab; disabled while streaming
  theme/extras.css             # ⭐ net-new: reasoning disclosure + caret + chat-error (vapor tokens; vapor.css verbatim)
```
The model `minig+` is a **thinking** model (Gemma, fits the owner's 3060) and is **fast in practice
even with reasoning** — the earlier "cold-loads slowly (2–3 min)" note was a one-time first-load
artifact, not steady-state; don't budget UX around it. The client timeout stays a generous 600s as a
safe upper bound. Reasoning is streamed/persisted as a `ReasoningPart` (dimmed, NOT replayed into the
model's next context). One thread for now (Vapor's "one agent · one thread"); thread-list UI later.

----

⭐ Phase 3 (already committed, `2675f82`) (`backend/app/`):
```
  domain/service.py            # ⭐ Service (+ command_for) + ServiceStatus (derived, never stored)
  config.py                    #   + ServiceCfg nested under ComputerCfg; Settings.services() projection
  services/svc.py              # ⭐ ServiceService — cached concurrent TCP port-probe off fleet status
  services/actions/_common.py  #   + ServiceTargetInput + run_service_command (shared SSH runner)
  services/actions/{start,stop,restart}_service.py · open_service_url.py   # ⭐ @action, one file each
  services/actions/__init__.py · deps.py · main.py   #   register + wire ServiceService into Deps
  services/action_service.py   #   _record target now falls back to service_id
  api/services.py              # ⭐ GET /api/services · POST /api/services/{id}/actions/{action}
```
⭐ NEW in Phase 3 (`frontend/src/`):
```
  types.ts                     #   + Service / ServiceStatus
  hooks/useServices.ts         # ⭐ useServices — polls ['services'] at poll_seconds
  hooks/useEvents.ts           #   SSE now invalidates ['services'] too
  tabs/FleetTab.tsx            #   fetch services, group by host_id, pass each row its own
  components/DeviceRow.tsx     #   ⭐ Vapor .svc-row list (led/name/host:port/↗ link) + "· N svc" sub
```
`config.example.yaml` gained a documented `services:` block under two hosts (the shape to copy).
No `vapor.css` changes (the `.svc-row` styles were already lifted in Phase 0) — D7 unaffected.

----

⭐ Phase 2 (already committed, `21781f7`) (`backend/app/`):
```
  domain/enums.py        #   + Risk / Privilege / Actor / RunState
  domain/result.py       # ⭐ ToolResult (+ Artifact) — the one outcome shape for every capability
  domain/event.py        # ⭐ Event — the single audit record (mirrors the `events` table)
  core/tool.py           # ⭐ ToolSpec / Tool / InvocationContext / ToolRegistry + @action + registry
  core/permissions.py    # ⭐ Decision + pure decide()  (CONFIRM-priv → wake/ping ALLOW, shutdown CONFIRM)
  core/events.py         # ⭐ in-proc EventBus (pub/sub → SSE; drops oldest, never back-pressures)
  core/redact.py         # ⭐ redact(text, secrets) — scrubs the SSH password from any output
  adapters/wol.py ssh.py # ⭐ wakeonlan + paramiko, blocking → called via asyncio.to_thread
  services/actions/      # ⭐ wake.py shutdown.py ping.py + _common.py (HostTargetInput); @action-registered
  services/action_service.py  # ⭐ validate → decide → confirm-token dance → execute → record Event
  services/events.py     # ⭐ EventService — persist to SQLite + publish to EventBus
  services/deps.py       # ⭐ Deps (settings + fleet + events) handed to InvocationContext
  api/actions.py events.py    # ⭐ GET/POST /api/actions[/{name}] · GET /api/events[/stream] (SSE)
  db.py                  #   + execute()/query() helpers (serialized write / WAL read)
  main.py                #   lifespan builds EventBus→EventService→ActionService; routers mounted
```
⭐ NEW in Phase 2 (`frontend/src/`):
```
  types.ts               #   + Risk/RunState/ToolResult/ActionSpec/CtrlEvent/InvokeResponse
  api/client.ts          #   + postJSON (surfaces FastAPI `detail`)
  hooks/useActions.ts    # ⭐ useActionSpecs + useFleetActions (confirm→optimistic→toast→invalidate)
  hooks/useEvents.ts     # ⭐ useEventStream — EventSource → refresh fleet on any recorded event
  store/toast.ts confirm.ts   # ⭐ dep-free stores (activity toasts + imperative requestConfirm())
  components/Toasts.tsx ConfirmDialog.tsx   # ⭐ toast stack + the lone (shutdown) confirm dialog
  components/DeviceRow.tsx     #   buttons wired to onAction; `busy` drives the ◐ spinner
  tabs/FleetTab.tsx App.tsx    #   FleetTab uses useFleetActions; App mounts Toasts+ConfirmDialog+SSE
  theme/extras.css       # ⭐ net-new toast/modal CSS — built from vapor tokens; vapor.css stays verbatim
```

The Phase 1 surface (Fleet read path, hero scene, theme store) and Phase 2 action stack are
unchanged underneath.

**Run it (two terminals):**
```powershell
cd dashboard_v2/backend  ; .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 5433
cd dashboard_v2/frontend ; npm run dev      # proxies /api → 5433
```
NOTE: this dev box already has Vite servers on 5173–5175 (other workspaces: ws_codex*, ws_claude_2,
a telegram bot). Vite will drift to a free port — pin it if you want a known one:
`npm run dev -- --port 5190 --strictPort`. Open the Vapor prototype next to it at ~390px:
`ctrl-b (Vapor)/variations/vapor.html`. **Acceptance is still the human side-by-side check.**

**Verified (Phase 4a):** `compileall` clean. A `TestClient` run (stubbed inference) passed: threads
CRUD, the SSE event order (`thread`→`message.start`→`reasoning.delta`/`text.delta`→`message.end`→
`done`), reasoning+text persisted as distinct parts, unknown-thread 404, and the backend-error path
(clean `error`+`done(error)`, `ErrorPart` persisted). **Live round-trip against `minig+`** worked
end-to-end: 14 `text.delta` events streamed over SSE, a clean sensible answer ("I help you monitor
and manage your fleet of homelab PCs remotely."), persisted + reloaded via `initChat()`. Frontend
`tsc -b` + `vite build` clean. Agent tab reviewed @390px — Vapor chat bubbles (teal user / magenta
bot, `who` dots) used verbatim; reasoning disclosure + caret are net-new in `extras.css`.

**Live-render fix (post-review):** the first cut only showed replies after a reload — the client
SSE parser split on `\n\n`, but `sse-starlette` frames end in `\r\n\r\n`, so no frame ever parsed.
Parser now tolerates `\r\n`/`\n` (`store/chat.ts`). Confirmed streaming live in-browser against
`minig+`, including the **reasoning disclosure live** (it's a thinking model — chain-of-thought
streams dimmed). Added a **working indicator**: on send, an assistant placeholder appears instantly
with animated "…" dots + a `thinking`/`working` tag in the who-line until the first answer token
lands (covers the slow cold-load / reasoning wait). Two more review fixes: **auto-scroll** now
sticks to the bottom on the **window** scroller (the `.chat-log` div isn't the scroller — `body` has
`padding-bottom` for the fixed composer) so the view follows the bot while it types (unless you've
scrolled up); and the **reasoning persists** after the turn as a collapsed **"▸ thinking · tap to
view"** dropdown chip (was auto-collapsing too subtly and felt lost) — tap to re-expand it. All CSS
net-new in `extras.css`. **Mobile layout — app-shell (the real fix):** the original window-scroll +
`position:fixed` composer/tab bar broke on Android Firefox — the dynamic toolbar shrinks the visual
viewport, so at the bottom of the chat the fixed bars and the body's bottom padding misaligned
(colored gaps / vanishing tab icons). (An earlier `--vv-bottom` "pin to visual viewport" attempt
double-counted Firefox's own fixed-positioning and made it worse — reverted.) Now the app is a
**`100dvh` flex column** (`extras.css`): a scrolling content pane `.app-scroll` (appbar + tabs),
then the composer + tab bar in **normal flow** at the bottom. `100dvh` tracks the toolbar/keyboard,
the bars are always at the visible bottom, and the chat scrolls in its own pane — **no body padding,
no fixed/viewport mismatch** by construction. `App` restructured to the shell; `AgentTab`
stick-to-bottom scrolls `#app-scroll` (not the window). **Keyboard:** `100dvh` tracks the browser
toolbar but NOT the on-screen keyboard, so the shell height is driven by `--app-h` =
`window.visualViewport.height` (App effect) which DOES shrink when the keyboard opens — the composer
rides up above it instead of being hidden (`dvh` is the CSS fallback). Desktop verified (layouts
unchanged, pane scroll + pin-to-bottom; shrinking `--app-h` lifts the composer); **owner to confirm
the Android toolbar + keyboard behaviour on the phone**.

**Cloud backend** is now configured (OpenRouter Gemma 4 free, `default_mode` stays `local`) and the
path is live-verified, though the `:free` tier is rate-limited (see the 4c note above). The cold-load
is now visibly indicated (dots) rather than a dead spinner. No `vapor.css` changes — D7 unaffected.

**Verified (Phase 4b):** `compileall` clean; frontend `tsc -b` + `vite build` clean. A `TestClient`
run with a **stubbed scriptable inference** (emits tool calls) + two synthetic tools (one LOW, one
HIGH/confirm) registered into the real registry passed end-to-end: `to_openai_tools` exposes the
toolset; **ALLOW loop** (model calls the low tool → auto-runs via `ActionService` → result fed back
as a `tool` message → second model call → `completed`); **CONFIRM** (high tool → `tool.permission`
with a token, no model call while parked → `suspended`); **resume(execute)** with the token → tool
runs → `completed`; **persistence** round-trips `tool_call` + `tool_result` parts; **resume(dismiss)**
→ synthesized `skipped` result → `completed`; **bad/empty args** tolerated (→ `{}` → validation,
no crash). **Not yet exercised live against `minig+`** — needs eyeballing that the model actually
emits tool calls (it's a thinking model; if native tool-calling is weak, that's the 4b "capability
fallback" follow-up). The confirm bubble UX wasn't reviewed @390px against `vapor.html` yet — **owner
to do the side-by-side** (the `.b.cmd` shell is verbatim vapor, so it should match; the net-new
outcome line is the only new pixels).

**Verified (Phase 4e):** backend `compileall` clean; frontend `tsc -b` + `vite build` clean. A
direct `Compactor` test (temp SQLite + a stubbed summarizer) passed 7 cases: **auto-compaction** over
a low threshold (summary system message first in the working view, originals flipped `compacted`,
full history intact in the DB); **turn-boundary safety** (tail starts at a `user` message, no orphaned
`tool` result in the working context — a seeded `ping_host` call/result turn stayed together);
**under-threshold no-op**; **`force` (manual `/compact`)** compacts under threshold; **floor**
(below `keep_last_messages` → nothing folded); **summarizer failure → truncation placeholder** (still
compacts, history kept); **rolling re-fold** (a prior summary is fed back, single live summary in
context); **selectable summarizer** (`mode`+`model` forwarded to `complete`). Backend relaunched
clean on 5433 (a stale `--reload` orphan from a prior session was holding the port with old code — it
lacked `/agent/compact`; killed it); `/openapi.json` now lists `POST /api/agent/compact`, which 404s
an unknown thread and returns `{removed:0}` on an empty one. Frontend already live on 5190 (HMR),
proxy OK. **Not yet eyeballed live:** auto-compaction firing on a long real `minig+` thread + the
`/compact` breadcrumb @390px — **owner to confirm** (and to set a cheaper summarizer in
`agent.compaction.summarizer` if desired; default inherits the chat model).

**Verified (Phase 4d):** backend `compileall` clean; frontend `tsc -b` + `vite build` clean. A
script confirmed `task_plan` registers as a `builtin` (LOW, agent-only), its `input_model` renders a
valid OpenAI fn schema (nested `$defs`), and a direct call returns the plan in `data["plan"]`. A
**full agent-loop test** (stubbed inference emits a `task_plan` call) confirmed it **auto-runs** —
no `tool.permission` — the `tool.result` carries `data.plan`, the loop continues to a text summary
(`done` completed), and the `tool_call` + `tool_result` (with `data.plan`) **persist** + round-trip.
Backend relaunched on 5433; `/api/actions` lists `task_plan` (8 tools). **Not yet eyeballed live:**
whether `minig+` actually calls `task_plan` for a multi-step ask, and the panel @390px — **owner to
do the side-by-side** (the `.b.plan` panel is net-new from vapor tokens).

**Verified (Phase 4c):** backend `compileall` clean; frontend `tsc -b` + `vite build` clean. A
stubbed-inference script confirmed `ChatRequest.mode` sanitizes (`local`/`cloud` kept, junk→`None`,
absent→`None`) and that `run_turn(mode="cloud")` forwards `mode` to `stream_chat` (turn → `completed`).
Backend relaunched on 5433 with the new code; health OK direct + via the Vite proxy (5190). **Not
yet eyeballed live:** the markdown rendering @390px against a real bot reply, the slash UX, and the
shell stub — **owner to do the side-by-side** (markdown CSS is net-new `.md` from vapor tokens; the
`.md-code` bar reuses the `.b.cmd` palette). Cloud-mode switching is plumbed and cloud is **now
configured** (OpenRouter Gemma 4 free; rate-limited — see note above).

**Phase 3 stays verified** (committed `2675f82`): service actions register with right risk/confirm,
`GET /api/services` derives port-probe status + url/controls, confirm dance + audit trail all
checked; owner has g5/emma services declared in `config.yaml` and the `.svc-row` reviewed @390px.

**Phase 2 stays verified** (committed `21781f7`): registry/`decide()`/confirm dance/audit/SSE all
checked; **owner ran the live stack against the real fleet (2026-05-27)** — fleet pings real hosts
+ a real WOL wake from the UI works. Still untested on a real host: `shutdown_host` end-to-end +
the confirm-dialog UX (Windows hosts need OpenSSH Server; Linux needs passwordless `sudo`).

(Phase 1 stays verified: `/api/health|hosts|hosts/{id}/status` correct under concurrent pings;
owner confirmed the pixel-exact side-by-side at 390px on 2026-05-27.)

## What this is

Single-user homelab control panel — wake/monitor/manage a PC fleet over LAN + Tailscale, with a
text/voice LLM agent that drives **typed, allowlisted actions** (not raw shell). **Tailscale-only,
no public bind, no auth** — never weaken that boundary.

## Locked decisions (one-liners — detail in DECISIONS.md)

- **Frontend:** mobile-first **PWA** — React 19 + TS + Vite 7 + TanStack Query + lucide-react +
  vite-plugin-pwa. Ports the Vapor design; widens to desktop.
- **⭐ Visual fidelity (D7):** the UI must be a **pixel-exact port of `vapor.html`** — lift the CSS
  verbatim, same fonts/colors/animations/components/themes; verify side-by-side. Not negotiable.
- **Extensible tools (D8):** Utils is a **tool registry** — a new tool (DNS trace, whois, …) is one
  file (handler + input + metadata) that auto-creates its endpoint, Utils card, and agent tool.
- **Backend:** **Python + FastAPI + Uvicorn**. Reuse paramiko / wakeonlan / openai /
  youtube-transcript-api. Async concurrent pings.
- **Execution:** **hybrid** — typed-action registry (UI + agent) is primary; one guarded
  `run_shell` (captured output, timeout, dangerous-flagged, agent-excluded by default) for the
  command escape hatch.
- **Persistence:** **SQLite** (threads / messages / memory / events) + **YAML** config
  (`config.yaml` shape preserved, secrets gitignored + masked).
- **Secrets model (decided Phase 0) — hybrid:** `config.yaml` is the UI-managed source of truth
  **including** nested secrets (per-host SSH creds, API keys); `.env` adds bootstrap paths
  (`CTRLB_CONFIG`/`CTRLB_DB`) + optional `CTRLB_<SECTION>__<KEY>` scalar overrides that **win** over
  the YAML. The app only ever rewrites `config.yaml`, never `.env`. Both gitignored; `.example`
  templates committed. Detail in `DESIGN.md` §9.
- **Ports:** backend on **5433** (the live Flask app keeps **5432** until cutover); Vite dev on 5173.
- **LLM/voice:** all OpenAI-compatible base URLs — chat (llama.cpp `llama-server` `/v1` or cloud),
  STT (faster-whisper `/v1/audio/transcriptions`), TTS (Kokoro/openedai `/v1/audio/speech`).
- **Agent integrations (D9), all configurable in Conf:** **MCP client** (multiple servers over
  **stdio** + **Streamable HTTP**, tools merged/namespaced), **SearXNG** endpoint → `web_search`
  tool, **embeddings** endpoint (llama.cpp `/v1/embeddings`) → vector memory.
- **Agent runtime (D10):** **context compaction** (auto + `/compact`), a built-in **`task_plan`**
  tool (+ extensible toolset — new tool = one file), and **skills** (`skills/<name>/SKILL.md`,
  model- or `/skill-name`-invoked). Study `RESEARCH.md` prior art (opencode + public Claude-Code).
- **Configurable agent design (D11):** **selectable summarizer model** (local/cloud + name);
  **multiple agents** as definitions (`agents[]`, add more) + **subagents** via a `spawn_subagent`
  tool; **skill-selection + orchestration are swappable strategies** — sensible default, easy to
  switch in settings, **concrete approach decided at Phase 4** with prior art in hand.
- **Composer prefixes:** `!<cmd>` (configurable sigil) → guarded shell; `/<cmd>` → slash commands
  incl. `/local`,`/cloud`; else → agent. Markdown bot replies + copy/send-to-composer on code blocks.
- **Mic needs a secure context → serve over HTTPS via Tailscale Serve** (tailnet-only, not Funnel).
- **Deploy profiles:** Windows / Ubuntu / Termux off one Python codebase.
- **Notifications:** optional (master toggle); default PWA-native (foreground + Web Push, auto);
  ntfy / Telegram-Discord optional; per-event toggles. No native app required.

## Build now so the post-v1 backlog slots in (the "seams")

Pluggable `MemoryProvider` · action `risk` levels on every action · typed chat-message kinds
(`text`/`action`/`question`/`plan`) + turn-based agent loop · chat endpoint supports streaming
**and** buffered · a settings/policy layer (privilege rides on `risk`) · **agents/skills/orchestration
behind swappable strategy interfaces** (don't hardcode) · Conf tab in functional groups
(Inference·Agent·Agents·Skills·Memory·Voice·Automations·Fleet·Server·Notifications·Appearance·Integrations).

## Open questions to resolve in-phase

- Agent tool-calling format + weak-local-model fallback (Phase 4).
- Embeddings backend specifics for vector memory (when B1 vector lands).
- **Agent privilege ladder** exact steps + escalation UX — least pinned down.
- **Agent design specifics (D11), deliberately deferred to Phase 4** — skill auto-selection
  algorithm, subagent orchestration, agents-as-YAML-vs-files, subagent depth/concurrency +
  privilege inheritance. Decide then, with the `RESEARCH.md` prior art (opencode + public
  Claude-Code) in hand; keep them swappable.
- **Real idle detection** mechanism (helper agent per host?) — the hard part of D1; optional/opt-in.
- Frontend routing: tab state vs react-router.

## Environment / running

- Host: **Windows 11**, shell **PowerShell** (`$null`, `$env:VAR`, backtick continuation); Bash
  tool also available. Python **3.11**. Backend venv already exists at `backend/.venv`; frontend
  deps already installed (`npm install` done).
- The **live Flask app** (`../../wol_server/wol_server_win.py`, port 5432) **keeps running** until
  cutover (TODO Phase 10). Do **not** modify it or the old prototype folders.
- Repo is **public** (`github.com/nengoxx/ctrl-b`); `dashboard_v2/` is tracked. Secrets
  (`config.yaml`, `.env`, `clients`, `*_prompt.*`) are gitignored — keep them out of commits/logs.
  The root `config.yaml` still holds a real OpenRouter key (gitignored, never committed) — the owner
  may rotate it.

## First action — Phase 7 Conf (or Phase 5 guarded shell)

**Phase 4.5 backend + the 2026-05-28 session work are all committed + pushed** (in sync with
`origin/main` at `c6d3ff5` — see the session block above). The weak-local-model selection problem
that dogged earlier phases is now **largely solved by the `fleet` intent-skill** (auto tool-narrowing),
with `skills: []` as the opt-out for a capable model. The natural next slices:
- **Owner visual side-by-side @390px** (D7) — newest un-eyeballed bits: the **reboot button**, the
  **clickable plan dots**, and a live fleet ask now rendering the **plan panel**. Plus the older
  skill/plan/markdown/subagent bubbles.
- **Phase 7 Conf tab** — incl. the **Skills/Agents management UI** (manage `agents[]`, tick tools
  per agent = roadmap A7, the `/agent` switch) **and per-tool description editing** (override seam is
  `ToolSpec.description`). Needs the `GET/PUT /api/settings` form infra; `GET /api/skills` exists.
- **Capability fallback (TODO 4c, now lower priority)** — prompted-JSON tool-calling for weak models.
  The `fleet` skill mostly removed the need by narrowing the toolset; this is the deeper lever if a
  model has weak *native* calling. (Cloud chat is wired but the free tier is rate-limited; BYOK or a
  paid `inference.cloud` model is the reliable capable-tool-caller path.)
- Or: wire real **Open WebUI tool servers** (`openapi_servers:`), or **Phase 5** (guarded `run_shell`).

Each piece its own runnable slice + commit (footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

**Small 4f leftovers (optional, non-blocking):**
- **MCP follow-ups:** both transports are done (Streamable HTTP + stdio). Still open: hot
  re-discovery on a settings `PUT` (Phase 7); rendering MCP/OpenAPI `output` in the bubble (a generic
  disclosure, like `web_search`'s links).
- **Cloud chat — DONE:** `inference.cloud` is configured (`https://openrouter.ai/api/v1`, model
  `google/gemma-4-31b-it:free`, same OpenRouter key as `embeddings:`); `default_mode` stays `local`.
  Live-verified (`stream_chat(mode="cloud")` → `pong`). The `:free` tier is rate-limited (frequent
  429s, surfaced as a clean SSE error); for reliable cloud, BYOK a Google AI Studio key in OpenRouter
  or set a paid model. The owner uses local most of the time, so this is left on free Gemma 4 as-is.
- **Wire real Open WebUI tool servers** via `openapi_servers:` (the provider's tested; just needs the
  owner's tool-server URLs + keys).

Optional 4b/4c/4d/4e follow-ups, none blocking — each is an **owner eyeball**, not a code task:
- **Eyeball live against `minig+`**: send a fleet question — confirm the model emits tool calls, the
  `.b.cmd` bubble streams in, and a `shutdown_host`/`stop_service` shows the confirm bubble + resume.
  Give it a **multi-step** ask ("wake titan then start minecraft") and confirm it calls `task_plan`
  and the **plan panel** renders/updates. Confirm a prose reply renders as **markdown** with the
  code-block copy/edit bar. If the thinking model's native tool-calling is unreliable, that's the
  **capability fallback** item (prompted-JSON → same `ToolCallPart` path; TODO 4c).
- **Compaction live (4e):** hold a long thread until it crosses `agent.compaction.threshold_tokens`
  (default 6000) and confirm the `// compacted N messages` breadcrumb appears + the agent still has
  context; try `/compact` manually. Optionally set a cheaper `agent.compaction.summarizer{mode,model}`.
- **Side-by-side @390px** of the markdown bubble, `.md-code` bar, and the `.b.plan` panel vs the Vapor
  look (D7) — owner's call.
- **`web_search` live (4f):** ask the agent something it must look up ("search the web for …") and
  confirm `minig+` actually calls `web_search`, the `.b.cmd` bubble shows the result + the collapsed
  **links** disclosure, and the model uses the hits. (Tool + live SearXNG verified; model-behavior check.)
- **MCP live (4f):** the agent now also has emma's 5 `mcp__web-tools__*` tools (crawl4ai/SearXNG).
  The owner set the server `risk: low` so they **auto-run** (read-only search/crawl — no confirm
  prompt, per the owner's preference). Confirm `minig+` picks an MCP tool for a crawl/search ask and
  the result feeds back. (Per-tool risk is annotation-aware: a server that sets `destructiveHint`
  would still gate that tool even at `risk: low`.)
- Cloud mode + the SSH service/shutdown path are still untested against a real host (shared one SSH path).

Open `TODO.md` → **Phase 4** is fully `[x]` (4a–4f). **Phase 4f is complete**: web_search, MCP client
(Streamable HTTP **+ stdio**), open-terminal tools, generic OpenAPI provider, embeddings. Next
runnable slice is **Phase 4.5 (skills + agents/subagents, D10/D11)** — keep skill-selection +
orchestration behind swappable strategies (D11); prior art in `RESEARCH.md`.

**Resume protocol (4b, for reference):** the confirm bubble's execute/dismiss POSTs
`/api/agent/resume {thread_id, call_id, decision, confirm_token}` and consumes a **fresh SSE stream**
(same event vocab as `/agent/chat`). `confirm_token` comes from the `tool.permission` event; the
client holds it in `store/chat.ts`'s `confirmTokens` map. A second message to a suspended thread just
starts a new turn — `_assemble` synthesizes a `skipped` result for the abandoned call so nothing breaks.

**Resolved open question (frontend routing):** went with **tab state** (the `store/ui.ts` `tab`
field), not react-router — 4 tabs, no deep-linking need yet.

**Phase 2/3 design notes worth carrying forward:** the UI invokes actions as `Actor.USER` /
`Privilege.CONFIRM`, so `risk` alone decides gating — `shutdown_host` (HIGH) and
`stop_service`/`restart_service` (MED) gate; wake/ping/`start_service`/`open_service_url` (LOW) run
immediately. Change the privilege and the gating changes, no per-button logic — the agent (Phase 4)
reuses the **same `ActionService`** with its own actor/privilege. The frontend reads `confirm`/`risk`
from the registry rather than hardcoding. Confirm tokens are in-memory + single-use + 120s TTL (a
two-step gate, not CSRF). Service liveness is **derived** (TCP port probe, cached at `poll_seconds`
off the fleet host status), never stored; service ids are `"{host_id}.{svc_slug}"`. `vapor.css`
stayed verbatim; net-new component CSS lives in `theme/extras.css`.
