# Prompt Order Plan — where each part of the prompt lands: a cache-aware order editor (ROADMAP J3)

> **Status (2026-10-07): ✏️ OWNER-ASKED · NOTHING DESIGNED · NOTHING BUILT.** The plan-of-record STUB for a
> **dedicated design session** — research-first, its OWN session — precise enough for a fresh session (the main seat
> once session B is done, or the owner's other seat in the `ctrl-b-opus` tmux unit) to resume **from this file
> alone**. **NOT the ASR session** (Phase 26 / session B is its own session; J3 touches none of its files). **Separate
> from [J4](./LOREBOOK_PROBABILITY_PLAN.md)** (lorebook probability + cadence) and from J1/J2 — the owner: *"Maybe we
> could separate it in two sessions. One for the prompt ordering, which realistically doesn't have as much to do with
> the lorebook thing. And another for the lorebook thing. They're both tangential issues."* **Timeline (owner,
> 2026-10-07):** *"I want to do it before we update production after session B."* → the prod update that follows
> session B (v1.7.12) **WAITS for J3 and J4** unless the owner re-rules at release time. The owner also: *"I didn't
> want you to start building this feature. This is a very design-driven thing."*

## 0. How to read this

§1 the problem in the owner's words · §2 what the owner wants (the goals and the floor) · §3 the scope inventory
(every code and doc place the session must read, file:line) · §4 the method (research-first → dossiers → design →
council → slices) · §5 constraints and locked decisions · §6 starting evidence · §7 open questions for the owner ·
§8 working rules. When the design is ruled, this file becomes the plan (status line, §4's ladder, a council record
§9) exactly like `MEDIA_MANAGER_PLAN.md` did.

## 1. The problem (owner, 2026-10-07, verbatim where quoted)

- The trigger: ISS-28 (per-turn macros) and ISS-45 (lorebook probability) both change text that today sits in the
  cached HEAD, so a per-turn value re-prefills the whole history on corsair's llama.cpp. The owner's answer was not
  a ruling on those rows but a different shape: *"I was thinking maybe we should implement a different way of doing
  this. SillyTavern lets you select where to put the prompts, right? So ideally we could have some sort of prompt
  editor where you can drag and drop where each part of the prompt lands."*
- The cache half: *"So parts of the prompt like this that have macros or things that could break the prompt cache
  could be in the tail, you know like the post history instructions kind of thing, so it doesn't break the whole
  prompt cache, it just breaks the tail of the prompt."*
- The ordering half: *"Maybe in tandem with the prompt formatting and the ability to change the ordering of the
  different fields in the prompt. SillyTavern does that, but I don't want to overcomplicate it either."*
- The bar: *"That obviously needs a very thorough design and research phase. So it's not just me answering four
  questions. We're gonna have to iterate through this design and this feature in general."* · *"I want rigor and a
  very thorough analysis of how to approach every single part, every nuance and edge case I suggested and any other
  you could think of."* · *"I want to design this in a very good, non-convoluted, thoughtful way, so it's easy to
  manage as the user and easy to understand."*

## 2. What the owner wants

**Goals:** the owner decides WHERE each part of the prompt lands — at least head vs tail, and the order within each —
from one editor, with drag and drop; a part that changes every turn (a per-turn macro, a rolled lorebook entry) can
be placed where it only breaks the TAIL of the prompt cache; the editor shows which parts are cache-breaking so the
choice is informed; it stays *"easy to manage as the user and easy to understand."* **The floor (the minimum the
session must deliver):** a researched, council-closed design for head/tail placement + order of the parts in §3's
table, the data shape and its fold, the cache contract stated per part, and a slice ladder — or a recorded ruling
that a smaller shape (e.g. a per-part head/tail toggle only) is the design. **Non-goals:** ST's full prompt manager
(*"I don't want to overcomplicate it either"*); new prompt TEXT (the Phase 18 registry owns text); changing what a
part says; per-thread order; touching the voice/ASR path.

## 3. Scope inventory (read before designing)

**The prompt as built today** (`backend/app/services/agent/session.py`, 3,460 lines) — the order is FIXED in code:

