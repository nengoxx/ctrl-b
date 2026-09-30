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

## Where we are (2026-09-30 — **PROD = v1.7.10 LIVE @ `9c5a6c6` (unchanged). Session 52 (Fable) BUILT, two-reviewer-closed and COMMITTED the five session-51 polish items, plus the R94/R95 docs. They are on `main` UNPUSHED; push on the owner's word. v1.7.11 is HELD until the ASR/VAD work (R94 + R95, sessions A then B) lands too (owner ruling)**)

- **Prod** (`~/apps/ctrl-b`, `ctrl-b-dashboard` :5433, https://emma.lobster-vector.ts.net): at writing time
  tag **`v1.7.10` on `9c5a6c6` — LIVE** (released 2026-09-27 evening ≈ 18:14Z per `deploy/linux/README.md`
  §Release; main CI run `36338504068` green, release-gate run `36339122301` green; `update.sh v1.7.10` exit 0).
  Health **1.7.10**, DB schema **7** (install snapshot `~/.ctrl-b/backups/ctrlb-20260927-201410.db.gz`; manual
  pre-release snapshot `ctrlb-manual-pre-v1.7.10-20260927T181348Z.db.gz`), config shape **5** unchanged (no
  migration). Speaches fork `fd4b956` live. **Verify, don't assume:**
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
  flip "Call debug readout" in Conf › Live call if you test on dev (owner-court ③ below). Lynette = the default agent, Ari =
  the default persona. Serve `:8443` fronts the DEV BACKEND (built dist).
- **Workspace `main`:** at session start 8 commits ahead of `origin/main` (`a517da9` · `d231f00` ·
  `e914329` · `75e0014` · `c59157a` · `cdf7262` · `69b8cc7` · `18dd75f`), plus session 50's commits from
  the commit lane (V1 `b4eb035` · V2 `f739c3a` · C `a2f8cc5` · D81 `a0d8e8c` · the QUALITY counts + this
  handoff `9c5a6c6`), then docs-only commits (`5ad81f1` + the session-50 doc-truth close — `git log`). **All
  pushed** at session 50's close, and tag `v1.7.10` = `9c5a6c6`. **Session 52 added 7 UNPUSHED commits on top of
  `origin/main` `778b960`:** `53f8010` · `7522040` · `c09d47b` · `31953a9` · `23fd88a` · `c1c8bad`, plus this
  handoff. Push on the owner's word. Session history: [`HANDOFF_ARCHIVE.md`](./HANDOFF_ARCHIVE.md) ("the Nth session"
  resolves there).

## ▶▶ NEXT SESSION = DESIGN + DISCUSSION ONLY (owner ruling 2026-09-30): the agenda — nothing is built until it is walked

The owner: *"next session is going to be more like design and discussion about the approaches and what's left to do."*
Open the session by walking this list with the owner, recording each answer in DECISIONS/RULINGS, THEN brief build
lanes in a fresh session. Every item carries the main seat's default so the walk is fast.

**A. Polish leftovers (session 52; recorded, not built)**
1. The renderer's per-line `em` rule (`lib/markdown.tsx` `INLINE`) is a second spelling of the pairing rule WITHOUT
   the boundary guard, so a glued `Hello*She walks*` italicizes on screen but is spoken. Default: fold into the
   next markdown touch (pass the previous char to the em rule); not a separate slice.
2. An unbackticked `*.tmp` in prose italicizes (eye) / drops (ear) to the END of a settled reply — D74's accepted
   class, now visible. Default: keep; option = require the opener to be followed by a letter/digit/quote in
   BOTH halves (one regex edit in `actionSpan.ts`). Owner's call: has this ever bitten in real use?
3. CJK one-word rule (no spaces ⇒ a whole-sentence action is spoken). Default: accept, the owner writes in
   English/Spanish.
4. Player residuals: a pause tapped in the one task between a seam's `play()` and its event re-arms intent
   (face "pause" while paused until the next tap); `parked` stays set after a hardware replay. Default: accept.
5. Gacha: the phone eyeball is the verification (DPR doubt above). The spec's desktop project still opens a blank
   page before skipping (cosmetic). Default: accept both.
