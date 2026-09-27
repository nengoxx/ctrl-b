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

## Where we are (2026-09-27 night — **PROD = v1.7.9 UNTIL THE SESSION-50 RELEASE LANE LANDS v1.7.10 (verify below). The owner's vault backlog (8 items) is BUILT on top of Phase 24 S10 (the car round, `75e0014` · `c59157a`); BUG-001 · LIVE-001 · RP-001 · STYLE-001 · COMPOSER-001 + D81's backend two-reviewer-closed, D81's frontend (CHAT-001/002/003) two-reviewer round CLOSED too; all five lanes committed. The owner's prod card is next**)

- **Prod** (`~/apps/ctrl-b`, `ctrl-b-dashboard` :5433, https://emma.lobster-vector.ts.net): at writing time
  tag `v1.7.9` on `9096ea4` (released 2026-09-26 22:24Z; code = `3d27b09`), config shape **5**, DB schema 6.
  **The release lane is running/next** (the owner authorized push + v1.7.10 in this session, ≈ 21:30):
  push `main` → CI green → `deploy/linux/README.md` §Release → `v1.7.10`. **Verify, don't assume:**
  `git -C ~/apps/ctrl-b describe --tags --exact-match` + `curl -s localhost:5433/api/health` (version).
  Prod's `voice.live` block (secret-free keys) = `{dictation: true, mic_hold: on, debug: true}` — the
  owner's own flips; every other knob defaults. So **Live dictation is ON** and every call AND every
  dictation writes a trail to `~/.ctrl-b/calls/`. TTS = PocketTTS `ganyu` (fallbacks Kokoro →
  vault-alltalk). Lynette + `personality-traits` + her art are on prod; no personas, no agents dir.
- **What v1.7.10 carries** (over v1.7.9): the 49th session's **Phase 24 S10** (the car round, D80) + wave
  1.5 + ISS-31/32, and session 50's vault backlog: **S11** dictation head/tail (BUG-001) · **LIVE-001**
  tap-to-stop (D71 amendment №3) · **RP-001** greeting switch · **STYLE-001** italics tint ·
  **COMPOSER-001** · **D81** chat message actions (Phase 25). **DB schema 6 → 7 (migration 7,
  additive) · NO config migration.**
- **Rollback off v1.7.10 = plain `bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.9`** (safe by tag: older
  builds ignore the new `message_alternates` table; no config restore). Off v1.7.9 = `update.sh v1.7.8`
  (same shape 5). **Further, off v1.7.8, = restore the config backup FIRST, then v1.7.7**
  (`~/.ctrl-b/config.yaml.20260926T151736Z.pre-v1.7.8`; DB snapshot `~/.ctrl-b/backups/ctrlb-20260926-174423.db.gz`).
  Procedure: `deploy/linux/README.md` §Rollback.
- **The Speaches fork** (`~/github/speaches` @ **`fd4b956`** — honours `prefix_padding_ms` as a slice-start
  pre-roll) is **DEPLOYED** (the `speaches.service` user unit restarted 2026-09-27; `systemctl --user status
  speaches`). Harmless to v1.7.9 (its relay sends 0); v1.7.10's relay sends `prefix_padding_ms: 300`.
  An ear that echoes a different value makes the relay log ONE WARNING per session naming the fork.
- **Earlier releases:** v1.7.9 = Phase 23 S9 export (D79) + the ISS polish wave · v1.7.8 = Phase 24 live
  voice, Phase 23 characters + lorebooks + personas, Phase 22 attachments, D69/D75 (details in
  [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md), the 44th–47th blocks).
- **Dev** (`~/.ctrl-b-dev`, :5434 + Vite :5173, units RUNNING — **the owner: keep them up**): schema 5
  config; the dist is rebuilt + the units restarted by the session-50 commit lane. ⚠ Dev's
  `voice.live.debug` currently reads **OFF** in `~/.ctrl-b-dev/config.yaml` (the 49th block said ON) —
  flip "Call debug readout" in Conf › Live call if you test on dev. Lynette = the default agent, Ari =
  the default persona. Serve `:8443` fronts the DEV BACKEND (built dist).
- **Workspace `main`:** at session start 8 commits ahead of `origin/main` (`a517da9` · `d231f00` ·
  `e914329` · `75e0014` · `c59157a` · `cdf7262` · `69b8cc7` · `18dd75f`), plus session 50's commits from
  the commit lane (V1 `b4eb035` · V2 `f739c3a` · C `a2f8cc5` · D81 `a0d8e8c` · the QUALITY counts + this
  handoff — `git log`). The release lane
  pushes them all. Session history: [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md) ("the Nth session"
  resolves there).

## ▶▶ NEXT SESSION — THE OWNER'S PROD CARD on v1.7.10 (the vault backlog), then the deferred S10 car card

**The 50th session (2026-09-27 evening → night) — what happened:** the owner pointed the main seat at
the vault bug/idea inbox (`~/Documents/Maia/40 Projects/2026-08-04-ctrl-b-dashboard-backlog.md` — dictated
by voice and captured by another agent, so read as HINTS of intent, not spec) and asked for the lot
before the car card. **Eight items** (UI-001 was already solved in source): BUG-001 · LIVE-001 · RP-001
· STYLE-001 · COMPOSER-001 · CHAT-001/002/003 (one design, D81). Three read-only Opus 5.5 audits
(voice · chat · small) → the main seat's rulings (`RULINGS.md`) → **five pinned-Opus 5.5 lanes on
disjoint files** (V1 dictation · V2 call stop · C the three smalls · B-BE / B-FE the D81 halves, wire
contract `wire-D81.md`) → every lane through the **two-reviewer blind round** (Opus 5.5 ∥ Maya on the
same frozen diff) → fix waves by the building lanes → confirms. Fable ran at 93–97 % usage, so the whole
session was run from a written runbook (`SESSION_PLAN.md` + `RULINGS.md`) an Opus 5.5 main seat could
continue verbatim. Status: **V1 · V2 · C · B-BE CONFIRMED SHIP; B-FE built, two-reviewer round CLOSED (Opus + Maya confirms; Maya's two nits folded into wave 2, Opus CONFIRMED SHIP)**
(both lenses converged on two store-only findings — a ghost copy of the owner's bubble after an accepted
send whose end-of-turn read was missed, and a stale client error bubble kept past a good retry; two fix
waves + confirms closed it before the D81 commit). Then the commit lane (four scoped feature commits +
QUALITY counts + this handoff) → the release lane (push → v1.7.10). **The car card is DEFERRED to the
next session** (owner, ≈ 21:30: usage reset; test on PROD, the daily surface).

**What was built:**
- **BUG-001 → Phase 24 S11, the dictation head + tail.** The owner's "first words of many sentences and
  the last word cut off in the car" was **NOT Bluetooth latency**: dictation never records through the
  car's mic (the D74 steer opens the phone's own) and has no output leg, so no D80 number carries over.
  Four independent losses, root-caused at source: **H1** the "go" buzz fired before the mic existed
  (fix: a new `useDictation().onLive` seam — the buzz fires when the words-carrying path is live) ·
  **H2** the streaming uplink started after the worklet installed and the clip holding the head was
  discarded (same fix — GO waits for the uplink's first frame) · **H3** the ear sliced every VAD segment
  from Silero's 0.6 crossing with ZERO pre-roll — the dominant "many sentences" loss, shared by calls
  (fix: the owned Speaches fork `fd4b956` honours `prefix_padding_ms`, slice START only, end timing
  unmoved; relay knob `LiveCfg.prefix_padding_ms` 300, Conf › Live call › "Speech pre-roll (ms)"; the
  D80 ④ gap cut judges the span NET of the pre-roll the ear ECHOES) · **T1** no post-roll on a user
  stop (fix: `LiveCfg.release_tail_ms` 400, Conf › Voice · STT › "Release tail (ms)"; user stops only).
  Plus: the dictation leg gets the D77 trail (debug-gated) and `start` carries `mode: "dictation"`, so
  the relay never gap-cuts a dictation leg. As-built: LIVE_VOICE_PLAN §7 "S11" + §4.1 rows; D80's S11
  sentence.
- **LIVE-001 → tap = STOP during `thinking` (D71 amendment №3).** One control, the existing whole-surface
  tap: speaking → kill (as before); **thinking → cancels the turn** (discarded; label "Thinking — tap to
  stop"; 20 ms buzz); listening/connecting → inert. Voice barge stays speaking-only; mute/hang-up
  untouched; the mic is never held by a stop. The stop is TURN-scoped (`audioController.dismissTurn()` +
  `useAutoTts`'s abandoned latch), fires on `click`, and a tap-away that closes a deck popover is
  swallowed once. As-built: LIVE_VOICE_PLAN §4.3 + §7 "LIVE-001"; DECISIONS D71 amendment №3.
- **RP-001 → `AgentDef.greeting_enabled`** (default on): the agent form's "Use greeting" switch under
  Greeting (roleplay visibility). Off ⇒ new threads start EMPTY and the model never sees it; the text is
  kept and still exported as `first_mes`; old threads keep their greeting row; per-agent, never inherited
  from the root. As-built: ROLEPLAY_PLAN §3.1/§4.2.
- **STYLE-001 → bot-bubble italics tinted** `color-mix(in oklch, var(--accent) var(--kit-em-tint, 40%),
  currentColor)` — one kit rule, a per-theme dial (THEME_ENGINE §14.4.1); the e2e contrast matrix now
  probes it (floor 4.5:1; worst = frontier light/amber 4.88:1).
- **COMPOSER-001 →** the composer textarea's scrollbar hidden (scrolling unchanged).
- **CHAT-001/002/003 → D81 chat message actions (Phase 25, migration 7).** `messages` stays the active
  transcript; displaced replies MOVE to a new `message_alternates` stash. **Retry** any tail reply,
  keeping old takes as `‹ n/N ›` on the who-line (`›` at N/N writes a new take); **delete** by unit (one
  confirm, no undo); **edit** (pencil on your line, "edit" in the bot disclosure) — no regenerate.
  Actions live in the bot who-line's tap disclosure (retry · edit · delete); your line's pencil opens the
  edit sheet, which carries "Delete message". A regenerate speaks as the agent that gave the displaced
  reply; retrying a reply that ran a non-retry-safe tool asks first (I4). Design of record: DECISIONS
  D81 + DESIGN §4/§8/§12; greeting swipes = a recorded seam, not built.

**Facts you must know:**
- **Live dictation is ON in prod** (`voice.live.dictation: true`, set by you) — you believed it off. Every
  hold/lock/tap recording streams through the ear. The switch: Conf › Voice · STT › "Live dictation".
- **The edit cap** = 10,485,760 characters (the upload ceiling, `attachments.max_file_mb` × 1 MiB) — a
  sanity bound, not a real limit; no send-path limit exists, so no new number was invented.
- **The F20 duplicate-row defect is fixed:** retry on an error bubble now regenerates (no second copy of
  your message after a reload). One corner remains: a stream cut before the server's first frame, whose
  turn stored your message but no reply, puts your text back in the composer — re-sending it duplicates
  (the old behavior, now only there).
- **Deleting YOUR message deletes exactly that row** (SillyTavern parity): its reply stays and FOLDS into
  the previous turn's current take — a later swap / tail delete / retry moves them together.
- **The every-turn GET:** the chat re-reads the thread once at the end of every turn (to learn which
  reply is retryable). One extra GET per turn; if chat feels slower on the Honor 20, say so (the remedy =
  an identity-preserving merge in the reload).
- A stop in `thinking` discards anything you said into that turn (you re-say it); a tap within ~100 ms of
  sending cancels nothing (the server has not registered the turn yet) — recorded residuals.

**OWNER TEST CARD (prod, phone — reload the PWA and accept its update prompt; health shows 1.7.10):**
1. **Dictation in the car** (Media route, as you use it): dictate a few 3-sentence passages with pauses;
   start talking AT the buzz (it now comes a beat later — when the mic is really live). PASS = the first
   words of EVERY sentence and the last word land. **Only if it still clips**, run three recordings per
   arm: **A** Live dictation ON, normal · **B** Live dictation OFF · **C** ON, wait a beat after the buzz
   and hold a beat past the last word. B clean where A clips ⇒ the ear's slice (raise "Speech pre-roll")
   · C fixes the last word ⇒ raise "Release tail" (400 → 700) · C fixes the first words ⇒ the go-signal.
   Trail (debug is ON in prod): `ls -t ~/.ctrl-b/calls | head -1` — `rec` · `uplink` · `go` ·
   `release {settle, tail_ms}` · `end` from the client, and the relay's `pre_roll {configured: 300,
   effective: 300}` (effective 0 = the fork is not answering).
2. **The call — tap while she THINKS:** ask something, tap the surface during "Thinking — tap to stop" →
   the turn cancels, a short buzz, the call stays up and the mic stays open (say something new — it
   lands). Tap while she SPEAKS → the speech stops (now on release of the tap). Open the route or
   Sensitivity popover during thinking, tap AWAY to close it → the turn must NOT cancel; the next tap
   does.
3. **Retry + alternates:** open a reply's who-line → `retry` → a new take shows `2/2` → `‹` → `1/2` →
   `›` back. **Delete a reply** (one confirm) — at `2/2` the other take comes back. **Edit yours** (the
   pencil left of "You") and **edit hers** (who-line → edit): the text changes, " · edited" / "edited by
   you" shows, nothing regenerates. The who-line disclosure opens on EVERY bot bubble.
4. **Greeting switch:** a roleplay agent → agent form → "Use greeting" OFF → `/new` starts EMPTY; ON
   again → the greeting returns on the next `/new`.
5. **Italics tint** by eye on the 5 themes (light + dark): tinted, subtle, readable. The kit default is
   40 %; say "stronger/weaker" per theme if wanted (`--kit-em-tint`).
6. **Composer:** a multi-line draft past the ceiling scrolls with NO scrollbar (all three layouts).

**Still owed — the DEFERRED S10 car card** (the 49th session's, verbatim; it was written for DEV — on
prod read `~/.ctrl-b/calls` for the trail dir and Conf › Live call › "Call debug readout", already ON;
prod's `mic_hold` is `on` (your flip), not `auto` — item 1's "`auto`" means whatever you run):
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

**The release facts (v1.7.10):** carries S10 + wave 1.5 + ISS-31/32 + session 50's six builds · **DB
schema 6 → 7** (migration 7 = the `message_alternates` table + two indexes, additive) — **rollback by tag
is safe: `update.sh v1.7.9`** · **NO config migration** (shape stays 5; the new knobs `release_tail_ms` /
`prefix_padding_ms` default in) · the Speaches fork `fd4b956` is ALREADY live (nothing to deploy for it)
· **prod `voice.live.debug` stays ON** (for the car card and the dictation trail). Pre-tag standing move:
`check.py --e2e` locally (the contrast matrix and the new `chat-alternates.spec.ts` ride it).

**⚖ Your veto window (main-seat calls made under your directive — say so in the clean session if any is
wrong):** (a) **③ the ear pre-roll built NOW, ungated** — the audit wanted your A/B/C car experiment
first; ruled: honouring `prefix_padding_ms` is the reference (OpenAI server_vad 300 ms) behavior, the
fork ignoring it was a defect, you cannot cheaply run a three-arm experiment, and it is bounded (≤ 300 ms
more audio per segment; 0 in Conf restores the old slice) · (b) **the edit cap** = the upload ceiling
(see above) rather than a new number · (c) **the call's stop fires on `click`, not `pointerdown`** — a
back-swipe's pointerdown would have cancelled a thinking turn; cost: the speaking kill lands on the
tap's release, one tap-length later · (d) **the stop is TURN-scoped** (a counter + the read-along's
abandoned latch), not keyed to a message id — a renamed placeholder or a second-round reply after a tool
cannot speak the stopped partial; the composer Stop still speaks its partial · (e) **D81 = a stash table
beside `messages`**, not a message tree nor variants-on-the-row — zero changes to the 20+ readers,
rollback-safe; the trade is no branching conversation tree · (f) **the greeting
switch is per-agent, never inherited** from the root's `agent.defaults` (a card import stays ON). A
pre-existing class is recorded, not fixed: the root's greeting TEXT still reaches never-saved
specialists — is a root greeting even meaningful? (owner court, no rush).

**Durable session record:** every audit, brief, ruling, frozen diff, review, confirm and lane report is in
**`~/.cache/tmp/ctrlb-session50/`** (`SESSION_PLAN.md` = the runbook + lane table; `RULINGS.md` = every
ruling with its reason; `wire-D81.md` = the D81 wire as built). The B-FE round's findings were ALL
ACCEPTED into its fix wave (`RULINGS.md` "Lane B-FE review round №1"): the two converging MEDs plus
Opus's LOWs — non-409 regenerate refusals surface as errors · retry/`›` hidden while an unsent bubble
follows the reply · an in-flight synth cannot re-cache pre-edit audio · a gap between `›` and ▶ at
390 px · a failed edit keeps your typed text · re-attached turns also re-read the floor · the delete
wording · an accessible name on `n/N` · the new 11 px buttons join the e2e contrast matrix.

**Dev** (`~/.ctrl-b-dev`, :5434 + Vite :5173): units RUNNING (the owner: keep them up). **Prod**: v1.7.10
once the release lane is green — verify with `git -C ~/apps/ctrl-b describe --tags --exact-match`.

## ▶▶ NEXT SESSIONS — the roadmap

### 1. The owner's PROD rounds (phone; reload the PWA and accept its update prompt first)
Nothing here needs the main seat until a verdict comes back; the trail is the diagnostic.
1. **A first prod CALL** — Media route, loudspeaker, a few turns. `debug` is ON on prod (the owner's
   flip; Conf › Live call › "Call debug readout"), so the readout + the trail are live:
   `ls -t ~/.ctrl-b/calls | head -1` (D77).
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

## Standing operating notes (durable gotchas — verified across sessions 30–50)
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
  `pkill -f hermes` hits your own wrapper shell; a `-z` monitor loop MUST have a timeout. **Killing a
  hermes python from the Bash tool has propagated exit 144 to the tool shell (twice, session 50)** — kill
  in a separate command with nothing after it, or leave the run and discard its output.
- **Freezing a diff for review: build the file list EXPLICITLY and `wc -l` it before launching the
  reviewers** — an empty `$(cat list)` makes `git diff --` dump the WHOLE tree (burned on B-FE, session
  50; a bad path map burned V1). Append new files with `git diff --no-index /dev/null <file>`; the
  building lane's report lists EVERY changed file and the freeze is taken from that list.
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