| # | Part | Built by | Layer | Changes when |
|---|---|---|---|---|
| 0 | tool schemas | `_tools` L862 (cached per turn, top of the cache hierarchy) | request `tools` | tool set / overrides change |
| 1 | Voice + Duties (one message, two `## ` sections) | `_system_prompt` L665 · `_voice` L644 · `_duties` L659 · `_section` L639 | head | SOUL / duties / registry edit; per turn if it carries a `PER_TURN` macro |
| 2 | scenario | `_scenario` L696 | head | edit; per-turn macro |
| 3 | appends (global `inference.system_prompt_append` + `AgentDef.prompt_append`) | `_appends` L727 | head | edit |
| 4 | roster | `_roster` L816 | head | config |
| 5 | owner persona | `_persona_block` L703 (`persona.py` `resolve_persona` L40) | head | persona edit; per-turn macro |
| 6 | tier-1 memory | `_memory_block` L743 | head | a `memory` tool write (D15 #4 AMENDED: after the roster for this reason) |
| 7 | Core Memory index | `_core_index_block` L763 | head | a tier-2 write that changes the index |
| 8 | active-skill note | `_activate_skills` L877 | head | skill selection per turn |
| 9 | head lorebook block | `_activate_lorebooks` L905 → `scan`/`block` | head, LAST plain block (R65 §9) | the scan, EVERY turn |
| 10 | example dialogue (named pseudo-messages) | `example_messages` (`examples.py`), L1061 | head, structurally last | edit; per-turn macro |
| 11 | history (+ the compaction fold summary, a persisted system message that coalesces with the run) | `_assemble` L1065 · `compaction.py` | messages | every turn (append-only until a compaction) |
| 12 | tail lorebook block | L1168 | tail, ahead of post-history | the scan, every turn |
| 13 | post-history instructions | `_post_history` L719, L1173 | tail | edit; per-turn macro |
| 14 | reflection nudge (one-shot) | `_reflection_nudge` L786, L1182; armed by `_maybe_arm_reflection` L1514 | tail, ephemeral | every `reflection_interval` user turns |

- **The cache machinery:** `_static_prefix` L998 (built once per turn, reused byte-identically per `_drive`
  iteration; its docstring is the cache contract) · `_assemble` L1065 · the per-turn macro context `_macros` L605 /
  `_bind_macros` L618 / the salt minted at L600 (ISS-28) · `macros.py` `SUPPORTED` L386 + `PER_TURN` L409 +
  `per_turn_in` L534 (THE predicate for "this text changes every turn") · `_fmt_cache` L366 + `adapters/inference.py`
  `StreamReport.cached_tokens` L844 / the llama.cpp `timings.prompt_n`/`cache_n` read ~L1519 (the measurement) · D62's
  per-call record (`model_calls`) where `cached_tokens` persists.
- **The wire shaping that constrains any reorder:** `adapters/inference.py` `normalize_system_messages` L616 — the
  LEADING run of system messages coalesces into ONE (strict templates, R41/R42); a `name`-carrying system message
  terminates the run (why the examples must stay last, D70 §4.2 Emma F1); ANY later system message is re-roled to a
  `user` `<system-update>` IN PLACE. **So "move a part to the tail" also changes its ROLE on the wire** — a stated
  consequence the design must own, not discover.
- **Docs that already ruled parts of this:** DECISIONS **D15 #4** (+ its 2026-07-20 A9 amendment: memory after the
  roster, "prefix caches invalidate from the first changed byte onward") · **D70** + ROLEPLAY_PLAN **§4.1** (Voice +
  Duties, universal, the measured two-section shape R64 §5.4), **§4.2** (per-field emission, empty ⇒ absent,
  post-history as the tail layer, the coalescer rule), **§4.3** (macros), **§6.3–§6.4** (scan at head-build time;
  head block LAST among the plain blocks; tail block before `post_history`) · ROADMAP A9 (the memory freeze REJECTED;
  "measure via `cache_n`/`prompt_n`") · ISSUES **ISS-28** (the owner's 2026-10-06 ruling: accept the per-turn cost,
  warn) + **ISS-45** · DECISIONS **D48** (`cache_prompt: true` rides a model's `extra_body` on the llama.cpp hop).
- **The prompt registry (text, not order):** `services/agent/prompts.py` `REGISTRY` L154 · `resolve` L752 ·
  `resolve_with_template` L705 — the section headings and framings (`voice_heading`, `duties_heading`,
  `persona_intro`, `lorebook_intro`, `duties_agent`/`duties_conversational`) are registry prompts; PROMPTS_PLAN §2
  (the registry, the `prompts:` overrides, the Conf editor) is the authority on text. The owner's *"prompt
  formatting"* lives here today.
- **The editors:** `frontend/src/components/AgentsEditor.tsx` (per-agent fields: `prompt_append` ~L375,
  `example_dialogue` ~L439, `scenario` ~L449, `post_history` ~L459, `FIELD_HELP` ~L85) · the Prompts Conf group
  (`tabs/ConfTab.tsx`) · `domain/agent.py` `AgentDef` (`example_dialogue` L226, `scenario` L229, `post_history` L232).
- **The in-house reorder precedent:** D65 / MEDIA_MANAGER_PLAN (drag reorder, `components/media/LibraryGrid.tsx`) +
  R56 (WCAG 2.2 SC 2.5.7: ↑/↓ buttons are THE conforming reorder pattern; drag = handle-only, `touch-action: none`)
  + R58 (touch drag reorder).
- **The reference convention:** SillyTavern's Prompt Manager (Chat Completion presets: a drag-ordered list of prompt
  parts with per-part toggles, a "relative" vs in-chat-at-depth injection position, and an Author's Note with depth
  and insertion frequency) — **to be read at source** (`public/scripts/PromptManager.js` and its preset JSON), not
  from memory.

