# Handoff — start here for a fresh session

> ## ▲▲ READ FIRST — WHO YOU ARE (owner, 2026-07-28)
> **The MAIN model is FABLE on high (`claude-fable-5-1` since 2026-09-23).** It supervises: designs
> the work and the project itself, rules, and audits. **Opus (`claude-opus-5-5`, high) subagents
> carry all the heavy token work** (versions = explicit owner-tested pins, CLAUDE.md) — implementation from
> pinned briefs, research, mechanical + operational tasks including runbook releases. **Codex
> `gpt-5.6-sol` high** remains the standing co-reviewer, launched whenever review is warranted.
> *(This inverts the 2026-07-24 arrangement. The METHOD is unchanged — judgement in the main seat,
> execution in subagents — only the occupants swapped. Mechanics:
> [`second-opinion`](../.claude/skills/second-opinion/SKILL.md); rationale + the build-brief bar: the
> `orchestrate-with-opus-subagents` memory. Match the model to your tmux session at session start:
> `tmux display-message -p '#S'`, and CHECK THE EFFORT — a supervising seat at low effort is the
> failure mode.)*

## Where we are (2026-09-26 — **v1.7.8 IS LIVE IN PRODUCTION**)

- **Prod** (`~/apps/ctrl-b`, `ctrl-b-dashboard` :5433, https://emma.lobster-vector.ts.net): tag
  `v1.7.8` on `4ce70c3`, health 1.7.8, config shape **5** (migrated 2 → 5 at the cutover; only step 3
  touched prod's file), DB schema 6. **The ear is ON in prod for the first time** (`voice.live`
  absent ⇒ defaults: `route: media` · `mic_hold: auto` · `barge_in: false` · `noise_verdict_ms: 1000`
  · `debug: false`). TTS = PocketTTS `ganyu` (fallbacks Kokoro → vault-alltalk). Prod has NO
  personas and no agents dir.
- **⚠ Rollback off v1.7.8 = restore the config backup FIRST, then v1.7.7** (v1.7.7 cannot read shape 5):
  `~/.ctrl-b/config.yaml.20260926T151736Z.pre-v1.7.8` (or the migrator's
  `~/.ctrl-b/backups/config.yaml.20260926T154424Z`); DB snapshot
  `~/.ctrl-b/backups/ctrlb-20260926-174423.db.gz`. Procedure: `deploy/linux/README.md` §Rollback.
- **What v1.7.8 carries** (320 commits over v1.7.7, all council-closed): Phase 24 live voice / call
  mode (D71 + the D72–D77 waves, the D71 "mouth waits" amendment), Phase 23 characters + lorebooks
  incl. S8 the persona library (D70/D78), Phase 22 composer attachments (D68), the D75 sticky
  agent + default pill, D69 LAN wake trigger, the C3 read-along, the R86–R89 audit fixes.
- **Dev** (`~/.ctrl-b-dev`, :5434 + Vite :5173, units RUNNING): schema 5, `voice.live.debug` ON (the
  readout + the call trail in `~/.ctrl-b-dev/calls/`), Lynette = the configured default agent, Ari =
  the default persona; both imported agents carry a `card.json` sidecar (§15.8 repaired 2026-09-26). Serve `:8443`
  fronts the DEV BACKEND (built dist — `npm run build` after any FE change).
- **Owed: the PUSH + v1.7.9 release** (`3d27b09` = one commit over origin; tree clean). Prod (v1.7.8) now holds Lynette + her book + art via the §15.9 migration; the export routes reach prod WITH v1.7.9. The full session history is in
  [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md) ("the HANDOFF block of ⟨date⟩ / the Nth session" resolves there).

## ▶▶ NEXT SESSION — RELEASE v1.7.9 (the S9 wave is BUILT, council-closed, COMMITTED `3d27b09` + PUSHED; dev repaired; Lynette + the karpathy skill migrated to prod; owner: *"update in the clean session"*)

**The 46th session (2026-09-26 evening) — what happened:** Phase 23 **S9 (D79)** built by two pinned-Opus
lanes from the briefs → the owner's NEW two-reviewer rule applied for the first time (*"for critical
parts I would like both reviewers, opus as the intelligent independent reviewer, and Maia/Emma … as the
fresh lens"* — the `dual-reviewers-for-critical-code` memory): a blind **Opus 5.5** code round
(SHIP WITH FIXES, 1 MED · 7 LOW) ∥ a blind **Maya** round (SHIP WITH FIXES, 1 MED) on the SAME diff.
Opus's MED was a real design gap Maya's three earlier rounds never saw (card-origin lorebooks keep
their ST fields ONLY under `extensions` — the ST export now LIFTS them instead of dropping the map).
8 rulings folded, Opus F2 docs-only, Maya's MED overruled (an explicit `extensions.position: null` is
no provenance — both reviewers accepted); both confirms **CONFIRMED SHIP**. Gate 6/6 → **`3d27b09`**.
As-built = ROLEPLAY_PLAN **§15.12**. Then **§15.8 the dev repair APPLIED** (both sidecars 0600, `card:`
keys gone, PNGs stripped, Lynette's focal re-keyed; backups in `~/.cache/tmp/ctrlb-s9/repair-backup/`)
and **§15.9 the Lynette migration APPLIED through the APIs** (prod: agent `lynette` + `personality-traits`
+ the Mi'yu avatar/background + `Banner_Patreon_Agir.webp` as `agent.defaults.avatar`; focal rev
matches; `agent.default_agent` NOT set — the owner's one tap). The **`karpathy-guidelines` skill** went
to prod the same way (owner ask; `GET /api/skills/<name>` dev → `PUT` prod, byte-equal). Scripts kept at `~/.cache/tmp/ctrlb-s9/`.

**Steps, in order (the owner's word is GIVEN — *"push & update"*, the update in the clean session):**
1. `tmux display-message -p '#S'` → match the model; effort HIGH. `gh run list --branch main --limit 1` must
   be green on the tip (the release tip = the handoff commit; `3d27b09` is the code).
2. **v1.7.9 per `deploy/linux/README.md` §Release**: annotated tag on the verified tip → tag push (the
   pre-push gate runs again, SERIALLY) → `gh run watch … --exit-status` on the tag's release gate →
   `bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.9` → `describe --exact-match` + health 1.7.9 + the PNG
   content-type check. **No config migration** (`config_migration/VERSION` = 5 on both sides, verified;
   `lorebooks.include_names` is an additive default) → rollback = v1.7.8, no config restore. Pre-tag: the
   local `--e2e` already ran green in-session (391/391 + the new `card-export.spec.ts`).
3. **Owner test card (phone, prod after the release):** ① Conf › Agents › Lynette → footer `export` →
   **PNG card** → import that PNG into SillyTavern (expect name Lynette, description + personality split,
   the `personality-traits` book embedded — unlink first to export without) · **JSON card** downloads
   `Lynette.json` · a dirty form shows "save first". ② Conf › Roleplay › Lorebooks → `personality-traits`
   → `export` → import that JSON into ST as a world-info file (expect 40 entries, keys/positions intact).
   ③ the book row reads `used by Lynette`. ④ Deleting a test character: the confirm says the memory
   folder goes and books/art stay; the toast names what was kept. ⑤ New character → flip duties to
   Talk → the tools list seeds from `roleplay.default_tools`.
4. Dev: `voice.live.debug` still ON; the two imported agents now have `card.json` sidecars and no
   `card:` key. Dev units RUNNING at close (stop them when done poking).

## ▶▶ NEXT SESSIONS — the roadmap

### 1. The owner's PROD rounds (phone; reload the PWA and accept its update prompt first)
Nothing here needs the main seat until a verdict comes back; the trail is the diagnostic.
1. **A first prod CALL** — Media route, loudspeaker, a few turns. `debug` is OFF on prod, so no
   readout/trail; if anything misbehaves, Conf › Voice · Live › "Call debug readout" ON, call again,
   then `ls -t ~/.ctrl-b/calls | head -1` (D77).
2. **The mouth-wait card (D71 amendment №2):** ① ask something and KEEP TALKING while it thinks — the
   reply must not start over you and must not vanish; it starts once you stop, your addition lands
   as a steer/next turn. ② ask something with the TV / a next-room voice on during `thinking` — the
   reply starts within ~1 s of ready (the noise verdict; "too quiet" may show for the noise's own
   final — correct). ③ headphones, talk over an audible reply: interruption OFF still queues, ON
   still cuts. ④ mute mid-sentence, unmute, ask again — the next reply must not hang.
3. **The D75-amendment card:** the gallery cards' "default" pill is the control (tap to press /
   unpress; Conf › Agent globals › "Default agent" follows with no save bar) · `/new` with a default
   SET → the fresh thread answers as the default · with NONE set → keeps the agent you were talking
   to, and survives a PWA kill · the composer ⋯ menu lists the root row first, each specialist once.
4. **Personas on prod:** Conf › Roleplay › Personas — add one, pick it as default, link it on an
   agent ("Your persona" on the agent form), check `{{user}}` in a reply.
5. **The owed voice arms, on regular use:** the car on the CLEAN route (then `min_final_ms` 200 → 300
   if home-side noise words persist) · the TV/other-room arm · **ISS-19** (the Honor battery setting
   FIRST, then the lock-screen arm, then the discard toast).
6. **Per-agent voices** — the owner has not picked from the PocketTTS library (`ganyu` is the interim
   default everywhere; the cloned voices live in `~/.local/share/tts/voices/pocket`).

### 2. Open issues — [`ISSUES.md`](./ISSUES.md) is the ledger; the live ones
- **Owner look / ruling wanted:** ISS-12 (frontier modal-footer SAVE contrast) · ISS-10 stage ②
  (owner-parked) · ISS-19 (above).
- **Dormant, reopen on recurrence:** ISS-16 (call-mode TTS crackle — not reproduced since PocketTTS;
  the record has the reopen ladder).
- **✓ FIXED in the S9 wave (`3d27b09`, ships v1.7.9):** ISS-15 · ISS-20 · ISS-22 · ISS-23 · ISS-24 · ISS-26 · ISS-27 · ISS-29 · ISS-30.
- **Feature, not fix:** ISS-28 (ST's `{{random}}`/`{{time}}`… macros).
- Won't-fix by owner ruling (recorded, never re-propose): ISS-13 · ISS-14.

### 3. The endgame (owner rulings, standing)
- **Version policy:** stay on 1.7.x for features/polish; **1.8 is RESERVED for the final ROADMAP +
  ISSUES cleanup wave** (2026-08-24).
- **Phase 19 (the hardening pass) goes LAST** — it rides the 1.8 endgame; never lead a menu with its
  §10 owner court (2026-08-29). Spec = [`HARDENING_PLAN.md`](./HARDENING_PLAN.md), execution
  owner-gated; the FE audit backlog (F13 eslint-warn count in QUALITY.md) and CM-1 fold into it.
- **Owner-owned residuals riding regular use:** Phase 23 S7's remainder (TODO) · Core Memory's live
  drive (`CORE_MEMORY_PLAN` §14b; the feature ships OFF) · Phase 18 — the owner has not yet edited a
  prompt for real in Conf.

### 4. Unscheduled features — [`ROADMAP.md`](./ROADMAP.md) owns them (seams already designed)
The ones with owner interest or a bought design, in no order: **A1** privilege levels · **A4** slash
commands / console · **A5** agent runtime (compaction, task/plan tools) · **A12** prompt-eval harness
· **A13** Codex OAuth provider (owner ask 2026-08-19) · **B1** memory backends (the tier model, D57) ·
**C1** streaming with fallback · **C2** wake word (R14; owner: someday) · **D2/D3** wake-on-connection
+ multi-homed addressing · **F1** notification channels 2/3 (Web Push parked on its merits; ntfy/bot)
· **E1/E2** alternate frontends · **G** security hardening (known_hosts pinning, per-action tokens,
secrets at rest). **§P = owner-ruled-OUT ideas — never re-propose.** Anything new: HANDOFF → ROADMAP →
DECISIONS → DESIGN/ARCHITECTURE → TODO (CLAUDE.md's flow), a D-entry before code.

## Standing operating notes (durable gotchas — verified across sessions 30–44)
- **Method:** Fable main seat designs/rules/audits; pinned-Opus lanes build from written briefs (ONE
  lane, fix waves by `SendMessage` to the SAME lane, context intact; or two lanes on DISJOINT files
  with the API contract written into both briefs); lanes must NOT `git stash` on the shared tree.
  Every build gets a blind code round; every fix wave its own confirm. **Critical parts get BOTH
  reviewers in parallel on the SAME diff (owner, 2026-09-26): a blind Opus 5.5 subagent as the
  independent reviewer AND Maya/Emma as the non-Claude fresh lens — never partitioned; the S9 round
  proved it (Opus's MED was a design gap Maya ×3 missed).** The owner's standing reviewer
  is **Emma** (hermes `-p emma -m gpt-5.6-sol-900k --reasoning high --ignore-rules -t file,terminal
  -z …`, self-contained, ~10 min; `-z` keeps no session so `--resume` is dead); Maya (the default
  profile) is the alternate lens. When killing a hermes run, filter on `venv/bin/python` — a bare
  `pkill -f hermes` hits your own wrapper shell; a `-z` monitor loop MUST have a timeout.
- **Gates:** `backend/.venv/bin/python tools/check.py` (`--fast` = pre-commit; full = pre-push, ~4–6
  min; `--e2e` adds Playwright, ~3 min). Run the local gate, a main push and a tag push SERIALLY —
  the 6-parallel legs flake under contention. `/tmp` is RAM: heavy runs with
  `TMPDIR=/home/emma/.cache/tmp/<fresh>`; check `ls -f ~/.cache/tmp | wc -l` is small (pytest fails
  to create its numbered dirs past a few hundred k entries). Local pre-push runs NO e2e — only CI
  does; before a tag, run `--e2e` locally (Playwright `name:` is a SUBSTRING match — sweep labels).
- **Release:** `deploy/linux/README.md` §Release end-to-end (CI green on the tip → annotated tag →
  the CI release gate → `update.sh vX.Y.Z` → `describe --exact-match` + health + the PNG check).
  **Config backup FIRST whenever the release carries a migration** (`app/config_migration/VERSION`);
  dry-run on a copy with `CTRLB_HOME=<copy> python -m app.config_migration --check`. `gh run watch
  <id> --exit-status --interval 30` in a background task is the clean wait. Tags are immutable.
- **Dev:** `systemctl --user start/stop ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web` around
  iteration — never spawn duplicate servers. Serve `:8443` → the dev backend `:5434` (built dist);
  Vite `:5173` is the HMR alternative. Settings PUT is a deep-merge (partial), except the
  router-owned maps (`providers` replaced whole; `roleplay.personas` refused 422).
- **Voice-path rules (LIVE_VOICE_PLAN):** measure first (the D77 trail), never guess a feel verdict;
  the state-ownership + audio-thread-ordering rules and the tail-wait theorem are in the plan's §7
  blocks and the `live-voice-design-2026-09-11` memory.
- **Owner cadence:** afternoons = live iteration at the computer; mornings = autonomous work. A long
  build/review stretch ENDS with the handoff + an owner test card + a CLOSED session; the owner tests
  and reports in a CLEAN session.

## Standing ledger (verified 2026-09-26; ask, don't assume)

**Owner-court items:**
- The ~80 MB untracked `design/prototypes/gacha/` originals — standing "leave untracked for now";
  eventual call = leave / move out / delete.
- D2-A monitor: the owner DAILY-USE round on prod (its memory; per-host switches OFF until then).
- Cosmos "Alive/uptime" stat shows "—" (backend has no boot time; additive later — its memory).
- The vault/wiki spec stays PARKED (owner designing elsewhere; the binding requirement =
  whole-functionality enable/disable toggles).
- Notifications: channel 1 fully closed (delivery + tap routing + the `host_up_down` toggle, all
  built); web-push stays PARKED on its merits (closed-app delivery only).

**Standing KIT items (homes verified 2026-08-06):**
- `getJSON` has NO global timeout (the 5s bounded media-invalidation await works around it —
  GACHA_PLAN §7.6) · kit sr-only sheet-close duplicates the ×'s accessible name (GACHA_PLAN :964)
  · the a11y e2e sweeps TABS only — no arm opens a bottom sheet/dossier (e2e/a11y.spec.ts) ·
  `skipActiveViewTransition` is global, not per-layer (G2 standing note) · the eslint-warn backlog =
  the F13 React-Compiler-prep backlog (UI_AUDIT; deliberately deferred; the count lives ONLY in
  QUALITY.md) · SYS-16's ASYNC240 lexical blind-spot list (SYSTEM_AUDIT addendum).

**Recorded LOWs / deliberate non-fixes (all in D54 or the as-builts):**
- Conf gallery THUMBNAILS use bare URLs — stale after an in-place overwrite (surfaces use
  `?rev=`) · the scroll listener's commit→passive-flush window (worst case = one lost position =
  the old behavior) · `isolation` on `.kit` exists only while `.kit-bg` mounts · `appbarMode`
  change does NOT clear scroll positions (recorded non-decision, `fa74a8a`) · under jade,
  `--accent` and ok-green are both greens on KIT surfaces · the pre-existing `--gc-tag-ink` 4.27
  on arcade's brand fill (§7.7 records it; a G7+/owner call) · D75 ④–⑥ (the `/new`-within-one-RTT
  promotion loss · two PWA tabs don't share the sticky pick · the roster query split = ISS-20).

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
