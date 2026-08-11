# Default-Prompts Audit (PR)

> **What this is.** A code-verified inventory of **every model-facing prompt ctrl-b ships**, each
> classified by how the owner can change it (config.yaml · Conf UI · on-disk file · hardcoded), and
> the gaps that classification exposes. Finding ids are **PR-#**.
>
> **Commissioned by the owner, 2026-08-11:** *"audit deeply the default prompts, where they are, and
> how to change them easily — I feel like the defaults might need some work and/or easy
> editing/modifying, but I'm not sure every one of them is handled in some way or another."*
>
> **Status:** v1.0 — inventory complete, **no code written**. §5 carries a shape proposal, **not yet
> ruled**. Peer evidence for the proposal lives in
> [`research/R27-peer-prompt-configurability.md`](./research/R27-peer-prompt-configurability.md).
>
> **Method:** AST sweep over all of `backend/app` — every `ast.Constant` string ≥80 chars **plus
> reconstructed `ast.JoinedStr` (f-strings)**, minus docstrings — then module-by-module reading to
> separate a real *prompt* from an ordinary string, then each traced to its editing path in
> `config.py`, the API routers and the frontend. *(Grep was inadequate and the reason is worth
> recording: searching the obvious phrasings — `You are`, `You must`, `Your task` — returns **one
> hit** in the entire backend. Prompt text here does not announce itself.)*

---

## 1. The classification

### Class A — fully handled: config → UI → restore-to-default

Exactly one prompt is in this class, and it is done well.

| Prompt | Where | Editing path |
|---|---|---|
| **`DEFAULT_SYSTEM_PROMPT`** (1,729 ch) | `services/agent/session.py:118` | Three-level chain in `_system_prompt()` (`session.py:479`): `AgentDef.prompt` (SOUL.md) → `inference.system_prompt` → baked default. Additive axis via `_appends()` (7e-a): `inference.system_prompt_append` + per-agent `AgentDef.prompt_append`, with an `inherit_append=False` opt-out. Conf UI at `ConfTab.tsx:1780-1805` (both fields, fullscreen editor). `GET /api/agent/default-prompt` (`api/agent.py:1325`) serves the baked text so the UI can offer *Load default* / *Restore default*. |
| **Per-agent persona** | `$CTRLB_HOME/agents/<name>/SOUL.md` | File-backed, edited in `AgentsEditor.tsx`; the default agent maps to the workspace root `SOUL.md`. |

**This is the reference standard the rest of the audit measures against** — and per R27 §④ the
`default-prompt` endpoint is a feature the peer field keeps *asking for and not building*.

### Class B — handled at the top level, frozen one level down

| Surface | Editable? |
|---|---|
| Tool **descriptions** (`@action(description=…)`, 15 literals / 4,834 ch) | ✅ `tool_overrides.{tool}.description` → `runtime.apply_tool_overrides` mutates the live spec; click-to-edit in `ToolCatalog.tsx:184`; originals captured on `app.state.tool_spec_orig` so clearing restores the compile-time default. |
| Tool **parameter** descriptions (`Field(description=…)`, 48 literals / **5,420 ch**) | ❌ **none** — see PR-1. |

### Class C — hardcoded, model-facing, no path of any kind

Grouped by role, because the groups want different answers.

**C1 — injected context framing** (assembled into the prompt every turn)

| Prompt | Location |
|---|---|
| Memory-block intro (*"Context you carry across sessions…"*) | `services/agent/memory.py:151` |
| Consolidation nudge (*"Consolidate before adding more…"*) | `services/agent/memory.py:159` — gated on `consolidation_nudge`, text baked |
| Fleet-roster preamble (*"Fleet roster - use the `id` as the tool argument…"*) | `services/agent/session.py:538` |
| Skills note (*"The following skill instructions apply to this task — follow them:"*) | `services/agent/skills.py:207` |

**C2 — mid-turn behavioural steering** (injected as tool results / system messages by the loop)

| Prompt | Location | Coupled to |
|---|---|---|
| Wrap-up nudge (*"You have done enough tool work… Do NOT call any more tools"*) | `session.py:1766` | the dead-end/iteration-cap path |
| Question-declined | `session.py:2316` | `_DISMISS` resume path |
| Rejection notice | `session.py:2326` | owner-reject resume path |
| Denial echo | `session.py:2353` | `_LoopGuard.denied_sigs` |
| Repeat-suppressed | `session.py:2364` | `_LoopGuard.counts` / `max_repeat` |
| Per-tool cap (interpolates tool + count) | `session.py:2373` | `_LoopGuard.tool_counts` / `max_per_tool` |
| `UNATTENDED_JUDGEMENT_ANSWER` | `session.py:113` | the `question_policy: use_default` ladder (§D-3, council ruling R-1) |
| Reflection nudge (interpolates `reflection_interval`; `state` clause gated on `state_enabled`) | `session.py:513` `_reflection_nudge()` | D27-C |

