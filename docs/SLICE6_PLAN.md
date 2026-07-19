# SLICE6_PLAN — the D42 (context management & compaction v2) design draft, v4

> **STATUS: ✅ LOCKED as D42, 2026-07-19 (owner go).** The canonical record is now
> [`DECISIONS.md` D42](./DECISIONS.md) — this file stays as the full design draft + provenance.
> Pipeline provenance:
> 2 code-truth passes + 3 field passes (compaction mechanics ×6 agents · knob exposure +
> window discovery ×8 incl. llama.cpp source-verified · reasoning/output surfaces) + a
> 2-lens adversarial design review (4H resolved in) + two owner direction rounds
> (settings surface / window inference · fallbacks / output budgets / reasoning = ACA A10).
> Read bottom-up: the v3 body + the v4 ADDENDUM (which supersedes where it touches).

# D42 (v3 — LOCK-READY) — Slice 6: context management & compaction v2

Status: review-resolved + owner-direction-integrated, awaiting OWNER LOCK. Author: Fable 5, 2026-07-19.
v2 → v3 (owner direction 2026-07-19): + the SETTINGS SURFACE (Conf UI) + WINDOW DISCOVERY
(probe > config precedence… config > probe — see §3) + field-conventional knob names/units.
Inputs: ACA §5 Slice 6 sketch · two code-truth briefs (compaction internals; settings/probe
seams) · two field passes (compaction mechanics ×6; knob exposure + window discovery ×8 incl.
Hermes agent + llama.cpp source-verified).

## 1. Decision summary

Per-endpoint context windows — **probed from llama.cpp `/props` where available, config-set
otherwise, config always winning** — drive a **fraction-of-window trigger** with usage-anchored
counting; an **unconditional assembly-time tool-output trim** runs free before any paid summary;
a fixed-section template + `/compact <instructions>`; a one-counter thrash machine; a
best-effort reactive overflow backstop. **All owner-facing knobs land in the Conf UI** (global
compaction → the Agents group; per-endpoint window → the Inference group) and are hot at
next-turn granularity (verified: sessions build per-turn off live settings — no new plumbing).
No field agent ships a compaction settings UI (Goose Desktop omits even the threshold) — this
is a deliberate ctrl-b differentiator; the knob NAMES/UNITS follow the field.

## 2. Config & knobs (schema deltas; field-aligned names/units)

`CompactionCfg` (per-agent object via AgentDef.compaction; global default = Settings.agent
.compaction — the resolve `X or Y` at session build, verified):
- `enabled: bool = True` (exists — the field's self-hostable tools all ship it; the products'
  no-disable is their top grievance).
- **`threshold_frac: float = Field(default=0.85, ge=0.5, le=0.95)`** — fire compaction when the
  estimated context exceeds `window × threshold_frac` (fraction-of-window = the field plurality:
  Goose 0.8, Gemini 0.5–0.7, Hermes 0.5; presented in the UI as "Compact at N% of context").
  The v2 `reserve_frac` is RENAMED/inverted to the owner's + field's mental model (identical
  math; `le=0.95` keeps the too-late-to-summarize failure impossible; the ≥0.5 floor doubles as
  the v2 clamp). `reserve_tokens` absolute override DROPPED (one knob, one unit — the field's
  layered-percentages confusion [Codex 0.90×0.95] is the anti-pattern).
