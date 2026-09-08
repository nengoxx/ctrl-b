# Handoff — start here for a fresh session

> ## ▲▲ READ FIRST — WHO YOU ARE (owner, 2026-07-28)
> **The MAIN model is now FABLE 5 on high.** It supervises: designs the work and the project itself,
> rules, and audits. **Opus 5 (high) subagents carry all the heavy token work** — implementation from
> pinned briefs, research, mechanical + operational tasks including runbook releases. **Codex
> `gpt-5.6-sol` high** remains the standing co-reviewer, launched whenever review is warranted.
> *(This inverts the 2026-07-24 arrangement. The METHOD is unchanged — judgement in the main seat,
> execution in subagents — only the occupants swapped. Mechanics:
> [`second-opinion`](../.claude/skills/second-opinion/SKILL.md); rationale + the build-brief bar: the
> `orchestrate-with-opus-subagents` memory. Match the model to your tmux session at session start:
> `tmux display-message -p '#S'`, and CHECK THE EFFORT — a supervising seat at low effort is the
> failure mode.)*

## Current state (2026-09-08, TENTH session — THE OWNER'S BACKDROP ROUND LANDED 4 FINDINGS; **wave 1 (②+③) ran the whole cadence and is council-CLOSED: RESOLVED — SHIP**; wave 2 (①+④) designed + owner-confirmed, PENDING; supersedes below where it speaks)

- **The owner's phone round on S6 came back with four findings, restated + confirmed in
  conversation** (full record = **plan §13-S6b**): ① the agent form's avatar/backdrop PICKER
  is confusing · ② Lynette showed the DEFAULT backdrop (root cause: a card import binds only
  the avatar; resolution read `background` only — NOT a priority bug) · ③ `full` mode started
  a band below the pane's top + a 30px `--bg` haze across the art · ④ the agent form's
  long-text fields should take the Conf → Prompts presentation. **Ruled two waves; the owner
  confirmed the whole design** (backdrop order = background → avatar → default; picker =
  image-as-button → the media-manager library in pick mode, the researched dominant pattern).
- **Wave 1 ran end to end and is council-CLOSED:** three seam scouts + a picker-UX research
  pass → main-seat design → the owner's word → Opus build **1a `864f447`**
  (`useActiveBackdrop` returns `background ?? avatar` — the ONE chokepoint all three
  consumers read; 5 unit arms, 2 red-proven) → **the builder's STOP-CLAUSE catch**: the
  brief's gap mechanism was measured WRONG (sticky rests on the scroller's CONTENT box — the
  kit comment was right, the scout wasn't; the margin-pair pull collapses through the
  first-child zero-height pin and nets ZERO) → main seat accepted the builder's measured
  alternative → **1b `d74eecb`** (ONE `--kit-backdrop-lift` token; the ABSOLUTE ART LAYER
  pulled by `-lift`, height subtractions dropped — art top Δ 0.0 in all 4 bar modes ×
  plan/no-plan, rest AND stuck, overflow still 0; the seam scrim yields via
  `:has(.tab.active > .kit-backdrop-pin)`; e2e 14 → 20, claim arms red-proven) → main-seat
  audits (all deviations accepted) → **blind Emma round: SHIP WITH FIXES 1M·2L, sweep
  "none"**, all ruled FIX → wave **`6657a9b`** (`OUTRANKED.agent` says "own ART is used" ·
  the scrim e2e rides ONE boot + a live two-way tab transition · §8.3/§8.3a's five clauses
  say the shipped ladder) → **her confirm: all 3 RESOLVED with line proof, sweep "none" —
  RESOLVED — SHIP.**
- **Gate at tip: 6/6 — BE 2,373 · FE 3,066/178 · e2e agent-backdrop 20/20 both projects**
  (counts in QUALITY.md). FE-only; **:5173 serves it live; both dev units RUNNING (D69 — do
  NOT stop them).** ⚠ The §13-S6 ops rules held: gate FOREGROUND, never concurrent with an
  Emma Chromium round.
- **▶▶ NEXT: the owner's phone glance at wave 1** (dev :5173 — pin Lynette: her card art now
  paints as her backdrop; Conf → Appearance → Agent backdrop `full`: edge-to-edge to the true
  top, no haze band) **→ then WAVE 2, its own session + cadence (plan §13-S6b's pending
  block): ① the picker** (image-as-button → the library in PICK mode; the `.agart-pick`
  duplicate strip DELETED) **+ ④ the prompt rows** (extract the Prompts row face, the agent
  form's `LongField`s take it). The S6→S7 ladder is unchanged behind it: the owner's word
  closes S6's feel round, **S7 = the owner DEVICE round = the phase gate (§10-S7)**.
- **Git: 88 commits unpushed over origin `04769d9`** (the 83 + `864f447` + `d74eecb` +
  `6657a9b` + this docs commit + the memory commit if any); working tree clean at write; the
  PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline
  (Dependabot D1 → push → release E, config migration 2→3, rollback = config backup FIRST
  then v1.7.7) is unchanged and still owed; sequencing is the owner's. **NEXT-NEXT (owner):
  LIVE VOICE/CALL MODE — R51, buy only the delta.**

## Prior state (2026-09-08, NINTH session — THE OWNER'S WORD CLOSED S5, then **S6 (the three-state backdrop) ran the WHOLE cadence in one session and is council-CLOSED: micro-confirm PASS**; superseded above where it speaks)

- **The session opened on the owner's word ("yes lets continue") — S5 CLOSED (`0ee3474`) — and
  S6 ran end to end:** two seam scouts → main-seat design → **the owner's clarify round in
  conversation** (plain-language restatement of the three states + the one-image active-agent
  rule; confirmed) → **§8.3a committed `dd60681`** (the owner-confirmed narrowing: the kit
  operator STRIP as the kit themes' operator-image place · active agent = the sticky pin else
  the resolved default, never per-bubble/one-shot · the SYNCED `agentBackdrop` setting) →
  pinned Opus build **`06d3f0e`** (the setting chain BE+FE · the reactive session pin ·
  `useActiveBackdrop` · the kit `AgentBackdrop` layer (strip / full arrangement with the
  lifted `scrollProgress` math + the `--kit-pane-h` phantom-overflow fix) · gacha wired at the
  body · frontier untouched) → main-seat audit (all 8 deviations ACCEPTED, gate independently
  re-run 6/6) → **blind Emma round SHIP WITH FIXES 0H·3M·0L sweep "none"**, all three ruled
  FIX → wave **`29c5be4`** (red-proven: `oracleFadeActive` gates driver AND `data-oracle`
  stamp · the pin's compensating margin · the gallery's `outranked` honesty via
  `backdropOutrank`, ONE statement for paint + report) → her confirm **all 3 RESOLVED** + 1
  LOW → main-seat rider **`90b7472`** (the seat modal's reading line) → **micro-confirm:
  RESOLVED, sweep "none" — PASS.** Full record = **plan §13-S6**.
- **Gate at tip `90b7472`: 6/6 — BE 2,373 · FE 3,061/178 · e2e agent-backdrop 14/14 both
  projects** (counts in QUALITY.md). **The S6 BE field is live on dev** (the builder restarted
  :5434); both dev units RUNNING (D69 presence observation continues — do NOT stop the units).
  ⚠ Ops recorded in §13-S6: never run the full gate CONCURRENT with an Emma round that probes
  in Chromium (her probe rebuilds `frontend/dist` → ~8 BE media-write tests fail, pure
  contention); background gate runs got reaped twice — run the gate FOREGROUND.
- **▶▶ NEXT: the owner's phone round on the backdrop (dev :5173, Conf → Appearance → "Agent
  backdrop"):** operator (Lynette's background in the strip / gacha's oracle) · full (behind
  the chat, dims on scroll) · off — on gacha AND a kit theme; the light-theme veil + the 240px
  strip height are the two unverified-by-eye items (tokens, feel-round material). **THEIR WORD
  closes S6 → S7, the owner DEVICE round, IS the phase gate (§10-S7)** — import a real card ·
  talk on the phone · tools-in-character both duties settings · all three backdrop states ·
  a lorebook triggering live · showcase/picker feel · read-along on a character reply.
- **Git: 83 commits unpushed over origin `04769d9`** (the 77 + `0ee3474` S5-close + `dd60681`
  §8.3a + `06d3f0e` build + `29c5be4` wave + `90b7472` rider + this docs commit); working
  tree clean; the PUSH ruling stays the owner's. **Prod untouched:
  v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release E, config
  migration 2→3, rollback = config backup FIRST then v1.7.7) is unchanged and still owed;
  sequencing is the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — R51, buy only the
  delta.**

## Prior state (2026-09-08, EIGHTH session — THE OWNER'S WORD CLOSED S4, then **S5 (the lorebook FE) ran the WHOLE standing cadence in one session and is council-CLOSED: RESOLVED — SHIP**; superseded above where it speaks)

- **The session opened on the owner's word** ("you fixed something and it looks good now, we
  can continue") — **S4 is CLOSED** (recorded in plan §13-S4 + TODO) — **and S5 ran end to
  end**: two seam scouts → main-seat design → pinned Opus build **`eb2f21c`** (the §6.6
  collapsed-entry manager inside the existing Conf `lorebooks` group · the stash-preserving
  draft/PUT discipline, test-pinned at entry AND book level · book import + inline report ·
  the two-consumer `LorebookPicker` (agent form, NOT rp-gated — ruling 9; global
  `lorebooks.books` on the LorebookGlobals save bar) · `TickGrid` to its own module) →
  main-seat audit (gate independently re-run 6/6; all 10 deviations ACCEPTED) → **blind Emma
  round DO NOT SHIP 1H·5M·1L, all seven ruled FIX** → fix wave **`3be3386`** (failing-before
  proofs; two main-seat re-derivations — F1's seeded-snapshot compare she later ruled SOUND,
  F4's file probe over her out-of-scope create-only verb) → **rider `b365d45`** (the two
  same-class TWINS on the S4 surface: AgentRow's collapsed-dirty defect + the card-import
  `accept` filter) → her confirm (5/7 + F3 surviving + 2 sweep MEDs) → **micro-wave
  `0ce4dd4`** (F3 held-through-the-await via `flipping` · probe-window locks on the add row ·
  clean-draft-adopts-echo · **+ a main-seat-found trap her sweep missed**: a toggled
  never-opened row wedged its first open on "loading…" forever) → her micro-confirm (one
  blocker: click-time draft classification) → **rider `059fd29`** (the live-ref `updateDraft`
  chokepoint; the echo classifies the draft as it IS) → **her FINAL VERDICT: RESOLVED — SHIP**
  (sweep "none"; she re-ran the FE suite 3,024/3,024 herself). **Full record = plan §13-S5**
  (residuals recorded there — headline: the malformed-file class now also covers
  create-overwrite; the register fix is the backend surfacing unreadable books).
- **Gate at tip `059fd29`: 6/6 — BE 2,373 (untouched) · FE 3,024/177** (counts in QUALITY.md;
  eslint 97 → 110, attributed there — the seeded-snapshot render reads are deliberate).
  **FE-only slice — :5173 serves it live; both dev units RUNNING (D69 presence observation
  continues, do NOT stop the units); no backend restart needed.**
- **THE OWNER'S FEEL ROUND LANDED same session (in conversation): "it looks fine" + ONE
  finding — the Global-lorebooks picker flush with no padding — plus the standing ask to
  MEASURE consistency rather than claim it.** Measured live at 390px: both card-hosted
  `.agent-allow` blocks at x:19 (the flagged picker AND the S4-shipped roleplay "Character
  tools" grid — the same uncaught defect) vs the card content line at x:33; everything else
  on the surface measured consistent. **Fix `589ecf0`**: one child-scoped rule
  (`.conf-card > .agent-allow` takes the confrow's density-aware inset; the `.mform`
  instances untouched); re-measured x:33 both; the e2e Lorebooks ladder pins the shared
  left edge, proven red without the CSS, green both projects; gate 6/6. **Emma micro-round:
  RESOLVED — SHIP, sweep "none".** Record = plan §13-S5's feel-round addendum.
- **▶▶ NEXT: the owner's phone glance at the FIXED picker** (dev :5173 → Conf → Lorebooks —
  the "0 attached"/chips now on the row-label line; the same grid in Roleplay also fixed)
  **→ THEIR WORD closes S5 → S6 (the three-state backdrop, §10-S6)** — one slice per
  session. The Phase 19 residuals stand (`tabbtn-<id>` aria class · multipart spool · the
  TickGrid tools/skills silent-drop + unreadable-book surfacing, plan §13-S5).
- **Git: 77 commits unpushed over origin `04769d9`** (the 69 + `eb2f21c` + `3be3386` +
  `b365d45` + `0ce4dd4` + `059fd29` + the S5 docs commit + `589ecf0` + this docs commit);
  working tree clean; the PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @
  `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release E, config migration 2→3,
  rollback = config backup FIRST then v1.7.7) is unchanged and still owed; sequencing is
  the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — start at R51, buy only the
  delta.**

## Prior state (2026-09-07, SEVENTH session — THE OF FIX WAVE COUNCIL-CLOSED, then the owner's confirm round RE-PINNED OF-1 → **OF-1b** (the standalone cards' full-bleed) fixed `02cc5c4` + council-closed same session; superseded above where it speaks)

- **OF-1b (the owner's confirm round, in conversation):** OF-2 confirmed good; but the
  "dropdown with no padding" was RE-PINNED — it is the **ADD-AGENT disclosure card going
  edge-to-edge in the tab placement** ("goes up to the sides"; all owner reports are from the
  PHONE, their restated default), fine in Conf. Measured cause: `.agal-actions`/`.agal-detail`/
  `.agrep` had NO standalone inline margin — only the Conf-hosted `.confgroup` supplies one
  (18px), so standalone they spanned x:0 w:360 while the grid sat at 16px. The S4 build missed
  the `.util` "standalone page inset + host-zeroing" precedent (kit.css ~5632). **Fix
  `02cc5c4`** (main-seat): the precedent verbatim — `margin-inline: 16px` (= the grid's inset,
  shared left edge) + the `.confgroup` zeroing pair; hosted look measured UNCHANGED; the
  placement=button e2e arm pins the inset. **Emma micro-round: findings NONE — RESOLVED —
  SHIP** (she ran the focused e2e herself, 2/2). The `9f6b597` option-padding rule STAYS (a
  real desktop papercut — the plan's OF-1 attribution corrected in the OF-1b block); the
  "owned listbox" idea is WITHDRAWN. Full record = plan §13-S4's OF-1b block.
- **▶▶ NEXT: the owner's phone glance at the agents tab** (the add-agent card + detail form
  now inset like the grid) **→ THEIR WORD closes S4 → S5** (unchanged: lorebook FE + §6.6 +
  `lorebooks.books`; S5 waits for their word they're back home). Git: **69 commits unpushed**
  (the 67 + `02cc5c4` + this docs commit); tree clean; prod untouched v1.7.7; dev units
  RUNNING (FE-only — :5173 serves everything live).

## Prior current-state (same session, before the owner's confirm round — kept for the wave record)

- **The session opened on the owner's word that Emma is available again, so the OF wave ran the
  whole standing cadence, not the build-only fallback:** pin + precedent (two scouts) →
  main-seat design → pinned Opus build **`9f6b597`** → main-seat audit (diff line-by-line,
  declaration-order + theme-override probes, **full gate independently re-run 6/6**) → blind
  Emma round → fix rider → her confirm. **Full record = plan §13-S4's OF-FIX-WAVE addendum.**
- **OF-1 (dropdown padding):** no agents-only divergence — the app styled every native
  `<select>` through the ONE shared recipe but styled `<option>` NOWHERE, so every popup's rows
  rendered flush; worst = the provider/model picker's mono ids at 360px. Fix = ONE app-wide
  `.kit option { padding: 8px 10px; }` (the app's own popover-row metric). Honest caveat in the
  rule: desktop popups only — OS-rendered mobile pickers ignore option CSS and carry native
  insets; if the owner's round still shows a bare list, the fold-up is the `.priv-menu`
  popover-listbox pattern riding the deferred OF-3 pass.
- **OF-2 (gradient rims):** the precedent was found and is literally the owner's remembered
  bug — `57e106a`, the gacha dossier act, *"pink one side, violet the other"*. Mechanism: a
  gradient tiles into the border strip (origin=padding-box, clip=border-box); ruled fix =
  `background-clip: padding-box` (also D54). Swept SEVEN sites (kit save/`.conf-save`/tick
  chips/switch knob · cosmos primary · vapor plan-pin + summary) + a NEW source-pin guard
  `tests/themes/gradientRim.test.ts` (swept sites AND both precedents). **Emma: SHIP WITH
  FIXES — 1 MED (gacha's ONLINE ribbon `.gc-card .state.on` missed, verified + REPRODUCED by
  mechanism) · 1 LOW (the guard didn't pin shorthand ORDER) · sweep "none"; both ruled FIX →
  main-seat rider `90a7664` (ribbon clipped + SWEPT row; per-block last-shorthand-precedes-clip
  assertion) → her confirm: both RESOLVED with line proof, `.po-chip` immunity sound, rider
  sweep "none" — RESOLVED — SHIP.**
- **NEW: ISS-12** (found by the sweep, deliberately NOT folded in): frontier's border-off sweep
  flattens the modal-footer SAVE to `--surface-2` — collateral of a rule whose own comment
  targets "the fill-less ones"; primary reads like Cancel. One-token fix sketched in the entry;
  it changes frontier's shipped look, so it waits for the owner's ruling. **OF-3 stays
  deferred** (owner-ruled, its own future pass).
- **Gate at tip: 6/6 — BE 2,373 · FE 2,992/175** (counts in QUALITY.md). FE-only wave — :5173
  serves it live; **both dev units RUNNING (D69 presence observation continues, do NOT stop
  the units); no backend restart needed.**
- **▶▶ NEXT: the owner's dev confirm on OF-1 + OF-2** (:5173 — the agents form's dropdowns +
  the SAVE button edges, plus any gradient control they eyeball: tick chips, switch knobs,
  cosmos Wake, the gacha ONLINE ribbon) **→ THEIR WORD closes S4 → S5** (lorebook FE: manager +
  attachment picker + the §6.6 collapsed-entry editor + the `lorebooks.books` editor) — **S5
  still does not start until the owner says they are back home.** The Phase 19 residual
  (`tabbtn-<id>` aria class app-wide) stands.
- **Git: 67 commits unpushed over origin `04769d9`** (the 64 at session open + `9f6b597` build
  + `90a7664` rider + this docs commit); working tree clean; the PUSH ruling stays the owner's.
  **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release
  E, config migration 2→3, rollback = config backup FIRST then v1.7.7) is unchanged and still
  owed; sequencing is the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — start at R51,
  buy only the delta.**

## Prior state (2026-09-07, SIXTH session — §8.4a designed+built+reviewed AND the S4 code round CLOSED; then the OWNER ROUND landed 2 FIX findings (OF-1 dropdown padding · OF-2 gradient-button edge rims + app sweep) — the fix wave ran the NEXT session; superseded above where it speaks)

- **The session opened on the owner's correction: the S4 gallery's "own section" meant INSIDE
  settings, hidden by default like the tools tab — then a deep design pass, then three rulings
  (three placements never-in-two-places · bar slot after chat · mint a JP sub-label).** The full
  road ran in ONE session: probes (one data-driven bar renderer; Material 3's 3–5 cap) →
  **`ROLEPLAY_PLAN.md` §8.4a written = SATELLITE SECTIONS v1** (core four stay on the curated
  count presets; a satellite carries a per-section placement `conf`(DEFAULT)/`button`/`tab`
  composed over the resolved preset by ONE pure `layout.ts#composeLayout`; D35 carries the
  addendum — deliberately NO "5-tab" preset) → **blind Emma DESIGN round SHIP WITH CHANGES
  (0H·3M·2L, all folded) → confirm RESOLVED — SHIP** → **pinned Opus build `d944022`+`fef61c1`**
  (the Conf-hosted gallery group + the Appearance "Agents" Seg under Layout · `ui.sectionPlacement`
  healed at read · `placementKey`-keyed DefaultRoot effects · the aria fix incl. a latent S4 bug ·
  gacha `tabAgents: "キャラ"` — ONE new glyph, subsets regenerated · the `--tab-crowded` 5-up CSS
  step, 360px screenshots clean · **the S4 owner-feel riders CLOSED**: gacha appbar ≤46px and the
  10px off-inset are back by default, pinned in BOTH placement states) → main-seat audit (6/6
  deviations ACCEPTED) → design docs `b0dd5f5` + records `2ea9cd1`.
- **THEN the owed S4 blind CODE round RAN over the widened 7-commit span `e6cd1d9`..`fef61c1`:
  SHIP WITH FIXES — 0 HIGH · 3 MED · 0 LOW, sweep "none", two REPRODUCED; all eleven seeded areas
  explicitly sound (the S1 TTS obligation VERIFIED; no test weakened).** All three ruled FIX →
  **fix wave `d4dd1ef`** (Opus, failing-before proofs: `sectionPlacement?.agents` at the reader ·
  the `GET /agents` tail takes the loop's degrade posture for a malformed configured default ·
  `invalidateAgents` exported + called from the settings-save block; 1 deviation accepted) →
  main-seat audit → **Emma confirm: all three RESOLVED, sweep "none" — RESOLVED — SHIP.**
  Full records = **plan §13-S4's two addenda**.
- **Gate at tip `d4dd1ef`: 6/6 — BE 2,373 · FE 2,982/174** (counts in QUALITY.md). **Dev backend
  RESTARTED onto the tip** (summary map live: default + lynette); **both dev units RUNNING**
  (:5434 + :5173 — D69 presence observation continues, do NOT stop the units).
- **▶▶ THE OWNER ROUND LANDED IN-SESSION (2026-09-07): "it looks good" + TWO FIX FINDINGS + one
  deferral — full record = plan §13-S4's owner-round block. THE NEXT SESSION OPENS ON THEIR FIX
  WAVE:** **OF-1** a dropdown list with ~no padding, options nearly cropping to the screen edges
  (control not pinned — start at the agents surface, pin it first) · **OF-2** a gradient button's
  left/right edge "rims" land on weird SOLID colors (owner thinks the selected agent's SAVE; "we
  had an issue like that before" — find the PRECEDENT, fix, then SWEEP every gradient button for
  the class, owner-directed) · **OF-3 DEFERRED** (text/field/dropdown composition refinement = its
  own future pass, owner-ruled). Then the owner's dev confirm → **THEIR WORD closes S4 → S5**
  (lorebook FE + §6.6 collapsed-entry editor + `lorebooks.books`) — **S5 does NOT start until the
  owner is back home (their word). ⚠ THE EMMA LANE IS UNAVAILABLE (owner, 2026-09-07)** — the OF
  fix wave runs build + main-seat audit only; her rounds resume on the owner's word.
  **Recorded residual → Phase 19:** the `aria-labelledby="tabbtn-<id>"` class is wider than
  agents (every tab body, any can be off-bar).
- **Git: 64 commits unpushed over origin `04769d9`** (the 55 at session open + `b0dd5f5` design ·
  `d944022`+`fef61c1` build · `2ea9cd1` records · `d4dd1ef` fix wave · `3491f31` + the two
  owner-round/handoff docs commits); working
  tree clean; the PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.** The
  v1.7.8 pipeline (Dependabot D1 → push → release E, config migration 2→3, rollback = config
  backup FIRST then v1.7.7) is unchanged and still owed; sequencing is the owner's.
  **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — start at R51, buy only the delta.**

## Prior state (2026-09-07, FIFTH session — S4 BUILT + MAIN-SEAT AUDITED; ⚠ the blind Emma round is OWED and opens the next session; superseded above where it speaks)