**C3 — the summarizer** (a second system prompt, for a second model call)

| Prompt | Location |
|---|---|
| `_SUMMARIZER_SYSTEM` (388 ch) + `_SUMMARIZER_SECTIONS` (the fixed five-section contract, D42 Wave 3) | `services/agent/compaction.py:57,64` |

### Class D — checked and correctly excluded (not prompts)

SQL statements (`db.py`, `services/events.py`, `automations/repo.py`), config-migration messages
(`config_migration/`), the memory-repo `.gitignore` template (`memory_backup.py:33`), error/log
format strings, `TRUNCATION_NOTICE` / `OUTPUT_CLEARED_PLACEHOLDER` / `COMPACT_TOO_SMALL` (context
placeholders, not instructions).

### Class E — verified prompt-free

`services/agent/routing.py` and `selector.py` (keyword-driven, no LLM prompt) · the entire voice/STT
path (`adapters/voice.py`, `api/voice.py` — **zero** prompt injection) · automations
(`services/automations/` — an automation's `prompt` is owner-authored *data*, not a default).

---

## 2. Findings

### PR-1 — Tool parameter descriptions are unreachable, and they are the larger half `HIGH`

`core/tool.py:271` sends `"parameters": t.spec.raw_schema or t.spec.input_model.model_json_schema()`
— the schema is generated straight from the Pydantic model and **`apply_tool_overrides` never touches
it**. The override seam exists and stops exactly one level short of the text that does most of the
teaching:

| Module | Param-description text | What it teaches the model |
|---|---|---|
| `automation_tools.py` | 1,077 ch | cron syntax, thread modes, timezone semantics |
| `memory_tool.py` | 1,012 ch | which store means what, `old_text` uniqueness rules |
| `question.py` | 804 ch | the unattended default/choices ladder |
| `terminal.py` | 635 ch | 14 fields |
| `skill_tool.py` | 517 ch | SKILL.md frontmatter contract |

**5,420 ch across 48 literals — more model-facing text than the 4,834 ch of tool descriptions the
owner *can* edit.** If a tool misbehaves because of how a *parameter* is described, there is no lever
short of a code change and a release.

⚠ **R27 §3 is a negative finding here:** no in-class peer overrides parameter descriptions, and the
MCP-proxy tooling that claims to documents no addressing scheme. Building this means inventing, not
following. That is permitted — but it must be argued on our own merits.

### PR-2 — The summarizer prompt is the sharpest internal inconsistency `HIGH`

`CompactionCfg.summarizer` is a full `ModelRef` (`domain/agent.py:117`) — D11 makes the summarizer
model **independently selectable**, and `window` / `threshold_frac` / `reserve` / `max_tokens` /
`reasoning_effort` / `_SUMMARIZER_MARGIN_FRAC` are all tunable. So the owner can point compaction at
a completely different — likely smaller, local — model, **and cannot touch the prompt it runs.** A
five-section contract that a 27B model honours and a 4B model ignores has no remedy.

`/compact <instructions>` exists (`compaction.py:671` signature, appended at `:684`) but only on the *manual*
path only; it is a steer, not a durable override. Automatic compaction — the case that actually
matters — cannot be influenced at all.

**LibreChat ships precisely this lever** (`summarization.prompt` + `updatePrompt`, beside
`provider`/`model`/`parameters`), and **goose ships `compaction.md`** as a drop-in override. This is
the one gap where the peer field is unambiguously ahead of us (R27 §1).

### PR-3 — Eight steering nudges the owner cannot see `MED`

The C2 group is instruction text the model receives on ordinary paths, documented nowhere and
surfaced nowhere. Note the asymmetry: `DEFAULT_SYSTEM_PROMPT` gets a dedicated endpoint *so the UI
can show it*, while these are invisible.

**Visibility and editability are separable here, and should be separated.** These are coupled to
`_LoopGuard` state, the confirm/resume machinery and the `question_policy` ladder; a badly-edited
nudge degrades the loop guard rather than the tone. R27 §⑥ records aider refusing system-prompt
overrides across four issues for exactly this coupling reason, steering users to an append-only
conventions file instead. *Read-only exposure first* is the defensible move.

### PR-4 — The reflection nudge is half-configurable `MED`

`_reflection_nudge()` (`session.py:513`) reads `reflection_interval` and gates its `state` clause on
`state_enabled` — **its numbers come from config, its words do not.** The clearest case of a prompt
we already agreed is tunable, but only numerically.

It also demonstrates PR-6: exposing it as a plain string would silently drop the interpolation.

### PR-5 — There is no inventory `LOW`

Nothing in `docs/` lists what prompts ctrl-b sends. This document is the first. The main prompt is
described in DESIGN; the other ~12 are discoverable only by reading `session.py`, `compaction.py`,
`memory.py` and `skills.py`.

### PR-6 — Any exposed prompt that interpolates needs placeholders `CONSTRAINT`

Not a defect — a design constraint on every fix. The reflection nudge (`reflection_interval`,
conditional clause) and the per-tool-cap nudge (tool name, count) are *assembled*, not literal.
Exposing assembled prompts without a template syntax silently drops the values. R27 §③: goose uses
Jinja2; open-webui ships `{{MESSAGES}}` with selectors. **Whatever we expose must either be
placeholder-free or carry a documented placeholder set.**

---

## 3. Priority map

| Finding | Severity | Why |
|---|---|---|
| **PR-2** summarizer prompt | HIGH | Selectable model + frozen prompt is incoherent; peers ship the lever; smallest surface. |
| **PR-1** param descriptions | HIGH | Largest body of frozen model-facing text; seam already exists. ⚠ no peer cover. |
| **PR-4** reflection nudge | MED | Half-done already; trivial once a mechanism exists. |
| **PR-3** steering nudges | MED | Visibility cheap and safe; editability is a separate, arguable call. |
| **PR-5** no inventory | LOW | Closed by this document; keep it current. |
| **PR-6** placeholders | — | Gates PR-4 and parts of PR-3. Settle before building. |

---

## 4. What the peer field does (summary — full dossier in R27)

- **Nobody exposes one prompt and stops.** goose ships **10** overridable templates (`system.md`,
  `compaction.md`, `subagent_system.md`, `session_name.md`, `permission_judge.md`, …);
  open-webui exposes **7** task prompts. Our shape — one handled, twelve invisible — is the shape
  both projects moved away from.
- **Full replacement is the universal semantic**, always paired with a warning, and it has a
  documented cost: an overridden prompt is **frozen at the version you copied**. This is the
  argument for keeping our existing *append* axis beside any replace axis.
- **"Show me the default" is the field's unsolved UX problem** (open-webui #7024 and #14173, both
  unresolved; the workaround is "go read `config.py`"). **ctrl-b already solved it for one prompt.**
