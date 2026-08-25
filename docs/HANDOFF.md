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

## Current state (2026-08-25 — THE MEDIA-MANAGER BUILD SESSION: S0→S5 ALL BUILT + REVIEW-CLOSED; supersedes everything below where it speaks)

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

## ▶▶ NEXT (session-close 2026-08-25): the OWNER ROUND IS LIVE on dev — the next session TRIAGES it

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
they'll ask) · color-theory palette session · gacha originals stay untracked · ISS-10 ② glyph
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