- `threshold_tokens: int = 6000` (exists) — the NO-WINDOW fallback only (unchanged semantics).
- **`keep_recent_tokens: int = 4096`** (pi's `keepRecentTokens` precedent) — the token floor,
  two-floor `_split` pinned: `cut = min(message-cut, token-cut)` → C5-M2 suspend-snap (+
  task_plan, v2 §5) → user-boundary snap. `keep_last_messages: int = 8` (exists) stays.
- **`clear_output_min_tokens: int = 500`** — the tool-output trim floor (token-named per Codex
  `tool_output_token_limit`/Claude `MAX_MCP_OUTPUT_TOKENS` convention; internally chars≈4×).
- `clear_keep_steps: int = Field(default=2, ge=1)` (the ge=1 IS the most-recent-step safety).
- `max_consecutive_failures: int = 3`.
- `summarizer: ModelRef` (exists — the Hermes `auxiliary.compression.model` precedent
  validates the separate-cheap-model design; stays YAML-only in v1, no UI picker).
`InferenceEndpointCfg.context_window: int | None = None` (declared; per-endpoint; the MANUAL
value — see §3 precedence; may exceed the probe [the Codex silent-down-clamp is the recorded
anti-pattern — the owner runs the server and knows the real `--ctx-size`]).
`CompactRequest.instructions: str | None` + the FE/store/Compactor threading (all five deltas,
v2 §2). `CompactionResult.rejected` + endpoint JSON + `compactionNote` branch (v2 §2).

## 3. Window discovery (the probe — NET-NEW, field-verified)

- **Probe**: `GET {base_url}/props` → `default_generation_settings.n_ctx` = the EFFECTIVE
  per-slot window (source-verified; at `--parallel 1` = `--ctx-size`; at `--parallel N` it is
  the correct per-conversation budget — documented); `meta.n_ctx_train` retained as the sanity
  ceiling. Lives on the **InferenceClient** (lazy first-use, memoized per base_url — the cache
  auto-invalidates because `set_inference` rebuilds the client on ANY inference-settings change;
  zero bookkeeping, verified). NEVER raises (the `_capture_cache_telemetry` posture); probe
  failure ⇒ None. Cloud/OpenAI: no probe (their API has no window field — verified) — manual
  `context_window` only.
- **Precedence (the universal field ladder)**: explicit `context_window` config **>** probed
  `n_ctx` **>** None ⇒ the `threshold_tokens` fallback trigger. Config wins over probe
  (every field agent with both; the probe is the smart default so the owner rarely sets it).
- The trigger resolves the window per `endpoint(eff_mode)` (mode-only — the code-truth
  correction stands); the summarizer's overflow guard reads its OWN ModelRef endpoint's window.

## 4. The Settings surface (Conf UI — net-new section work, all on existing patterns)

- **Inference group (01)**: two new Fields — `Local context window` / `Cloud context window` —
  mirroring the Local/Cloud model Fields (the `Field` + `Number()` coercion house pattern;
  blank = auto: probe for local, fallback for cloud; placeholder shows the probed value when
  live… placeholder-shows-probe is a nicety, decide at build).
- **Agents group (11)**: the global-compaction block in AgentsEditor's global-settings area
  (it already PUTs `{agent:{…}}`): `Auto-compact` Switch (enabled) · `Compact at % of context`
  (threshold_frac ×100) · `Keep recent (tokens)` · `Tool output trim floor (tokens)` — the
  inline `inputMode="numeric"` grid precedent (AgentsEditor Limits grid). `clear_keep_steps` /
  `max_consecutive_failures` stay YAML-only (expert knobs; the UI stays small).
- **Hot semantics**: a settings write reaches the NEXT turn (per-turn session build off live
  settings — verified, no new plumbing; mid-flight turns keep their captured Compactor).
  Per-agent `compaction` overrides remain YAML-only (the agents UI's deliberate
  `Omit<"compaction">` stands; extending it is out of scope, named).

## 5-8. UNCHANGED FROM v2 (all review resolutions stand)

§3-v2 the anchored estimator (per-backend TOTAL-prompt semantics; `prompt_progress.total`
preferred [already flowing — the ACA-18 `return_progress` pin]; telemetry precedence fixed;
no-reliable-total ⇒ no anchor; session-held anchor + watermark, invalidated on
fold/served-change/degraded; overhead = the A8 head+tools cache; ONE `_over_threshold`
predicate serving BOTH gates) · §4-v2 the unconditional clearing transform (pure shared
`plan_clearing` feeds the trigger net-of-clearing [gain priced chars/5 conservative];
output-only rendering keeps the `[state] summary` line; placeholder = the sketch's
`[output cleared — re-run the tool if needed]`; A12 DB-verbatim pinned; synthesized results
structurally exempt; never-clear: AWAITING_*-paired · task_plan · memory) · §5-v2 the
summarizer template (5 sections; pending scoped to the folded head; rolling carry-forward;
task_plan joins the `_split` snap; the summarizer-overflow truncation-fold guard) · §6-v2 the
thrash machine (`app.state.compaction_state` view; failure = didn't-shrink ONLY [a
TRUNCATION_NOTICE fold = success]; per-turn backoff; latching breaker + one notice; force
bypasses threshold/backoff/breaker but NEVER the inflation-reject; reset = not-over-threshold
after manual; restart-resets + cold-client blindness recorded) · §7-v2 the reactive backstop
(InferenceError gains code/status pre-flattening; nothing-streamed precondition; one-shot;
same-assistant re-stream; llama.cpp silent ctx-shift = recorded residual + deploy note).

## 9. Invariants (v2's eight + three new)

v2 §8 all stand. NEW: 10. The probe never blocks or fails a turn (lazy, memoized,
never-raises); the window chain is config > probe > fallback, upward overrides allowed.
11. Settings-written compaction knobs apply at the next turn (no restart) — pinned by test.
12. The Conf UI edits GLOBAL compaction only; per-agent stays YAML (the agents-UI Omit stands).

## 10. Verification plan (v2 §9 + the additions)

v2's full matrix stands. NEW: the probe (a fake /props server: n_ctx honored · config override
wins · probe failure ⇒ config ⇒ fallback · cache invalidated on set_inference · never-raises) ·
the settings round-trip (PUT agent.compaction → next turn's Compactor sees it — the hot pin ·
PUT inference.local.context_window → the trigger line moves) · the Conf UI rows (FE tests on
the new Fields/Switch + coercion; the SettingRow-sweep DOM conventions) · threshold_frac
validation bounds. Live: set the real `-c` on the local endpoint via the UI, run a long minig+
session, watch the trim tier then a summary fire.