- **S4 (the agents surface, §10-S4) is BUILT across two pinned Opus builds — five commits,
  gate green throughout — and MAIN-SEAT AUDITED (all 13 declared deviations across both
  builds ACCEPTED), but NOT council-closed:** the blind Emma round did not run this
  session (ruled deliberately — the S1 precedent, the owner's standing clean-handoff
  directive; build+audit one session, review the next). **Full record = plan §13-S4.**
  - **Build 1 `e6cd1d9`+`52eb52f`:** the F12 `GET /agents` summary map (every agent incl.
    the root default, name-only degrade, one `to_thread`) · `PromptDef.group` + the closed
    `PROMPT_GROUPS` vocabulary · `hooks/useAgentArt` (the ONE summary×media-index join) ·
    picker avatars (additive) · the who-line avatar swap + the synced `chatAvatarsVisible`
    Appearance switch (default ON) · **the standing S1 TTS obligation MET**: `agent` rides
    every TTS request, session-carried for chunked reads, and the live streaming bubble
    already carries its agent — the unpersisted-reply case is covered.
  - **Build 2 `a191839`+`5e4e0e0`+`b84e39e`:** the agents gallery as its OWN section
    (off-bar → a direct docked appbar button in every layout; 2-col card grid; tap =
    in-place detail swap to the SAME AgentRow form; TALK via the extracted
    `pinSessionAgent`) · Conf keeps only the `agent.*` globals · the §9 marked fields under
    the per-field predicate (duties always visible; `alt_greetings`/`lorebooks` round-trip
    only) · the `agents` MEDIA_NS row (FULL_ART, framable, avatars 1:1 / backgrounds 9:16,
    no active resolver — bindings decide) · avatar/background binding rows through the
    untouched `useImageJob` machine (`useMediaUpload.onStored`) · Conf `roleplay` +
    `lorebooks` groups (`books` editor deferred to S5) · the import UI + INLINE report
    (`postForm` + the `refuse()` dedup) · §9a complete (muted pre-fill, `foldEqualDefault`
    at the save end — F15-exact, append survives; customized accent; API-derived groups).
- **Gate at tip `b84e39e`: 6/6 green — BE 2,372 · FE 2,954/173 · local e2e 319 passed both
  projects** (counts in QUALITY.md; the main seat re-ran the full gate independently).
  **Dev backend RESTARTED onto the tip; BOTH dev units RUNNING** (:5434 + :5173 — the
  owner can poke the gallery; D69 presence observation continues, do NOT stop the units).
- **▶▶ THE NEXT SESSION'S FIRST MOVE = the blind Emma round on S4** (R46 brief,
  `--ignore-rules`, commits `e6cd1d9`..`b84e39e` against plan §8/§9/§9a/§10-S4; hermes emma
  lane, `setsid nohup` + a Monitor — the launcher PID dies BY DESIGN, find the real PID;
  `pgrep hermes_cli.main` matches her gateway daemons) → main-seat rulings → fix wave →
  her confirm → THEN the owner's word closes S4 and opens S5 (lorebook FE: manager +
  attachment picker + the §6.6 collapsed-entry editor + the `lorebooks.books` editor).
  **Owner-feel items riding the owner's next dev round:** the gacha appbar +~7px and the
  bar-less-chrome 34px scroll inset (the always-present docked nav action; exits recorded
  in plan §13-S4) · the gallery/report feel · a real card imported through the UI.
- **Git: 55 commits unpushed over origin `04769d9`** (the 49 at session open + the five S4
  commits + this docs commit); working tree clean; the PUSH ruling stays the owner's.
  **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push →
  release E, config migration 2→3, rollback = config backup FIRST then v1.7.7) is unchanged
  and still owed; sequencing is the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE —
  start at R51, buy only the delta.**

## Prior state (2026-09-06, FOURTH session — S3 LOREBOOKS BUILT + COUNCIL-CLOSED; superseded above where it speaks)

- **S3 (lorebooks, §10-S3) is BUILT + COUNCIL-CLOSED, the full standing cadence in one
  session:** pinned Opus build **`cc1f069`** (the whole plan-§6 subsystem: file-per-book
  storage + CRUD + `POST /lorebooks/import` for the three circulating shapes · the
  once-per-turn PRE-persist scan (F11's no-exclusion form) · ONE global budget/eviction
  pass · head block last-among-plain-blocks BEFORE the named examples, tail block ahead
  of `post_history` · the ruled position/logic downgrade tables, never silent · the card
  `character_book` hook through the SAME importer · `lorebook_intro` registry framing ·
  `LorebooksCfg` additive, no migration) → main-seat audit (all 10 deviations ACCEPTED)
  → blind Emma **SHIP WITH FIXES: 3 MED all reviewer-REPRODUCED + K1/K2 ruled FIX, sweep
  "none"** → fix wave **`9ac5289`** (anchor-rule resume window · off-loop book load ·
  unhashable-position downgrade · slug guard at the read seam · selectiveLogic
  provenance) → **two main-seat riders**: `769b1da` (the resume anchor engages on an
  explicit flag — an attachment-only send is a TURN START with empty text) and
  `39237be` (her confirm-round repro: the anchor now admits attachment-only user rows;
  the rebuilt haystack is BYTE-IDENTICAL across a suspend, closing the ordering LOW
  too) → **micro-confirm: RESOLVED — SHIP, all three bad shapes re-probed by her
  through the REAL seams, sweep "none".** Gate 6/6 throughout; **BE 2,365** (counts in
  QUALITY.md). Full record = **plan §13-S3**.
- **The §6.7 live probe PASSED on the owner's real book:** `Simple Personality
  Traits.json` imported 201 with ZERO warnings (all position 1 = the exact head
  landing; all 36 gates → `and_any` cleanly), landed as `personality-traits`
  (0600, 38KB) and **ATTACHED TO LYNETTE on dev via the editor PUT** — a trait word
  ("groomed", "tidy", …) in a chat with her triggers it live. **The activation chain
  is ALSO proven live (owner ask at close): a canary probe book made the model answer
  a passphrase that exists ONLY in a lorebook entry — one real chat turn on dev,
  probe cleaned up after.** Dev backend RUNNING on
  the `39237be` tip (D69 presence observation continues — units stay RUNNING; two
  harmless probe threads remain in the dev thread list, removable from the UI).
- **Next slice = S4 (the agents surface, §10-S4)**, one slice per session, the owner's
  word opens it — the BE summary-map half FIRST (Emma F12), and it carries the standing
  **⚠ S4 obligation: the FE sends `message.agent` on TTS calls.** The S5 collapsed-entry
  editor requirement (§6.6) stands for its slice. Ops note: the emma-lane `setsid nohup`
  launcher PID dies BY DESIGN (setsid forks) — find the real PID before declaring a
  round dead; a Monitor beats a bash waiter for the wait (waiters got reaped twice).
- **Git: 49 commits unpushed over origin `04769d9`** (the 44 at session open +
  `cc1f069` S3 + `9ac5289` fix wave + `769b1da` + `39237be` riders + this docs commit);
  working tree clean; the PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @
  `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release E, config migration
  2→3, rollback = config backup FIRST then v1.7.7) is unchanged and still owed;
  sequencing is the owner's.

## Prior state (2026-09-06, THIRD session — S2 CARD IMPORT BUILT + COUNCIL-CLOSED; superseded above where it speaks)

- **S2 (card import, §10-S2) is BUILT + COUNCIL-CLOSED, the full standing cadence in one
  session:** pinned Opus build **`f6aa640`** (`card_import.py` ~604 lines · the three
  containers with magic-byte sniffing, ccv3-wins, CHARX opening `card.json`+icon ONLY ·
  the V1→V2→V3 ladder + the normative SOUL recipe pinned by two goldens · the recursive
  strip pass · `POST /agents/import` composing the existing writes · the additive
  `agents` media namespace · `roleplay.card_import` caps · **the §7/F9 move:
  agent.yaml now writes through `edit_config_yaml`+`sync_mapping`, 0600/quoted/
  comment-preserving, for imports AND the editor's PUT**) → main-seat audit (all 12
  deviations ACCEPTED) → blind Emma **SHIP WITH FIXES: 8 MED · 1 LOW, sweep "none"**,
  four reviewer-REPRODUCED → rulings (7 fixed lean; **MED-1 multipart-spool ingress
  DEFERRED to Phase 19** — `voice.stt` ships the identical posture) → fix wave
  **`6d0711d`** (exact spec discriminator · hostile-JSON containment · JPEG-glued
  CHARX · V3 nickname→`{{char}}` · `_yaml11_safe` quotes KEYS · `dealias_mapping`
  scoped to agent.yaml · V1 heuristic widened · RFC 6901 strip paths) → **confirm: all
  8 RESOLVED with line proof, both rulings accepted, zero new.** Gate 6/6 throughout;
  **BE 2,315** (counts in QUALITY.md). Full record = **plan §13-S2**; residuals (all
  recorded, none owed) live there — headline: the multipart-spool class + the
  `UploadPart` vanished-dir 500 class are Phase 19 register material.
