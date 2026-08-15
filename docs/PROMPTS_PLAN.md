# The Prompt System (Phase 18) — plan of record

> **Status: design RULED by the owner 2026-08-15 (in conversation) — council round pending, then the
> D56 lock.** No code yet. This document is the spec the build follows; the evidence behind every
> choice lives in [`PROMPTS_AUDIT.md`](./PROMPTS_AUDIT.md) (the PR-# inventory) and the dossiers
> [R27](./research/R27-peer-prompt-configurability.md) ·
> [R30](./research/R30-peer-prompt-system-internals.md) ·
> [R31](./research/R31-prompt-eval-harnesses.md) ·
> [R32](./research/R32-prompt-file-formats.md).
>
> **The owner's directive, verbatim (2026-08-15):** *"I want to be able to edit the prompts because I
> want to test if certain instructions are better than others … a well organized way to do it and not
> just doing half of them and the other half are hardcoded … ideally I would like to be able in the
> future to test the performance of the agentic workflow, and testing the prompts themselves is a
> main thing … the testing is gonna be done with an LLM, but I would like to see the prompts and edit
> the prompts literally by hand if I want to."*

---

## 1. Goal

Every model-facing prompt ctrl-b ships (the ~13 in PROMPTS_AUDIT §1: the C1 context framers, the C2
steering nudges, the C3 summarizer — the main system prompt keeps its existing richer 3-level chain)
becomes: **visible** (one API lists them all with their defaults), **editable** (override + append,
hand-editable in `config.yaml` or the Conf UI), **restorable** (delete-the-override semantics), and
**testable** (every run can be attributed to the exact prompt text that produced it). Structurally —
not by policy — no future prompt can be added invisibly.

## 2. The design

### 2.1 The registry module (the chokepoint)

A new `backend/app/services/agent/prompts.py` owns every default text:

```python
@dataclass(frozen=True)
class PromptDef:
    id: str            # stable, e.g. "summarizer", "wrapup_nudge", "memory_intro"
    label: str         # Conf UI display name
    description: str   # what it does + coupling warning where relevant (the C2 nudges)
    default: str       # THE text — moved here from session.py/compaction.py/memory.py/skills.py
    # placeholder set is DERIVED from `default`, never declared (R30: Codex's pattern — can't drift)

REGISTRY: dict[str, PromptDef] = {...}

def resolve(id: str, settings: Settings, ctx: dict[str, str] | None = None) -> str: ...
```

Use sites call `resolve()` and nothing else. Resolution: `prompts[id].override` (else `default`) +
`"\n\n" + prompts[id].append` (if set), then placeholder rendering. This generalizes the
`_system_prompt()`/`_appends()` chain the main prompt already has (PROMPTS_AUDIT Class A).

**`resolve()` is infallible.** A broken override (render failure of any kind) falls back to the baked
default *inside* the chokepoint with one `log.warning` — use sites always receive a usable `str`.
(R30: goose's `Result`-returning resolve let three call sites invent three degradations, one silently
swapping a 1,232-char system prompt for a 62-char literal.)

### 2.2 Storage — the `prompts:` config map (Mechanism A, ruled)

```yaml
prompts:
  summarizer:
    override: |            # full replacement of the default (optional)
      ...
    append: |              # emitted after whichever base won (optional)
      ...
```
*(A third `default_hash` field existed pre-lean-round; CUT by §7 L-3.)*

One per-item object per prompt id on `Settings` — the extend-don't-migrate shape, riding the existing
chokepoint end to end (validation → `PUT /api/settings` deep-merge → `runtime.reconfigure`), exactly
as `tool_overrides` does. Ruled over the goose-style file drop-in because: the id must double as the
eval stamp and a file gives no version identity (R31 §5.4); frontmatter-bearing files break eval-tool
loading (R32 §2); and a prompts directory would need its own discovery/reload/sync story (R30
confirms nobody solved staleness for files either). `config.yaml` is itself hand-editable, satisfying
the by-hand requirement; the Conf UI is the assisted path.

### 2.3 Placeholders (PR-6, settled)

- **Syntax: `{{name}}`** — the intersection token of Handlebars/Jinja2/Mustache/Nunjucks (R32).
  Single-brace `{var}` is disqualified: prompts contain JSON examples (probed, `str.format` raises).
- **Engine: none.** An ~8-line stdlib `string.Template` subclass (R32 §4 probe, re-verified on emma
  py3.14): `get_identifiers()` derives the placeholder set from text, `safe_substitute` renders
  lenient, `substitute` strict. Zero-dep is the field's shipping norm (Langfuse's 55-line parser;
  LangChain vendored chevron; Jinja2 = a documented injection surface).
- **Derive, don't declare** (R30: Codex derives; nobody ships a manifest): the served `placeholders`
  list = `get_identifiers(default)`. Unit tests validate **strictly both directions** against our own
  defaults (every derived placeholder is supplied by its call site; no extra keys supplied).
