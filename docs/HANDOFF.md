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

## Where we are (2026-10-09 — **PROD = v1.7.11 LIVE @ `bad0c99`** (rollback = plain `update.sh v1.7.10`). **Session 67 (read-only + one design ruling): the owner's first dev captures READ — the clip door on parakeet PASSED its first owner clip, two dictations + two calls clean; the call screen's missing transcript ROOT-CAUSED and its fix DESIGN-RULED as ISS-69 (the heard line shows the whole held turn, fixed two lines, tail visible). NEXT = TWO things in one clean session: the owner's short-answer + car captures → promote → TUNE, and the ISS-69 build. Read the session-67 block first.** *Session 66 (Fable, a short sitting): the owner's three calls RULED (RAM ≤ 3 GB bounded · governor stays `powersave` · PUSHED), the Dependabot sweep done (undici · pypdf 6.19.0 · five FE dev transitives), ALL PUSHED @ `e92da69`+this handoff, dev restarted on it, the owner briefed on the two doors / two units and the test order. NEXT = THE OWNER'S CAPTURES on dev (the clip door first) → TUNE → the S9 gate's owner-audio rows → S7b. Read the session-66 block, then session 65.** *Session 65 (Fable, the clean continuation after session 64's usage-limit cut): the two cut lanes RELAUNCHED and DONE — the S9 bake-off's no-owner-audio rows measured (ASR_PLAN §6.4.1, `9a04b17`; H8 = the source build stays) and **S7a BUILT + two-reviewer-CONFIRMED + MERGED `f44025f`** (the client half of the new wire, inert until `ready{clock:"leg"}`). Gate on main: see the session-65 block. 11 commits UNPUSHED. NEXT = the owner's capture rounds (THE critical path) → TUNE → the S9 gate's owner-audio rows → S7b (the flip; its brief = audit-S7a §I + the recorded contract pins). v1.7.12 waits for J3 + J4 (owner). The three owner calls RULED 2026-10-08: the RAM criterion → ≤ 3 GB bounded (§6.4 amended) · the CPU governor STAYS `powersave` (no evidence it matters off a saturating synthetic load) · PUSHED (`355197e`, 0 unpushed).** Read the session-65 block first.)

- **Prod** (`~/apps/ctrl-b`, `ctrl-b-dashboard` :5433, https://emma.lobster-vector.ts.net): **tag `v1.7.11` on `bad0c99` — LIVE since 2026-10-07 10:40Z** (health 1.7.11, schema 7, config 5 — no migration; the icon-192 content-type check passed; the HTTPS front door answered 200; rollback = plain `bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.10` — safe by tag, nothing to restore). What v1.7.11 carries = the v1.7.11 tag message + ASR_PLAN §8.1.1 (session A: S1 · S2 · SP · K6 · ISS-54 · D9 · ISS-55 · D8 · ISS-61 · D5; D83 fail-fast; the session-51 polish; ISS-12/37/47/48/49/51/52/53/66/67/68; ISS-28 macros; the gallery slice). **Speaches is still the ear.** Prod's `voice.live` block unchanged (`{dictation, mic_hold, debug}`). *The previous state, kept for the record:* at session 63's start,
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

## ▶▶ NEW (2026-10-08/09, Fable seat → Opus 5.5 for the close, session 67 — READ-ONLY: the owner's first captures READ · ISS-69 DESIGN-RULED · J5 recorded) — **READ THIS, THEN the session-66 block, THEN session 65's (the S7b pins)**

**State at close (verified):** `main` = `3b55a57` + this docs commit (ISSUES ISS-69 · ROADMAP J5 · this block), **UNPUSHED** (push on the owner's word). No code changed. Dev units RUNNING as session 66 left them (`voice.live.debug` ON, clip door on parakeet-clip, calls + streaming dictation on Speaches). Prod untouched: v1.7.11. **Dependabot: 0 open** (session 66's lag resolved on its own).

### What the owner ran on dev (2026-10-08 ~16:58–17:07 local) and what the trails say
| Test | Trail (`~/.ctrl-b-dev/calls/`) | Verdict |
|---|---|---|
| Push-to-talk clip (parakeet-clip) | `clip/92ded541…` | **PASS.** 31.7 s, 2 chunks, ASR 2.28 s. The text in the thread is verbatim, inline Spanish kept: *"Así que puedes escucharme, sí, no, yes, no. Okay."* — first evidence on the language risk, but INSIDE an English sentence. The BARE short-answer clips are still owed. |
| Streaming dictation ×2 (Speaches) | `dictation/00ef8a79…` · `dictation/2fd51f2d…` | Clean: 8 + 5 finals, 0 drops, every text final in the message, legs closed 1000, clip discarded (stream never died). Speaches' first final of the leg took **6.5 s** (the 10-07 PASS trail: 17.5 s); later finals 0.3–0.6 s. Goes away with S7b. |
| Call, CALL route (forgot to switch) | `b3a3413e…` | Clean: 6 finals, 0 drops, ISS-55 hold joined everything into one turn, released on expiry. Chirp lag 280 ms (EC `all`). |
| Call, MEDIA route | `3c0abce0…` | Clean: 11 finals, 0 drops, one turn. Chirp `none` (no echo, as designed). **This is the call where the owner reported the transcript issue → ISS-69.** |

Other facts: all four on the owner's **Bluetooth headset, quiet room, no background** (the owner's own note — the headset mic is lower quality). corsair is asleep, so every agent turn paid the **D83 5 s connect timeout** before strata answered (the 60 s cooldown re-arms between turns; design as ruled — part of the reply latency the owner felt). Dev journal: only those failover WARNINGs. parakeet-clip 2.4 GB · parakeet-live 2.1 GB, bounded.

### ISS-69 — DESIGN RULED, build next session (the full row is in `ISSUES.md`)
The owner saw only "Listening" + "…" and never their words. Root cause: the heard line's own rule (`…` while a segment is open or a final in flight — the 09-23 ruling) meets continuous speech: 9 of 11 finals arrived after the next segment had opened; the 2 visible ones lasted 0.13 / 0.18 s. NOT the debug readout. And the line only ever held the LAST segment. **The owner's rulings:** the line shows the WHOLE HELD TURN (built from `pending`, the queue the send already uses — dictation's draft pattern), "…" appended after the words while speech is in flight · **keep the sent turn on the line after the send** · **FIXED TWO LINES, the tail visible** (the clamp anchors to the end; no scroll, no growth) · aria-live announces only the new segment. A scrollable box or fit-to-text font sizing = future refinement → ROADMAP **J5**.

### J5 recorded (ROADMAP) — the call screen's UI refinement, its OWN session after Phase 26 closes
Captions read small (13 px vs the 16 px heard line), everything is cramped by the debug readout; refine once `voice.live.debug` is off. Not a v1.7.12 blocker.

### ▶▶ THE OWNER'S CAPTURE CARD (dev, https://emma.lobster-vector.ts.net:8443 — debug stays ON)
1. **Bare short answers, push-to-talk:** Conf › Live call › "Live dictation" OFF. Press the mic, say ONE word, release — one clip each: *sí · no · vale · okay · yes · no*; then a few two-word ones: *"sí, vale" · "no, gracias"*. Read the composer text after each (that IS the hand judgement); sending is optional — the WAV + trail are captured on upload regardless. If not sending, note the time + what was said ("17:12 said sí, got X").
2. **The same set IN THE CAR, engine running**, plus two or three full sentences per language there. This is the run that matters most: the bake-off's phantom "Okay." came from a car-noise negative, and the pre-pass sweep (`prepass_act`) is tuned on exactly these.
3. **One pass with the phone in hand** (not the headset) — D85 enrols per input route, so a second route's audio is worth having.
4. Optional: streaming dictations + calls in the car (still Speaches; TUNE corpus + the S7b reference set).

### ▶▶ NEXT SESSION (clean; both tracks)
1. Read this block → session 66 → session 65 (S7b pins) → `~/.cache/tmp/ctrlb-session64/RULINGS.md` + `SESSION_PLAN.md`.
2. **Captures:** read the owner's new trails (clip/ + dictation/ + calls/, after 2026-10-08 17:07) → hand-read the short answers → `asr_corpus.py promote … --owner-only` (today's four captures qualify too; NEVER the synthetic `calls/clip/` bake-off clips from 10-07) → **TUNE** (`vad_replay.py` incl. `--prepass-sweep`, `--asr` on parakeet-clip) → the S9 gate's owner-audio rows (ASR_PLAN §6.4.1 OPEN list) → S7b audit lane.
3. **ISS-69 build** (parallel, independent of the ASR track): read the row's "read first" list → brief → one Opus lane (FE: `useLiveCall.ts` view + `CallOverlay.tsx` + `kit.css`) → main-seat audit → blind Opus 5.5 ∥ Emma → fix wave → confirm → commit → `npm run build` + dev restart → the owner's phone check (a long call with short pauses: the line should show the turn growing, the tail visible, the sent turn staying).
4. v1.7.12 still waits for J3 + J4 (owner).

---

## ▶▶ NEW (2026-10-08, Fable seat, session 66 — a SHORT sitting: the three calls ruled · the Dependabot sweep · the owner briefed · ALL PUSHED) — **READ THIS, THEN the session-65 block (the S7b contract pins live there)**

**State at close (verified):** `main` = `e92da69` + this handoff, **0 unpushed after this push**; tree clean. Full pre-push gate GREEN on every push (three pushes this session). **Dev** (:5434 + Vite :5173 + Serve :8443) RUNNING on `1.7.12.dev14+g53172b5` with pypdf 6.19.0 loaded (the backend unit restarted once at close; the dist is still the S7a build — nothing FE-visible changed since). **Prod** untouched: v1.7.11, Speaches everywhere. The scratch dir stays `~/.cache/tmp/ctrlb-session64/`.

### What this session did
| Commit | What |
|---|---|
| `69c707d` · `e92da69` | **Dependabot, frontend:** undici 7.30.0 (jsdom's dev transitive, the 6 alerts GitHub nagged on the first push) + the 2026-10-08 rescan set (sharp 0.35.5 · source-map-js 1.2.2 · brace-expansion ×3 · postcss-selector-parser 7.1.6 · fast-uri from npm audit). Lockfile only; every one a devDependency transitive. **Left alone on purpose:** npm audit's braces/micromatch/globby rows under stylelint — not GitHub alerts, their only "fix" is a MAJOR DOWNGRADE of stylelint (a known npm-audit artefact). |
| `7c5ba5e` | **Dependabot, backend:** pypdf 6.16.2 → **6.19.0** (8 highs, all resource exhaustion on malformed PDFs). Exact pin kept (it parses hostile input); `test_attachments_d68` 102/102; `pip check` clean after `pip install -e .` from `backend/`. |
| `53172b5` | **The owner's three calls RULED:** ① the S9 RAM criterion → **≤ 3 GB bounded, no growth across runs** (*"if it needs a little more RAM it can get it; 2–3 GB is not too much"*) — ASR_PLAN §6.4 amended, §6.4.1 RAM row → PASS, §3.7's ~1.5 GB estimate replaced by the 2.2–2.3 GB measurement; it was always plan wording, NO unit carries a memory limit. ② **the CPU governor STAYS `powersave`** — the owner does not want the box drawing more power without a reason; the contended row failed only under a saturating synthetic load; revisit only with evidence from real captures. ③ **pushed.** |

**Dependabot lag (verify next session):** every fix is on origin's default branch, but at close GitHub still listed all 19 alerts OPEN (undici's six with a 10-02 stamp an hour after the fix landed) — its resolution trails the graph refresh. `gh api repos/nengoxx/ctrl-b/dependabot/alerts --paginate --jq '.[] | select(.state=="open") | .dependency.package.name' | sort | uniq -c` — if anything but zero shows next session, GitHub sees a path we do not: look.

### The owner was briefed on (keep the wording — it answered real confusion)
- **Two doors = two parakeet units.** The CLIP door = the HTTP upload (`/stt`): a finished recording posted once. The LIVE door = the WebSocket relay (the ear): audio streams in, the relay segments, each segment transcribed. Each `parakeet-server` serialises on one mutex, so one process for both would let a 30-min upload block every call turn for minutes — hence `parakeet-live` :9010 + `parakeet-clip` :9011 (§3.7). parakeet ≈ 2.3 GB each, bounded; Speaches 6.5 GB resident + ~4.4 GB swap and growing.
- **The mic button's three behaviours:** push-to-talk (streaming off: record, upload once → the clip door) · streaming dictation (`voice.live.dictation` on: phrases arrive as you talk → the live door = Speaches until S7b) · the whole-clip fallback (a streaming dictation whose stream died: the local recording is uploaded once on stop → the clip door). **Only the clip door moved to parakeet (dev). Calls + streaming dictation stay on Speaches until S7b. Prod = Speaches for both.** TTS = PocketTTS everywhere.

### ▶▶ THE OWNER'S CARD (dev, https://emma.lobster-vector.ts.net:8443 — close + reopen the PWA once; debug readout is ON so every clip/call is captured beside its trail under `~/.ctrl-b-dev/calls/`)
1. **Push-to-talk clips FIRST** (what changed): Conf › Live call › turn "Live dictation" OFF for this part, or just use the plain mic if it is already off. English AND Spanish, **short answers (sí · no · vale · okay · yes · no) and full sentences**, home and car. Judge the text by hand — **short Spanish answers are the top risk** (synthetic monosyllables crossed into invented English/Cyrillic in the bake-off; sentences stayed Spanish).
2. **Then streaming dictations + calls** with real pauses, both languages — still Speaches, but their audio is the TUNE corpus and the S7b reference set.
3. Note anything odd by trail (time + what you said); the next session promotes the captures with `asr_corpus.py promote … --owner-only` and runs the sweeps.

### ▶▶ NEXT SESSION (in order)
1. Read this block → the session-65 block (S7b pins, gotchas) → `~/.cache/tmp/ctrlb-session64/RULINGS.md` + `SESSION_PLAN.md`.
2. Check the Dependabot count (above).
3. **THE CRITICAL PATH IS THE OWNER'S AUDIO:** read the owner's card results from the trails → promote (`--owner-only`; NEVER the 40 synthetic bake-off clips in `calls/clip/`) → **TUNE** → the S9 gate's owner-audio rows (§6.4 + §6.4.1 OPEN list) → **S7b THE FLIP** (audit lane first, from the session-65 pins) → field rounds → S8 → S8b → S10.
4. v1.7.12 = session B, WAITS for J3 + J4 (owner). Parallel seat: J1–J4 design sessions from their plan stubs.

---

## ▶▶ NEW (2026-10-07 night, Fable seat, session 65 — the CLEAN CONTINUATION after the usage-limit cut) — THE TWO CUT LANES DONE · S7a BUILT + CONFIRMED + MERGED · NEXT = THE OWNER'S CAPTURES → TUNE → S7b — **READ THIS BLOCK FIRST, THEN the session-64 block, THEN `~/.cache/tmp/ctrlb-session64/RULINGS.md` (the "SESSION 65" sections) + `SESSION_PLAN.md`**

