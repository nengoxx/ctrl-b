# Lorebook Probability Plan — entries that fire X% of the time, on a cadence (ROADMAP J4)

> **Status (2026-10-07): ✏️ OWNER-ASKED · NOTHING DESIGNED · NOTHING BUILT.** The plan-of-record STUB for a
> **dedicated design session** — research-first, its OWN session — precise enough for a fresh session (the main seat
> once session B is done, or the owner's other seat in the `ctrl-b-opus` tmux unit) to resume **from this file
> alone**. It absorbs ISSUES **ISS-45** (lorebook entry probability) and **ISS-46** (the Frieren entry that can never
> fire). **NOT the ASR session** (Phase 26 / session B is its own session; J4 touches none of its files). **Separate
> from [J3](./PROMPT_ORDER_PLAN.md)** (prompt order) and from J1/J2 — the owner: *"One for the prompt ordering, which
> realistically doesn't have as much to do with the lorebook thing. And another for the lorebook thing. They're both
> tangential issues."* **Timeline (owner, 2026-10-07):** *"I want to do it before we update production after session
> B."* → the prod update that follows session B (v1.7.12) **WAITS for J3 and J4** unless the owner re-rules at release
> time. The owner also: *"I didn't want you to start building this feature. This is a very design-driven thing."*

## 0. How to read this

§1 the problem in the owner's words · §2 what the owner wants (the goals and the floor) · §3 the scope inventory
(every code and doc place the session must read, file:line) · §4 the method (research-first → dossiers → design →
council → slices) · §5 constraints and locked decisions (incl. the relationship to J3) · §6 starting evidence · §7
open questions for the owner · §8 working rules. When the design is ruled, this file becomes the plan (status line,
§4's ladder, a council record §9) exactly like `MEDIA_MANAGER_PLAN.md` did.

## 1. The problem (owner, 2026-10-07, verbatim where quoted)

- Today a lorebook entry activates iff `enabled` ∧ (`constant` ∨ a key hit ∧ its secondary gate) — there is no roll
  (ROLEPLAY_PLAN §6.2's recorded non-goals). Imported `probability`/`useProbability` ride inert under `extensions`, and
  the import report says so per book. The Frieren card's "random encounter" entry (10 %, no keys, not `constant`)
  therefore never fires (ISS-46); flipping it to `constant` today would fire it every turn.
- The owner on the intent: *"A constant entry with a probability rolls too — yes, definitely, that's the idea. For the
  Frieren book you can see the actual mechanics: it's literally just to steer the model to behave a certain way and
  maybe force a certain encounter X times."*
- The owner on the cadence: *"Maybe we could also think about it in the way of firing it after several turns, not
  rolling every turn. That could be a different knob, so we also make sure we don't break the prompt cache every turn
  and also make it more real — because if you fire it based on a percentage only, you could literally fire it back to
  back. This needs its own session."*
- The owner on the editor: *"A per-entry percent field in the lorebook editor exported back into the card extensions
  — I'm guessing yes."*
- The bar: *"Launch the research in all of the ways I thought about — the different design approaches, the different
  concerns, which are nuanced and complicated when it comes to the code itself. I want rigor and a very thorough
  analysis of how to approach every single part, every nuance and edge case I suggested and any other you could think
  of."* · *"I want to design this in a very good, non-convoluted, thoughtful way, so it's easy to manage as the user
  and easy to understand."*

## 2. What the owner wants

**Goals:** an entry can carry a probability — keyed (rolls on a key hit) or `constant` (rolls every eligible turn:
*"fires X% of turns"*); a separate CADENCE knob so a rolled entry cannot fire back to back and does not break the
prompt cache every turn; a per-entry percent (and cadence) field in the lorebook editor that round-trips through the
book/card export; the import report tells the truth about what now runs. **The floor (the minimum the session must
deliver):** a researched, council-closed design for the roll, the cadence knob, their state (if any), the regenerate/
resume/alternates behaviour, the cache cost per placement, the import/export round-trip and the editor — and the
Frieren entry firing as its author meant. **Non-goals:** the other recorded §6.2 non-goals (recursion,
min-activations, inclusion groups, regex keys, vector activation) unless research proves one is inseparable from the
roll; the prompt ORDER/placement design itself (J3); touching the voice/ASR path.

## 3. Scope inventory (read before designing)

- **The scan** (`backend/app/services/agent/lorebooks.py`, 423 lines): module docstring L1–31 (the `extra="allow"`
  stash rule, "adopting one later costs no migration") · `LorebookEntry` L60–87 (`constant` L73, `position` L82,
  `order`, `priority`; NO stable entry id) · `activate` L354 (the activation predicate — ISS-45's "`activates` ~L357") ·
  `_gate_passes` L341 · `_evict` L385 (the ONE global budget pass) · `scan` L401 (activate → evict → partition →
  sort) · `block` L417.
- **The turn wiring** (`services/agent/session.py`): `_activate_lorebooks` L905 (once per turn, resets
  `_static_head`, `scan` at L992) called from `run_turn` L1446, `regenerate` L1488 (`resume=True`, the anchor), and
  `resume` L1652 · the per-turn macro salt minted at L600 (`secrets.token_hex(8)`, ISS-28 — *"ISS-45's probability can
  later roll from the same salt"*) · `_macros` L605 / `_bind_macros` L618 · **the in-house cadence precedent:**
  `_maybe_arm_reflection` L1514 (D27-C — arms when the thread's user-turn count is a multiple of
  `reflection_interval`, derived from the persisted count, no state) · the head block LAST among the plain head blocks
  (L1049) and the tail block before `post_history` (L1168).
- **The macros** (`services/agent/macros.py`): `Macros.salt` L172 · `rng(salted=)` L259 (seed = salt + call key) ·
  `SUPPORTED` L386 · `PER_TURN` L409 · `per_turn_in` L534 · `per_turn_note` L546 (the import count-line pattern).
- **The importer** (`services/agent/lorebook_import.py`): `ST_EXTENSION_NAMES` L104 (`probability` L115) ·
  `_INERT_PROBABILITY` L142 · `_inert_features` L420 (the probability read L432–434: `probability < 100` and
  `useProbability` not false) · the head-landing `per_turn_note` L228 · `_entry` L257 (the `extensions` precedence
  read, `take_ext`).
- **The exporter** (`services/agent/lorebook_export.py`): `_stashed_extensions` L113 · `st_position` L118 (THE
  stale-stash pattern: re-emit the stashed value iff it still agrees with the live field) · `entry_out` L173 ·
  `_st_entry` L191 · `_spec_entry` L246 · `book_out` L304 · the card export embeds the book as `character_book`
  (`card_export.py` ~L171–181) · routes `api/agent.py`: book import L2460, `export_lorebook` L2501, card PNG export
  L2349 (S9 / D79, ROLEPLAY_PLAN §15).
- **The editor** (`frontend/src/components/LorebooksEditor.tsx`, 813 lines): `EntryForm` L165 (the `constant`
  toggle ~L209, `position` ~L258, `order` ~L268, `priority` ~L282) · `EntryList` L303 (its comment: an entry has no
  stable id; v1 has no reorder UI) · `BookReportCard` L119 · the type `hooks/useRoleplay.ts` `LorebookEntry` L184 ·
  the Lorebooks Conf group (`tabs/ConfTab.tsx` ~L3417) · `config.py` `LorebooksCfg` L2230 (`books`, `scan_depth`,
  `budget_chars`).
- **Docs:** ROLEPLAY_PLAN **§6.2** (the model + the non-goals), **§6.3** (the scan at `_static_prefix` build time),
  **§6.4** (budget, partition, placement), **§6.5** (import), **§4.3** (macros), **§15** (S9 export) · DECISIONS
  **D70**, **D79** (export), **D81** (regenerate MOVES the displaced reply to an alternates stash; delete/edit act on
  units) · ISSUES **ISS-45**, **ISS-46**, **ISS-28** (the salt; the cache ruling), ISS-22 (the import count-line
  pattern) · R65 **§1.1** (ST's `probability` 100 / `useProbability` true defaults), **§1.5** (where the roll sits in
  ST's scan), **§1.9** (ST's timed effects `sticky`/`cooldown`/`delay`, state in chat metadata, line-cited), Agnai's
  off-by-one (R65 ~L654), Risu's `activationPercent` (R65 ~L683), **§9** (the cache analysis) · R87, R103.

## 4. Method (the session's ladder — each rung its own commit)

1. **Research first — buy the findings once, into `docs/research/`** (one Opus lane per dossier, the README's
   conventions; next free number after R103). R65 already bought ST's model at its 2026-09-06 pin — re-verify the
   lines this design leans on at the current ST release, do not re-buy the rest. The questions:
   1. **ST's roll at source** — `useProbability`/`probability` + `constant`: does a constant entry roll; where the
      roll sits relative to the key check, the budget pass and recursion; the RNG and its range (Agnai's off-by-one
      as the cautionary case); what a failed roll records (R65 §1.5: "already-failed-probability → skip"); Risu's
      `activationPercent`; whether CCv3 itself defines probability or it is an ST extension (the export field names).
   2. **ST's timed effects at source** — `sticky`, `cooldown`, `delay` (R65 §1.9: `world-info.js` `:479-793`; sticky
      skips the probability roll `:4916-4919`; a sticky's end installs the cooldown; effects removed "if the chat
      doesn't advance"; state keyed `${world}.${uid}` + a whole-entry hash, so an edit resets it) — and the Author's
      Note *insertion frequency* as ST's own "every N" precedent.
   3. **The cadence knob's shape** — "roll every N turns" vs "cooldown N turns after a fire" vs "at most once per N"
      vs ST's `delay`: for each, the behaviour the owner described (no back-to-back; *"more real"*), the cache
      arithmetic (how many prefix changes per N turns, head vs tail), whether it needs STORED state or is derivable
      from the thread's persisted user-turn count (the D27-C precedent), and its import/export mapping to ST's fields.
   4. **State + identity** — if a knob needs a fire history: where it lives (a per-message activation record beside
      D62's `source`, a thread-level row, or nothing), how an entry is keyed when entries have NO stable id (ST hashes
      the whole entry; an edit resets), and what an edit, a reorder, a book swap or a deleted message (D81) does to it.
   5. **Regenerate / resume / alternates** — re-roll like an ST swipe (the ISS-28 salt precedent: each regenerate and
      resume builds a fresh session, a fresh salt) vs keep the turn's outcome; a displaced reply's fire must not
      count toward a cooldown; compaction; subagents and headless A3 runs (do they roll, do they count turns).
   6. **The prompt-cache cost** — which placement of a fired entry breaks what (a head entry changes the coalesced
      system message → the whole history re-prefills; a tail entry re-prefills only the tail), measured on dev with
      the `cached_tokens` telemetry. **J3's outcome is an input here** (see §5), not a blocker.
   7. **The roll's randomness** — seeded from the turn salt (byte-stable within a turn, re-rolls per turn,
      testable) and keyed per entry so it never collides with ISS-28's `{{random}}`/`{{roll}}` streams inside the
      same entry's content; the roll vs the budget pass order (ST rolls before accumulating budget).
   8. **Import / export round-trip** — promoting `probability`/`useProbability` (and any adopted timed effect) from the
      `extensions` stash to first-class entry fields: the fold (load-boundary + write-back, no legacy seams) vs a read
      of the stash; the `st_position` stale-stash rule for the export; what replaces the `_INERT_PROBABILITY` count
      line (a per-turn-cost line for head-landing rolled entries, the `per_turn_note` pattern?); ISS-46's keyless
      non-constant count line.
   9. **The editor** — a percent field and a cadence field in `EntryForm` on a 360 px phone, with defaults that read
      plainly (100 % = always, today's behaviour) and a hint on what a head-landing rolled entry costs (the ISS-28
      `WarnRow` precedent).
2. **The design** (the main seat, prose, in THIS file): the activation predicate with the roll; the cadence knob and
   its state (or its statelessness); regenerate/resume; the cache statement per placement; the field shape + fold; the
   import/export mapping; the editor. Each deviation from ST named (ROLEPLAY_PLAN's habit).
3. **Design council** — blind Opus ∥ Emma (the dual-reviewer rule), ground-or-withdraw, rulings recorded in §9.
4. **The slice ladder** (S0…Sn, each reviewed by Opus ∥ Emma on a frozen diff), written here before any build; the
   last rung = the owner flips the Frieren entry to `constant` + 10 % in the editor (ISS-46) and plays it.

## 5. Constraints and locked decisions (do not relitigate)

- **The relationship to J3:** tangential (the owner's word). J3 decides WHERE a part of the prompt lands; a fired
  entry placed in the TAIL breaks only the tail of the cache, so **J4's cache concern is partly ANSWERED by J3**. J3's
  outcome is an INPUT to J4's placement question — it is **not a blocker** for J4's roll/cadence design, which stands
  on its own (until J3 lands, an entry's existing `position: head | tail` is the placement, and J4 states the cost
  under it).
- **D70** + ROLEPLAY_PLAN §6: the scan is code-decided, pre-first-token, invisible; one global budget pass, then
  partition; V3 field names; `extra="allow"` stashes what v1 does not run (so the data is already on disk).
- **ISS-28's ruling (owner, 2026-10-06):** accept the per-turn cache cost, ST parity, and WARN; the salt stays per turn
  (a per-thread salt is NOT wanted). A rolled head entry is the same cost class — J4 warns the same way.
- **The prompt cache is a first-class cost** — every design choice states what it re-prefills.
- **No legacy seams** (PERMANENT) + **shape to extend, not to migrate** (CLAUDE.md): the new fields extend
  `LorebookEntry` (one per-entry object), never a sibling map; any promotion from the stash rides one fold.
- **J2's knob discipline** ([CONFIG_DEBLOAT_PLAN](./CONFIG_DEBLOAT_PLAN.md)): every new field carries its scope
  sentence; a global default knob only if a per-entry field cannot carry it.

## 6. Starting evidence

ISS-46: the Frieren book's "random encounter" entry — no keys, not `constant`, 10 %, content "Frieren is going to test
your skills in a merciless duel" (dev book `frieren-book`); the owner ruled 2026-10-01 not to flip it to `constant`
before probability exists. ISS-45: the scan runs at `_static_prefix` build time, so a per-turn roll changes the prefix
turn to turn; imported values are already stashed under `extensions`. ISS-28 (the owner's corpus): 24 book entries use
`{{random}}`; 7 of 12 standalone random entries land in the HEAD. The import report's per-book inert-probability count
line (`_INERT_PROBABILITY`) is how the owner has seen the gap so far.

## 7. Open questions for the owner (with recommended defaults — confirm or change at the session start)

1. **The cadence knob's shape** — ① "roll every N turns" · ② "cooldown N turns after a fire" (ST's `cooldown`) · ③
   "fire at most once per N turns". *Recommended (pending research Q3):* ① in the owner's own words — the roll happens
   only on every Nth user turn (N = 1 is ST parity), which makes back-to-back impossible for N ≥ 2, bounds the cache
   changes to the roll turns and the turn after, and is DERIVABLE from the thread's user-turn count (the reflection
   cadence precedent) so it needs no stored fire history; ②/③ need per-entry state keyed to an entry that has no
   stable id.
2. **Does a fired entry pin for the turn only?** *Recommended:* yes — it is in the prompt for the turn it fired on
   (ST's `sticky` 0); a `sticky` duration stays a stashed, reported, later optional field.
3. **Regenerate / resume:** *Recommended:* re-roll like an ST swipe (the ISS-28 salt) — consistent with the macros.
4. **A `constant` entry with a probability rolls** — RULED YES (owner, 2026-10-07). **A keyed entry** rolls only
   after its key hits (ST). *Recommended:* yes.
5. **A per-entry percent field in the editor + export into the card/book extensions** — the owner: *"I'm guessing
   yes."* Confirm; and whether the cadence field exports to ST's nearest field or stays app data under `extensions`.
6. **The import report:** *Recommended:* the inert-probability line retires (probability now runs) and a head-landing
   rolled entry gets the per-turn-cost line (the ISS-28 pattern); ISS-46's keyless non-constant entries get their own
   count line ("N entries have no keys and are not constant — they never fire").
7. **Placement of a rolled entry** — J3's question; until J3 lands, the entry's own `position` decides.

## 8. Working rules

**NOT the ASR session** (Phase 26 / session B owns `voice_live.py`, the voice adapter, `useDictation`, `pcmCapture`
and ASR_PLAN — J4 touches none of them); J3 and J4 are separate sessions from each other and from J1/J2; the owner
may run them in the Opus/other seat. Two sessions, one tree (GALLERY_UX_PLAN §8): commit BY PATH; `git status` before
touching a shared doc (HANDOFF, ISSUES, ROADMAP, QUALITY); code in a worktree; one scratch dir per session
(`~/.cache/tmp/ctrlb-session<N>/`), one `clones/` subdir per research lane (R65's ST/Risu/Agnai clones may still be at
`~/.cache/ctrl-b-research/`). `session.py` and the lorebook editor are shared with J3 and with ISS-28's editor hint —
whichever builds second rebases on the first.