- **Overrides render lenient — unknown `{{placeholder}}` stays LITERAL** in the output (ruled;
  Langfuse's semantic): a typo is visible to the owner, never silently blanked, never a failed turn.
- **No conditionals in templates.** Code precomputes conditional clauses (e.g. the reflection nudge's
  `state_enabled`-gated sentence) and passes them as ordinary variables (`{{state_clause}}`, possibly
  empty). Substitution stays substitution.

### 2.4 Whole-class coverage — the C2 nudges are editable too (ruled)

All ~13 prompts register, **including the 8 guard-coupled steering nudges** (the owner's
no-half-hardcoded directive overrides the earlier read-only lean). The aider-style coupling risk
(R27 §⑥) is contained three ways: infallible resolve (worst case = baked default), per-prompt
`description` carrying an explicit coupling warning the UI shows, and one-click restore. The
interpolating nudges (reflection, per-tool-cap) ship with their placeholders per §2.3.

### 2.5 The two features no peer ships (both cheap)

1. **The invisibility guard is a TEST, not the registry** (R30: goose leaks 4,923 chars past its own
   registry — registration is enforced by nothing, everywhere). Promote PROMPTS_AUDIT's AST sweep
   (every `ast.Constant` ≥80 chars + reconstructed f-strings, minus docstrings, across `backend/app`)
   into a pytest in the arch-invariants family: any model-facing string literal outside
   `prompts.py`/the tool specs/an explicit allowlist of non-prompts **fails CI**.
2. ~~**Staleness detection**~~ — **CUT by the lean round (§7 L-3)**: default + current are visible
   side-by-side in the editor, and the append axis (which never goes stale) is the mitigation
   (R27 §②). Recorded as a possible future additive feature, not built.

### 2.6 The API + Conf UI

`GET /api/prompts` → `[{id, label, description, default_text, override, append, current,
is_customized, placeholders, default_changed}]` — the generalization of
`GET /api/agent/default-prompt` (the one everyone asks peers for; only goose ships it, R30 §5).
Writes go through the existing `PUT /api/settings` (plus one prompt-aware server hook — §6 C-4/C-5).
Conf gains a **Prompts** section: list → fullscreen editor (reusing `PromptRow` + the global
`PromptModal`, extended with a second textarea for `append` — §6 council correction: `promptPreview`
is a one-line summarizer, not the editor), *Load default* / *Restore default* (restore = **delete the
key**, never a stored copy — goose's semantics), staleness badge. UI contract details: §6 C-18.

### 2.7 The eval seams (built now) vs the harness (later phase)

Built in this phase — the two seams R31 verified against real harness requirements:

- **Prompt-identity stamping (shape per §7 L-2)**: every resolved prompt has `name` = registry id
  and `version` = the hash of its **effective template before substitution** (C-8). The stamp rides
  as **nullable metadata on the persisted message** each model call produces (assistant messages;
  the compaction summary message for the summarizer) — the additive-JSON pattern `invalid_raw`
  already uses; NO new tables this phase (C-7/C-25 defer to the harness phase). Field names follow
  the OTel GenAI attribute registry (`gen_ai.prompt.name` / `gen_ai.prompt.version`) — **adopt the
  names, not OTLP spans** (semconv is status Development; Codex's posture, R31 ⑭).
- **Transcripts stay authoritative**: messages + tool calls/results already persist in SQLite; the
  stamp makes them attributable.

**The metric set (R31 addendum ⑯–⑳, folded 2026-08-15).** The owner's named metrics are
standardized instruments verbatim: OTel defines `gen_ai.invoke_agent.inference_calls` and
`gen_ai.invoke_agent.tool_calls` (per-invocation Histograms, *failures included*; sub-agent calls
count against the child, never double). Tool-failure rate is **derived** — the `error.type`-tagged
share of tool executions — not its own instrument; the standard deliberately has no cost/retry/
step-count instrument (the app's job). The run-record shape to build toward is aider's leaderboard
row: outcome + behavioural counters + tokens + seconds + cost **+ the stamp of what produced the run**
(aider stamps `commit_hash`/`versions`; ours is the prompt id/hash set, §above). "Steps over optimal"
is not worth a golden-path label per scenario — every shipped tool replaces it with an LLM judge
(DeepEval `AlignmentScore`). Loop-guard triggers (repeats, denials, per-tool-cap hits) have field
precedent as published counters (aider's `user_asks`/`lazy_comments`) but are **ambiguity signals —
diagnostics beside the outcome, never the score**; and efficiency only means anything *paired with
success* (fewer LLM calls on a failed run is not an improvement — outcome first, cost second).

**Post-hoc vs live capture — what this build must actually add** (addendum ⑲, checked against the
code 2026-08-15): counts, wall time, trajectory checks and all judged metrics fall out of the stored
transcript. Of the addendum's two live-capture requirements:

- **Typed tool outcome — LARGELY BUILT, claim scoped honestly (§6 C-13).** `ToolResult.state:
  RunState` (terminal states `OK/ERROR/DENIED/SKIPPED/TIMEOUT/CANCELLED`, domain/result.py:28 +
  enums.py:56) persists on every `ToolResultPart`; `invalid_raw` (ACA-13) marks malformed-JSON
  model-fault calls. What is queryable per run TODAY = terminal-state counts + invalid_raw + (after
  Slice 0) the M1-guard denials by their fixed registry id. Unknown-tool and schema-validation
  failures persist as DENIED/ERROR *without* a model-fault marker — a full `cause` taxonomy is
  DEFERRED until the harness phase proves a need (recorded non-build). No new capture in Slice 2
  beyond documentation + a query test.
- **Per-call token usage — the one real gap.** `StreamReport.prompt_tokens` is observational log
  telemetry (ACA-18), not persisted per call, and `include_usage` isn't guaranteed on. Slice 2 adds:
  `stream_options: {include_usage: true}` on streaming chat calls (llama.cpp supports it; known
  final-chunk shape quirk, llama.cpp#15443) + persist `{model, input_tokens, output_tokens}` per
  assistant message. Cost = a later join against a price table, never a capture requirement.

Deferred to the harness phase (its own ROADMAP entry, not this build): the promptfoo-shaped harness —
its `http` provider matches ctrl-b's chat API today; `select-best` + `llm-rubric` with a local judge
via `apiBaseUrl` is llama.cpp-compatible; scenario corpus = 20–50 tasks promoted from real
transcripts, graded on **outcomes, not tool sequences** (Anthropic guidance, R31 ⑪); scripted-tool
mode so eval runs never touch real hosts; per-run report = the aider-row shape above.

### 2.8 Ruled out / recorded seams

- **PR-1 (tool parameter descriptions): won't build.** No peer precedent (R27 §3; opencode drew the
  identical line, R30 §4). Remedy = fold load-bearing param text into the (editable) tool
  description. If a concrete case ever defeats that: the seam is an additive `params: {field: text}`
  on the existing `ToolOverride`, applied after `model_json_schema()` — never a sibling map.
- **No prompt-variant convention on disk** (R32 §3: nobody has one; git is the history; the harness
  owns comparison).
- **No template engine dependency**; revisit only if a future prompt genuinely needs logic.
- The main system prompt + SOUL.md personas keep their existing Class-A chain unchanged; the
  registry covers the sibling class.

## 3. The pre-slice: harness-audit hardening (vault audit 2026-08-14)

The Maia-vault audit (`~/Documents/Maia/60 Audits/2026-08-14-ctrl-b-runtime-agent-harness-audit.md`,
pinned at `e1b10c3` = current HEAD) found 3 MED / 2 LOW in the agent runtime. Main-seat review
2026-08-15 **confirmed M1 and M3 in source**; they ship as a small hardening slice **before** the
prompt build (same files — `session.py`/`subagents.py` — clean base beats interleaved changes):

- **M1 (confirmed):** tool allowlists filter the schemas the model *sees*
  (`for_agent(self._tool_allow)`, session.py:561) but the execution path resolves the model-emitted
  name from the **full registry** (session.py:2176/2419 → `ActionService.invoke` →
  `registry.get(name)`, action_service.py:147). Fix per the audit + main-seat concurrence: one guard
  at the agent-session execution seam rejecting any name outside the effective `for_agent` set
  (preserving core-tool semantics), **not** a global ActionService change (UI/system callers
  legitimately use the full registry) + one negative regression.
- **M3 (confirmed):** `SpawnInput.tasks` has `min_length=1`, no maximum (subagents.py:98) — the
  fan-out cap bounds concurrency, not batch size. Fix: reject `len(tasks) >
  parent.max_concurrent_subagents` before child/thread creation; **reuse the existing cap, no second
  knob** (main-seat concurrence) + cap/cap+1 tests.
- **M2 (RULED, owner 2026-08-15): build the live/linger snapshot class.** The Slice 0 work: ADD the
  active skill ids to the server-owned turn snapshot (captured immediately after skill selection),
  seed `skillsByCall` from it on overlay, and make the server snapshot **authoritative over
  client-supplied ids on resume** (today resume trusts the client payload). Keyed by suspended call
  id; carried through terminal-linger. The persisted-cold-reload class guards a rarer compound
  failure and is NOT built (cold restart = documented fallback: base toolset + one logged warning);
  full contract in §6 C-12.
- **L1/L2 (accepted, measurement-gated):** repeated history reads per iteration + per-token result
  re-pairing — no action without a profiled threshold (audit + main seat agree).
- The pre-task Stop-window observation stays an open question (needs a deterministic interleaving
  repro before it can even be a finding).

## 4. Slice ladder

*(Ladder as re-cut by the council reconciliation §6 — the config READ schema moved into Slice 1
[C-2] and the model-call persistence migration leads Slice 2 [C-19].)*

| Slice | Contents | Gate |
|---|---|---|
| **0 — Hardening pre-slice** | M1 session-local execution guard wrapping BOTH invoke paths (§6 C-11) + its denial constant · M3 batch cap in `spawn_subagents` (§6 C-14) · M2 snapshot build per §3 (§6 C-12) | full gate + tests per §6 (serial/parallel/core/skill-narrowed for M1 · cap/cap+1/zero-side-effects for M3 · suspend→disconnect→recover→resume for M2) + Codex review |
| **1 — Registry + migration + config READ** | `prompts.py` (`PromptDef{default, description?}` per §7 L-8, REGISTRY per the §6 C-1 table as re-read under L-8, plain `resolve(id, settings, ctx)` per §7 L-9, the `{{var}}` renderer, ONE lenient path per §7 L-6) · `PromptOverride{override?, append?}` + `Settings.prompts` (read path) · shared-Settings parameter at the two no-Settings sites · migrate ALL entries incl. the Slice-0 denial texts (frame+data prompts: data CONCATENATED after the frame, L-8) · the no-unresolved-tokens default tests (L-6) · the AST backstop pytest (symbol-keyed allowlist, §7 L-10) | gate + per-id rendered-equality golden tests under pinned contexts (§6 C-16) + fallback tests |
| **2 — API + stamping** | NO migration (§7 L-2) · message-metadata stamping (template hash, §6 C-8) + usage capture (`include_usage` default-on under `extra_body`, §6 C-9; nullable `usage` on the same message metadata) · the one-depth entry replace/delete hook (§7 L-4/L-5: whole-entry PUT, `null` deletes, `""` normalized to absent) · `GET /api/prompts` (`api/prompts.py`, §6 C-23) | gate + temp-config write tests (never the live config.yaml) + entry replace/delete/normalize tests + one mid-turn live-pickup test (§6 C-17) |
| **3 — Conf UI** | Prompts section per §6 C-18 as amended by §7: `PromptRow` list in registry order + two-field `PromptModal` (override + append), restore-by-delete, side-by-side default/current view, derived placeholder list beside the editor (§7 L-7), C2 coupling warnings, batched-map save (`useToolOverrides` pattern) | gate + narrow-viewport (390px) + restore/editor interaction tests |
| **4 — (later, own phase)** | The promptfoo harness: scripted-tool mode, scenario corpus from transcripts, judge config, metrics per the R31 addendum | ROADMAP entry now; not this build |

Process per the standing method: council round (Codex correctness + one adversarial Opus
architecture lens) on this plan **before Slice 0 starts**; D56 locks after reconciliation; each
slice gets its own review; pause for owner eyeball between slices.

## 5. Owner rulings recorded (2026-08-15, in conversation)

1. Mechanism **A** (config map on Settings) over B (file drop-in).
2. **All prompts editable including the 8 C2 steering nudges** — whole-class, no read-only tier
   (supersedes the audit's Tier-2 proposal).
3. Missing/unknown placeholder in an override → **left literal** (visible, never silent).
4. **PR-1 not built**; description-fold remedy + recorded seam.
5. Prompt testing = **seams now, harness later**; efficiency metrics per the R31 addendum
   (tool-failure counts, LLM calls per task — the owner's named metrics — plus the field set).
6. Vault-audit hardening ships as Slice 0 **before** the prompt build; **M2 = the live/linger
   snapshot class (ruled 2026-08-15)**. L1/L2 stay measurement-gated.

---

## 6. Council reconciliation (2026-08-15) — the specification-completeness round

> Owner's charge: *"every single moving thing clear — specify everything beforehand."* Council =
> Codex `gpt-5.6-sol` high (mechanism-contract lens; verdict **SPEC WITH GAPS — 10 BLOCKER / 8
> SHOULD**) + one adversarial Opus 5 high lens (implementer's-questions-per-slice; verdict
> **BUILDABLE WITH THE LISTED DECISIONS**). The reviews interlocked with near-zero conflict; every
> finding is ruled below. C-# entries are **normative** — they amend §2–§4 where they differ.

### C-1 — The registry table (both reviewers, BLOCKER). NORMATIVE for ids, granularity, boundary.

Placeholder sets are indicative here; Slice 1's strict tests pin them against the code.

| id | Source (audit §1) | Placeholders (indicative) | Context supplier |
|---|---|---|---|
| `memory_intro` | memory.py:151 | — | — |
| `consolidation_nudge` | memory.py:159 | `{{pressured}}` | memory pressure list, joined by code |
| `fleet_roster` | session.py:538 | `{{hosts}}` | roster rows serialized by code |
| `skills_note` | skills.py:207 | `{{skills}}` | active-skill blocks assembled by code |
| `wrapup_nudge` | session.py:1766 | — | — |
| `question_declined` | session.py:2316 | — | — |
| `rejection_notice` | session.py:2326 | — | — |
| `denial_echo` | session.py:2353 | — | — |
| `repeat_suppressed` | session.py:2364 | — | — |
| `per_tool_cap` | session.py:2373 | `{{tool}}`, `{{count}}`, `{{max}}` | `_LoopGuard` counters |
| `unattended_answer` | session.py:113 | — | — |
| `reflection_nudge` | session.py:513 | `{{reflection_interval}}`, `{{state_clause}}` | cfg + code-precomputed clause |
| `summarizer` | compaction.py:64 | `{{sections}}`, `{{focus}}` | `_SUMMARIZER_SECTIONS` (tuple KEPT — its test imports it) + `/compact` instructions (empty when automatic) |
| `m1_tool_blocked` | NEW (Slice 0 constant → registered in Slice 1) | `{{tool}}` | the M1 guard |
| `m3_batch_rejected` | NEW (Slice 0 constant → registered in Slice 1) | `{{count}}`, `{{max}}` | the M3 check |

**Granularity ruling** (Opus): where a C2 nudge is a `ToolResult(summary=…, output=…)` pair, the
**registered prompt is the instruction text** (the body the model must obey); the short interpolated
`summary` strings are status labels (UI-facing, <80 ch) and **stay code** — recorded as Class-D-
adjacent, out of registry scope. **Composed-prompt boundary ruling** (Opus): the registry owns the
FRAME text; data assembly (host rows, skill bodies, memory items, section names) stays code and
arrives as placeholder variables. The owner can edit/reorder everything around the data, not the
data serialization itself.

### C-2 — Slice dependency (Codex #2 + Opus). `PromptOverride` + `Settings.prompts` (READ path) move into Slice 1 — `resolve()` must read them from day one; a `getattr` shim would be a forbidden legacy seam. §4 re-cut accordingly.

### C-3 — Resolution semantics (Codex #3 + Opus S6), NORMATIVE table:

- `override`/`append` **absent** = unset. `override: ""` = **intentional emptiness**: the resolved
  text is empty and the use site **skips the injection entirely** — i.e. an empty override is the
  owner's "silence this prompt" lever (⚑ product behavior, flagged to the owner). This deliberately
  DIVERGES from the tool_overrides `""`-clears precedent: prompts have a meaningful empty, tool
  descriptions don't. Whitespace is preserved byte-for-byte otherwise.
- `append` **is placeholder-rendered**, same pass: concatenate (base + `"\n\n"` + append), render
  once with the prompt's full context.
- Render semantics at runtime: `safe_substitute` always — unknown `{{x}}` stays literal (ruled);
  a missing context value for a DEFAULT's placeholder is a code bug caught by Slice 1's strict CI
  tests, and at runtime degrades to the visible literal + one `log.warning` (Opus integration-5).
- Any render **exception**: discard BOTH custom fields, return the rendered baked default, one
  `log.warning` (infallible, per §2.1). Unknown registry id: `KeyError` — a programmer error, never
  an owner-input path.

### C-4 — Restore-by-delete mechanism (both, BLOCKER; S1 confirmed). `deep_merge` (config.py:1705)
only adds/replaces, so: the client sends `{"prompts": {"<id>": null}}`; a prompt-aware server hook
in the settings-apply path consumes the `null` sentinel BEFORE pydantic validation and deletes the
entry from the merged map (atomic write as today). Tested: whole-entry restore + append-only restore.

### C-5 — `default_hash` contract (both; S2 confirmed). **Server-owned**, written by the same C-4
hook whenever a request sets/changes `override` (`sha256`, lowercase hex, over the default template
text). Hand-edited YAML lacking the hash ⇒ `default_changed: null` = "untracked baseline" badge
(3-state: `true`/`false`/`null` — never a false "current"). **Append-only customization is never
stale** — appends ride the live default by construction.

### C-6 — Resolver injection (Opus BLOCKER). A `PromptResolver` bound to the shared live `Settings`
object at the composition root (the same shared-mutation pattern `ActionService._deps.settings`
uses). `Compactor.__init__` gains it as a parameter; `skills_prompt()` gains a parameter from its
session call site. No module-level global.

### C-7 — Stamp/usage storage (both, BLOCKER; S7 confirmed): **one new SQLite table `model_calls`**
(next numbered migration in db.py, the FIRST deliverable of Slice 2): `id, thread_id,
automation_run_id?, kind (main|wrapup|summarizer|subagent), model_requested, model_served,
prompt_stamps JSON ({id: template_hash} of prompts actually rendered into that call),
input_tokens?, output_tokens?, started_at, duration_ms, outcome`. One row per actual model
invocation (summarizer's non-streaming `complete()` included; subagent children stamp their own
rows — the semconv each-call-counted-once rule). Run-level sets/aggregates are derived by query,
never stored. Usage fields nullable (provider may not report).

### C-8 — Hash semantics (Codex #8, AS AMENDED by the confirm round): `gen_ai.prompt.version` =
**sha256 of the effective template BEFORE substitution** (default, or override, +append) — A/B
identity is the template. Codex's second `rendered_hash` stays **overruled** (one field, not two),
but its confirm-round objection to my reconstruction claim was CORRECT — the claim was false once
an override is later edited (config.yaml keeps no history). The loss is closed by C-25 instead:
the template TEXT is retained content-addressed, so exact-text attribution holds; RENDERED values
(roster rows, skill bodies) are runtime data, explicitly not part of prompt attribution (recorded
limitation — they belong to the transcript/events).

### C-9 — `include_usage` (Opus correction + Codex #9): NOT a hardcode — `ModelRef.extra_body` is
already the owner's home for it (config.py:200). Ruling: the adapter requests
`stream_options: {include_usage: true}` **as a default merged UNDER `extra_body`** (owner's
explicit setting always wins); on a 400 that names `stream_options`, retry once without and log.
`StreamReport` gains additive `completion_tokens`/`model` fields feeding the C-7 row.

### C-10 — The AST backstop's honest contract (Codex #10 + Opus): own file
`test_arch_invariants_prompts.py` in the QH-9 family. Sweep = `ast.Constant` str ≥80 ch +
reconstructed `JoinedStr`, minus docstrings, across `backend/app`; failures = any hit outside
`prompts.py` not on the allowlist. Allowlist keyed by `(file, first-64-chars-hash)` and enumerated
with reasons: `@action(description=)` + `Field(description=)` (the Class-B/PR-1 corpus), SQL,
config_migration messages, context placeholders (`TRUNCATION_NOTICE` etc.), `DEFAULT_SYSTEM_PROMPT`
+ the SOUL chain (Class A, out of scope). **The §2.5 "no prompt ever invisible" claim is softened
to "structural backstop"** — a <80-char literal evades the sweep (recorded limitation; the C-1
granularity ruling is why the short summaries are out of scope anyway).

### C-11 — M1 exact contract (both; S8 confirmed): ONE session-local guard function wrapping BOTH
`ActionService.invoke` call sites (serial :2419 + parallel prefix :2176), consulting a name set
computed **at call time** from `registry.for_agent(self._tool_allow)` (skills mutate `_tool_allow`
per turn — never the cached `_tools_cache`; core-builtin semantics preserved by construction). A
miss: NEVER reaches ActionService; persists a `DENIED` ToolResult with the `m1_tool_blocked` text;
**feeds the loop guard's denied-signature path** (a loop of blocked calls still trips the guard);
**emits the audit Event itself** (the guard bypasses ActionService's event write, so it must not
bypass the audit trail); applies **uniformly to resumed calls** (with M2's restored skill set a
legitimately-approved call passes). `_classify_batch`'s pre-committed guard counts stay as-is — a
blocked call consuming loop-guard budget is correct (the model wasted the call); recorded decision.

### C-12 — M2 exact contract (Codex #12): snapshot captured immediately AFTER skill selection
(selector-produced ids included, not just requested ones); copied under every suspended call id;
carried through live + terminal-linger overlays; **server snapshot authoritative over
client-supplied ids on resume** (api/agent.py:176-180/1811-1819 currently trusts the client); cold
restart = base toolset + one logged warning (the ruled non-build). Regression: skill-narrowed
suspend → disconnect → recover → resume asserts exact ids, instructions, and effective toolset.

### C-13 — RunState claim scoped (Codex #13): §2.7 amended in place — terminal counts + `invalid_raw`
+ M1-guard denials are queryable; a full `cause` taxonomy is a recorded DEFERRED non-build.

### C-14 — M3 exact contract (both): the check lives in `spawn_subagents` (subagents.py:286 — the
schema can't see the parent), BEFORE `resolve_child`; **the cap is the SPAWNING agent's
`max_concurrent_subagents`** regardless of per-task agent names (ruled); over-cap ⇒ one `DENIED`
ToolResult with the `m3_batch_rejected` text, zero children/threads created; the global settings cap
stays where it is (the semaphore) — untouched.

### C-15 — Summarizer overflow guard (Codex #14; S3 confirmed): `compact()` resolves the full system
message FIRST (override/append/focus included) and prices THAT via `estimate_payload_tokens` —
`_SUMMARIZER_MARGIN_FRAC`'s "small fixed template" assumption dies with the freeze.

### C-16 — Acceptance criteria tightened (both; S4 confirmed): Slice 1's gate = **per-id golden
tests: rendered output under pinned contexts equals the pre-migration literal output byte-for-byte**
(not source-byte comparison), plus every C-3 fallback path. Slice 0/2/3 test lists are in the §4
table.

### C-17 — Lifecycle/mid-turn ruling (Codex #6 + Opus integration-1/2): **per-model-call live
resolution is the semantic.** C1 head prompts freeze per turn via the existing `_static_head`; C2/C3
resolve at injection time; an edit mid-turn simply applies from the next resolve — safe because
stamping is per model call (C-7), so a mixed-version turn is *represented, not hidden*. Prompts do
**NOT** join the tool_overrides mid-turn 409 gate (that gate protects live spec mutation; prompt
reads are snapshot-per-call). "Reconfigure wiring" is struck from Slice 2: `apply_settings_inplace`
already makes the shared Settings live and `resolve()` reads it per call — **no cache exists, so no
invalidation exists**; one test proves live pickup.

### C-18 — UI contract (Codex #16 + Opus Slice 3): registry order; unknown config ids preserved +
warned in `GET /api/prompts`; `current` = the effective unrendered template; **the §2.5 "diff" is
softened to a side-by-side default/current view for v1** (no diff library exists; recorded — a real
diff is a later nicety); *Load default* copies the default into the override field, *Restore*
deletes override+append+hash (C-4); saves use the ToolCatalog batched-map mutation pattern
(`usePromptOverrides` mirroring `useToolOverrides`, same query-invalidation shape); server
last-write-wins; no 409 gate (C-17); `PromptModal` gains an optional second textarea (append);
coupling warnings render via the existing `.conf-warn`.

### C-19 — Slice re-cut (Codex #18): as applied in §4 — config READ schema → Slice 1; the
`model_calls` migration leads Slice 2.

### C-21 — Empty-override semantics BY PROMPT CLASS (Opus confirm round — fixes a C-3 × C-1
interaction). The single "skip the injection" rule was wrong for composed prompts. Three classes,
assigned in the C-1 table at build:

- **Pure nudges** (the C2 eight + `m1_tool_blocked`/`m3_batch_rejected`): empty ⇒ the injection is
  skipped entirely — the silence lever as ruled.
- **Frame+data prompts** (`fleet_roster`, `memory_intro`, `skills_note`, `consolidation_nudge`):
  empty ⇒ the FRAME text is omitted; the DATA is untouched — **prompts own words; features own
  data** (whether memories/roster/skill-instructions inject at all is governed by their existing
  feature toggles, never by prompt emptiness — an empty `skills_note` must not un-inject skill
  instructions).
- **Required prompts** (`summarizer`, `unattended_answer` — a model call/resume cannot proceed
  without them): empty ⇒ **fall back to the default** + one `log.warning` (an empty summarizer
  system prompt is a garbage summary, not silence).

### C-22 — Omitted-placeholder warning (Opus confirm round). Leave-literal (C-3) only covers
*unknown* names; an override that DROPS a declared placeholder (`{{hosts}}`, `{{sections}}`)
silently deletes the data it carried. Contract: the C-4 save hook AND `GET /api/prompts` both warn
when an override/append pair omits a placeholder the default declares — via the existing PUT
`warnings` envelope and a per-entry `warnings` field respectively. **Warnings, never rejection**
(the owner is never blocked; feedback is visible). Save-time validation beyond this: pydantic type
errors 422 as everywhere; no size cap (single user; the dangerous case is priced at run time by
C-15).

### C-23 — Endpoint placement (Opus confirm round). `GET /api/prompts` lives in a new small
`api/prompts.py` router (registry-scoped, not agent-def-scoped). `GET /api/agent/default-prompt`
SURVIVES unchanged (Class A; ConfTab depends on it). The main system prompt does NOT appear as a
row in `/api/prompts` — it has its own richer UI; a duplicate read-only row invites confusion
(recorded). Also per the confirm round: `m1_tool_blocked` gets the C2 coupling-warning treatment in
its C-1 `description` (owner-editable AND on the loop-guard path).

### C-24 — Field-level deletion (Codex confirm round — fixes a C-3 × C-4 gap). With `""` repurposed
as intentional emptiness (C-3), the null sentinel must work at BOTH depths:
`{"prompts": {"<id>": null}}` deletes the whole entry (full restore);
`{"prompts": {"<id>": {"append": null}}}` (or `"override": null`) deletes just that field —
so override+append → append-only, or dropping an append while keeping the override, is one atomic
PUT. The C-4 hook consumes nulls at both depths pre-validation; deleting the last field deletes the
entry (and its `default_hash` when `override` goes). Tested both depths + the last-field collapse.

### C-25 — The content-addressed template store (Codex confirm round — restores exact-text
attribution). One append-only table beside `model_calls` in the same migration:
`prompt_texts(hash TEXT PRIMARY KEY, text TEXT, first_seen_at)`. Insert-if-absent whenever a stamp
sees a hash for the first time (rare — only on default changes or owner edits). `model_calls.
prompt_stamps` hashes join against it, so "what exact text produced run X" survives any later edit
of the override — the §1 attribution requirement holds without weakening. Rendered runtime values
stay out of scope (C-8). Build invariants (Codex re-confirm): a hash must never map to differing
text (assert on insert), and the text row persists before — or transactionally with — the
referencing `model_calls` row.

> **Council CLOSED 2026-08-15:** Opus confirm = RESOLVED WITH REMARKS (folded as C-21..C-23) ·
> Codex confirm = UNRESOLVED ×3 (folded as C-24/C-25 + the §2.7 alignment) · Codex re-confirm =
> **RESOLVED, no new defects**. The three-way in-line requirement is satisfied; next = the D56 lock.

---

## 7. Lean round (2026-08-15, owner-charged) — NORMATIVE; supersedes §2/§6 where they conflict

> Owner: *"make sure it's clean code without many complexities that can bite us long-term."* One
> Codex round briefed to argue ONLY for cuts (the D55 pattern) returned 11 candidates, verdict
> **BUILD WITH THE LISTED CUTS**. Main-seat rulings below (bias correction inverted: a cuts-briefed
> reviewer over-cuts — each overrule names the stated requirement the cut would sever).

**ACCEPTED CUTS (L-# = the ruling of record):**

- **L-3 — staleness CUT** (Codex #3): `default_hash`, `default_changed`, the 3-state badge, and the
  hand-edit baseline semantics are GONE (supersedes C-5 and the §2.5 item 2). Default + current stay
  visible side-by-side; drift is manually comparable; the kept append axis is the real staleness
  mitigation (appends never go stale).
- **L-4 — one-depth replace/delete** (Codex #4, main-seat candidate): supersedes C-4/C-24. The UI
  always PUTs the complete `{override?, append?}` entry; `{"prompts": {"<id>": null}}` deletes it.
  No field-level sentinel. Empty-string fields are normalized to absent by the hook (see L-5).
- **L-5 — intentional-empty semantics CUT** (Codex #5): supersedes C-3's `""` lever and ALL of
  C-21. Blank = unset, everywhere; restore = deletion; no per-class empty behavior, no
  summarizer-empty hazard. If the owner ever wants to silence a nudge, that is a future additive
  `enabled: false` field (extend-don't-migrate) — recorded seam, not built.
- **L-6 — one lenient render path** (Codex #6): supersedes C-3's strict/lenient split. `safe_substitute`
  is the only runtime path; defaults are validated by ONE test shape — pinned-context render leaves
  no unresolved `{{token}}` — and extra context keys are harmless (no both-directions matrix).
- **L-7 — omitted-placeholder warnings CUT** (Codex #7): supersedes C-22. `GET /api/prompts` serves
  the derived placeholder list; the editor displays it beside the text; omission is an owner-authored
  choice. No warning plumbing in PUT or GET.
- **L-8 — PromptDef shrunk + data concatenated, not routed** (Codex #8): `PromptDef = {default,
  description?}`; id is the key, label derived. **Frame+data prompts drop their data placeholders**
  (`{{hosts}}`/`{{skills}}` etc.): code appends the assembled data AFTER the rendered frame.
  Placeholders survive only where interpolation is genuinely mid-text: `per_tool_cap`,
  `reflection_nudge`, `consolidation_nudge`, `summarizer` (`{{sections}}`, `{{focus}}`),
  `m1_tool_blocked`, `m3_batch_rejected`. The C-1 table's placeholder column is re-read under this
  rule at build.
- **L-9 — no `PromptResolver` class** (Codex #9): supersedes C-6's wrapper. A plain
  `resolve(id, settings, ctx)` function; `Compactor.__init__` and `skills_prompt()` receive the
  shared `Settings` reference as an ordinary parameter.
- **L-10 — symbol-keyed AST allowlist** (Codex #10): supersedes C-10's `(file, first-64-char-hash)`
  keying. Structural exclusions + readable `(file, symbol)` exceptions; a copy edit no longer churns
  an opaque hash list.
- **L-2 — the eval tables DEFERRED; stamping rides messages** (Codex #2, adapted): supersedes
  C-7/C-25. NO `model_calls`, NO `prompt_texts`, NO migration in this phase. The seam =
  **nullable metadata on persisted messages** (the additive-JSON pattern `invalid_raw` already
  uses): each persisted assistant message — and the compaction summary message the summarizer
  writes — carries `{prompt_stamps: {id: template_hash}, usage: {model, input_tokens,
  output_tokens} | null}`. Every model call ends in some persisted message; failed calls lose
  usage (nullable, accepted). Counts the owner asked for (LLM calls / tool calls / failures per
  task) are already post-hoc derivable from the transcript (R31 ⑲). **§1's attribution wording is
  WEAKENED accordingly** (Codex's own earlier alternative): run identity = template hash; exact-text
  recovery for organically-edited overrides is guaranteed only from the harness phase onward, which
  adds the content-addressed text store (C-25's shape, deferred there) and records its own variants.

**OVERRULED (kept, with the severed requirement named):**

- **L-1 — `append` STAYS** (Codex #1 rejected). The owner's primary experiment is "add an
  instruction, see if it helps" — append IS that lever without freezing the base; R27 §② is
  emphatic that full replacement freezes you at the copied default and names append as the field's
  mitigation (aider treats it as THE answer); and the main prompt's existing chain already has the
  axis — cutting it here would make the registry LESS uniform, not simpler.
- **L-11a — usage capture STAYS** (Codex #11, partial reject). `include_usage` default-on-under-
  `extra_body` + the nullable usage metadata (L-2) ship now: per-call usage is the one thing R31 ⑲
  verified CANNOT be reconstructed later, and the owner explicitly named token/efficiency
  measurement as a goal — the runs between now and the harness are his dataset.
- **L-11b — the §2.7 metrics/OTel prose and the C-13/C-20 ledgers STAY** (Codex #11, partial
  reject): they are documentation with zero runtime cost; the ledgers exist to prevent
  re-litigation, and the field names are the cheap-to-adopt/expensive-to-retrofit part.

**Net shape after the lean round — the whole feature is five concepts + one seam:** the registry
module · `resolve()` · the `prompts:` config map · `GET /api/prompts` · the Conf editor · message
metadata stamping (+usage). Zero new dependencies, zero DB migrations, no new tables, no classes
beyond `PromptDef`. Adding a future prompt = one registry row + one resolve call.

### C-20 — Recorded non-builds + overrules, for the ledger *(kept last as the closing ledger;
C-21..C-25 above are the confirm-round additions)*: no main-prompt row in `/api/prompts` (C-23) ·
`rendered_hash` overruled (C-8) ·
`cause` taxonomy deferred (C-13) · no prompt-edit audit Event — the per-call stamps already
timestamp every change observably; a settings-edit event type is not invented (Opus integration-4,
ruled) · diff view deferred (C-18) · <80-char sweep limitation recorded (C-10) · `""`-override
divergence from the tool_overrides precedent recorded (C-3, ⚑ owner-flagged).
