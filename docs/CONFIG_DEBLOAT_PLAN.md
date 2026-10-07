# Config De-bloat Plan — configuration knobs: scope, overlap, redundancy (ROADMAP J2)

> **Status (2026-10-07): ✏️ OWNER-ASKED · NOTHING DESIGNED · NOTHING BUILT.** The plan-of-record STUB for a
> **dedicated design session** — the problem, what the owner wants, the scope, the method and the constraints, precise
> enough for a fresh session (the owner's parallel Fable seat in the `ctrl-b-opus` tmux unit) to resume **from this
> file alone** while the main seat finishes the ASR release. **Timeline (owner):** ASR finished this week; J2 DESIGNED +
> PLANNED for later implementation. **Separate from [J1](./GALLERY_UX_PLAN.md)** (the galleries' UX) — *"two separate
> sessions"*. The owner: *"That is something that we all have to be thorough about and think deeply about in a
> completely separate session, only dedicated for that."*

## 0. How to read this

§1 the problem in the owner's words · §2 what the owner wants (the goals and the FLOOR) · §3 the scope inventory
(every place a knob lives) · §4 the method (research-first → the knob table → the design → council → slices) · §5
constraints · §6 starting evidence · §7 open questions for the owner · §8 working rules for the parallel session.

## 1. The problem (owner, 2026-10-07, verbatim where quoted)

- *"We added so many features that it's bloating a little bit of the configuration options, and we need to make the
  app more clean and easy to use and intuitive."*
- *"There might be either redundant configuration knobs or fields, or redundant things … [knobs] that might be
  fighting for the same behaviour."*
- **The owner's example — the CLASS of problem, not the ticket:** *"I remember there was a selector for the background
  for the theme, and another that was called backdrop, and there's two: one in the gacha theme-art configuration
  section, and another in the general theme. Those things feel like more bloat than configuration options, because you
  cannot use both at the same time."* The owner added: *"I'm not sure if we fixed that particular one — we might have —
  but that has been going on for a long time since we added that feature. What I want is to make clear what the
  problem is."* → The session must first ESTABLISH the example's current state (Appearance today has `Shared
  background` ~ConfTab L3569 · `Agent backdrop` ~L3599 · `App icon backdrop` ~L3690, and gacha's theme-art section
  picks its own art through the media manager — which of these still overlap, and how the D65 per-destination
  libraries changed it) and then find every OTHER instance of the same class.
- The ask: *"Exactly what is the scope of each option, what is the scope of each of the configuration knobs and how it
  differs from other similar knobs that might be in other sections or that might be fighting for the same behaviour."*
  *"A very clean clean-up and revision of the design of the configurations and everything."*

## 2. What the owner wants

**Goals:** fewer knobs where two governed one behaviour; every remaining knob with a stated SCOPE (what it governs,
where it applies, which neighbour it overlaps or overrides, what happens when both are set); groups that read as a
system (an everyday layer and an advanced layer, not one long form); an app that is *"clean and easy to use and
intuitive"*. **Outcomes in order of preference per finding:** ① **MERGE** (one knob) → ② **GATE** (a knob shows only
when another makes it meaningful) → ③ **RENAME + EXPLAIN** (each knob says what it does and how it differs from its
neighbour). **The floor:** ③ for every knob in §3 — *"at the very least be more clear which option does what."*
**Non-goals:** removing capabilities (a knob with a real, distinct scope stays); changing defaults for their own sake;
redesigning the Conf shell's navigation (unless the inventory proves it is the cause).

## 3. Scope inventory (every place a knob lives — read before designing)

- **Conf groups (24 today, `frontend/src/tabs/ConfTab.tsx`, 3,732 lines):** Agents · Agents · gallery · Appearance ·
  Automations · Computers · Embeddings · Inference · Live call · Lorebooks · MCP servers · Memory · Notifications ·
  OpenAPI tool servers · Open-terminal · Prompts · Providers · Roleplay · SearXNG · Server · Shell · Skills · Tools ·
  Voice · STT · Voice · TTS. The backend shape behind each: `backend/app/config.py` (every `*Cfg` model with its field
  docstrings = the scope statements of record, where they exist).
- **The agent editor** (`components/AgentsEditor.tsx`): per-agent fields that SHADOW global knobs (model/provider,
  privilege, tools, voice, memory, greeting…) — the inventory must say, per field, which global it overrides and how
  the resolution order is shown to the owner.
- **Appearance / theme / art:** the Appearance group (`Shared background` · `Agent backdrop` · `App icon backdrop` ·
  theme · mode · accent · layout · section placement · composer skin · motion · perf) vs each theme's own art
  destinations in the media manager (D65 libraries) vs gacha's theme-art section — the owner's example lives here.
- **Voice:** `Voice · STT` · `Voice · TTS` · `Live call` (ASR_PLAN §4 lists every `voice.live` key, several of them
  owner-tuned sliders) — three groups for one subsystem; the ASR session (Phase 26) is still ADDING keys (§4: no
  migration) — coordinate: J2 inventories, it does not move voice keys until Phase 26 closes.
- **Memory:** `Memory` (caps/toggles) · Core Memory (D57, ships OFF) · the agent's own memory fields.
- **Tools:** `Tools` · `Skills` · `MCP servers` · `OpenAPI tool servers` · `SearXNG` · `Shell` · `Open-terminal` · the
  per-tool `tool_overrides` (D8/Phase 8) · the agent's tool subset (A7).
- **Prompts:** `Prompts` (the registry + overrides, Phase 18) vs per-agent SOUL/Duties (Phase 23) vs lorebooks.

## 4. Method (the session's ladder)

1. **Research first (`docs/research/`, one Opus lane each):** **R-c** how the peer class structures dense settings —
   progressive disclosure, "advanced" sections, per-feature pages vs one form, inline scope help, override indicators
   ("set by agent X", "inherited") in opencode / Claude Code / Codex / open-webui / LibreChat / SillyTavern / Home
   Assistant (the homelab peer for config density). **R-d** how override chains are SHOWN (global → per-agent →
   per-thread) without a knob per layer. Read `docs/AUDIT_settings.md` + `docs/REORG_PLAN.md` (frozen pre-reorg audits of
   this very surface) and ROADMAP "Settings tab — organized by functionality" first — do not re-buy.
2. **The knob table** (one read-only Opus audit, file:line, THE deliverable the design is built on): one row per knob
   — `knob · group · config key · scope (what it governs, where) · overlaps/overrides (which other knobs) · when both are
   set → which wins (code-verified) · verdict candidate (merge / gate / rename+explain / keep)`. Start with the
   owner's example and resolve its current state in the first rows.
3. **The design** (the main seat, prose, in THIS file): per row the ruling; the everyday/advanced layering; the scope
   sentence per knob (becomes the field's help text — the Conf editor already has a per-row caption slot); any shape
   change named with its fold.
4. **Design council** — blind Opus ∥ Emma, ground-or-withdraw, rulings in §9.
5. **The slice ladder** written here before any build; the owner's rule *"shape data to extend, not to migrate"* and
   *"no legacy seams"* bind every merge.

## 5. Constraints and locked decisions

- **No legacy seams** (PERMANENT): a merged knob leaves no dead key — one load-boundary fold + write-back deletes the
  old keys (UPDATE_PLAN; `app/config_migration`), and the shape number moves only when the fold needs it.
- **Shape to extend, not to migrate** (CLAUDE.md, 2026-06-24): never a second name-keyed map beside an existing one.
- **Whole-feature enable/disable toggles are a binding requirement** (the vault ruling) — de-bloat must not remove a
  feature's on/off.
- **Phase 26 owns `voice.live`** until it closes; **D84 (Phase 27)** adds per-agent/per-device overrides — J2's
  override-chain design must accommodate both, not pre-empt them.
- **Prompts** stay editable through the registry (Phase 18) — J2 reorganizes where knobs live and how they explain
  themselves; it does not change what a prompt override is.

## 6. Starting evidence

`docs/AUDIT_settings.md` + `docs/REORG_PLAN.md` (frozen, the last time this surface was audited) · ROADMAP "Settings
tab — organized by functionality" (the functional-groups principle the Conf layout was built on) · `backend/app/config.py`
field docstrings · ASR_PLAN §4 (the voice.live keys) · D65 (per-destination libraries — what replaced the old single
background picker) · the ISSUES rows that touched Conf (ISS-12 frontier Save, ISS-22 import counts, the D74 deck round).

## 7. Open questions for the owner (fill at the session start)

1. Which knobs do you reach for weekly? (= the everyday layer; everything else is a candidate for "advanced".)
2. For the example: do you want ONE art picker per theme destination (the D65 library model, surfaced once), or a
   global background with per-theme override — and should the global stay at all?
3. Per-agent overrides of global knobs: show the inherited value greyed in the agent form ("inherited: qwen3.6-max"),
   or hide inherited fields behind "override"?
4. Is a shape migration acceptable for a merge this cycle (it rides a release with a config backup), or rename+explain
   only until 1.8's cleanup wave (VERSION POLICY: 1.8 is RESERVED for the final ROADMAP/ISSUES cleanup)?

## 8. Working rules for the parallel session

As in GALLERY_UX_PLAN §8 (two sessions, one tree: commit by path; shared docs by `git status` first; worktrees for
code; one scratch dir per session). Additionally: J2 touches `backend/app/config.py` only AFTER Phase 26's session B
has merged its `voice.live` keys (ASR_PLAN §4) — until then, inventory and design only.
