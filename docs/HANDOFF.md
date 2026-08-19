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

## Current state (2026-08-18)

- **Prod = v1.7.2 @ `e50d39b`**, live + healthy (https://emma.lobster-vector.ts.net) — the
  2026-08-18 polish wave released same-day (clean runbook run; CI release gate green incl. e2e;
  no config/DB migration — schema stays 6, config VERSION stays 1). **Rollback = v1.7.1**
  (`bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.1`, no config-restore step needed). **⚠ v1.7.0
  is tagged but NEVER DEPLOYED — NOT a rollback target**; the deeper floor stays **v1.5.1
  EXACTLY** — sw.js. Version stays in the 1.7 line by owner ruling (2026-08-18: "we're going to
  run out of versions before 2.0") — features do NOT force a minor bump here.
  **v1.7.2 also carries Phase 20 Core Memory to prod for the first time — still OFF by default,
  untouched posture.**
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
  HARDENING_PLAN §8.2. Dev units back to on-demand/stopped (2026-08-18); dev's tier-2 state is
  on disk — tier 2 ON with a copy of the Claude Code session corpus at
  `~/.ctrl-b-dev/memories/core/`, index at 99% of cap, so the consolidation nudge goes live
  the moment the units start.
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

## ▶▶ NEXT — the RELEASE DECISION is up (owner handoff order, 2026-08-19)

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
  **→ ✅ BUILT 2026-08-19 (uncommitted at time of writing):** `frontend/public/notify-sw.js` +
  `workbox.importScripts` with the content-hashed URL (verified in a real `vite build`: the call
  lands one line ahead of the SKIP_WAITING listener, exactly as R45 §1.2 predicted) ·
  `data:{focus,key}` on the notification · one exported `applyNotificationFocus` router shared by
  the constructor `onclick` and the SW `message` path · `store/ui#consumeTabParam` reads+strips
  `?tab=` at boot without persisting. 15 new tests (worker handler incl. the focus()-rejects
  Fennec case, the router, the SW message, the param parser, a vite-config `?v=` pin); ROADMAP §F1
  carries the close-out. **OWED: the manual device round** — Chrome Android installed PWA + Fennec
  (Fennec is *expected-partial*: Bugzilla 1880000, `focus()` won't foreground the PWA, so check
  that the agent tab is where the app lands once reached).
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
   `auto_write: true`. NEXT = the release ruling (the batch carries D60 + the qwen
   normalization + the §15d fix + the notification-tap slice).** ~~The live `cache_n`
   measure~~ ✅ run 2026-08-19 (CORE_MEMORY_PLAN §14 Measured bullet): ctrl-b's assembly holds
   D15 #4 (writes diverge only inside the index block, head byte-stable) but the local gemma
   host drops the whole cache when a write lands deeper than its 2,048-tok sliding-attention
   window — remedy = `--swa-full`/checkpoints on the llama.cpp box, routed to Phase 19 (D58).
3. **The NOTIFICATIONS thread** — ~~retest~~ ✅ PASSED 2026-08-19 (delivery works; see the
   pre-release-menu bullet). ~~What remains = the **notification-tap slice**~~ ✅ **BUILT
   2026-08-19** per R45's ruling (generateSW `importScripts`, no injectManifest) — what remains is
   the **manual device round** (Chrome Android installed PWA · Fennec, expected-partial). Web Push
   (R10/R11) stays parked.
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
- Notifications retest ✅ PASSED 2026-08-19 (path 3 above) · web-push stays PARKED on its merits
  (closed-app delivery only; the Fennec checks are moot) · the notification-tap slice ✅ BUILT
  2026-08-19, OPEN = its device round (path 3).
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
  plan-band tokens + a measured header; VAPOR_BANNER_LEDGER §7.1**)** · the 42 eslint warnings = the F13 React-Compiler-prep backlog (UI_AUDIT; deliberately
  deferred) · SYS-16's ASYNC240 lexical blind-spot list (SYSTEM_AUDIT addendum).

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
