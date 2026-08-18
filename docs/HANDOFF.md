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

## Current state (2026-08-17)

- **Prod = v1.7.1 @ `ad581f6`**, live + healthy (https://emma.lobster-vector.ts.net) — Phase 18
  released 2026-08-16; owner eyeball ✅. **⚠ v1.7.0 is tagged but NEVER DEPLOYED — NOT a rollback
  target; rollback = v1.6.0** (schema-6 DB is back-compatible; the deeper floor stays **v1.5.1
  EXACTLY** — sw.js). Prod DB schema 6.
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
  HARDENING_PLAN §8.2. Dev units RUNNING for the owner round (dev has tier 2 ON with a copy of
  the Claude Code session corpus at `~/.ctrl-b-dev/memories/core/` — note its index sits at 99%
  of cap, so the consolidation nudge is live there).
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
- **2026-08-18: slice W5 — the PWA installed-icon backdrop (D59) — BUILT, unreleased.** Conf →
  Appearance → *App icon backdrop* (Clear · Ink · Night · Orchid · Paper) writes
  `appearance.pwa_icon_background`; the backend now serves `/manifest.webmanifest` itself and
  rewrites the maskable icon `src` from it (Chrome 144+ ignores new bytes at a known icon URL — only
  a changed URL reaches an installed app). Staying on Clear is byte-identical to today, so it
  triggers no icon update. **Owed: the owner's phone eyeball after the next release** — pick a
  backdrop, then approve "Review app update" under the installed app's ⋮ menu (or uninstall +
  re-add for the immediate path).

## ▶▶ NEXT — Phase 20 is DONE; the owner court is up

**The whole D57 ladder is built, reviewed and committed** (see the Current-state bullet). What
remains is owner-court, in the owner's order:

1. ~~Push the commit stack~~ ✅ 2026-08-17 (the fix-wave commit may sit ahead — push it too on
   the owner's word).
2. **Core Memory prod adoption — ⏸ OWNER-DEFERRED (owner, 2026-08-17): "not right now; I just
   want the system working and ready for whenever I want to delve into it."** Don't re-propose
   the drive; readiness is now a VERIFIED property owned by Phase 19 Packet ③'s core-memory
   readiness rider (a scripted end-to-end dev exercise, §14b as template). When the owner does
   delve in: enable on prod per §3b (the pre-copy `.gitignore` step first!), real vault, a
   promotion, a `consolidation` run (dev's 99%-full index = ready testbed). The **live
   `cache_n` measure** does NOT need the owner — runnable any time the local model host is up.
3. **The NOTIFICATIONS thread** — owner phone retest FIRST, zero code (still untested,
   owner-confirmed 2026-08-12): SYS-19 meant `showNotification()` never had a registered worker;
   it may just work on ≥v1.6.0. Outcome decides the parked Web Push plan (R10/R11).
4. **Phase 19 — the hardening pass — now NEXT IN LINE (Phase 20 done), still owner-gated**
   (owner, 2026-08-17). [`HARDENING_PLAN.md`](./HARDENING_PLAN.md) is spec-complete; at wake: its
   §10 owner court + the §3b delta council check; locks as **D58**.
5. **Gacha banked follow-ups** (owner-eyeball-heavy): the color-theory unit-palette research
   session · root-cross-fade flicker refinement · the R20/R21 addenda LOWs · kit minimal
   plan/player overlap (VAPOR_ASSIMILATION_PLAN §7.1) · the standing ledger below.
6. **The R28 installed-icon improvement** — ⏸ owner-gated; R28 §9 is the ready-to-build brief.
7. **Fleet-liveness decoupling from Tailscale** (owner-gated; the D47 seam) — only if the
   cold-boot wake blindness recurs.

**Owner-side standing items:** actually *edit a prompt or two* on prod (the Phase 18 feature's
first real owner-driving) · eyeball the pickers · watch the next corsair COLD-BOOT wake · the
update toast exercised ✅ 2026-08-16.

## Standing ledger (carried 2026-08-12 from the 2026-08-06 ledger; verify in the home before acting)

**Owner-court items (ask, don't assume):**
- Notifications retest = path 3 above (**still untested**, owner-confirmed 2026-08-12) · web-push
  PARKED pending the two Fennec/Firefox checks (its memory: which build + the "Site
  notifications" channel).
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