**State at close (verified):** `main` = `f44025f` (S7a) + this docs commit; tree clean, no worktrees; **11 commits UNPUSHED** (`0f471aa` … this handoff — push on the owner's word). **Full gate on main after the S7a merge GREEN 6/6** (pytest 254.8 s · FE check-all 85 s; `~/.cache/tmp/ctrlb-session64/check-all-S7a-main.log`). Dev dist rebuilt + `ctrl-b-dashboard-dev` restarted after the gate, health OK, journal clean (the phone's :8443 serves the BUILT dist). Prod untouched: v1.7.11, Speaches everywhere. The scratch dir stays `~/.cache/tmp/ctrlb-session64/` (session 65 appended to its RULINGS/SESSION_PLAN rather than opening a new dir).

### What this session did
| Commit | What |
|---|---|
| `9a04b17` | **The S9 bake-off** (the relaunched lane; `lane-S9-bakeoff-report.md`; ASR_PLAN **§6.4.1**): synthetic clips only (PocketTTS English · Kokoro Spanish through dev's TTS route — PocketTTS is English-only). **H8 RULED: keep the SOURCE build** (1.57–1.74× the release tarball, identical text; no unit change). Contention PASSES. **RAM 2.2–2.3 GB/unit** = a bounded high-water mark (no growth across two 30-min runs) — FAILS the "< 2 GB" letter; **amendment PROPOSED to the owner** (≤ 2.5 GB bounded, no growth). Latency: uncontended p95 < 1 s to ~16 s, **1.20 s at the 20 s cap** (inside §3.5 ⑧'s "well under 2 s"); the contended row fails only under a saturating synthetic load (**emma's CPU governor is `powersave`** — a lever the owner decides). **Language: sentences stay Spanish; bare synthetic `Sí.`/`No.` CROSS into invented English/Cyrillic** (the model, not the port; ambiguous to whisper too) — EVIDENCE, not a verdict: **the owner's real short answers are the test, and this is THE top risk to watch in the captures.** One car-noise negative produced a phantom "Okay." (feeds the `prepass_act` sweep). The S9 gate stays OPEN on the owner-audio rows. |
| `f44025f` | **S7a — the client half of the new wire, INERT until `ready{clock:"leg"}`** (FE-only + one BE test). `lib/liveSocket.ts` = **S7b's contract**: `ready{clock,answer_ttl_ms}` both-or-neither; `state:"flushed"`; a final's bounds/`reason`/`outcome` validated ONCE per leg behind a latch (10 valid pairs of 16; END non-decreasing; the pre-roll may cross); an invalid final is DELIVERED marked `anomaly` (settled, no text) + `anomalies()`. `useLiveCall.ts`: `capJoin` = ONE flag on the existing hold (a taken cap final opens, any cap final continues, any other clears; mute clears + keeps words; the release predicate gains `!capJoin`); the awaited-id TTL on `awaiting[0]` with a bounded expired-id memory ⇒ `late:true`; `asr_error` final silent + the `upstream_error` note (H6); `ear_failed` note-only like `busy`; **`queueTook`** (a REAL G-8 defect the lane found: the hold-0 join-ending final is taken + released in one step); `turnWhy` `join`/`ttl`/`unjoin`; `answerLate` retracted on the next taken final; a clock leg's id-less final settles nothing. `useDictation.ts`: `capText` joined into ONE `appendDraft`, appended on EVERY exit before the clip either/or (H2: never lose speech; S8 flips `asr_error`/degrade to discard with recovery), the release waits for `flushed` bounded by the TTL (H3). `_SERVER_ONLY` gains the inherited service keys. NO config key, NO Conf row. Blind Opus (SHIP, 4 LOW) ∥ Emma (SHIP WITH FIXES, 1 MED ruled the EM-1 behaviour + pinned) → wave 1 → **both CONFIRMED SHIP**. FE tests 4,636 → 4,695; e2e +2. |

### ▶▶ THE S7b CONTRACT PINS (recorded this session — go into the S7b brief VERBATIM)
audit-S7a.md **§I** (what S7b must emit) PLUS: `answer_ttl_ms` is an **INTEGER** (a float turns the capability off) · with nothing open, **`flushed` goes out AT ONCE** (else every dictation release on a clock leg waits `answer_ttl_ms` ≈ 31 s) · the typed `asr_error` final FIRST, then `error{upstream_error, item_id}` (§3.9 ① fixed) · never a bare 1011 (`error{ear_failed}` first) · exactly one final per stop, in STOP order, only the 10 valid pairs, `audio_end_ms` non-decreasing · S7b adds an R88-style downlink parity test (the relay's real frames through `parseLiveFrame`). For S8: `(max_segment, asr_error)` must be a degrade trigger too; the single-TTL `flushed` bound with several slow segments ahead of the flush is re-weighed there.

### ▶▶ NEXT SESSION (in order)
1. Read this block → the session-64 block → RULINGS.md "SESSION 65" sections.
2. **THE CRITICAL PATH IS THE OWNER'S AUDIO** (unchanged): capture rounds on dev (debug ON) → `asr_corpus.py promote … --owner-only` → **TUNE** (`vad_replay.py` sweeps incl. `--prepass-sweep` and `--asr CONFIG` on `parakeet-clip`; the owner's hand judgement; settle `VadParams` + `prepass_act`) → the S9 gate's owner-audio rows (§6.4 + §6.4.1 OPEN list; **the real EN/ES short answers decide the language question**) → **S7b THE FLIP** (audit lane first, from the pins above) → field rounds → S8 → S8b → S10.
3. ~~The owner's three calls~~ RULED 2026-10-08 (RAM ≤ 3 GB bounded · governor stays `powersave` · pushed). The Dependabot undici alerts (jsdom's dev-only transitive) fixed by a lockfile bump the same day.
4. **v1.7.12 = session B** — WAITS for J3 + J4 (owner) unless re-ruled at release time. Prod steps = the runbook "The ASR engines" + ASR_PLAN §8.2.2.

### Gotchas (verified this session)
- A worktree branch based BEFORE a docs commit on main is not a fast-forward: `git rebase main <branch>` from the main tree (clean) then `--ff-only` — clean when the sections differ.
- The pre-commit hook in a worktree: stage with the symlinks ABSENT, then link `backend/.venv` + `frontend/node_modules`, commit, unlink (as before). Emma's review runs in the worktree need the links too — re-link for the review window, unlink before the freeze.
- Running the bake-off through dev's real door under `voice.live.debug` wrote 20 synthetic clip trails + captures into `~/.ctrl-b-dev/calls/clip/` and PRUNED the two S9 field-check trails (`trail_keep` 20; copies in the scratch `bakeoff/preserved_clip_trails/`). They are NOT owner audio — never `promote` them; they age out as the owner's clips arrive.
- The relaunched lanes ran at the start of a fresh usage window; two Opus lanes + a build lane + a blind reviewer fit comfortably.

---

## ▶▶ NEW (2026-10-07, Fable seat, session 64 — SESSION B: S6-i · S6-ii · S9 MERGED; CUT OFF BY THE USAGE LIMIT ~19:27 LOCAL) — **READ THIS BLOCK FIRST, THEN `~/.cache/tmp/ctrlb-session64/RULINGS.md` + `SESSION_PLAN.md`**