## 4. Method (the session's ladder — each rung its own commit)

1. **Research first — buy the findings once, into `docs/research/`** (one Opus lane per dossier, the README's
   conventions: primary sources, verbatim load-bearing quotes, confidence marks, dated, corrections recorded, a short
   separate implications section; next free number after R103). Read R27, R30, R41, R42, R64, R65 (§1.11, §9), R87,
   R90, R103, R56, R58 FIRST — do not re-buy. The questions:
   1. **(R-e, peer prompt ordering)** How do SillyTavern (Prompt Manager, `prompt_order`, injection position/depth,
      Author's Note), RisuAI (its prompt template / formatting order), open-webui and LibreChat order the parts of a
      prompt — and how do they EXPOSE it (drag list? fixed slots? per-character or per-preset?) — read at source.
      What did each choose NOT to make orderable, and why.
   2. **(R-f, cache-aware ordering on llama.cpp)** What exactly breaks the prefix on corsair's llama.cpp (the first
      changed TOKEN, after chat-template rendering — so a change inside the coalesced system message invalidates the
      whole history); what a "tail" is precisely (the parts after the newest history message: what re-prefills when
      the previous turn's tail is removed and the reply is appended — does the previous reply re-prefill?); whether
      `--cache-reuse` / KV shifting changes the answer; what an at-depth injection (ST's in-chat @depth) costs as the
      window slides; the cloud fallbacks' prefix caches. Probe on dev with the existing `cached_tokens` telemetry,
      not by reasoning alone.
   3. **(R-f) The role consequence** — a tail part is re-roled `user` `<system-update>` by the normalizer: how do the
      peer class and the model's chat template treat a tail instruction vs a system instruction (R42 has the field
      shape; does a Qwen-template model obey a tail `<system-update>` the way it obeys `post_history` today — measure
      on the owner's corpus).
   4. **(design) Persistence + migration shape** — global vs per-agent vs both; how an order is stored so it extends
      without migrating (the owner's *"shape data to extend, not to migrate"*: one per-part object with optional
      fields, never a sibling map per dimension); what happens to a saved order when a release adds a part (new
      parts land in a default slot; the fold rule); the D-entry shape.
   5. **(R-g, phone reorder UI)** A reorderable list of ~10–14 parts on a 360 px phone: drag handle + ↑/↓ (R56's
      ruling), a head/tail divider the owner drags across, per-part cache badges, "restore default order"; the
      media manager's drag reorder (D65) is the in-house precedent to reuse, not re-implement.
   6. **(design) Auto vs manual placement** — can the app place cache-breaking parts itself (it KNOWS which text
      carries a `PER_TURN` macro via `per_turn_in`, and which blocks are per-turn by nature: the lorebook blocks, the
      skill note), or does the owner place, with the app only warning (the ISS-28 "warn, don't decide" precedent)?
   7. **(design) Structural constraints** — what can never move (the examples' `name` terminating the coalescing run;
      the Voice/Duties pair as the first message; the compaction summary's position; the reflection nudge as a
      one-shot), and how the editor shows a fixed part.
   8. **(design) Keeping it simple** — the smallest design that answers the owner's need (*"I don't want to
      overcomplicate it either"*): name the candidate shapes (per-part head/tail toggle · one ordered list with a
      divider · ST-style full manager) and their future debt, out loud (the least-future-debt check).
2. **The design** (the main seat, prose, in THIS file): the parts table with each part's cache class and its
   movability; the data shape + its fold; the editor; the cache contract per placement; each deviation from ST named.
3. **Design council** — blind Opus ∥ Emma (the dual-reviewer rule), ground-or-withdraw, rulings recorded in §9.
4. **The slice ladder** (S0…Sn, each reviewed by Opus ∥ Emma on a frozen diff), written here before any build.
   J4's placement question (§5) reads this design's outcome.

## 5. Constraints and locked decisions (do not relitigate)

- **D70** (characters are agents) + ROLEPLAY_PLAN §4.1: Voice + Duties universal, two labelled sections; empty ⇒
  absent (ruling 10). **D15 #4 AMENDED**: volatile blocks after stable ones. The examples-last structural rule (§4.2).
- **ISS-28's ruling (owner, 2026-10-06):** a per-turn macro in head text is ACCEPTED at its cost and WARNED (import
  count line; the editor `WarnRow` hint wanted). J3 may OFFER the tail as the better home; it does not reverse the
  ruling or silently move the owner's text.
