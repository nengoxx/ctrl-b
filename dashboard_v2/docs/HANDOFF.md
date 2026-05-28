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
privilege-clamped). **Cloud chat is now wired** (`inference.cloud` → OpenRouter Gemma 4 free;
`default_mode` stays `local`; `:free` tier is rate-limited). **Next up: the Conf tab (Phase 7)** —
incl. the Skills/Agents management UI deferred from 4.5 — or wiring real Open WebUI tool servers, or
Phase 5 (guarded shell).
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

## Current state (Phase 4.5 backend complete)

**Everything through Phase 4f is committed + pushed to `origin/main`** (4a `f9e9965` · 4b `6c2d181`
· 4c `b44c039` · 4d `df612e3` · 4e `60f8e68` · vite-host fix `f2774b8` · **4f**: web_search `05e5a48`
+ links `271c0b3` · MCP `e148a41` + risk `2ed987d` · open-terminal `c4ec84c` · OpenAPI `a4e3e86` ·
embeddings `97e4f89` · **Agent-tab polish**: collapse tool command bubbles by default `9d1b1e2` ·
group a thinking block with the tool call it produced `73fe813` · inset fix `5b41dfb` · **MCP stdio
transport `874cdb1`**). **Phase 4.5 (skills + agents/subagents) is committed + pushed to `origin/main`
(through `591cc5b`):** AgentDef spine `c964237` · skills `e2c90e8` · subagents `e84797f` · 4.5 docs
`ba11479` · **subagent parameter inheritance** `b407cec` + docs `70571c4` · **tool-description fallback
fix** `f72ccb0`. The working tree is **clean** and in sync with `origin/main`. The 4e/4f file lists
below are reference.

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

## First action — push 4.5, then Phase 7 Conf (or 4f leftovers / Phase 5)

**Phase 4.5 backend is complete + committed + pushed** (through `591cc5b`; in sync with
`origin/main`). It was **live-probed** (see "Live-probed" above): web_search + skills + the subagent
runtime all work against `minig+`; the only gap is `minig+` not *choosing* `spawn_subagents`
(capability, not wiring). The natural next slices:
- **Owner visual side-by-side @390px** (D7) — the only un-eyeballed bit: subagent results render in
  the existing `.b.cmd` bubble (children's answers in the output line); a richer subagent panel is
  later polish. Also the skill/plan/markdown bubbles from earlier phases.
- **Phase 7 Conf tab** — incl. the **Skills/Agents management UI** deferred from 4.5 **and per-tool
  description editing** (the owner asked for it; the override seam is `ToolSpec.description`). Needs
  the `GET/PUT /api/settings` form infrastructure Phase 7 builds; `GET /api/skills` already exists.
- **Capability fallback (TODO 4c)** — prompted-JSON tool-calling for weak local models, so `minig+`
  can drive abstract tools like `spawn_subagents`. (Cloud chat is now wired — `inference.cloud` →
  OpenRouter Gemma 4 free — but the `:free` tier is rate-limited, so it's not a reliable way to get a
  capable tool-caller; BYOK or a paid model would be.)
- Or the older alternatives: wire real **Open WebUI tool servers** (`openapi_servers:`), or **Phase 5**
  (guarded `run_shell`).

Each piece its own runnable slice + commit (footer: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`).

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