6. Eye/ear divergence across a fenced block (the eye splits at fences, the ear strips them first). Default: accept.
7. PUSH the 7 commits (owner's word) and CONFIRM the release shape: v1.7.11 = polish + ASR session A together
   (rollback v1.7.10; P1/P2 add `LiveCfg` keys → additive, likely NO config migration — verify) — or polish first?

**B. ASR session A — transport + the dictation rulings (R94 §7.1, §11; no VAD change)**
1. D1 guard violation: close with 1008 (default) vs throttle; `uplink_burst_ms` default (~10 s ≥ K4's window).
2. P1 idle stop: 5 min, `0 = off`, OWN quiet threshold — which scale? Default: the same relative-dB model the
   Sensitivity meter uses (D76), surfaced as its own Conf row under Voice/Dictation.
3. P2 cap 30 min: raise the relay `max_session_s` headroom above it; Speaches' own 30-min hard kill binds until
   S10 (S8 makes it survivable). Default: cap 1800, relay 2100.
4. P3 foreground-only + wake lock: reuse the call's `takeWakeLock` (`useLiveCall.ts`), extracted, not copied.
   Default: yes if the extraction is a pure lift.
5. D7 drop the Kokoro-on-Speaches TTS fallback: an explicit ops step on prod (config edit + backup), not silent.
   Does the `voice.tts` chain need ANY second fallback? Default: no (PocketTTS stable), document the rollback.
6. D8 early-call floor seeded from the remembered per-device level, provisional only, measured floor takes over
   in either direction. Default: build it in session A (it is a level-gate change, not a VAD change).
7. S4 ops while Speaches remains: `STT_MODEL_TTL=-1` (ends reload spikes), review the `0.0.0.0:9000` bind +
   unauthenticated UI against SECURITY_MODEL, `LOG_LEVEL=info`. Default: all three, now.
8. K4 keepalive stays 5/5 (default). K5 slot takeover by client identity (D5): its own small slice, default
   session A's tail. K6 16 kHz capture (R95 Q3): promote to right after S3 — but it needs the owner's phone
   field check (AEC/NS at 16 kHz, the chirp under 8 kHz, the barge calibration). Default: promote, gated on
   that check.
9. S1 telemetry field list (R94 §7.1.7) + R95's extra field: count call-pacer drops per leg and their distance to
   the next `speech_started`. D9 the client `waitingFinal` id-set as defense in depth. Default: both in.
10. The four stress-test questions (R94 §11.1 end): tentative-start vs held boundary/barge; token bucket vs K4
    window; sample-exact suffix recovery under pacer drops; per-door serialization vs live latency. The main
    seat answers these in the design session before briefing.

**C. ASR session B — the VAD + the host (leaving Speaches; R94 §7.2–§7.6, R95 §10)**
1. D3 FORMAL: relay-owned stateful Silero (C1), placement-agnostic shape (pure policy + golden vectors, leg-sample
   bounds, segmenter interface); dependency = raw `onnxruntime` + `numpy` (~110 MB, cp314 verified) for
   per-window probabilities vs `sherpa-onnx` (44 MB, bool only). Default: C1 + raw onnxruntime. Owner accepted
   server-side on 2026-09-30; wants Speaches GONE.
2. D2 onset emission: tentative start (ii, client unchanged) vs confirmed start + client accrual (i). Default (ii).
3. D10 keep the pre-ASR no-speech pass (parity with Speaches' hidden ~21% empties). Default: keep.
4. D4 clip-door decoding for a WAV-only host: decode in ctrl-b (PyAV/ffmpeg — verify cp314) vs phone-side WAV vs
   the onnx-asr sidecar. Default: decode in ctrl-b inside the pre-ASR pass.
5. The ASR host: parakeet-server (CPU f16, MIT, one instance PER DOOR because it serializes) as primary; the
   onnx-asr sidecar (today's exact model) as the parity reference/fallback; CrispASR NOT primary but allowed as
   a configured engine; every engine speaks the OpenAI transcription door → engines/models = config through the
   existing provider registry (D48) — verify the `voice.stt` chain shape carries a per-door endpoint. Owner
   wants both parakeet.cpp and a second engine possible.
6. Speaches retirement: TTS fallback #1 goes (B5), `vault-speaches` (the whisper fallback) unaffected, the
   deployed speaches fork (`~/github/speaches`, fd4b956) retired with it — unit stop + removal step in the runbook.
7. Shadow mode (S6) + replay harness + corpus: WHICH recordings (car, home, both languages), stored OUTSIDE git
   (the L2 class), consent = the owner's own voice only. Default: a `~/.local/share/ctrl-b/asr-corpus/` dir.
8. S6b phone probe (R95): run it at all? It needs ort-web wasm served + precached (vite ceiling 2 MiB, the
   woff2 CacheFirst pattern). Main-seat lean: DEFER until after S7 — the decision no longer hinges on it.
9. Where the record lives: a new `docs/ASR_PLAN.md` (Phase 25?) vs amendments to LIVE_VOICE_PLAN — the doc-map
   flow (HANDOFF → ROADMAP → DECISIONS → DESIGN → TODO). Default: a new plan doc + one D-entry (S5) + TODO phase.
10. Cadence: one release per session (A → v1.7.11, B → v1.7.12), pause after each slice for the owner's car and
    phone rounds between shadow and flip. Config migrations expected: possibly one in B (VAD/ASR keys).

**D. Housekeeping**
- `docs/research/R94-evidence/L2-trail-forensics.md` stays UNTRACKED: add it to `.git/info/exclude` (local, not
  the tracked `.gitignore`) so no lane can stage it by accident. Default: do it at the start of next session.
- Dev units STOPPED at session close (start them again only when there is something to poke).

## ▶▶ NEW (2026-09-30, Fable seat, session 52) — THE FIVE POLISH ITEMS BUILT + TWO-REVIEWER-CLOSED + COMMITTED; NOT RELEASED

The session-51 owner polish audit (`~/.cache/tmp/ctrlb-session51/audit-owner-polish-2026-09-29.md`; the owner
ruled every recommended default on 09-30) was built by three Opus lanes: A = chat eye (#1 + #2), B = voice
(#3 + #4), C = gacha CSS (#5). Each lane's frozen diff went through a blind Opus review in parallel with a Maya
review, then fix waves and confirm rounds, until **all three lanes were CONFIRMED SHIP by both reviewers**. The
main seat also read every source diff. The six commits are on `main` and **UNPUSHED**: `53f8010` · `7522040` ·
`c09d47b` · `31953a9` · `23fd88a`, plus `c1c8bad` (the R94 + R95 docs). FE-only, with no migration and no config
change. **v1.7.11 is HELD** until the ASR/VAD work lands too (owner: "after we fix everything, we push for
production"). The session record is in `~/.cache/tmp/ctrlb-session52/`: `SESSION_PLAN.md`, `RULINGS.md` (every
finding's ruling) and `commit-report.md`.

1. **Who-line** (`53f8010`). The bubble shows the character's `title` (from `useAgentArt`'s new `titled` flag, not
   gated by the avatars switch). The untitled root keeps "assistant". The tool-call and question bubbles follow.
   **#1c:** the send placeholder is seeded with `agent ?? threadAgent`, the agent that will actually answer
   (display only; the request body is unchanged).
2. **Multi-line italics** (`7522040`). The new **`lib/actionSpan.ts`** is the one pairing rule shared by the eye
   and the ear, with boundary guards (`(?<![\w*])`, so `**bold**`, `2*3` and `f*ck` never open a span). The
   markdown pre-pass carries an open `*` across single and blank-line breaks, skips fences and inline code, and
   italicizes an unclosed tail only once the reply is settled. Accepted residual: an unbackticked `*.tmp` in
   prose italicizes to the end of a settled reply (the ear already drops it; D74's class).
3. **One-word emphasis with narrate-actions OFF** (`c09d47b`). A span with no whitespace inside (`*really*`,
   `*sighs*`) is spoken inline. The tail search now runs on a mask of closed spans, and stars inside code become
   a space. D74 ⑤, the Conf description and the SpeechOpts comment were all updated.
4. **MiniPlayer intent** (`31953a9`). `finish()` clears intent on park, so after a reply ends the face shows
   "play" and a waveform tap only seeks. **A headset or lock-screen play after the end re-arms intent**, so the
   whole reply replays (review finding B-F1).
5. **Gacha oracle bottom row** (`23fd88a`). The real mechanism was **screen density**: DPR 2.625/2.75/3.5
   reproduce, 2 and 3 don't. The audit's inferred fractional-inset cause was wrong in detail but right in class.
   The cure is a **symmetric 1px overdraw**: art and scrim both bleed 1px into the clip, and the border change
   was not needed. The new `e2e/gacha-oracle-edge.spec.ts` pins "last row ≈ the row above". It is
   **Chromium-only** on purpose, because Firefox never showed the seam and its last row is page background for
   an unrelated reason. The as-built note is in GACHA_PLAN G6.7 ④.

**Session mechanics for the next seat:** the scratch-dir layout is the session-50 default (memory
`token-lean-delegation-default`). ⚠ **Gotcha: give Maya her OWN output file in every prompt.** A confirm run told
"Opus writes X, Maya prints" wrote into the Opus file and clobbered it.

### The owner's test card — on PROD after v1.7.11 (dev not needed; these ride the next release)
1. **Who-line:** Lynette's and Seraphina's bubbles show their names, not "ASSISTANT". Their tool-call bubbles
   show the names too. Just after you send, the placeholder already carries the name of the agent that answers.
2. **Italics:** Lynette's greeting shows no literal `*`. An action that spans a line break is italic across
   it, including one broken by a blank line.
3. **Narrate-actions OFF:** a reply containing `*really*` speaks "really". Longer `*actions*` stay silent.
4. **MiniPlayer:** after a reply ends, the face shows "play", not "pause". A waveform tap then only seeks and
   does not start playback. Pressing play on the headset replays the whole reply.
5. **Gacha oracle, on the phone:** no lighter or darker line under the oracle art, with an empty thread and with
   a scrolled one. ⚠ Residual doubt: the owner's screenshot is 720px wide, which suggests DPR 2, and headless
   Chromium never reproduced the row at DPR 2. This eyeball is the real verification.

## ▶▶ NEW (2026-09-28, Opus 5.5 seat) — R94 LIVE-VOICE VERIFICATION: FABLE REVIEW FIRST

The owner commissioned five external audits of the ASR side, covering live-call false turns and dictation stopping by itself. The Opus seat verified them with five read-only Opus lanes against code, the prod journal, the call trails and emma measurements. **Read [`research/R94-asr-audits-verification.md`](./research/R94-asr-audits-verification.md)**:
- §1 is the one-page answer;
- §11.0 holds the owner's rulings;
- the evidence is in `research/R94-evidence/` (L1–L5), and the audits verbatim in `research/R94-external-audits/`.

**NOTHING BUILT.** The R94 docs, the README row and R95 were committed in session 52 (`c1c8bad`). ⚠ **`R94-evidence/L2` quotes private call transcripts. It stays UNTRACKED forever (owner ruling 2026-09-30):** keep it off every commit and every commit brief's file list.

- **Problem A (dictation and a call cut mid-session on 09-28).** The relay's own flood guard `_note_frame` (100 frames / 2 s, on server READ time) mistakes 4G/Tailscale burst delivery for a flood: 5 kills, one of them a call. Four sibling kill paths go the same way (K2–K6). The fix does not touch the VAD: S1 telemetry → S2 wall-clock token bucket → S3 per-mode client kill paths, then S8 "the recording's lifetime ≠ the live leg's".
- **Problem B (phantom "Yeah."/"Mm-hmm.").**
  - The cause is Speaches' 3 s zero-state rescan: flaps, plus **the 3 s pin**, plus onset clipping.
  - A hidden second VAD in Speaches' HTTP door empties ~21% of segments today.
  - The car "Yeah." was an echo tail, not the VAD.
  - Proposed: a relay-owned stateful VAD + a pre-ASR pass + batch ASR through the provider seam (parakeet.cpp was measured faster than today). **The owner wants Fable to challenge this direction and research alternatives before ruling (R94 §11.0 D3).**
- **Owner rulings in:**
  - idle stop 5 min (0 = off, own threshold);
  - dictation cap 30 min (keep the relay's session limit above it);
  - foreground-only dictation, plus a wake lock if clean;
  - ASR failure never refuses a call;
  - drop the Kokoro TTS fallback;
  - a provisional early-call floor from the remembered voice level.
- **R95 is IN** ([`research/R95-vad-placement.md`](./research/R95-vad-placement.md), session 52, the owner's D3 challenge). Its recommendation:
  - Keep the relay-owned VAD (**C1**), shaped so placement is a detail: the policy is a pure function with golden vectors, segment bounds are leg-sample indices, and the segmenter sits behind a one-method interface.
  - **No quality/battery toggle now.** Quality does not depend on placement, and battery is a wash on the only numbers that exist.
  - Add the **S6b** debug-gated Honor 20 phone probe.
  - **Promote K6 (16 kHz capture)**, the real battery/data lever.
  - **C2-H** (phone VAD + HTTP segments, no WebSocket) is recorded as the named exit.
- **Fable's job:**
  - Review R94 (§11.1 lists D1/D2/D4/D5/D9/D10 plus the four stress-test questions) together with R95 §10, and rule **D3 formally in the ASR session** as S5's D-entry.
  - Then brief Opus build lanes. The plan is **session A = S1–S4 + P1–P3**, then **session B = the VAD** (S5 → S6/S6b → …).
  - **v1.7.11 ships after this work**, carrying the five polish commits above.

## ▶▶ NEXT SESSION — THE OWNER'S PROD CARD on v1.7.10 (the vault backlog), then the deferred S10 car card

**The 50th session (2026-09-27 evening → night) — what happened:** the owner pointed the main seat at
the vault bug/idea inbox (its path is in [`ISSUES.md`](./ISSUES.md)'s header — dictated
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
QUALITY counts + this handoff) → the release lane (push → v1.7.10 — **LANDED: v1.7.10 LIVE on prod**). **The car card is DEFERRED to the
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
  hold/lock/tap recording streams through the ear. The switch: Conf › Voice · STT › "Live dictation"
  (intended? owner-court ① below).
- **The edit cap** = 10,485,760 characters (the upload ceiling, `attachments.max_file_mb` × 1 MiB) — a
  sanity bound, not a real limit; no send-path limit exists, so no new number was invented.
- **The F20 duplicate-row defect is fixed:** retry on an error bubble now regenerates (no second copy of
  your message after a reload). One corner remains: a send whose accept never reached the phone, though the
  server stored your message, puts your text back in the composer — re-sending it duplicates
  (the old behavior, now only there — ISS-35).
- **Deleting YOUR message deletes exactly that row** (SillyTavern parity): its reply stays and FOLDS into
  the previous turn's current take — a later swap / tail delete / retry moves them together.
- **The every-turn GET:** the chat re-reads the thread once at the end of every turn (to learn which
  reply is retryable). One extra GET per turn; if chat feels slower on the Honor 20, say so (the remedy =
  an identity-preserving merge in the reload — ISS-38, WATCH).
- A stop in `thinking` discards anything you said into that turn (you re-say it — as designed); a tap within
  ~100 ms of sending cancels nothing (the server has not registered the turn yet — ISS-33).
- **Every known limitation this session chose not to fix has ONE home, an ISSUES row with its reopen
  condition: ISS-33 … ISS-43** (listed in "Open issues" below); the owner's open questions are the
  owner-court list in the Standing ledger.

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

**The release facts (v1.7.10 — RELEASED, LIVE on prod @ `9c5a6c6`):** carries S10 + wave 1.5 + ISS-31/32 + session 50's six builds · **DB
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
specialists — is a root greeting even meaningful? (owner court, no rush — ISS-37).

**Durable session record:** every audit, brief, ruling, frozen diff, review, confirm and lane report is in
**`~/.cache/tmp/ctrlb-session50/`** (`SESSION_PLAN.md` = the runbook + lane table; `RULINGS.md` = every
ruling with its reason; `wire-D81.md` = the D81 wire as built). The B-FE round's findings were ALL
ACCEPTED into its fix wave (`RULINGS.md` "Lane B-FE review round №1"): the two converging MEDs plus
Opus's LOWs — non-409 regenerate refusals surface as errors · retry/`›` hidden while an unsent bubble
follows the reply · an in-flight synth cannot re-cache pre-edit audio · a gap between `›` and ▶ at
390 px · a failed edit keeps your typed text · re-attached turns also re-read the floor · the delete
wording · an accessible name on `n/N` · the new 11 px buttons join the e2e contrast matrix.

**Dev** (`~/.ctrl-b-dev`, :5434 + Vite :5173): units RUNNING (the owner: keep them up). **Prod**: v1.7.10
LIVE @ `9c5a6c6` (released 2026-09-27 evening; rollback = plain `update.sh v1.7.9`) — verify with `git -C ~/apps/ctrl-b describe --tags --exact-match`.

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
6. **Per-agent voices** — owner-court ④ (the Standing ledger below).

### 2. Open issues — [`ISSUES.md`](./ISSUES.md) is the ledger; the live ones
- **Owner look / ruling wanted:** ISS-12 (frontier modal-footer SAVE contrast) · ISS-10 stage ②
  (owner-parked) · ISS-19 (above) · ISS-37 (is a root greeting meaningful?).
- **Awaiting the owner's prod round (FIXED in v1.7.10):** ISS-31 (`/new` mints + greets — S10 card item 8)
  · ISS-32 (the ring stays put — S10 card item 9).
- **Session 50's residual ledger (RECORDED at build, each row names its reopen condition):** ISS-33 (a call
  stop before the turn registers) · ISS-34 (a Stop exactly at the stash's commit) · ISS-35 (the F20
  saved-but-unaccepted send) · ISS-36 (the floor-match windows) · ISS-38 (the every-turn GET — WATCH on
  the Honor 20) · ISS-39 (the contrast probe's backdrop fallback) · ISS-40 (mouse press/release on the
  call — PARKED) · ISS-41 (dictation trails vs `trail_keep`) · ISS-42 (pre-D81 `meta.skills`) · ISS-43
  (a text-less parked reply has no who-line). Greeting swipes are a SEAM, not a residual (ROADMAP A14).
- **Session 52's residual ledger** (the polish items; rulings in `~/.cache/tmp/ctrlb-session52/RULINGS.md`):
  - **Fold into the next markdown touch.** The renderer's per-line `em` rule in `INLINE` (`lib/markdown.tsx`)
    is a second spelling of the pairing rule, and it lacks the boundary guard: the scanner matches on `rest`
    slices, so a lookbehind can't see the previous character. As a result, a glued `Hello*She walks*`
    italicizes on screen but is spoken. Fix: pass the previous character to the `em` rule.
  - **Accepted:**
    - An unbackticked `*.tmp` in prose italicizes (or, for the ear, drops) to the end of a settled reply.
    - The CJK one-word rule: with no spaces, a whole-sentence action is spoken.
    - The one-task pause/play window in `audioController`.
    - `parked` is not cleared after a hardware replay.
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
- **Session 50's open questions (2026-09-27):** ① **Live dictation is ON in prod**
  (`voice.live.dictation: true`, your own flip — you believed it off): intended? Default = leave it ON
  (Conf › Voice · STT › "Live dictation"). ② **The A/B/C car-dictation arms** — run them ONLY if the
  prod card's item 1 still clips. ③ **Dev `voice.live.debug` reads OFF** in `~/.ctrl-b-dev/config.yaml`
  (the 49th block said ON) — flip it back on for dev rounds, or leave it? ④ **Per-agent voices** — nothing
  picked from the PocketTTS library yet (`ganyu` = the interim default everywhere; the cloned voices live
  in `~/.local/share/tts/voices/pocket`). ⑤ **ISS-37** — is a root greeting meaningful? ⑥ the ⚖ veto
  window (a)–(f) in the ▶▶ block.
- The ~80 MB untracked `design/prototypes/gacha/` originals (its four art/sheet dirs, gitignored since
  2026-08-06 — so `git status` never shows them) — standing "leave untracked for now";
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
