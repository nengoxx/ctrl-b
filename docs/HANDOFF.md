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

## Where we are (2026-09-27 evening — **v1.7.9 IS LIVE IN PRODUCTION; Phase 24 S10 (the car round, D80) + wave 1.5 + ISS-31/32 are BUILT, council-closed and COMMITTED (`75e0014` · `c59157a`), NOT PUSHED — the owner's car card on dev, then push + v1.7.10**)

- **Prod** (`~/apps/ctrl-b`, `ctrl-b-dashboard` :5433, https://emma.lobster-vector.ts.net): tag
  `v1.7.9` on `9096ea4` (released 2026-09-26 22:24Z by the runbook; code = `3d27b09`, the S9 export
  wave + the polish wave), health 1.7.9, config shape **5** (unchanged — v1.7.9 carries NO migration),
  DB schema 6 (snapshot `~/.ctrl-b/backups/ctrlb-20260926-222352.db.gz`). Lynette + `personality-traits`
  + her art are on prod (§15.9); `GET /api/agents/lynette/card` and `GET /api/lorebooks/personality-traits/export`
  answer 200. **The ear is ON in prod for the first time** (`voice.live`
  absent ⇒ defaults: `route: media` · `mic_hold: auto` · `barge_in: false` · `noise_verdict_ms: 1000`
  · `debug: false`). TTS = PocketTTS `ganyu` (fallbacks Kokoro → vault-alltalk). Prod has NO
  personas and no agents dir.
- **Rollback off v1.7.9 = plain `bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.8`** (no config
  restore — both tags read shape 5). **Rolling back FURTHER, off v1.7.8, = restore the config backup
  FIRST, then v1.7.7** (v1.7.7 cannot read shape 5): `~/.ctrl-b/config.yaml.20260926T151736Z.pre-v1.7.8`
  (or the migrator's `~/.ctrl-b/backups/config.yaml.20260926T154424Z`); DB snapshot
  `~/.ctrl-b/backups/ctrlb-20260926-174423.db.gz`. Procedure: `deploy/linux/README.md` §Rollback.
- **What v1.7.9 carries** (over v1.7.8): Phase 23 **S9 export (D79)** — the SillyTavern card PNG/JSON,
  the standalone lorebook JSON, `used_by` on books — plus the polish wave (ISS-15/20/22/23/24/26/27/29/30).
- **What v1.7.8 carried** (320 commits over v1.7.7, all council-closed): Phase 24 live voice / call
  mode (D71 + the D72–D77 waves, the D71 "mouth waits" amendment), Phase 23 characters + lorebooks
  incl. S8 the persona library (D70/D78), Phase 22 composer attachments (D68), the D75 sticky
  agent + default pill, D69 LAN wake trigger, the C3 read-along, the R86–R89 audit fixes.
- **Dev** (`~/.ctrl-b-dev`, :5434 + Vite :5173, units RUNNING **on the S10 + wave 1.5 build, dist rebuilt 2026-09-27 evening**): schema 5, `voice.live.debug` ON (the
  readout + the call trail in `~/.ctrl-b-dev/calls/`), Lynette = the configured default agent, Ari =
  the default persona; both imported agents carry a `card.json` sidecar (§15.8 repaired 2026-09-26). Serve `:8443`
  fronts the DEV BACKEND (built dist — `npm run build` after any FE change).
- **OWED on the release path: THE PUSH + v1.7.10.** Workspace `main` is 4 commits AHEAD of `origin/main` (`e914329` D80 RULED · `75e0014` S10 · `c59157a` wave 1.5 · this handoff) — push in the clean session after the owner's dev car card, then §Release (no migration; rollback = `update.sh v1.7.9`). The full session history is in
  [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md) ("the HANDOFF block of ⟨date⟩ / the Nth session" resolves there).

## ▶▶ NEXT SESSION — THE OWNER'S CAR CARD on S10 (built, council-closed, NOT pushed), then push + v1.7.10

**The 49th session (2026-09-27 afternoon → evening) — what happened:** the owner answered all eight
D80 court questions in conversation → **D80 RULED** (`e914329`) → two pinned-Opus 5.5 lanes built
**Phase 24 S10** from written briefs (`~/.cache/tmp/ctrlb-session49/brief-W.md` · `brief-ISS31.md`):
W1–W7 + ISS-32 in one lane, ISS-31 in the other (disjoint files) → the two-reviewer code round (blind
Opus 5.5 ∥ Maya on the same frozen diff: 1 HIGH each · 3 MED · 4 LOW) → fix wave 1 by the building
lanes → both confirms **SHIP** → committed **`75e0014`**. Then, on the owner's directive (*"I'm
interested in fixing those issues forever"*), **wave 1.5 was built the same session** (the chirp's
measured lag SETS the tail's deadline; D80 ⑦ AMENDED) + ISS-31's fix wave 2 → a second two-reviewer
round (both SHIP WITH FIXES: `leakSeen` latched by one frame / reset by a mid-reply pause; a stale chirp
lag when Bluetooth connects mid-call) → fix wave → confirms → committed **`c59157a`**. Every brief,
review, ruling (`RULINGS.md`) and lane report is durable in `~/.cache/tmp/ctrlb-session49/`. **Gate 7/7
incl. Playwright e2e on a real build. FE 4111 (207 files) tests · BE 2825. NOTHING PUSHED.** Dev units RUNNING the
built dist (`npm run build` done) with `voice.live.debug` ON.

**What S10 ships (the car round, D80):** the ear-hold now outlives the ELEMENT — a **tail** armed on
every fall of the mouth (drain, failure, tap-kill) and released by a MEASURED DEADLINE: ① the connect
chirp (a 150 ms 1→3 kHz sweep at every capture, the call's "connected" sound) measures the sink's lag →
the mic reopens at `lag + tail_lag_margin_ms` (300) on every route (≈ 2.6 s in the car, ≈ 0.5 s on
earbuds) — whatever you say into it; ② no chirp return + the reply never leaked into the mic (≥ 350 ms
of loud frames = leaked) → the minimum (300 ms); ③ no return + it leaked → the wave-1 quiet rule
(min → 700 ms of quiet below noise+10 → cap 5 s) as the fallback; a tap-kill without a lag → the
minimum. The **text backstop** drops a post-reply final that repeats her spoken words (≥ 0.75, ≥ 10
chars) VISIBLY as "(the reply's own words)". Finals are judged on THEIR OWN segment (`item_id`); the
relay cuts sub-`silence_ms/2` flaps as empty finals (no cue, no turn); `auto` = held unless the
browser's echo cancellation is on (the probe is gone, no migration); the drop cue only on sustained
drops; the Sensitivity pin can never sit above your voice − margin nor below Auto. **ISS-31:** `/new`
mints the thread on the server (Lynette's greeting shows at once; a reload returns to it; `/new` on a
fresh thread does nothing). **ISS-32:** the ring stays put. Design of record: DECISIONS **D80** (incl.
the RULED paragraph, the BUILT paragraph and **⑦ AMENDED**), the CAR ROUND bullet + the S10 as-built in
LIVE_VOICE_PLAN §7, §4.1 (8 new knobs, all Conf rows under Voice · Live).

**⚖ Your veto window (main-seat design calls made under your directive — say so in the clean session
if any is wrong):** (a) **wave 1.5 built now**, not after a logging round (R93 M3 ordered logging first;
the fallback + the backstop + the trail bound the risk); (b) **`leakSeen`** — a per-reply, cumulative,
reply-id-keyed "did anything of this reply reach the mic" bit that lets a chirp-silent sink (earbuds)
reopen at the minimum — it is NOT the deleted probe (it never opens the ear during a reply); (c) a
**re-chirp on `devicechange`** mid-call (a beep when a device connects) — whether an A2DP-only head
unit raises that event on Android Chrome is UNVERIFIED; (d) the **D75 auto-route sentence amended**: a
`/new` thread is PINNED to the agent it opens as, so `auto_rotate` (off by default) never routes it;
(e) a genuine either/or answer that names her closing option verbatim ("save it for later") IS dropped
as her own words — visibly, so you repeat it; no cure exists in timing or text.

**Owner test card (phone; DEV first — Serve `:8443` fronts the dev backend with the built dist and
`debug` ON; then prod after the release):**
1. **The car, as usual (Media route, `auto`):** you hear the connect chirp once; talk a few turns.
   PASS = no echoed sentence ever becomes your turn; her last sentence is not repeated back. Trail
   (`ls -t ~/.ctrl-b-dev/calls | head -1`): `chirp {lagMs ≈ 2300}`; `tail {reason:"lag",
   deadlineMs ≈ 2600}` on every reply after the first (the first may read `quiet` — it drained inside
   the chirp's window); no `echo` drop right after a `lag` release (one = the margin is short).
2. **Quick answer:** answer the instant she stops — your whole answer must land (this was the
   whole-utterance loss). **Tap then talk:** tap her mid-sentence and speak at once — your first
   syllable may clip (~300 ms), the rest lands; trail `tail {reason:"lag"}` (or `kill` with no lag).
3. **Either/or probe:** get her to ask "A or B?" and answer by naming B verbatim — EXPECT the heard
   line "(the reply's own words)" and no turn; rephrase ("the second one") and it lands. That is the
   recorded residual; tell me if it bites in real use.
4. **A short reply in the car** (ask something that gets a ≤ 2 s answer): the residual case when the
   chirp was missed — trail `tail {reason:"noleak"}` followed by an `echo` drop = the backstop caught it.
5. **Earbuds/headphones:** `chirp {none:true}` is fine; quick answers must land (`tail
   {reason:"noleak"}` or `lag` with a small lag); talk OVER her with interruption off, then answer
   quickly — that one may still be held to a pause (the safe trade; report it).
6. **Bluetooth connecting mid-call:** start on the loudspeaker, then connect the car — a second chirp
   should sound; if her next reply's end echoes back as a turn, the head unit raised no
   `devicechange` (tell me; the passive onset-lag check is the recorded next step).
7. **Noise:** the cabin's short "Yeah."/"Mm." turns must be gone (`gap_cut` notes in the relay's trail
   lines; no cue beeps for them); the Sensitivity line sits at the column's top once your voice is
   learned — is the meter still readable to you as "the bar above the line"?
8. **`/new` with Lynette default:** `/new` → her greeting appears at once; kill + reopen the PWA →
   the same fresh thread; `/new` again → nothing happens; `/agent ops` then `/new` → a fresh ops thread.
9. **The ring** stays put with a focal point set on her art. **The "Call" audio route** — optional,
   one call, untried in the car (may route the head unit's own mic/AEC).
10. Optional readouts: Conf › Voice · Live › "Call debug readout" is ON on dev — the overlay's `tail`
    and `chirp` lines show the live numbers.

**Then (the clean session): PUSH `main` (3 commits: `75e0014`, `c59157a`, the handoff) → CI green →
`deploy/linux/README.md` §Release → `v1.7.10` (NO config migration — rollback = plain `update.sh
v1.7.9`; prod's `voice.live.debug` is already ON — leave it for the car round).** If the car card fails,
the trail decides the fix; the wave-1.5 knobs are all Conf rows (Voice · Live).

**Dev** (`~/.ctrl-b-dev`, :5434 + Vite :5173): units RUNNING with the built dist; stop when done
(`systemctl --user stop ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web`). **Prod** untouched at v1.7.9.

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
- **✓ FIXED in the S9 wave (`3d27b09`, LIVE in v1.7.9):** ISS-15 · ISS-20 · ISS-22 · ISS-23 · ISS-24 · ISS-26 · ISS-27 · ISS-29 · ISS-30.
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