**State at close (verified by the closing seat, Opus 5.5, 2026-10-07 evening):** `main` = `76f5db5` + this handoff commit, **tree clean, no worktrees, 8 commits UNPUSHED** (`0f471aa` … this handoff — push on the owner's word). **Full gate `tools/check.py` GREEN 6/6 on `76f5db5`** (pytest 3,346 · vitest 4,636/217; log `~/.cache/tmp/ctrlb-session64/` — the last gate ran after the S9 merge). **Prod untouched: v1.7.11, Speaches everywhere.** Dev dist rebuilt + `ctrl-b-dashboard-dev` restarted after the S9 merge (dev health = `1.7.12.dev…+g76f5db5…` after the next restart; it read `g64021d8` mid-session because the editable install is refreshed by `pip install -e` — harmless).

### What this session built (all two-reviewer-closed: blind Opus 5.5 ∥ Emma `gpt-5.6-luna-900k` high, both CONFIRMED, every ruling in `RULINGS.md`)
| Commit | What |
|---|---|
| `0f471aa` · `5158734` | The owner's rulings on the open rows (below) · **J3 [`PROMPT_ORDER_PLAN.md`](./PROMPT_ORDER_PLAN.md) + J4 [`LOREBOOK_PROBABILITY_PLAN.md`](./LOREBOOK_PROBABILITY_PLAN.md)** plan stubs |
| `1c63ce7` | **S6-i** — `services/voice_vad.py` (the §3.4.1 model boundary: Silero v6.2 default + v5.1.2, one ORT session per model per process, `VadParams` in ms + `derive()` exact on float ms with a cap guard `max_hops > age_bound + cut_span + 1`, the pure policy `step()`, `VadSegmenter` on two clocks) · `voice_audio.py` (`PcmResampler`, PyAV, replaces `core/audio.Pcm16Resampler` at the flip) · `voice_prepass.py` (bounded decode + the pass) · `assets/silero/` · the **`voice` extra (onnxruntime 1.30.0 · numpy 2.5.3 · av 19.0.1) is GATE-MANDATORY** (`tools/check.py` probes it) · `voice.live.vad_model`. 46 hand-authored golden vectors. |
| `48c7d1e` | **ISS-28 editor hint** — `POST /api/macros/per-turn` (the server's `per_turn_in`, raw body bounded before parse) + `usePerTurnHint` + `PerTurnNotice` (`WarnRow`) on the agent form's head fields, the lorebook entry (head position), the persona About, and INSIDE the fullscreen editor via a GENERIC `PromptRequest.notice` slot. **ISS-28 is now fully closed.** |
| `64021d8` | **S6-ii** — receipt stamping + `gap_ms`; the debug-gated raw-audio capture (`CallTrail.open_capture`: `<call>-<leg>.wav` beside the trail, 0600, header-first `.part` → finalize, degrades under a slow disk, prune-by-stem + an open-writer guard, file name on a `capture_open` trail line); `core/audio.pcm16_wav_header()` = the ONE WAV header; **`tools/vad_replay.py`** + **`tools/asr_corpus.py`** (promote `--owner-only` · label · list · prune · `--file`; `--home`/`CTRLB_HOME` required, a git tree refused); SECURITY_MODEL §2.12; `.gitignore` `calls/` + `asr-corpus/`. |
| `5ce0536` | **The engines (system state, machine-wide user units, R19):** parakeet.cpp **v0.5.0** at `~/github/parakeet.cpp` (source build `GGML_NATIVE=ON`; the release tarball unpacked beside it in `build-release/` for the H8 comparison), model `models/tdt-0.6b-v3-f16.gguf` (sha-verified), units **`parakeet-live` :9010 · `parakeet-clip` :9011** (0.0.0.0, 4 threads, enabled, ~1.45 GB RSS each); runbook section **"The ASR engines"** in `deploy/linux/README.md` (health · update · remove · the provider YAML · the v1.7.12 prod config steps + rollback). Speaches untouched (R18). |
| `76f5db5` | **S9** — `transcribe(door=, prefer=)` (per-provider gate walk; the TTS `prefer` pin keeps a clip on the hop that served); `services/voice_clip.py`: the clip door decodes + passes + transcribes per chunk (no speech ⇒ "" with no ASR call; 422/413/422; `?from_ms=`; `X-Voice-Served-By`/`X-Voice-Degraded`); a `"clip"` trail mode + capture under debug (a dictation fallback joins its trail as leg 0 only if that trail exists); **the multipart CSRF gate: `/api/voice/stt` requires `X-Requested-With: ctrl-b`** (`api/csrf.py`, FE `postForm`). |

**The DEV config move (main seat, after the S9 merge — not in git):** backup `~/.ctrl-b-dev/backups/config.yaml.20261007T172506Z.pre-S9`; `voice.live` pinned `provider: emma-speaches` + `model: istupakov/parakeet-tdt-0.6b-v3-onnx` (the relay stays on Speaches' realtime WS until S7b); `voice.stt` → `parakeet-clip` / `parakeet-tdt-0.6b-v3`, fallback `vault-speaches`; the two providers added. **Verified:** a header-less POST ⇒ 403; the S6-i fixture WAV ⇒ 200, `X-Voice-Served-By: parakeet-clip`, the right text; before the move the same clip through Speaches ⇒ 200 (the re-encoded WAV request is accepted by Speaches too). **On the phone (dev): push-to-talk and the whole-clip dictation fallback now run on parakeet; streaming dictation + calls are still Speaches.**

### Cut off by the usage limit (nothing half-applied — verified)
- **The S9 bake-off lane** (`brief-bakeoff-S9.md`) died after synthesizing a few WAVs into `~/.cache/tmp/ctrlb-session64/bakeoff/` (`k_es.wav` = 107 bytes, broken — delete it). No table was written, ASR_PLAN §6.4.1 does not exist, no release binary left running on :9019 (checked). **Relaunch the brief as-is.**
- **The S7a pre-flight audit** died before writing anything. **Relaunch `brief-audit-S7a.md` as-is** (saved at close).

### ▶▶ NEXT SESSION (in order)
1. Read this block → `~/.cache/tmp/ctrlb-session64/RULINGS.md` (every ruling + why, incl. the S6-i H1–H13, S6-ii H1–H14, S9 H1–H11 and all review rulings) → `SESSION_PLAN.md` (the lane table). Memory: `session64-session-b-s6i-2026-10-07`.
2. **Relaunch the two cut lanes in parallel:** the bake-off (`brief-bakeoff-S9.md` — synthesized audio only; it appends ASR_PLAN §6.4.1 and decides H8 source-vs-release) and the S7a audit (`brief-audit-S7a.md`).
3. **S7a — the client half** (inert until `ready{clock:"leg"}`): rule the audit's §H → build brief → lane in a worktree → Opus ∥ Emma → merge. Buildable while the owner records.
4. **THE CRITICAL PATH IS THE OWNER'S AUDIO:** capture rounds on dev (debug is ON) → `asr_corpus.py promote … --owner-only` → **TUNE** (`vad_replay.py` sweeps incl. `--prepass-sweep` and `--asr CONFIG` on `parakeet-clip`; the owner's hand judgement; settle `VadParams` + each model's `prepass_act`) → **the S9 gate** (§6.4: the pre-pass sweep row, the hand-read row, the English/Spanish language rows) → **S7b THE FLIP** → field rounds → S8 → S8b → S10.
5. **v1.7.12 = session B** — and per the owner it **WAITS for J3 + J4** (designed + built before the prod update) unless the owner re-rules at release time. Prod steps = the runbook "The ASR engines" + ASR_PLAN §8.2.2.
6. Parallel seat (owner's choice): J1 · J2 · J3 · J4 design sessions, each from its own plan stub.

### ▶▶ THE OWNER'S CARD (dev, https://emma.lobster-vector.ts.net — close + reopen the PWA once)
- **Record reference audio** — calls and dictations at home and in the car, English AND Spanish, with real pauses; some push-to-talk clips short and long (every clip is now captured too). Captures land beside their trails under `~/.ctrl-b-dev/calls/`. Then promote: `python tools/asr_corpus.py --help` (needs `--home` or `CTRLB_HOME`, refuses a git tree, needs `--owner-only`).
- Push-to-talk → text arrives (now parakeet). A dictation (streaming = Speaches; if it falls back to the whole clip, that part is parakeet).
- Type `{{random:a,b}}` or `{{time}}` in Persona · SOUL.md / Scenario / Example dialogue (row AND fullscreen editor), in a head-position lorebook entry, in a persona About → one amber line about the prompt cache.
- Conf › Live call › "Call debug readout" carries a privacy line.

### Standing facts / gotchas (verified this session)
- **emma's swap is full (8.1 / 8.2 GiB) because of SPEACHES:** its uvicorn (PID 10620 at close) holds **4.4 GB in swap + 3.8 GB resident** (systemd: peak 7.6 GB). RAM available ≈ 17.8 GB, so nothing is starved; it is a slow leak/growth in Speaches. R18: this phase never stops Speaches. A `systemctl --user restart speaches` would release it but **interrupts any live call on dev AND prod** (both still use it) — the owner's call; after S7b + v1.7.12 Speaches is only the rollback path.
- **Never run `tools/check.py` and `npm run build` at the same time** — the build empties `frontend/dist` and ~10 backend tests that mount the SPA fail (seen once; re-run green).
- Worktree commits: the pre-commit hook needs `backend/.venv` + `frontend/node_modules` SYMLINKED in — stage first (`git add -A` with the links absent), then link, commit, `rm` the links (gitignore matches dirs, not symlinks). pytest in a worktree needs `PYTHONPATH=<worktree>/backend`. `pip install -e` from a worktree re-points the main venv — re-run it from `~/github/ctrl-b/backend` after.
- Emma's lane: `~/.cache/tmp/ctrlb-session64/run-emma-*.sh` (hermes `-z`, `gpt-5.6-luna-900k --reasoning high --ignore-rules -t file,terminal --in <worktree>`); confirmations = a fresh run with her original review pasted (`confirm-emma-*.sh`); ~10 min each. Her one HIGH on S6-i was a misread of a `>` loop — rule with the quoted line.
- Council 11 (golden vectors hand-authored before the code runs) is satisfied by a REVIEWER's independently derived vectors added verbatim.
- The Opus lanes share the account's usage limit with the main seat — two lanes died at the limit at once. Plan heavy parallel waves early in a usage window.

**The owner's rulings (the session-63 open list, taken one by one — each folded into its ISS row in [`ISSUES.md`](./ISSUES.md), 2026-10-07):**
- **The dictation check** — done (the v1.7.11 gate; trail `bec301ce`). Nothing owed.
- **ISS-12** — LOW PRIORITY: the owner does not care about frontier for now (gacha = their default theme now; older themes get revised later); eyeballed whenever.
- **ISS-28** — the editor hint CONFIRMED WANTED (the owner saved per-turn macros in the editors, no warning). A small FE leaf (`WarnRow`), off session B's files — build between slices.
- **ISS-44** — the three asks CLARIFIED (timing unchanged, after the ASR work): ① pin to the bottom · ② the send button's accent block grows with the field; the send icon pins to the bottom; mic + attach move INTO the block, stacking upward into the opened room, in the send style — ONE accent column, never empty blue · ③ lower the composer's bottom edge to just below the tab bar's top, past its corner radius.
- **ISS-45 + ISS-46** — **CORRECTED the same afternoon: NOT built now** (*"I didn't want you to start building this feature. This is a very design-driven thing."*). Two new research-first DESIGN sessions, each with a plan stub to resume from alone — **J3 prompt order** ([`PROMPT_ORDER_PLAN.md`](./PROMPT_ORDER_PLAN.md): drag and drop where each part of the prompt lands, so cache-breaking parts can sit in the tail and break only the tail) and **J4 lorebook probability + a firing cadence** ([`LOREBOOK_PROBABILITY_PLAN.md`](./LOREBOOK_PROBABILITY_PLAN.md), absorbs ISS-45/46) — ROADMAP §J. Separate from each other (*"They're both tangential issues"*), from J1/J2, and **NOT the ASR session**. The owner's rulings so far: a `constant` entry with a probability rolls = YES · a cadence knob (no back-to-back, no cache break every turn) = WANTED · a per-entry % field + export = *"I'm guessing yes"* · placement = J3's question (an input to J4, not a blocker). **Timeline (owner):** *"I want to do it before we update production after session B"* → **the v1.7.12 prod update WAITS for J3 + J4** unless the owner re-rules at release time.
- **dev's Call debug readout is ON** (the owner confirmed; `~/.ctrl-b-dev/config.yaml` `voice.live.debug: true`) — S6-ii step 0 is already satisfied.
- **ISS-59** — CLARIFIED: the agent ASKS THE QUESTION ITSELF by TTS on the call (not a cue), the chat still shows it with its options, voice OR tap resolves it the same way; non-critical questions by voice, critical ones (removing stuff, anything needing review) stay tap. A question-tool design after session B.
- **ISS-62** — FIX BOTH (never lose speech, especially long speech); designed in S8's neighbourhood.

---

## ▶▶ NEW (2026-10-07 midday, Fable seat, session 63) — THE DICTATION CHECK PASSED · the phone round READ · two look tweaks · ISS-68 the gallery flash FIXED + the consistency slice · ROADMAP H4 + J1/J2 · **NEXT = push + v1.7.11**

**Read first:** [`ISSUES.md`](./ISSUES.md) **ISS-68** (the gallery flash: cause · fix · the D2 slice · the review record) and the 2026-10-07 owner-round notes on ISS-66/47/53 · [`ROADMAP.md`](./ROADMAP.md) **H4** (gallery tiles at scale — the issue stated precisely) + **§J** (J1 the galleries' UX session · J2 the configuration de-bloat session — both owner-asked, research-first, their OWN sessions) · the v1.7.11 release card `~/.cache/tmp/ctrlb-session60/release-card-v1711-draft.md` (session 60's lane draft; this session verified its open checks — see ③). Session record: `~/.cache/tmp/ctrlb-session63/` (`brief-audit-gallery.md` → **`audit-gallery.md`** (Opus, the reproduced root cause + the §B inventory) · `brief-build-gallery-D1.md` / `lane-gallery-D1-report.md` · `brief-build-gallery-D2.md` / `lane-gallery-D2-report.md` · `frozen-gallery-D2-v1.diff` · `review-emma-gallery-prompt.txt` → `review-emma-gallery.md` (SHIP, no findings, file:line per question) · `check-all-final.log`).

### What happened (in order)
1. **The dictation check PASSED** — trail `~/.ctrl-b-dev/calls/dictation/bec301ce-35da-4793-a252-bfad1d574980.jsonl` (10:39): route `call` (dev's), 16 kHz, **419.6 s, 10 445 frames, 57 finals (53 with text, 4 empty), `drops: 0`, `credit_min_ms` 29 671** (the S2 wall-clock allowance never came near zero), **pauses of 21.4 / 37.0 / 30.2 s survived** (SP's relative idle stop never fired), ended `reason: user`, close 1000, the clip discarded (streaming delivered, so the Opus-clip fallback was not needed). Two 4–6 s starts at 10:32 (finals 0, clip uploaded) = mic checks. Speaches emits some finals without a `speech_started` — its own segmenting, cosmetic, leaves with session B. **The v1.7.11 gate is cleared.**
2. **The release card's open checks, done by the main seat:** prod's `voice.live` = `{debug, dictation, mic_hold}` only — NONE of the limit-sensitive keys (`dictation_idle_s` · `buffered_ceiling_ms` · `call_backlog_ms` · `max_session_s` · `dictation_max_s`) → nothing to clear before tagging; prod's `lorebooks/personality-traits.yaml` + `agents/` carry NO per-turn macro → ISS-28 on prod leaves the prompt cache alone (the owner has not tested the macros by choice — "I don't want to break the prompt cache for now" — they ride untested, inert without a macro in a card).
3. **The owner's phone round** (one line each): ISS-66 scroll = "exactly what I wanted" · ISS-47 clip menu works · ISS-53 Back works in the places tried · ISS-12 not reported (eyeball still owed) · ISS-28 deferred by the owner. **Two look tweaks `a0a0064`** (kit.css only): the ↓ pill is a BORDERLESS disc — the 2026-09-13 squeeze-pill ruling reused (`surface-2` fill + its shadow literal; `:active` → `surface`); the clip's attach menu is CONTENT-WIDE, `left: auto`, the shell's right gutter kept, `min-width: 164px` — the clip is trailing in all four placements (stacked `.crow` / sheet embedded / line cluster / rail tail) so one rule holds; the tools menu keeps the full span (owner: "that one is fine").
4. **ISS-68 — the owner's new report ("some agents seem to be bigger than others for a second until you scroll")** → an Opus read-only audit REPRODUCED it in headless Chromium at 360 px: `.agal-art`'s `content-visibility: auto` + `contain-intrinsic-size: 200px` makes a still-skipped (below-the-fold) card report 200 px as min-content, and the grid's bare `1fr` (= `minmax(auto, 1fr)`) widened its column (202 · 114) until a scroll unlocked it. **Fix `7b13b85`:** `repeat(2, minmax(0, 1fr))` (158 · 158 from the first frame) + the same line on `.mgal-grid` (the recipe it was copied from; 122 px tiles + sideways scroll at ~90 tiles); `content-visibility` KEPT; two e2e guards measured BEFORE any scroll, each failing on the old CSS with the owner's numbers (the agents arm stubs roleplay ON so the grid lands in the band; the media twin is 360 px-only — desktop width passed the old CSS).
5. **The consistency slice `187f56a`** (the audit's §D2, each item owner-ruled = the recommendation): M2 the Conf-hosted grid shares the cards' edge · M3 one height per row by STRETCH (`.agal-cell { display: grid }` + `.agal-card { height: 100% }`; the sibling pills stay pinned 6 px — asserted) · M4 one "default" look (`.badge.chosen` wears the pill's pressed pair via ONE shared selector; gacha's fill window lists both) · M5 one subtitle vocabulary (`lib/agentSubtitle.ts`, a leaf module — the tab imports the editor) · L3 `rosterNames()` · L1/L2/L4/L5 comment + doc truth. **Blind Emma (`gpt-5.6-luna-900k`, high) on the frozen diff: SHIP, no findings, file:line per question** (not a rubber stamp — it quoted the pill rules, the cascade, the predicate). No Opus reviewer this round (owner: Emma rather than Opus where possible; a UI slice, not a chokepoint).
6. **ROADMAP:** **H4** = the two things that WOULD grow with many cards, stated precisely (avatar weight — tiles load the stored image, no thumbnail variant; findability — no search/filter/sort; NOT virtualization, which the owner asked about and which is not the problem) · **§J** = the two owner-asked DEDICATED sessions: **J1** the galleries' UI/UX refinement (agent gallery + image galleries + the dense editors; research-first; H4 lands inside it) · **J2** configuration de-bloat + knob-scope revision (the owner's example: a theme "background" selector vs gacha's theme-art "backdrop" — two knobs that cannot be used at once; outcomes merge → gate → rename + explain; no legacy seams on any shape change).

7. **The pre-release sweep (owner: "anything else to fix before updating"):** every other open row is owner-deferred (ISS-44/45/46/59/62/63/64/65 — after the ASR work) or a recorded residual/watch; the two small pre-existing ISS-49-round items were built: **ISS-52 `21e6b83`** — `_load_agent_folder` admits only `valid_skill_slug(name)` (the one boundary every resolver path crosses; `..`/`/etc` no longer load as agents; test) · **ISS-51 `9a2b649`** (owner ruled the recommended shape) — `resolve_agent` walks the pick → the configured default → the root, so the server agrees with the client's `effectiveAgent` fold (test) — **then the owner's second ruling the same hour ("unintuitive that the agent changes just because of a typo" → a no-op + a toast): `64eaeee` — a typed `/agent typo` pins NOTHING and only toasts `No agent named "typo"` (judged once the roster has landed; the server's one-rung fallback stays for since-deleted agents in old threads).** Backend 3,059 → 3,061.

8. **PUSH + RELEASE v1.7.11 (the owner's word, ~10:15Z):** `git push` main `778b960..bad0c99` (the pre-push gate green) → CI `37606193644` success → the local `tools/check.py --e2e` (7/7 incl. Playwright 164 s) → tag `v1.7.11` @ `bad0c99` (annotated; the tag push ran the gate again) → release gate `37607523443` success → `bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.11` exit 0 (DB snapshot `~/.ctrl-b/backups/ctrlb-20261007-124010.db.gz`; config 5, "migration: not needed") → verify: `describe` = v1.7.11 · health 1.7.11 · icon-192 `image/png` · unit active · journal 0 errors · HTTPS 200 — **LIVE 10:40Z.** Logs: `~/.cache/tmp/ctrlb-session63/{ci-main,e2e-release,tag-push,ci-tag,update-v1711}.log`.

### ▶▶ THE OWNER'S PROD CARD (https://emma.lobster-vector.ts.net — close + reopen the PWA once; "Review app update" may show)
- A dictation (hold the mic, speak, pause 30 s, speak, stop) → one draft, nothing lost; a call (media route) → the turn hold + the chirp as on dev.
- The chat: scroll up while a reply streams → it stays; the ↓ disc (no outline) brings you back; a send re-sticks.
- The clip → the photos / files menu, content-wide at the clip's edge; a photo stages + sends.
- Back closes a prompt editor / an agent detail / a gallery image.
- The agents gallery: every card the same width from the first paint; rows level; "default" looks the same on the card and in the editor header; the editor subtitle no longer says "specialist ·".
- `/agent typo` → a red toast "No agent named …", nothing else changes; `/agent lynette` still switches.
- Under frontier: the modal footer Save is the accent-filled primary (ISS-12 — the one eyeball still owed).

### Final state (2026-10-07 ~12:45Z)
- **Full gate `tools/check.py` GREEN at `64eaeee`** (ruff · format · pyright · pytest 3,061 · frontend check-all incl. vitest 4,623/214 · prettier) — log `~/.cache/tmp/ctrlb-session63/check-all-final4.log` (earlier greens at `187f56a`, `21e6b83`, `9a2b649`). Dev dist rebuilt + `ctrl-b-dashboard-dev` restarted (the two look tweaks + ISS-68 D1 + D2 + the `/agent typo` no-op are on the phone — close + reopen the PWA once). Tree clean; no worktrees. **Everything PUSHED (main = `origin/main`, tag `v1.7.11` on origin).**

### ▶▶ NEXT SESSION (in order)
1. ~~Push + v1.7.11~~ **DONE — LIVE 10:40Z** (item 8). The owner's prod card above is the only thing left of it.
2. **SESSION B (ASR_PLAN §7.2) — IN A CLEAN SESSION (the owner, 2026-10-07: "before session B, I would like to start in a clean session").** Read ASR_PLAN §0 → §7.2 (the B ladder: the engine → capture → the host on the clip door → hand tuning → THE FLIP → recovery + reload survival; two reviewer rounds per slice) → §4 (every key; no migration) → §8.2.2/§8.3 (v1.7.12 release + rollback order) → §3.10 (the stress-test amendments). Session A's record = sessions 54–60 in this file + `~/.cache/tmp/ctrlb-session5x/`. The owner's timeline: **the ASR plan FINISHED this week.** The owner's parallel Fable seat may be designing J1/J2 at the same time (item 4) — two sessions, one tree: commit by path.
3. **The D85 wave** (ASR_PLAN §7.3; v1.7.13).
4. **J1 / J2 — the owner RESUMES THESE IN PARALLEL (2026-10-07: a second Fable seat in the `ctrl-b-opus` tmux unit) while this seat finishes the ASR release.** Each has its OWN plan stub, written to be resumed from alone: [`GALLERY_UX_PLAN.md`](./GALLERY_UX_PLAN.md) (J1) · [`CONFIG_DEBLOAT_PLAN.md`](./CONFIG_DEBLOAT_PLAN.md) (J2). The owner's timeline: **the ASR plan FINISHED this week; J1 + J2 DESIGNED + PLANNED for later implementation.** Two sessions on one tree → the §8 working rules in each plan (commit by path, worktrees, one scratch dir each); the ASR seat owns `voice_live.py` / the voice adapter / `useDictation` / `pcmCapture` / ASR_PLAN; J2 does not touch `backend/app/config.py` until session B's `voice.live` keys have merged.
5. Small open FE items, no ruling needed: the ISS-28 per-turn-macro editor hint (`WarnRow`) · ISS-12's device eyeball.

### Standing facts from this session (verified)
- A dictation trail is read in one pass: client `rec`/`end` lines (route, rate, `finals`, `clip`, `reason`), the relay `leg_end` line (`duration_s`, `finals`, `drops`, `credit_min_ms`), and the `speech_started`→`transcript` gaps for the pauses. Speaches finals without a `speech_started` are its own segmenting, not a loss.
- `1fr` is `minmax(auto, 1fr)`: any grid holding `content-visibility`/`contain-intrinsic-size` items must use `minmax(0, 1fr)` or the skipped item's intrinsic size widens the track. Both kit grids now do; the two e2e arms pin it.
- A `display: grid` cell with absolutely positioned siblings keeps them where they were (out of flow; the cell stays the containing block) — measured, not reasoned.
- Emma's `-z` review lane is still `gpt-5.6-luna-900k --reasoning high --ignore-rules -t file,terminal` (the session-62 script verbatim); a ~10-minute run with file:line per question is a real review.

## ▶▶ NEW (2026-10-06 evening, Fable seat, session 61) — F2/ON4 RULED · R101 + R102 BOUGHT · ISS-66 BUILT (on dev) · **D85 DESIGNED + COUNCIL-CLOSED** · NEXT = the dictation check → v1.7.11

**Read first:** [`ASR_PLAN.md`](./ASR_PLAN.md) **§3.12** (D85 as ruled: the stage · the models · enrolment · the route key · the client half · known limits), §7.3 (the D85-S1…S4 + D85-TUNE ladder, AFTER session B; v1.7.13) · [`DECISIONS.md`](./DECISIONS.md) **D85** · [`ISSUES.md`](./ISSUES.md) ISS-65 (the music call + the learner-poisoning loop), ISS-66 (✓ as built), ISS-67 (`read_attachment` reached for a Core-Memory topic — prompt-side fix, OPEN) · [R101](./research/R101-speech-vs-background-discrimination.md) · [R102](./research/R102-stick-to-bottom-scroll.md) · SECURITY_MODEL §2.13 (ruled, not built). Session record: `~/.cache/tmp/ctrlb-session61/` (`design-D85-v1…v2.5.md` · **`RULINGS-D85.md` = every finding of every round with its ruling** · `council{,2,3,4,5}-D85-{opus,emma}.md` · `RULINGS-ISS66.md` · `frozen-ISS66-v1…v4.diff` + interdiffs · `review-code-ISS66-*` · `confirm*-code-ISS66-*` · `audit-scroll.md` · `brief-*.md` · `lane-*-report.md`).

### What happened (in order)
1. **Phase 27 F2 + ON4 ruled by the owner** (F2 = reading A: a responder runs on the HOME agent's model/privilege — all three reviewers recommended B, overruled; ON4 = (a): BOTH overrides persist per device — an elevation survives a reload, uncapped, SECURITY_MODEL §2.2) → folded `d776e11` (CONVERSATIONS_PLAN v2.5; D84 has no open rulings).
2. **The owner's MUSIC call** (trail `~/.ctrl-b-dev/calls/71fbe4ff…`): music with vocals 3–10 dB under the owner passed the level gate (margin 10) AND poisoned `learnVoice` (an EMA over every taken final: V −9.5 → −18, floor −20 → −28 — a taken fake lowers the bar for the next); the 5 s turn hold never expired (24 finals = one lyric message). → **ISS-65**. The character's 75 s silence = `read_attachment` called with a Core-Memory topic name → **ISS-67**. The owner's scroll complaint → **ISS-66**.
3. **R101** (Opus lane, a MEASURED bake-off on emma's CPU): Silero barely fires on music — Chrome's NS in front of it does (it strips the backing track); CED-tiny P(Speech) ≥ 0.3 = 3 % music leak / 99–100 % speech kept, 7 ms; CAM++ speaker verification 25–35 ms, EER 0.5–1.8 % (clean), music max cos 0.38; the two limits = owner-over-equal-TV and channel mismatch (enrol per route); chars-per-voiced-ms WITHDRAWN (lyrics inside the owner's band); the peer class only separates speech from silence (Willow gates on voice). **R102** (Opus lane): our 140 px position band vs the field's direction latch (SillyTavern #4382, LibreChat, use-stick-to-bottom).
4. **ISS-66 BUILT `a22ba68`** — `lib/stickToBottom.ts` (one pure latch: own writes marked, ends-on-bottom never escapes, direction = the change in distance to the bottom, 4 px escape / 150 px attach, a refused pin forgets the baseline only when the distance SHRANK), ChatThread + CallOverlay consumers, a kit ↓ pill, a send re-sticks (the rows appended since the last render — an idle send appends `[user, placeholder]`), a nested-scroller wheel guard. Round 1 blind Opus ∥ Emma (both SHIP WITH FIXES; the same send bug) → fix wave → confirms: Emma SHIP, **Opus NOT CONFIRMED twice on real latch defects** (N1 a stale baseline after the keyboard closes; R2-1 null-on-every-refused-pin made the band inert during a fast stream) — each reproduced + fixed with a failing-then-passing test → both CONFIRMED SHIP on v4. **Dev dist rebuilt + `ctrl-b-dashboard-dev` restarted 19:2x** (close + reopen the PWA). Residuals in ISSUES.
5. **D85 designed by the main seat** (`design-D85-v1.md`, 120 lines) on the owner's four rulings (both discriminators · the template stored · enrolment per route · the learner only from accepted) → **council round 1** (Opus 3 HIGH / 9 MED / 5 LOW · Emma 2 HIGH / 10 MED / 2 LOW — the HIGHs: a reject needs an ordinary empty final (D9's `settle`), the route key still conflated the phone and the headset (both read back `default`), `POST` raw-body = a CORS-safelisted write → `PUT`) → ALL ruled + folded (v2/v2.1) → **round 2** (Opus CONFIRMED WITH NOTES, incl. a HIGH: the 3-in-a-row "switch it off" note fired when the filter WORKED → near misses only · Emma NOT CONFIRMED ×3: the media ladder opens a candidate, F5's claim, the circular gate) → ruled + folded (v2.2) → **round 3** (Opus: readback-first, no `unknown` sentinel, a far reject resets the run · Emma: 3/3 resolved + 2 new) → v2.3 → **round 4** (Emma: the opened-candidate fallback is unproven under `ideal` → DELETED; readback decisive; explicit request + `default` readback = the `null` path) → v2.4 → **round 5** (both CONFIRMED WITH NOTES: the readback-echo question is UNVERIFIED → D85-S1's four-arm trail measures it FIRST; the `exact` proof rung is the named exit) → **v2.5 = the design of record, folded into the repo `23169d5`**.
6. **Docs:** ASR_PLAN §3.12 + the seven §4 keys (`speech_model` · `speaker_model` · `speech_gate` · `speech_act` 0.3 PROVISIONAL · `owner_gate` · `owner_threshold` 0.42 floor · `gate_min_ms` 1000 voiced; no migration) + T14 `gate` + the §6.3 broadcast-negatives amendment + §7.3 + §8 (v1.7.13) + R26 + the §11 council record; D85 in DECISIONS; TODO Phase 26 D85 rows; ISSUES pointers; SECURITY_MODEL §2.13 (a biometric identifier never audio; ruled, not built).

### ▶▶ NEXT SESSION (in order)
1. **The owner's dictation check** (5–10 min, 30 s pauses, dev; trail `~/.ctrl-b-dev/calls/dictation/`) — STILL OWED; the v1.7.11 gate. Plus the ISS-66 phone card (HANDOFF of session 61's summary: drag up while streaming / scroll back / fling / send while scrolled up / keyboard close then drag).
2. **Push + v1.7.11** from `~/.cache/tmp/ctrlb-session60/release-card-v1711-draft.md` (ISS-66 + the docs ride it; verify prod stores no limit-sensitive key) → ASR_PLAN §8.2.1 → `deploy/linux/README.md` §Release.
3. **Session B** (ASR_PLAN §7.2 — the engine, capture, the host, hand tuning, THE FLIP, recovery; two reviewer rounds per slice) — the owner's order (2026-10-06 close): "finish anything gating the dictation check, push, then session B". ISS-67 is a one-line registry edit that may ride any slice; ISS-59's design (the spoken cue + voice answers) and ISS-62 come AFTER B.
4. **The D85 wave** (§7.3; v1.7.13; D85-S1 FIRST = the four-arm route-key trail, which decides rule (2) before D85-S2).

### Standing facts from this session (verified)
- A hermes `-z` review reads its inputs at its own pace: an edit to the frozen artifact seconds after launch can be missed (Emma's round-3 "misplaced" finding was a §9→§5 move racing her read) — freeze, then launch, then never touch.
- Two lanes sharing a `clones/` dir collided (R101 lost a run to R102's cleanup): one subdir per lane.
- The pre-deploy hook fires on any `nohup … &` Bash line — noise, not a signal.
- Opus as a code reviewer refused to confirm twice on ISS-66 with REPRODUCED defects a confirm-by-reading would have passed — keep the confirm rounds adversarial ("re-run your model against v<n>").

## ▶▶ NEW (2026-10-06 evening, Fable seat in the `ctrl-b-opus` unit, **session 62 — the PARALLEL non-ASR session**) — ISS-37 · ISS-12 · ISS-67 · ISS-47 (all of it) · ISS-53 · ISS-28 ALL BUILT, TWO-REVIEWER-CLOSED, COMMITTED · NEXT = the owner's phone card (ISS-12 look · ISS-47 clip · ISS-53 Back · ISS-28 macros) — nothing of this session is left open except one FE hint follow-up

**Two sessions ran on this tree at once:** session 61 (the ASR / Phase 26 / D85 work — its blocks above and `ASR_PLAN.md` are THEIRS, untouched here) and this one, which took the backlog items independent of the voice subsystem. Everything below is commit-by-path on `main`; the record is `~/.cache/tmp/ctrlb-session62/` (`COMMON.md` + `brief-ISS{67,47,28,53}.md` = the audit briefs · `audit-ISS{67,47,28,53}.md` = the four Opus audits, file:line · `brief-build-ISS47-A.md` / `brief-build-ISS47-B.md` / **`brief-build-ISS28.md` = READY build briefs** · `frozen-*.diff` · `review-ISS47-A-opus.md` (SHIP) · `review-emma-prompt.txt` → `review-emma.md` = the Emma round on all three slices · `lane-*-report.md`). The owner's directive mid-session: usage is tight while the ASR session runs — **write every ruling, option and open question into the ISSUES rows so any later session resumes from the row alone; build only when there is room; review with Emma (OpenAI usage) rather than Opus where possible.**

### Built + committed (each row in `ISSUES.md` carries the as-built)
1. **ISS-12 `1db27a5`** — frontier's border-off sweep excludes the modal-footer `.save`; the kit's `--accent-fill` (frontier's own gradient) stands. Owner ruled "fix it, consistent with the theme" — **device eyeball owed** (dev dist NOT rebuilt by this session; it rides the next rebuild).
2. **ISS-37 `badc9d9`** — owner ruled NO bleed: `Settings.agent_from` drops `greeting` + `alt_greetings` from the defaults a specialist merges under (beside `greeting_enabled`/`title`). Built in a worktree, one dev-backend restart at the merge.
3. **ISS-67 `8b4f358`** — the audit overturned the "prompt-side" premise: the character (`tools: [web_search]`) had NO `core_memory` tool, yet `_core_index_block` injected the 51-topic index (it gated on "a corpus is wired", not on `_longterm_available()`, the chokepoint every other memory surface asks). One gate; no prompt text changed. Record corrected: local `qwen3.6-max`, and the 75 s was mostly the first model call (72.9 s), the misfire ≈ 4.5 s. Owner ruled: characters keep their authored tools ("no reason to show tools they cannot use").
4. **ISS-47 ⓓ + ⓔ-text/PDF `65ea4d8`** — a size-0 non-image attachment uploads (XHR by path; the server's 422/413/415 decide; images keep the in-page refusal); `putBytes` rejects a size-0 `File`'s `onerror`/`ontimeout` as `PickedFileUnsentError` (TypeError subclass, the file-manager hint) → `uploadRefusal` + the import toasts; the empty-file sentence names who reported it. Blind Opus round: SHIP. ATTACHMENTS_PLAN §7 rider.
5. Docs: `c0e2028` (the rulings) · the merge `a3143ee` (ISS-65's D85 pointer kept beside the timing correction) · **R103** = the ST/CCv3 macro-semantics dossier (`docs/research/`, indexed).

6. **ISS-47 ⓔ-images `227448f`** — the clip opens a photos / files menu (owner-ruled; desktop the same); image-only MIME accept → Chrome's own picker; `AttachMenu` = the 4th `composerOverlay` occupant on the tools menu's shell. Emma: SHIP WITH FIXES, the focus MED overruled (matches the tools menu; an outside tap must not steal focus). Emma's three earlier verdicts (ISS-37/67/47-A): SHIP ×3 with file:line evidence (`review-emma.md`).
7. **ISS-53** (the last commit of the session — see `git log`; Emma: DO NOT SHIP on two MEDs → her confirm round WITHDREW MED-1 (no touch flow reaches the sub-frame double-request) and GROUNDED MED-2 as a two-Back edge case through a notification tap over a confirm-over-detail — ruled a RECORDED residual of the hook's documented non-top class; both in the ISS-53 row) — Back closes the five full-screen surfaces (prompt editor · agent detail · automation sheet (dirty → asks, via the new optional `onBack` veto) · gacha showcase · gallery item → "All images"); the D81 Delete door's one-task race closed by the outcome-ref idiom; e2e `back-gesture.spec.ts` (3 scenarios; CI runs them, this session did not). MEDIA_MANAGER_PLAN §6.2 = the pattern's home.

### ▶▶ THE OWNER'S PHONE CARD (dev `https://emma.lobster-vector.ts.net:8443` — dist REBUILT + `ctrl-b-dashboard-dev` restarted at the end of session 62 with ISS-12/47/53 in it; close + reopen the PWA once)
- **ISS-12** under frontier: the machine editor / agent form footer Save reads as the accent-filled primary, Cancel stays a chip.
- **ISS-47**: the clip opens photos / files · photos = Chrome's grid, multi-select, a picked photo stages + sends · files + an empty-reported `.txt` from Downloads stages · a camera-tile capture keeps its extension (else "wrong kind") · the menu never overlaps the tools menu / plan sheet in the three layouts · desktop shows the same menu.
- **ISS-53**: edit a prompt → Back closes it · open an agent from the gallery → Back returns to the grid · edit a message → Delete → Back cancels the confirm, the app stays · a DIRTY automation sheet: Back → Cancel → Back again must ASK again (if the second Back leaves the app, Chrome marked the re-pushed entry skippable — the recorded UNVERIFIED) · open a gallery image → Back = "All images"; ✕ = the gallery closes.

8. **ISS-28 `a711cee` (merge `16072ee`)** — the SillyTavern/CCv3 feature macros render (D2: a per-turn macro context on `Macros` — salt + clock once per session; `random`/`roll` re-roll per turn, `pick` thread-stable, the greeting once at seed; clock = the server zone; malformed stays literal; one `SUPPORTED` table; the importers' PER_TURN warning line — the owner's "warn wherever one appears"). Blind Opus (3 LOW) ∥ Emma (1 MED: `/compact` never bound the context) → wave 1 → BOTH CONFIRMED SHIP by re-running probes. Research = R103. Backend 3,059 green. **Still open from it (FE, small):** the per-turn hint on the agent form + lorebook entry editor (the `WarnRow` precedent) — the import-report line exists, the editor hint does not.

### ▶▶ ADD TO THE PHONE CARD — ISS-28 (dev, any roleplay thread)
- A lorebook entry or SOUL line with `{{random:a,b,c}}` → one item per turn, the SAME item across a reply's loop iterations; a regenerate may pick another. `{{pick:a,b}}` → the same item every turn of that thread. `{{time}}` reads emma's clock (`3:05 PM` form), `{{date}}` → `October 7, 2026`, `{{weekday}}`, `{{idle_duration}}` → "a few seconds"/"5 minutes"/"2 hours" since your previous message. `{{//}} … {{///}}` disappears whole. Import a card/book with `{{random}}` in a head field → the report shows the per-turn count line.

### Final state (2026-10-07 ~01:00)
- **Full gate `tools/check.py` GREEN on `16072ee`** (ruff · format · pyright · pytest 3,059 · frontend check-all incl. vitest 4,622/214 · prettier) — log `~/.cache/tmp/ctrlb-session62/check-all-final.log`. Dev dist rebuilt + `ctrl-b-dashboard-dev` restarted twice (the ISS-37/67 merge, the ISS-28 merge). Tree clean; no worktrees left. ~65 commits over `origin/main` across both sessions, all UNPUSHED — push on the owner's word.
- **Owner to-do (next session):** ① the phone card above (ISS-12 · ISS-47 · ISS-53 · ISS-28), one line per item; ② say "push" if the ASR session's dictation check has also passed; ③ the one open FE follow-up (the per-turn-macro editor hint) is a small slice whenever wanted — no ruling needed.

### Standing facts from this session (verified)
- Two sessions, one tree: commit BY PATH; check `git status` before committing a shared doc; iterate backend edits in a worktree (`git worktree add ~/.cache/tmp/ctrlb-wt<N> -b <branch> main`; `python -m pytest` from its `backend/` imports the worktree's `app` — verified) so `--reload` restarts once at the merge; ISSUES.md row conflicts resolve by keeping both edits.
- The Emma lane: `pgrep -af hermes_cli.main` also matches your own `bash -c` wrappers — filter them; the real run is the `-z` python PID.
- 50+ commits UNPUSHED (both sessions); push on the owner's word.

## ▶▶ NEW (2026-10-06, Fable seat, session 60) — THE OWNER'S THREE CALLS READ · ISS-58…63 · D8 + ISS-61 + D5 BUILT, TWO-REVIEWER-CLOSED, COMMITTED · **SESSION A's CODE IS COMPLETE** · NEXT = the dictation check → push → v1.7.11, then the AGC knob

**Read first:** [`ISSUES.md`](./ISSUES.md) ISS-58 → ISS-63 (each with its trail path and the owner's rulings) · [`ASR_PLAN.md`](./ASR_PLAN.md) §3.9 ② (D8 **as built — the premise was wrong**, the −60 is floor+10 clamped until a level is LEARNED; the seed is the two BORROW tiers, lifetime L2) and §3.9 ④ (D5 as built) · §3.5 ⑤ and LIVE_VOICE_PLAN §4.3 (ISS-61: **every exit harvests**). Session record: `~/.cache/tmp/ctrlb-session60/` — **the `*-asr.md` files** (`SESSION_PLAN-asr.md` · `RULINGS-asr.md` = every finding of every round with its ruling · `audit-D8/D5/AGC.md` · `brief-D8/D5/ISS61.md` · `lane-*-report.md` · `frozen-*.diff` + interdiffs · `review-code-*-{opus,emma}.md` · `confirm-code-*` · **`release-card-v1711-draft.md`** · `lane-counts-release-report.md`); the dir is SHARED with the Phase 27 design session (`SESSION_PLAN.md`/`RULINGS.md` are THEIRS).

### What happened (in order)
1. **Call 1 (media → call → media, trail `fcd5b115`):** the flip (ISS-54) PASSED (mic 5.9 s after the switch, chirp lag 355 ms), the turn hold PASSED (7 finals → one message), the EC-call arm PASSED. On the call leg TWO finals the owner never said went out as one turn — NOT echo (the mouth was closed 230–280 s); ~9 s of sound 6–8 dB under the owner's peaks, decoded into English. The one route difference: Chrome's comm-mode **AGC** (`agc: true` on call, false on media). The "whistle between replies" = the DROP CUE refusing three near-silence hallucinations (the chirp played exactly once per capture). → **ISS-58** (corpus evidence; no detector on the Speaches ear, R24).
2. **Call 2 (direct call route, trail `01d04bcf`):** the character read test chatter as a task, web-searched, then called a question tool → `awaiting_confirm` → `confirmHold` → by the ratified design every utterance QUEUED (13 over 5 min) until a TAP the owner, on headphones, never saw; the exit DISCARDED the 13 lines. → **ISS-59** (owner RULED: ① a SPOKEN cue riding the EXISTING mouth path — "it could listen to itself — design that part thoughtfully"; ② a non-gating question is answered by the next utterance; the privilege gate stays tap-only; design after A's tail) and **ISS-61** (owner RULED: ALWAYS harvest on ANY exit — **built `634debc`**).
3. **Owner ruling on the plan:** "no blocker — continue the build, I test meanwhile." Two checks gate v1.7.11 → prod: the 5–10 min dictation (**STILL OWED**) and a direct Bluetooth call-route start (**DONE, PASSES** — call 3).
4. **D8 `dab7e30`** — the audit lane proved the spec's premise wrong (the −60 held until a level was LEARNED; "until settled" would have changed 0 of 8 clamped finals; the exact-key seed already existed) → RE-SCOPED to the two borrow tiers (`borrowVoiceLevel` in `store/voiceLevels.ts`, write-order recency by re-append; `SEED_MARGINS = 2` + `FloorInputs.voiceSeed` + `seedBinds` in `levelGate.ts`; four wiring touch points; `voiceSeed` on `capture`, `seed:"mode"|"last"` on a binding `final`). Blind Opus ∥ Emma → the SAME two LOWs → fixed → Opus CONFIRMED (+ a test constant: reset −45 / stale −50 / carried −40); Emma's criterion-3 objection = the main seat's own ISSUES hunks (overruled).
5. **ISS-61 `634debc`** — the exit arm's predicate is `s.pending.length` (hang-up / hidden / unmounted all harvest; never twice); 4 assertions flipped; Opus single review → one doc fix; **ISS-62** recorded (MED: speech whose transcript has not arrived at exit is lost — design later).
6. **Call 3 (direct Bluetooth start in a TV room, trail `f9cd51a1`):** the call SURVIVED (the ISS-54 watchdog never fired); the chirp NOT found on the headset (`none: true` ⇒ fixed holds). **UNUSABLE for the owner:** the owner's English finals peaked −4.5…−9.6 dB and the Spanish TV's −4.8…−9.6 dB — the SAME band under AGC — 14 of 30 finals were the TV. **A level gate cannot separate what AGC has equalised** → **ISS-63** → the proposal `voice.live.call_agc` (bool, default true; one line at the `micConstraints` chokepoint + a Conf row) — owner: "if it's needed" — **the audit then showed it is NOT needed and would not work (R83: Chrome's Android AGC is a fixed +6 dB); see NEXT SESSION ①**. ⚠ Three mid-call `socketLost` (1012) in that trail were the DEV backend's `--reload` restarting under the D5 lane's edits — **the dev backend serves the WORKSPACE with hot reload: a backend lane's edits restart it under the owner's tests; say so before any dev test while a backend lane edits.** (The reconnect ladder rode them out in ~2 s each; after each reconnect the gate took two finals UNMEASURED — a small item inside ISS-63.)
7. **D5 `8764c72`** — holder table keyed by `client_id` (one UUID per tab, sessionStorage, added at the socket helper); admission AFTER `start`; a same-id holder superseded at any cap through its OWN teardown (Event + 4th `_pump` waiter + pre-`ready` check; no native `Task.cancel`); another client / id-less `start` ⇒ today's byte-identical busy + 1013; one release (the route's `finally`); the id never logged; a busy refusal logs a leg-end line. Call: `superseded` = terminal + neutral note, no redial; marker + ladder kept as compat. Dictation: a TAB-WIDE latch in `store/micRelease.ts` (`holdLeg`/`legClosing`) — `start()` refuses while a leg closes, `releaseMic` waits even across a composer remount; `acquire` re-checks `alive()` the moment the wait ends. Opus ∥ Emma → converged (MED: the per-instance latch) → 4 fixes → BOTH CONFIRMED. SECURITY_MODEL §2.10 carries the full pre-admission bound (`start_timeout_s` + `close_timeout`). **ISS-60** = the pre-existing completion-over-new-recording ordering.
8. **Counts sweep** (one refresh at the end of A, `8764c72`): pytest 3,000 · vitest 4,550/213 · eslint backlog 110 (QUALITY.md). **Dev dist REBUILT + units restarted 16:1x** (D8 + ISS-61 + D5 on the phone; close + reopen the PWA once). The Phase 27 design session committed its docs on top (`b5ed9f2`, docs only).

### ▶▶ NEXT SESSION (in order)
1. **NOT the AGC knob — the audit (`audit-AGC.md`, Opus, read against R83's Chromium-verified facts) KILLED it:** Chrome's Android `autoGainControl` is a FIXED +6 dB, not adaptive, so turning it off lowers the owner and the TV alike and the gap stays zero; the `agc: true` on the call route is Chrome tying AGC to echo cancellation (R78 §3.4), not the cause. The ISS-63 trail (noise −59…−82 dBFS, TV peaks −5…−9 = the owner's) points at the **Bluetooth headset's OWN processing** (noise reduction + adaptive gain) or the phone's call-mode audio chip — nothing a browser constraint reaches. **Do instead (no code): a discriminator call** — same TV room, call route, the in-call picker on the PHONE's mic (Speakerphone or earpiece); compare owner vs TV `peakDb` against the headset trail. If the phone mic separates them, the headset is the equaliser (then the answer is a different headset / its app's NR setting, not ctrl-b). ISS-58's own lever exists today: `voice_margin_db` 10 → ~5 in Conf drops its 6–8 dB-under fakes. **ISS-64** (new): on the call route the voice-level key is the LABEL `Default|ec=all`, so the phone mic and the headset share ONE learned level — the ISS-58 phone-mic level very likely seeded the headset call; a device-distinguishing key is a small D8-adjacent slice. If the owner still wants the knob as an on-device check of R83, the audit's §7 brief stands (flat `call_agc` bool · route-gated in `micConstraints` · must also fix `pcmCapture.ts:224`'s route-only request rebuild · latched like `turn_hold_ms` · the voice key gains `|agc=off` only when it differs from the EC default).
2. **The owner's dictation check** (5–10 min, 30 s pauses, dev) — the v1.7.11 gate. Read the dictation trail (`~/.ctrl-b-dev/calls/dictation/`).
3. **Release v1.7.11** from `release-card-v1711-draft.md` (lane-drafted; verify its "no migration" + rollback claims yourself; NOTE it could not read `~/.ctrl-b/config.yaml` — check prod stores no limit-sensitive key before tagging): push on the owner's word → ASR_PLAN §8.2.1 → `deploy/linux/README.md` §Release.
4. Then ISS-59's design (the spoken cue + voice answers) and ISS-62, before session B.

### Standing facts from this session (verified)
- Emma reviews: a hermes `-z` run that returns in ~2 min with no `file:line` is a RUBBER STAMP — relaunch with the evidence-per-question prompt shape (`review-code-D8-emma-prompt2.txt`); keep the pgrep wait loop in a `.sh` file (a `bash -c` loop matches itself); confirm prompts must restate the ISSUES/HANDOFF exclusion or Emma counts the main seat's hunks against criterion "nothing else changed".
- Two sessions on one tree: commit BY PATH (`git add -- <paths>`); `git add -N` only your own untracked files; namespace scratch files when a dir is shared.
- `python` is not on PATH — the gate is `TMPDIR=/home/emma/.cache/tmp backend/.venv/bin/python tools/check.py` (`--fast` for lanes).

## ▶▶ NEW (2026-10-02/03, Fable seat, session 58) — THE CARD READ · R99 · ISS-54 + D9 + ISS-55 BUILT, REVIEWED, COMMITTED · NEXT = THE OWNER'S PHONE CARD

**Read first:** [`ISSUES.md`](./ISSUES.md) ISS-54 / ISS-55 / ISS-56 (the as-built summaries + residuals) · [R99](./research/R99-android-16k-comm-mode.md)
· [`ASR_PLAN.md`](./ASR_PLAN.md) §3.5 ⑤ (the AMENDED turn-hold release rule), §3.9 ① (D9 as built), the §4 `turn_hold_ms` row, the §7.2 S7a
note. The session record is `~/.cache/tmp/ctrlb-session58/` (`CARD_READ.md` · `RULINGS.md` = every finding of every round with its
ruling · `audit-ISS54.md` / `audit-ISS55.md` (the design audits + seam maps) · `brief-ISS54.md` / `brief-D9-TH.md` (pinned briefs + the
design-round amendments) · `review-design-*` / `review-code-*` / `confirm-code-*` ({opus,maya}) · `lane-{ISS54,D9,TH}-report.md` (as-built,
file:line, state tables, phone cards) · `frozen-*.diff` + interdiffs · `commit-*.txt`).

### What happened (in order)
1. **The owner's card, read from the dev trails** (steps 1–2 only): K6's arms PASS on the media route (16 kHz ctx, chirp 197 ms ≈ prod, no
   budget trip; `baseLatency` 0.06 is device frames ÷ context rate, NOT a latency change — R99 §1.3); **no hallucinations** beside loud
   water (the D74 gate dropped 13 blip finals). The owner's verdict: **turns end too fast** (`silence_ms` 700, cap 1200 → one monologue =
   four turns, replies queued). The **call route was DEAF after a media→call flip** (0 frames, 15 s reap), twice.
2. **R99 bought** (Opus lane, Chromium `main` + AOSP read whole): the 16 kHz rate is NOT the cause — Android's sink is the hardware rate
   either way; the flip reuses the pooled MEDIA-tagged output stream, comm mode re-routes it, AAudio disconnects, Chrome raises a render
   error nobody watched. **The owner's discriminator the same evening (`bc9d8d20`): a DIRECT call-route start WORKS** ⇒ the flip is the bug.
3. **Owner rulings:** fix both THIS session; the turn hold pulled forward with a 10 s cap; "double check everything with both Opus 5.5 and
   Maya before doing anything, then a review with both afterwards".
4. **The workflow, three times:** Opus audit lane (seam map + draft brief) → main-seat rulings → pinned brief → DESIGN round (blind Opus ∥
   Maya; 6 + 3 findings on ISS-54, 9 + 5 on D9/TH — the load-bearing ones: Opus H1 "the due-release inside an arm reads a STALE derived
   flag → release once after normalize"; Maya H1/H2 "an error with an id must settle it" / "mute while due deadlocks"; Opus M1/M2 the FIFO
   + sentinel belt) → build lane → frozen diff → CODE round (blind Opus ∥ Maya) → fix wave → CONFIRM (Opus by SendMessage, Maya by a fresh
   self-contained `-z`) → commit. **Slices sequential** (all touch `useLiveCall.ts`).
5. **ISS-54 `403c102`** — `pcmCapture.ts` watches its own context from birth (`error` + `statechange`, a first-frame watchdog
   `FIRST_FRAME_MS` 2000, ONE death latch → `onDead` beside `onEnded`, listeners removed on stop, a bounded event log → `ctx` trail
   lines); `earDead` → the EXISTING `recapture` with `freshSink` → `acquire` waits `STREAM_RETAG_MS` (5.5 s, ISS-18's pool wait) BEFORE
   `getUserMedia`; one automatic rebuild per route (`earRetried`, reset by a route change or a TAKEN final), the second death =
   `micLost`; every recapture ONTO the call route waits the same way; the mouth is re-tagged (`markStreamRetag`) and HELD (`sinkWait`)
   until the new mic opens. Notes: "switching to call mode — about five seconds" (flip in only) · "the microphone stalled — anything
   said just now wasn't heard". Two waves (Maya M1 the mouth half · Opus 1–7 · X1–X3). Residuals + ISS-56 WATCH in ISSUES.
6. **D9 `91c5669`** — `awaiting` (ordered ids, `""` sentinel), `waitingFinal` DERIVED, ONE `settle` helper (FIFO through the head;
   unknown id → sentinels only; id-less → clear all; `upstream_error` with id settles + notes), `earUnsettled(s)` = the one predicate,
   `mouthMayOpen = !earUnsettled && !sinkWait`, `error.item_id` parsed (the relay sends none yet). OPEN-2 closed.
7. **ISS-55 `a0ba1d0`** — `voice.live.turn_hold_ms` (0–10000, default 0, Conf › Live call › "Thinking pause (ms)", latched at call
   start): a TAKEN final waits in `pending` (one more `held()` reason), every taken final restarts the hold, release through the one
   `drain()` when it expires with the ear settled — THE due-release once in `callReduce` after normalize; no reply STARTS over a held
   floor; `socketLost` releases at `ready`; route change / ear rebuild clear + keep the queue; mute keeps the text; hang-up or screen-off
   inside a hold HARVESTS to the composer draft; a `turn` trail line + a debug readout. ASR_PLAN §3.5 ⑤ AMENDED (serial pauses = one turn;
   mute keeps; harvest). Full FE suite 4499/4499 (Maya's confirm run).

### ▶▶ THE OWNER'S PHONE CARD — dev (`https://emma.lobster-vector.ts.net:8443`), dist rebuilt + units restarted 2026-10-03; close + reopen the PWA once
**Step 0.** Conf › Live call › **"Thinking pause (ms)" = 5000** and **"Call debug readout" ON**, BEFORE dialling (the knob is latched at
call start). Route = Media.
**A. The turn hold** (debug block shows a `turn` line: `—` / `#n holding` / `#n due`):
1. ONE monologue: a sentence, pause 3–4 s, another, pause 3–4 s, a third, silence → ONE message ~5 s after the last; trail `turn` lines
   open → restart → restart → expiry. 2. A pause > 5 s → two messages. 3. No reply STARTS while the line reads holding/due (a reply already
   playing may pause at a sentence gap and resume when your turn goes out). 4. Talk right around the 5 s mark: the line may flip to `due`,
   your sentence restarts it, still ONE message. 5. Speak, tap mute within 5 s → the words still go out when the pause runs out. 6. Hang up
   inside a pause → nothing sent, the words land in the composer draft once. 7. Set 0 and redial → every sentence goes at once (control).
**B. The flip (ISS-54):** 1. Media→call mid-call: "switching to call mode — about five seconds" ~6 s → chirp → she hears you (the trail:
`ctx` lines, `ctxState running`, `ctxTime` advancing, no `earDead`). 2. Call→media: immediate, unchanged. 3. A direct call-route start
(Conf route = Call): unchanged, no wait.
**C. Bluetooth on the call route — FIRST a DIRECT start with the headset** (BT was never measured; `FIRST_FRAME_MS` 2000 is the only
number not evidenced there — a false `noFrame` would end BT calls at ~10 s "the microphone stopped"; the trail tells). Then a media→call
flip with the headset; then switch the input device on the call route mid-reply: ~6 s `connecting`, NO note; a reply already playing
keeps talking; one that starts during the wait begins on a fresh stream afterwards.
**D. Still owed from the session-56 card:** the 5–10 min dictation · SP's 4a/4b/4c · one Fennec run.
**E. The AGC A/B on the call route (ISS-58, added 2026-10-06; code-free until it wins):** a DIRECT call-route start in the same room as the 10-06 call, with `autoGainControl` forced OFF for that one call (a dev-only edit of `micConstraints`, NOT committed), the same soft-spoken filler + pauses; the trail's `capture` line must read `agc: false`. Count finals that went out that you never said, versus the 10-06 trail's two. A win = the per-route constraint lands at the chokepoint; a loss = the case stays Phase 26's. Optional: one call at `min_final_ms` 400 to feel the backchannel cost.
**Tell me one line per item.** The next session reads the trails itself (`~/.ctrl-b-dev/calls/`, the session-56 recipe).

### After the card
D8 → D5 → the QUALITY.md counts sweep (ONE refresh at the end of A) → the v1.7.11 release card (notes: session 55's list + K6 + ISS-54/55 +
D9; config shape unchanged — `turn_hold_ms` is a NEW key with a default, no migration; rollback = v1.7.10 by tag) → push on the owner's word.

### Standing facts from this session (verified)
- Three reviewer rounds per slice is the owner's standing bar now ("as always"); Maya's confirm rounds are fresh self-contained `-z` runs.
- `git add -N` before freezing; the pre-commit hook runs lint/format/prettier only — the lanes ran typecheck + the touched suites +
  `check.py --fast`; CI runs the rest. `interdiff` works on the frozen diffs.
- Dev `voice.live`: `{dictation, debug ON, mic_hold on, route media}` — the owner flipped route back to media after the discriminator.
- `~/.cache/tmp/ctrlb-session58/` holds every artifact; the HANDOFF/README/R99 docs ride the session's docs commit.

## ▶▶ NEW (2026-10-01, Fable seat, session 56) — PHASE 26 K6 BUILT + COMMITTED (`96fdc4e`) · NEXT = THE OWNER'S PHONE CARD, THEN D9

**Read first:** [`ASR_PLAN.md`](./ASR_PLAN.md) §7.1 (the session-A ladder: S1 ✅ → S2 ✅ → S3 ✅ absorbed → SP ✅ → **K6 ✅** → D9 next →
D8 → D5 → release) · §3.9 ⑤ (K6 as built) · [R96](./research/R96-16khz-capture.md) (the evidence). The session record is
`~/.cache/tmp/ctrlb-session56/` (`SESSION_PLAN.md` · `RULINGS.md` = every finding of both reviewers with its ruling, pre-round + round 1
+ the wave · `brief-K6-16khz-capture.md` / `lane-K6-report.md` (the as-built record: the helper's contract, every downstream
`ctx.sampleRate` reader verified file:line, the prose sites, the phone-card checklist, the notes for D9, the "Wave 1" section) ·
`review-K6-{opus,emma}.md` · `confirm-K6-{opus,emma}.md` · `diff-K6{,-v2}.patch` · `e2e-K6.log` · `REVIEW_COMMON.md`).

### What happened
1. **K6 — 16 kHz capture at both sites** (`96fdc4e`): ONE **synchronous** helper `openCaptureContext(stream)` in `pcmCapture.ts`
   (`CAPTURE_RATE = 16000`, not a config key) builds `new AudioContext({ sampleRate: 16000 })`, PROBES it with
   `createMediaStreamSource` (pre-148 Firefox/Fennec throws `NotSupportedError` there, R96 §2.3), and on ANY throw closes it and
   returns a plain device-rate context, `nativeRate: true`. Both sites call it (`startPcmCapture`; dictation's `armDetector`) and
   keep their OWN resume + "must be running" contract byte-for-byte, so a fallback context reaches `running` through the same
   path (council 25) and dictation's ownership token parks whichever context came back BEFORE its await (the brief's async
   `onOpened` shape was dropped — a lane deviation, KEPT: strictly smaller, the mid-await cancellation case disappears).
   Downstream unchanged by construction (worklet frame size 640 @ 40 ms, `start.sample_rate`, the socket ceiling, chirp factor 1,
   `rec.rate`); the relay resamples 16 → 24 kHz for the interim Speaches ear (R96 §3: a wash; a clean win at session B).
   `nativeRate` on the call's `capture` line · `native_rate` on the dictation `rec` line (each line's own convention) ·
   `fftSize` 1024 at 16 kHz only · prose incl. the two backend docstrings + ASR_PLAN's "via `primeAudio`" → "via the caller's own
   resume path" (`primeAudio` unlocks only the `<audio>` element). Wire SHAPE unchanged; `start.sample_rate` now says 16000.
2. **The round:** Opus ∥ Emma SHIP WITH FIXES (Opus 4 LOW · Emma 1 MED + 3 LOW) → wave 1 (two missing test arms: dictation
   fallback + stuck-suspended, call wiring 48 kHz/`nativeRate: true`; `resumeGate` fake parity; the prose) → **both CONFIRMED
   SHIP**. REJECTED: Emma's MED "await the rejected context's close before building the fallback" (no named browser; every
   teardown → next-arm already constructs without awaiting; the async shape re-imports the cancellation case) — recorded as the
   helper's KNOWN ASSUMPTION so a Fennec field failure has a named suspect; Emma's LOW on the `capture` key spelling (per-line
   convention wins). Both reviewers confirmed the rulings hold.
3. **e2e** (`npm run test:e2e`, the real-Chromium proof of the cross-rate path — a 48 kHz oscillator track into a 16 kHz
   context): see `e2e-K6.log` (result recorded below in "Standing facts"). The run rebuilt `frontend/dist`; the dev units were
   restarted for the card.

### ▶▶ THE OWNER'S PHONE CARD — step by step (K6 + SP field checks; dev only)

**Where:** DEV = `https://emma.lobster-vector.ts.net:8443` on the phone (NOT the bare `https://emma.lobster-vector.ts.net` — that is
prod v1.7.10, without K6/SP). Dev's dist is rebuilt and both dev units are up. Close and reopen the PWA once so it takes the
new build. Everything below writes a trail the next session reads by itself — you only need to DO the steps and tell me what
felt off (delay, false turns, garbled words, anything).

**Step 0 — turn the trails on.** Conf › Live call › **"Call debug readout" → ON** (dev currently has it OFF, so nothing writes
until you flip it). Leave it on for the whole card.

**Step 1 — a call on the default route (EC-media).** Start a call, talk for 1–2 minutes with a few real replies, hang up.
*Pass = turns land, no truncated/garbled finals, no false turn in the first seconds, no "deaf" spell.*

**Step 2 — a call on EC-call.** In the in-call deck flip the route to the other one (Sound/Mic — the D74 deck), repeat step 1.

**Step 3 — a 5–10 minute streaming dictation.** Tap the composer mic, read something aloud for 5–10 minutes, stop.
*Pass = phrases stream in as you talk and the draft reads right.*

**Step 4 — SP's three checks** (the dictation policy rulings from session 55, same round):
- **4a** a hands-free dictation of about 6 minutes with several **30-second pauses**, screen ON: it must NOT stop on the pauses
  (the idle stop is 300 s against a relative floor now).
- **4b** start a dictation, then mute the mic with Android's privacy toggle (quick settings → mic off) and wait: it should stop
  by itself after **5 minutes** (300 s) — note roughly when it stopped.
- **4c** nothing to do — the trail's `end` line carries `clip_bytes`; the next session checks ≈ 4 KB per second of recording.

**Step 5 — one Fennec run (Firefox on the phone).** Open the same dev URL in Firefox, do one short call and one short
dictation. *Both outcomes are passes* — the next session reads off the trail whether Firefox took 16 kHz or fell back to the
device rate. What matters: did the call connect and did the dictation stream (or at least land as a clip)? Note your Firefox
version (about:… or Settings › About) if handy.

**Step 6 — tell me.** One line per step: PASS / odd / FAIL and what you noticed. The chirp/latency arm needs no action from
you — the trail's `chirp` + `outputLatency`/`baseLatency` fields are compared by the next session against prod's pre-K6 trails.

### ▶▶ HOW THE NEXT SESSION READS THE CARD (do this FIRST, before any build)
- **Call trails:** `~/.ctrl-b-dev/calls/*.jsonl` (append-only JSONL, one file per call, `trail_keep` 20). **Dictation trails:**
  `~/.ctrl-b-dev/calls/dictation/*.jsonl`. The card's files = anything dated 2026-10-01 or later (`ls -lt`). The relay's own
  journal: `journalctl --user -u ctrl-b-dashboard-dev --since 2026-10-01 | grep -E 'leg_start|leg_end|budget'`.
- **Reader** (no tool exists; this is the recipe — each line is `{"src","t","ev",...}`):
  ```bash
  for f in $(ls -t ~/.ctrl-b-dev/calls/*.jsonl ~/.ctrl-b-dev/calls/dictation/*.jsonl 2>/dev/null); do echo "== $f"; \
    python3 -c "import json,sys
for l in open(sys.argv[1]):
    d=json.loads(l)
    if d.get('ev') in ('capture','chirp','rec','end','leg_end','uplink'): print({k:d[k] for k in d if k not in ('cfg',)})" "$f"; done
  ```
- **What to check, per arm:** `capture` → `ctxRate: 16000`, `nativeRate: false`, `trackRate` (48000 expected), `outputLatency`/
  `baseLatency` vs prod's pre-K6 trails in `~/.ctrl-b/calls/` (they read `outputLatency` 0–0.02, `baseLatency` 0.02 — a move ≤ ~0.01
  is the pass) · `chirp` → `lagMs`/`peak` found, comparable to the same route's earlier trails · `rec` → `rate: 16000`,
  `native_rate: false` (the Fennec run: `true` + the device rate if Firefox < 148) · `end` → `clip_bytes` ≈ 4000 × seconds,
  `reason` = `user` for the manual stops, `idle` for step 4b at ≈ 300 s · the journal's `leg_start rate=16000` · no `budget` trips.
- **Then:** rule each arm PASS/FAIL against ASR_PLAN §7.1's K6 row + SP's row, record it in HANDOFF, and only then write D9's brief.

### After the card
D9 (the awaited-id set; the lane report's "What D9 should know": no overlap with K6 beyond one `useLiveCall.ts` trail line; the
wiring harness now defaults to a 16 kHz context over a 48 kHz track with `h.nativeRate`/`h.rates` knobs) → D8 → D5 → the QUALITY.md
counts sweep (ONE refresh at the end of A) → the v1.7.11 release card (notes owed: session 55's list + K6's "a v1.7.10 relay accepts
the 16000 declaration; nothing to roll back on the wire") → push on the owner's word → v1.7.11 per ASR_PLAN §8.2.1.

### Standing facts from this session (verified)
- Slices stay SEQUENTIAL; both reviewers on every slice; wait on Emma's OUTPUT FILE only; freeze with `git add -N`.
- `python` is not on PATH — the gate is `TMPDIR=/home/emma/.cache/tmp backend/.venv/bin/python tools/check.py --fast`.
- Dev units RUNNING; the dist REBUILT by the e2e run (S1/S2/SP/K6 all in it). 23 commits over `origin/main`, nothing pushed.
- e2e result: `npm run test:e2e` GREEN after K6 — 403 passed · 10 skipped · 0 failed (2.5 min), every `liveCall.spec` case incl. the real-Chromium 48 kHz-track → 16 kHz-context path (`e2e-K6.log`).

## ▶▶ NEW (2026-10-01, Fable seat, session 55) — PHASE 26 S2 BUILT + COMMITTED · S3 RULED ABSORBED · SP BUILT + COMMITTED · NEXT = K6 IN A CLEAN SESSION (the brief is written)

**Read first:** [`ASR_PLAN.md`](./ASR_PLAN.md) §7.1 (the session-A ladder: S1 ✅ → S2 ✅ → S3 ✅ absorbed → SP ✅ → **K6 next** → D9 → D8 →
D5 → release) · §3.3 (the allowance, as built in S2) · §3.9 ③/⑤ (SP as built; K6 the spec). The session record is
`~/.cache/tmp/ctrlb-session55/` (`SESSION_PLAN.md` · `RULINGS.md` = every finding of both reviewers with its ruling, S2 AND SP, plus the
S3 scope ruling · `brief-S2-*` / `lane-S2-report.md` · `brief-SP-*` / `lane-SP-report.md` (D1–D20 + the stop-path → release table +
the `clip_bytes` order per path) · `review-*`/`confirm*-*` for both rounds · **`brief-K6-16khz-capture.md` = the NEXT lane's brief,
READY** · `REVIEW_COMMON.md`).

### What happened (in order)
1. **S2 — the wall-clock uplink allowance** (`ad94796`): `_note_frame` is a token bucket (audio-ms, capacity `UPLINK_ALLOWANCE_MS` =
   30 s, plus a frame-count twin 30 s / `frame_ms`), both START FULL, refilled at wall rate, armed immediately before `ready`
   (`_arm_allowance`, its own stamp — never `_LegStats.started`); a violation = 1008 naming the budget + the credit found;
   `RATE_WINDOW_S`/`RATE_MULTIPLIER`/the deque GONE. The Q2 inequality is a `LiveCfg` load validator
   (`_allowance_covers_the_reservoirs`: 30 000 ≥ 10 000 keepalive + max(buffered_ceiling_ms, call_backlog_ms) + buffered_ceiling_ms
   + 500 pacer cap + 2·frame_ms = 12 580 at defaults); the three constants live in `app/config.py` (config never imports a
   service). T2 = `credit_min_ms` + `budget` on the leg-end line + trail. Client: PROSE ONLY. **Consequence:** `buffered_ceiling_ms`
   > 9 710 or `call_backlog_ms` > 18 420 (others at defaults) now REFUSE to load / 422 (neither live config sets them). Round:
   Opus ∥ Emma SHIP WITH FIXES (all prose/copy) → wave → Opus CONFIRMED, Emma NOT CONFIRMED (2 LOW prose) → wave 2 → both
   CONFIRMED SHIP.
2. **S3 RULED ABSORBED** (`db742d6`, docs): S1 already delivered the typed codes + the spec-pinned StopReason vocabulary (every
   K-path is classifiable from the trail), S2 rewrote the K3-reversal prose; a `protocol` StopReason member REJECTED (S8 rewrites
   the death consequence). No build, no round. TODO S1/S2/S3 ticked.
3. **SP — the dictation policy rulings P1·P2·P3** (`cd2cb02`): P1 the hands-free idle stop measures against a RELATIVE floor —
   `levelGate`'s noise tracker (REUSED) + NEW `dictation_idle_margin_db` (10 dB, 0–40) — `dictation_idle_s` 300 (was 15), 0–1800,
   **0 = off**; a dead/digital-zero input (Android's mic privacy toggle) counts as silence (`db < NOISE_DISCARD_DBFS`, ruled D1);
   Tier-0 UNTOUCHED. P2 `dictation_max_s` 1790 (was 120) under `max_session_s` 1800 with the NEW validator
   `_dictation_cap_under_session` (`<`; Conf 422); the recorder asks `audioBitsPerSecond` 32 000 (`RECORDER_BITRATE`, T-1 pin);
   the dictation `end` line gains `clip_bytes` (T4; `null` on the drop paths). P3 the wake lock LIFTED into `lib/wakeLock.ts`
   (`takeWakeLock(state, stillWanted)` / `releaseWakeLock`, the call's body verbatim, the fence parameterized); dictation takes
   a FRESH state per recording right after `rec.start()` and releases in `teardownDetector` (every stop path reaches it — the
   table in the lane report); no visibility re-take (foreground-only). `/voice/status` delivers the margin; Conf gains its row;
   cleared `dictation_idle_s`/margin ride as NULL (the 0-means-something precedent). LIVE_VOICE_PLAN §4.1/§5.1 mirrored. Round:
   Opus SHIP WITH FIXES (2 MED: the 0-final leg drop left an UNBOUNDED hot mic with the screen held — fixed, the lock goes back with the leg; a rollback trap — a stored `dictation_idle_s` of 0 or > 300 breaks v1.7.10's 3–300 bounds — §8.3 + the card) ∥ Emma DO NOT SHIP (HIGH = MY freeze omitted the two NEW files — `git diff` skips untracked; MED = a 1 s bootstrap can seat the floor on speech — fixed with a `settled` gate; MED = the margin copy was REVERSED — fixed) → wave 1 → Opus CONFIRMED (v2 + his own v3 one-liner) · **Emma NOT CONFIRMED on one ACCEPTED RESIDUAL** (a minimum tracker needs the speaker's gaps; a voice with no 10 dB dip for a whole 5 s window reads as a room and a legal SHORT `dictation_idle_s` could stop mid-sentence — recorded as a KNOWN LIMIT in the config comment; the 300 s default is where the policy lives; the voice reference belongs to S8/TUNE; **owner may re-rule**, e.g. a `ge` of 30 s).

### ▶▶ NEXT SESSION = K6 (16 kHz capture at both sites) — the brief is written, spawn it first thing
- **Spawn** ONE Opus 5.5 build lane on `~/.cache/tmp/ctrlb-session55/brief-K6-16khz-capture.md` (pins ONE helper
  `openCaptureContext(stream)` in `pcmCapture.ts` — `{ sampleRate: 16000 }`, probe `createMediaStreamSource`, fall back to the
  native rate on a throw; both sites call it; `native_rate` on the `capture`/`rec` trail lines; `fftSize` 1024; prose sites).
  Open a NEW scratch dir `~/.cache/tmp/ctrlb-session56/` (copy `REVIEW_COMMON.md` + the K6 brief across; leave 55's record).
- **Then the standing round** (Opus ∥ Emma on the frozen diff → RULINGS → the wave by `SendMessage` → confirms → commit). **Wait on
  Emma's OUTPUT FILE for the verdict line ONLY** — a `pgrep -f '<pattern>'` in the wait loop self-matches the loop's own bash
  wrapper and never exits (45 min lost this session).
- **K6 ends in THE OWNER'S PHONE CARD** (ASR_PLAN §7.1 K6 row; the lane writes the checklist into its report): trail rate 16000 ·
  one call + one 5–10 min dictation transcribe normally · chirp lag + `outputLatency`/`baseLatency` readout within ~10 ms ·
  level gates self-adjust · EC-call and EC-media arms · one Fennec run (the fallback). Plus SP's field checks on the same round:
  a 6-min hands-free dictation with 30 s pauses survives, screen on; a muted mic idles out at 300 s; `clip_bytes` ≈ 4 KB/s.
  Rebuild the dev dist + restart the dev units for it.
- **After K6:** D9 → D8 → D5 → the QUALITY.md counts sweep (ONE refresh at the end of A) → the v1.7.11 release card (notes owed:
  S1's PWA-update-window trail split · S2's "a stored `buffered_ceiling_ms` > 9 710 / `call_backlog_ms` > 18 420 refuses to
  load" · SP's "a stored `max_session_s` ≤ 1790 without a lower `dictation_max_s` refuses to load" — neither live config
  stores any of these · **ROLLBACK to v1.7.10: clear a stored `dictation_idle_s` of 0 or > 300 FIRST** (ASR_PLAN §8.3) · a cached
  v1.7.10 PWA reads a delivered `dictation_idle_s: 0` as "stop at the first quiet reading" until it updates — transient) → push on the owner's word → v1.7.11 per ASR_PLAN §8.2.1.

### Standing facts from this session (verified)
- Slices stay SEQUENTIAL (useDictation.ts is touched by S2/SP/K6/D5); parallelism = the two reviewers. Both reviewers on every
  slice; a NOT CONFIRMED on prose is normal — apply, refreeze, re-confirm both.
- The owner's context bound: hand off at ≤ ~350k; one build slice + its round per session is the comfortable unit.
- `python` is not on PATH — the gate is `TMPDIR=/home/emma/.cache/tmp backend/.venv/bin/python tools/check.py --fast`.
- Dev units RUNNING (untouched this session; the dist is STALE — S1/S2/SP are not in it). Nothing pushed: 20 commits
  over `origin/main`.

## ▶▶ NEW (2026-10-01, Fable seat, session 54) — R98 BOUGHT · THE VAD-MODEL BOUNDARY RULED (§3.4.1, R25, Silero v6.2 DEFAULT) · PHASE 26 S1 BUILT + CONFIRMED + COMMITTED · NEXT = S2 IN A CLEAN SESSION

**Read first:** [`ASR_PLAN.md`](./ASR_PLAN.md) §3.4.1 (the model boundary — NEW this session; §0.1 R25 · §4's `vad_threshold`/`vad_model`
rows · §6.4's S9 pre-pass row) · [R98](./research/R98-vad-model-landscape.md) (the VAD-model landscape, MEASURED on emma) · §7.1 (the
session-A ladder: S1 ✅ → **S2 next** → S3 → SP → K6 → D9 → D8 → D5). The session record is `~/.cache/tmp/ctrlb-session54/`
(`SESSION_PLAN.md` = the lane table + mechanics · `RULINGS.md` = every finding of both reviewers with its ruling · `brief-S1-*` /
`lane-S1-report.md` (the as-built record incl. every `stop()` site and D1–D13) · `brief-R98-*` · `review-*`/`confirm-*` for rounds A and
S1 · **`brief-S2-uplink-allowance.md` = the NEXT lane's brief, READY** · `REVIEW_COMMON.md` = the review rules pasted into every round).

### What happened (in order)
1. **The owner's two asks before the build:** (a) research every VAD model we might swap to, so the ear is agnostic without a later
   refactor; (b) the ASR side likewise. → **R98** (Opus 5.5 lane, `docs/research/R98-vad-model-landscape.md`): 16 models' IO contracts
   verified at source; a bake-off on emma (the TEN labelled set + DEMAND car/cafeteria/kitchen noise, streamed hop by hop); every peer's
   abstraction read. **Silero v6.2 beats v5.1.2 on every axis** (AUC 0.957 vs 0.925 clean · 0.952 vs 0.913 car 0 dB; under the plan's
   policy 126/126 clean + 125/126 noisy segments with 0 phantoms/min at native level vs v5's 6 misses + 7–9/min on babble). No released
   streaming model clearly beats it for a car (TEN ties clean, loses on babble; FireRed-stream measures BELOW it — its headline F1 is
   its NON-streaming 1.6 s-lookahead model). **The phantom "Yeah." class is NOT a VAD-model problem** (echo residue and a radio ARE speech;
   foreground VAD is unreleased) — AEC, the hold, the backstop and the pre-pass stay the levers. ASR side: CrispASR ignores unknown
   multipart fields; onnx-asr has no HTTP server; parakeet-server's tolerance stays UNVERIFIED until S9's unit exists (plan T-5).
2. **The amendment — ASR_PLAN §3.4.1 (R25), D82 ①, TODO S6-i, the research index** (`66ead3a`): `VadModel` (name · sample_rate · hop ·
   delay_hops · default_act · prepass_act · open()) + `VadStream.probs()` + a dict of constructors; `VadSegmenter` owns the residual carry,
   a 16 kHz model cursor mapped back to the leg clock through frame anchors, and the hop conventions (START/cut edges at the hop start,
   STOP edges at the exclusive hop end — Emma's HIGH); `VadParams` in ms + `derive(params, hop)`, the EMA as `ema_tau_ms ≈ 30.48`;
   `vad_threshold` stays an EXPLICIT float, default 0.6 for v6.2, bounds widened to 0.1–0.95 (an optional "model default" was REJECTED —
   nothing could display or persist it); `vad_model` config-only, lands in S6-i; causality = a registry-invariant TEST (never a load
   check); the pre-pass runs the same model at a per-entry `prepass_act` settled by an S9 sweep (re-run on any model swap); T1 gains
   `model · hop_ms · act` in S7b. Design round A: blind Opus 5.5 ∥ Emma, both BUILD WITH CHANGES → revised → **both CONFIRMED BUILD**.
3. **Phase 26 S1 — telemetry + the trail retention split** (`6e87f30`): ONE leg-end `log.info` from `run()`'s `finally` on every path
   (before any await), from `_LegStats` (mode · duration · frames · audio_ms · finals · finals_text · drops · reason incl. a distinct
   `uplink_idle` · close_code incl. the PEER's on client-gone · identifier-shaped `last_err`); `LIVE_MODES` moved into `call_trail.py`,
   dictation trails under `calls/dictation/` with their own `trail_keep` (**closes ISS-41**), the trail route's batch carries `mode`;
   dictation `stop(reason: StopCallReason)` (only `user` settles; STOP-1…10 pinned), the `end` line records reason/close/lastError;
   client close 4001 (K2) beside 4000 (K3); `liveSocket` reports the client's own code only when the browser says 1005/1006; the call's
   `capture` line gains NS/AGC/channels/rates; `uplink` drop lines per leg. Round S1: Opus ∥ Emma both SHIP WITH FIXES → one 11-item fix
   wave → **both CONFIRMED SHIP**. Gate green (full `tools/check.py`). Dev dist NOT rebuilt (S1 is observability; the owner tests it with
   K6's phone card at the end of A).

### ▶▶ NEXT SESSION = S2 (the wall-clock uplink allowance) — the brief is written, spawn it first thing
- **Spawn** ONE Opus 5.5 build lane on `~/.cache/tmp/ctrlb-session54/brief-S2-uplink-allowance.md` (read it once; it pins the design from
  ASR_PLAN §3.3 + the S1 lane report's notes for S2, incl. "do NOT reuse `_LegStats.started` as the bucket clock"). Open a NEW scratch
  dir `~/.cache/tmp/ctrlb-session55/` (copy `REVIEW_COMMON.md` + the S2 brief across; leave session 54's record where it is).
- **Then the standing round:** freeze `git diff > diff-S2.patch` → blind Opus 5.5 (Agent, `model: "opus"`, "Reasoning effort: HIGH") ∥
  **Emma** (`~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main --profile emma -z "$(cat prompt)" -m gpt-5.6-sol-900k --reasoning
  high --ignore-rules -t file,terminal --in /home/emma/github/ctrl-b > out.md 2> out.err < /dev/null`, backgrounded — `--profile` is
  pre-parsed before argparse and absent from `--help`; the CLI double-forks, wait on the OUTPUT FILE, not the PID) on the same prompt
  (REVIEW_COMMON.md pasted first + the slice questions) → RULINGS → the fix wave by `SendMessage` to the SAME lane → confirm (Opus by
  `SendMessage`; Emma by a fresh self-contained `-z` with her review pasted) → commit by hunk. Slices are SEQUENTIAL (useDictation.ts is
  touched by S1/S2/S3/SP/K6/D5 — two lanes on one file race the Edit tool); parallelism = the two reviewers.
- **After S2:** S3 → SP → K6 (**the owner's phone card**, ASR_PLAN §7.1) → D9 → D8 → D5 → the QUALITY.md counts sweep (ONE refresh at the
  end of A, not per slice) → the v1.7.11 release card (add S1's note: during the PWA update window an old PWA's dictation trail splits
  across `calls/` and `calls/dictation/` — transient, debug-only) → push on the owner's word → v1.7.11 per ASR_PLAN §8.2.1.

### Standing facts from this session (verified)
- **Both reviewers on EVERY Phase 26 slice** (owner directive 2026-09-30, `dual-reviewers-for-critical-code` memory): Emma = hermes
  profile `emma`, `gpt-5.6-sol-900k`; two Emma runs in parallel on the same profile worked; a review takes 8–15 min, a confirm 3–10.
- **Agreement is not evidence:** round A's Opus and Emma agreed on the arithmetic and disagreed on the threshold shape; the main seat
  ruled a THIRD, leaner shape (explicit float + wide bounds) and both confirmed it. Round S1: Opus called the T7 test "not a flake",
  Emma called it nondeterministic — the deterministic gated-consumer test won.
- **R98's raw results live in `~/.cache/tmp/r98/`** (venv, scripts, `results_all.json`; the DEMAND clips + model files) — re-run
  `bench_policy.py` there before re-buying any VAD number. The dossier's phantom-segment "0/min" is at NATIVE noise level; at −35 dBFS
  babble v6.2 still produced 0.7/min.
- Dev units RUNNING (`ctrl-b-dashboard-dev` + `-dev-web`); the owner's polish #1–#6 test on dev is still open (session 53's card) —
  stop them when done. Speaches + PocketTTS units untouched. Nothing pushed.

## ▶▶ NEW (2026-09-30, Fable seat, session 53) — POLISH #6 BUILT + COMMITTED · THE ASR/VAD PLAN OF RECORD DESIGNED, COUNCIL-CLOSED, COMMITTED · NEXT SESSION = BUILD (clean session)

**Read first:** [`ASR_PLAN.md`](./ASR_PLAN.md) (the plan of record, ≈88 KB — §0.1 = every ruling, §3 = the architecture,
§7 = the slice ladder, §8 = release/rollback, §10.2 = what is still open, §11 = the council record) · D82 in
[`DECISIONS.md`](./DECISIONS.md) · TODO Phase 26. The session record is `~/.cache/tmp/ctrlb-session53/` (`SESSION_PLAN.md`,
`ASR_RULINGS.md` = the owner's rulings in order, `RULINGS-P.md` = every council finding + its ruling, the reviews and confirms,
`lane-P-report.md` = where every ruling landed, `POLISH_LEFTOVERS.md` = the LOCAL polish ledger).

### What happened (in order)
1. **Polish #6 — the DUTIES GATE** (`e249f12`): the roleplay `*…*` action convention (eye carry + ear drop) applies ONLY to
   `duties: conversational` agents; agent-duties replies keep plain per-line emphasis and are spoken in full; `Speaker {agent,
   actions}` on every audio entry point; the D80 echo backstop reads a message-scoped effective policy. Two-reviewer round (blind
   Opus ∥ Maya) + fix wave, both closed. FE 4286 tests · BE 7. **Dev dist rebuilt; the owner tests it on dev.**
2. **R96** (`0510dc7`): 16 kHz capture is standard for raw-PCM-over-WS clients, worth it, small; the relay's resampler aliases
   (linear, no low-pass). **R97**: the plan's engine held against LiveKit · Pipecat · Home Assistant (per-peer tables = the record
   for any future revision). Both indexed in `docs/research/README.md`.
3. **The ASR/VAD plan** (`docs/ASR_PLAN.md`, D82, Phase 26): written from R94/R95/R96 + the owner's rulings; a stress-test audit
   (4 R94 questions: 1 defect, 3 conditions — all folded); design council №1 = blind Opus 5.5 ∥ EMMA (Sol), both BUILD WITH
   CHANGES → 28 reconciled rulings; R97 peer check + a traceability audit (every source item → plan §) → wave 3; six waves in all;
   **Opus CONFIRMED BUILD (round 4) · Emma: see §11 / the line below.** Owner rulings that shaped it: Speaches NEVER stopped or
   deleted (un-configured only; parakeet.cpp cloned beside it); engines = MACHINE-WIDE user units on 0.0.0.0, shared by dev +
   prod + Hermes; NO shadow mode / NO Speaches baseline (capture + offline replay + hand tuning); the cap-split JOIN; reload
   survival (S8b) IN; K6 16 kHz in session A; `language: en` stays (parakeet ignores it; whisper — the hallucination source —
   reads it); Kokoro out of TTS (PocketTTS → vault-alltalk); two releases (v1.7.11 = polish + A · v1.7.12 = B).

### The build order for the clean session (from ASR_PLAN §7; every slice: pinned Opus lane → main-seat audit → blind Opus 5.5 ∥ EMMA review → fix wave → confirm → commit; the owner's pause after each)
- **S5 ✅ done here** (D82 + TODO + ROADMAP + doc-map applied).
- **Session A** (Speaches still the ear): S1 telemetry → S2 the 30 s uplink allowance → S3 typed kill paths → SP (P1 300 s /
  10 dB · P2 1790 → 1800 · P3 wake lock; recorder 32 kbps) → K6 16 kHz capture (+ the owner's phone card) → D9 awaited-id set →
  D8 provisional floor → D5 slot takeover → **release v1.7.11** (ASR_PLAN §8.2.1, no config step). Brief S1 first; S2 and SP may run in parallel lanes (disjoint files).
- **Session B**: S6-i engine/DSP → S6-ii capture + replay tool + corpus (then the OWNER's capture rounds with `debug` ON on dev —
  there is NO audio on emma today) → S9 parakeet units + the clip door (bake-off) → TUNE (owner hand judgement via
  `tools/vad_replay.py`) → S7a client half (inert) → S7b THE FLIP (dev config move) → field rounds → S8 recovery → S8b reload
  survival → S10 code off Speaches → **release v1.7.12** per §8.2.2.

### ✅ RULED at session close: A · two releases (ASR_PLAN §0.1 R1/R23, §10.2)

1. **The turn hold = Option A.** `silence_ms` stays the VAD end (500–1200); a new client `turn_hold_ms` (0–3000, default 0) holds a finished turn and absorbs more speech; transcription never waits — S7a/S7b are unblocked.
2. **The cadence = two releases.** v1.7.11 = the six polish fixes + session A (Speaches still the ear; no config migration; rollback `update.sh v1.7.10`); v1.7.12 = session B (the flip's config move; rollback = config restore + `update.sh v1.7.11`).

*Watch item, not a ruling:* parakeet ignores the language setting and auto-detects; the S9 bake-off and the release gate
test English + Spanish short/noisy clips for crossing — if it ever crosses, it comes back as an engine question with evidence.

Everything else you asked about is RULED and in the plan: Speaches never stopped/deleted (un-configured only), engines
machine-wide on 0.0.0.0 shared with Hermes, no shadow mode, the cap-split join, reload survival, `language: en` (parakeet ignores
it; whisper — the hallucination source — reads it), Kokoro out of TTS, 16 kHz capture in A, Emma as the second reviewer on
every slice.

### Other agenda for later sessions (not Phase 26)
- **Machine-wide service update pass (owner, 09-30):** inventory every service on emma (PocketTTS · Speaches · Hermes · Tailscale
  · the ctrl-b units · …) and bring DEV + PROD up to date with them. A separate ops session.
- **Polish leftovers** stay in the LOCAL ledger (`~/.cache/tmp/ctrlb-session53/POLISH_LEFTOVERS.md`) until the owner's dev test
  of #1–#6 closes the audit: glued `Hello*She walks*` (test first), CJK (out of scope), player N2/N3 (owner feels it out), gacha
  desktop blank page (test-only), fenced-block eye/ear split (accept).
- **Push:** 11+ commits UNPUSHED on `main` (the 7 from session 52 + `e249f12` + `0510dc7` + this session's docs). Push on the
  owner's word; v1.7.11 ships once session A lands, v1.7.12 after B.
- Dev units RUNNING (the owner is testing polish); stop them when done.

## ✅ WALKED 2026-09-30 (session 53) — the design agenda, kept as the record: every §B/§C item → ASR_PLAN §10.1; §A → the local polish ledger + polish #6; §D done

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
· prod `voice.live.debug` was ON then (for the car card and the dictation trail) — **it is OFF on prod now**
(verified `~/.ctrl-b/config.yaml`, 2026-10-07; since S6-ii, ON would also record every leg's audio, SECURITY_MODEL §2.12). Pre-tag standing move:
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

## ▶ Phase 27 DESIGNED (2026-10-06, session 60 — Fable seat in the `ctrl-b-opus` unit) — POINTER ONLY

**Conversations per agent (the Telegram model) + past conversations = ROADMAP A15 → [`D84`](./DECISIONS.md) → Phase 27.
The design of record is [`docs/CONVERSATIONS_PLAN.md`](./CONVERSATIONS_PLAN.md) — SELF-CONTAINED (owner directive R33): a
build session reads the plan + the repo, nothing else.** Evidence = [R100](./research/R100-per-agent-conversations.md).
Council CLOSED 2026-10-06 (blind Opus 5.5 ∥ Emma, two rounds each, both CONFIRMED WITH NOTES, notes folded). **NOTHING
BUILT.** The owner's two rulings (plan §12) are IN — **ruled 2026-10-06 (session 61): F2 = reading A** (a responder runs on the
HOME agent's model + privilege) **· ON4 = (a)** (both overrides persist per device across a reload) — folded → plan v2.5; nothing open.
The build is a SEPARATE session after the ASR work (plan §10 = the S0–S13 ladder, backend-first; two-reviewer code rounds).
Session provenance (not needed to build): `~/.cache/tmp/ctrlb-session60/` (`RULINGS.md` R0–R46 + O/E/F/N rulings, both
reviews, frozen plan versions v1 → v2.4).