- **aider is the principled counter-case**: refuses overrides across four issues, points users at an
  append-only conventions file. Evidence that *visible-not-editable* is legitimate for PR-3.

---

## 5. Proposed shape — NOT RULED, for the owner's decision

Two candidate mechanisms, both of which have precedent **inside ctrl-b already** (which is why this
is a real decision and not a default):

**Option A — a unified config map.** `prompts: {<stable_id>: {override?, append?}}` in `config.yaml`,
generalizing the base+append axis the main prompt already has. Resolution mirrors `_system_prompt()`:
`override` → baked default, with `append` emitted after. `GET /api/prompts` returns
`[{id, label, default_text, current, placeholders}]` — a direct generalization of
`GET /api/agent/default-prompt`, which is what makes *Load default* / *Restore default* work for the
whole class. Conf reuses the existing fullscreen prompt editor + `promptPreview` (already shared by
`ConfTab` and `AgentsEditor`).

**Option B — a drop-in prompts directory.** `$CTRLB_HOME/prompts/<id>.md`, goose's pattern; the
filename *is* the key, no schema needed. ctrl-b already reads prompts from disk (SOUL.md) and skills
from folders, so the precedent is genuine.

**Recommendation: Option A**, on three grounds. (1) It routes through the one chokepoint that already
provides validation, atomic write, cross-device sync and live reload — `Settings` → `PUT
/api/settings` deep-merge → `runtime.reconfigure`, which already watches `tool_overrides` and would
watch `prompts` the same way; Option B needs a new discovery + reload story that SOUL.md only escapes
because it is re-read per turn. (2) It satisfies the standing extend-don't-migrate directive exactly
— **one** per-item object per prompt id, so the next dimension (per-agent prompt overrides, say) is
an additive optional field, never a sibling map. (3) It keeps `default_text` server-served, which is
the part the peer field demonstrably fails to ship.

**Scoping proposal, by coupling** (R27 §⑥):

| Tier | Prompts | Treatment |
|---|---|---|
| 1 | C3 summarizer (PR-2); C1 memory intro, consolidation nudge, roster preamble, skills note | editable (`override` + `append`) |
| 2 | C2 steering nudges (PR-3) | **visible via `GET /api/prompts`, read-only** — editable only on a later ruling |
| 3 | C2 reflection nudge (PR-4) | editable **once PR-6 placeholders are settled** |
| 4 | Param descriptions (PR-1) | **separate decision.** If built: an additive `params: {field: text}` on the existing `ToolOverride` object, applied in `to_openai_tools` after `model_json_schema()` — never a sibling map. ⚠ no peer precedent (R27 §3). |

**Open questions for the owner:** (a) Option A or B? (b) Is Tier 2 read-only acceptable, or do you
want the nudges editable too? (c) Is PR-1 worth building given no peer does it — or is folding the
load-bearing param text into the (already editable) tool description the cheaper answer?
