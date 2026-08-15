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

## Current state (2026-08-12)

- **Prod = v1.6.0 @ `fcc42ad`**, live + healthy (https://emma.lobster-vector.ts.net). The
  gacha/alt-fleet arc (Phase 17: G0–G6 + M-series + E0–E5) is DONE end to end; no fix waves
  pending, no reviews open.
- **Rollback = `update.sh v1.5.1` EXACTLY** — the sw.js floor: any pre-v1.5.1 tag re-serves
  `sw.js` as `text/html` and strands the registered worker per-device (runbook §Rollback carries
  the note). Release flow = `deploy/linux/README.md` §Release; the updater has 4 clean plain-form
  runs (v1.4.0 · v1.4.1 · v1.5.1 · v1.6.0).
- Tree clean on `main`. Dev units are on-demand: `systemctl --user start
  ctrl-b-dashboard-dev{,-web}` (:5434 + Vite :5173), stop when done.
- **Session history is archived:** every session block 2026-05-28 → 2026-08-12 moved verbatim to
  [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md) (frozen, reference only — "the HANDOFF block of
  ⟨date⟩" resolves there).

## ▶▶ NEXT SESSION — PICK A PATH

In rough order of standing priority:

1. **Phase 18 — the prompt system — D56 LOCKED 2026-08-15, BUILD IN PROGRESS.** Spec =
   [`PROMPTS_PLAN.md`](./PROMPTS_PLAN.md); **§6 (council C-1..C-25) + §7 (lean round L-1..L-11) are
   the normative layer** — the council closed ALL RESOLVED, then a cuts-only round trimmed the
   design to five concepts + one seam (no new tables, no new deps; append KEPT, usage capture KEPT,
   staleness/silence-lever/eval-tables CUT or deferred — overrules recorded in §7). Slice ladder =
   plan §4: Slice 0 (vault-audit hardening M1/M2/M3 per C-11/C-12/C-14) → 1 (registry) → 2
   (API+stamping) → 3 (Conf UI); owner pause after each slice. The external harness audit lives at
   `~/Documents/Maia/60 Audits/2026-08-14-ctrl-b-runtime-agent-harness-audit.md` (pinned `e1b10c3`);
   L1/L2 measurement-gated.
2. **The NOTIFICATIONS thread** — owner phone retest FIRST, zero code (**still untested as of
   2026-08-12, owner-confirmed**): SYS-19 meant `showNotification()` had never had a registered
   worker when it "failed"; it may just work on v1.6.0. Outcome decides whether the parked Web
   Push plan (the `web-push-researched-parked` memory, R10/R11) is re-premised or unblocked.
3. **Gacha banked follow-ups** (owner-eyeball-heavy): the color-theory unit-palette research
   session (owner-flagged) · root-cross-fade flicker refinement · the R20/R21 addenda LOWs (four
   each — GACHA_PLAN §7 as-builts, lines ~2317/2339) · kit-wide minimal plan/player overlap
   (VAPOR_ASSIMILATION_PLAN §7.1) · the rest of the standing ledger below.
4. **The R28 installed-icon improvement** — ⏸ owner-gated pickup; R28 §9 is the ready-to-build
   brief.
5. **Fleet-liveness decoupling from Tailscale** *(owner-gated)*: host `online` today = "its
   Tailscale is up" (bare-name `ip:` resolves via MagicDNS — the 2026-08-12 corsair
   investigation, `corsair-liveness-rides-tailscale` memory). Option: DHCP-reserved LAN IP in
   `ip:` + tailnet name in `vpn_host:` (the D47 seam, zero code) — or a dual-probe design if the
   owner wants both vantages. Only if the cold-boot wake blindness recurs; the owner is watching
   it first.

**Owner-side standing items:** the update toast's first real exercise arrives at the NEXT release
(v1.6.0 landed on the phone 2026-08-12). Still owed whenever convenient: eyeball the pickers on
prod · watch the next corsair COLD-BOOT wake (shutdown → WOL) — if the tailnet join fails again,
path 6 (or Tailscale unattended mode) is the fix.

## Standing ledger (carried 2026-08-12 from the 2026-08-06 ledger; verify in the home before acting)

**Owner-court items (ask, don't assume):**
- Notifications retest = path 2 above (**still untested**, owner-confirmed 2026-08-12) · web-push
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
