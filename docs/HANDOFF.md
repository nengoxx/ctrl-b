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
- **Phase 20 Core Memory: DESIGN LOCKED as D57; S0 + S1 COMPLETE 2026-08-17.** Spec of record =
  [`CORE_MEMORY_PLAN.md`](./CORE_MEMORY_PLAN.md) (all rulings §2a/§2b · the §4b promotion design ·
  §13 council record — Codex + adversarial Opus, both BUILD WITH CHANGES, folded, confirm clean).
  Evidence: R37/R38 + **R39** (cap-triggered promotion field pass) + **R40** (the owner's personal
  agent's complete Claude Code memory source spec + crosswalk — corroborates the mechanism).
  D57 in DECISIONS.md; ROADMAP §B1 rewritten to the tier model; TODO Phase 20 stanza added;
  **the parked hardening charter renumbered to D58.**
- Tree: `main` **~11 commits ahead of origin, not pushed** (the 5 Phase-19 spec commits + the
  Core Memory stack `69847f9` · `0a904ac` · `4c5de73` · `ccf5c82` · `3d16310` + the S0 lock
  commit) — push needs owner confirmation. **`docs/research/R40-…md` has uncommitted working-tree
  edits from the owner's personal agent — leave them; that agent commits its own work.** Dev units
  stopped (on-demand: `systemctl --user start ctrl-b-dashboard-dev{,-web}`, :5434 + Vite :5173).
- Session history: [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md) (frozen, 2026-05 → 2026-08).

## ▶▶ NEXT SESSION — Phase 20 S2 (⏸ owner go-ahead pending)

**S1 ✅ BUILT + REVIEWED + COMMITTED 2026-08-17 (`6b16545`)** — corpus module read-only, 26 tests,
full gate green; Codex round (SHIP WITH FIXES, 4 MED/5 LOW) + confirm round both folded; per-slice
as-built note in the plan's §11 S1 entry. **⏸ Owner pause — S2 (head injection: the lifespan
singleton, `core_memory=` kwarg at both construction sites, the static-head block,
`core_memory_policy`, byte-identical-when-off) starts on go-ahead**, per the §11 ladder. The usual
workflow: Opus subagents implement from pinned briefs; Codex reviews the slice; main seat
reconciles.

**After S1 (standing order):**

1. **S2–S5** per the ladder, paused per slice.
2. **The NOTIFICATIONS thread** — owner phone retest FIRST, zero code (still untested,
   owner-confirmed 2026-08-12): SYS-19 meant `showNotification()` never had a registered worker;
   it may just work on ≥v1.6.0. Outcome decides the parked Web Push plan (R10/R11).
3. **Phase 19 — the hardening pass — PARKED, owner-gated, deliberately BEHIND Phase 20** (owner,
   2026-08-17). [`HARDENING_PLAN.md`](./HARDENING_PLAN.md) is spec-complete; at wake: its §10
   owner court + the §3b delta council check; locks as **D58**.
4. **Gacha banked follow-ups** (owner-eyeball-heavy): the color-theory unit-palette research
   session · root-cross-fade flicker refinement · the R20/R21 addenda LOWs · kit minimal
   plan/player overlap (VAPOR_ASSIMILATION_PLAN §7.1) · the standing ledger below.
5. **The R28 installed-icon improvement** — ⏸ owner-gated; R28 §9 is the ready-to-build brief.
6. **Fleet-liveness decoupling from Tailscale** (owner-gated; the D47 seam) — only if the
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
  `skipActiveViewTransition` is global, not per-layer (G2 standing note) · kit-wide `appbarMode:
  minimal` pinned-plan header × mini-player OVERLAP (VAPOR_ASSIMILATION_PLAN §7.1, pre-existing)
  · the 42 eslint warnings = the F13 React-Compiler-prep backlog (UI_AUDIT; deliberately
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