- **Next slice = S3 (lorebooks, §10-S3)**, one slice per session, the owner's word
  opens it. **The S3 session-close scout is already in the plan:** the owner picked
  **`Simple Personality Traits.json`** (their ST install's worlds folder) as the
  import-test book (§6.7 — 36 secondary-key entries, the character-instructions
  class); the S3 brief must pin the **position-downgrade rule** (real books use ST
  positions 0–4 vs our `head|tail`, §6.5) and S5 carries the owner's
  collapsed-entry editor requirement (§6.6). The ⚠ S4 obligation (FE sends
  `message.agent` on TTS) and the ops note
  (hermes emma rounds run FOREGROUND-detached — `setsid nohup` from a foreground call;
  beware `pgrep hermes_cli.main` matching the unrelated gateway daemons) both stand.
- **The session tail ran three owner-driven items (all in plan §13-S2's tail):**
  ① **the live probe on a REAL card PASSED** — the owner picked the ST install's
  `Lynette.png` (dual-chunk ccv3+chara): 201 first shot, V3 precedence + warning, full
  mapping, quoted stash, 0600 agent.yaml, avatar bound, pinned thread seeded her
  greeting rendered (record `475c1b9`; **Lynette is LIVE on dev — the owner can pick
  her from :5173 and talk**). ② **the owner's ST persona "Ari" imported** into
  `roleplay.persona` via the Conf settings API (dev config). ③ It surfaced the S0
  macro hold-out with field evidence (the description opens with `{{user}}`) —
  **owner-ruled FOLD `3b63b24`: `roleplay.persona.description` joins the macro pass**
  (one line, `_scenario`'s idiom, pinned test; §4.3 + §13-S0 amended; **BE 2,316**,
  gate 6/6). The dev backend runs the fold tip; dev units stay RUNNING (D69 presence
  observation continues).
- **Git: 44 commits unpushed over origin `04769d9`** (the 38 at session open +
  `f6aa640` S2 + `6d0711d` its fix wave + `2892adf` S2 docs + `475c1b9` probe docs +
  `3b63b24` the persona fold + this docs commit); working tree clean; the PUSH ruling
  stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline
  (Dependabot D1 → push → release E, config migration 2→3, rollback = config backup
  FIRST then v1.7.7) is unchanged and still owed; sequencing is the owner's.

## Prior state (2026-09-06, SECOND session — D70 RATIFIED · S0 BUILT + COUNCIL-CLOSED · the app-logging fix; superseded above where it speaks)

- **D70 IS RATIFIED (the owner, in conversation) and wired (`f328d9f`):** the DECISIONS
  entry, the plan's status header, the CLAUDE.md doc-map row, and the TODO **Phase 23**
  block (S0–S7). `ROLEPLAY_PLAN.md` is the spec of record, authority as its header states.
- **S0 (the assembly core) is BUILT + COUNCIL-CLOSED, the full standing cadence in one
  session:** pinned Opus build **`786698c`** (the twelve §3.1 fields · `roleplay:` config ·
  both §4.1a duties texts verbatim as registry entries · `macros.py` · the universal
  Voice/Duties head + the three §4.2 emissions · goldens re-pinned, none weakened) →
  main-seat audit (8 deviations, all ACCEPTED — headline ruling: `{{original}}` carries no
  second `## Voice` heading, the two-heading shape dominates) → blind Emma round **SHIP
  WITH FIXES: 1 MED (conf 0.98), seven areas confirmed sound, sweep "none"** (a valid
  token matched inside a 4+-brace malformed run; `{{original}}` amplification) → main-seat
  fix wave **`fc3901d`** (pattern lookarounds + `_first_only` re-driven off the exported
  `TOKENS` pattern — one token definition everywhere; the ruling also caught and fixed the
  once-rule's literal-substring first-slot steal) → **confirm RESOLVED conf 0.99, zero new
  findings.** Gate green throughout. Full record = **plan §13-S0**.
- **S1 (greeting + example dialogue + voice) is ALSO BUILT + COUNCIL-CLOSED, same
  cadence, same session:** Opus build **`cdf2ccb`** (the shared seeder on exactly the
  two interactive seams — `POST /threads` agent pin + post-route chat seeding; `<START>`
  parsing to ST's named pseudo-messages; the one-line normalizer boundary rule;
  `POST /voice/tts` `agent` param) → audit (all 10 deviations ACCEPTED) → **the live
  probe on the real primary PASSED** (qwen/corsair: greeting seeded + an in-character,
  honest-under-no-tools reply — the conversational duties text behaving exactly as
  designed) → blind Emma **SHIP WITH FIXES: 3 MED** (name-in-frame on strict templates ·
  longest-prefix speaker matching · voice passed as-is) → fix wave **`b26657d`** (+ the
  httpx→WARNING journal rider) → **confirm: all RESOLVED, both trims accepted, zero
  new.** **BE 2,251** (counts in QUALITY.md). Full record = **plan §13-S1**.
  **⚠ S4 obligation recorded: the FE must send `message.agent` on TTS calls** — until
  then per-agent voice is wired but unexercised end-to-end. **Next slice = S2 (card
  import, §10-S2)**, one slice per session, the owner's word opens it. *(Ops note: the
  hermes emma lane's BACKGROUNDED runs died instantly-killed several times this session;
  foreground runs succeed — run her rounds foreground until diagnosed.)*
- **The 09-06 opening item CLOSED — the presence mystery was a LOGGING bug, not the
  phone:** the backend NEVER configured Python logging (no `basicConfig` anywhere), so
  every app-level INFO line — the whole D69 presence trail, the D2-A monitor lines — was
  dropped by the handler-less root logger since forever, dev AND prod. Fix **`c79d9f4`**:
  one `logging.basicConfig(level=logging.INFO)` at the `main.py` import chokepoint;
  proven live within one tick (`presence: phone/tailnet unseen -> online` ·
  `phone/lan unseen -> offline`). **The D69 2–3-night observation clock TRULY starts
  09-06 night; dev units stay RUNNING.** First data point: tailnet online / LAN offline
  at 10:51 while the owner was home — watch whether LAN pins offline (Android ICMP
  power-save class vs a reservation problem). ⚠ Prod (v1.7.7) still has the blindness —
  the fix rides v1.7.8.
- **Git: 38 commits unpushed over origin `04769d9`** (the 30 at session open + `c79d9f4`
  logging + `f328d9f` D70 + `786698c` S0 + `fc3901d` its fix + `e662da1` its record +
  `cdf2ccb` S1 + `b26657d` its fix + this docs commit); working tree clean; the PUSH
  ruling stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.**
  The v1.7.8 pipeline is unchanged and still owed (Dependabot D1 bump → push → release E
  per the corrected 09-04 line: config migration 2→3 rides it, rollback = config backup
  FIRST then v1.7.7, pre-tag LOCAL e2e + the three-wave stale-pin sweep) — the roleplay
  phase does NOT block it; sequencing is the owner's.
- **Standing next-next (owner):** LIVE VOICE / CALL MODE after the roleplay phase — start
  at [`R51`](./research/R51-realtime-voice-chat.md), buy only the delta.

## Prior state (2026-09-06, FIRST session — THE CHARACTERS+LOREBOOKS DESIGN SESSION: ROLEPLAY_PLAN COUNCIL-CLOSED, awaiting ratification → D70 → S0; superseded above where it speaks)

- **THE INITIATIVE (the owner's new direction, 2026-09-05/06): SillyTavern-class conversational
  characters — characters ARE agents, one flat system — plus lorebooks as a first-class
  subsystem.** The whole design road ran in this session: 8 owner design rounds in conversation
  (all 21 rulings in the plan's §1) · **four dossiers bought + committed: R64** (roleplay
  prompting) · **R65** (lorebook semantics, deep) · **R66** (card import + editor UX) · **R67**
  (gallery/transcript/voice UX) · an evidence coverage map (§12) on the owner's audit ask · the
  full council cadence (§13): **blind Emma design round BUILD WITH CHANGES (15 findings, ALL
  accepted + folded — her citation check killed 4 plan overreaches) → confirm 13/15 → the 4
  residuals fixed → micro-confirm CONFIRMED.**
  **Spec of record = [`ROLEPLAY_PLAN.md`](./ROLEPLAY_PLAN.md), COUNCIL-CLOSED.**
- **▶▶ THE NEXT SESSION OPENS ON THE OWNER'S RATIFICATION** of that plan → then, in order:
  the **D70** DECISIONS entry + the CLAUDE.md doc-map row + the TODO phase wiring → **the S0
  build brief** (pinned Opus build; S0 = the assembly core — AgentDef fields · macro pass ·
  Voice/Duties split · post-history tail · golden-fixture assembly pins) → S0–S7 per plan §10,
  one slice per session under the standing cadence.
- **Also this session:** ① **a shipped 09-04 bug found in the opening review + FIXED
  (`a2b04fa`):** the ruamel(YAML 1.2) writer emitted Conf-saved `23:00` unquoted; the
  PyYAML(1.1) loader read it as int 1380 → config preflight refused every boot — **dev was
  DOWN 09-04 22:13 → 09-05 ~13:00** (the 09-04 handoff's "dev RUNNING" claim was stale).
  Fix = `_yaml11_safe` quoting at the write chokepoint + 3 tests; BE suite 2,192 green.
  ② **Read-along: the owner's device round PASSED → default flipped ON** (`bec878d`, D63
  amended; ships with v1.7.8). ③ Read-along + roleplay memory files updated.
- **⚠ D69 presence observation: NO transition lines logged yet** — the bricked night lost, and
  since the fix `grep presence:` returns ZERO while the backend served fine (wake_host POSTs
  visible). Either the phone genuinely never transitioned (stayed on WiFi) or the observation
  logging needs a look — **next session eyeballs this before trusting any gap picture**; the
  2–3-night clock effectively starts once lines are confirmed flowing. **Dev units stay
  RUNNING for the observation — do NOT stop them at session close/start.**
- **Git: 29 commits unpushed over origin `04769d9`** (the 09-04 ten + this session's fix +
  the read-along flip + R64–R67 + the plan's design/council commits + this docs commit);
  working tree clean; the PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @
  `578ffa7`.** The v1.7.8 pipeline is unchanged and still owed: the Dependabot D1 lockfile
  bump → push → **release E per the corrected 09-04 line (config migration 2→3 rides it;
  rollback = config backup FIRST, then v1.7.7; pre-tag LOCAL e2e + the three-wave stale-pin
  sweep)** — the roleplay phase does NOT block the release; sequence at the owner's pleasure.
- **AFTER the roleplay phase (the owner's close-of-session ask, 2026-09-06): LIVE VOICE /
  CALL MODE** — "as real-time as we can" voice chat. **START AT [`R51`](./research/R51-realtime-voice-chat.md)
  — the deep dossier already exists** (2026-08-21: the owner's own RealtimeVoiceChat fork +
  Speaches `/v1/realtime` probed + a RANKED build menu; consumer line = ROADMAP §C4 stub; the
  owner's "interesting GitHub projects" are largely already read there). Buy only the delta
  (re-verify the Speaches pin — it moves) before any design talk.

## Prior state (2026-09-04 — THE TWO PRE-RELEASE FEATURES: C3-S2 read-along + the D2-C LAN wake trigger, BOTH BUILT + REVIEW-CLOSED; superseded above where it speaks)

- **The owner picked from the menu: two features ride before v1.7.8** — the C3 S2 read-along
  ("research it again, make sure the plan is solid") and their own new idea, the **LAN-arrival
  wake trigger + quiet hours** (reopening ROADMAP D2's rejected option C). Both went the whole
  road in one session: research (**R63** bought + committed; the read-along got a fit-verification
  pass against HEAD instead — R48/R50 stand) → plans of record → **blind Emma design rounds (both
  BUILD WITH CHANGES, every finding folded, confirm + micro-confirm to explicit closes)** → owner
  rulings taken in conversation → Opus builds → main-seat audits → **blind Emma CODE rounds (both
  SHIP WITH FIXES → fix waves → the LAN confirm round)**. Full records: **[`D69`](./DECISIONS.md)**
  (the LAN trigger) + **D63's 2026-09-04 amendment** (read-along as-built); plans + all review
  records archived at `~/.cache/ctrl-b-plans-20260904/`.
- **8 commits, LOCAL over origin `04769d9`, NOTHING PUSHED:** `968d18d` R63 docs · `5277da2` S2a ·
  `e0dcaed` the S1-shipped strikethrough-`$2` fix (builder-found) · `7de0e98` S2b · `53bc104` the
  read-along fix wave · `165fe63` L1 · `318d4d6` L2 · `996b872` the LAN fix wave (+ this docs
  commit). **Gate at tip: 6/6 green — BE 2,189 · FE 2,906/168** (independently re-run by the main
  seat after a two-builder git-index collision, recovered + verified intact).
- **⚠ v1.7.8 NOW CARRIES A CONFIG MIGRATION (step 3, config_version 2→3** — `presence_device_ips`
  → `presence_devices` objects): menu item E's "NO config/DB migration" line is STALE — **rollback
  off v1.7.8 = restore the config backup FIRST, then v1.7.7** (the proven §Rollback order). No DB
  migration.
- **Dev units RUNNING on tip; the dev config MIGRATED to shape 3** (backup
  `~/.ctrl-b-dev/backups/config.yaml.20260904T200408Z`; **prod untouched: v1.7.7 @ `578ffa7`**,
  still config_version 2) and pre-loaded for the owner: device `phone`
  (tailnet 100.64.151.87 · **LAN 192.168.1.143**) · `lan_health_ip: 192.168.1.1` (the router,
  read from emma's routing table) · quiet hours 23:00–08:00 · **no host has `wake_on_presence`,
  so nothing can fire — observation only**; `chunk_read_along` is OFF (the owner flips it in Conf
  to hear read-along).
- **Owed the owner (their word, no build) — session-close update 2026-09-04:** ① the read-along
  feel round on dev :5173 — **the owner tests TOMORROW MORNING (2026-09-05)**; flip the Conf
  toggle, long replies show the win · ② ~~set the DHCP reservation~~ → **DONE — the owner
  confirmed .143 is already reserved on the router** · ③ after 2–3 nights, read the presence
  journal's gap picture (`journalctl --user -u ctrl-b-dashboard-dev | grep presence:` — the
  INFO transition lines), then flip `wake_on_presence` on the chosen hosts (and tune
  `lan_offline_after_s` from evidence) · ④ the Dependabot D1 lockfile bump (5 HIGH, all
  transitive dev-toolchain — fast-uri via stylelint, browserslist via babel/vite; one
  `npm audit fix`-class commit, triaged 2026-09-04) is the one hygiene item still owed before E.
- **The next session opens on the owner's round results** (read-along feel · anything the LAN
  observation logged overnight): findings → fix waves per the standing cadence; then the
  Dependabot bump · the PUSH ruling (now 10 commits) · **E, the v1.7.8 release** per the
  corrected line below. Dev units stay RUNNING for the owner's round — do not stop them at
  session start.
- **Then the menu's E — the v1.7.8 release** (runbook §Release, Opus-operated · **the 2→3 config
  migration rides it** · rollback = config backup then v1.7.7 · pre-tag LOCAL e2e MANDATORY + the
  stale-pin sweep now covering THREE waves' strings: the fleet wave's labels, the
  attachments/expand strings, AND this session's Conf wake-group renames) → stop the dev units.
- Residuals recorded in D69/D63 (none owed): the fleet sweep's plain-gather exposure → Phase 19 ·
  no automated stale-reservation warning · the read-along device-round pair (autoplay grants ·
  TTS-vs-dictation on speakerphone).

## Prior state (2026-09-03, FINAL — PUSHED: origin = local `main` = `a478bb6` (+ the menu commit); THE RELEASE IS HELD; supersedes below where it speaks)

- **The batch is on origin** (43 commits over `a558d43`, pre-push full gate green; the fleet-wave
  polish + the whole Phase 22 ladder + the S6 fix wave + re-rounds №1–№4b). **The v1.7.8 candidate
  is DELIBERATELY HELD** — the owner: more items go in first. Prod untouched: **v1.7.7 @
  `578ffa7`**. Dev units RUNNING. ⚠ GitHub flagged **2 HIGH Dependabot alerts** at push — untriaged.
- **The next session OPENS ON THE MENU BELOW (owner ask: "the whole menu of things to do… so we
  can decide") — present it, take the pick(s), then work the slice.**

## ▶▶ THE PRE-RELEASE MENU (2026-09-03 — ALL the recorded options; the owner picks, nothing owed)

**A · Owed owner rounds (no build):**
 A1. Phase 22 CLOSE — the owner's word (all S6 re-rounds live on dev :5173; the stopped Emma
     closing-probe round re-runs on ask — every earlier finding RESOLVED).
 A2. The prod device pair, standing since v1.7.6: F1 notifications test (master ON → background →
     host transition → tap lands on Fleet) · icon-backdrop fresh install.
 A3. Edit a prompt FOR REAL (Phase 18's first owner-driving; easier post-release, allowed anytime).
 A4. Phase 21 live-use deferrals (ride daily prod use, no session needed): autoscroll on a long
     grid · a >15 MB 413 refusal · the multi-window cast walk.

**B · Build candidates (small/medium, greenlit or recorded):**
 B1. C3 S2 read-along (greenlit 2026-08-20, build on ask).
 B2. D2-A wake-on-presence PROD enable — live-proven 2026-08-30; one machine-editor toggle.
 B3. ISS-10 ② composer glyph cross-fades (owner-parked; one-word revival, recipe in R52 §8.2).
 B4. Phase 22 feel residuals (plan §11): the stack-release direction unanimated · the sheet
     no-rail corner geometry (a talk, not a bug) · keyboard-focus hand-off at the clip's swap.
 B5. W10 residuals (MEDIA_MANAGER_PLAN §12): re-crop generation loss · the 412-on-lost-response
     class · bundled re-art inherits a stored point · delivery-never-throws.

**C · Design talks (no code):**
 C1. A13 — the OpenAI-OAuth/Codex provider talk (owner: "maybe later", standing).
 C2. The parked ledger sweep (§P discipline — only on explicit ask; §P items never re-proposed).

**D · Hygiene:**
 D1. **The 2 HIGH Dependabot alerts (NEW at this push)** — triage first: real dep or archive-class?
 D2. F13 eslint backlog (73 warnings, trigger-gated; counts live in QUALITY.md).
 D3. Re-run the stopped Emma closing-probe round on the height-transition retarget (optional).

**E · THE CLOSER — the v1.7.8 release candidate** (when the owner says the menu is done):
 runbook `deploy/linux/README.md` §Release, Opus-operated · NO config/DB migration · rollback
 v1.7.7 · **pre-tag LOCAL e2e MANDATORY** + the stale-pin sweep over the fleet wave's labels AND
 the attachments/expand strings (three tags have burned on this class) · then stop the dev units.

**LAST, never leading a menu: Phase 19 (D58)** — owner ruling 2026-08-29: it rides the 1.8
endgame (Emma's lane-stall MED, CM-1, H-E2E's flake register all fold in); 1.8 stays RESERVED
for the final ROADMAP/ISSUES cleanup wave.

## Prior state (2026-09-03, cont. — THE S6 RE-ROUNDS №1–№3: the owner's live feel findings, built same-day; superseded above where it speaks)

- **After the fix wave closed, the owner drove THREE more live rounds in conversation, all built +
  reviewed same-day** (full record = [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11's
  S6-RE-ROUNDS block): **№1** the line pill's CONTROL STACK (mic over send once the column FITS —
  painted-height currency, controls-aware needs, the one-flip-per-input LATCH; 4 review rounds to
  converge) · **№2** the FEEL round (the 150ms height transition — an owner-ruled scoped §14.11
  exception — the mic's stack-hop, the toggle on the lane centreline, the 20px glyph) · **№3** the
  112px resting ceiling (= the control column exactly, so the trio stacks at rest from 5 lines)
  **+ the live-height RETARGET** (mid-flight re-measures now retarget the transition instead of
  snapping it — MutationObserver-diagnosed, Chromium-probed green in both geometries).
- **THE PUSH RULING LANDED (owner, 2026-09-03): the whole batch goes to origin; THE RELEASE IS
  HELD** — the owner wants more items in before the v1.7.8 candidate ("we had some other things we
  could do before that"). Re-rounds №4/№4b rode the tail (`9fd66ea`+`2d8f349`: the line field's
  side paddings, closed on the owner's measured symmetry rule — text↔glyph = glyph↔pill-edge =
  18/18/18, screenshot-proven). When the release DOES go: runbook §Release, Opus-operated · NO
  migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over the fleet wave's
  labels AND the attachments/expand strings.
- **⚠ THE FINAL Emma closing-probe round was STOPPED before a verdict** — every earlier finding is
  explicitly RESOLVED, but MED-1's closure rests on the main-seat's own probes; re-run her round on
  the owner's word if wanted. **The owner's word still closes Phase 22.**
- **Gate at tip: FE check-all exit 0 — 2,849/167** (BE untouched since 2,145). Local `main` =
  origin `a558d43` + **43 commits** (incl. re-round №4: the line field's side paddings 4/2 — the
  text hugs the menu lane and the clip, `9fd66ea`), NOTHING PUSHED. Prod untouched: **v1.7.7 @ `578ffa7`**. Dev
  units RUNNING; :5173 serves everything (the owner's dev config runs the LINE composer — that fact
  explained a whole review-round divergence).

## Prior state (2026-09-03 — THE S6 FIX WAVE: the owner's device-round findings built + council-CLOSED; superseded above where it speaks)

- **The S6 owner round LANDED (3 findings) and its fix wave ran the whole cadence in one session:**
  design → blind Emma design round (BUILD WITH CHANGES, 6 MED · 1 LOW, sweep "none") → all seven
  main-seat-ruled → Opus build **`8dce2ca`** → main-seat audit (+ rider `4eb92e4`) → confirm round
  (6/7 RESOLVED; MED-6 survived TWO more rounds: `9a8b6d9` the projection's own 1M-char thumb
  budget, `ee2bf55` the prefix rule) → **final micro-confirm: RESOLVED, zero new findings.** Full
  record = [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11's S6-fix-wave block (+ the §7 rider).
- **What changed for the owner:** with files staged, the clip and the expand toggle live in the
  rail's control TAIL at the composer's top-right (clip right above the send; Telegram corner for
  the chevrons) and the field row gets its width back; staged attachments now SURVIVE the Android
  tab discard (persisted rows + JPEG thumbs, restored on load; a >24h-stale chip refuses at send
  with the server's own sentence). No-rail placements and the expand BEHAVIOR are unchanged
  (owner-accepted).
- **Gate at tip: 6/6 green — BE 2,145 · FE 2,841/167 · attachments e2e 10/10 both projects**
  (incl. the new stage→reload→send scenario). Local `main` = origin `a558d43` + **32 commits**
  (this docs commit included), **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**.
- **Dev units RUNNING** (:5434 + :5173); the wave is frontend-only, so :5173 serves it live.

## ▶▶ NEXT (2026-09-03 — in order)

1. **The owner re-rounds the S6 fixes on the phone (dev :5173):** the tail (clip above send ·
   corner chevrons) · the app-switch survival (stage → camera app → back: the rail returns on
   thumbnails) · the send after a restore. Their word closes Phase 22 (any new finding → fix wave
   per the standing cadence).
2. **The PUSH ruling** (owner's word) — **32 commits**: the 3 fleet-wave polish + the whole Phase
   22 ladder + this fix wave. Then **release v1.7.8** (runbook §Release, Opus-operated · NO
   config/DB migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over the fleet
   wave's labels AND the attachments/expand strings) → stop the dev units.
3. **Standing menu unchanged:** owner device pair on prod + edit-a-prompt (easier post-release) ·
   A13 design talk · parked ledger · **Phase 19 goes LAST** (1.8 RESERVED).

## Prior state (2026-09-02, cont. — S4 + S5 CLOSED: THE PHASE 22 BUILD LADDER IS COMPLETE; superseded above where it speaks)

- **S0–S5 are ALL council-closed** (every slice: pinned Opus build → main-seat audit → blind
  Emma round → fix wave on main-seat rulings → her explicit RESOLVED close; full records = the
  per-slice blocks in [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11). This session closed:
  **S4** (`e65f02a`+`6c31c1f` — pypdf extraction, both-names-free claim walk + exclusive sidecar
  publish, surrogate-safe; 2 MED reviewer-REPRODUCED) and **S5** (`115178e`+`dbc63ad` — the
  expand affordance as a taller ceiling on the shared chrome seam; the `.line-row` wrapper that
  retired S3's `order:-1` trick; viewport-reactive measurement).
- **Gate at tip: 6/6 green — BE 2,145 · FE 2,799 · the attachments e2e spec green both
  projects.** Local `main` = origin `a558d43` + **27 commits** (this docs commit included),
  **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**.
- **Dev units RUNNING and the dev backend was RESTARTED onto the ladder tip** — :5173 serves the
  whole attachments feature for the owner's round.

## ▶▶ NEXT (2026-09-02, post-ladder — the owner's items, in order)

1. **S6 — THE OWNER DEVICE ROUND closes Phase 22** (plan §9-S6): phone pick/paste/send/re-read ·
   attachment-only photo send · vision on OpenRouter · no-vision on qwen (expect the in-band
   ERROR) · a real PDF · a compacted-thread re-read via the manifest · the expand control on the
   line composer — PLUS the S3/S5 feel items now riding it: the rail/clip geometry · the expand
   behavior (the taller-ceiling ruling is owner-overridable) · the steered-attachment reconcile
   feel. Findings → fix waves per the standing cadence.
2. **The PUSH ruling** (owner's word) — 27 commits: the 3 fleet-wave polish + the whole Phase 22
   ladder. Then **release v1.7.8** (runbook §Release, Opus-operated · NO config/DB migration —
   every D68 config row is additive with defaults · rollback v1.7.7 · pre-tag LOCAL e2e +
   the stale-pin sweep over the fleet wave's labels AND the new attachments/expand strings) →
   stop the dev units.
3. **Standing menu unchanged:** owner device pair on prod + edit-a-prompt (easier post-release) ·
   A13 design talk · parked ledger · **Phase 19 goes LAST** (1.8 RESERVED).

## Prior state (2026-09-02 — S3 BUILT + REVIEWED + CLOSED; superseded above where it speaks)

- **S3 (the FE slice) is CLOSED:** build `bb290ca` → blind Emma round SHIP WITH FIXES (6 MED,
  incl. her Q6 ruling: fix the optimistic-bubble gap in-wave) → fix wave `eb964d2` (the status
  LADDER `uploading→staged→sending→consumed|released`; seam-owned gates; sync admission;
  image-guard scoped; ready-only sendability; the presentational snapshot) → confirm: 1..5
  RESOLVED, MED-6 chained one MED → main-seat tail fix `9d151ab` (the bubble sheds its snapshot at
  release) → **micro-confirm RESOLVED, "none"**. Gate 6/6; BE **2,126** · FE **2,771**; the
  attachments e2e spec green both projects (+ a held-POST accept-window test). Full record =
  ATTACHMENTS_PLAN §11's S3 blocks. The rail/clip geometry is built AS RULED (grammar ②; sheet =
  embedded-field clip left of the mic) — **the owner has NOT yet eyeballed it; S6 carries that.**
- **Local `main` = origin `a558d43` + 21 commits** (16 prior + `bb290ca` + `eb964d2` + `9d151ab` +
  the S2-docs + this docs commit), **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**.
  Dev units RUNNING (⚠ the dev backend predates S1–S3 — restart `ctrl-b-dashboard-dev` before any
  owner poke at attachments).

## ▶▶ NEXT (2026-09-02, post-S4 — in order)

1. **S4 IS CLOSED** (`e65f02a` + `6c31c1f`; blind round 2 MED both reviewer-REPRODUCED + 1 LOW →
   fix wave → confirm RESOLVED, zero new; the S2 sidecar-sweep obligation MET; BE 2,145; full
   record = plan §11's S4 blocks). **S5 (the expand affordance) is next** — main-seat ruling on
   R62 §5's landed evidence (proceeding under the owner's continue directive, S6-overridable):
   ≥3-line trigger · top-right · quiet per §7 · expansion = a TALLER AUTO-GROW CEILING on the
   shared `useComposerChrome` seam (Signal's outcome; no modal, no second editor) · mic untouched
   (peers hide it because their expanded is a mode; ours is a ceiling).
2. **S6 — the owner device round** (plan §9-S6) closes the phase; the owner's word rules. It now
   also carries: the S3 rail/clip geometry eyeball · the S5 expand feel/behavior override · the
   steered-attachment reconcile feel.
3. **The v1.7.8 pipeline still stands** (owner dev test round → PUSH ruling → release, runbook
   §Release · rollback v1.7.7 · pre-tag LOCAL e2e + stale-pin sweep) → stop the dev units.
4. **Standing menu unchanged:** device pair + edit-a-prompt · A13 · Phase 19 LAST (1.8 RESERVED).

## Prior state (2026-09-01, THIRD session, cont. — S2 BUILT + REVIEWED + CLOSED; superseded above where it speaks)

- **The owner ruled (this session): the WHOLE ladder S2→S6 proceeds slice-by-slice under the full
  council cadence** (pinned Opus build → main-seat audit → blind Emma round → fix wave → her
  confirm), S6 staying the owner device round. No per-slice owner gate is owed until S6.
- **S2 (the model feed) is CLOSED:** build `5c827b8` → fix wave `7ea2970` (2 MED · 1 LOW from the
  blind Emma round, main-seat ruled — headline: the D64 whole-line rule BENDS for foreign files,
  CUT at `max_inline_chars` over her price-the-facts fix) → confirm RESOLVED WITH NEW FINDINGS →
  the 1 new LOW folded `b5974f5` (main-seat, `_marker_cost` longest form) → **micro-confirm
  RESOLVED, "none"**. Gate 6/6, BE **2,114**. Full record = ATTACHMENTS_PLAN §11's S2 blocks —
  incl. the **dimensions-notice amendment** (Emma-accepted) and the **⚠ S4 sweep/sidecar
  obligation** (the referenced set must learn sidecars or extraction self-deletes).
- **Local `main` = origin `a558d43` + 16 commits** (12 prior + `5c827b8` + `7ea2970` + `b5974f5` +
  this docs commit), **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**. Dev units RUNNING.

## ▶▶ NEXT (2026-09-01, post-S2 — in order)

1. **S3 (FE)** under the same cadence — the RAIL + quiet clip + the RULED docked-sheet placement +
   the mic-auto-send-with-staged-files test + the GET route/bubble images + attachment-only sends
   + e2e (plan §7/§9-S3).
2. **S4 (PDF)** — pypdf extraction sidecar; **MUST include the sweep referenced-set arm for
   sidecars** (the recorded S2 obligation). Then **S5** (expand affordance) → **S6** (owner device
   round; the owner's word closes the phase).
3. **The v1.7.8 pipeline still stands (the fleet wave, unchanged):** owner dev test round → PUSH
   ruling (16 commits and counting) → release v1.7.8 (runbook §Release, Opus-operated · NO
   migration · rollback v1.7.7 · pre-tag LOCAL e2e + stale-pin sweep) → stop the dev units.
4. **The standing menu unchanged:** owner device pair on prod + edit-a-prompt · A13 · Phase 19
   LAST (1.8 RESERVED).

## Prior state (2026-09-01, THIRD session — THE S1 FIX WAVE: built + Emma-confirm RESOLVED; S1 IS CLOSED; superseded above where it speaks)

- **The S1 fix wave RAN the full cadence and CLOSED:** main-seat rulings on all five recorded
  findings (each re-derived to the leanest fix) → ONE Opus build from a pinned brief
  (**`eff4bfd`**: MED-1 `_real_root()` fail-closed housekeeping via `require_real_dir` reuse ·
  MED-2 the pre-txn re-peek in `_drain_steers` · LOW-3 the recursive live-route walker + non-empty
  harvest in BOTH no-POST pins · LOW-4 the four-seam only-writer grep · Q10 `created_here` +
  `threads.delete()` before the 409) → main-seat audit (both declared deviations ACCEPTED: the two
  old Q10 pins rewritten in place; the drain-helper duplication recorded) → **Emma confirm round
  (resumed session): RESOLVED, all five with line proof, zero new findings, open sweep "none"** —
  she explicitly accepted the MED-1 root-only and LOW-4 named-seam scope rulings. Gate 6/6 green,
  BE 2,068→**2,075**. Full record = [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11's S1-FIX-WAVE
  block. **S1 is DONE; the owner's word gates S2.**
- **Local `main` = origin `a558d43` + 12 commits** (the 10 prior + `eff4bfd` + this docs commit),
  **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**. Dev units RUNNING (unchanged).

## ▶▶ NEXT (2026-09-01, post-fix-wave — in order; supersedes the lists below)

1. **The owner's word on S2** (the per-slice gate is satisfied: build + audit + Emma RESOLVED).
   Then **S2 → S6 per plan §9**, one slice per session under the budget directive: S2 model feed →
   S3 FE → S4 PDF → S5 expand → S6 owner device round.
2. **The v1.7.8 pipeline still stands (the fleet wave, unchanged):** the owner tests on dev
   (:5173) — the retimed morph · the pick-grow · a REAL reboot (⚠ dev drives the real fleet) →
   the PUSH ruling (now 12 commits) → release v1.7.8 (runbook §Release, Opus-operated · NO
   migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over both waves' labels)
   → stop the dev units.
3. **The standing menu unchanged:** owner device pair on prod + edit-a-prompt (easier
   post-release) · A13 design talk · parked ledger · **Phase 19 goes LAST** (1.8 RESERVED).

## Prior state (2026-09-01, SECOND session — THE S1 EMMA ROUND: review RAN + RECORDED, NO fix wave; superseded above where it speaks)

- **The owed S1 Emma-lane round RAN and is RECORDED — NOTHING fixed, nothing built** (owner
  directive at ~98% weekly usage: no fix wave, hand off; the fix wave opens the next session).
  Blind sol high (`--ignore-rules`, the Hermes emma lane) over `fce822e` + `adfddf6` against plan
  §2/§3/§8/§9-S1, R46 brief (known-findings exclusion list · the recorded LOW as an explicit
  question-10 ruling ask · bounded open sweep). **VERDICT: SHIP WITH FIXES — 2 MED · 2 LOW ·
  Q10 = FIX · open sweep "none"; she ran the focused suites herself (127 green).**
- **The findings live verbatim in [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11's
  S1-Emma-round block** (the scratchpad copy was tmpfs — the plan block IS the record).
  Headlines: **MED-1** (conf 0.99, reviewer-REPRODUCED) — the boot sweeps + thread-delete
  cleanup follow a SYMLINKED attachments root and delete outside `$CTRLB_HOME`; fix = fail-closed
  root/ancestor check. **MED-2** (0.94) — a steer deleted/harvested DURING its multi-file claim
  still persists its message; fix = ownership re-check immediately before the transaction.
  **LOW-3/LOW-4** — both new architecture pins are weaker than their names (schema-hidden
  POST/multipart escapes the OpenAPI pin · the claim-only-writer pin greps a literal).
  **Q10** — she rules FIX: `created_here` → the existing `ThreadRepo.delete()` in the
  `StoreWriteError` branch before the 409. Sound-checks explicitly cleared the load-bearing
  areas (claim exclusivity both orderings · the admission ladder · part-union additivity ·
  steer coalescing · the media refactor behavior-preserving).
- **Local `main` = origin `a558d43` + 9 commits + this docs commit, NOTHING PUSHED.** Prod
  untouched: **v1.7.7 @ `578ffa7`**. Dev units RUNNING (unchanged this session).

## ▶▶ NEXT (2026-09-01, post-review — in order; supersedes the lists below)

1. **The S1 fix wave (the next session's FIRST move):** main-seat rulings on the recorded round
   (plan §11 — findings are advisory; re-derive the leanest fix per finding: MED-1/MED-2 look
   fix-worthy, LOW-3/LOW-4 are pin strengthenings, Q10's FIX is small and she named the seam) →
   ONE Opus fix wave from a pinned brief → main-seat audit → the Emma confirm round (try
   `--resume latest --in /home/emma/github/ctrl-b` first — context-intact beats a fresh agent;
   re-state `--ignore-rules`) → gate green → **the owner's word before S2.**
2. **S2 → S6 per plan §9**, one slice per session under the budget directive (unchanged): S2
   model feed → S3 FE → S4 PDF → S5 expand → S6 owner device round.
3. **The v1.7.8 pipeline still stands (the fleet wave, unchanged):** the owner tests on dev
   (:5173) — the retimed morph · the pick-grow · a REAL reboot (⚠ dev drives the real fleet) →
   the PUSH ruling (now 10 commits) → release v1.7.8 (runbook §Release, Opus-operated · NO
   migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over both waves' labels)
   → stop the dev units.
4. **The standing menu unchanged:** owner device pair on prod + edit-a-prompt (easier
   post-release) · A13 design talk · parked ledger · **Phase 19 goes LAST** (1.8 RESERVED).

## Prior state (2026-09-01 — THE A8 SESSION: composer attachments designed → council-closed → S0+S1 BUILT; superseded above where it speaks)

- **Local `main` = origin `a558d43` + 8 commits, NOTHING PUSHED**: the 3 fleet-wave polish commits
  (`eed7045`/`b7033c3`/`223bc5c` — the v1.7.8 material; **the owner's test round on those is
  STILL OWED**, item 3 below) + **5 A8 commits** (`f2e3b98` design docs · `756996b` S0 ·
  `fce822e` **S1 build** · `0aa7f22` R62+v2.3 · `adfddf6` S1 audit record). Prod untouched:
  **v1.7.7 @ `578ffa7`**. Dev units RUNNING (the owner used them for the HEIC check).
- **Phase 22 (ROADMAP A8, composer attachments) OPENED — D68 RATIFIED.** Spec of record =
  [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) **v2.3**: full council trail in its §11 (Emma
  blind + adversarial Opus, both to explicit closes; transport B unanimous; the UX amendment
  round Emma-CLOSED). Evidence = **R61** (chat-attachments field) + **R62** (attach-composer
  grammar), both indexed. Owner rulings locked: images+text+PDF, NO RAG · durable per-thread
  files + the `read_attachment` re-read tool · **the in-composer h-scroll thumbnail RAIL** (NO
  Telegram caption modal — Telegram gives only the quiet clip style + the expand button) · mic
  never blocked by staged files · the expand affordance = slice S5 (≥3 lines, top-right,
  fullscreen; rides `useComposerChrome`, line composer renders the trigger) · **bubble image
  display IS v1** (owner overrule of the no-GET-route call) · minimal no-vision floor (per-hop
  strip, `input_modalities`).
- **S0 ✅** (`756996b`; the HEIC device check RAN — the Honor 20's camera photos arrive as
  JPEG). **S1 ✅ BUILT** (`fce822e`, Opus from the pinned brief; **gate 6/6 green, BE
  2,002→2,068, 66 new tests**) **+ main-seat audit DONE** (`adfddf6`): all 11 declared
  deviations ACCEPTED — headline: the claim lands by `os.link`+`os.unlink` exclusive-claim (the
  plan §3's `os.replace` would have clobbered the collision suffix; §11 records the correction) —
  and the builder's discovery that the D65 no-POST pin's route-table loop matched NOTHING under
  this FastAPI was main-seat-confirmed and FIXED in place (OpenAPI-paths assertion).
- **⚠ BUDGET (owner, 2026-09-01): ~91% of the weekly usage limit.** STANDING until reset:
  **pause between each slice**, no back-to-back council marathons. The S1 Emma round was
  deliberately NOT launched under this directive — it is the next session's first move.

## ▶▶ PRIOR (2026-09-01 — the A8 session's list): ✅ item 1 RAN in the second session (the block above is the record; superseded)

1. **The S1 Emma-lane review round (OWED — the per-slice gate):** blind sol round over
   `fce822e` + `adfddf6` against plan §2/§3/§9-S1 — include the recorded LOW (a first-send whose
   claim refuses leaves its freshly created thread empty; rule fix-or-accept). Fix wave on
   findings, then the owner's word before S2.
2. **S2 → S6 per plan §9**, one slice per session under the budget directive: S2 model feed
   (assembly branch · estimator arm · the per-hop strip named `drop_unsupported_modalities` ·
   `read_attachment` + `InvocationContext.thread_id` · compaction manifest) → S3 FE (the RAIL +
   quiet clip + ruled docked-sheet placement + the mic-auto-send-with-staged-files test + the GET
   route/bubble images) → S4 PDF → S5 expand → S6 owner device round.
3. **The v1.7.8 pipeline still stands (the fleet wave, unchanged):** the owner tests on dev
   (:5173) — the retimed morph · the pick-grow · a REAL reboot (⚠ dev drives the real fleet) →
   the PUSH ruling (now 8 commits) → release v1.7.8 (runbook §Release, Opus-operated · NO
   migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over both waves' labels)
   → stop the dev units.
4. **The standing menu unchanged:** owner device pair on prod + edit-a-prompt (easier
   post-release) · A13 design talk · parked ledger · **Phase 19 goes LAST** (1.8 RESERVED).

## Prior state (2026-08-31 — THE PRE-RELEASE POLISH SESSION: the feel pair + REBOOT as the third pending kind, built + review-CLOSED + committed; superseded above where it speaks)

- **Local `main` = origin `a558d43` + 3 commits** (`eed7045` the feel pair · `b7033c3` the reboot
  kind · the docs commit carrying this block). **NOTHING PUSHED this session — the push ruling is
  the owner's.** Prod untouched: **v1.7.7 @ `578ffa7`**. **Dev units deliberately LEFT RUNNING**
  (:5434 + :5173) — the owner said they'll test the new things; do not stop them at session start.
- **The session ran the 2026-08-30 pre-release menu's quick items, owner-ruled in prose:**
  - **`eed7045` — the gacha feel pair.** ① The dossier-open morph retimed (the owner: "the first
    half is just too quick"): flight 560→**500ms**, portrait cross-fade 280→**340ms** — the fade
    now rides 68% of the arc so the poster's sheared crop un-crops across most of the glide
    instead of snapping into the full frame early; the rarity-badge hold-back legs rescaled
    560→500ms so the badge still lands with the frame. ② The pick swap got a subtle **160ms
    one-way grow** on the newly picked band — an ANIMATION on `.picked`, deliberately not a
    transition on the base slice: the outgoing band still snaps down, which is what keeps the
    V-POSTER trial's collide/zoomed-out beat dead. Reduced-motion gated. (Menu item ② — the
    dossier-open outgoing-leg knob — was CLOSED without build: the owner ruled the dossier fine.)
  - **`b7033c3` — REBOOT joins the pending power transitions (D67 amendment, in DECISIONS).**
    The only TWO-PHASE kind: online at dispatch, so agreement = observed DOWN (recorded as
    `sawDown` on the entry, copy-on-write) then observed UP; ceiling **5 minutes** (owner-ruled,
    `REBOOT_WINDOW_MS`; the windows are a `Record<PendingKind, number>` table now).
    `overlayPending` presents the COMMANDED END STATE per kind — shutdown→offline,
    reboot→**ONLINE** (the restart's dip never reads as a lost member); never fabricates a
    status. Chips + all three gacha label helpers say **REBOOTING** via one `livenessWord`
    precedence (rebooting > online > waking > sleeping — reboot outranks online because the
    overlay presents it AS online); the cover's develop ceremony gates on the WAKE kind
    specifically. **The gacha seam MIGRATED rather than grew a sibling set**:
    `GachaTrackProps.waking: ReadonlySet` → `pending: ReadonlyMap<string,{kind}>` (the store map
    handed down whole; the extend-not-migrate rule decided it). +16 tests → FE **2,672/160**.
- **The council trail (the standing cadence, whole):** Emma-lane blind design round (sol high,
  `--ignore-rules`) **BUILD WITH CHANGES** — 2 LOW, both test obligations, both folded (the
  reboot-overlay store pin · rebooting-outranks-online label asserts); open sweep "none"; the CSS
  feel pair reviewed in the same round, declared sound → Opus 5 build from a pinned brief →
  main-seat audit accepted its two deviations (the module-private `livenessWord` dedup · the
  shared agreement expression flipped to `kind === "shutdown" ? !online : online` so
  post-`sawDown` reboot rides the wake line) → Emma confirm round **RESOLVED, zero new findings**
  (she re-ran the full gate herself). Gate green per commit.
- **Residual recorded, not fixed (builder-found, out of scope):** `REBOOTING` is one character
  wider than `SLEEPING`, and `layout.spec.ts`'s 5★ pair-card collision breakpoint was measured
  against `SLEEPING` in the 366–380px band — transient (bounded by the 5-min window), unpinned by
  any assertion; one owner eyeball if a rebooting card is ever caught at that width.

## ▶▶ PRIOR (2026-08-31 — the owner tests, then the release): items 1–3 = today’s NEXT item 3; superseded above

1. **Collect the owner's round on dev (:5173)** — they said they'll test the new things: the
   retimed open morph (the 340ms fade is the knob if it still reads abrupt — feel, not
   mechanism) · the pick-grow's subtlety (160ms is tunable) · a REAL reboot on a machine they can
   afford to restart (expect: tile holds steady + REBOOTING chip through the whole restart,
   actions disabled, clears on the polls seeing it back — or at 5 min if it never returns).
   ⚠ Dev drives the real fleet — a reboot from :5173 actually reboots the machine.
2. **The PUSH ruling** (owner's word) — 3 commits, origin `a558d43`.
3. **THE RELEASE — v1.7.8** (on the owner's word): runbook §Release, Opus-operated · NO config or
   DB migration (D67 + this session are config-free) · **rollback = v1.7.7** (one step) · the
   pre-tag LOCAL e2e is MANDATORY and the stale-pin sweep now covers BOTH waves' strings (the
   fleet wave renamed aria-labels/chips; this session's REBOOTING strings are new and unpinned —
   verified: no e2e pins `waking`/`WAKING`, and the `sleeping`/`SLEEPING` pins are all
   unchanged-state strings). Then stop the dev units (on-demand policy).
4. **The rest of the 2026-08-30 menu stands** (none owed): the owner device pair on prod + edit a
   prompt for real (easier AFTER the release) · Phase 21 live-use deferrals riding daily use ·
   A13 design talk · parked ledger. **Phase 19 (D58) goes LAST** (owner ruling 2026-08-29 — it
   rides the 1.8 endgame; 1.8 stays RESERVED for the final ROADMAP/ISSUES cleanup wave).

## Prior state (2026-08-30 — THE FLEET WAVE: D67 pending power transitions + the gacha transition redesign, PUSHED; superseded above where it speaks)

- **Origin = local `main` = `7096522`** (+ this docs commit): two commits on top of v1.7.7 —
  `210c20b` (chore: env-gated Vite HMR `clientPort` for the phone rig) and `7096522` (**D67** +
  the transition redesign). Full pre-push gate green (BE 2,002 · FE **2,656/160** · tsc/eslint/
  prettier). **Prod untouched: v1.7.7 @ `578ffa7`. NOTHING RELEASED from this wave yet.**
- **D67 (DECISIONS, + same-day rider): app-wide pending power transitions.** The owner's live
  finding — WAKING blinked ~100ms then SLEEPING for the whole boot; shutdowns bounced
  offline→online→offline — was the assumed-state-vs-poll-truth class (HA core#86735). Now:
  `store/fleetPending` holds a per-host `{kind, token}` from DISPATCH until poll agreement, the
  per-direction ceiling (wake 180s · shutdown 90s), or request failure; `useFleet` presents hosts
  through the overlay and folds pending into `busy`; the optimistic cache flip is DELETED;
  frontier's brand count reads through the overlay; gacha chips/ceremony/labels carry WAKING
  truthfully on all three layouts; **the grace window holds ACTIONS never SELECTION** (cover
  disables only the hero, poster only the picked slice). Council: 4 blind sol rounds (design →
  diff-confirm → 2 MEDs → final RESOLVED) + an Opus test-rework subagent; every finding folded.
- **The gacha fleet-tab transitions, owner-ratified:** cover promote = ONE simultaneous hero
  cross-fade (target-bound inert ghost; the lab's page fold / hero zoom / masthead pulse DELETED) ·
  poster pick swaps SNAP (wake ceremony keeps its glide under `.staging`) · **the dossier-open
  96%/104% page zoom is DEAD** — the long-banked E1 "screenshot flicker" item, finally reproduced
  by the owner; the `detail` page pair is a duration-only fade and only the portrait/cutout flies.
- **Wake-on-presence (D2-A): LIVE-PROVEN and returned to OFF.** The dev rig test fired for real
  (2026-08-30 06:49Z, `wake_host → vault`, actor system, on the phone's tailnet arrival). The dev
  config's vault flag is reverted; prod keeps per-host switches OFF. Enabling for real = one
  machine-editor toggle, whenever wanted.
- **The rig is torn down** (`:8443` off, dev units stopped, the HMR drop-in removed). The
  2026-08-29 owner rounds also drove the whole design live on the phone via that rig — the
  standing move for feel sessions (the vite seam is now committed).

## ▶▶ PRIOR (2026-08-30 — the PRE-RELEASE menu): ✅ the quick items RAN 2026-08-31 (① built as the feel pair, ② closed without build, ⑤ built as the reboot kind — the block above is the record; superseded where it speaks)

**The release itself (v1.7.8, on the owner's word):** runbook §Release, Opus-operated · NO config
or DB migration rides this wave (D67 is config-free) · **rollback = v1.7.7** (one step — both
sides are config_version 2) · the pre-tag LOCAL e2e is MANDATORY, and this wave is exactly the
stale-pin trigger class (renamed aria-labels + chips + deleted keyframes — sweep non-exact e2e
`name:` pins against the new label forms first).

**Polish candidates before (or with) the release — none owed, all recorded:**
1. **Poster pick-snap feel** (owner: "a little harsh… review later") — likely shape: a quick fade
   on just the two affected bands, not the old glide.
2. **The dossier-open page fade's outgoing leg** went 200→300ms — the ONE knob if the owner's
   "slight sluggishness in the shrink" feeling persists (the 560ms portrait spring is ruled look;
   the Emma round found no jank mechanism).
3. **Owed owner device pair on prod, standing since v1.7.6:** ① F1 notifications device test
   (master ON → background → host transition → tap lands on Fleet) · ② icon-backdrop fresh
   install. ③ **Edit a prompt for real** (Phase 18's first owner-driving, still owed).
4. **Phase 21 live-use deferrals** riding daily prod use: autoscroll on a long grid · a >15 MB
   413 refusal · the multi-window cast walk. Plus W10 residuals (plan §12).
5. **Reboot as the pending model's third `kind`** (D67 boundary — additive when wanted).
6. **A13 design talk** (OpenAI-OAuth/Codex provider; owner: "maybe later").
7. Parked/standing: ISS-10 ② glyph cross-fades (owner-parked) · C3 S2 read-along (build on ask) ·
   Emma's lane-stall MED → Phase 19 · §P discipline.

**Phase 19 (D58) goes LAST (owner ruling 2026-08-29): it rides the 1.8 endgame — polish first,
never lead a session menu with the hardening court.** 1.8 stays RESERVED for the final
ROADMAP/ISSUES cleanup wave; this wave's e2e observations keep feeding H-E2E's register.

## Prior state (2026-08-27, SECOND block — 🏁 **RELEASED + LIVE v1.7.7; PHASE 21 IS DONE**; superseded above where it speaks)

- **PROD = v1.7.7 @ `578ffa7`, RELEASED + LIVE 2026-08-27** (Opus-operated runbook run, main-seat
  spot-verified): push → CI green (run 33068811160) → **the mandatory pre-tag LOCAL e2e** (first
  run 306/1 — the ONE fail was the KNOWN `layout.spec.ts` scroll-restoration contention flake
  (~1-in-5, already → Phase 19 H-E2E; dev units were running alongside), characterized before
  proceeding: spec-alone pass + a clean FULL re-run **307/0**; NOT the stale-pin class — the
  renamed labels passed both runs) → tag → release gate green (run 33069680443, 7m55s, e2e ✓) →
  `update.sh v1.7.6→v1.7.7` → all four verifications green (describe = v1.7.7 · health version
  1.7.7 · icon-192 content-type png · unit active).
- **The config_version 1→2 fold LANDED at cutover** (main-seat verified on disk: `config_version:
  2`). **⚠ ROLLBACK OFF v1.7.7 IS TWO STEPS:** restore
  `~/.ctrl-b/backups/config.yaml.20260827T120614Z` FIRST, then re-deploy **v1.7.6** (which cannot
  read shape 2; §Rollback order is the safety property). DB snapshot
  `ctrlb-20260827-140614.db.gz` (schema 6 untouched). ⚠ v1.7.5/v1.7.3/v1.7.0 stay tagged-never-
  deployed — not rollback targets.
- **The rig is torn down**: `:8443` serve removed (443 → prod :5433 alone), dev units STOPPED
  (on-demand policy). Origin = local `main` = release sha + this docs commit; nothing else open.
- **Owed to the owner (no session needed):** the first prod ride on the phone — ordinary daily
  use now carries the deferred live-use probes (autoscroll on a long grid · a >15 MB refusal
  whenever one occurs · the multi-window walk as they browse). Findings → fix waves as ever.

## ▶▶ NEXT (2026-08-27, post-release — a clean session; supersedes the lists below)

1. **Nothing is owed on Phase 21.** Live-use findings from the owner's daily prod rides get
   triaged as they land (bug → fix wave · feel → prose first). W10/S6 residuals stay recorded in
   the plan (§12) — none owed now.
2. **The 2026-08-22 menu governs again** (the standing order): **Phase 19 (D58) owner court**
   (spec-complete; at wake the delta council check first, then the §10 rulings — the phase's
   †-items and Emma's lane-stall MED fold in; the e2e flake register candidate from this
   release's pre-tag run joins H-E2E's evidence) · the **A13 design talk** · the parked ledger
   (§P discipline).
3. **1.8 stays RESERVED** for the final ROADMAP/ISSUES cleanup wave.

## Prior state (2026-08-27, FIRST block — S6 ran and closed; superseded above where it speaks)

- **The owner drove the round on the Honor 20 over real HTTPS** — rig: a second Tailscale Serve
  port (`:8443 → :5434`, the dev backend serving a fresh PRODUCTION build of tip; prod untouched
  on 443; separate origin keeps the prod PWA's service worker out of the way). **Two catches, both
  fixed + committed in-round** (main-seat, trivial-leaf fast-path; 360px+390px visual proof, full
  FE gate + 38 media e2e per commit): ① the six-button pill clipped Delete at the phone's REAL
  360px viewport (desktop rounds all ran ≥390) — now the pill **wraps between its clusters**
  (`3d65a69`: width:max-content under the clamp · divider → gap · verbs Top/Bottom); ② **"Framing"
  → "Focus"** everywhere visible (`9329d7a`, owner-ruled; sheet = "Set focus"; code keeps the
  mechanism word) — the shorter word lands all six on ONE line at 360px, the wrap stays as the
  font-scale safety net.
- **Every probe closed:** reticle · previews (**preview-honesty CLOSED AS-IS** — the viewport-true
  refinement candidate is NOT bought) · corner toggle · drag-vs-scroll · upload/q0.85 · PWA picker
  survival · Back-gesture · Fennec · the W10 thumb surfaces. **Closed by SOURCE RULING** (the
  owner: fleet pictures come from downloads/drawn art, not the camera): HEIC N/A · no 48 MP timing
  datapoint · EXIF phone-half (desktop half + e2e = the proof of record). **Deferred to ordinary
  live use** (owner ruling): autoscroll on a long grid · the >15 MB 413 refusal · the explicit
  multi-window cast walk. Full record = MEDIA_MANAGER_PLAN §12's S6 block; §16 stamped.
- **Local `main` = origin `2473e09` + 3 commits** (the two fixes + the docs commit carrying this
  block). Prod untouched (v1.7.6 @ `6a2ccaa`). Dev units RUNNING; the `:8443` serve is live —
  **teardown owed post-release** (`tailscale serve --https=8443 off` + stop the dev units).

## ▶▶ NEXT (2026-08-27, post-S6 — supersedes the list below)

1. **THE RELEASE** (the owner's word starts it): push the 3 commits → runbook
   `deploy/linux/README.md` §Release, **Opus-operated** — version **1.7.x** (1.8 stays RESERVED) ·
   the batch carries **config_version 1→2** (config-pure, proven on dev; NO DB migration) · **the
   LOCAL e2e run before the tag is MANDATORY** (the stale-pin class burned three tags — and this
   session renamed pill/sheet labels, exactly that class's trigger) · **rollback = v1.7.6**. Then
   the rig teardown (above) and the owner's first prod ride.
2. **Recorded follow-ups (not owed now):** the live-use deferrals above · W10's residuals
   (re-crop generation loss · the 412-on-lost-response class · bundled re-art inherits a stored
   point · delivery-never-throws) · Emma's lane-stall MED → Phase 19 · after the phase, the
   2026-08-22 menu (Phase 19 court · A13 talk · parked ledger).

## Prior state (2026-08-26, THIRD session — the owner's post-sign-off round → **W10, review-CLOSED**; superseded above where it speaks)

- **The owner signed off W7–W9 ("the fixes are fine") and asked for a SECOND PASS in the same
  breath:** the modal ✕ rides low in its circle · no way to re-crop/re-frame AFTER upload (and no
  Framing button anywhere in Characters/Banner slides — their folders are empty, so the bundled
  exclusion bit at 100%) · the gallery body stacks redundant text · make the gallery image-forward
  like the W6 detail panel. Mid-design the owner added a directive: **edit is a standalone
  capability, not an upload appendage** — plus the standing least-future-debt bar ("research the
  approaches").
- **The design was researched, written and committed first** (`a5cb47e`, the plan's §12 **W10
  block**): the standalone `useImageJob` machine (admit→guard→crop→export, delivery INJECTED; upload
  = one tail, edit = the other) · the backend replace arm on **`X-Expected-Revision`** (NOT
  `If-Match` — the mount's GET already serves Starlette's ETag, a different validator; 412 never 409,
  which is the create path's suffix-walk trigger) · **framing on bundled entries** via the item-mode
  seam (an owner point wins CENTRED; absent one the shipped proportional string passes through
  byte-identical) · dims as ASSET-RECORD data on the roster (R57's unanimous field convention),
  pinned by an honesty test over the real files · the ruled layout (grid leads · one header status
  line · Add/folder/Restore at the bottom · redundancies deleted).
- **Opus-built as `b2d40a5`…`d6a08fc`** + main-seat audit riders `b951827`. Two REAL catches en
  route: the Restore-defaults e2e was still pinned to the pre-W8 mechanism (a fourth stale-pin burn
  waiting for the next release tag), and the art.ts recipe's recorded dims were WRONG for two files
  (lyra 535×740 · rook 640×740 — the new honesty test caught it on day one). A live 390px screenshot
  round on dev went to the owner: ✕ dead-centred (all five `.pm` modals — it was a text glyph
  centring its line box, now a drawn SVG in the new shared `components/icons.tsx`) · the layout as
  ruled · Framing offered on a bundled default · the Edit pencil floating top-right on owner files.
- **Emma-lane blind round: SHIP WITH FIXES — 4 MED, zero HIGH**, load-bearing areas explicitly
  cleared (replace arm · bundled framing incl. the seat path · the edit byte chain; open sweep
  "none"). All four accepted + fixed (`dcec78c`): the `JobFailure.abandon` hook (a dismissed-or-
  replaced failure releases the upload's pending Blob; its own retry never does) · the edit's own
  `replace` phase + copy · rotation scope drops the folder line, empty non-upload sections stop
  promising an absent Add row · the failure row is `role=alert`. **Confirm round: all four RESOLVED
  with line-proof, new defects "none".** Full record = plan §12's W10 as-built block.
- **Gate green at tip (BE 2,002 · FE 2,619/157 · e2e media specs green). PUSHED on the owner's word
  2026-08-26 — origin = local `main` (the whole Phase 21 build, W1–W10, in one push).** Prod
  untouched (v1.7.6 @ `6a2ccaa`). Dev units RUNNING — the dev backend was restarted onto the replace
  arm; :5173 serves everything.
- **The owner's W10 eyeball RAN (desktop, same day): framing works as intended, the ✕ and the
  image-forward UI look good, "everything works as intended".** One nuance, recorded not built: the
  framing sheet's banner preview reads slightly taller than the real slide — the recorded at-390px
  approximation (previews are EXAMPLES by council M4/R57 §4③ and captioned so; `.gc-banner` is a
  fixed 232px, so a wider viewport makes the real slide shorter than 390/232). Owner weighed it
  minor at preview size; the datapoint + the viewport-true refinement candidate are attached to
  §16's preview-honesty probe — **rule it on the phone in S6, not before**.
- **The owner's PHONE follow-up landed the framing-sheet polish (`f3ef4a8`, main-seat built +
  visually verified at 390px AND 1280px):** the action row was the app's one stretched full-width
  trio — now the `pm-actions` house shape (compact, trailing, primary last) with the short verbs
  **Cancel · Clear · Save**; the preview row spreads across the full width (even flex split capped
  at 120px, `space-evenly` once the cap binds) instead of three 76px boxes snapped left in the
  640px modal. Unit + e2e framing pins renamed with `exact: true`.

## ▶▶ NEXT (2026-08-26, post-W10-close — a NEW session; supersedes the list below)

1. **S6 proper — THE one slice left** (plan §16 + the W6 note): the phone-in-hand device round over
   Tailscale HTTPS, now also covering the W10 surfaces on a real thumb (the 36px Edit/back pills
   one-handed · the bottom Add row's reach · framing a default on the phone · §16's preview-honesty
   probe now carrying the owner's first datapoint); then **release** (1.7.x · runbook §Release
   Opus-operated · config_version 1→2 rides it · LOCAL e2e before the tag · rollback v1.7.6).
2. **Recorded follow-ups (not owed now):** everything the previous block lists, plus W10's own
   residuals (re-crop generation loss · the 412-on-lost-response class · bundled re-art inherits a
   stored point · the delivery-never-throws contract).

## Prior state (2026-08-26, SECOND session — the owner re-poke → W7–W9 + the WHOLE-FEATURE COUNCIL; superseded above where it speaks)

- **The owner's re-poke found three gallery bugs with ONE root:** `toggleHidden` on a bundled row
  LISTED it to carry `hidden` — a listed entry collates first (untick jumped the image to the top)
  and survived re-tick as a bare `{bundled}` sole own-tier member (the whole deal collapsed to one
  picture on every host). Owner rulings in prose (D66 amended): **untick switches an image off IN
  PLACE — membership never moves a picture** (an order intent stating the order unchanged, sweep, in
  `caps.reorder` sections; minimal write + the bare-entry guard elsewhere) · **one accent ring =
  ACTIVE only** (the inset+halo stack deleted) · **24px tick** (~34px target). **W7 built**
  (`65c715b`/`bfeb710`/`48ec972`), visually verified (390px screenshot rounds delivered) plus a
  **claim-vs-paint LIVE PROOF**: the fleet's painted set tracked the gallery's ringed set through an
  untick, and every §2.4 resolver PAIR was statically verified to share one ladder.
- **R60 bought + committed** (`30ae379`, main-seat-verified against Picard upstream): order-as-
  priority is the config-first MAINSTREAM (R59's "no precedent" was scoped to wallpaper pickers;
  Picard ships our exact ordered-list-with-in-place-enabled storage); our order+membership
  composition OVER IMAGES is novel; both order-over-images products (Shopify/Etsy) bought back a
  phone "choose" verb; marking the live winner in the ranking list = ahead of the field (0/4).
- **THE WHOLE-FEATURE COUNCIL RAN (owner ask: "audit the whole feature… maybe we don't have the
  best approach")** — Emma blind lane (4 MED · open sweep "none" · backend/write core + W7 tier work
  declared sound) + an adversarial design lens (F1–F7, SHIP WITH CHANGES; the MODEL itself endorsed:
  a flat list would LOSE upload-replaces-defaults, the seams are in the right places). **W8 = the 8
  accepted fixes** (7 commits `8a8567e`…`2fcd9e4`): missing-role refusal guard (was a `files: []`
  config-wipe hole) · the app-wide media write LANE (out-of-order echo adoption) · drag admission
  `&& !busy` · unusable rows out of DEALT active ids · gacha pools → `usableLadderRows` (blank-vs-
  fallback drift) · family cards + key galleries resolve through `activeForKey` (+ key galleries
  now RING the bound file — builder-found hole, main-seat accepted) · the modal's derived
  mode sentence · the dead `seat` flag deleted. **Rejected + recorded:** the `promote`
  discriminator (a key-scope untick would sweep the named role) · frontier fallback-id exposure.
- **Owner rulings (live, prose):** ① **Restore defaults = "the defaults are the selection"** —
  bundled entries to the TOP in registry order, in use; the owner's files stay, switched OFF in
  place (`79fc184`, scope-corrected in the tail; supersedes the S6 drop-to-fallback mechanism) ·
  ② **TYPED PINS adopted** ("make sure it's the least-debt option") · ③ the dealt-section ring
  means **"in the deal"** — CLOSED as-is · ④ a STANDING DIRECTIVE minted: the least-future-debt
  check on every design choice (memory `least-future-debt-check`).
- **W9 = typed pins** (7 commits `7c712d4`…`898ad73`): a `slots` pin persists the config's own
  **`{name}|{bundled}` identity union** (union-object over a prefixed string — the extend-not-
  migrate directive decided it); backend `MediaPin` + the registry's `slots` upgraded to
  `dict[str, MediaSlot(source=…)]`; the UNRELEASED fold step **types-or-drops** legacy bare-name
  pins (the purity contract forced DROP for file-named ones, surfaced via `consumes`/
  `legacy_keys`); seats resolve by IDENTITY everywhere (`RosterEntry.id`); **the whole name-
  collision apparatus DELETED** (the ambiguity is unrepresentable now, not detected); the
  `duplicate` badge scoped to roles that BIND BY NAME; QUALITY's eslint accounting re-measured
  honestly (78; growth predates W9).
- **CONFIRM ROUNDS closed:** Emma **"RESOLVED WITH NEW FINDINGS"** — all closed in the tail
  (`898ad73`: scoped restore keeps its scope — BOTH lenses converged on it verbatim — + the
  restore gate asks the SCOPE + the F5 husk) **except her MED lane-stall** (a hung settings PUT
  holds the app-wide lane; pre-W8 it held one namespace's queue) — RULED RECORDED-NOT-FIXED →
  **Phase 19's reliability packet** owns it via the kit-wide request-timeout gap `useSettings.ts`
  already records twice (one idiom, one home). Design lens: **F1–F7 all CONFIRMED-RESOLVED, the
  F6 overrule CONCEDED** (the minimal write lists the disk tier ahead of a touched bundled row —
  no key-grid jump exists), "SHIP once NC1/NC2 land" — they landed.
- **Gate green per commit; tip BE 1,996 · FE 2,584; e2e media specs re-run green.** **79 commits
  UNPUSHED** (origin `fef36aa`). Prod untouched (v1.7.6 @ `6a2ccaa`). Dev units RUNNING — :5173
  serves everything through the tail. Full records: MEDIA_MANAGER_PLAN §12 W7/W8/W9 blocks.

## ▶▶ NEXT (2026-08-26, post-council — a clean session; supersedes the list below)

1. **Owner eyeball on dev (:5173)** — the W7–W9 surfaces: untick dims IN PLACE (no jump, deal
   re-forms correctly) · the single active ring + 24px tick · **Restore defaults on a section
   holding their own uploads** (the NEW verb: defaults take over on top, uploads stay switched
   off) · per-key galleries now ring the bound file · the modal's one-line mode sentences ·
   **re-pin any seat**: a pre-W9 pin naming a FILE was dropped by the typed migration (one
   "Use here" re-tap rebinds; bundled-named pins were typed automatically). Their dev config's
   collapsed state from the original bug self-heals with one untick+re-tick of that image (or
   Restore defaults).
2. **The PUSH ruling** (owner's word) — **79 commits with the handoff commit carrying this block**, origin `fef36aa`.
3. **S6 proper** — unchanged, THE one slice left (plan §16 probe list + the W6 note); then
   **release** (1.7.x · runbook §Release Opus-operated · config_version 1→2 rides it, now incl.
   typed pins · LOCAL e2e before the tag · rollback v1.7.6).
4. **Recorded follow-ups (not owed now):** Emma's lane-stall → Phase 19 · `classifyNamed`/
   `NamedBinding` freshly orphaned (test-only consumers) — lean-pass candidate, ruled kept at
   session close · the design lens's declared-tier/mode shared-resolver idea (plan §12 W8) ·
   QUALITY §warning-accounting refreshed, F13 still trigger-gated.

## Prior state (2026-08-26, FIRST session — THE S6 OWNER-ROUND FIX WAVE: W1–W4 BUILT + review-CLOSED; superseded above where it speaks)

- **The owner's round landed and drove the wave.** Their three findings — drag doesn't reorder ·
  gacha's first banner + oracle missing from the library · cosmos service banners missing — were
  triaged to TWO causes and ONE omission: the §2.3 ③ tier rule made all-defaults sections
  non-arrangeable (down-drags clamped to a no-op, up-drags mis-landed) AND silently shrank the deal
  on any partial listing; and three classes of shipped default art had no library identity. The
  owner ruled in prose (recorded in MEDIA_MANAGER_PLAN §2.3/§6.6/§12): reorders sweep the whole
  section's order · every shipped picture is a first-class entry, "none left behind" · the hero and
  fleet-backdrop defaults show in BOTH seats, independently overridable · cosmos's 12 banners = a
  dealt "Built-in rotation" · a per-section Restore defaults.
- **The wave: 5 commits, `bee042e`…`533de17`** (Opus-built W1–W4 from a pinned brief + the
  main-seat audit fix). W1 sweep-on-order (+ `lastExpressible` and the drag clamp DELETED) · W2
  bundled ids for gacha `oracle`, frontier `hero`, and `rook` (a found orphan; cast tail, deal
  unchanged ≤5 hosts) — both ladders' hard-coded last rungs now honor the In-use switch · W3
  `MediaSlotDef.builtin` (display-only) + `MediaRotationDef` + CosmosHostDetail dealing from the
  library + a latent click-guard unmount crash fixed · W4 `restoreDefaults`/`defaultsRestorable`.
  **Review-CLOSED:** main-seat audit → Emma-lane blind round **"RESOLVED — READY", zero new
  findings** → `533de17` (refusal arms don't sweep) → confirm RESOLVED. Full gate green per commit;
  full e2e 305 green; FE units 2,518 → **2,544+1**. The plan's §12 wave block = the whole record,
  incl. the recorded-not-fixed 50 ms click-guard race and the flagged sweep consequence (first
  reorder in a MIXED section promotes defaults into the deal — the owner should eyeball that once).
- **W5 RODE THE SAME DAY (owner prose ruling in-session, 2026-08-26): the gacha HERO SEAT IS
  DEAD.** The owner ruled the hero slide was never a separate thing from the banner — so the
  carousel's first slide now DEALS the banner pool's first member (frozen PICKUP copy kept),
  `banner.webp` is that pool's FIRST bundled entry (banner · b2 · b3 — orderable, retirable; the
  owner clarified "differ" meant the MECHANISM, so the shipped look keeps one picture on both
  surfaces and the fence is byte-identical to pre-W5), an
  empty pool falls back to the backdrop image ("slide one stays the backdrop image"), and the
  backdrop is DECOUPLED (a kit background no longer moves the carousel; §5.3's coupling reversed —
  D54 amended). One build commit `15b769f` (Opus from a pinned brief) + the docs commit. FIXED IN
  PASSING: scene slides dropped their focal points entirely. Review: main-seat audit clean →
  Emma-lane blind round **SHIP, ZERO findings**. Gate green (BE 1,991 · FE 2,552). Full record =
  MEDIA_MANAGER_PLAN §12 W5. Dev backend restarted onto the new registry; :5173 serves it.
- **W6 FOLLOWED THE SAME AFTERNOON (owner feel-talk rulings, prose; D66 = the D-entry): ORDER IS
  THE ONLY PRIORITY SYSTEM, APP-WIDE + the gallery redesign.** The owner: "we don't need two
  systems to do one thing" · one-tap activation on the tile · the ◆ marker → "Default" · "icons
  on top of the image" for the detail · the section CARDS' titles/hints confusing. Built as two
  Opus commits from a pinned brief (`bf0dc41` the sweep · `a5b7816` the redesign + BOTH copy
  passes): every POOL pin deleted (gacha `reel_figure` · frontier `hero` · kit
  `background`/`brand`; no config ever held one — verified), `MediaCaps.activate` → `promote`
  (move-to-top for scoped key/family sections), the two gacha character SEATS = the sole
  survivors ("Use here"; the oracle seat relabelled **"Operator character"**); the tile corner ✓
  = a real In-use toggle (sibling button, aria-pressed, drag-proof), ◆ → a **"Default"** chip,
  winner keeps the accent outline; ItemDetail rebuilt IMAGE-FORWARD with the floating action pill
  ([To top · Up · Down · To bottom | Framing | Delete] — To top IS activation); **every section
  card got an owner-facing label** (`MediaRoleDef.label`: Characters · Banner slides · Transition
  figure · Operator backdrop · Rig cards · Map cover · Comms stack · Service icons · Machine
  pictures · Background · **Logo**, was "App icon") with the role folder as a mono subtitle; the
  one-word-one-meaning copy system (In use = membership · Active = painted · Default = ships;
  `used for "X"`; consequences on advisories). Main-seat audit ACCEPTED the builder's two
  judgment calls (promote; seats refuse-not-repair) + a live 390px screenshot round on dev
  verified the two unverified layout spots. **Review: three rounds to an explicit RESOLVED** —
  blind SHIP WITH FIXES (2 MED: pin resolution vs presence · captured-state double-tap) → fixed
  `4eaaea4` (send-time name resolution; `toggleHidden` composes) → confirm chained 1 MED and the
  main seat OVERRULED her prescription with the PAINT rule (`activeSeat` was the liar; aligned
  `74872ed`) → her check CONFIRMED the overrule + chained `activeOraclePool` (override honoured
  on pin PRESENCE) → closed `b241d33` (override = a CLAIM the wiring honours only when the seat
  resolves) → **final RESOLVED, zero new**. Gate green per commit (tip BE 1,990 · FE 2,559; the
  whole e2e 305 re-run green at the build). Doc truth riders: lucide-react is NOT a dep
  (CLAUDE/AGENTS corrected) · the prototypes are TRACKED (`ac0a07d`, owner reversal) · Phase 19
  §7b now carries the owner-requested WHOLE-SYSTEM design verdict on the media manager
  (`6f5fe52`). Full record = MEDIA_MANAGER_PLAN §12 W6.
- **Origin unchanged (`fef36aa`) — 60 commits unpushed with the docs commit carrying this block**
  (the 53 through the W5 close + W6's `bf0dc41`/`a5b7816` + `6f5fe52` + the three review-fix
  commits + this one). Prod untouched (v1.7.6 @ `6a2ccaa`).
  Dev units RUNNING; the dev backend was restarted onto the W6 registry (FE rides Vite HMR); the
  owner's dev config/media untouched by the waves.

## ▶▶ PRIOR (2026-08-26, post-W6): the owner re-poke — ✅ RAN same day (the SECOND-session block above is the record; superseded)

1. **Owner re-poke on dev (:5173)** — everything below is live there now:
   - **The W1–W4 wave**: drag lands where dropped (all-defaults sections, both directions) · gacha
     library shows oracle + rook · cosmos "Built-in rotation" · Restore defaults · the flagged
     consequence: first reorder in a MIXED section promotes defaults into the deal.
   - **W5**: the carousel opens on the banner pool's FIRST image wearing the PICKUP copy
     (`banner.webp` on defaults — the shipped look unchanged); `banner.webp` is an ordinary Pickup
     banner entry; hiding all banner images leaves slide 1 on the backdrop image; a kit background
     moves ONLY the backdrop.
   - **W6 (the owner's own feel-talk, built)**: section cards wear the new names + folder
     subtitles ("Operator character" vs "Operator backdrop"; "Logo") · the tile corner ✓ is the
     one-tap In-use toggle, the "Default" chip marks shipped art, the accent outline marks the
     ACTIVE winner · tapping an image opens the image-forward detail with the floating pill —
     "To top" is how you make something the active one, there is NO "Set as active" anywhere ·
     the kit Background/Logo and gacha Transition-figure galleries have no pin: top image wins.
     (The set-active-feels-confusing note of 2026-08-25 is thereby CLOSED — W6 was that talk.)
2. **The PUSH ruling** (owner's word) — 60 commits, origin `fef36aa`.
3. **S6 proper — THE ONE REMAINING SLICE of Phase 21** (plan **§16** = the probe list; the owner's
   words 2026-08-26: "we still have one slice left to do, the eyeball and everything"): the
   phone-in-hand device round over Tailscale HTTPS — EXIF portrait on the phone's own photo · the
   48 MP double-decode timing · HEIC refusal copy · 413-mid-body · PWA-standalone picker survival ·
   q0.85 eyeball · crop/framing/drag FEEL (long-press · drag-vs-scroll · one-handed autoscroll ·
   reticle · preview honesty · per-window framing on the real cast) · Fennec expected-partials ·
   Back-gesture close — PLUS the W6 surfaces on a real thumb (the corner toggle's 28px target
   beside the long-press drag · the pill's reach one-handed · the new section names reading right).
   Tick off whatever the owner's ad-hoc rounds already proved.
4. **Release** once S6 satisfies — 1.7.x (1.8 stays RESERVED) · runbook §Release, Opus-operated ·
   the batch carries config_version 1→2 (config-pure, proven on dev), NO DB migration · rollback =
   v1.7.6 · the LOCAL e2e run before the tag is MANDATORY (the stale-pin class burned three tags).
5. **After the phase**: the 2026-08-22 menu below still governs (Phase 19 court — §7b now carries
   the owner-requested whole-system media-manager design verdict — · the A13 talk · the parked
   ledger).

## Prior state (2026-08-25 — THE MEDIA-MANAGER BUILD SESSION: S0→S5 ALL BUILT + REVIEW-CLOSED; superseded above where it speaks)

- **THE WHOLE BUILD LADDER RAN IN ONE SESSION — Phase 21 S0 through S5, all six slices
  Emma-lane-closed at an explicit final RESOLVED.** 40 commits on local `main` on top of
  `fef36aa` (`6c01e4d` … `034cbd1`), **NOTHING PUSHED** (the owner's word rules the push).
  Prod UNCHANGED: v1.7.6 @ `6a2ccaa`. Dev units RUNNING (:5434 + :5173) on the full stack,
  dev config migrated to `config_version` 2 (backup in `~/.ctrl-b-dev/backups/`).
- **The cadence per slice:** Opus 5 build from a pinned main-seat brief → main-seat audit →
  Emma-lane blind review (sol high, `--ignore-rules`) → fix waves to her explicit RESOLVED —
  the owner amended the standing pause-between-slices rule to continue-through for this phase
  (2026-08-25); S6 stays the owner gate. Per-slice as-built + review records live in
  MEDIA_MANAGER_PLAN §12's blocks; the audit trail below is the headline register.
- **What shipped, per slice:** **S0** docs (D65 ratified · SECURITY_MODEL §2.7 + the §1
  premise correction, later rescoped to the safelisted-POST CLASS · registry bundled-id rows,
  `MediaSlotDef.bundled` retired) + the `config_version` 1→2 numbering correction (the plan's
  "schema 6→7" was a mislabel — 6 is the DB schema, untouched). **S1** the D65 write API
  (raw-body PUT/DELETE, the `.parts/` staging pipeline, admission tier), collation
  **library-v1** (`focal`/`hidden`/`listed`/`bundled`/`key` on the wire), the config fold
  migration (step 2), defects #6/#7/#8. **S2** the library gallery (section descriptors +
  §2.4 active resolvers exported by the theme ladder modules · H5 role-family cards +
  Unassigned · the full-screen modal on a STACK-aware `useOverlayBackGuard` ConfirmDialog
  joins · `lib/mediaLibrary` transforms owning the tier rule · the send-time-authoritative
  queue with three-valued pin eligibility · defects #1–#4, #9–#12; the `MediaSlotDef.seat`
  refinement: in-role pins fold into their role card, set-active writes the PIN). **S3**
  upload/crop (imageProbe/imageExport-worker/uploadName · react-easy-crop@6.2.3 ·
  the two-phase idempotent job with cache-invisible reconcile · alpha decided from BYTES ·
  the canvas-sentinel readback · the StrictMode guard fix). **S4** focal (the clamped-centred
  math with the s≤1 guard as contract · the 9-window paint-site rewrite off the `--cv-*`
  chain, parity pinned against pre-S4 literals · FramingSheet seeding from the stored point ·
  `expectedRev` refuse-on-race · backend EXIF-orientation with the count==1 predicate · the
  disabled-ns 404-all-verbs backstop that also killed a dist-presence-dependent route
  divergence). **S5** drag (the house hook extended, never forked · the pure held-commit
  machine with per-hold tokens · press-key abort on order change · the `lastExpressible`
  clamp · list mode restored to Y-only).
- **Gate state at tip:** full gate green (BE **1,990** · FE **2,518** / e2e **301** local,
  all three projects). The e2e media spec was RE-WRITTEN in S2 (the shipped one was stale
  since S1 — asserting the pre-fold config shape; only a release-tag CI run would have caught
  it — the local-e2e-before-tag rule vindicated again).
- **Known-open, recorded not absorbed:** frontier/kit roles are NOT framable in v1 (no focal
  channel in their seams — future seam work, plan §12) · the fleet backdrop degrades to
  proportional (§5's named case) · autoscroll is unit-tested only (S6 probes feel) ·
  `SectionRefEditor` still lacks a single-pointer alternative (R58 §6 ② — pre-existing, the
  real SC 2.5.7 gap, backlog) · a pre-existing `layout.spec.ts` scroll-restoration flake
  (~1-in-5 desktop) → Phase 19's H-E2E slice · the two-devices lost-update residual stands
  (accepted at council).

## ▶▶ PRIOR (session-close 2026-08-25): the owner round — ✅ RAN, triaged + fix-waved (the 2026-08-26 block above is the record; superseded)

**The owner is checking the build on the dev units as of session close** (uploading real
images, poking the gallery/crop/framing/drag). **Dev units are deliberately LEFT RUNNING**
(:5434 + :5173) — do not stop them at session start; the owner may be mid-round. The dev
config is on `config_version` 2 (backup in `~/.ctrl-b-dev/backups/`).

**The next session, in order:**
1. **Collect the owner's round** — their findings/feel verdicts rule. Triage anything they
   hit: bug → fix wave on the owning slice's modules (the standing cadence: Opus fix from a
   pinned brief → main-seat audit → Emma-lane round when non-trivial); feel/design →
   converse in prose first, no build until ruled. ⚠ Note for triage: the owner pokes
   `:5173` (Vite dev) — the StrictMode guard fix (`8202768`) made that profile honest, but
   any NEW dev-only weirdness should be re-checked against the BUILT app before diagnosis
   (the S4 rider proved dev/prod can genuinely diverge — dist presence changed route
   matching).
2. **The PUSH ruling** (owner's word) — 41 commits local (`6c01e4d`…`bfcda2d`), origin
   still `fef36aa`. Push carries the whole phase + this handoff.
3. **S6 proper** (plan **§16** = the probe list; the owner's ad-hoc round may cover much of
   it — tick what their round already proved): the parked 2026-08-12 round · EXIF portrait
   (✅ pre-proven live, re-confirm on the phone) · 413-mid-body over Tailscale HTTPS · the
   Honor 20 HEIC refusal copy · PWA-standalone picker survival · q0.85 eyeball ·
   crop/framing/drag FEEL (long-press · drag-vs-scroll · one-handed autoscroll reach ·
   reticle feel · preview honesty) · the 48 MP double-decode datapoint · Fennec
   expected-partials.
4. **Release** once S6 satisfies: version **1.7.x** (1.8 stays RESERVED for the final
   ROADMAP/ISSUES wave); runbook `deploy/linux/README.md` §Release, Opus-operated; the
   batch carries the `config_version` 1→2 migration (config-pure, proven on dev) — NO DB
   migration; **rollback = v1.7.6**. Pre-tag: the LOCAL e2e run is mandatory (the
   stale-pin class burned three tags; this phase's S2 caught a stale spec the same way).
5. **After the phase:** the 2026-08-22 menu below still governs — Phase 19 (D58) owner
   court (spec-complete + the §7b delta register; this phase's †-items fold in) · the A13
   design talk · the standing parked ledger.

**† Backlog items this phase minted (recorded, not absorbed — fold into their owners):**
frontier/kit framability = future per-theme seam work (plan §12) · the fleet backdrop's
proportional degrade (§5's named case) · `SectionRefEditor` single-pointer alternative
(R58 §6 ② — the real SC 2.5.7 gap; ISS-candidate) · the `layout.spec.ts` scroll-restoration
flake → Phase 19 H-E2E · autoscroll feel = unit-tested only, S6 probes it · the
two-devices lost-update residual (council-accepted).

## Prior state (2026-08-24, SECOND session — the media-manager DECISION + COUNCIL session; superseded above)

- **PUSHED on the owner's word — origin = local `main` (this session's docs commit on top of
  `7bee1d5`; the previous block's "5 unpushed" were already on origin by session start —
  stale note, corrected).** Prod UNCHANGED: v1.7.6 @ `6a2ccaa`. Dev units stayed STOPPED
  (docs-only session).
- **THE DECISION SESSION RAN — every §9 question RULED, with owner amendments that reshaped the
  design:** the **LIBRARY model** (every art destination = its own gallery of stored images;
  uploads purely ADDITIVE — no collisions by design, no Replace UI; order = priority; delete =
  the only removal; **bundled defaults are first-class gallery entries**; Conf stays uncluttered
  — tap a section → full-screen gallery) · **focal point IN v1** (draggable-framing wish →
  reticle design) · **drag reorder PRIMARY** · **NO kill switch** (unconditional D65 reversal,
  toggle rule knowingly waived) · config = the **clean fold, schema 6→7** (`media.{namespaces,
  write}`) · **15 MB cap · 64 MP decode guard** (the owner's phone is an Honor 20 — 48 MP; the
  old 40 MP REC would have refused their own camera) · single-file picks · 1.7.x, **1.8 RESERVED
  for the final ROADMAP/ISSUES cleanup wave**.
- **Research bought + indexed: R57** (focal/crop UX — the field's TWO incompatible focal maths;
  clamped-centred wins, formula re-derived) · **R58** (touch drag-reorder — extend the house
  hook, reject dnd-kit) · **R59** (library presentation — full-screen modal, 3-col grid,
  preview-card entries, explicit set-active) · plus a **12-finding defect audit** of the current
  gallery (headline: the `?rev=` cache-buster is missing at ~10 paint sites — stale art
  fleet-wide after in-place replaces), all main-seat verified.
- **MEDIA_MANAGER_PLAN REWRITTEN to v2.1 (the library model) and COUNCIL ROUND 2 RAN TO
  CLOSURE in-session:** Emma lane (blind, sol high) 1 HIGH + 9 MED · adversarial Opus 5 HIGH +
  8 MED + 3 sweep — every finding ruled + folded (two Emma fixes re-derived leaner; the confirm
  rounds themselves caught three incomplete folds, all closed); **BOTH lenses final-confirmed
  "RESOLVED — ready to build"**. Full audit trail = the plan's **§15**. H5 (role-family cards
  for data-derived keys + the Unassigned bucket) **OWNER-RATIFIED**; the pooled
  positional-order family gallery = the recorded road-not-taken.
- **NOTHING BUILT — by design.** The plan is the complete, council-closed build spec.

## ▶▶ NEXT: START THE BUILD — MEDIA_MANAGER_PLAN §12, S0 first (a clean session; owner-ruled)

**The plan is the only brief needed: [`MEDIA_MANAGER_PLAN.md`](./MEDIA_MANAGER_PLAN.md) v2.1,
council-closed on both lenses.** The ladder: **S0 docs → S1 backend (write API + the schema-7
migration) → S2 gallery (library UI) → S3a/S3b crop+upload → S4 focal → S5 drag → S6 the owner
device round** (the parked 2026-08-12 round folds in there). Standing cadence per slice: Opus
build from a pinned brief → main-seat audit → Emma-lane review → owner eyeball; **pause between
slices** (the standing memory). Load-bearing pins for every builder brief: the §12 FE module map
(acceptance line: **ConfTab gains ZERO net lines**) · §2.3/§2.4's collation + active-resolver
seams · §11's test obligations · everything customizable (§0). Version: 1.7.x. Start the dev
units for owner pokes after slices; stop when done. After this phase, the 2026-08-22 menu below
still governs (Phase 19 court · A13 talk · the owner device pair).

## Prior state (2026-08-24, FIRST session — the design council; superseded above)

- **Prod UNCHANGED: v1.7.6 @ `6a2ccaa`.** Local `main` — **5 commits
  UNPUSHED** on top of origin `74c3c9a`: the two 2026-08-23 docs commits + this session's three
  (`75c8dd0` R54–R56 dossiers · `72e438b` MEDIA_MANAGER_PLAN · the handoff commit carrying this
  block). Push on the owner's word. Dev units stayed STOPPED (docs-only session).
- **THE MEDIA-MANAGER DESIGN IS COUNCIL-CLOSED** — the owner's ask (in-app upload from the phone ·
  crop-or-use-as-is · delete · reorder · per-section drop-downs + per-section upload buttons,
  ruled to ship BEFORE Phase 19 completes = an explicit Packet ④/⑤ forward-ruling):
  - **Evidence bought + curated: R54/R55/R56** (committed `75c8dd0`; index rows in). Headlines:
    multipart POST is CORS-safelisted ⇒ the write API is raw-body PUT/DELETE · two probed
    cross-engine crop defects pick the drawImage/worker pipeline · react-easy-crop@6.2.3 ranked
    (8.6 KB measured) · WCAG names our ↑/↓ buttons as THE reorder pattern · no peer
    magic-byte-validates uploads (we stay stronger).
  - **The plan of record: [`MEDIA_MANAGER_PLAN.md`](./MEDIA_MANAGER_PLAN.md)** (`72e438b`) —
    D65-pending contract, client pipeline, gallery redesign on the house primitives
    (store/collapse · disclosureToggle · requestConfirm), pinned six-module FE decomposition,
    `media_write` config, §6 tests, §7 slice ladder S0→S5.
  - **Council record = its §11, both lenses confirm-closed:** Emma lane (blind, sol high)
    BUILD WITH CHANGES — 9 MED + 1 LOW, then 2 more catches across 3 confirm rounds
    (revision-preconditioned overwrite AND cleanup delete; same-filename skip) → all-RESOLVED.
    Adversarial Opus design lens BUILD WITH CHANGES — 3 HIGH (the aspect field was wrong against
    its own CSS · the draft re-derived three house primitives · no decomposition pinned) +
    7 MED/3 LOW/3 sweep, then 3 interaction pins in its confirm → "RESOLVED overall." Every
    finding folded; ONE partial overrule recorded (doc fold into MEDIA_PLAN — standalone-phase-doc
    precedent won). ⚠ 529-overload note: the Opus lens took 4 launch attempts — nothing was lost,
    each death was pre-output.
- **NOTHING BUILT — by design.** The plan's status line: owner rulings pending, nothing builds
  until the decision session rules.

- **Prod UNCHANGED: v1.7.6 @ `6a2ccaa`.** Local `main` — **2 commits UNPUSHED** on top of origin
  `74c3c9a`: `4c851b7` (the Phase 19 scope amendment) + the handoff commit carrying this block.
  Push on the owner's word. Dev units stayed STOPPED (docs-only session).
- **Phase 19 SCOPE WIDENED by owner ruling (prose round, committed `4c851b7`):** ① the frontend
  joins IN-PHASE on both lenses — Track P **Packet ⑤ (H7)**, FE perf/reliability (owns
  F9/F13/ACA-14 with trigger-gating superseded: audit now, fix still numbers-gated · SYS-9.3 ·
  SYS-17c · the audioController subsystem · kit runtime + the 4 canvas surfaces · a new matrix
  row: streaming turn + hidden-tab churn) + Track D **DP-C**, FE implementation design
  (components/stores/query/data-flow, the ConfTab monolith; lane split: DP-A = the design
  SYSTEM, DP-C = the CODE design, ⑤ = measurement) — pairing exactly like Packet ②/DP-B; ② the
  e2e suite gets its own **H-E2E audit slice** right after H2 (the three burned tags = the
  evidence; SYS-18c dispositioned there, no ROADMAP exit). **The separate FE phase is
  DISSOLVED** (§10 ④ pre-ruled); the ladder = H1→H0→H2→H-E2E→①②③④⑤→Hf; H1 gains the FE
  bundle baseline + the production-build phone trace; the owed delta council check now covers
  **§3b + the amendment**. Pointers updated in TODO / UI_AUDIT / this file's menu below.
- **The hardening court/session itself stays DEFERRED (owner: "at a later time")** — everything
  else in the 2026-08-22 menu below stands unchanged.

## ▶▶ PRIOR (2026-08-24): the MEDIA-MANAGER DECISION SESSION — ✅ RAN same day (the SECOND-session block above is the record; superseded)

**The owner decides; everything they need is [`MEDIA_MANAGER_PLAN.md`](./MEDIA_MANAGER_PLAN.md)
§9 — ten questions, each with a REC.** The short list: ① kill-switch default (REC ON) · ② config
home (REC additive `media_write:`) · ③ `max_bytes` 8 MB (REC) · ④ input decode guard 40 MP (REC) ·
⑤ ratify free-ratio crop windows · ⑥ focal point deferred (REC) · ⑦ Replace/Cancel-only collision
UI (REC) · ⑧ reorder stays buttons; Reorder-mode > drag if more is wanted · ⑨ single-file picks
(REC) · ⑩ phase number + 1.7.x. Also to ratify: the D65 D-entry itself (the §1 security reversal +
its residuals). **After the rulings:** S0 docs → S1 backend → S2 gallery → S3a/S3b upload →
S4 device round (the parked 2026-08-12 test-and-refine round folds into S4). Standing cadence per
slice: Opus build from a pinned brief → main-seat audit → Emma-lane review → owner eyeball.
**Also owed at session start: the push ruling on the 5 unpushed commits.**

## ▶▶ PRIOR (2026-08-23): the media-gallery design conversation — ✅ RAN 2026-08-24, superseded by the block above

**The next session is a DESIGN + IMPLEMENTATION CONVERSATION on the media gallery** (owner's
words: "talk about the design and implementation of the media gallery thing") — prose
back-and-forth per the standing preference; no build until ruled. Pre-flight for that session:
- Read **MEDIA_PLAN.md** (D53 media namespaces v2, shipped v1.5.0) + `backend/app/core/media.py`
  + `api/media.py` + the gallery FE surfaces BEFORE proposing anything (the mandatory
  pre-flight; map what exists first).
- Standing context: the **media-gallery test-and-refine round has been parked since
  2026-08-12** — file-drops + real-touch drag-reorder are BUILT but UNTRIED on device. The
  owner's ask may fold that round in, or redesign around it — let the conversation decide;
  don't pre-empt with fixes.
- Phase 19 overlap note: `core/media.py` is Packet ④'s unit and the gallery FE now belongs to
  Packet ⑤/DP-C — if the conversation spawns build work, honor the fix-in-owning-phase rule or
  have the owner rule it forward explicitly.
- After that: the 2026-08-22 menu below still governs (the owner device pair on prod · the
  Phase 19 court when the owner calls it · the A13 talk).

## Prior state (2026-08-22, SECOND block — 🏁 RELEASED + LIVE v1.7.6; superseded above where the 2026-08-23 block speaks)

- **PROD = v1.7.6 @ `6a2ccaa`, RELEASED + LIVE 2026-08-22** (Opus-operated runbook run; CI release
  gate genuinely green incl. e2e, 7m12s; no config/DB migration — schema 6, config VERSION 1; DB
  snapshot `ctrlb-20260822-131921.db.gz`; config backup unchanged, newest =
  `config.yaml.20260820T111619Z`). **Rollback = v1.7.4** (`update.sh v1.7.4`).
  **⚠ v1.7.5 is tagged NEVER DEPLOYED — NOT a rollback target** (joins v1.7.0/v1.7.3): its release
  gate went red on the STALE-E2E-PIN CLASS, third burn — Playwright `name:` is SUBSTRING matching,
  C3's new "Chunk format" seg made `name: "Format"` ambiguous. Fixed `6a2ccaa` (`exact: true` +
  class comment + a sweep of every non-exact e2e name against the new voice controls — no other
  collision) and **verified by running the spec LOCALLY before re-tagging** (10/10 both projects) —
  make that the standing pre-tag move whenever a batch touched Conf/labels. Runbook §Release step 3
  now documents that the TAG push runs the full ~4-min local gate (don't read it as a hang).
- **The batch shipped:** chunked TTS D63 + the whole-message scrubber S1.5 + the 2026-08-22
  partial-failure/parked-flag waves (~0.7 s first audio vs 13.6 s before, both backends) ·
  auto-stop dictation (OFF) · F1 host-up/down notifications (master OFF) · ISS-9 spinner · the
  motion-token band (ISS-10 ①) · ISS-11 scanlines · D64 memory hardening + the consolidation
  bare-name clause · D62/D60 already in v1.7.4. Origin = local = prod sha; nothing unpushed.
- **This morning's session (first block below + HANDOFF `a1cc26e`):** the owner clarification
  round drained the register · D64 live acceptance PASSED on dev · the pre-release pair built +
  Emma-review-closed (2 MED catches, `parked` flag) · HARDENING_PLAN gained **§7b** (the post-spec
  delta register: every v1.7.4/v1.7.6 surface assigned to its packet + lens; §8 rows flipped).
- Dev units STOPPED post-release (on-demand policy); dev's tier-2 memory state stays on disk.

## ▶▶ NEXT (2026-08-22, the clean-session menu — pick from here; supersedes all prior ▶▶ lists)

**A · The owner's post-release device pair on PROD (the only OWED items):**
① **F1 notifications device test** — Conf: master notifications ON → background the app → let a
host transition → the notification's tap must land on the FLEET tab. ② **Icon-backdrop fresh
install** (standing since v1.7.4) — install fresh from Chrome, the chosen backdrop mints directly.
③ (free rider) chunked TTS + the scrubber get their first prod ride in ordinary daily use.

**B · Owner-paced sessions (owner at the screen; schedule on wish):**
- **Media-gallery test-and-refine** (parked 2026-08-12): file-drops + real-touch drag-reorder.
- **Root cross-fade damp** (GACHA_PLAN §12.6 E1): eyeball, don't remove blind.
- **D2-A wake-on-presence first real use**: flip `wake_on_presence` ON for a machine in the
  machine editor (phone h20 already registered) — next real Tailscale-on wakes it.
- **Edit a prompt for real** (Phase 18's first owner-driving).
- **ISS-10 ② / motion design talk** (prose, R52 §8 = the base; owner-parked "after the TTS thing").

**C · The work queue (in the standing order):**
1. **Phase 19 (D58) owner court** — the big standing gate, now fully current: HARDENING_PLAN is
   spec-complete + **§7b delta register (2026-08-22)** + the **2026-08-23 owner scope amendment**
   (the frontend joins IN-PHASE on both lenses — Track P Packet ⑤/H7 + Track D DP-C — and the
   e2e suite gets its own H-E2E slice; the separate FE phase is DISSOLVED, §10 ④ pre-ruled;
   F9/F13 audit-now/fix-on-numbers). At wake: the **delta council check FIRST** (one Codex +
   one Opus round over §3b + the amendment), then the remaining §10 rulings (journeys ·
   pre-authorized fix class · packet ranking incl. ⑤/H-E2E · D58 lock · Track D ordering).
2. **A13 design talk** (OpenAI-OAuth/Codex provider; R49 = the evidence; prose conversation →
   D-entry before any build; headline cost = the Responses-only adapter bridge + ToS silence).
3. **C3 S2 read-along-while-streaming** — designed inside D63, hook points recorded; owner ruled
   "not necessary for now" (2026-08-22): build only on an explicit ask.
4. **D64 residual watch** (no action owed): paged reads + the owner-steer branch ran only in
   tests so far — a future consolidation touching `frontier-theme-prep` (~3 pages) or
   `gacha-theme-progress` (the steer case) exercises them live, in the owner's ordinary curation.

**D · Parked / ruled (never re-propose; §P discipline):** web-push (closed-app delivery only) ·
vault/wiki spec (owner designing elsewhere; their Maia specs = decisive D64 evidence — check
before researching adjacent ground) · arcade (owner 2026-08-22: fine as-is, DROPPED from lists —
they'll ask) · color-theory palette session · ~~gacha originals stay untracked~~ **REVERSED
2026-08-26: the four alt-fleet prototype folders are TRACKED now** (owner: "track the prototypes
too so we don't have to handle that anymore") · ISS-10 ② glyph
swaps (revive on wish) · eslint/F13 Compiler-prep backlog (trigger-gated, count in QUALITY.md) ·
the §17.4 / D63-§8 accepted residuals · ROADMAP §P (QR-to-phone · picker disclosure).

*(A future archive sweep can move the 2026-08-20/21 blocks below to HANDOFF_ARCHIVE.md — optional
chore, the 2026-08-12 precedent.)*

## Prior state (2026-08-22, first block — the pre-release close-out; superseded above)

- **Prod UNCHANGED: v1.7.4 @ `92cb3a3`.** Local `main` @ `bdc484e` — **4 new commits UNPUSHED**
  on top of origin `136e29d`; the release batch is now **37 commits**. Recommendation unchanged:
  **release as v1.7.5**, no schema/config migration, **rollback = v1.7.4**.
- **THE OWNER CLARIFICATION ROUND (this session) drained the open register:** motion feel ✓
  accepted ("looks good") · dictation threshold ✓ accepted as calibrated by use · ISS-10 ② stays
  parked · scrubber residuals accepted (owner: "it's fine") · arcade DROPPED from the list entirely
  (owner will ask if ever wanted) · gacha originals stay untracked · **corsair cold-boot wake
  CLOSED** (owner watched one, works — the Tailscale-liveness behavior as recorded) · media-gallery
  + root-cross-fade sessions → owner-paced ("maybe tomorrow") · F1 device test + icon-backdrop
  fresh install → deliberately POST-release on prod (owner's call).
- **D64 LIVE ACCEPTANCE ✅ PASSED** — a fresh owner `/consolidate` on dev consolidated the
  coding-discipline family (3 reads full-coverage → create → 3 `{path, superseded_by}` deletes,
  **no hash anywhere model-facing**, clean archive/index/git trail, delta report). One cosmetic
  blemish (frontmatter `name` carried `.md`; the slug rider worked) hand-fixed in the dev corpus
  (`fc56efe`) **and closed forward by the prompt clause below**. Honest caveat recorded: this
  family was all single-page, so paged reads + the owner-steer branch ran only in tests — both
  will exercise organically (frontier-theme-prep ≈3 pages; gacha-theme-progress = the steer case).
- **The pre-release pair (owner-picked from the menu) — built, gated, review-closed:**
  - `6b72405` **consolidation bare-name clause** (step 2 + description + golden; the `32ec0e0`
    fold-the-blemish precedent).
  - `270030a` **C3 partial-failure drop** (the recorded lean fix: any failed chunk at end-of-queue
    drops the queue; a replay re-requests it; retires the "permanent ~" residual) → **Emma-lane
    blind diff round SHIP WITH FIXES, 1 MED 0.96** (a straggler synth failing AFTER the park
    recreated the stale replay one layer deeper) → `6656727` (**`parked` flag** + shared
    `dropSession()`; her flag shape won over the main seat's leaner-but-wrong all-ok-only
    retention — an existing test pins benign-hole retention) → confirm round **NOT RESOLVED, 2nd
    catch** (startChunked's replay re-arm kept the stale flag → a failing retry would drop an
    ACTIVE replay mid-listen) → `bdc484e` (one line in the re-arm block) → final confirm
    **"RESOLVED. No new findings."** Every wave's test stash-verified non-vacuous; full gate green
    per commit (BE 1873 · FE 2240).
- **NEXT: the release ruling is the only thing open** — push + runbook §Release (Opus-operated)
  on the owner's word; then the owner's post-release device pair (F1 + icon fresh-install).

## Prior state (2026-08-21, THIRD session — D64 end-to-end + the owner live rounds)

- **Prod UNCHANGED: v1.7.4 @ `92cb3a3`.** **13 commits now unpushed through `2368f50`** (the second
  session's 7 + this session's 6; push = the owner's word). Dev units RUNNING on the new code
  (backend restarted post-D64; FE via HMR).
- **D64 ✅ THE WHOLE LADDER IN ONE SESSION — Core Memory honest reads + server-side delete guard**
  (`2368f50`; DECISIONS D64 amends D60's model-carried-hash clause; as-built = CORE_MEMORY_PLAN
  §17, incl. §17.4 accepted residuals). The chain: the owner's failed dev consolidation →
  incident forensics (Opus audit, main-seat-verified: qwen SPLICED a 71-char content_hash from
  two hashes in context; separately the 11K topic was read truncated and merged lossy) → the dev
  corpus HAND-REPAIRED same day (unseen 2,915-char tail restored from .archive, mangled slug
  renamed, family completed; 53/53 index verified) → R53 bought+verified+indexed (field: 5/6
  peers page, 0/6 gate destructive ops on completeness; our truncation was announced-but-
  unrecoverable) → **the owner pointed at the Maia vault**: the Claude Code memory source spec +
  the Hermes Core Memory v1 contract (approved same day) — all three sources converge on
  server-side read-state, and the over-engineering verdict landed on the model-carried hash →
  design → **FULL council** (Emma correctness 3 HIGH/5 MED/1 LOW + adversarial Opus architecture
  F1–F9, every finding folded, none overruled; confirm passes BUILD ×2) → Opus-built 6 slices →
  Emma blind diff round SHIP WITH FIXES (the MED she REPRODUCED: framed-cost owner-steer) → fix
  wave → confirm **all-RESOLVED, SHIP**. Gate BE 1873 / FE 2236. Headlines: `read` pages
  (offset/limit, facts-only PARTIAL marker naming the next call) · `RecallState` high-water
  coverage minted at budget acceptance, receipts in `ToolResult.data`, suspend/resume reseed ·
  delete = `{path, superseded_by}` (no token; tool-layer freshness→coverage→owner-steer; corpus
  stays stateless; D60 crash-retry intact) · consolidation+dryrun prompts corrected ·
  `recall_char_limit` default 24,576 (measured: the §14f family = 81.7% vs 98.1% under the old
  cap) · riders (slug `.md`, suppression `{{details}}`, `_drop_entry`, `CoreStatus.oversized`).
  **The real acceptance still owed: a fresh owner consolidation run on dev under D64.**
- **ISS-10 ① ✅ SHIPPED (`8463082`)** — the motion-token band (2 durations + 2 easings in the
  semantic contract, 33 kit rules retokenized, ONE reduced-motion collapse in @layer axes,
  ease→M3-standard feel swap for the owner to eyeball). Emma diff round: SHIP, zero findings.
  **Stage ② (glyph-swap cross-fades) HELD UNBUILT by owner ruling ("if nobody does it, we don't
  need it either" — 6/6 peers don't); ISS-10 stays open-recorded.**
- **The mini-player bars** slimmed by owner round (`8504c4c`: 48 bars / 2.5px gap; the hollow
  "estimated" state → the recorded faint-fill fallback at the new width). Owner-confirmed.
- **ISS-11 ✅ found→blind-confirmed→fixed TWICE in one session (`74db7c8`)** — the oracle
  scanline pulse (the edge mask rode the M6 travel; Emma's blind round derived the identical
  mechanism from the symptom alone). Round 1 = owner ruled crisp-at-rest (one rule deleted, also
  ended the ghosting double-mask over-dim); round 2 = the owner-sized 14px melt rebuilt
  pulse-proof (stationary `.gc-oracle-scan` frame, comb+travel on `::before`; tunable
  `--gc-scan-edge-fade`). Owner-confirmed on dev. gachaChrome re-pins the invariant.
- Also: R53 committed `d9e55c7` · the D64+ISS-11 docs commit `19e3f75` · the dev corpus repair
  is committed in `~/.ctrl-b-dev/memories` git (`f0a116b` + the watcher's `0583e02`).

## Prior state (2026-08-21, SECOND session — the owner-round wave)

- **Prod still UNCHANGED: v1.7.4 @ `92cb3a3`** (rollback v1.7.2). **7 new commits on local `main`
  through `b069beb` — UNPUSHED (push needs the owner's word)**; origin remains `d5cc25a`. Dev units
  still RUNNING and serving the new work via HMR.
- **THE OWNER DEVICE ROUND (partial) landed and drove the session:** ① auto-stop dictation ✓ WORKS
  (incl. under chunked TTS) · ② **ISS-9 round 2**: the accent chip landed but the spin itself was
  invisible — 8 equal bars under a 45°-step rotation = every frame pixel-identical; fixed
  `52510fe` (graded opacity tail, iOS/Material pattern), **owner-confirmed "looks much better"** ·
  ③ **NEW: the per-chunk scrubber failed real use** → became S1.5 below · ④ F1 notifications
  test still owed (owner's afternoon).
- **C3 SLICE 1.5 ✅ BUILT + FULLY REVIEW-CLOSED — whole-message virtual-timeline scrubber**
  (D63 AMENDED 2026-08-21, the amendment block inside the D63 entry = the spec of record).
  The owner overruled "scrubber v1 per-chunk": the bar + seek now span the WHOLE reply while
  playback stays the untouched opus src-swap queue — per-chunk durations (exact via metadata
  probe once a blob exists, chars/sec-learned estimates before), global position/duration,
  seek → (chunk, offset) with backward-instant + forward on-demand synth, and the **three-state
  waveform (owner's idea): accent played · filled synthesized · HOLLOW OUTLINE estimated**, `~`
  on the time label while estimating. LobeChat's blob-rebuild stays a non-build (R48 §2.5:
  mp3-bound + per-seam reload). **The full ladder ran:** Opus build from the pinned brief
  (`9c6b482`) → Emma-lane blind round **SHIP WITH FIXES, 2 MED** (interrupted-play() race ·
  pending seek banked in estimated seconds) → fix wave (`c00a76d`: playOp token + within-chunk
  FRACTION paid out via one-shot loadedmetadata, end-guarded 50 ms) → confirm round **both
  RESOLVED + 1 NEW catch** (a newer same-chunk drag couldn't disarm the stale payout) → fixed
  (`b069beb`, `Session.metaSeek` canceller) → final confirm **"RESOLVED — no new findings."**
  FE tests 2219 → 2236; every commit full-gate green. **Live-verified visually on dev** (Playwright
  probe, real Kokoro): all three bar states simultaneously + `~-0:42` + a 20% tap landing at
  22% (within one bar); screenshots delivered to the owner. Accepted residuals recorded in the
  amendment §8 + the 9c6b482 ladder notes (mid-message rewind after forward-seek holes ·
  permanent `~` after a failed chunk · the ok-branch's ms-wide estimate window, reviewer-agreed
  below-bar).
- **R52 motion-language dossier BOUGHT + VERIFIED + INDEXED** (`58fc52a`; ISS-10's research).
  Headlines: 6/6 peers animate NO composer glyph swaps (we'd be ahead, not behind); the field's
  small-state pattern = scale+opacity cross-fade with direction-asymmetric timing (M3 checkbox
  150/350 ms ≙ Apple ReplaceSymbolEffect); consistency = a shared duration/easing token scale
  (our audit: 4 ad-hoc durations, 0 named easings); **a motion-style settings toggle has ZERO
  field precedent** — reduced-motion (ours exists) + per-theme token overrides is the pattern.
  **Cut-down #1 SHIPPED** (`b0c7db3`): `.kit-cbtn` now transitions border-color + transform (the
  rec/sending chip's ring used to snap while its fill faded). **The rest is PARKED by owner
  ruling (2026-08-21): "nothing fancy, consistent with the buttons, park for proper review
  later, after the TTS thing"** — the owner likes the current mic→mic+send animation and asked
  why 3×3 tokens; the wake-up is a DESIGN CONVERSATION (prose), not a build. ISS-10 stays OPEN
  with the pointer.
- **ISS ledger moves:** ISS-9 round-2 record + owner confirmation · **ISS-10 NEW** (icon-swap
  transitions, owner wish, parked pending the design talk).

## Prior state (2026-08-21, first session)

- **Prod is UNCHANGED: v1.7.4 @ `92cb3a3`** (rollback = v1.7.2; the whole 2026-08-20 record below
  still governs prod). **NOTHING released this session by owner ruling — everything soaks on DEV
  first** ("test it thoroughly in the dev server first"). **Origin = `main` @ `d5cc25a`** (13
  commits pushed 2026-08-21, full pre-push gate green). **Dev units are RUNNING at `d5cc25a`**
  (:5434 + Vite :5173) for the owner rounds. Every slice below walked the full ladder:
  council-closed spec → Opus build from the pinned brief → **Emma-lane blind diff round** (the
  Hermes `emma` lane is now THE standing reviewer by owner ruling — Codex CLI stays logged out) →
  fix wave → confirm all-RESOLVED, SHIP.
- **F1 host-up/down notifications ✅ COMPLETE** (`073f377` + `e1ab902` + `014dff8`): the
  `host_up_down` class (ONE class both directions, ACTION-name-keyed per D50 M5), Conf group-11
  row default ON, tap → FLEET tab through the R45 router, field-merged defaults at all three
  frontend read boundaries. The diff round caught a real HIGH (my one-liner broke 3 tests my
  spot-check missed — wrong filename). **Master notifications switch stays OFF by default
  (owner re-ruled 2026-08-21** — it also gates agent approvals; the spam guard stands).
- **D63 LOCKED + C3 SLICE 1 ✅ BUILT AND LIVE-VERIFIED** — chunked TTS (DECISIONS D63 = the full
  spec; ROADMAP §C3 = the close-out). Evidence: **R50** (probes: opus sample-exact on Speaches,
  its docs are stale; streaming = ~23 s Kokoro bursts so chunking beats un-buffering 19× vs 3.5×;
  src-swap seam 4–6 ms vs Kokoro's 250 ms trailing silence; **Chromium never becomes seekable on
  a Content-Length-less stream** → single-stream mode = recorded NON-BUILD, its seam = the
  queue's ordered source list). S1 (`6a65f7a` + review wave `7dfb704`): `lib/ttsChunks` chunker ·
  the element queue with depth-lookahead latch · `chunk_*` config (shipped default `chunking:
  sentence`, `chunk_format: opus`) · `tts_chunking` policy on `/voice/status` · the
  `X-Voice-Target`/`prefer` failover pin (chunk 1 bootstraps alone, then the window opens) ·
  exception-only serve flash behind `X-Voice-Degraded`. **LIVE-VERIFIED on dev against BOTH
  daily TTS backends** incl. AllTalk-as-primary in-app (5/5 chunks pinned `vault-alltalk/tts-1`;
  config swapped + restored byte-identical via the product PUT). **R50's addendum = the AllTalk
  envelope: opus ✓ all containers ✓, synth 1.5–2× realtime → recommend `chunk_lookahead: 2` when
  AllTalk is primary.**
- **Auto-stop dictation ✅ BUILT** (`ab70a59` + wave `d5cc25a`; R51 Tier 0, owner-greenlit as an
  STT Conf toggle): energy-silence detector on the existing mic stream, **default OFF**
  (`auto_stop` · `auto_stop_silence_s: 3.0` · `auto_stop_threshold: 0.01`), stops through the
  existing stop path so `auto_send` composes; `visibilitychange→hidden` stop is INDEPENDENT of
  Web Audio (the review's key catch — a suspended AudioContext degrades the detector but never
  the hidden-page safety); generation-safe async teardown. **⚠ the 0.01 threshold is
  UNCALIBRATED — no field provenance; the owner phone round calibrates it.**
- **ISS-9 ✓ FIXED** (`4b71516`): the post-recording transcribe spinner was invisible (motion in
  the resting color); `.sending` now takes an accent CHIP (the `.rec` pattern in the accent
  channel — red = recording, accent chip + roll = transcribing); line layout's filled circle
  deliberately keeps its face; browser-verified, screenshots delivered to the owner.
- **R51 realtime-voice dossier bought + curated** → **ROADMAP §C4** (future live-chat mode, NOT
  scheduled): ranked architecture ① = Speaches-realtime as the ear (already ships `/v1/realtime`,
  live-probed) + the untouched agent loop + **C3 as the mouth unchanged** (its cancel path IS the
  barge-in kill verb). **The #1 pre-design gate = the AEC device probe** (Chromium's echo
  cancellation ignores same-page audio; needs the owner's physical phone — build them a 2-minute
  probe page when C4 wakes). Curation correction folded: the owner's RealtimeVoiceChat fork is
  PRIVATE (the agent said public); the hardcoded-key finding downgraded and the **owner ruled
  IGNORE it** (reference-only repo). Owner context: their two daily TTS backends are Kokoro
  (fastest) and AllTalk (best quality) — features must serve both; standing permission to probe
  emma↔vault services when needed.

## ▶▶ NEXT (2026-08-21, third session, FINAL — the release-decision handoff; supersedes both
## lists below where struck)

**✅ PUSHED: origin = `main` @ `136e29d`** (owner's word, full pre-push gate green). Everything
below is committed, gated, review-closed. Dev units RUNNING on the new code (backend restarted
post-D64). **⚠ SESSION-START REMINDER: match model to tmux session + check effort (high).**

### 0 · THE RELEASE DECISION (the owner decides; everything they need is here)
- **The batch since v1.7.4: 33 commits, 17 feat/fix.** Headline = chunked TTS (~0.7 s first
  audio vs 13.6 s on prod today, both backends verified) + the whole-message scrubber + slim
  bars · auto-stop dictation (default OFF) · F1 host-up/down notifications · ISS-9 spinner ·
  the motion-token pass · ISS-11 scanlines · D64 memory hardening.
- **Recommendation: release as v1.7.5** (version policy: stay 1.7.x). NO schema/config
  migration (schema 6, config VERSION 1; the `recall_char_limit` 24,576 default is code-side,
  explicit config values override). **Rollback = v1.7.4.** No prod config flip this time.
  Runbook §Release, Opus-operated per the methodology.
- **Everything EXPOSED on prod defaults is owner-verified** (the player/scrubber/bars rounds ✓ ·
  dictation ✓ · ISS-9 ✓ · ISS-11 ✓; the motion feel-swap is reviewed + one-token revertible,
  eyeball rides daily use). **Everything NOT yet exercised is LATENT on prod defaults:** F1's
  device test (master notifications ships OFF) · D64's live consolidation acceptance (memory
  ships OFF on prod) · the icon-backdrop fresh install (standing since v1.7.4). So releasing
  NOW is sound, and the strict alternative is only half a day: F1's afternoon test + one
  `/consolidate` on dev, then ship.
- **Known-open register (nothing blocks):** ISS-10 ② glyph swaps (owner-parked by the
  "nobody does it" ruling — revive on wish) · the eslint/F13 Compiler-prep backlog (deferred,
  count in QUALITY.md) · D64 §17.4 accepted residuals (page-count floor · scan-dependent
  owner-steer) · the HARDENING known-open register (Phase 19, owner-gated) · the standing
  ledger below (unchanged).

### 1 · Owed acceptances (close on dev or prod, before or after the release)
① **D64 live acceptance:** a fresh owner `/consolidate` on dev — watch for paging in the read
trail, the rail's steering on anything partial, NO hash anywhere in the transcript.
② **F1 notifications device test:** master ON → background the app → host transition → tap
lands on the FLEET tab. ③ **Motion feel:** does the composer read snappier or wrong (one
token back if wrong). ④ **Icon-backdrop fresh install** (standing).

### 2 · The work queue after that (in order)
1. **C3 SLICE 2 — read-along-while-streaming** (D63-designed; S1 hook points + S1.5's growth
   contract recorded in the build reports; own slice, own round).
2. **The A13 design talk** (OpenAI-OAuth/Codex provider; R49 = the evidence; needs its
   D-entry conversation — prose, per the owner's preference).
3. **Phase 19 (D58) owner court** — the big standing gate (spec-complete; §10 rulings + the
   §3b delta council check).
4. **Parked/standing:** ISS-10 ② (owner wish) · the media-gallery test-and-refine session ·
   the root cross-fade owner-present session · Web Push (parked on merits) · the vault/wiki
   spec (owner designing elsewhere — and NOTE: the owner's Maia vault specs proved decisive
   evidence for D64; check them before re-researching adjacent ground) · arcade redesign
   (someday-maybe) · the color-theory unit-palette session (parked) · owner minis (edit a
   prompt for real · pickers eyeball · watch a corsair cold-boot wake).

## Prior ▶▶ (2026-08-21, second session — superseded)

0. **PUSH the 7 unpushed commits** (`52510fe`..`b069beb`) once the owner says push — everything
   is committed, gated, review-closed.
1. **THE OWNER DEVICE ROUNDS on dev — still the acceptance** (dev serves the new work via HMR):
   ① C3 seam audibility on Android — **now PLUS the S1.5 scrubber feel** (whole-bar seek, the
   hollow-outline tail at phone size — the recorded fallback if outlines read as noise is a
   fainter fill — and the `~-0:42` tilde placement, a builder-flagged eyeball item;
   optionally AllTalk-primary + `chunk_lookahead: 2`) · ~~② auto-stop dictation~~ **✓ WORKS
   (owner, this round)** — threshold 0.01 held; recalibrate only if a real session misfires ·
   ~~③ ISS-9 chip~~ **✓ round 2 confirmed "looks much better"** · ② F1 — master notifications
   ON, background the app, let a host transition, tap → fleet tab (**owner: this afternoon**) ·
   ③ the icon-backdrop FRESH INSTALL (still owed from v1.7.4) · ④ the R52 cut-down eyeball
   rides along free (the mic chip's ring now fades with its fill).
2. **C3 SLICE 2 — read-along-while-streaming** (unchanged, D63-designed): the S1 hook points in
   the builder report + **S1.5's growth contract is recorded in its build report** (push onto the
   five parallel Session arrays + `publishTimeline` + `pump`; the ONE addition S2 must make = a
   `growing` latch so end-of-queue holds instead of `finish()`).
3. **The RELEASE ruling** — the batch grew by this session's 7 commits (still no schema/config
   migration; schema 6, VERSION 1; rollback v1.7.2).
4. **The ISS-10 motion design talk** (owner-parked, after the TTS thing): start from R52 §8 +
   the owner's words — likes the current mic→mic+send animation, "nothing fancy", asked why
   3×3 tokens; converse in prose first, no build until ruled.
5. **A13 design talk** and **Phase 19 (D58) owner court** — unchanged, in that order.

## Prior ▶▶ (2026-08-21, first session)

1. ~~THE OWNER DEVICE ROUNDS~~ — partially run; see the second-session list above.
2. **C3 SLICE 2 — read-along-while-streaming** + the single turn-end ownership entry point:
   fully designed + council-closed inside D63 (triple-gated resplit · MED-3 ownership rule).
   The S1 builder recorded the exact hook points in its report: `useAutoTts.ts:50` →
   becomes `speakTurnEnd`; the queue needs only an `appendChunks` (it is already index-driven
   with a `waiting` latch); the delta boundary gate lands at `store/chat.ts` `text.delta`.
   Own slice, own review round.
3. **The RELEASE ruling** once dev soaking satisfies the owner: the batch = F1 + C3 S1 +
   dictation + ISS-9 + the doc/research commits — **no schema/config migration** (all additive
   with defaults; schema stays 6, config VERSION 1). Runbook §Release; rollback stays v1.7.2.
   Note the new validator coupling: lowering `max_text_chars` in Conf below `chunk_max_chars`
   now 422s (intended).
4. **A13 design talk** (OpenAI-OAuth/Codex provider, R49) — unblocked; owner ruled "C3 first,
   then A13". Headline to weigh: the token buys the Responses-ONLY endpoint (adapter bridge =
   the real cost) + the ToS-silence risk.
5. **Phase 19 (D58) owner court** — unchanged, still the big standing gate (spec-complete;
   §10 rulings + the §3b delta council check).
6. **Recorded residuals, no action owed:** C3 partial-failure replay never re-requests its
   failed chunk (reviewer-ruled below the bar; lean fix recorded = drop partial-failure
   sessions in `finish()`) · the line-layout sending face unchanged (deliberate, ISS-9) ·
   R48 §8.1 Android src-swap numbers (the owner round IS the probe).

---
*Everything below is the PRIOR session's record (2026-08-20), kept verbatim until the next
archive sweep; where it conflicts with the 2026-08-21 blocks above, the above governs.*

## Prior state (2026-08-20)

- **Prod = v1.7.4 @ `92cb3a3`**, live + healthy (https://emma.lobster-vector.ts.net) — RELEASED
  2026-08-20 (Opus-operated runbook run; CI release gate green incl. e2e; no config/DB migration —
  schema stays 6, config VERSION stays 1). The batch: D60 + D61 `/consolidate` UX + **D62
  per-message serve attribution** + the qwen normalization `5678c08` + the notification-tap SW
  slice + the ISS-2/7/8 sweep. **Rollback = v1.7.2** (`bash ~/apps/ctrl-b/deploy/linux/update.sh
  v1.7.2` + the pre-flip config at `~/.ctrl-b/backups/config.yaml.20260820T111619Z`). **⚠ v1.7.3
  is tagged but NEVER DEPLOYED — its release gate went RED on four stale arcade-lift e2e pins
  (4px→3px, `630219d`'s ruling; fixed `92cb3a3`) — NOT a rollback target**, joining v1.7.0; the
  deeper floor stays **v1.5.1 EXACTLY** — sw.js. Version stays in the 1.7 line by owner ruling
  (re-confirmed 2026-08-20: "keep 1.7.3" → burned → v1.7.4).
  **THE PROD CONFIG FLIP IS DONE (2026-08-20, product-path PUT, hot-applied, secrets
  digest-verified byte-identical): corsair/qwen3.6-max = prod's PRIMARY**, fallbacks
  llamacpp/gemma4 → openrouter gemma (whose entry now carries `context_window: 262144` — the D60
  pressure gate is armed, §15d). ~~The owner's first real turn is the live no-failover proof~~
  **✅ PROVEN 2026-08-20 (the owner's prod round, later the same day): every assistant turn in
  prod's DB since the flip carries `source.served: corsair`, `degraded: 0`, no `from`/
  `failed_hops` — 4/4, DB-verified.** Core Memory remains OFF by default on prod, untouched
  posture.
- **2026-08-20 (afternoon): THE OWNER PROD ROUND** — the owner exercised v1.7.4 on production:
  the cosmos banners toggle (ISS-2) ✓ · the agent ✓ (= the no-failover proof above) ·
  notifications deliver on prod ✓ · **the notification-TAP device round ✓ (owner-confirmed:
  tapping lands on the agent tab — the R45 slice works on device; channel 1 fully closed)** ·
  "pretty much all of the things that we did work — tried them all." **Still pending: the
  icon-backdrop fresh install** (W5/D59 — owner will check later).
- **2026-08-20 (afternoon, same session): THE ORGANIZATIONAL ROUND — owner rulings on the
  open-item sweep + research commissioned + the drift sweep done:**
  - **A9 (composer model indicator) ✗ DROPPED** — superseded by D62's who-line chip (ROADMAP
    entry rewritten; don't re-propose).
  - **F2 (hidden-appbar connection indicator) ⏸ DEMOTED** — not a standalone slice; if ever
    built it's a designed element of a plainer theme's fleet tab (frontier-class, NOT gacha).
  - **F1 host-up/down toggle GREENLIT** — small FE slice, classifier class + Conf toggle keyed
    on ACTION name (D50 M5); **tap ruling: opens the FLEET tab** (one more `focus` value through
    the shipped R45 router). No research needed — R45 + D50 already bought the design.
  - **C3 (chunked TTS) + A13 (OpenAI-OAuth/Codex provider) GREENLIT pending research → both
    dossiers BOUGHT + VERIFIED + INDEXED same-day: R48 + R49** (`docs/research/`; load-bearing
    claims spot-verified — Hermes source for R49, repo seams for R48). Headlines: R48 — field
    mechanism = HTMLAudioElement src-swap queue (NOT Web Audio/MSE), mp3 breaks under chunking
    (~46 ms dead air/chunk, measured — use opus/wav), 4 corrections to the §C3 sketch recorded
    in ROADMAP; R49 — device-code flow cheap, but the token buys the **Responses-only** Codex
    endpoint (the adapter bridge is the real cost) + Cloudflare-originator and ToS-silence risks.
    **NEXT for each: a design session → D-entry** (both entries carry the pointers).
  - **The drift sweep:** eslint recount **49** (QUALITY.md = the only count home; PRE_DEPLOY/
    UI_AUDIT/HANDOFF de-numbered) · HARDENING §8.2 gains the SWA `--swa-full` item + CM-2 marked
    closed · §8.4 ②③④⑤⑥ done (SYS-17c dispositioned in SYSTEM_AUDIT §4; F21 row; PRE_DEPLOY QR
    line; TODO idle-sleep/D2 + F1 boxes) · ROADMAP truth-fixed (ensemble = shipped v1.6.0; D2-A =
    shipped v1.4.6).
- **Phase 20 Core Memory: ✅ BUILT END TO END 2026-08-17 (D57, S0–S5 all complete in one
  session).** Spec of record + per-slice review records + the as-built appendix =
  [`CORE_MEMORY_PLAN.md`](./CORE_MEMORY_PLAN.md) (§11 ladder ✅ · §14 appendix with the measured
  numbers). Ships **OFF by default** (`memory.longterm.backend: null`; byte-identical prompt
  assembly while off, gate-proven); enabling = one Conf switch; adopting a Claude corpus = the
  §3b copy-in procedure (incl. the one-time prod `.gitignore` reconcile). Every slice was
  Opus-implemented from a pinned brief, Codex-reviewed (S3's review found 2 real HIGHs —
  DO NOT SHIP → fixed + confirm round), and full-gated. D57 in DECISIONS.md; ROADMAP §B1 =
  the tier model; **the parked hardening charter renumbered to D58.**
- **2026-08-17 (later): the stack is PUSHED** (owner's word; full pre-push gate green) — origin
  at `247e968`. **The first live drive ran on dev the same day** (§3b exercised end-to-end on a
  57-topic real Claude corpus; injection/read/status all good) **and caught two real defects in
  the `create` path** — the secret gate false-positived on short configured secrets (1-char
  placeholder keys + the 4-char SSH password bricked every index write) and a refused create
  half-wrote an orphan topic. **Both fixed same-day** (the post-S5 fix wave: `_SECRET_MIN_CHARS`
  floor + gates hoisted above writes; Codex SHIP WITH FIXES → confirm round all-CONFIRMED; +2
  tests). Full record: CORE_MEMORY_PLAN **§14b**. Core Memory is also now **pinned into the
  Phase 19 scope on both lenses** (owner, 2026-08-17): Packet ③ + the SECURITY_MODEL re-walk +
  DP-B memory-tiering design review + the §7 inventory delta note; residuals = CM-1/CM-2 in
  HARDENING_PLAN §8.2. Dev units back to on-demand (2026-08-18); dev's tier-2 state is
  on disk — tier 2 ON with a copy of the Claude Code session corpus at
  `~/.ctrl-b-dev/memories/core/`, index at **81% of the 10240 cap** (2026-08-20, post-resize +
  the anomaly re-index) — over the 80% threshold, so the owner-facing pressure note fires
  organically on dev turn terminals.
- **2026-08-17 (evening): the DOC-TRUTH PASS** (owner: "documentation completely consistent with
  the actual design and architecture"). Five auditors verified every live doc against code (~90
  findings, all file:line-evidenced), five editors applied them, Codex adversarially reviewed the
  full diff (COMMIT WITH FIXES → 8 more, 7 applied + 1 overruled: the launcher/deploy docs carried
  the pre-2026-07-28 seat arrangement — fixed at the source). Re-baselined: DESIGN (provider-terms
  `ModelRef`, real `Settings`/§9.1 provider registry, `Database`, memory stores, §5.8 prompt
  registry, real error taxonomy), SPEC inventories (automations/media/monitor/notifications ✅,
  D44 flips, 5 themes, readonly truth-table row, ER to schema 6), SECURITY_MODEL §2.6 (Core
  Memory) + the serve-FULL exception + `GitMemoryBackup`, THEME_ENGINE add-a-theme entry points +
  §14.17 section layouts + Kit Art System/safeRafLoop, QUALITY (43-warn lint recount, firefox e2e,
  `_gate.sh`), README/CLAUDE/AGENTS/deploy runbooks. Everything code-anchored; nothing relitigated.
- **2026-08-18: THE POLISH WAVE — 4 slices designed, built, Codex-reviewed, RELEASED as v1.7.2
  same-day** (commits `f246096` W3 · `0b373f0` W1 · `19e9dfc` W5 · `e50d39b` W2; every slice
  Opus-implemented from a pinned council brief, per-slice Codex round — zero HIGHs, every MED/LOW
  folded same-day; full gate per slice):
  - **W3** — media `revision` → `mtime:size:ino:ctime` (the `_stamp` recipe; closes R21 ①), and
    the §14.11 SVG-filter waiver counter → an ENGINE-WIDE source sweep vs a declarative allowlist
    (`svgFilterWaivers.test.ts`; closes R21 ③). The sweep's dry run found cosmos's carved moon
    (`#cosmosCarve`) had shipped unrecorded since June — now **waiver ②, owner-ratified**.
  - **W1** — the pinned-plan/mini-player overlap CLOSED in every chrome mode (was −18..−27px in
    `minimal`, −1..−3px in `off`): derived band tokens (`--kit-inset-top` · `--kit-plan-top` ·
    `--kit-plan-band-top`) + a ResizeObserver-published `--plan-head-h` replace the 46px literal;
    gap = 8px in all 20 theme×mode cells, safe-area-invariant; vapor's flush tab now rides
    `--kit-plan-gap: 0`. Rider: `.toasts`/`.kit-tts-toast` take the same inset. New e2e pins the
    gap, the (previously untested) bar-less insets, token consumption via sentinel injection.
    Contract: THEME_ENGINE §14.4.1 "PINNED-PLAN BAND".
  - **W5 (D59)** — the *App icon backdrop* selector (Conf → Appearance: Clear · Ink · Night ·
    Orchid · Paper). Chrome 144+ treats manifest icon URLs as immutable, so the backend serves
    `/manifest.webmanifest` itself, patching the maskable `src` (GET+HEAD, no-cache, sha ETag);
    `appearance.pwa_icon_background`, closed allowlist, no migration. Clear = byte-identical to
    the pre-wave icon, ENFORCED by a sha-pinned generator refusal. iOS rider: apple-touch icon
    baked at ink (was transparent → iOS painted it black). Supersedes the old "R28 §9" path.
  - **W2 (D37 amendment)** — the `composerSkin` axis widened to the **TTS mini-player** and the
    **pinned plan head** via the 11-slot kit-owned `--skin-*` vocabulary (~16 per-skin rules →
    5+2 blocks; `skinVocabulary.test.ts` fences names/scope/authority/geometry). NO visual change
    to glass/**bezel**/sleek/outline pre-existing chrome (24-cell matrix-verified — bezel is the
    owner's daily); the ONE ruled delta: **arcade's drop → solid 4px `var(--accent)`** (R20 #1
    ALIGN). `--arcade-lift` gone; frontier's private player border rule deleted (§14.14
    graduation).
  ~~**Owed to the owner (phone/eyeball):**~~ **the 2026-08-19 owner round closed most of it:**
  skin round ✓ "looks good" · minimal-mode gap ✓ on the notched phone · arcade's drop re-ruled
  **slightly smaller → `--skin-lift` 3px** (`630219d`; owner note: arcade "wasn't very thought
  of" — a real redesign is a someday-maybe, NOT backlogged) · the icon pick pends a FRESH
  INSTALL (owner had no installed app to update — a fresh install mints the chosen backdrop
  directly, no approval dance) · the notifications retest was IN PROGRESS at session close, no
  result reported yet.
  **Parked by owner to its OWN session (owner at the screen):** the root cross-fade damp — the
  detail-morph's whole-screen zoom/screenshot swap; "eyeball, don't remove blind"
  (GACHA_PLAN §12.6 E1).
- **2026-08-19: THE OWNER LIVE ROUND (this session, all owner-verified on dev same-day):**
  ① R20 #4 white-bar CLOSED (owner diagnosis; R20/R21 fully drained) · ② **the pinned plan pill
  floats OVER the oracle** (`a90ad84`, owner round 3): the panel's sticky flow box had reserved a
  pill-height band over the full-bleed art — the art now pulls up by the measured `--plan-head-h`
  too, pill overlays like the launcher icons; permanent e2e arm pins the 12-cell invariant
  (probe gotcha recorded in the arm: the thread bottom-pins on load, so the static fade-off
  oracle must be measured at scrollTop 0) · ③ arcade drop → 3px (`630219d`) · ④ **the `cache_n`
  measure ran** (`8eea6c2`; §14 Measured bullet — assembly holds, the SWA host drops the cache) ·
  ⑤ **the FIRST CONSOLIDATION RUN ran on dev and FAILED informatively** (`11fdcaf`,
  CORE_MEMORY_PLAN **§14c** = the full record + the two-sided redesign brief: zero writes, rails
  held — CAS blocked a real whole-file-rewrite-from-truncated-read near-miss; the shipped prompt
  asks for a pass the per-turn budgets make structurally impossible; **owner direction: the
  consolidation mechanism, especially the prompt, gets a REAL DESIGN PASS before it is ever
  automated** — the session pends) · ⑥ **ISS-3 CLOSED** (vapor + minimal appbar worked all along
  since D51 deleted the bespoke bar; owner-verified "looks good", menu icon included).

## Prior ▶▶ (2026-08-20) — ~~the RELEASE DECISION~~ ✅ RELEASED v1.7.4 2026-08-20; superseded
## where the 2026-08-21 blocks above say so (F1 ✅ built · C3 ✅ designed+S1 · A13 unblocked)

**D61 is BUILT and its live exercise ran 2026-08-20 (see path 2 below). The 2026-08-20 CLOSE-OUT
SWEEP then drained the closeable backlog (owner: "close all the issues and fixes we can"):**
D61's exercise end-to-end (incl. corsair woken via `wake_host`, qwen answering the verb) · the
§14f prompt tuning `32ec0e0` · the dev index-anomaly fix · the F9/F13 trigger MEASURED (UI_AUDIT
— 220-message thread, 1×+4× throttle, no input lag: the deferral now stands on data) · **ISS-2 ✓**
(cosmos `banners` switch, default ON, `879f3d1`) · **ISS-8 ✓** (user who-line at the bubble's
right edge, `1889d67`) · **ISS-7 ✓ hardened** (keyboard-aware plan-sheet clamp, `26e661d`) ·
R47 bought+indexed (`bc384a1`) · **D62 ✓ — per-message serve attribution (ISS-5): LOCKED
(`0868805`), Opus-built (`9caaf3d`), live-poked on dev, Emma-lane review SHIP WITH FIXES (3 MED)
→ fix wave `5359132` → confirm all-RESOLVED, FINAL SHIP; gate BE 1818 · FE 2151.** What remains
before the release runbook: the owner device eyeball (cosmos toggle · ISS-8 who-line · the D62
chip/disclosure at 420px) and the ruling itself.

**Unreleased on `main`, all owner-verified, no schema/config migration (schema 6, VERSION 1):**
the 2026-08-18 gacha first-block pair (`c8dc09d`+`0e20de0`) + the 2026-08-19 stack (white-bar
close · plan-pill-over-oracle fix `a90ad84` + its e2e arm · arcade 3px `630219d` + its mirror-pin
fix · the cache_n + §14c records · the doc sweeps — pushed through `3e93774`) + **`5678c08`
(✅ pushed, 2026-08-19 — everything below is on origin): the wire-level system-message
normalization that makes qwen3.6-max on corsair serveable — the owner's NEW PRIMARY chat model (see the `qwen-primary-on-corsair` memory; R41/R42
= the evidence; council = the adversarial Opus design lens + ✅ the Codex DIFF round DONE 2026-08-19 via the
Hermes `emma` lane (gpt-5.6-sol; SHIP WITH FIXES → the `8575ae2` wave → two confirm rounds →
FINAL SHIP). The Codex CLI on emma is still logged out — desktop `ssh -L 1455` + `codex login`
when convenient; Hermes's own codex credential is FRESH (device-code, 2026-08-19)). DEV runs corsair-primary
live; **the PROD config flip (provider corsair + fallback chain) happens ONLY AFTER the release
carrying `5678c08`** — the pinned prod tree lacks the normalization until then.** A release is a
clean plain-form runbook run (§Release; rollback stays v1.7.2), then the prod config flip +
restart + a no-failover journal check. **The flip must also set `context_window: 262144` on
prod's `google/gemma-4-31b-it:free` openrouter entry** — without a window on EVERY chain entry
the D60 ① pressure gate stays inert (§15d finding; dev already carries it).

**The pre-release menu — things that COULD close first (none gates the release; pick or skip):**
- ~~The notifications retest result~~ **✅ PASSED (owner, 2026-08-19): notifications DELIVER**
  (service reboot + machine reboot/shutdown all fired — SYS-19 was the whole mystery; the two
  Fennec checks are moot; Web Push stays parked, its remaining value = closed-app delivery only).
  **NEW open item: tapping a notification lands on the Android home screen, not the app** — the
  F1 slice's *documented* trade-off (`useForegroundNotifications.ts` ~L138: Android's SW-shown
  notifications click into the worker's `notificationclick` handler, and the Workbox worker has
  none). The fix is designed in R10 (§4.2 focus-or-open + implication #5: `focus` in
  `notification.data` → the same `setUI({tab:"agent"})` router); R10 pins `injectManifest`
  (§3.2) but never evaluated the lighter generateSW `importScripts` path — an owner design
  conversation picks one, then it's a small slice. Owner intent: tap → agent tab with the
  approval/trigger in view. **→ RESEARCHED + RULED 2026-08-19: R45 (bought, verified) —
  `workbox.importScripts` under the current generateSW build, NO injectManifest migration
  (~150 lines, 0 deps, update path byte-identical; the "custom worker required" premise in
  `useForegroundNotifications.ts`/R10 is FALSE — LibreChat ships this exact mode). ~~Build
  pends owner go-ahead~~; R45 §8 = the implementation sketch (content-hashed import URL ·
  postMessage-first routing · `?tab=agent` fallback reader · unit-tested handler).**
  **→ ✅ BUILT 2026-08-19 (committed `b1c3018`, pushed):** `frontend/public/notify-sw.js` +
  `workbox.importScripts` with the content-hashed URL (verified in a real `vite build`: the call
  lands one line ahead of the SKIP_WAITING listener, exactly as R45 §1.2 predicted) ·
  `data:{focus,key}` on the notification · one exported `applyNotificationFocus` router shared by
  the constructor `onclick` and the SW `message` path · `store/ui#consumeTabParam` reads+strips
  `?tab=` at boot without persisting. 15 new tests (worker handler incl. the focus()-rejects
  Fennec case, the router, the SW message, the param parser, a vite-config `?v=` pin); ROADMAP §F1
  carries the close-out. ~~OWED: the manual device round~~ **✅ PASSED 2026-08-20 (owner, prod
  v1.7.4): the tap lands on the agent tab.** (The Fennec expected-partial caveat — Bugzilla
  1880000 — stays recorded in ROADMAP §F1 for reference.)
- **The icon fresh-install** — W5 is LIVE on prod v1.7.2 already; the owner (no installed app
  currently) installs fresh from Chrome and the chosen backdrop mints directly. Zero code.
- **The arcade later-look** — the 3px drop is committed but the owner deferred the eyeball;
  a further tweak would be one token. (Arcade redesign proper = someday-maybe, NOT backlogged.)
- **The root cross-fade session** (owner at the screen; GACHA_PLAN §12.6 E1) — a ruled damp
  could ride the same release if the session happens first.
- **Owner standing minis:** pickers eyeball · edit one prompt for real (Phase 18's first
  owner-driving) · the media-gallery test-and-refine session (parked 2026-08-12).

1. ~~Push the commit stack~~ ✅ 2026-08-17; ~~the polish wave + v1.7.2 release~~ ✅ 2026-08-18;
   ~~the post-release rounds~~ mostly ✅ 2026-08-19 (the owner-round bullet above).
2. **Core Memory prod adoption — ⏸ OWNER-DEFERRED (owner, 2026-08-17): "not right now; I just
   want the system working and ready for whenever I want to delve into it."** Don't re-propose
   the drive; readiness is now a VERIFIED property owned by Phase 19 Packet ③'s core-memory
   readiness rider (a scripted end-to-end dev exercise, §14b as template). When the owner does
   delve in: enable on prod per §3b (the pre-copy `.gitignore` step first!), real vault, a
   promotion, a `consolidation` run — **⚠ TWO consolidation runs FAILED on dev 2026-08-19
   (§14c gemma · §14d qwen3.6-max). **→ the redesign ran SAME-DAY as D60 (locked, BUILT,
   REVIEW-CLOSED 2026-08-19 — spec §15/§15b, as-built §15c): pressure-gated clearing ·
   current-turn immunity · split budgets · guarded soft deletes · dry-run-first prompts; full
   council via the Hermes emma lane, final SHIP; commits `bdff95d`..`6063b40` ✅ pushed
   2026-08-19, and the §15d post-push verification audit re-confirmed both packages in code
   (one real fix landed from it: the recall-floor reseed carry).
   ~~NEXT = RUN 3 on dev~~ → **RUN 3 DRY-RUN ✅ SUCCEEDED 2026-08-19 (CORE_MEMORY_PLAN §14e):
   first run ever to produce a complete reviewable plan — one turn, zero writes (sha-verified),
   graceful budget recovery, D60 ② visibly holding on qwen3.6-max (① was inert — §15d). →
   **RUN 3 LIVE ✅ SUCCEEDED same day (§14f): the first consolidation that WORKED** — the
   acceptance-① shape exactly (4 reads → create → 4 `superseded_by` deletes, ONE 283s turn, all
   OK), high-fidelity merge supervisor-graded against the archived sources (2 blemishes
   hand-fixed + banked as prompt-tuning candidates: no-frontmatter-in-body · verify-see-alsos);
   finding: at index cap, consolidation frees lines that previously-HIDDEN topics refill
   (99%→100%, CM-2 stands). MERGE 2 stays held (§14c #3 paged-read residual); remaining
   families = ordinary owner-paced curation; dev keeps `topic_char_limit: 8192` +
   `auto_write: true` + `index_char_limit: 10240` (owner sizing — closed CM-2 for this corpus).
   → **D61 (the consolidation-UX slice) ✅ BUILT + REVIEW-CLOSED 2026-08-19 (commit
   `fb2a995`, UNPUSHED; as-built = CORE_MEMORY_PLAN §16c): `/consolidate [dry]` with the
   auto_write guard refusing BOTH mismatched directions · the owner-facing pressure note at
   `notifyTurnTerminal` (coalesced-follow-up latch) · the model-facing pressure clause REMOVED
   (header = plain data) · default index cap 10240 + the full sweep · the `search` omission
   counter with the in-cap tail note. Opus-built from the §16 pinned brief; Emma-lane diff
   round SHIP WITH FIXES (4 MED: latch re-arm race · async scope clear · omitted-only body
   over cap, reproduced · non-fail-closed guard) → all folded same-day → confirm round
   all-RESOLVED, FINAL SHIP; full gate green (BE 1801 · FE 2129). ~~OWED: the live/device
   exercise~~ **✅ EXERCISED 2026-08-20 on the live dev app** (§16c: pressure note fired in a
   real thread + config-driven threshold proven · both guard refusals at the UI · the real send
   proven mechanically through the whole failover chain · zero corpus writes sha-verified · the
   `testing-parked-wing-it.md` index anomaly re-indexed, anomalies `[]`; the no-model-answered
   residual closed the SAME DAY — corsair woken via the app's own `wake_host`, qwen3.6-max
   answered the verb's dry run with a real 5,868-char plan — **D61 exercised end to end,
   nothing owed**). The §14f prompt-tuning pair also
   folded into the `consolidation` default (`32ec0e0`, 2026-08-20). THEN the release ruling —
   the batch carries D60 + the qwen normalization + the §15d fix + the notification-tap slice +
   D61 + the full 2026-08-20 close-out sweep (`32ec0e0` prompt tuning · ISS-2/7/8 · R47 ·
   **D62** `9caaf3d`+`5359132`, review-closed).** ~~The live `cache_n`
   measure~~ ✅ run 2026-08-19 (CORE_MEMORY_PLAN §14 Measured bullet): ctrl-b's assembly holds
   D15 #4 (writes diverge only inside the index block, head byte-stable) but the local gemma
   host drops the whole cache when a write lands deeper than its 2,048-tok sliding-attention
   window — remedy = `--swa-full`/checkpoints on the llama.cpp box, routed to Phase 19 (D58).
3. **The NOTIFICATIONS thread — ✅ CHANNEL 1 FULLY CLOSED 2026-08-20**: delivery passed
   2026-08-19, the tap slice shipped in v1.7.4, and the device round passed 2026-08-20 (tap lands
   on the agent tab). What remains in F1 = the **greenlit host-up/down toggle slice** (tap →
   fleet tab; see the organizational-round bullet). Web Push (R10/R11) stays parked.
4. **Phase 19 — the hardening pass — now NEXT IN LINE (Phase 20 done), still owner-gated**
   (owner, 2026-08-17). [`HARDENING_PLAN.md`](./HARDENING_PLAN.md) is spec-complete; at wake: its
   §10 owner court + the §3b delta council check; locks as **D58**.
5. **Gacha banked follow-ups** (owner-eyeball-heavy): the color-theory unit-palette research
   session (owner 2026-08-18: PARKED — "colors look good for now") · ~~root-cross-fade flicker~~
   → its own owner-present session (see above) · ~~kit minimal plan/player overlap~~ ✅ W1 ·
   the standing ledger below. **The R20/R21 addenda are nearly drained:** R20 #1 (the composer's quieter drop) closed as ALIGN in W2 · R21 ① (content-identity
   revision) + ③ (the engine-wide SVG-filter waiver sweep) built in W3 · R21 ④ (the HANDOFF archive)
   was done 2026-08-12. What is left needs no work: R20 **#2** (the 4-line-name/rarity-tab touch) and
   **#3** (the 7s scan-mask pulse) are *accepted as recorded* — a guard would be speculative padding;
   R21 **②** (one fallback frame on an unwarmed name-face) is *deliberate* (the warm-the-resolved-union
   design); R20 **#4 — the "white bar atop the appbar" — ✅ CLOSED 2026-08-19 (owner diagnosis:
   Chrome Android's page/URL-bar separator, browser chrome not the theme; absent in installed-app
   mode where there is no URL bar)**. **The R20/R21 addenda are now fully drained — nothing open.**
6. ~~The R28 installed-icon improvement~~ ✅ 2026-08-18 — superseded by the W5 selector (D59;
   R28 §12 records the Chrome-144 supersession of §9). What's left is the owner's phone pick.
7. **Fleet-liveness decoupling from Tailscale** (owner-gated; the D47 seam) — only if the
   cold-boot wake blindness recurs.

**Owner-side standing items:** actually *edit a prompt or two* on prod (the Phase 18 feature's
first real owner-driving) · eyeball the pickers · watch the next corsair COLD-BOOT wake · the
update toast exercised ✅ 2026-08-16.

## Standing ledger (carried 2026-08-12 from the 2026-08-06 ledger; verify in the home before acting)

**Owner-court items (ask, don't assume):**
- Notifications: channel 1 ✅ FULLY CLOSED 2026-08-20 (delivery + tap routing, device-confirmed) ·
  web-push stays PARKED on its merits (closed-app delivery only) · OPEN = the greenlit
  host-up/down toggle slice (path 3).
- The ~80 MB untracked `design/prototypes/gacha/` originals — standing "leave untracked for now";
  eventual call = leave / move out / delete.
- D2-A monitor: the owner DAILY-USE round on prod (its memory; per-host switches OFF until then).
- Cosmos "Alive/uptime" stat shows "—" (backend has no boot time; additive later — its memory).
- The vault/wiki spec stays PARKED (owner designing elsewhere; the binding requirement =
  whole-functionality enable/disable toggles).
- ⏸ The media-gallery OWNER ROUND is PARKED (owner, 2026-08-12): custom art file-drops + the
  phone gallery (incl. REAL-TOUCH drag-reorder, verified only at layout level — GACHA_PLAN §7.6)
  are still untried; the owner wants a dedicated test-and-refine session for the feature sometime.

**Standing KIT items (homes verified 2026-08-06):**
- `getJSON` has NO global timeout (the 5s bounded media-invalidation await works around it —
  GACHA_PLAN §7.6) · kit sr-only sheet-close duplicates the ×'s accessible name (GACHA_PLAN :964)
  · the a11y e2e sweeps TABS only — no arm opens a bottom sheet/dossier (e2e/a11y.spec.ts) ·
  `skipActiveViewTransition` is global, not per-layer (G2 standing note) · ~~kit-wide `appbarMode:
  minimal` pinned-plan header × mini-player OVERLAP~~ **fixed 2026-08-18 (slice W1** — derived
  plan-band tokens + a measured header; VAPOR_BANNER_LEDGER §7.1**)** · the eslint-warn backlog = the F13 React-Compiler-prep backlog (UI_AUDIT; deliberately
  deferred; the count lives ONLY in QUALITY.md's warning accounting — 49 @ 2026-08-20) ·
  SYS-16's ASYNC240 lexical blind-spot list (SYSTEM_AUDIT addendum).

**Recorded LOWs / deliberate non-fixes (all in D54 or the as-builts):**
- Conf gallery THUMBNAILS use bare URLs — stale after an in-place overwrite (surfaces use
  `?rev=`) · the scroll listener's commit→passive-flush window (worst case = one lost position =
  the old behavior) · `isolation` on `.kit` exists only while `.kit-bg` mounts · `appbarMode`
  change does NOT clear scroll positions (recorded non-decision, `fa74a8a`) · under jade,
  `--accent` and ok-green are both greens on KIT surfaces · the pre-existing `--gc-tag-ink` 4.27
  on arcade's brand fill (§7.7 records it; a G7+/owner call).

**Future-feature seams (ROADMAP/plan-recorded, no action owed):**
- The D54 sixth-theme adopter contract (a future theme must swap `background` shorthand →
  `background-color` on banner rows; MEDIA_PLAN §12) · a future `hosts`-style derived key source
  is one `SOURCES` row (mediaKeySources.ts) · the kit background's off|faded|full enum widening
  (additive, only if asked) · `media/kit/hosts/` adoption by more themes = per-theme fidelity
  slices · amber-gold unit palette re-adds on owner overrule only (GACHA_PLAN §7.7 G6.1 addendum
  holds its measured panel) · ROADMAP §P holds the owner-ruled-OUT ideas (QR-to-phone, picker
  disclosure) — never re-propose; sweeps skip §P.

## Read order (5 min)

1. `DECISIONS.md` — every locked choice + reasoning, the open items, and the future-additions list.
2. `ARCHITECTURE.md` — deployment profiles, `$CTRLB_HOME`, the OS-branch allowlist (layers/data/API
   live in DESIGN/SPEC).
3. `DESIGN.md` — **concrete code design**: data structures, the unified capability/registry model,
   the agent loop state machine, concurrency, persistence, the SSE wire protocol, end-to-end
   flows, edge cases, and the extension cookbook. Build against this.
4. `TODO.md` — the phased build plan (phases 0–17 largely complete; check the unchecked boxes).
5. `RESEARCH.md` — library/version pins + sources · `docs/research/` — the field-research dossiers
   (buy a finding once; read before re-commissioning a pass).
6. `ROADMAP.md` — post-v1 features + the v1 seams; §P = owner-ruled-out ideas, never re-propose.
7. `SPEC.md` — the visual one-stop system spec. The audit ledgers: `UI_AUDIT.md` (F#) ·
   `SYSTEM_AUDIT.md` (SYS-#) · `AGENT_CHAT_AUDIT.md` (ACA-#) · `PROMPTS_AUDIT.md` (PR-#) ·
   `QH_AUDIT.md` (QH-#).

Net-new UI follows `VAPOR_PATTERNS.md` (design language) + `THEME_ENGINE.md` (D31 Swappable
Surfaces routing; per-theme fidelity D7; vapor byte-frozen per D51; cosmos = the default theme).