## 11. Out of scope (v2 §10 +)

Per-agent compaction UI · a summarizer-model picker UI · probing cloud windows · Ollama/
LM Studio/vLLM probe adapters (the llama.cpp shape ships; others are additive follow-ups —
the per-backend probe table from the research is recorded in the D-entry for future use).

---
# v4 ADDENDUM (owner direction round 2: fallbacks · output budgets · reasoning — FINAL, supersedes where it touches v3)

## A. ModelRef extension (THE structural ruling — code-truth-settled)

`ModelRef` (domain/agent.py:22-29) gains DECLARED fields (no extra="allow" — must declare;
docstring updated "pointer + call config"):
- `max_tokens: int | None = None` — the output budget; flows as FIRST-CLASS kwargs into
  `stream_chat`/`complete` (the codebase rule: modeled params = kwargs, extra_body = unmodeled
  passthrough only). Both ModelRef consumers benefit: the agent's calls AND the compaction
  summarizer (which today runs uncapped — a free win).
- `reasoning_effort: Literal["off","minimal","low","medium","high","xhigh","max"] | None = None`
  — the universal field ladder (ACA A10 SCHEDULED here; provenance AGENT_CHAT_AUDIT §4 A10).
- `reasoning_tokens: int | None = None` — numeric budget where the backend can express it
  (OpenRouter `reasoning: {max_tokens}`); advisory elsewhere.

**Per-backend translation** (the capability matrix; degradation is SILENT-SAFE by design):
- llama.cpp: `max_tokens` honored · `reasoning_effort` is silently dropped by the server
  (verified) so sending it is harmless; `"off"` ADDITIONALLY translates to
  `chat_template_kwargs: {enable_thinking: false}` (the lever that actually works locally) —
  merged per-call OVER the endpoint's extra_body (agent-derived keys win for that call) ·
  `reasoning_tokens` = advisory no-op locally (per-request budget doesn't exist; recorded).
- OpenAI-style cloud: `reasoning_effort` first-class · the output cap's FIELD NAME varies
  (`max_tokens` deprecated on reasoning models) → `InferenceEndpointCfg.max_tokens_field:
  Literal["max_tokens","max_completion_tokens"] = "max_tokens"` (pi's `compat.maxTokensField`
  precedent — per-endpoint, tiny, declared).
- Rule: NEVER gate behavior on a param taking effect; reasoning stays read via
  reasoning_content-first with <think>-parse fallback (existing).

## B. Fallbacks (free-ride confirmed)

`fallbacks: list[InferenceEndpointCfg]` are FULL endpoint objects → `context_window` +
`max_concurrent_requests` + `max_tokens_field` ride them with ZERO schema work (the
unified-object payoff). The Conf UI already has a fallback list editor (Endpoint/Model/Key
rows) → each row gains a `Context window` input; local/cloud blocks gain the same (two
hand-written render paths, both touched — noted). PUT semantics verified: the fallbacks list
replaces wholesale on save; only api_key is secret-carried by base_url — non-secret new fields
round-trip clean.

## C. The trigger reads the SERVED endpoint's window (upgrades the v2 ruling)

`_record` (inference.py:223-227) additionally stamps `StreamReport.served_endpoint` (the
`chain[served_index][1]` object — a one-line chokepoint addition). Iteration 2+ prices against
the endpoint that ACTUALLY answered (anchor + window from the same serve — consistent);
iteration 1 uses the selected endpoint (unchanged). The v2 "conservative primary" ruling is
superseded by exact truth.

## D. The output reserve (opencode-pattern, their bugs designed out)

`CompactionCfg.reserve_output: bool = True` — when the effective ModelRef has `max_tokens`
set, the trigger line subtracts it: `window × threshold_frac − (max_tokens if reserve_output)`.
Reserved = EXACTLY the configured per-agent value (no global cap, no silent down-clamp — the
two recorded opencode bugs). Unset max_tokens ⇒ nothing reserved (the threshold_frac headroom
is the margin). Threading: `compact`/`should_compact`/`_over_threshold` gain an optional
per-call `reserve_tokens: int | None = None` param (defaulted — every existing caller
unchanged; the session passes `self._agent.model.max_tokens` at its two call sites; the
Compactor stays stateless).

## E. UI additions (v3 §4 extended)

AgentsEditor model block (the `setModel` seam): `Max output tokens` numeric + `Reasoning
effort` Seg (the Backend/Privilege Seg precedent) + `Reasoning tokens` numeric (cloud-only
semantics noted in the row desc). FE `ModelRef` interface gains the declared fields (no index
signature — typed). Inference group: `Context window` on local/cloud + per-fallback-row.

## F. Recorded facts for the build

No `temperature`/sampling knobs exist anywhere (nothing to align with) · reasoning is
currently read-only (ReasoningPart, dropped at assembly — unchanged) · A10 is formally
scheduled into this slice · deep_merge list-wholesale + secret-carry semantics pinned for the
settings tests · ModelRef docstring + useAgents types updated in the same wave.