- **The prompt cache is a first-class cost** — every placement states what it re-prefills, measured, not asserted.
- **PROMPTS_PLAN (Phase 18):** the registry owns prompt TEXT and its overrides; J3 owns ORDER/PLACEMENT only.
- **No legacy seams** (PERMANENT) + **shape to extend, not to migrate** (CLAUDE.md): any stored order is one
  per-part object; a shape change rides one load-boundary fold + write-back (UPDATE_PLAN).
- **J2's knob discipline** ([CONFIG_DEBLOAT_PLAN](./CONFIG_DEBLOAT_PLAN.md)): any new knob carries its scope sentence
  and names the neighbour it overlaps — J3 must not add the bloat J2 exists to remove.
- **R42's field shape:** one leading system message, unconditional; the normalizer is not re-opened.

## 6. Starting evidence

The owner's corpus (ISSUES ISS-28): 24 book entries use `{{random}}`; 7 of 12 standalone random entries land in the
HEAD; 3 cards incl. 3 greetings use time/date. ISS-45: the scan runs at `_static_prefix` build time, so a rolled
entry would move the head every turn. ROADMAP A9: measure turn-boundary cache hits with `cache_n`/`prompt_n` — the
telemetry exists (`_fmt_cache`, D62). R65 §9: the head lorebook block was put last for the cache. R42: nobody keeps
separate system messages for prefix cache; tail/ephemeral instructions ride as marked `user` text in 5–6 of 7 peers.

## 7. Open questions for the owner (with recommended defaults — confirm or change at the session start)

1. **Global order or per-agent?** *Recommended:* ONE global order to start, stored so a per-agent override is a
   later optional field (shape to extend) — a per-agent order on day one multiplies what the owner must manage.
2. **Auto-placement of cache-breaking parts, or manual?** *Recommended:* manual, with the app MARKING every part
   that changes every turn (a badge from `per_turn_in` + the per-turn-by-nature blocks) and a one-line hint on what
   it costs where it sits — the ISS-28 "warn, don't decide" precedent; no silent moves.
3. **How much can move?** *Recommended:* head ↔ tail placement + order within each for the movable parts; fixed
   parts shown greyed (examples last in the head, Voice/Duties first, the nudge); no in-history @depth slot in v1.
4. **Is "prompt formatting" in J3?** *Recommended:* formatting = the registry's headings/framings, already editable
   (Phase 18); J3 only links to them from the order editor, it adds no second formatting surface.
5. **Per-part on/off toggles (ST has them)?** *Recommended:* no — empty ⇒ absent already covers it, and a toggle
   per part duplicates the field itself (J2's bloat).
6. **The tail role:** accept that a part moved to the tail rides as a `user` `<system-update>` (the normalizer's
   rule), once R-f has measured that the owner's models obey it there?

## 8. Working rules

**NOT the ASR session** (Phase 26 / session B owns `voice_live.py`, the voice adapter, `useDictation`, `pcmCapture`
and ASR_PLAN — J3 touches none of them); J3 and J4 are separate sessions from each other and from J1/J2; the owner
may run them in the Opus/other seat. Two sessions, one tree (GALLERY_UX_PLAN §8): commit BY PATH; `git status` before
touching a shared doc (HANDOFF, ISSUES, ROADMAP, QUALITY); code in a worktree; one scratch dir per session
(`~/.cache/tmp/ctrlb-session<N>/`), one `clones/` subdir per research lane. `session.py` is shared with J4 and with
ISS-28's editor hint — whichever builds second rebases on the first.
