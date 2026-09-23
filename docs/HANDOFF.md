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

## Current state (2026-09-23 afternoon, THIRTY-FOURTH session — **THE AFTERNOON SITTING, live in conversation: the crackle's `speak_actions` datapoint (ISS-16 ladder RE-ORDERED), four small owner-ruled fixes built + gated + committed, the Opus workforce moved to 5.5. ⚠ 19 COMMITS UNPUSHED over origin `e571ef9` (the earlier "8 over `80bd388`" was wrong — `80bd388` itself is unpushed; `git fetch` verified 09-23); PUSH on the owner's word. ▶▶ NEXT = the owner runs the re-ordered ISS-16 arms A/B/C (ISSUES.md) on the phone, then S4.**)

**① The crackle (ISS-16, rewritten).** The owner arrived with it GONE on Speaker (EC on), BT off,
chunking on or off — then caught it RETURNING the instant `speak_actions` went ON (they had seen it
once before and withheld it). Code-truth: that toggle changes ONE thing (`toSpeech` keeps the `*…*`
spans + read-along cuts eagerly instead of holding at an unclosed `*`), so on a roleplay reply ON =
several times more speech in more, earlier chunks, long enough for playback to CATCH UP and park
between chunks (`playNext` → `waiting` → `"loading"`: the pooled output stream Stop()/Start()s at
each gap — R80 §10-④-1's seam class). Reading: `speak_actions` is a LENGTH / catch-up PROXY, not the
asterisks. **The ladder is now A** chunking `off` · **B** read-along OFF · **C** a short plain reply
— all with `speak_actions` ON, Speaker EC-on, BT off, one variable each; plus "is the crackle AT
the sentence pauses or THROUGH the words?". The capture-side `latencyHint: "playback"` diagnostic
drops to LAST (safe in itself — bigger uplink bursts, coarser barge granularity by tens of ms —
but it targets the wrong side of the pipe on this evidence). The morning's BT correlation is
UNPROVEN (the toggle was plausibly ON then). Seam-shaped fix candidates recorded in ISS-16 (deeper
lookahead + pre-buffer · a silent clip holding the element's stream open · gapless WebAudio under
the playback hint). Reproduction recipe on file.

**② Built this sitting (FE only; gate: check-all green, FE 3,781/194):** `0f7e435` the Speech
pill goes ROUND (`kit-call-iconpill`) + the Mic select loses its drawn arrow + the heard line
holds `…` through `waitingFinal` (`CallView.waitingFinal` exposed; the old final no longer flashes
during the STT round-trip; +1 test) · `3da4091` the chat log's ResizeObserver also watches
`#chatlog` (the "slightly scrolled up on return to the agent tab" report — content growing after
the one-frame tab-entry pin; hypothesis-driven, the owner verifies) · `b8330d7` ISS-16 + the plan's
sitting record · `99f9f83` CLAUDE.md + the second-opinion skill: **Opus 5.5** (`claude-opus-5-5`,
released 09-22) is the workforce — via the `opus` ALIAS, nothing pinned (the installed CLI 2.1.280
already resolves it to 5.5; a session on an older build spawns Opus 5 until it restarts — this one
did). Backend untouched; no dev restart needed (Vite HMR — reload the page).

**③ Explained, not changed:** the four-row Mic list with nothing connected (`System default ·
Default · Speakerphone · Headset earpiece`) is R77's predicted list — "Headset earpiece" is
Chrome's fixed name for the phone's OWN earpiece, not a BT row; "System default" (ours, empty
constraint) and "Default" (Chrome's) name the same routing decision — hiding Chrome's row is a
candidate cleanup, not done. Custom voices per agent = already covered (the agent's voice id).

**▶▶ NEXT:** the owner runs arms A/B/C (afternoon, phone) → the answer picks the fix slice (seam
class ⇒ its own small slice + review round) → the car arm + the headset-mic label with the pair
connected → the standing D73/D74 probes + the S4 §4.1 close-out → **PUSH the 19 commits on the
owner's word**.

## Prior state (2026-09-23, THIRTY-THIRD session — **THE D75 ⑥ COUPLING ROUND + THE BT MEDIA-PATH PROBE, all in-conversation the same morning: the owner proposed coupling the clean bargain to the interruption toggle, WALKED IT BACK on the walkie-talkie cost, ruled Speaker (clean) the SHIPPED DEFAULT; the device probe ran live and CONFIRMED the media-path claim; the flip is BUILT, gate 6/6, dev restarted. ⚠ 8 COMMITS UNPUSHED over origin `80bd388`; PUSH on the owner's word. ▶▶ NEXT SESSION = the AFTERNOON SITTING — the card is in [`LIVE_VOICE_PLAN.md`](./LIVE_VOICE_PLAN.md) §7's D75 addendum.**)

**① The ruling (DECISIONS D75 ⑥).** The derivation ("clean whenever interruptions are off") was
proposed by the owner and walked back on its one real cost: an EC-on speaker ear with `barge_in`
off queues talk-over and drains it as **ONE message** (§4.3 — the owner confirmed that shape is
exactly what they expect), and the derivation would close that ear. Ruled: all three routes stay;
**`speaker-hifi` (Speaker (clean)) = the shipped default** — the friction answer is the default,
not a coupling (do not re-propose). **BT auto-detection REFUSED for the record** — the owner's own
two devices defeat it both ways (car: headset rows + loudspeaker acoustics ⇒ still needs EC;
headphones: no HFP row per R77 ⇒ detection never sees them).

**② The probe (owner's phone, BT headphones arm — the plan's D75 addendum holds the card + results).**
Q1 Speaker (clean) → the HEADPHONES, clean, zero page-side routing (the media path follows the
system's own routing — the claim that makes the clean default right). Q2 Speaker (EC on) → PINNED
to the phone loudspeaker, crackling — comm mode never steers SCO on the Honor 20; this decodes
D74's "doesn't switch to Bluetooth". Q3 the crackle tracks EC ALONE (both EC-off routes
indistinguishable). **R77 premise SHIFTED:** the Mic picker showed *a headset mic* row ("I think")
where R77 said none exists — confirm the exact label at the sitting; don't pick it (it would steer
capture into the phone-call path; the ladder guards it).

**③ The build (`f1ca014`, gate 6/6 ×1 full):** `LiveCfg.route` default → `"speaker-hifi"` ·
ConfTab's `LIVE_FALLBACK` seed + Seg fallback · the barge_in row now says it is INERT on speaker
(clean) (the one new trap the clean default creates) · `useVoiceStatus`'s stale two-route comment
fixed · `config.example.yaml` gains the route row · the BE default test repinned · docs (D75 ⑥ +
plan addendum + ISS-16 datapoint). Additive — a default only reaches configs that never wrote the
key; **the owner's config wrote `speaker` in the D74 round**, so `/voice/status` still serves
`"speaker"` (CORRECT, not a bug) until their Conf hand flips it. `8148272` = the afternoon card.
Dev RESTARTED, health 200; both units RUNNING for the sitting; the :8443 door is open.

**▶▶ THE AFTERNOON SITTING (the card, plan §7 D75 addendum):** *self-serve* — Conf → Audio route →
speaker (clean) if they want it standing · the headset-mic row's exact label · the CAR arm (Q1–Q3 +
mic list; expected: headset rows present, clean route echo-free via A2DP because the ear is held) ·
the remaining D75 pokes (captions on a real call · backdrop arm→preview→send→hold→revert). *The
ISS-16 probe ladder* (route = **Speaker, EC-on**, same longish reply, ONE variable per arm):
**P1** Conf → Voice · TTS → chunked synthesis → off — vanishes ⇒ seam-shaped (flip back after) ·
**P2** `latencyHint: "playback"` — a ONE-LINE dev edit at `pcmCapture.ts:588`
(`new AudioContext({ latencyHint: "playback" })`), applied live between arms and REVERTED after (a
diagnostic, deliberately not a knob) — vanishes ⇒ R80 §3.2 answered, and a playback-hint capture
during calls becomes the real fix candidate (would make EC-on speaker + interruptions usable
again; its own small slice + review round if taken) · **P3** (optional, phone on USB)
`chrome://inspect` → media-internals during a crackling reply. Both P1+P2 no-change is also an
answer: the glitch lives below the page. **Then:** the standing D73/D74 probes + the S4 §4.1
close-out (unchanged inheritance: the indeterminate-pill question · one-shot-vs-sticky · the R75
§12.4 freeze probe) · **PUSH the 8 commits on the owner's word.**

**The commits (⚠ ALL UNPUSHED, origin `80bd388`):** the five D75-wave commits below (`7ebbbb5` →
`bec11db`) + `f1ca014` the default flip + `8148272` the afternoon card + this handoff commit.

## Prior state (2026-09-22, THIRTY-SECOND session — **THE D75 WAVE IS CLOSED: the fix wave verified/completed, a FRESH three-lane blind round run over the finished wave (Maya·Luna ∥ Opus arch ∥ Opus design), its consolidated fix wave 2 built + red-proven, both Opus confirm rounds CONFIRMED (arch: SHIP), everything COMMITTED in five scoped commits. ⚠ 5 COMMITS UNPUSHED over origin `80bd388`; PUSH on the owner's word.**)

**① The inherited fix wave, verified complete.** Every A/B/C item landed — including C3, which the THIRTY-FIRST probe called missing: it had landed under the rename **`routedAgent`** (the probe grepped the old `resolveBackdropAgent` name). Completed the three real gaps: the B1 test arm expected `more-below` where the component's own follow rule pins growth to the bottom (the dead lane's last edit — fixed to `more-above`); a REAL settle arm now drives `runComposer`'s own `finally` (the old arm simulated the release by hand, so the named red-proof couldn't hold); the temp spec was repointed off the dead session's tmpfs and its **Escape assertion restored** (then deleted pre-commit, as pinned). The D item (the triple-blind record + open owner question into D75/plan, the stale `radiogroup` wording corrected to the landed `menu`/`menuitemradio`) written. Screenshots re-captured ×2 and sent to the owner.

**② The fresh blind round on the FINISHED wave (owner-ordered rigor), and its convergence:** Maya (Luna, blind) 3 MED · Opus arch/data-flow · Opus design/UX — **Maya and the arch lens converged blind on the spent-hold's release guard** (value equality + the take clobbering a live hold), and the arch lens added the deeper fact: **a D41 steer's `sendMessage` settles at the 202**, so the hold never covered the very interleaving its comment cited. The design lens confirmed the deck/captions sound and pressed copy/consistency items.

**③ Fix wave 2 (all red-proven, each detachment failing exactly its named arm):** the hold is **TOKEN-OWNED** — `takeComposerScope(stash)` returns `TakenScope {agent, skills, hold}` (a generation; unarmed takes preserve a live hold; `runComposer` stashes only when `getChatStatus() !== "streaming"` — a steer never holds), `releaseSpent(hold)` no-ops stale tokens, `setSpentScope` deleted, **`clearComposerScope` no longer touches the hold** (amending the round-1 "hand-clear clears both" contract), `previewAgent` exported beside its fields · the captions floor **TRACKS until the call's first turn has run** (a vanished client-only placeholder id must not resurrect pre-call history; the reviewer's own `said === ""` condition was rejected as ineffective — the timeline is the discriminator; three fixture arms re-routed through a real turn) · the route fallback names its row · `asked`→`engaged` · the Speech pill disables with its siblings · the open pill is LIT (`[aria-expanded="true"]:not(:disabled)`) · `aria-haspopup="menu"` (Sound only — a slider disclosure is no menu) · a ✓ on the checked row · the **"calls run without the composer's agent pick"** note when dialling with a pick armed (mount-snapshotted, gone on terminals, retired at the first heard utterance) · Conf route copy (leads "the next call's default — the call screen changes it for a call in progress"; the headphones clause names the Hands-free interruption switch) · `voiceFailed` → "the reply is text only".

**④ The confirm rounds:** arch — **SHIP**, all seven CONFIRMED with line proof, two judged stronger than its own prescriptions; recorded two sub-bar F5 residuals + the widened focus class (a slider commit redials with its popover open — the whole class is in D75). Design — **CONFIRMED on all eight + the M4 deferral; its H1 relabel WITHDRAWN** (R77's "Speakerphone" trap word — hiding that the input list IS the router trades one inversion for another), its leaner H1 form (an INDETERMINATE Sound pill after a synthetic mic pick) **deferred to S4**: an unconditional version false-dims agreeing picks, a contradiction-aware one needs the synthetic-row→output truth table only the device round produces. Its two new LOWs (N1 lit-and-dead · N2 the standing note in the transient slot) landed in ③. Maya's confirm ruled **not warranted** (her token prescription landed verbatim + red-proven — the D74 precedent). **Overruled, recorded in D75:** Maya's hung-transport hold (hold lifetime EQUALS send lifetime; Stop settles both) · her roster-authority split (boot-window transient, self-heals; re-plumbing the menu's source is its own slice).

**Verified at the tip:** gate 6/6 ×3 · **BE 2,514 · FE 3,780/194** (QUALITY.md) · e2e on the production build: **liveCall 20/20 · agent-backdrop 20/20** (⚠ count truth: liveCall is 10 arms × 2 projects = 20 — the THIRTY-FIRST's "liveCall 40/40" was a combined-filter run that silently included agent-backdrop's 20; nothing regressed) · temp spec 2/2 with the Escape assertion before deletion · screenshots (deck 393 · picker with ✓ + lit pill · captions · 320px one-line) sent to the owner via the session.

**The commits (⚠ ALL UNPUSHED, origin `80bd388`):** `7ebbbb5` captions BE + backdrop/spent-hold · `aa68965` speaker (clean) + EC retry + probe release · `3345cb6` the deck + CallCaptions · `58fac56` docs (D75 + dossiers + ISS-16) · this handoff commit.

**▶▶ NEXT SESSION / the owner's poke list:** ① **the Sound pill → "Speaker (clean)" = THE crackle fix to try on the phone** (ISS-16's mitigation) · ② captions on a real call (`voice.live.captions`, ON) · ③ the backdrop: arm in the composer menu → instant preview → send → holds through the reply → reverts at settle · ④ if a route flip reads stuck, the new one-line note names it (`ecStuck`) · ⑤ dev is RESTARTED on the wave (health 200; `/voice/status` carries `captions` + the third route) · ⑥ **PUSH the 5 commits on the owner's word** · then the standing D73/D74 probes + the S4 §4.1 close-out, which now also inherits: the ISS-16 probe ladder · the indeterminate-pill question (H1-revised) · the M4-strengthened one-shot-vs-sticky owner question (the settle-edge revert lands as the reply's VOICE starts).

**Durable lessons this session:** a handoff probe that greps a NAME can call a landed fix missing — probe for the CONTRACT (the import site), not the identifier; a reviewer's fix can be wrong while its finding is right twice over (the F5 `said === ""` condition could never fire — re-derive the mechanism before landing a prescription); an e2e "N passed" from a multi-filter run is not a per-suite count — pin counts per spec file.

## Prior state (2026-09-22 evening, THIRTY-FIRST session — **THE D75 WAVE: the owner's crackle/echo report became a full research→design→build→triple-blind-review cycle, closed to a FIX WAVE that was still landing when the session hit the usage limit.** ~~EVERYTHING IS UNCOMMITTED on top of `80bd388`; nothing pushed; dev backend NOT yet restarted~~ **all committed/closed by the THIRTY-SECOND session above, which supersedes this block's ▶ sections wholesale**; kept for the research digests + the build record.)

**The owner's report (morning, transcribed voice):** TTS crackles with one Output state and is clean-but-self-hearing with the other; the toggle "clearly doesn't switch to Bluetooth"; pills overflow to a second line — wants icons ("the hint will be the list when you click"); wants a Gemini-style fading ~3-line agent transcript on the call screen; wants the backdrop to change on composer-menu agent SELECT, not first send; ordered deep research (KoljaB RVC, Open WebUI), blind subagent + Maya verification, "clean and reliable". Mid-session adds: a SECOND Opus lens for correctness/architecture; test visuals + live interaction; handoff when ready.

**The diagnosis (verified against code + config):** the report arrived STATE-INVERTED because the old Output button labelled the ACTION ("Use headphones" while ON speaker) — so: speaker route (EC `{ideal:"all"}` → comm mode) = the crackle = ISS-16; headphones route (EC off → media path) = clean but the open ear on a loudspeaker hears the reply. The owner's "it's the echo cancellation that does the crackling" is exactly right.

**Research bought + indexed (README rows written; a stray duplicate R75 row deleted):**
- **[R79](./research/R79-peer-call-audio-echo.md)** — Open WebUI is structurally our twin (EC true ⇒ same comm trap; bare `<audio>`; whole MP3 blobs; **half-duplex by DEFAULT**, 300 ms/seam) so comm mode is NOT the crackle differentiator; our four deltas: capture chain → `ctx.destination` + keepalive (peers terminate at an AnalyserNode = automatic pull node), tight src swaps, a probe `<audio>` per chunk, no ramp. **Output selection on Android re-verified DEAD 2026-09-22** (0/8 peers; the `audioinput` list IS the router — our deck already ships the lever). RVC delta: unchanged since R51; its "works well" = EC true + a hidden 1–2 s deaf window.
- **[R80](./research/R80-comm-mode-crackle.md)** — no public bug matches; the media-element sink is ALREADY the glitch-resistant class (POWER_SAVING ≥1024 frames; streams pooled, 5 s idle ⇒ chunk seams do NOT re-acquire); the one risky class we hold = the capture `AudioContext`'s LOW_LATENCY 4–5 ms stream (the load-bearing unknown). **THE ISS-16 LATCH EXPLAINED:** comm mode is evaluated for the FIRST input stream only, restored on the LAST release; our recapture's `stop()`→`getUserMedia` has no barrier; a lost race keeps the mode AND (R78 §2.3 pin) hands an "EC-off" track EC-ON — the readback is the free detector. `true` vs `"all"` identical on Android; **loopback-RTCPeerConnection AEC trick = ZERO Android value (verdict, do not build)**; ranked fixes ① EC-off+ear-hold speaker ② per-turn capture release (recorded, NOT built) ③ readback check+barrier ④ pipe changes are diagnostics only. R79's "open the mouth before the ear" lever REFUTED by R80/R77 §3 — when dossiers disagree, the one that engaged the counter-mechanism won.
- **ISS-16 REWRITTEN**: mitigated (the clean route), root cause open, the S4 probe ladder recorded (`chunking:"off"` → `latencyHint:"playback"` → `chrome://media-internals` via `chrome://inspect`), plus the R80 §7-S2 keepalive question parked there.

**BUILT (two pinned Opus lanes, every gate green after each; all in the working tree):**
1. **Call captions** — `voice.live.captions` (LiveCfg, ON; `/voice/status`; Conf row; `LIVE_FALLBACK` carries `true`) + `CallCaptions` in `kit/CallOverlay.tsx`: reads the store's `lastReply()` (new, beside `getLiveTurn`; `textOf` MOVED to store/chat — one join, two readers), call-scope floor latched DURING RENDER on the mouth's own gate expression (rename-proof), per-edge conditional fade (`.kit-call-said`, three custom props on `.kit-call`), stick-to-bottom follow, deliberately NOT aria-live.
2. **Backdrop preview** — `useActiveBackdrop` honours the armed one-shot (D70 §8.3a re-ruled by the owner); pure `resolveBackdropAgent` extracted + tested.
3. **The hi-fi route (D75 ①)** — `ROUTE_SPEAKER_HIFI = "speaker-hifi"`, ONE new predicate `wantsAec()` driving `micConstraints`' EC bit AND the R77 SCO-steer gate; **capture-ready resolution needed ZERO changes** (readback-driven: hold auto-arms, barge stays off); backend `Literal` +1 (additive, no migration); Conf third Seg.
4. **The EC-release retry (D75 ③)** — `openEcChecked()`: EC-off ask reading back engaged ⇒ release, wait `EC_RELEASE_RETRY_MS=250` (named platform const, R80 §5 cited), reopen ONCE; `ecStuck` → `CALL_COPY.ecStuck` via the captureReady note seam (`fellBack` outranks). AEC-direction mismatch deliberately excluded.
5. **The deck** — `useDeckPopover()` extracted (VadControl refactored onto it, zero behavior change), `OutputPicker` state-first icon pill + 3-row popover (values = the pcmCapture consts; lucide volume-2 / speaker-cabinet / headphones fetched verbatim), input select capped `min(40vw, 200px)`, one line guaranteed ≥320px. Plus `probeDuration` releases its throwaway element (R80 §7-S1).
6. **Docs** — DECISIONS **D75** (rulings ①–⑤ incl. the refuted set + R80 §10-② recorded-not-built) + D70/D74 addenda + the plan's §7 D75 block.

**Verified live:** BE 2514 · FE 3752/194 · **e2e on the production build: liveCall 40/40, agent-backdrop 20/20** · 4 screenshots (deck/picker/captions/320px) in the session scratchpad — pre-fix-wave; the fix lane re-captures.

**THE TRIPLE-BLIND REVIEW ROUND (owner-ordered):** Maya (Luna, blind file) **SHIP WITH FIXES** — 1 MED (picker `aria-checked` compares the RAW route; unknown route ⇒ no checked row; fix = compare `current.val`). Opus correctness/arch **SHIP WITH FIXES / SHIP WITH CHANGES** — ① MED **Escape with a popover open HANGS UP THE CALL** (the swallow sits on the popover; focus sits on the PILL; the unit test fired on a row = a focus state the UI never reaches) — **found independently by the main seat's own e2e probe the same hour**; ② MED the call surface paints the armed pick **calls never route by** (`sendCallTranscript` docblock: the scope is NOT spent) — **converged blind with the design lens**; ③ LOW `ecStuck` docstring contradicts the code (an `"all"` stuck track = hold OFF, barge armable); ④ LOW `resolveBackdropAgent` belongs in `lib/composer` and `ToolsMenuSheet`'s hand-rolled copy already diverged. Opus design/UX **SHIP WITH CHANGES** — H1 ≡ the call-surface lie; **H2 the post-send collapse: ordinary threads carry NO pin (`agent.py:1231`), so on send the preview falls to the DEFAULT's art and never returns**; H3 the captions block eats tap-to-interrupt under the very line instructing it; M1 captions legibility (13px `--text-2` over art); M2 the 40px pill vs this screen's own 44px rule; M3 "Output/Input" over-claim (an input pick moves BOTH directions) → **Sound/Mic**; M4 "hi-fi"+cabinet read as external hardware → rename **"Speaker (clean)"**, symptom-honest hints; M5 Conf copy; L1 hint wraps; L2 fade 22%→12%; L3 outside-close skips focus restore; S1 four `--text-1` ghosts; S2 no disclosure affordance; S3 popover anchor clips at 320 in the degraded deck. **MAIN-SEAT OVERRULES (recorded in D75):** M4's glyph half (cabinet stays — 18px distinguishability), S2's visible chevron (owner's "just icons"; aria-label tail only), F2's gallery half (the gallery/AgentTab/gacha readers KEEP the scope — they report what PAINTS; only the CALL surface goes scope-free).

**▶ THE FIX WAVE — the lane DIED ON THE RATE LIMIT mid-work (its last visible step: "check the composerScope tests and run the FE unit suite"), so the tree holds a PARTIAL fix wave and NO GATE HAS RUN over its edits — expect possible red. Grep-probed at session close:** LANDED — A2 (`current.val`) · A3 (44px, 7 hits) · A5 ("Sound"/"Mic") · A6 (`menuitemradio`) · A8 (`--text-1` count now 0) · B1 (the `edges.above || edges.below` gate) · C1 (`armedPick`, 3 hits) · C2 (`spent` machinery in composerScope, 12 hits; ToolsMenuSheet + composerScope/composerToolsMenu tests touched) · C5 (fixture `captions: true`). **VERIFIED MISSING — C3** (`resolveBackdropAgent` NOT in lib/composer yet). **UNVERIFIED (probe ambiguous or unprobed) — A1** (the root-level Escape handler — MUST verify, it is the round's headline defect) · A4's ConfTab label (grep for "clean" case-insensitively) · A7 · B2/B3/B4 · C4 · C6 · D (the review-round record in D75/plan) · all of E (tests may be MID-EDIT; the temp spec's Escape assertion; red-proofs; e2e re-runs; screenshots). **⚠ the temp spec's `SHOTS` constant points at the DEAD session's scratchpad (tmpfs) — repoint it before running.** The contract to verify/complete:
- **A1** the popover Escape handler moves to the `.kit-call-io` root (BOTH controls), gated on `open` (closed ⇒ Escape still hangs up); **A2** Maya's `aria-checked={c.val === current.val}`; **A3** 44px targets (routebtn/device min-height + iconpill width, line-height follows); **A4** routepop anchored to `.kit-call-top` + copy: **Speaker** "echo-cancelled · phone-call sound" / **Speaker (clean)** "clear audio · mic pauses while it speaks" / **Headphones** "clear audio · for when you're wearing them" (+ Conf Seg "speaker (clean)"); **A5** captions **Sound**/**Mic**, pill aria "Sound: <name> — tap to change"; **A6** `role="menu"`/`menuitemradio` (the PrivilegeChip precedent); **A7** outside close via `dismiss()`; **A8** the four `--text-1` → `var(--text)`.
- **B1** captions stop pointerdown ONLY when scrollable; **B2** `color: var(--text)`; **B3** fade 12%; **B4** one `useVoiceStatus` read.
- **C1** `useActiveBackdrop(armedPick = true)`, CallOverlay passes `false` (calls route by the ladder alone); **C2 THE SPENT-HOLD**: `composerScope` gains `spent` (stashed ATOMICALLY inside the APPLIED take — the `/verb` path gets a non-stashing clear; hand-clear clears both), `runComposer` clears it in a `finally` when the send settles; resolution = armed ?? spent ?? ladder — so the preview holds through the armed message's own reply and reverts at settle, never mid-send; **C3** the resolver moves to `lib/composer` beside `effectiveAgent`, `ToolsMenuSheet` calls it (its divergence — unknown armed name checked NO row — folds to default-checked, the server's own truth); **C4** the `ecStuck` docstring fixed; **C5** the e2e `LIVE_CALL` fixture gains `captions: true` + `vad_threshold: 0.4`; **C6** Conf copy (route desc order matches the Seg; captions desc "…; off → only what you said").
- **D** D75 + plan block gain the review-round record (verdicts, the two blind convergences, the overrules) + the open owner question (below).
- **E** tests: the PILL-focus Escape arm (the previously-unreachable state, now the pinned one) + spent-hold arms + scope-free-call arm + B1 gating; the TEMP spec `frontend/e2e/visual-d75.spec.ts` gets its Escape assertion RESTORED and re-runs (re-capturing the 4 screenshots); red-proofs (detach A1 ⇒ two arms fail; short-circuit C2's finally ⇒ the settle arm fails); full gates + `npx playwright test liveCall agent-backdrop --project=mobile --project=desktop`.

**▶▶ NEXT SESSION, in order:** ① verify/complete the fix wave (above) + main-seat review of its diff; ② full gates + the three e2e runs; ③ **DELETE `frontend/e2e/visual-d75.spec.ts` before committing — it is a TEMPORARY capture/probe spec, never part of the suite**; ④ send the re-captured screenshots to the owner (SendUserFile); ⑤ commit, tightly scoped: captions+backdrop(+C cluster) · hi-fi+retry+probe(insurance) · deck(+A/B clusters) · docs(R79/R80+index+ISS-16) · handoff — footer = CLAUDE.md's Co-Authored-By (check `tmux display-message -p '#S'` for the model) + the session's Claude-Session URL line; ⑥ `systemctl --user restart ctrl-b-dashboard-dev`, health 200, `/voice/status` carries `captions` + the third route; ⑦ the owner's poke list: **the Sound pill → pick "Speaker (clean)" = THE crackle fix to try on the phone** · captions on a real call (knob `voice.live.captions`, ON) · backdrop: arm in the composer menu → preview → send → holds through the reply → reverts at settle · if a route flip ever reads stuck, the new one-line note names it; ⑧ **PUSH only on the owner's word** (uncommitted now; origin was at `80bd388`).

**Open owner question (recorded in D75):** should the composer pick stay ONE-SHOT (the spent-hold makes it livable) or become a sticky switch? The routing semantics are theirs to rule; the backdrop now previews either way.

**Durable lessons this session:** a temporary Playwright capture spec doubles as a defect PROBE — it found the Escape-on-pill hang-up that a green unit suite missed, because a unit test can pass on a focus state the UI never reaches; two dossiers disagreeing is ruled by the one that engaged the other's counter-mechanism (R79 §6.3 vs R80/R77 §3); blind convergence across independent lenses (twice this round) is the strongest finding class; Maya's env has NO `pytest` — her backend verification is always ours to run.

## Prior state (2026-09-22, THIRTIETH session — **THE OWNER'S DECK ROUND, live in conversation: their morning poke became the D74 addendum ⑨/⑩, built + blind-reviewed + confirm-closed the same sitting.** Their reports, in order: the asterisk knob "missing" (it was behind the collapsed Voice · TTS group — and then re-ruled OFF by default) · the route controls cramped below with Mute → the TOP DECK above the ring with Output/Input/Speech captions (the captions exist because "not sure which button is which") · the select's vertical text skew (the `all: unset` line-box, centred) · the crackle persists and flipping EITHER control sometimes clears it → **ISS-16** (a capture-side-latch datapoint for S4, R74/R77 territory) · `barge_in` re-ruled OFF (voice interrupt verified at 0.06, now an opt-in) · and the ask that became the real slice: **the SPEECH THRESHOLD (server-VAD floor) joins the deck** — a pill dropping a vertical Android-volume slider, release commits ONE leg redial carrying `start.vad_threshold` (the wire's one new optional field, validated at `_parse_start` with `sample_rate`'s strictness, folded into the relay's ONE `session.update` — the pin STANDS, no in-band change exists; `setVad`→`redialLeg`→the existing `openLeg`, gen unmoved, ear untouched, per-call like the route pair). **The owner-ordered hardening pass ran the full loop:** blind Maya correctness round (SHIP WITH FIXES — 3 MED: the base read the live query · the barge window survived the redial · explicit null passed as absent) ∥ blind Opus design/UX round (SHIP WITH CHANGES — the popover had no dismiss and **Escape hung up the call** · the veil's light end under the captions · the deck's frozen grouping · unrecorded slider bounds · the polarity comment INVERTED · plus F7/F8 doc-trail rot), the two lenses CONVERGING blind on the structural finding (vadBase now SEEDED ONCE at `captureReady`, the route pair's own pattern). All fixes landed + red-proven against named bypasses; Opus confirm re-audit CONFIRMED (its one residual — the second inverted comment — fixed as `662a0fc`). Maya confirm ruled not warranted (her prescriptions verbatim, red-proven). Gate 6/6 ×2 · liveCall e2e 20/20 on the production build ×2 · **FE 3,730/194 · BE 2,511** (QUALITY.md). The commits: `9bfbd0e` speak_actions OFF · `68f2573` the deck · `966017e` the slider + barge_in OFF (D74 addendum ⑨/⑩, DECISIONS) · `8d7acce` the review wave · `662a0fc` the comment · this docs commit. **⚠ THESE ARE UNPUSHED** (the pre-session backlog turned out already pushed; origin was `e571ef9`). Dev RESTARTED on the wave, health 200 — the owner's knobs preserved (route speaker · barge 0.06 · min_final 200; `barge_in`/`speak_actions` now read the new OFF defaults, their config never wrote those keys). ▶▶ NEXT: the owner pokes the finished deck (the Speech pill · the popover's dismiss/polarity words · captions over their art) → the standing D73/D74 probes + the S4 §4.1 close-out (unchanged, plus ISS-16's three crackle questions) → **PUSH on their word**; supersedes below where it speaks)

- **Residuals recorded, deliberately unbuilt:** the "(this call)" override marker + Conf pointer
  (design F6-secondary, LOW — the next call's pill already speaks the reset); an e2e slider arm
  (Maya LOW — the unit/wiring pins + the S4 phone round carry it); the pill materialises at
  `captureReady` so the deck re-centres once during the first `connecting` (confirm-round
  cosmetic note). The full review record: the plan §7's 2026-09-22 block + DECISIONS D74 ⑨/⑩ +
  SECURITY_MODEL §2.10's relay-bounds line.

## Prior state (2026-09-21 evening, TWENTY-NINTH session — **THE OWNER'S POKE ROUND BECAME THE D74 WAVE, closed same-evening: their live testing found the S5 route knob sitting on its default (the fix built but OFF), hand-calibrated `barge_threshold` to 0.06, caught two noise finals committed as turns and the asterisk-"scratching" correlate — three research lanes (R76 Parakeet-hallucination gating · R77 the Android-10 PreS residual, which proved the headphones route works on their phone BY LUCK · R78 the readback contract + the dead-interrupt arithmetic) → D74 ruled → Maya design round (BUILD WITH CHANGES, 4 folded pre-build) → two pinned Opus lanes → Maya code round (SHIP WITH FIXES, 3 red-proven) → confirm (F1/F2/F3b CONFIRMED; F3a overruled TWICE, residual recorded in code). Owner verdicts live in-round: headphones route = "sounds good" · background call works · speaker-with-BT-disconnected = "okay" · voice interrupt works at 0.06. Also: every Conf group starts collapsed (owner ask) + the D73 lint-gate unblock. Gate 6/6 twice; FE 3,714/194 · BE 2,505. ⚠ NOW 20 COMMITS UNPUSHED (`bd4d5bc`→the handoff). Dev backend RESTARTED on the wave; owner knobs preserved (route speaker · barge 0.06 · min_final_ms 200 ON). ▶▶ NEXT: the owner pokes the NEW deck (in-call route/device controls on the call screen · the "too quiet" gate against real noise · `voice.tts.speak_actions` if they want dialogue-only · `voice.live.debug` for the S4 sitting) → the remaining D73 probes (R75 §12.4 lock-screen freeze) → the S4 §4.1 close-out (re-check 0.06 on the windowed rule; the barge floor is NOT route-portable — R78) → PUSH on their word**; supersedes below where it speaks)

- **The D74 records:** ruling = DECISIONS D74 (eight rulings incl. the twice-overruled F3a with
  its residual at `candidateConstraints`); as-built = the plan §7 D74 block; evidence = R76/R77/
  R78 (+ index rows). The commits: `1f50686` lint unblock · `d5a787e` collapsed Conf ·
  `91e25cb` the call-machine lane (+ review wave folded) · `924211c` the TTS/actions lane ·
  `b480ec0` docs · this handoff.
- **⚠ Standing cautions for the next round:** the headphones route silently depends on the
  owner's pair exposing NO HFP row (R77) — the steering ladder now guards the trap, but a NEW
  headset that shows a "Bluetooth headset" input row is the case to watch; "Speakerphone" as an
  input pick latches FORCE_SPEAKER into the next real phone call (R77 (b)); `min_final_ms` ships
  ON at 200 — if the owner reports lost quiet speech, the knob's 0 is the off switch and the
  debug readout shows the per-final numbers.

## Prior state (2026-09-21, TWENTY-EIGHTH session — **S4 OPENED AND GREW THE D73 WAVE, closed same-day: the owner's first phone dial found the dev-only StrictMode call-death (fixed, red-proven) + the BT speaker distortion; two Opus research passes (R74 routing · R75 background survival) → D73 ruled → Maya design round (the FIRST on the LUNA lane — emma/sol RETIRED by the owner, cost) → two pinned-Opus build slices → two Maya code rounds + fix waves + confirms, ALL CONFIRMED. Also shipped: the visible mic⇄call mode flip + the WhatsApp-class bubble-arrival animation. ⚠ 14 COMMITS UNPUSHED (`bd4d5bc`→`ee715ae`). ▶▶ NEXT SESSION = the owner's verdicts from their poke round (they are checking the app now) → the two D73 phone probes → the S4 §4.1 calibration sitting (the phase gate) → PUSH on their word**; supersedes below where it speaks)

- **The two openers (owner, on the phone):** ① every dev call died "Call ended" at birth —
  StrictMode's setup→cleanup→setup left the machine terminal; fixed in the reducer's own idiom
  (`remount` re-arms a terminal machine PRESERVING the moved generation), red-proven with a
  StrictMode-wrapped wiring mount. Dev-only; e2e drives the production build, which is why the
  harness was green around it. ② TTS on the speaker, distorted, with BT headphones worn.
- **The D73 wave (design of record = the plan's D73 block; ruling = DECISIONS D73; evidence =
  [R74](./research/R74-android-call-audio-routing.md)/[R75](./research/R75-background-call-survival.md)):**
  **S5** `voice.live.route` speaker|headphones (headphones = `echoCancellation:false` — R74's
  source-verified single-bit escape from Android's communication mode → A2DP TTS — AND the
  route-resolved `{earHoldMode, bargeArmed}` pair: open ear + voice barge-in, no echo path
  exists) · the input picker that IS Android's route selector (enumerate-on-open, gesture-gated
  label probe, ghost devices disabled-never-cleared) · dictation on the same constraints (R51
  §6.1 closed — bare `audio:true` was IN the trap). Output selection is platform-impossible on
  Android (0/5 peers ship one; the ChatGPT-selector premise CORRECTED — none exists anywhere).
  **S6** `voice.live.background` ON (amends §5.3) + `background_keepalive` (ConstantSourceNode —
  the zero×gain first cut was ruled INERT by the design round) + `background_idle_s` 600 (owner's
  10 min) + the ear-outage detector ("the ear was asleep" — Chrome freezes a silent hidden page
  in ~90 s with NO mic exemption, R75's load-bearing find, corrects R14) + wake-lock re-acquire +
  turn_done suppressed in-call + the `priorLeg` busy marker (first-dial busy WITH it = the
  discard-recovery ladder; W3's terminal arm and e2e pin STAND — the main seat's unification was
  OVERRULED by the design round) + the pagehide/visibilitychange split.
- **The cadence, both slices:** pinned Opus build → main-seat review → blind Maya code round →
  fix wave → self-contained confirm. S5 = `0388ad5`+`40b6f32` (2 MED; the ghost-option auto-clear
  half OVERRULED). S6 = `7b8cd80`+`4857d20` (1 HIGH — the acquisition-window terminal — + 2 MED +
  1 LOW; F3 accepted AS RESHAPED, F4 OVERRULED on the fact). Confirms CONFIRMED, she re-ran the
  pins. Gate: **FE 3,643/194 · BE 2,502 · typecheck · local liveCall e2e 20/20 on the production
  build** (counts in QUALITY.md).
- **⚠ THE MAYA LANE (owner ruling + two burned gotchas, in `use-codex-and-fable-correctly` +
  the second-opinion SKILL):** emma/sol is RETIRED for reviews; Maya = the ◆default profile,
  `-m gpt-5.6-luna-900k`. Her shell starts in `/home/emma/workspace` (a DIFFERENT git repo) —
  commit-scoped briefs must pin every git command `git -C /home/emma/github/ctrl-b` with FULL
  shas, or the review honestly reports "commit not present".
- **Also this session:** the mode flip goes visible (`5ac91a0` — PhoneIcon on the button, accent
  tint, kit-btn-pop; the first cut read a field the hook didn't expose — caught by the REAL
  `tsc -b` gate; bare `npx tsc --noEmit` is a NO-OP here, never trust it) · bubble arrival
  (`84f812a` — store-side client-only `fresh` flag set ONLY by live-append builders, ArriveWrap
  latch + module ledger, `kit-bubble-in` motion-gated; bulk loads/reloads never animate; verified
  live in Chromium — the user bubble's rise is masked by the keyboard collapse, BY the platform).
- **Ops:** dev units RUNNING (D69) on the full wave (backend restarted; `/voice/status` serves
  all five D73 knobs). Serve: prod :443 → :5433 untouched (v1.7.7) + the DEV DOOR
  **`--https=8443 → :5173` OPENED this session** for the phone round — `tailscale serve
  --https=8443 off` when it should close. The WS origin rail passes at :8443 (verified 101
  end-to-end). Owner flipped dev `voice.live.enabled` ON in Conf during the round.
- **▶▶ NEXT SESSION opens on the owner's poke verdicts**, then: R74's four-row routing probe ·
  R75's §12.4 freeze probe (3 min lock-screen silence → speak; validates the keepalive before it
  is believed) · the recorded residual (a mic stolen AND returned entirely while hidden reports
  only at the next wake) · then the S4 §4.1 calibration sitting = THE PHASE GATE
  (`voice.live.enabled` ships-ON flip at its close). **PUSH the 14-commit backlog on the owner's
  word.** v1.7.8 sequencing unchanged (release E after Phase 23 S7).

## Prior state (2026-09-17, TWENTY-SEVENTH session — **THE DOC-HEALTH INTERMISSION: a full documentation truth + consistency + prune pass, owner-commissioned before S4. 3 Opus auditors (core spine incl. full README/SPEC/DESIGN · the 12 feature plans · ops/theming/audits) → the same 3 resumed as fixers under main-seat rulings; 47 findings + addendum applied across 35 files, gate 6/6, committed `35247b6` + this handoff commit, PUSHED. ▶▶ NEXT SESSION = S4 STRAIGHT (plan §7), unchanged**; supersedes below where it speaks)

- **What was wrong (the pattern):** substance was healthy — as-built bodies, ladders, HANDOFF,
  and the release/rollback runbooks all verified accurate — but **STATUS STAMPS, doc-map rows,
  and cross-cutting inventories rot**: LIVE_VOICE said "nothing built yet" over 8 as-builts,
  ATTACHMENTS "S1 building" over a done ladder, MEDIA_MANAGER "NOTHING BUILDS" over v1.7.7
  shipped, TODO Phase 22 all unticked. All stamps now converge (CLAUDE.md rows = plan stamps =
  TODO): P21 ✅ v1.7.7 · P22 ✅ built rides v1.7.8 · P23 S0–S6b closed, S7 rides owner use ·
  P24 S0–S3.5 built, S4 gate pending.
- **The HIGH:** `HTTPS_TAILSCALE.md` still taught corsair-era `serve --bg 5173` — on emma that
  steals prod's :443. Rewritten to the emma truth (`--bg --https=443 5433`, `serve-https.sh`
  canonical, safe dev door `--https=8443 5173`, never-do box) + the AudioWorklet
  secure-context table.
- **Spec/security truth:** DESIGN's `Part` union transcribed from code (Question/PlanPart never
  existed; Reasoning/AttachmentPart in; §9 → the `MediaCfg` fold) · new **SECURITY_MODEL §2.10**
  = the D71 WS ingress rails · AGENTS.md §6 gained the owner-file PUT rule + the app-wide
  no-CORS/no-multipart negative (allowlist = `POST /api/voice/stt` alone) · ARCHITECTURE §7 now
  states loopback default AND the prod 0.0.0.0 waiver · D20 stamp fixed (built except QR) ·
  ROADMAP A2 marked shipped (the `question` builtin — don't rebuild it).
- **Prune (owner mandate):** dead ▶▶ NEXT blocks collapsed keeping their durable rulings;
  rot-prone literal counts → pointers (counts ONLY in QUALITY.md; eslint re-measured **107** —
  the P24 waves didn't re-measure, noted as a process lapse); ID-namespace convention recorded
  in `research/README.md` (research-R# ≠ review-R#; three unrelated F1s). HARDENING now flags
  Phases 22–24 + D72 as **unassigned** in its §7 inventory (it predates the first WebSocket).
- **Durable lesson (memory updated):** when closing a slice, sweep the plan's TOP (stamp +
  headings), not just its ladder — and a sweep that CLAIMS completeness (D72 ⑤ "all four") is
  itself a claim to verify (it was partial; now closed).

## Prior state (2026-09-16, TWENTY-SIXTH session — **THE INTERMISSION IS CLOSED: the owner ruled both D72 open decisions in conversation, the visible-word slice ran build → blind Emma round → red-proven pins, the dev units got the ws-ping 5/5 flags via `install.sh dev`, and EVERYTHING IS PUSHED. ▶▶ NEXT SESSION = S4 STRAIGHT (plan §7), clean — the owner calibration + device round = THE PHASE GATE**; supersedes below where it speaks)

- **The two rulings (owner, in conversation):** ① the fleet pending word IS visible text —
  built as `60316a1` (feat(fleet)): `transitionWord(online, pending)` beside `livenessWord`
  hands every surface the word ONLY while it names a transition (a server-confirmed wake is
  steady → nothing); kit + vapor rows' subtitle slot · cosmos's status pill · frontier's banner
  chip (each theme's own voice, "…"-suffixed) · gacha's card + poster chips now render
  `livenessWord` directly (the hand-rolled ladders read a pending shutdown as SLEEPING — their
  own inversion, closed) + `dossierSub` threads pending + **the `.state.pend` ribbon rung at
  every width** (SHUTTING DOWN is ~1.6× SLEEPING — it re-opens the measured 5★ collision above
  the 380px cutoff on the top rung). Steady copy byte-identical everywhere. ② `trusted_hosts`
  stays EMPTY/unmounted on this deploy — a built, documented feature awaiting a future owner
  opt-in, NOT a config item to fill now (both rulings recorded in the D72 addendum,
  DECISIONS.md).
- **The review:** blind Emma (hermes lane, self-contained) — **SHIP WITH FIXES**: runtime,
  byte-identity, gacha ranking and CSS geometry all verified sound (she measured 14.3px
  worst-case chip clearance in Chromium); her two LOW pins (the `.pend` rung source pin via the
  `cssRules` scanner + the poster SHUTTING DOWN arm) landed and red-proven against their named
  bypasses (deletion · move-inside-the-media-block · the restored ladder — all red). Confirm
  round ruled NOT warranted: test-only additions, her prescriptions, red-proofs are the proof.
- **⚠ For the owner's eyeball:** gacha pair cards now put WAKING/REBOOTING chips on the lower
  (ribbon) rung at ALL widths — previously only below 380px (the uniform transition-rung rule).
  Say the word if the look is wrong.
- **Ops:** `install.sh dev` re-ran (config already schema 3, no migration) — **both dev units
  RESTARTED with `--ws-ping-interval 5 --ws-ping-timeout 5` live in the unit** (health 200,
  Vite 200), so the R72 10 s slot-release + the ~14.1 s ladder pair is now REAL on dev for S4's
  phone round. Prod keeps the flags for the v1.7.8 release install, untouched v1.7.7 @
  `578ffa7`. Dev units left RUNNING (D69).
- **Gate 6/6 on the committed tree — FE 3,579/194 · BE 2,499** (counts in QUALITY.md). **PUSHED
  2026-09-16 (the owner's word this session): the whole 8-commit backlog** (the intermission
  wave `c41cdc2`·`a808b10`·`9693de6`·`e5eee89`·`8ca944d` + `16186e8` + `60316a1` + this docs
  commit); origin == local.
- **▶▶ NEXT SESSION: S4 (plan §7) — open it CLEAN.** Needs the OWNER + phone (afternoons): the
  §4.1 knobs · `barge_threshold`/Tier-0 threshold · `tail_wait_ms` vs the measured 530–830 ms ·
  `dictation_idle_s` feel · ring/hint feel · **`voice.live.enabled` flips ON as the round's
  close = the phase gate**; decision point fixed-endpointing vs architecture ② (§2.1). S4 also
  carries the wave's probes: the Honor-20 app-switch backlog · whether Serve preserves the 5 s
  ping cadence over the proxied WS · capture constraints · `METER_FULL_RMS`. Reminder for the
  poke round: the D70 imports are PUT now — hand-rolled multipart curl scripts must switch.
  Phase 23 S7 + v1.7.8 sequencing unchanged (release E after the roleplay features).

## Prior state (2026-09-15, TWENTY-FIFTH session — **THE INTERMISSION AUDIT + FIX WAVE (D72), owner-commissioned before S4: a 3-lane Opus audit of the whole v1.7.7→HEAD span ruled the architecture SOUND and surfaced 6 blockers; the full loop ran — R71/R72/R73 bought · adversarial plan review (7 amendments folded) · 3 implementer lanes · 2 review lenses + confirm rounds ALL RESOLVED · the gate green twice. ALL COMMITTED, UNPUSHED. ▶▶ NEXT SESSION = S4 unchanged (plan §7), which now also inherits the wave's probes**; supersedes below where it speaks)

- **What the wave fixed (the audit finding → the landed shape):** ① the 1000 ms too-short floor
  was DEAD with streaming dictation on (`heldMs` measured after the tail wait — the owner's "the
  STT is doing things"); now stamped on the `Clip` at `onstop`, red-proven. ② the call uplink
  ships through dictation's wall-clock bucket (shared `lib/uplinkPacer.ts`, dictation
  byte-identical), the call bounded DROP-OLDEST at `voice.live.call_backlog_ms` (1000; Conf row
  in Live call) with the relay's own `degraded` note on a drop — R71's ruling: the leg-kill's
  stale-speech rule + the server-side bound make lossless a relocation of the loss. ③ busy
  during a reconnect is a note-only no-op (the 1013 close that ALWAYS follows drives the one
  socketLost arm — one rung per refusal); ladder → 6 rungs ≈14.1 s over the R72-MEASURED 10 s
  slot hold at the new `--ws-ping-interval 5 --ws-ping-timeout 5` (all four launch files,
  qh9-§6-pinned; **prod picks the flags up at the next release install**); an all-busy ladder
  ends on "the last connection never let go". ④ SECURITY: both D70 imports are raw-body **PUT**
  (multipart POST was a no-preflight cross-origin owner-file write — R73), declared above their
  `{name}`/`{slug}` siblings (route shadowing), stream-read at cap+1; `postForm` deleted; the
  multipart pin is APP-WIDE (allowlist = `POST /api/voice/stt`); SECURITY_MODEL §2.9 is the
  record. ⑤ `server.trusted_hosts` BUILT, **ships EMPTY = not mounted** (D72 ⑥) — mounting is
  the owner's opt-in; closes R73's DNS-rebinding residual when set (example block +
  lockout warning in config.example.yaml). ⑥ every fleet surface's rendered control speaks
  `livenessWord` (five states incl. "shutting down"; the shutdown-INVERSION covered; gacha
  dossier + cosmos Ping ruled in) — accessible names only, the visible half deliberately
  unbuilt (owner's call if wanted). Plus W8: `app` logger follows `server.debug` (lifespan;
  root stays INFO — the 5 s pings would spam DEBUG), `_auto_route_agent` off the loop at both
  sites, lorebook warn-once, presence-tick gather isolation, config.example.yaml carries the
  D69 `wake:` + D71 dictation knobs.
- **Doc truth landed:** AGENTS/ARCHITECTURE SSE lines carry the one-WS exception; SPEC §6.2/§8.1/
  §8.2 know attachments + lorebooks + the WS; DESIGN pointer stubs; ROADMAP read-along default;
  D72; the §7/§13 addenda; ISS-13/14/15; QUALITY counts (BE 2,499 · FE 3,567/194).
- **PARKED to S4 (with the standing knobs):** capture constraints · `METER_FULL_RMS` · the
  Honor-20 app-switch backlog probe (does the stall class exist at all — R71 §4.3) · whether
  Serve preserves the 5 s ping cadence end-to-end (R72's open [U]) · the `dictation_idle_s`
  feel + the rest of the §4.1 sitting below.
- **Open owner decision:** flip `trusted_hosts` ON by filling the list (recovery = hand-edit
  config.yaml if a name is missed); and whether the fleet pending word should ALSO be visible
  text (currently screen-reader only).
- **SESSION CLOSED — the wave is 4 commits on main, tip `e5eee89`, UNPUSHED** (`c41cdc2` voice ·
  `a808b10` security/BE · `9693de6` fleet · `e5eee89` docs; each carries its whole review trail).
  Full gate green ×3 (last on the committed tree). **Dev units RESTARTED on the new code, health
  200 — leave them running (D69 presence).** ⚠ Two things the restart did NOT deliver: the
  ws-ping 5/5 flags live in the deploy TEMPLATES only — the installed dev/prod units pick them
  up at the next `install.sh dev` / release install (v1.7.8), so the 10 s slot-release number is
  not yet live anywhere; and `trusted_hosts` is empty ⇒ unmounted by design. **▶▶ NEXT SESSION
  opens on: PUSH (owner's word owed) → the owner's poke round on dev (imports now PUT — any
  hand-rolled multipart curl scripts must switch) → then S4 as pinned above, now also carrying
  the wave's probes (the Honor-20 app-switch backlog · Serve's ping cadence over the proxied WS).**
  The full audit→research→review record: memory `intermission-audit-2026-09-14` + D72 + the
  §7/§13 addenda; dossiers R71–R73.

## Prior state (2026-09-14, TWENTY-FOURTH session — **THE OWNER'S TEST ROUND CLOSED with both verdicts PASS: the long-recording bar rules verified in BOTH latch cases (pre-typed draft + empty composer) and streaming dictation "works well" over the Serve HTTPS chain. The one question — does Tier-0 auto-stop collide with streaming dictation? — was source-verified NO COLLISION (the stop the owner felt was `dictation_idle_s`, by design). Serve RESTORED to prod :5433, verified. Zero app code this session. ▶▶ NEXT SESSION = S4 (plan §7) — the owner calibration + device round = THE PHASE GATE**; supersedes below where it speaks)

- **The verdicts (the owner, in conversation; record folded into plan §7-S3.5's addendum as the
  round-close block):** ① the bar rules PASS — tested with text already in the composer (the
  latched `showSend`/frozen row) and without (send summoned only at release); ② streaming
  dictation PASS — phrases appending over the Serve → :5173 HTTPS chain, "works well".
- **The collision check (the owner's ask, source-verified — no code changed):** the energy poll
  rules in order — Tier-0's silence run is HARD-RESET every tick while a streaming session is
  live (§9.3-a; `useDictation.ts`'s poll block ③), so Tier-0 cannot fire mid-stream no matter
  the pause. What ended the owner's long-silence recording was the streaming session's own
  IDLE clock — `dictation_idle_s` (15 s, HANDS-FREE ONLY; the finger is the timeout while
  held; floor = `stt.auto_stop_threshold`, 0 disarms it) — closing via the ordinary release,
  appended phrases kept; `dictation_max_s` (120 s) bounds the socket regardless. The owner's
  dev Tier-0 (they flipped auto-stop ON at 5 s for the round) never firing across long pauses
  is live proof of the suspension. Ambient noise can only DELAY the idle stop (above-floor
  readings reset the clock), never cause it. The floor + `dictation_idle_s` ride the S4
  calibration sitting.
- **Ops:** Tailscale Serve RESTORED to prod — `tailscale serve --bg 5433`, verified 200 +
  health v1.7.7. Both dev units RUNNING (D69 — do NOT stop them). Dev config now: `dictation`
  ON · `enabled` OFF · **`stt.auto_stop` ON @ 5 s** (the owner's round toggle, left as they
  set it) · `allowed_origins` keeps the Serve origin as the belt.
- **▶▶ NEXT SESSION: S4 (plan §7) — the owner calibration + device round = THE PHASE GATE**
  (needs the OWNER + phone, afternoons): the §4.1 knobs · `barge_threshold`/Tier-0 threshold ·
  `tail_wait_ms` vs the measured 530–830 ms · `dictation_idle_s` feel · ring/hint feel ·
  **`voice.live.enabled` flips ON as the round's close**; the decision point: fixed
  endpointing good → v1 stands, sluggish → architecture ② gets designed (§2.1). The Serve
  Host-header item is DONE. Phase 23 S7 + v1.7.8 sequencing unchanged (release E after the
  roleplay features).
- Git: **this docs commit is the only delta over the pushed tip** (the push ruling stays the
  owner's); tree clean at write. **Prod untouched v1.7.7 @ `578ffa7`.** FE 3,519/192 · BE
  2,480 unchanged.

## Prior state (2026-09-14, TWENTY-THIRD session — **the PUSH landed (46 S0→S3 commits) · S3.5 council-CLOSED (dictation DECOUPLED from the call: gate = `enabled OR dictation`, the four dictation Conf rows now in Voice · STT) · then the owner's LIVE PHONE ROUND ran and produced TWO more council-CLOSED waves the SAME session: the WORKLET GATE (streaming dictation was DEAD on plain HTTP — AudioWorklet is secure-context-only; the Serve→dev HTTPS chain verified end to end, and the S4 Serve Host-header question ANSWERED: the same-host rule passes with allowed_origins EMPTY) and the LONG-RECORDING BAR RULES (the anchor tracks the button finger-free · the row FREEZES while recording). Everything through Emma blind rounds → waves → confirms, all RESOLVED — SHIP, sweeps "none". ⚠ OPS: Tailscale Serve fronts DEV :5173 for the owner's still-running test round — RESTORE `tailscale serve --bg 5433` when it ends. ▶▶ NEXT SESSION opens on the owner's test verdicts → then S4**; supersedes below where it speaks)

- **S3.5 (council-CLOSED; record = plan §7-S3.5):** the owner's question "is live dictation
  call-only?" surfaced the latent gate coupling. Shipped: the WS route + `live_ear` admit on
  `configured("live") AND (enabled OR dictation)` (mirror intact; the `live` CALL bit untouched
  — dictation alone never shows the call door); the dictation four render in Conf **Voice ·
  STT** (grouping only, keys stay `voice.live.*`; one-home rule pinned). Emma 1M·3L → wave →
  confirm RESOLVED — SHIP. Commits `6b8b6b4` · `13b664c` · `8409bd1` (+ `afbfa14`/`4be81c6`
  docs).
- **THE WORKLET GATE (owner's round, finding 1 — record = plan §7-S3.5 addendum):** on plain
  HTTP every streaming leg died accept→close in the same second (`start` never processed) and
  silently degraded to whole-clip — **`AudioWorklet` is SECURE-CONTEXT-ONLY (MDN)**; the mic
  pref that lets Fennec/Chrome capture on plain HTTP does not unlock worklets. The feature
  itself was proven sound twice (a relay probe + a real-browser probe through the whole app —
  ready/VAD/finals/flush/either-or all correct). Shipped (`28fbe3a`): `armDetector` declines
  the leg up front when `ctx.audioWorklet` is absent (no doomed socket) + the degrade names
  the reason on `isSecureContext === false` ("needs HTTPS"). **Ops that made the phone work:
  Serve → :5173 (HTTPS), `voice.live.allowed_origins` got the Serve origin on dev as a belt —
  and the measurement says the belt is NOT needed (same-host passes through Serve+Vite; Host
  preserved end to end) — the S4 §8 empiricism is CLOSED.**
- **THE LONG-RECORDING BAR RULES (owner's round, finding 2 — record = plan §7-S3.5 addendum):**
  the S0.5 measure-once anchor died with its premise once S2.5 made recordings long — the
  keyboard collapse + appended-phrase reflows left the record circle floating ("two mic
  buttons", the circle over the send button). Shipped (`3780476` + Emma wave `34f00e4`, 3M·1L
  all accepted): ① the anchor TRACKS the button while the chrome stands FINGER-FREE
  (locked/chip only — her F2: a held gesture is finger-relative BY DESIGN; catch-up read on
  arming; RO on THE BAR not the `.kit-main` host (F1) + visualViewport + window resize, one
  rAF); ② the ROW FREEZE in LineComposer — `showSend` latches at record start (a latch, not a
  hide), the stack decision AND its hysteresis baseline freeze with it (F3); the D39 Stop
  morph waits for release (owner-accepted trade). Confirm: all four VERIFIED, sweep "none" —
  RESOLVED — SHIP.
- **Gate 6/6 at the tip — FE 3,519/192 · BE 2,480** (counts in QUALITY.md). **Everything
  PUSHED at session close** (through the bar-rules docs commit); prod untouched v1.7.7 @
  `578ffa7`.
- **⚠ DEV STATE for the owner's round (still running at handoff):** both dev units RUNNING
  (D69); :5434 on the S3.5 tip; :5173 serves all fixes via HMR. Dev config: `voice.live
  .dictation` ON · `enabled` OFF · STT auto-stop OFF (owner's toggles) · `allowed_origins` =
  the Serve origin. **Serve fronts :5173 — restore `tailscale serve --bg 5433` when the round
  ends.** The owner tests at `https://emma.lobster-vector.ts.net`.
- **▶▶ NEXT SESSION: open on the owner's test verdicts** (they kept testing after handoff —
  expect feel findings on the bar rules + streaming dictation; fold, then the ordinary ladder)
  **→ S4 (plan §7) = the owner calibration + device round = THE PHASE GATE** (§4.1 knobs ·
  `barge_threshold`/Tier-0 · `tail_wait_ms` vs the measured 530–830 ms · ring feel ·
  `voice.live.enabled` flips ON as the close; the Serve Host-header item is DONE). Phase 23
  S7 + v1.7.8 sequencing unchanged (release E after the roleplay features).

## Prior state (2026-09-14, TWENTY-SECOND session — **S3 (interruption hardening) RAN THE STANDING CADENCE WITH TWO CONFIRM ROUNDS and is council-CLOSED: pinned Opus build → main-seat audit (4 deviations ACCEPTED) → blind Emma SHIP WITH FIXES (2 MED, sweep "none") → fix wave → confirm BLOCKED (both MEDs survived at a boundary) → main-seat micro-wave №2 → №2 RESOLVED — SHIP, sweep "none". ▶▶ NEXT SESSION = S4 (the owner calibration + device round = THE PHASE GATE + the `enabled` flip) — it NEEDS THE OWNER + phone**; supersedes below where it speaks)

- **S3 is council-CLOSED (full as-built record = plan §7-S3 — read THAT before S4):** the
  Fennec EAR-HOLD (`PcmCapture.setHeld`, ONE rule `enabled = !(muted||held)`, frames keep
  flowing as silence; `earHoldMode` lands once via `captureReady` — `auto` = readback ≠ `"all"`
  per track, never UA-sniffed; `earHeld` DERIVED in one normalize, `mode && mouthLive &&
  !killing`; VAD/final guards widened to `muted || earHeld`; **the PRE-PLAY TAP** —
  `setCallPrePlay` + the ONE `startEl` chokepoint, the ear closes BEFORE the mouth asks the
  element to play) · `mouthLive` (the observed transport truth, orthogonal to the phase —
  `ready` lands on `speaking` while it holds, `barge` gates on `mouthLive && !killing`, **the
  reconnect owns the phase while the leg is down**) · the F4/F5/F6 race sweep + two flaky-link
  e2e arms (liveCall 16 → 20) · `transport()`'s bare `play()` caught · the dictation release's
  hidden-page tail wait closed by ABANDONMENT (the tail-wait theorem intact).
- **The cadence, two confirm rounds:** build `fd7fee2` (pinned Opus, +849/−48, 9 red-proofs) →
  audit (the stranded-flag walk; 4 deviations ACCEPTED) → blind Emma **SHIP WITH FIXES 2M
  sweep "none"** → wave `7a298ff` (killSettled consults the mouth · the watcher became a
  SYNCHRONOUS store subscription) → confirm **BLOCKED ×1, both survived**: ⚠ the durable pair —
  `playbackStarted` was the ONE arm repainting `connecting → speaking` (two arms disagreeing
  about who owns the screen IS a defect), and **observation cannot beat the audio thread**
  (same-task-as-EVENT ≠ before-AUDIO; what must precede audible output runs BEFORE the API
  call that starts it) → micro `850d530` (the connecting-preserve + the pre-play tap, both her
  prescriptions in lean form — no third gate slot needed, the play()→event gap cannot
  transition `earHeld`) → **№2: both RESOLVED with line proof, sweep "none" — RESOLVED —
  SHIP.** The S2.5 meta-lesson (a boundary held twice ⇒ the class moves) applied one round
  early this time.
- **Gate 6/6 at every tip — FE 3,513/192 · BE 2,476 (unchanged, S3 was FE-only)** (counts in
  QUALITY.md). Both dev units RUNNING (D69 — do NOT stop them); :5173 serves the whole slice
  live; :5434 unchanged on the S2.5 tip. **⚠ `voice.live.enabled` AND `voice.live.dictation`
  still default OFF** — the Conf "Live call" section flips them for a dev poke.
- **▶▶ NEXT SESSION: S4 (plan §7) — the owner calibration + device round, THE PHASE GATE. It
  needs the OWNER + the phone (afternoons)**: real rooms noisy and quiet · the §4.1 knobs
  (`vad_threshold`/`silence_ms`/`min_speech_ms`) + `barge_threshold`/Tier-0 auto-stop
  calibrated in one sitting · `tail_wait_ms` tuned against the measured 530–830 ms ·
  ring/hint feel · the Serve Host-header empiricism (`allowed_origins` = the escape) ·
  **`voice.live.enabled` flips ON as the round's close = the phase closes**; the decision
  point: fixed endpointing good → v1 stands, sluggish → architecture ② gets designed (§2.1).
  Phase 23 S7 + v1.7.8 sequencing unchanged (release E after the roleplay features).
- Git: **PUSHED 2026-09-14 (the owner's word)** — the whole 46-commit S0→S3 backlog over
  `b946fc1` (through `a89a54d` + this push-note commit); origin == local after the push; tree
  clean. **Prod untouched v1.7.7 @ `578ffa7`.** The owner opened their OWN live test round on
  dev right after the push (S4 is still the formal calibration sitting — their findings land
  next session).

## Prior state (2026-09-14, TWENTY-FIRST session — **S2.5 (phrase streaming dictation) RAN THE STANDING CADENCE WITH FOUR CONFIRM ROUNDS and is council-CLOSED: pinned Opus build → main-seat audit rider → blind Emma SHIP WITH FIXES (5 MED, sweep "none") → fix wave → three F1 chases ending in a DELETION (the tail wait is the FLAT bound) → №4 RESOLVED — SHIP. ▶▶ ~~NEXT SESSION = S3~~ done, see above**; superseded above where it speaks)

- **S2.5 is council-CLOSED (full as-built record = plan §7-S2.5 — read THAT before S3/S4
  work):** the mic's hold/lock rides the SAME ear as calls — finals append to the draft at
  every pause; release = flush → **the FLAT `tail_wait_ms` wait** → stop → close; the
  either/or (≥1 phrase appended ⇒ clip discarded · 0 ⇒ today's upload, never both);
  `attachPcmUplink` on the recorder's OWN stream + the detector's context (never a second
  getUserMedia); ONE FIFO + ONE wall-clock token bucket under the relay's budget; §9.3 all
  three (Tier-0 suspended · hidden-page unconditional · idle/max on the one poll); the
  `onPending` chrome pulse; the caret save/restore (the R70 §5 collapse MEASURED real in a
  new e2e probe first, `input`-snapshotted for Gboard). BE: `LiveCfg` +4 (`dictation` OFF ·
  `tail_wait_ms` 2000 · idle 15 · max 120) in `live_call`, Conf rows in the S2b section, and
  **the new `live_ear` bit mirroring the WS route gate exactly** (no TTS term — dictation
  needs no mouth). Pinned omissions: `pause_flush_ms` · the three-word auto-send floor · any
  mid-session reconnect (the clip fallback IS the retry).
- **The cadence, four confirm rounds:** build `801309f` (pinned Opus, +2234/−82, 24
  red-proofs; the caret [U] probed before mitigating) → audit rider `1de1cf0` (the narrated
  unmount belt actually written, guarded) → blind Emma **SHIP WITH FIXES 5M sweep "none"** →
  wave `a3c3f1e` → confirm BLOCKED ×3, F1 chased through a count (`192f77f`, + synchronous
  flush truth + the release drains its queue) and a settle window (`ac39675`) to the ROOT →
  `b3d76f1` (main-seat, **+99/−299**): **⚠ THE TAIL-WAIT THEOREM, recorded at the wait —
  `flush` has no ack and the wire has no completeness marker, so NO ledger event may resolve
  the release wait; the S1 lesson applied (an optimization needing state the protocol cannot
  give gets DELETED); the one sound early exit is a DELIVERED close** → **№4: RESOLVED —
  SHIP, sweep "none"** (Emma's line proof + her ruling that the simplified honesty toast
  extends her own accepted rule). ⚠ The durable meta-lesson: a reviewer blocking the SAME
  finding at three boundaries is proving the mechanism CLASS unsound — rule on the root and
  delete, don't tighten.
- **Gate 6/6 at every tip — FE 3,471/192 · BE 2,476** (counts in QUALITY.md). Both dev units
  RUNNING (D69 — do NOT stop them); the dev backend was restarted onto the build tip
  (`live_ear` + the four knobs live on :5434); :5173 serves the whole slice. **⚠
  `voice.live.enabled` AND `voice.live.dictation` both default OFF** — a dev poke flips both
  from the Conf "Live call" section; ⚠ the release costs a flat `tail_wait_ms` (2 s default)
  of `sending` — the S4 sitting's knob, tuned against the measured 530–830 ms release→final.
- **▶▶ NEXT SESSION: S3 (plan §7)** — interruption hardening: the §4.3 ordered cancel-settle
  contract · the buffered-final race (F4) · playback-would-start-while-speaking (F5) · the
  Fennec EAR-HOLD branch (S0's echo ruling) · flaky-link reconnect/backpressure edges (F6).
  Then S4 (owner calibration = the phase gate + the `enabled` flip; S2.5's knobs join that
  sitting's list). One slice per session, the standing cadence. Phase 23 S7 + v1.7.8
  sequencing unchanged (release E after the roleplay features).
- Git: **41 commits unpushed over origin `b946fc1`** (the 34 + `801309f` · `1de1cf0` ·
  `a3c3f1e` · `192f77f` · `ac39675` · `b3d76f1` + this docs commit); tree clean at write; the
  PUSH ruling stays the owner's. **Prod untouched v1.7.7 @ `578ffa7`.**

## Prior state (2026-09-14, TWENTIETH session — **S2b (presentation + furniture) RAN THE WHOLE STANDING CADENCE IN ONE SESSION and is council-CLOSED: pinned Opus build → main-seat audit found + fixed the UNMOUNT FENCE hole → blind Emma SHIP WITH FIXES (3 MED, sweep "none") → fix wave → her confirm RESOLVED — SHIP, fix-sweep "none". ▶▶ NEXT SESSION = S2.5 (phrase streaming dictation), then S3 → S4**; superseded above where it speaks)

- **S2b is council-CLOSED (full as-built record = plan §7-S2b — read THAT before S2.5/S3
  work):** the RING both modes (`focalLanding`/`useFocalAnchor` — the cover-clamped landing
  math, overlay-local off ONE ResizeObserver per F9; JS places only the center, geometry =
  CSS knobs; state animates the stroke, motion-gated; no-ring = the heard-line dot; ONE
  indicator per mode) · MUTE (`PcmCapture.setMuted`, frames keep flowing; the ratified
  reducer rules — mute condemns the half-utterance, finals-while-muted drop FLAT; static
  muted look, "Muted" outranks the listening copy) · the in-overlay Allow/Deny CONFIRM ROW
  (`confirmAwaiting` beside `confirmOutstanding`, one scan; rides `resumeCall` — the same
  chokepoint + token; a QUESTION holds but earns no row) · TERMINAL FACES + REDIAL (the door
  hoisted to `store/liveCall.startCall()`; redial = `seq` bump → the shell's `key` remount) ·
  the BACK-TRAP (`useOverlayBackGuard` at the SHELL — measured: a key remount loses the
  guard's entry when mounted per-machine; call-lifetime ownership kills the race) · degraded
  hysteresis (`DEGRADED_NOTE_MS`) · the MiniPlayer transport riding published INTENT
  (`playIntent`; the S2a status/intent doctrine applied to its face) · **the Conf "Live call"
  section (§5.1)** — toggles + LiveCfg-bounded numerics + the provider ref (a main-seat
  scope addition; no ladder slice owned the ratified Settings rows).
- **The cadence:** build `3461975` (pinned Opus, +1756/−163; 3 deviations, all ACCEPTED) →
  main-seat audit **found the unmount-fence hole** (the shell's `endCall` exit skipped the
  reducer, so an in-flight `final`/`killSettled` could SUBMIT after the owner closed the
  call) → rider `29d7b65` (the `unmounted` signal: gen moves on EVERY exit, `close:false`
  so a redial's remount survives) → blind Emma (hermes lane, detached `setsid` + monitor —
  ⚠ harness-BACKGROUNDED long tasks were killed 3× this session; the detached pattern is
  the one that survives) **SHIP WITH FIXES — 3 MED, sweep "none"** (ring math · exit paths
  incl. the rider · confirm row · Conf section all verified sound) → wave `461a025` (mute
  applied to the track on ACQUISITION resolve · `seekChunked` rides `wantPlay` not status ·
  `ready` retracts only the strained note) → her self-contained confirm: **all three
  RESOLVED with line proof, fix-sweep "none" — RESOLVED — SHIP.** ⚠ The durable class (the
  plan block has it): **an exit that skips the reducer is an exit that skips the fence** —
  and Emma's three were the same family at other seams (a rule change with no object to
  apply it to; intent still derived from status at one seam; an unconditional clear).
- **Gate 6/6 at every tip — FE 3,406/190 · BE 2,462 · liveCall e2e 16/16** (counts in
  QUALITY.md; eslint 101, net zero). Both dev units RUNNING (D69 — do NOT stop them); S2b is
  FE-only, :5173 serves it live; :5434 unchanged on the S1 tip. **⚠ `voice.live.enabled`
  still defaults OFF** (S4's flip) — but the Conf "Live call" section now exists, so a dev
  poke can flip `enabled` (+ `ring`) from the phone when the owner wants to feel S2a+S2b.
- **▶▶ NEXT SESSION: S2.5 (plan §7-S2.5)** — phrase-by-phrase streaming dictation on the S1
  relay's `flush` (release = flush → await final → stop, NEVER commit; R70's 3 s VAD floor
  tempers the feel). Then S3 (interruption hardening + the Fennec ear-hold) → S4 (owner
  calibration, the phase gate + the enabled flip). One slice per session, the standing
  cadence. Phase 23 S7 + v1.7.8 sequencing unchanged (release E after the roleplay features).
- Git: **34 commits unpushed over origin `b946fc1`** (the 30 + `3461975` · `29d7b65` ·
  `461a025` + this docs commit); tree clean at write; the PUSH ruling stays the owner's.
  **Prod untouched v1.7.7 @ `578ffa7`.**

## Prior state (2026-09-13, NINETEENTH session — **S2a (the FE call loop) RAN THE STANDING CADENCE TWICE AROUND IN ONE SESSION and is council-CLOSED: blind Emma SHIP WITH FIXES (6 MED, sweep "none") → fix wave (+2 main-seat) → rider → confirm BLOCKED ×2 (one defect class, chased to its root) → two main-seat micro-waves → RESOLVED — SHIP. ▶▶ NEXT SESSION = S2b (presentation + furniture) — or S2.5, the build session's call**; superseded above where it speaks)

- **S2a is council-CLOSED (full as-built record = plan §7-S2a — read THAT before S2b/S2.5
  work):** the whole FE call loop — `useLiveCall` (pure `callReduce`: phases + the two
  orthogonal flags, §4.2's iron rule, the ONE generation-fenced pending queue draining as ONE
  message, the ordered kill awaiting `cancelTurn`'s settlement, hang-up-discards vs
  error-harvests) · the pcm16 capture worklet (Blob'd — `?worker&url` measured broken both
  ways) · the typed WS leg (start-first; `bufferedAmount + frame > ceiling` ⇒ close 4000) ·
  the chat-store F3 seam (`getLiveTurn`/`cancelTurn`/`confirmOutstanding`; `stopTurn` re-based;
  **normalize-on-202 heals TYPED text during `awaiting_confirm` too**) · the F8 `SendOutcome` ·
  `sendCallTranscript` (no sigils, draft untouched, staged attachments ride) · the
  audioController call surface (`primeAudio` in-gesture; the read-along override as a
  WAIT-UNTIL-FIRST-SETTLE GATE, not an id; `useMouthFailures`; the HONEST mouth status —
  "playing" only from the real `play` event) · the minimal `CallOverlay` (full-bleed
  `useActiveBackdrop` art, z 55, focus-trapped, Wake Lock, hidden ⇒ clean end; tap = trigger
  B) · **the call DOOR: `startCall` = dismiss → prime → open** (answering a call silences
  pre-call playback — no session, no phantom status survives into the machine). Trigger A
  (voice barge) arms only on `barge_in` AND `echoCancellation:"all"` (the S0 ruling); the
  Fennec EAR-HOLD stays S3.
- **The cadence, twice around:** build `83d8e63` (pinned Opus, +3336/−58, 19 red-proofs) →
  main-seat audit (6 deviations ACCEPTED) → blind Emma **SHIP WITH FIXES (6 MED, sweep
  "none")** → wave `d40ee0d` (her six + the main seat's two) → rider `ff986ed` (the second
  latch + the gap-pause) → confirm **BLOCKED** → micro `08e3533` (intent rides `wantPlay`) →
  micro-confirm **BLOCKED** (the carried pre-call seek — a reachability ruling must count
  state carried ACROSS the boundary) → micro №2 `8496c32` (the door) → **№3: RESOLVED — SHIP**
  (full generation-guard walk; the auto-TTS knock-on ruled benign — a bare `dismiss()` arms
  the feeder's `abandoned`; sweep = comment drift only, folded in this docs commit). ⚠ The durable
  class: **an intent published as playback STATUS is a lie some consumer eventually trusts** —
  status = what the element is DOING, intent rides `wantPlay`; every silent-"playing" window
  traced to this one class.
- **Gate 6/6 at every tip — BE 2,462 · FE 3,356/189** (counts in QUALITY.md). Both dev units
  RUNNING (D69 — do NOT stop them); S2a is FE-only, :5173 serves it live; :5434 unchanged on
  the S1 tip. **⚠ `voice.live.enabled` still defaults OFF** — the call door stays hidden until
  it is flipped (S4's close is the designed flip; a dev poke can flip it via the settings
  seam/YAML earlier if the owner wants to feel S2a).
- **⚠ Hermes emma-lane ops (owner: "note the issues") — recorded in the second-opinion SKILL +
  memory:** the CLI DOUBLE-FORKS (a premature "exited, 0 bytes" is the tell; take the OLDEST
  matching PID; the COMPLETION signal is the output file going non-empty — a lingering
  same-argv worker can outlive the finished run) · `-z --ignore-rules` persists NO session ⇒
  `--resume latest` silently dies — confirm rounds must be SELF-CONTAINED.
- **▶▶ NEXT SESSION: S2b (plan §7-S2b)** — ring modes + focal anchor · mute · the in-overlay
  confirm row · terminal faces · back-trap · the remaining §4.5 rules; §7-S2a's residuals list
  is the checklist. (S2.5 slotting vs S2b stays the build session's call, per the ladder.) One
  slice per session, the standing cadence. Phase 23 S7 + v1.7.8 sequencing unchanged (release
  E after the roleplay features).
- Git: **30 commits unpushed over origin `b946fc1`** (the 24 + `83d8e63` · `d40ee0d` ·
  `ff986ed` · `08e3533` · `8496c32` + this docs commit); tree clean at write; the PUSH ruling
  stays the owner's. **Prod untouched v1.7.7 @ `578ffa7`.**

## Prior state (2026-09-13, EIGHTEENTH session — **S1 (the BE relay) RAN THE WHOLE STANDING CADENCE IN ONE SESSION and is council-CLOSED: blind Emma SHIP WITH FIXES → fix wave → confirm BLOCKED on a mirror race → two main-seat waves → RESOLVED — SHIP, sweep "none" ×2. ▶▶ NEXT SESSION = S2a (the FE call loop)**; superseded above where it speaks)

- **S1 is council-CLOSED (full as-built record = plan §7-S1 — it IS the S2a/S2.5 wire
  contract; read THAT before any S2a work):** `voice.live` config (`LiveCfg` on the house
  provider/model/fallbacks shape — blank provider rides `voice.stt`'s section; every numeric a
  bounded Field) · the `live` bit + `live_call` knobs on `GET /voice/status` (bit = chain AND
  TTS AND `live.enabled`; master outranks) · `WS /api/voice/live` (the first WebSocket, D71's
  narrow admission; Origin rail = same-host + `allowed_origins`, pre-accept; typed `busy`+1013
  post-accept) · the relay session (`services/voice_live.py`: three pumps, bounded drop-oldest
  queue, stateful exact-rational `Pcm16Resampler` in `core/audio.py`, the §7-S0 pinned wire —
  full 5-field `turn_detection`, spurious-error swallow, text-frames-only uplink, 403-vs-1006
  taxonomy, bearer never in logs) · **COMMIT-SAFETY in the strongest form: the relay never
  sends `commit` on any path** (R70 arm A, red-proven).
- **The cadence:** build `beead72` (pinned Opus, +2342/−19, 77 new tests, 11 red-proofs) →
  main-seat audit (nine deviations ACCEPTED; gate re-run) → **blind Emma SHIP WITH FIXES (4
  MED, sweep "none"; the S0 blind debt rode the round — the smoke tool passed her light
  pass)** → wave `0fb7c56` (pinned Opus: the flush DELIVERY BARRIER via task_done/join · the
  per-frame duration cap + rolling ms budget (F4) · the origin-rail honesty note) → her
  confirm **F1/F2/F4 RESOLVED + F3 BLOCKED on the MIRROR ordering** (an UNPROCESSED
  `committed` left the fed-count stale-HIGH → a 900 ms burst under the 3 s floor → words
  lost) → main-seat waves `24336eb`+`a01ae76`: **⚠ the flush burst is now the CONSTANT
  `max(3000, silence_ms) + 200` (AMENDS R70 §4) and `_fed_ms` is DELETED** — a per-buffer
  count off an uncorrelatable event stream is stale in BOTH directions; the optimization WAS
  the bug (net −6 lines) → **her micro-confirm: RESOLVED — SHIP, sweep "none"** (she re-ran
  the 73-arm suite herself).
- **F1 ruling recorded:** the same-host Origin rule doesn't stop DNS rebinding — but rebinding
  bypasses the app's ENTIRE no-CORS HTTP surface equally (pre-existing class), so the route
  adds no new authority; Emma concurred the scoping is honest. App-wide fix = the
  already-recorded **D65-R1** (TrustedHostMiddleware), Phase 19's court.
- **Gate 6/6 ×4 this session — BE 2,462 · FE 3,241/181** (counts in QUALITY.md). Both dev
  units RUNNING (D69 — do NOT stop them); **the dev backend :5434 was restarted onto the tip**
  so the S1 surface exists on dev (`voice.live.enabled` defaults OFF — nothing owner-visible
  until S2a; the S4 round flips it).
- **▶▶ NEXT SESSION: S2a (plan §7)** — capture worklet + WS client + `useLiveCall` + minimal
  overlay + basic barge-in; **plan §7-S1's as-built block = the wire contract** (S2a
  gotchas recorded there: Vite proxy needs `ws: true` · the Serve Host-header question is
  empirical, `allowed_origins` is the escape · flush has NO ack · `stop` discards
  unendpointed audio). Then S2b → S2.5 (R70 §9; `tail_wait_ms` etc. are S2.5 client config) →
  S3 → S4. One slice per session, the standing cadence. Phase 23 S7 + v1.7.8 sequencing
  unchanged (release E after the roleplay features).
- Git: **24 commits unpushed over origin `b946fc1`** (the 19 + `beead72` + `0fb7c56` +
  `24336eb` + `a01ae76` + this docs commit); tree clean at write; the PUSH ruling stays the
  owner's. **Prod untouched v1.7.7 @ `578ffa7`.** ⚠ Ops lesson (recorded in plan §7-S1):
  `setsid cmd` FORKS — liveness-check the child PID, never the wrapper's (two ghost Emma
  runs were killed by PID mid-session after this bit).

## Prior state (2026-09-13, SEVENTEENTH session END — **S0.5 IS CLOSED BY THE OWNER'S WORD after THREE live feel rounds, every wave through the full cadence to RESOLVED — SHIP. ▶▶ NEXT SESSION = S1 (the BE relay), with ONE question open for the owner first: streaming dictation (plan §8 item 5, AWAITING THEIR WORD)**; superseded above where it speaks)

- **S0.5 CLOSED (the owner: "okay looks good, lets handoff") — the full three-round trail lives
  in plan §7-S0.5's three wave blocks; read THOSE before touching any gesture surface.** The
  session ran the owner's feel iteration LIVE: round 1 (OF-1..5: grow 1.8 · pill compress ·
  the REAL level halo w/ metering split from policy · the tailed bubble · the tools-trigger
  cancel morph, owner-corrected from the paperclip; waves `c654834`+`127234a` — review caught
  the hidden-page-stop regression: locking the phone killed default-mode recordings) → round 2
  ("much better" + five nudges: grow 1.65 · the TRUE-STADIUM pill — height tracks `--mg-lift`,
  a RECORDED §14.11 exception w/ `contain: layout` fence · hint 8px · ✕ 18px/2.6 · the
  placeholder YIELDS while recording via `body:has()`; `c057459`+`c81780c`) → round 3 (four:
  borderless pill — then the review measured it INVISIBLE on light themes ⇒ the soft-shadow
  rider · the clip-path triangle tail replacing the alpha-doubling square · **a WRITTEN draft
  lifts the slide-to-cancel above the bar** (the owner's design) · bulge 0.35;
  `484102d`+`0d1d429`). Emma's verdicts all ended RESOLVED — SHIP; she pixel-measured the
  shadow fix herself.
- **⚠ Durable lessons recorded in the plan blocks:** a metering-from-policy split must
  enumerate EVERY decision the old arming carried (the hidden-page stop rode along) · source
  pins must hold EXACT expressions + sweep EVERY rule mentioning the selector + be red-proven
  against the named bypass — fragment checks admit fakes (a 4-point polygon passed "any
  polygon") · a one-axis scale can never give a stadium — the pill's height IS the mechanism.
- **Gate 6/6 at every tip — final counts FE 3,241/181 · BE 2,377** (QUALITY.md). Both dev
  units RUNNING (D69 — do NOT stop them); :5173 serves the closed S0.5 live.
- **STREAMING DICTATION: RULED + RESEARCHED same session (owner: phrase-by-phrase YES — a
  planned feature = the new ladder slice S2.5; word-by-word stays on the §2.1 S4 trigger).**
  [R70](research/R70-phrase-streaming-dictation.md) bought (Opus pass, first-party measured
  on emma; main seat source-verified both record-amending claims): **⚠ it AMENDS the §7-S0
  pinned contract — a commit while speech is OPEN kills the session at 1006, words lost**
  (S0 proved only the silence case; the relay needs a COMMIT-SAFETY invariant + a `flush` =
  a relay-side silence burst, release→text 530–830 ms measured) — **and the VAD has a 3 s
  buffer floor: short phrases COALESCE** (latency `max(silence_ms, 3000 − phrase_ms) + ~0.5 s`
  — binds the CALL loop's feel too). Join problem already solved (Parakeet finals are cased +
  punctuated; `appendDraft` is right — build nothing). Both amendments folded into §7-S0/§7's
  S1+S2.5 bullets; the full field dissection + §9 recommendation = R70.
- **▶▶ NEXT SESSION: S1 (the BE relay)** — `voice.live` config + `/voice/status` delivery +
  the WS route + the relay session; **the §7-S0 pinned contract AS AMENDED BY R70 is the
  mock's spec** (commit-safety + `flush` are now S1 scope); the S0+S0.5 blind debt on the
  probe pages rides S1's round. One slice per session, the standing cadence. Then S2a → S2b →
  S2.5 (off R70 §9) → S3 → S4. Phase 23 S7 + the v1.7.8 sequencing unchanged (release E after
  the roleplay features).
- Git: **19 commits unpushed over origin `b946fc1`** (through the final docs commit); tree
  clean at write; the PUSH ruling stays the owner's. **Prod untouched v1.7.7 @ `578ffa7`.**

## Prior state (2026-09-13, SEVENTEENTH session mid — **the owner's S0.5 FEEL ROUND landed FIVE findings live in conversation (OF-1..OF-5, each restated + confirmed, one mid-design correction) → the wave ran the whole cadence same session and is council-CLOSED**; superseded above where it speaks)

- **The owner's feel round (in conversation, plain-language restatement + confirm before
  building):** ① the record circle too big → **1.8×** (one `--mg-grow-scale` knob) · ② the
  lock pill "compresses into a circle" as you swipe (their Telegram reference; NO bobbing
  chevron) · ③ a REAL "you're talking" indicator (owner picked real over fake; ruled distinct
  from the DECLINED call-ring amplitude item — this is the user's own mic while dictating) ·
  ④ the hint becomes a Telegram-style BUBBLE: right above the button, small tail toward it,
  translucent, NO border — and the too-short teaching moves into it (the top-of-screen toast
  goes) · ⑤ the locked CANCEL = an existing button MORPHING — **owner-corrected mid-design
  from the paperclip to the TOOLS-MENU trigger** ("the menu button at the other side"), which
  is also always-composed in all three variants (the tap twin exists by construction).
- **The wave is council-CLOSED (full record = plan §7-S0.5's FEEL-ROUND WAVE block):** build
  `c654834` (pinned Opus; 13 red-proofs + a real-engine calc probe; headline mechanisms: the
  metering/policy SPLIT in `useDictation` + the assignable `meter`/`onTooShort` refs +
  `--mg-level` written imperatively at 10 Hz · the new `store/micCancel` single-nullable-slot
  store joining the gesture to the trigger · `MicAnchor.rx` for the bubble tail; builder catch:
  the briefed 0.5 halo bulge measured INVISIBLE inside the 1.8 disc — shipped R69 §1.6's
  verbatim 0.73) → main-seat audit (3 deviations ACCEPTED: ellipse-at-rest pill trade ·
  the 0.73 bulge · call-glyph in the compressed circle, ships dark) → **blind Emma SHIP WITH
  FIXES 2M, sweep "none"** → main-seat fixes `127234a` (**F1: the split had dragged the
  hidden-page stop along — locking the phone killed a default-mode recording; the visibility
  listener is now POLICY-gated** · F2: an open tools sheet survived the morph — the trigger
  releases the `menu` overlay while morphed), both red-proven → **her confirm: RESOLVED —
  SHIP, sweep "none".**
- **Gate 6/6 ×2 this session — FE 3,230/181 · BE 2,377** (counts in QUALITY.md). ⚠ Durable
  lesson recorded in the plan block: a metering-from-policy split must enumerate EVERY
  decision the old arming carried — the hidden-page stop rode along invisibly.
- **ROUND 2 ran same day (the owner's glance: "much better" + five nudges, built main-seat,
  council-CLOSED — full record = the plan block's ROUND 2 addendum):** grow → **1.65** · the
  pill re-shaped to a **TRUE STADIUM** (a real height tracking `--mg-lift` under full radius —
  ⚠ a RECORDED §14.11 exception, composer-auto-grow precedent, `contain: layout` fence; the
  round-1 ellipse rejected by eye) · hint gap 15→8px · the ✕ 18px/2.6-stroke · **the composer
  placeholder YIELDS while recording** (`body:has()` off `data-stage`; e2e-proven in a real
  engine). Emma micro-round: runtime verified SOUND in Chromium (heights/centring/snap/
  reduced-motion/`:has` cost) — blocked only on pin coverage + stale comments → rider
  `c81780c` (exact-arithmetic height pin · the every-rule scaleY/transform-clobber sweep ·
  the no-raw-grow-literal sweep, all red-proven · 3 comments rewritten) → **RESOLVED — SHIP.**
  Commits `c057459` + `c81780c`; gate 6/6 ×2; **FE 3,234/181**.
- **▶▶ NEXT: the owner's glance at ROUND 2** (:5173, live — the thicker ✕ · the closer bubble ·
  the 1.65× circle · the true pill squeeze · the placeholder clearing for slide-to-cancel).
  **Their word closes S0.5 → S1 (the BE relay).** Phase 23 S7 + v1.7.8 sequencing unchanged.
- Git: **15 commits unpushed over origin `b946fc1`** (the 12 + `c057459` + `c81780c` + this
  docs commit); tree clean at write; the PUSH ruling stays the owner's. **Prod untouched
  v1.7.7 @ `578ffa7`.** Both dev units RUNNING (D69 — do NOT stop them).

## Prior state (2026-09-12, SIXTEENTH session — **S0.5 (the dual-mode mic entry gesture) RAN THE WHOLE STANDING CADENCE IN ONE SESSION and is council-CLOSED: blind Emma SHIP WITH FIXES → fix wave → BLOCKED confirm → micro-wave → RESOLVED — SHIP**; superseded above where it speaks)

- **S0.5 is council-CLOSED (full as-built record = plan §7-S0.5; read THAT before S1/S2a work):**
  pinned Opus build `86de7b0` (useDictation widens: start/stop/cancel · the F5 abortable
  arming TOKEN · the 1000 ms pre-POST floor · the discard-flag cancel) + `faa62b5` (the §6
  gesture: pure `micReduce` + thin wiring, one `MicGestureChrome` for all three variants,
  every R69 §9 constant named+traced in ONE file, call chrome DARK behind `VoiceStatus.live?`,
  `touch-action:none` static, aria-pressed gone, e2e both projects) → main-seat audit rider
  `7a60309` (chip-stage button INERT per §6 · the keyboard door measures its anchor) → blind
  Emma **SHIP WITH FIXES 5M·2L sweep "none"** → wave `05f67b3` (the F1 stale-acquisition gen
  guard · F2 recRef-owns-the-lifecycle · F3 foreign-pointer ownership, her prescription
  RE-DERIVED and later ruled sound · F4 error-arms-discard · F5 live-drop escape · the
  reduced-motion rail gate · the parameter-contract pin) → her confirm **BLOCKED (2
  survivors)** → main-seat micro-wave `0516490` (`onerror` does NOT release ownership — the
  queued terminal `stop` is the one releasing terminal; a call-mode PRESS escapes on a live
  drop) → **her micro-confirm: RESOLVED — SHIP, sweep "none".**
- **The one build deviation, measured (stop-clause fired):** the gesture chrome is a
  positioned SIBLING of `.kit-composer` — sheet/line compute `overflow: hidden` and clip
  children — anchored to the measured mic centre; `--composer-h` proven invariant under the
  2.2× grow. ⚠ Durable lessons this session: a reviewer's fix prescription can break an
  invariant the finding itself named — re-derive against the actual state shape (F3); an
  `onerror` is NOT a terminal event — the platform still fires `dataavailable`/`stop` after
  it, so ownership releases exactly once, in `onstop`.
- **Gate 6/6 ×3 this session (foreground, never concurrent with an Emma round) — FE 3,207/180
  · BE 2,377** (counts + attribution in QUALITY.md; eslint 101, net zero new). Every
  load-bearing arm red-proven by scripted single-mechanism reversion. Also: the S0-close
  commit had clobbered the plan's S0.5 ladder bullet — restored `dde6688`.
- **▶▶ NEXT: the owner's FEEL ROUND on real dictation** (dev :5173, FE-only — both dev units
  RUNNING, D69, do NOT stop them): hold-to-record · release-to-send (composes with
  `stt_auto_send`) · 56 px lock + the visible CANCEL · slide-left cancel · the <1 s teaching
  toast · the ≤3-show lock hint — parameters tuned by eye against R69 §9's table (the
  constants live in `useMicGesture.ts`; geometry offsets are first-pass). **Their word closes
  S0.5 → S1 (the BE relay).** The S0 blind-review debt rides S1 as recorded.
- Git: **9 commits unpushed over origin `b946fc1`** (the 2 S0 commits + `dde6688` · `86de7b0`
  · `faa62b5` · `7a60309` · `05f67b3` · `0516490` + this docs commit); tree clean at write;
  the PUSH ruling stays the owner's. **Prod untouched v1.7.7 @ `578ffa7`.** Phase 23 S7 +
  the v1.7.8 sequencing unchanged (release E after the roleplay features — owner ruling
  09-12).

## Prior state (2026-09-12, FIFTEENTH session — **S0 RAN END TO END AND IS CLOSED, owner in the loop live: probes built + the phone sitting done + THREE rulings landed (the loopback server fix · Chrome-first echo posture · gesture green-light)**; superseded above where it speaks)

- **S0 (plan §7) is CLOSED — the full as-built record with every number and mechanism is plan
  §7-S0; read THAT before S1/S2 work.** Build `da4343f` (pinned Opus): `frontend/probes/{aec,gesture}.html`
  (Vite dev-only, never in dist) + `tools/speaches_realtime_smoke.py` (stays in-tree — the S1
  mock mirrors its pinned contract). Gate 6/6, independently re-run by the main seat. Process
  deviation, main-seat ruled + owner informed: the blind round rides S1 (throwaway probe pages;
  S1 re-verifies the contract against source).
- **HEADLINE ①: the realtime ear was DEAD on emma's Speaches** — every `intent=transcription`
  session died at close 1006 before any transcript (bare-router `ASGITransport` when
  `LOOPBACK_HOST_URL` is unset; source-verified). **OWNER RULING: fix the server env — a
  one-item amendment to the §5.2 "untouched" posture.** Applied as the drop-in
  `~/.config/systemd/user/speaches.service.d/20-loopback-url.conf` + unit restart. **⚠ That
  file lives OUTSIDE every repo — a Speaches reinstall must recreate it** (flagged in plan §0's
  seams row + the §7-S0 record). Post-fix: speech + silence arms both PASS (exact transcript;
  VAD +44 ms; `e093d8b` proven through the realtime path).
- **HEADLINE ②: the echo ruling (owner, measured on the Honor 20, WHY recorded in full in the
  §7-S0 record + §8 item 3): Chrome is the first-class call browser** — its `"all"` AEC is
  honored AND genuinely subtractive (the talk-through retest: owner's voice −18 dBFS live
  during playback, tones cancelled ⇒ voice barge-in viable). **Fennec's AEC does nothing
  against own playback** (near-full-volume leak, AGC-boosted; `"all"` coerces to `true`) ⇒
  `echo_workaround: auto` = OFF on capability-verified `"all"`, the protective EAR-HOLD
  elsewhere (calls work, interruption tap-only) — capability-detected per track, never
  UA-sniffed; S3 builds the branch. §5.1's `echo_workaround` comment now carries the ruling.
- **HEADLINE ③: the R69 gesture probes are clean on BOTH browsers** — zero `pointercancel`
  under the production posture across all gestures (446 px up-slides, 300 px left, multi-second
  holds), address bar never moved during a captured hold; the controls proved
  `touch-action:none` is load-bearing (Chrome cancels in <1 s without it). Fennec mic
  permission persists after one grant. **S0.5 is green-lit exactly as §6 ratified it.**
- Ops: Tailscale Serve was flipped to :5173 for the sitting and **RESTORED to prod :5433,
  verified 200**. The speaches unit was restarted once (the env fix) — prod voice blipped
  seconds, healthy since. Both dev units RUNNING throughout (D69 — do NOT stop them). Prod
  untouched v1.7.7 @ `578ffa7`.
- **▶▶ NEXT SESSION: S0.5** (plan §7-S0.5 — the §6 dual-mode mic hook + animations, mic leg
  live against today's `useDictation`, call chrome ships hidden; FE-only; the standing full
  cadence applies again, and the owner feel-tests the gesture on real dictation against R69's
  parameter table). One slice per session. **Phase 23 S7 + the v1.7.8 sequencing are unchanged**
  (release E after the roleplay features — owner ruling 09-12).
- Git: **2 commits unpushed over origin `b946fc1`** (`da4343f` build + this docs commit); tree
  clean at write; the PUSH ruling stays the owner's.

## Prior state (2026-09-12, FOURTEENTH session — **THE LIVE-VOICE REFINEMENT SESSION: the visual design + entry gesture + interruption model designed WITH the owner, R69 bought, a 14-item coherence sweep, and the blind Emma DELTA round ran the full cadence to RESOLVED — SHIP. The plan is council-closed over the amended text; ▶▶ NEXT SESSION = THE S0 BUILD**; superseded above where it speaks)

- **The whole session was plan refinement in conversation with the owner — zero app code; seven
  doc commits `fd9ebac`..the handoff tip, all on `LIVE_VOICE_PLAN.md` (+R69). UNPUSHED — the
  push ruling stays the owner's** (origin == `ff33b61`-era tip from the 09-11 push). Prod
  untouched v1.7.7 @ `578ffa7`; both dev units RUNNING (D69 — do NOT stop them).
- **Owner-ratified this session (all in plan §6/§4/§5, rulings recorded §8):** ① the overlay
  VISUALS — full-bleed backdrop in BOTH modes (blank-backdrop call screen REJECTED), the
  `voice.live.ring` toggle: a stroke-only circumference FOCAL-ANCHORED over the face (reads
  the point, never `z`) vs art-only with the transcript-line accent; ring animates from CALL
  STATE only (amplitude analysis DECLINED, do not re-propose) · ② live call gets its OWN Conf
  section · ③ the ENTRY = the dual-mode mic (a second composer button REJECTED): tap = mode
  switch (no mode memory — boots mic), 150 ms activation, hold-record/release-send (composes
  with `stt_auto_send`), 56 px swipe-up lock, relative slide-left cancel, Signal's 1000 ms
  floor, call = hold + swipe-up committing on RELEASE + the ~2 s tappable chip — every number
  R69-sourced · ④ INTERRUPTION: `barge_in` governs only the automatic voice trigger;
  tap-to-interrupt (ChatGPT pattern) always exists during `speaking`; barge-off =
  walkie-talkie (utterances queue, submit on drain) · ⑤ mute + the in-overlay Allow/Deny
  confirm row + staged-attachments-ride + the second door DEFERRED.
- **[R69](research/R69-hold-to-record-gesture.md) bought (Opus pass, Telegram/Signal source
  dissection):** headline corrections — Telegram's 150 ms is TAP-DISAMBIGUATION not a
  long-press; NO field precedent exists for gesture-started calls; Telegram-Web itself
  degrades to tap-toggle (= our keyboard path); Fennec's `navigator.vibrate` no-ops
  UNDETECTABLY. Parameter table = R69 §9; web risk list §10.
- **The blind Emma DELTA round (owner-ordered, hermes lane `--ignore-rules`, scoped to
  `git diff ff33b61..HEAD` on the plan): SHIP WITH CHANGES — 4 HIGH · 5 MED · 2 LOW, sweep
  clean, several §4.5 mechanisms verified sound. All eleven ACCEPTED + folded (`024de33`),
  her confirm: ALL RESOLVED with line proof, fix-sweep "none" — RESOLVED — SHIP** (full
  record = plan §9). The HIGHs were amendment claims about seams that DON'T exist as
  claimed: the upload retry (→ pending-queue retry), mute's "stop sending frames" (→
  disabled track, silent frames flow), "zero mouth changes" (→ the minimal audioController
  surface), and `awaiting_confirm` speech (→ queue-hold; **⚠ recorded PRE-EXISTING defect:
  TYPED text during `awaiting_confirm` mis-shapes an actual 202 today — the F3 turn-seam
  slice heals both modes**). Plus: the getUserMedia arming latch · dominant-axis commit ·
  the queue's call-generation fence (hang-up discards, failure harvests to draft) · the
  accept/refuse send result (`runComposer`'s boolean is routing-only) · overlay-local ring
  coords (visual-viewport, not window resize) · **S2 SPLIT → S2a (loop + minimal overlay +
  basic interrupt) / S2b (presentation + furniture)** · backdrop ladder = `useActiveBackdrop`
  ALONE, no gacha oracle.
- **▶▶ NEXT SESSION: the S0 build (plan §7)** — needs the OWNER + phone (~10 min): the AEC
  capability + leak probe (Chrome + Fennec) · the Fennec permission check · the R69 gesture
  probes (pointercancel incidence, `touch-action:none` vs URL-bar collapse) · the Speaches
  realtime smoke against Parakeet incl. which session fields the fork honors (server
  UNTOUCHED — owner ruling). **The ladder is now S0 → S0.5 (the dual-mode mic on real
  dictation, FE-only, feel-tested early) → S1 → S2a → S2b → S3 → S4 (calibration = the phase
  gate).** One slice per session, the standing cadence; §8.3 (Fennec posture) stays the one
  open question, answered empirically by S0.
- **Phase 23 S7 unchanged:** the remainder rides the owner's regular use (lorebook
  live-trigger + duties×2). **v1.7.8 SEQUENCED (owner ruling 2026-09-12): the release (item
  E, config migration 2→3, config backup FIRST on rollback) comes AFTER the roleplay
  features are implemented** — it waits on Phase 23's close, not on a calendar.

## Prior state (2026-09-11, THIRTEENTH session — **S7 mostly ticked + the card-import leg delegated and PASSED · Dependabot D1 done · THE LIVE-VOICE DESIGN SESSION RAN END TO END: `LIVE_VOICE_PLAN.md` council-closed SHIP WITH CHANGES, awaiting the owner's ratification → D71 · everything PUSHED**; superseded above where it speaks)

- **S7 progress (the owner, in conversation): phone-talk ✓ · all three backdrop states ✓ ·
  read-along ✓ (the mic leg is DONE — no Serve flip was needed) · showcase/picker feel ✓ ("for
  now") · image upload + focus ✓.** The **card-import-through-the-UI leg was delegated to the
  main seat and PASSED**: ST's bundled Seraphina (V2 single-chunk + 4-entry `character_book` —
  the complement of Lynette's path) imported through the real UI on live :5173 (Playwright, no
  mocks): inline report + honest position-downgrade warnings, `seraphina-book` attached, card in
  the grid with avatar/TALK, editor round-trip clean, 0600 agent.yaml. **Seraphina is LIVE on
  dev.** ⚠ Found: `roleplay.enabled` was never set on dev (defaults false) — the import button
  was hidden, which is why the owner never saw it; **flipped ON via the settings seam** (persona
  Ari kept). **Still open in S7, riding the owner's regular use** (their ruling — no formal
  round): the lorebook live-trigger (say a trait word to Lynette, or ask Seraphina about
  "Eldoria"/the forest) · tools-in-character on both duties settings. Their word closes S7 =
  the phase. **The v1.7.8 release (item E — prod deploy, config migration 2→3, config backup
  FIRST on rollback) stays owed and owner-sequenced; the owner is deliberately staying on dev.**
- **Dependabot D1 DONE (`2a1d986`):** `npm audit fix`, lockfile-only, all nine alerts cleared
  (npm audit 0 vulnerabilities), gate 6/6.
- **THE LIVE-VOICE DESIGN (owner-commissioned this session, the full cadence):** read R51 → an
  Opus delta pass bought **R68** (`559f300` — headline: Chrome ≥141 ships
  `echoCancellation:"all"` so the R51 echo worry mostly dissolves; Speaches upstream is FROZEN
  and emma runs a local fork at `~/github/speaches` @ `e093d8b` preloading **Parakeet**, bound
  `0.0.0.0:9000` with a placeholder key — posture flagged; Silero v6 = drop-in weights,
  vad-web stale) → main-seat design **`docs/LIVE_VOICE_PLAN.md`** (architecture ① —
  Speaches-realtime `intent=transcription` ear behind a ctrl-b relay · client-submitted turns
  through `runComposer` · C3 read-along mouth · the first WebSocket in the codebase, D-entry at
  ratification) → **blind Emma design round: RETHINK, 2 HIGH · 7 MED, sweep "none",
  architecture ① explicitly affirmed — ALL NINE ACCEPTED, both HIGHs code-verified first**
  (headline: cancelled turns persist NO partial text + C3 outlives the turn ⇒ **§4.4 truncation
  DEFERRED to v2**; Speaches has no min-speech knob ⇒ the barge-in floor became a client-side
  sustained-energy gate) → **her confirm: all resolved with line proof, 2 sweep MEDs, verdict
  SHIP WITH CHANGES — all four folded** (`91db30b`, full trail = plan §9). **The design is
  council-closed; the owner has the plain-language brief in conversation.**
- **RATIFIED SAME SESSION → D71 (the owner: "okay then", after the brief + the §2.1
  reference-projects discussion).** Their rulings, all folded (`f2dbbd5` + the ratification
  commit): the Speaches server stays UNTOUCHED (nothing outside the project) · §4.4 truncation
  = follow-up slice · minimal overlay · **the behavior toggles/knobs are real Conf Settings
  rows**. New plan §2.1 = the inheritance ledger (RVC/pipecat/livekit: taken / declined /
  shelved-with-trigger — partials need arch ②; S4 calibration is the decision point). D71 also
  records the WebSocket admission (media ingress ONLY). TODO Phase 24 + the CLAUDE.md doc-map
  row are wired. **▶▶ NEXT SESSION: the S0 build** (plan §7: the AEC capability+leak probe on
  the owner's phone Chrome+Fennec · the Fennec permission check · the Speaches realtime smoke
  against Parakeet, server untouched) — one slice per session, the standing cadence; §8.3
  (Fennec posture) is the one open question, answered empirically by S0.
- **Git: PUSHED this session (the owner's word)** — the 104 backlog + D1 + R68 + the plan +
  these docs; origin == local after the push. **Prod untouched: v1.7.7 @ `578ffa7`.** Both dev
  units RUNNING (D69 — do NOT stop them); :5434 on `11ff928`, current for the BE.

## Prior state (2026-09-09, TWELFTH session — **the owner's glance PASSED the feel-round wave ("both fixes looked good") → S6b IS CLOSED; NEXT = S7, the owner DEVICE round = the phase gate**; superseded above where it speaks)

- **S6b closed by the owner's word (2026-09-09, in conversation):** the delete corner passed
  (the trash glyph stands — no × swap asked) and the still full-mode backdrop passed; the
  32px circle rode the round unremarked. Recorded in plan §13-S6b (the close line) + the
  TODO S6 entry. **All of S0–S6(+S6b) are now closed; only S7 remains in Phase 23.**
- **▶▶ NEXT: S7 — the owner DEVICE round — IS the phase gate (§10-S7):** import a real card
  through the UI · talk to it on the phone · tools-in-character on both duties settings ·
  all three backdrop states on the real phone (blur/dim legibility) · a field-authored
  lorebook triggering live (§6.7 — `personality-traits` is attached to Lynette on dev) ·
  showcase/picker feel (incl. the §8.4 tap-inversion re-test) · read-along on a character
  reply. **⚠ Mic needs HTTPS and Serve fronts PROD :5433** (`tailscale serve status`). For the dev
  mic leg **do NOT hijack-and-restore prod's :443** — that dance is the OPS-1 burn class (a forgotten
  restore leaves prod dark). Open the **additional** dev door instead, which never touches prod:
  `tailscale serve --bg --https=8443 5173`, off with `tailscale serve --https=8443 off`. Runbook +
  the HMR-websocket caveat: [`HTTPS_TAILSCALE.md`](./HTTPS_TAILSCALE.md). Everything non-mic runs on
  plain :5173/:5434 as usual.
  Both dev units RUNNING (D69 — do NOT stop them); :5434 on `11ff928`, current for the BE.
- Git after the closure docs commit: **104 commits unpushed over origin `04769d9`**; prod
  untouched v1.7.7 @ `578ffa7`; the v1.7.8 pipeline (Dependabot D1 → push → release E,
  config migration 2→3, rollback = config backup FIRST then v1.7.7) unchanged, still owed,
  owner-sequenced. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — R51, buy only the delta.**

## Prior state (2026-09-09, ELEVENTH session continued — **the owner's WAVE-3 FEEL ROUND landed 3 rulings and the FEEL-ROUND WAVE ran the whole cadence same session: council-CLOSED, Emma's confirm RESOLVED — SHIP**; superseded above where it speaks)

- **The owner's feel round (in conversation): "looks good" + three rulings** — ① the bubble
  circle slightly bigger → `--kit-who-face` 28 → **32px** (main-seat `1c1e518`) · ② the picker
  needs a way to REMOVE an uploaded image — the owner's own design, "an x at the top right
  corner" · ③ the `full` backdrop must NOT fade on scroll — "just leave it like when the chat
  is unscrolled". **Full record = plan §13-S6b's FEEL-ROUND block** (its §8.3/§8.3a walk
  passages carry the amendment in place).
- **Build `822856e` (pinned Opus) + review rider `c002abe`:** the delete corner
  (`LibraryGrid.onRemove?` → top-end `.mgal-del`, the in-use disc's recipe with the `--danger`
  glyph; ONLY the picker passes it — the gallery's top-end stays the problem badge, and the
  picker's corner is free BY CONSTRUCTION; one exported `confirmDelete` with a per-screen
  `activeBody` clause; deleting the bound tile also empties the slot, picker stays open) and
  the un-fade (the walk deleted WHOLE — driver, ramp/floor tokens, opacity calc, will-change,
  both motion/perf gates; `scrollProgress.ts` stays for gacha's oracle; the static veil IS the
  rest look). **Main-seat icon ruling:** the corner wears the trash glyph, not a literal × (an
  × beside tap-is-the-pick reads as deselect) — a one-line swap if the owner wants the ×;
  **THE OWNER HAS NOT YET SEEN the built corner — their glance rules it.**
- **The council round: blind Emma SHIP WITH FIXES — 3 MED · 2 LOW, sweep clean** (she
  Chromium-measured the corner geometry + confirm focus/Escape herself). Rider `c002abe`:
  MED 1 (the clear compared the CLICK-TIME binding across two suspensions — a late upload
  rebinding behind the confirm got blanked; fix = the `liveWant` latest-ref, the S5
  closure-across-await lesson) · MED 2 (`write.remove` → `Promise<boolean>` for the BYTE
  delete; clear only on `gone &&` the live check) · **MED 3 OVERRULED as residual** (draft
  abandonment after a delete leaves the saved config naming the dead file — auto-persisting
  one field would bypass the form's save chokepoint and break cancel-means-no-changes; the
  dangling state is the shipped bounded degrade; Emma ruled the scoping HONEST) · LOW 1 (the
  e2e `toPass` stillness arm was vacuous against an async driver — now double-rAF + one
  assertion each; the builder EXECUTED the red-proof against the restored old driver) · LOW 2
  (stale comment). **Her confirm: all five line-proofed, rider sweep "none" — RESOLVED —
  SHIP** (she re-ran AgentArtRow 24/24 + typecheck + the agent-backdrop e2e 20/20 both
  projects at HEAD).
- **Gate at tip `c002abe`: 6/6 ×4 this wave — BE 2,377 · FE 3,129/178** (counts + the eslint
  100→101 attribution in QUALITY.md). **All FE-only — :5173 serves everything live; both dev
  units RUNNING (D69 — do NOT stop them; :5434 still on `11ff928`, current for the BE).**
- **▶▶ NEXT: the owner's glance at the closed feel-round wave** (:5173 — the 32px circle · the
  delete corner, incl. the trash-vs-× call · the still full-mode backdrop) **→ their word
  closes S6b → S7 — the owner DEVICE round — IS the phase gate (§10-S7)** (import a real card ·
  talk on the phone · tools-in-character both duties settings · all three backdrop states · a
  lorebook triggering live · showcase/picker feel · read-along on a character reply).
- **Git: 103 commits unpushed over origin `04769d9`** (the 99 + `1c1e518` + `822856e` +
  `c002abe` + this docs commit — count verified by `git rev-list`); tree clean at write; the
  PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push →
  release E, config migration 2→3, rollback = config backup FIRST then v1.7.7) unchanged,
  still owed, owner-sequenced. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — R51, buy only the
  delta.**

## Prior state (2026-09-09, ELEVENTH session — **WAVE 3 (bigger circles + the z-zoom circular cutout) ran the WHOLE standing cadence in one session and is council-CLOSED: Emma's confirm RESOLVED — SHIP, sweep "none"**; superseded above where it speaks)

- **The session opened on the handoff's word and built wave 3 off plan §13-S6b's ratified WAVE 3
  block — full record now in the plan's WAVE 3 AS-BUILT block:** pinned Opus build **`11ff928`**
  (① `--kit-who-face: 28px` / `--kit-tools-face: 24px` tokens, literals dead · ② `MediaFocal.z`
  — clamp 1..4, ≤1/NaN fold to `None`, **absent is the only spelling of "no zoom"**, rides the
  point's object and its rev · ③ scoping by construction: `circleFraming` reads `zoom`,
  `focalPosition` never does — backdrop/card/strip/picker cannot zoom by accident · ④ the
  observer-free circle math: for a square window the box side CANCELS out of the cover overflow,
  so **`FocalFace`** (new) paints the who-line + tools faces from the item alone —
  `background-size: s·z` + `P(f, s·z)`, dormant at z=1, no ref/observer/state; the tools face
  LOST its per-row ResizeObserver · ⑤ the sheet role-gated by `MediaPreviewDef.shape: "circle"`
  + `framesCircle()` — round reticle, keyboard-reachable slider, zoom-carrying
  panLimit/seedPan/zoomPan, the exact "chat face" circle preview; backgrounds byte-identical,
  pinned · ⑥ the second door: `LibraryPicker.onFrame` → "Focus" beside "Use no picture",
  sheet mounted as a form/picker SIBLING, saving through the queued rev-guarded
  `studio.setFocal`) → main-seat audit (all six declared deviations ACCEPTED — headline: **the
  reticle STAYS a reticle**; the WYSIWYG round crop needs `restrictPosition`, which pins a 3:4
  portrait's X at 0.5 forever against the ratified one-centre trade — the exact circle is the
  preview; + the render-time pan fence, forced by the library's measured pan-first-zoom-second
  report order; gate independently re-run 6/6) → **blind Emma SHIP WITH FIXES — 1 MED conf
  0.99, every seeded area sound, open sweep "none"** (`roundFocal` tested the UNROUNDED zoom
  then rounded: a continuous pinch at 1.004 stored the forbidden `z: 1` — the config write
  persists the raw patch, so the BE fold never sees it) → ruled FIX → main-seat rider
  **`6330d6c`** (round first, test the value the seam WRITES; the 1.004 arm red-proven against
  the unfixed code) → **her confirm: line-proofed resolved, fix-sweep "none" — RESOLVED —
  SHIP.**
- **Gate at tip `6330d6c`: 6/6 — BE 2,377 · FE 3,126/178** (counts in QUALITY.md; the eslint
  ledger 110 → 118 → 99 → 100 measured per-tip and attributed there — wave 2's −19 was the
  picker-strip deletion, incidental). The build's 15 arms red-proven by scripted reversion. The
  builder restarted the dev backend onto `11ff928` (the `z` field is live); the review fix is
  FE-only — **:5173 serves the whole wave live; both dev units RUNNING (D69 — do NOT stop
  them).** Ops clean this session: gate FOREGROUND ×3, never concurrent with Emma's Chromium
  probes; her round ran detached (`setsid` + Monitor on the real PID).
- **▶▶ NEXT: the owner's feel round on wave 3** (dev :5173 — the bubble circles at 28/24px, the
  tokens are the tuning knob if the eye disagrees; the picker's "Focus" door; the round reticle
  + zoom slider + the "chat face" circle preview on Lynette's avatar; framing now honored in
  the transcript) **→ their word closes the S6b round → S7 — the owner DEVICE round — IS the
  phase gate (§10-S7)** (import a real card · talk on the phone · tools-in-character both
  duties settings · all three backdrop states · a lorebook triggering live · showcase/picker
  feel · read-along on a character reply). Wave-3 residuals recorded in the plan block (none
  owed): the reticle ring is the library's 1px white on both cropper surfaces (pre-existing
  unlayered-CSS finding) · a hand-edited `z` on a non-circle role round-trips untouched.
- **Git: 99 commits unpushed over origin `04769d9`** (the 96 + `11ff928` + `6330d6c` + this
  docs commit); working tree clean at write; the PUSH ruling stays the owner's. **Prod
  untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release E,
  config migration 2→3, rollback = config backup FIRST then v1.7.7) is unchanged and still
  owed; sequencing is the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — R51, buy only
  the delta.**

## Prior state (2026-09-08, TENTH session — THE OWNER'S BACKDROP ROUND LANDED 4 FINDINGS; **wave 1 (②+③) ran the whole cadence and is council-CLOSED: RESOLVED — SHIP**; wave 2 (①+④) designed + owner-confirmed, PENDING; superseded above where it speaks)

- **The owner's phone round on S6 came back with four findings, restated + confirmed in
  conversation** (full record = **plan §13-S6b**): ① the agent form's avatar/backdrop PICKER
  is confusing · ② Lynette showed the DEFAULT backdrop (root cause: a card import binds only
  the avatar; resolution read `background` only — NOT a priority bug) · ③ `full` mode started
  a band below the pane's top + a 30px `--bg` haze across the art · ④ the agent form's
  long-text fields should take the Conf → Prompts presentation. **Ruled two waves; the owner
  confirmed the whole design** (backdrop order = background → avatar → default; picker =
  image-as-button → the media-manager library in pick mode, the researched dominant pattern).
- **Wave 1 ran end to end and is council-CLOSED:** three seam scouts + a picker-UX research
  pass → main-seat design → the owner's word → Opus build **1a `864f447`**
  (`useActiveBackdrop` returns `background ?? avatar` — the ONE chokepoint all three
  consumers read; 5 unit arms, 2 red-proven) → **the builder's STOP-CLAUSE catch**: the
  brief's gap mechanism was measured WRONG (sticky rests on the scroller's CONTENT box — the
  kit comment was right, the scout wasn't; the margin-pair pull collapses through the
  first-child zero-height pin and nets ZERO) → main seat accepted the builder's measured
  alternative → **1b `d74eecb`** (ONE `--kit-backdrop-lift` token; the ABSOLUTE ART LAYER
  pulled by `-lift`, height subtractions dropped — art top Δ 0.0 in all 4 bar modes ×
  plan/no-plan, rest AND stuck, overflow still 0; the seam scrim yields via
  `:has(.tab.active > .kit-backdrop-pin)`; e2e 14 → 20, claim arms red-proven) → main-seat
  audits (all deviations accepted) → **blind Emma round: SHIP WITH FIXES 1M·2L, sweep
  "none"**, all ruled FIX → wave **`6657a9b`** (`OUTRANKED.agent` says "own ART is used" ·
  the scrim e2e rides ONE boot + a live two-way tab transition · §8.3/§8.3a's five clauses
  say the shipped ladder) → **her confirm: all 3 RESOLVED with line proof, sweep "none" —
  RESOLVED — SHIP.**
- **THEN the owner's re-glance found 1a INCOMPLETE — wave 1c ran the whole cadence same day
  and is council-CLOSED (RESOLVED — SHIP; full record = plan §13-S6b's 1c block):** the FE had
  no notion of the thread's D11 pin (a pinned thread replied as the character while the
  backdrop painted the default). `27e588f` (`ChatState.threadAgent` + `effectiveAgent` — the
  server routing ladder mirrored; backdrop + A6 menu take it; 14 red-proven arms) → main-seat
  audit rider `3c6977f` (same-thread reopen orphaned the late pin) → **blind Emma DO NOT SHIP
  1H·2M all ruled FIX** → `8277ebf` (the HIGH: `GET /threads` gains `include_archived` so the
  pin read sees ARCHIVED automation threads — boot read deliberately unflagged; the menu
  subscribes to the late pin; `loadGen` bumps on `/clear` + wire mints) → ⚠ **the Opus builder
  was rate-limit KILLED after committing, before reporting — the main seat re-ran the gate
  itself and briefed her confirm that the red-proof claims were UNVERIFIED: she caught F2's
  arm as a FALSE POSITIVE** (an unrelated art rerender masked it on the parent) → test-only
  rider `14d3bae` (settle-then-release; three-way transplant proof in a worktree) → **her
  micro-confirm: RESOLVED — SHIP.**
- **Gate at tip `14d3bae`: 6/6 — BE 2,374 · FE 3,085/178 · e2e agent-backdrop 20/20 both
  projects** (counts in QUALITY.md). Wave 1c touched the BE (`include_archived`) — ⚠ **the
  dev backend :5434 has NOT been restarted onto the tip; the archived-pin read 404s nothing
  but silently degrades to null until it is** (restart `ctrl-b-dashboard-dev` before testing
  automation-thread backdrops; the main Lynette path is FE-only and live on :5173 already).
  Both dev units RUNNING (D69 — do NOT stop them). The §13-S6 ops rules held: gate
  FOREGROUND, never concurrent with an Emma Chromium round; ⚠ NEW ops lesson recorded in
  §13-S6b: a builder commit that arrives WITHOUT its report (rate-limit kill) gets the gate
  re-run by the main seat and its red-proof claims treated as unverified in the review brief
  — that posture caught a real false-positive regression arm.
- **THE OWNER'S GLANCE PASSED wave 1 ("the operator image seems to be Lynette now… it works")
  — that word ALSO closed the S6 feel round — and WAVE 2 then ran the whole cadence same
  session and is council-CLOSED: RESOLVED — SHIP** (full record = plan §13-S6b's wave-2
  block). Build **`b0d3cb6`**: the art rows are now the PICTURE (aspect-shaped FocalImg face,
  pencil corner, "Add an image" empty face) opening **`media/LibraryPicker`** — the library in
  PICK mode, a thin SIBLING of GalleryModal reusing `LibraryGrid` as-is + the upload surface
  extracted to `media/UploadRow` (ONE Add row for gallery + picker, gallery byte-identical);
  upload auto-picks via `onStored`; "Use no picture" only while bound; the `.agart-pick` strip
  + three pill buttons DELETED. The prompt-shaped fields take the extracted
  **`PromptRowFace`** (PromptsEditor adopted it, suite unmodified); one-line fields keep
  label-left (owner rule); screenshot-measured x=31 aligned at 393px. Probe-forced deviation
  accepted: pickers mount as FORM SIBLINGS (`.mform`'s `all: unset` un-hid the file input).
  → blind Emma **SHIP WITH FIXES 3M** (late-upload race · gallery vocabulary in the picker's
  tile a11y · the face's button named by its preview) → wave **`ad6b409`** (the one-guard
  `onStored`-only-while-open rule · `describeItem` · `aria-label="Edit <field>"` healing
  Conf → Prompts too; six arms red-proven by reversion) → **her confirm: all RESOLVED, both
  scopings accepted, sweep CLEAN — RESOLVED — SHIP.**
- **Gate at tip `ad6b409`: 6/6 — BE 2,374 · FE 3,097/178** (counts in QUALITY.md). FE-only
  wave; :5173 serves it live; both dev units RUNNING (D69 — do NOT stop them; :5434 runs the
  `14d3bae` BE tip, current).
- **THE WAVE-2 FEEL ROUND LANDED same session ("it looks good") + TWO new asks → WAVE 3
  DESIGNED + owner-RATIFIED in conversation ("sounds good"), handoff requested for a clean
  build session.** The asks: the bubble avatar circle is too small, and an exact CIRCULAR
  CUTOUT for the avatar alongside the whole-image framing. **The ratified design + the full
  scouted seam map = plan §13-S6b's WAVE 3 block — the next session's build brief comes
  straight off it.** Headlines: who-face 18→28px / tools-face 20→24px as tokens · the
  PLANNED-never-built `z` zoom field (core/media.py:389) finally built, honored ONLY by
  circle-shaped windows (the backdrop/card keep the point alone — the wave-1 avatar-as-
  backdrop fallback must not zoom; ratified trade: circle + backdrop share one center) ·
  the cutout is set in the EXISTING FramingSheet upgraded for avatars (round mask +
  pinch/zoom — react-easy-crop ships both; a circle "chat face" preview joins the strip),
  reachable from the Conf gallery AND a new door on the avatar picker (owner-ratified §8.2
  amendment) · the who-face starts honoring framing via a STATIC aspect-1 computation
  (zero per-bubble observers — the kit.css comment's cost objection dies with the observer).
- **▶▶ NEXT SESSION: the wave-3 BUILD** (pinned Opus brief off the plan block, the standing
  cadence: build → main-seat audit → blind Emma → fix wave → confirm) **→ the owner's feel
  round on it (circle sizes tuned by eye) → then S7 — the owner DEVICE round — IS the phase
  gate (§10-S7)** (import a real card · talk on the phone · tools-in-character both duties
  settings · all three backdrop states · a lorebook triggering live · showcase/picker feel ·
  read-along on a character reply). Wave-2 residuals recorded in the plan block (none owed):
  the unmount-mid-PUT upload leg (§13-S4 restated) · the "Edit fullscreen ↗" idiom remaining
  in ConfTab's PromptRow + RoleplayEditor/SkillsEditor/MemoryEditor (a later owner-triggered
  sweep onto the face) · the strip's 20px scrim overlap (deliberate) · the pre-existing
  un-gated gallery paste.
- **Git: 96 commits unpushed over origin `04769d9`** (the 88 + `27e588f` + `3c6977f` +
  `8277ebf` + `14d3bae` + `72da3eb` + `b0d3cb6` + `ad6b409` + `424cb89` + this docs commit);
  working tree clean at write; the
  PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline
  (Dependabot D1 → push → release E, config migration 2→3, rollback = config backup FIRST
  then v1.7.7) is unchanged and still owed; sequencing is the owner's. **NEXT-NEXT (owner):
  LIVE VOICE/CALL MODE — R51, buy only the delta.**

## Prior state (2026-09-08, NINTH session — THE OWNER'S WORD CLOSED S5, then **S6 (the three-state backdrop) ran the WHOLE cadence in one session and is council-CLOSED: micro-confirm PASS**; superseded above where it speaks)

- **The session opened on the owner's word ("yes lets continue") — S5 CLOSED (`0ee3474`) — and
  S6 ran end to end:** two seam scouts → main-seat design → **the owner's clarify round in
  conversation** (plain-language restatement of the three states + the one-image active-agent
  rule; confirmed) → **§8.3a committed `dd60681`** (the owner-confirmed narrowing: the kit
  operator STRIP as the kit themes' operator-image place · active agent = the sticky pin else
  the resolved default, never per-bubble/one-shot · the SYNCED `agentBackdrop` setting) →
  pinned Opus build **`06d3f0e`** (the setting chain BE+FE · the reactive session pin ·
  `useActiveBackdrop` · the kit `AgentBackdrop` layer (strip / full arrangement with the
  lifted `scrollProgress` math + the `--kit-pane-h` phantom-overflow fix) · gacha wired at the
  body · frontier untouched) → main-seat audit (all 8 deviations ACCEPTED, gate independently
  re-run 6/6) → **blind Emma round SHIP WITH FIXES 0H·3M·0L sweep "none"**, all three ruled
  FIX → wave **`29c5be4`** (red-proven: `oracleFadeActive` gates driver AND `data-oracle`
  stamp · the pin's compensating margin · the gallery's `outranked` honesty via
  `backdropOutrank`, ONE statement for paint + report) → her confirm **all 3 RESOLVED** + 1
  LOW → main-seat rider **`90b7472`** (the seat modal's reading line) → **micro-confirm:
  RESOLVED, sweep "none" — PASS.** Full record = **plan §13-S6**.
- **Gate at tip `90b7472`: 6/6 — BE 2,373 · FE 3,061/178 · e2e agent-backdrop 14/14 both
  projects** (counts in QUALITY.md). **The S6 BE field is live on dev** (the builder restarted
  :5434); both dev units RUNNING (D69 presence observation continues — do NOT stop the units).
  ⚠ Ops recorded in §13-S6: never run the full gate CONCURRENT with an Emma round that probes
  in Chromium (her probe rebuilds `frontend/dist` → ~8 BE media-write tests fail, pure
  contention); background gate runs got reaped twice — run the gate FOREGROUND.
- **▶▶ NEXT: the owner's phone round on the backdrop (dev :5173, Conf → Appearance → "Agent
  backdrop"):** operator (Lynette's background in the strip / gacha's oracle) · full (behind
  the chat, dims on scroll) · off — on gacha AND a kit theme; the light-theme veil + the 240px
  strip height are the two unverified-by-eye items (tokens, feel-round material). **THEIR WORD
  closes S6 → S7, the owner DEVICE round, IS the phase gate (§10-S7)** — import a real card ·
  talk on the phone · tools-in-character both duties settings · all three backdrop states ·
  a lorebook triggering live · showcase/picker feel · read-along on a character reply.
- **Git: 83 commits unpushed over origin `04769d9`** (the 77 + `0ee3474` S5-close + `dd60681`
  §8.3a + `06d3f0e` build + `29c5be4` wave + `90b7472` rider + this docs commit); working
  tree clean; the PUSH ruling stays the owner's. **Prod untouched:
  v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release E, config
  migration 2→3, rollback = config backup FIRST then v1.7.7) is unchanged and still owed;
  sequencing is the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — R51, buy only the
  delta.**

## Prior state (2026-09-08, EIGHTH session — THE OWNER'S WORD CLOSED S4, then **S5 (the lorebook FE) ran the WHOLE standing cadence in one session and is council-CLOSED: RESOLVED — SHIP**; superseded above where it speaks)

- **The session opened on the owner's word** ("you fixed something and it looks good now, we
  can continue") — **S4 is CLOSED** (recorded in plan §13-S4 + TODO) — **and S5 ran end to
  end**: two seam scouts → main-seat design → pinned Opus build **`eb2f21c`** (the §6.6
  collapsed-entry manager inside the existing Conf `lorebooks` group · the stash-preserving
  draft/PUT discipline, test-pinned at entry AND book level · book import + inline report ·
  the two-consumer `LorebookPicker` (agent form, NOT rp-gated — ruling 9; global
  `lorebooks.books` on the LorebookGlobals save bar) · `TickGrid` to its own module) →
  main-seat audit (gate independently re-run 6/6; all 10 deviations ACCEPTED) → **blind Emma
  round DO NOT SHIP 1H·5M·1L, all seven ruled FIX** → fix wave **`3be3386`** (failing-before
  proofs; two main-seat re-derivations — F1's seeded-snapshot compare she later ruled SOUND,
  F4's file probe over her out-of-scope create-only verb) → **rider `b365d45`** (the two
  same-class TWINS on the S4 surface: AgentRow's collapsed-dirty defect + the card-import
  `accept` filter) → her confirm (5/7 + F3 surviving + 2 sweep MEDs) → **micro-wave
  `0ce4dd4`** (F3 held-through-the-await via `flipping` · probe-window locks on the add row ·
  clean-draft-adopts-echo · **+ a main-seat-found trap her sweep missed**: a toggled
  never-opened row wedged its first open on "loading…" forever) → her micro-confirm (one
  blocker: click-time draft classification) → **rider `059fd29`** (the live-ref `updateDraft`
  chokepoint; the echo classifies the draft as it IS) → **her FINAL VERDICT: RESOLVED — SHIP**
  (sweep "none"; she re-ran the FE suite 3,024/3,024 herself). **Full record = plan §13-S5**
  (residuals recorded there — headline: the malformed-file class now also covers
  create-overwrite; the register fix is the backend surfacing unreadable books).
- **Gate at tip `059fd29`: 6/6 — BE 2,373 (untouched) · FE 3,024/177** (counts in QUALITY.md;
  eslint 97 → 110, attributed there — the seeded-snapshot render reads are deliberate).
  **FE-only slice — :5173 serves it live; both dev units RUNNING (D69 presence observation
  continues, do NOT stop the units); no backend restart needed.**
- **THE OWNER'S FEEL ROUND LANDED same session (in conversation): "it looks fine" + ONE
  finding — the Global-lorebooks picker flush with no padding — plus the standing ask to
  MEASURE consistency rather than claim it.** Measured live at 390px: both card-hosted
  `.agent-allow` blocks at x:19 (the flagged picker AND the S4-shipped roleplay "Character
  tools" grid — the same uncaught defect) vs the card content line at x:33; everything else
  on the surface measured consistent. **Fix `589ecf0`**: one child-scoped rule
  (`.conf-card > .agent-allow` takes the confrow's density-aware inset; the `.mform`
  instances untouched); re-measured x:33 both; the e2e Lorebooks ladder pins the shared
  left edge, proven red without the CSS, green both projects; gate 6/6. **Emma micro-round:
  RESOLVED — SHIP, sweep "none".** Record = plan §13-S5's feel-round addendum.
- **▶▶ NEXT: the owner's phone glance at the FIXED picker** (dev :5173 → Conf → Lorebooks —
  the "0 attached"/chips now on the row-label line; the same grid in Roleplay also fixed)
  **→ THEIR WORD closes S5 → S6 (the three-state backdrop, §10-S6)** — one slice per
  session. The Phase 19 residuals stand (`tabbtn-<id>` aria class · multipart spool · the
  TickGrid tools/skills silent-drop + unreadable-book surfacing, plan §13-S5).
- **Git: 77 commits unpushed over origin `04769d9`** (the 69 + `eb2f21c` + `3be3386` +
  `b365d45` + `0ce4dd4` + `059fd29` + the S5 docs commit + `589ecf0` + this docs commit);
  working tree clean; the PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @
  `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release E, config migration 2→3,
  rollback = config backup FIRST then v1.7.7) is unchanged and still owed; sequencing is
  the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — start at R51, buy only the
  delta.**

## Prior state (2026-09-07, SEVENTH session — THE OF FIX WAVE COUNCIL-CLOSED, then the owner's confirm round RE-PINNED OF-1 → **OF-1b** (the standalone cards' full-bleed) fixed `02cc5c4` + council-closed same session; superseded above where it speaks)

- **OF-1b (the owner's confirm round, in conversation):** OF-2 confirmed good; but the
  "dropdown with no padding" was RE-PINNED — it is the **ADD-AGENT disclosure card going
  edge-to-edge in the tab placement** ("goes up to the sides"; all owner reports are from the
  PHONE, their restated default), fine in Conf. Measured cause: `.agal-actions`/`.agal-detail`/
  `.agrep` had NO standalone inline margin — only the Conf-hosted `.confgroup` supplies one
  (18px), so standalone they spanned x:0 w:360 while the grid sat at 16px. The S4 build missed
  the `.util` "standalone page inset + host-zeroing" precedent (kit.css ~5632). **Fix
  `02cc5c4`** (main-seat): the precedent verbatim — `margin-inline: 16px` (= the grid's inset,
  shared left edge) + the `.confgroup` zeroing pair; hosted look measured UNCHANGED; the
  placement=button e2e arm pins the inset. **Emma micro-round: findings NONE — RESOLVED —
  SHIP** (she ran the focused e2e herself, 2/2). The `9f6b597` option-padding rule STAYS (a
  real desktop papercut — the plan's OF-1 attribution corrected in the OF-1b block); the
  "owned listbox" idea is WITHDRAWN. Full record = plan §13-S4's OF-1b block.
- **▶▶ NEXT: the owner's phone glance at the agents tab** (the add-agent card + detail form
  now inset like the grid) **→ THEIR WORD closes S4 → S5** (unchanged: lorebook FE + §6.6 +
  `lorebooks.books`; S5 waits for their word they're back home). Git: **69 commits unpushed**
  (the 67 + `02cc5c4` + this docs commit); tree clean; prod untouched v1.7.7; dev units
  RUNNING (FE-only — :5173 serves everything live).

## Prior current-state (same session, before the owner's confirm round — kept for the wave record)

- **The session opened on the owner's word that Emma is available again, so the OF wave ran the
  whole standing cadence, not the build-only fallback:** pin + precedent (two scouts) →
  main-seat design → pinned Opus build **`9f6b597`** → main-seat audit (diff line-by-line,
  declaration-order + theme-override probes, **full gate independently re-run 6/6**) → blind
  Emma round → fix rider → her confirm. **Full record = plan §13-S4's OF-FIX-WAVE addendum.**
- **OF-1 (dropdown padding):** no agents-only divergence — the app styled every native
  `<select>` through the ONE shared recipe but styled `<option>` NOWHERE, so every popup's rows
  rendered flush; worst = the provider/model picker's mono ids at 360px. Fix = ONE app-wide
  `.kit option { padding: 8px 10px; }` (the app's own popover-row metric). Honest caveat in the
  rule: desktop popups only — OS-rendered mobile pickers ignore option CSS and carry native
  insets; if the owner's round still shows a bare list, the fold-up is the `.priv-menu`
  popover-listbox pattern riding the deferred OF-3 pass.
- **OF-2 (gradient rims):** the precedent was found and is literally the owner's remembered
  bug — `57e106a`, the gacha dossier act, *"pink one side, violet the other"*. Mechanism: a
  gradient tiles into the border strip (origin=padding-box, clip=border-box); ruled fix =
  `background-clip: padding-box` (also D54). Swept SEVEN sites (kit save/`.conf-save`/tick
  chips/switch knob · cosmos primary · vapor plan-pin + summary) + a NEW source-pin guard
  `tests/themes/gradientRim.test.ts` (swept sites AND both precedents). **Emma: SHIP WITH
  FIXES — 1 MED (gacha's ONLINE ribbon `.gc-card .state.on` missed, verified + REPRODUCED by
  mechanism) · 1 LOW (the guard didn't pin shorthand ORDER) · sweep "none"; both ruled FIX →
  main-seat rider `90a7664` (ribbon clipped + SWEPT row; per-block last-shorthand-precedes-clip
  assertion) → her confirm: both RESOLVED with line proof, `.po-chip` immunity sound, rider
  sweep "none" — RESOLVED — SHIP.**
- **NEW: ISS-12** (found by the sweep, deliberately NOT folded in): frontier's border-off sweep
  flattens the modal-footer SAVE to `--surface-2` — collateral of a rule whose own comment
  targets "the fill-less ones"; primary reads like Cancel. One-token fix sketched in the entry;
  it changes frontier's shipped look, so it waits for the owner's ruling. **OF-3 stays
  deferred** (owner-ruled, its own future pass).
- **Gate at tip: 6/6 — BE 2,373 · FE 2,992/175** (counts in QUALITY.md). FE-only wave — :5173
  serves it live; **both dev units RUNNING (D69 presence observation continues, do NOT stop
  the units); no backend restart needed.**
- **▶▶ NEXT: the owner's dev confirm on OF-1 + OF-2** (:5173 — the agents form's dropdowns +
  the SAVE button edges, plus any gradient control they eyeball: tick chips, switch knobs,
  cosmos Wake, the gacha ONLINE ribbon) **→ THEIR WORD closes S4 → S5** (lorebook FE: manager +
  attachment picker + the §6.6 collapsed-entry editor + the `lorebooks.books` editor) — **S5
  still does not start until the owner says they are back home.** The Phase 19 residual
  (`tabbtn-<id>` aria class app-wide) stands.
- **Git: 67 commits unpushed over origin `04769d9`** (the 64 at session open + `9f6b597` build
  + `90a7664` rider + this docs commit); working tree clean; the PUSH ruling stays the owner's.
  **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release
  E, config migration 2→3, rollback = config backup FIRST then v1.7.7) is unchanged and still
  owed; sequencing is the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — start at R51,
  buy only the delta.**

## Prior state (2026-09-07, SIXTH session — §8.4a designed+built+reviewed AND the S4 code round CLOSED; then the OWNER ROUND landed 2 FIX findings (OF-1 dropdown padding · OF-2 gradient-button edge rims + app sweep) — the fix wave ran the NEXT session; superseded above where it speaks)

- **The session opened on the owner's correction: the S4 gallery's "own section" meant INSIDE
  settings, hidden by default like the tools tab — then a deep design pass, then three rulings
  (three placements never-in-two-places · bar slot after chat · mint a JP sub-label).** The full
  road ran in ONE session: probes (one data-driven bar renderer; Material 3's 3–5 cap) →
  **`ROLEPLAY_PLAN.md` §8.4a written = SATELLITE SECTIONS v1** (core four stay on the curated
  count presets; a satellite carries a per-section placement `conf`(DEFAULT)/`button`/`tab`
  composed over the resolved preset by ONE pure `layout.ts#composeLayout`; D35 carries the
  addendum — deliberately NO "5-tab" preset) → **blind Emma DESIGN round SHIP WITH CHANGES
  (0H·3M·2L, all folded) → confirm RESOLVED — SHIP** → **pinned Opus build `d944022`+`fef61c1`**
  (the Conf-hosted gallery group + the Appearance "Agents" Seg under Layout · `ui.sectionPlacement`
  healed at read · `placementKey`-keyed DefaultRoot effects · the aria fix incl. a latent S4 bug ·
  gacha `tabAgents: "キャラ"` — ONE new glyph, subsets regenerated · the `--tab-crowded` 5-up CSS
  step, 360px screenshots clean · **the S4 owner-feel riders CLOSED**: gacha appbar ≤46px and the
  10px off-inset are back by default, pinned in BOTH placement states) → main-seat audit (6/6
  deviations ACCEPTED) → design docs `b0dd5f5` + records `2ea9cd1`.
- **THEN the owed S4 blind CODE round RAN over the widened 7-commit span `e6cd1d9`..`fef61c1`:
  SHIP WITH FIXES — 0 HIGH · 3 MED · 0 LOW, sweep "none", two REPRODUCED; all eleven seeded areas
  explicitly sound (the S1 TTS obligation VERIFIED; no test weakened).** All three ruled FIX →
  **fix wave `d4dd1ef`** (Opus, failing-before proofs: `sectionPlacement?.agents` at the reader ·
  the `GET /agents` tail takes the loop's degrade posture for a malformed configured default ·
  `invalidateAgents` exported + called from the settings-save block; 1 deviation accepted) →
  main-seat audit → **Emma confirm: all three RESOLVED, sweep "none" — RESOLVED — SHIP.**
  Full records = **plan §13-S4's two addenda**.
- **Gate at tip `d4dd1ef`: 6/6 — BE 2,373 · FE 2,982/174** (counts in QUALITY.md). **Dev backend
  RESTARTED onto the tip** (summary map live: default + lynette); **both dev units RUNNING**
  (:5434 + :5173 — D69 presence observation continues, do NOT stop the units).
- **▶▶ THE OWNER ROUND LANDED IN-SESSION (2026-09-07): "it looks good" + TWO FIX FINDINGS + one
  deferral — full record = plan §13-S4's owner-round block. THE NEXT SESSION OPENS ON THEIR FIX
  WAVE:** **OF-1** a dropdown list with ~no padding, options nearly cropping to the screen edges
  (control not pinned — start at the agents surface, pin it first) · **OF-2** a gradient button's
  left/right edge "rims" land on weird SOLID colors (owner thinks the selected agent's SAVE; "we
  had an issue like that before" — find the PRECEDENT, fix, then SWEEP every gradient button for
  the class, owner-directed) · **OF-3 DEFERRED** (text/field/dropdown composition refinement = its
  own future pass, owner-ruled). Then the owner's dev confirm → **THEIR WORD closes S4 → S5**
  (lorebook FE + §6.6 collapsed-entry editor + `lorebooks.books`) — **S5 does NOT start until the
  owner is back home (their word). ⚠ THE EMMA LANE IS UNAVAILABLE (owner, 2026-09-07)** — the OF
  fix wave runs build + main-seat audit only; her rounds resume on the owner's word.
  **Recorded residual → Phase 19:** the `aria-labelledby="tabbtn-<id>"` class is wider than
  agents (every tab body, any can be off-bar).
- **Git: 64 commits unpushed over origin `04769d9`** (the 55 at session open + `b0dd5f5` design ·
  `d944022`+`fef61c1` build · `2ea9cd1` records · `d4dd1ef` fix wave · `3491f31` + the two
  owner-round/handoff docs commits); working
  tree clean; the PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.** The
  v1.7.8 pipeline (Dependabot D1 → push → release E, config migration 2→3, rollback = config
  backup FIRST then v1.7.7) is unchanged and still owed; sequencing is the owner's.
  **NEXT-NEXT (owner): LIVE VOICE/CALL MODE — start at R51, buy only the delta.**

## Prior state (2026-09-07, FIFTH session — S4 BUILT + MAIN-SEAT AUDITED; ⚠ the blind Emma round is OWED and opens the next session; superseded above where it speaks)

- **S4 (the agents surface, §10-S4) is BUILT across two pinned Opus builds — five commits,
  gate green throughout — and MAIN-SEAT AUDITED (all 13 declared deviations across both
  builds ACCEPTED), but NOT council-closed:** the blind Emma round did not run this
  session (ruled deliberately — the S1 precedent, the owner's standing clean-handoff
  directive; build+audit one session, review the next). **Full record = plan §13-S4.**
  - **Build 1 `e6cd1d9`+`52eb52f`:** the F12 `GET /agents` summary map (every agent incl.
    the root default, name-only degrade, one `to_thread`) · `PromptDef.group` + the closed
    `PROMPT_GROUPS` vocabulary · `hooks/useAgentArt` (the ONE summary×media-index join) ·
    picker avatars (additive) · the who-line avatar swap + the synced `chatAvatarsVisible`
    Appearance switch (default ON) · **the standing S1 TTS obligation MET**: `agent` rides
    every TTS request, session-carried for chunked reads, and the live streaming bubble
    already carries its agent — the unpersisted-reply case is covered.
  - **Build 2 `a191839`+`5e4e0e0`+`b84e39e`:** the agents gallery as its OWN section
    (off-bar → a direct docked appbar button in every layout; 2-col card grid; tap =
    in-place detail swap to the SAME AgentRow form; TALK via the extracted
    `pinSessionAgent`) · Conf keeps only the `agent.*` globals · the §9 marked fields under
    the per-field predicate (duties always visible; `alt_greetings`/`lorebooks` round-trip
    only) · the `agents` MEDIA_NS row (FULL_ART, framable, avatars 1:1 / backgrounds 9:16,
    no active resolver — bindings decide) · avatar/background binding rows through the
    untouched `useImageJob` machine (`useMediaUpload.onStored`) · Conf `roleplay` +
    `lorebooks` groups (`books` editor deferred to S5) · the import UI + INLINE report
    (`postForm` + the `refuse()` dedup) · §9a complete (muted pre-fill, `foldEqualDefault`
    at the save end — F15-exact, append survives; customized accent; API-derived groups).
- **Gate at tip `b84e39e`: 6/6 green — BE 2,372 · FE 2,954/173 · local e2e 319 passed both
  projects** (counts in QUALITY.md; the main seat re-ran the full gate independently).
  **Dev backend RESTARTED onto the tip; BOTH dev units RUNNING** (:5434 + :5173 — the
  owner can poke the gallery; D69 presence observation continues, do NOT stop the units).
- **▶▶ THE NEXT SESSION'S FIRST MOVE = the blind Emma round on S4** (R46 brief,
  `--ignore-rules`, commits `e6cd1d9`..`b84e39e` against plan §8/§9/§9a/§10-S4; hermes emma
  lane, `setsid nohup` + a Monitor — the launcher PID dies BY DESIGN, find the real PID;
  `pgrep hermes_cli.main` matches her gateway daemons) → main-seat rulings → fix wave →
  her confirm → THEN the owner's word closes S4 and opens S5 (lorebook FE: manager +
  attachment picker + the §6.6 collapsed-entry editor + the `lorebooks.books` editor).
  **Owner-feel items riding the owner's next dev round:** the gacha appbar +~7px and the
  bar-less-chrome 34px scroll inset (the always-present docked nav action; exits recorded
  in plan §13-S4) · the gallery/report feel · a real card imported through the UI.
- **Git: 55 commits unpushed over origin `04769d9`** (the 49 at session open + the five S4
  commits + this docs commit); working tree clean; the PUSH ruling stays the owner's.
  **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push →
  release E, config migration 2→3, rollback = config backup FIRST then v1.7.7) is unchanged
  and still owed; sequencing is the owner's. **NEXT-NEXT (owner): LIVE VOICE/CALL MODE —
  start at R51, buy only the delta.**

## Prior state (2026-09-06, FOURTH session — S3 LOREBOOKS BUILT + COUNCIL-CLOSED; superseded above where it speaks)

- **S3 (lorebooks, §10-S3) is BUILT + COUNCIL-CLOSED, the full standing cadence in one
  session:** pinned Opus build **`cc1f069`** (the whole plan-§6 subsystem: file-per-book
  storage + CRUD + `POST /lorebooks/import` for the three circulating shapes · the
  once-per-turn PRE-persist scan (F11's no-exclusion form) · ONE global budget/eviction
  pass · head block last-among-plain-blocks BEFORE the named examples, tail block ahead
  of `post_history` · the ruled position/logic downgrade tables, never silent · the card
  `character_book` hook through the SAME importer · `lorebook_intro` registry framing ·
  `LorebooksCfg` additive, no migration) → main-seat audit (all 10 deviations ACCEPTED)
  → blind Emma **SHIP WITH FIXES: 3 MED all reviewer-REPRODUCED + K1/K2 ruled FIX, sweep
  "none"** → fix wave **`9ac5289`** (anchor-rule resume window · off-loop book load ·
  unhashable-position downgrade · slug guard at the read seam · selectiveLogic
  provenance) → **two main-seat riders**: `769b1da` (the resume anchor engages on an
  explicit flag — an attachment-only send is a TURN START with empty text) and
  `39237be` (her confirm-round repro: the anchor now admits attachment-only user rows;
  the rebuilt haystack is BYTE-IDENTICAL across a suspend, closing the ordering LOW
  too) → **micro-confirm: RESOLVED — SHIP, all three bad shapes re-probed by her
  through the REAL seams, sweep "none".** Gate 6/6 throughout; **BE 2,365** (counts in
  QUALITY.md). Full record = **plan §13-S3**.
- **The §6.7 live probe PASSED on the owner's real book:** `Simple Personality
  Traits.json` imported 201 with ZERO warnings (all position 1 = the exact head
  landing; all 36 gates → `and_any` cleanly), landed as `personality-traits`
  (0600, 38KB) and **ATTACHED TO LYNETTE on dev via the editor PUT** — a trait word
  ("groomed", "tidy", …) in a chat with her triggers it live. **The activation chain
  is ALSO proven live (owner ask at close): a canary probe book made the model answer
  a passphrase that exists ONLY in a lorebook entry — one real chat turn on dev,
  probe cleaned up after.** Dev backend RUNNING on
  the `39237be` tip (D69 presence observation continues — units stay RUNNING; two
  harmless probe threads remain in the dev thread list, removable from the UI).
- **Next slice = S4 (the agents surface, §10-S4)**, one slice per session, the owner's
  word opens it — the BE summary-map half FIRST (Emma F12), and it carries the standing
  **⚠ S4 obligation: the FE sends `message.agent` on TTS calls.** The S5 collapsed-entry
  editor requirement (§6.6) stands for its slice. Ops note: the emma-lane `setsid nohup`
  launcher PID dies BY DESIGN (setsid forks) — find the real PID before declaring a
  round dead; a Monitor beats a bash waiter for the wait (waiters got reaped twice).
- **Git: 49 commits unpushed over origin `04769d9`** (the 44 at session open +
  `cc1f069` S3 + `9ac5289` fix wave + `769b1da` + `39237be` riders + this docs commit);
  working tree clean; the PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @
  `578ffa7`.** The v1.7.8 pipeline (Dependabot D1 → push → release E, config migration
  2→3, rollback = config backup FIRST then v1.7.7) is unchanged and still owed;
  sequencing is the owner's.

## Prior state (2026-09-06, THIRD session — S2 CARD IMPORT BUILT + COUNCIL-CLOSED; superseded above where it speaks)

- **S2 (card import, §10-S2) is BUILT + COUNCIL-CLOSED, the full standing cadence in one
  session:** pinned Opus build **`f6aa640`** (`card_import.py` ~604 lines · the three
  containers with magic-byte sniffing, ccv3-wins, CHARX opening `card.json`+icon ONLY ·
  the V1→V2→V3 ladder + the normative SOUL recipe pinned by two goldens · the recursive
  strip pass · `POST /agents/import` composing the existing writes · the additive
  `agents` media namespace · `roleplay.card_import` caps · **the §7/F9 move:
  agent.yaml now writes through `edit_config_yaml`+`sync_mapping`, 0600/quoted/
  comment-preserving, for imports AND the editor's PUT**) → main-seat audit (all 12
  deviations ACCEPTED) → blind Emma **SHIP WITH FIXES: 8 MED · 1 LOW, sweep "none"**,
  four reviewer-REPRODUCED → rulings (7 fixed lean; **MED-1 multipart-spool ingress
  DEFERRED to Phase 19** — `voice.stt` ships the identical posture) → fix wave
  **`6d0711d`** (exact spec discriminator · hostile-JSON containment · JPEG-glued
  CHARX · V3 nickname→`{{char}}` · `_yaml11_safe` quotes KEYS · `dealias_mapping`
  scoped to agent.yaml · V1 heuristic widened · RFC 6901 strip paths) → **confirm: all
  8 RESOLVED with line proof, both rulings accepted, zero new.** Gate 6/6 throughout;
  **BE 2,315** (counts in QUALITY.md). Full record = **plan §13-S2**; residuals (all
  recorded, none owed) live there — headline: the multipart-spool class + the
  `UploadPart` vanished-dir 500 class are Phase 19 register material.
- **Next slice = S3 (lorebooks, §10-S3)**, one slice per session, the owner's word
  opens it. **The S3 session-close scout is already in the plan:** the owner picked
  **`Simple Personality Traits.json`** (their ST install's worlds folder) as the
  import-test book (§6.7 — 36 secondary-key entries, the character-instructions
  class); the S3 brief must pin the **position-downgrade rule** (real books use ST
  positions 0–4 vs our `head|tail`, §6.5) and S5 carries the owner's
  collapsed-entry editor requirement (§6.6). The ⚠ S4 obligation (FE sends
  `message.agent` on TTS) and the ops note
  (hermes emma rounds run FOREGROUND-detached — `setsid nohup` from a foreground call;
  beware `pgrep hermes_cli.main` matching the unrelated gateway daemons) both stand.
- **The session tail ran three owner-driven items (all in plan §13-S2's tail):**
  ① **the live probe on a REAL card PASSED** — the owner picked the ST install's
  `Lynette.png` (dual-chunk ccv3+chara): 201 first shot, V3 precedence + warning, full
  mapping, quoted stash, 0600 agent.yaml, avatar bound, pinned thread seeded her
  greeting rendered (record `475c1b9`; **Lynette is LIVE on dev — the owner can pick
  her from :5173 and talk**). ② **the owner's ST persona "Ari" imported** into
  `roleplay.persona` via the Conf settings API (dev config). ③ It surfaced the S0
  macro hold-out with field evidence (the description opens with `{{user}}`) —
  **owner-ruled FOLD `3b63b24`: `roleplay.persona.description` joins the macro pass**
  (one line, `_scenario`'s idiom, pinned test; §4.3 + §13-S0 amended; **BE 2,316**,
  gate 6/6). The dev backend runs the fold tip; dev units stay RUNNING (D69 presence
  observation continues).
- **Git: 44 commits unpushed over origin `04769d9`** (the 38 at session open +
  `f6aa640` S2 + `6d0711d` its fix wave + `2892adf` S2 docs + `475c1b9` probe docs +
  `3b63b24` the persona fold + this docs commit); working tree clean; the PUSH ruling
  stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.** The v1.7.8 pipeline
  (Dependabot D1 → push → release E, config migration 2→3, rollback = config backup
  FIRST then v1.7.7) is unchanged and still owed; sequencing is the owner's.

## Prior state (2026-09-06, SECOND session — D70 RATIFIED · S0 BUILT + COUNCIL-CLOSED · the app-logging fix; superseded above where it speaks)

- **D70 IS RATIFIED (the owner, in conversation) and wired (`f328d9f`):** the DECISIONS
  entry, the plan's status header, the CLAUDE.md doc-map row, and the TODO **Phase 23**
  block (S0–S7). `ROLEPLAY_PLAN.md` is the spec of record, authority as its header states.
- **S0 (the assembly core) is BUILT + COUNCIL-CLOSED, the full standing cadence in one
  session:** pinned Opus build **`786698c`** (the twelve §3.1 fields · `roleplay:` config ·
  both §4.1a duties texts verbatim as registry entries · `macros.py` · the universal
  Voice/Duties head + the three §4.2 emissions · goldens re-pinned, none weakened) →
  main-seat audit (8 deviations, all ACCEPTED — headline ruling: `{{original}}` carries no
  second `## Voice` heading, the two-heading shape dominates) → blind Emma round **SHIP
  WITH FIXES: 1 MED (conf 0.98), seven areas confirmed sound, sweep "none"** (a valid
  token matched inside a 4+-brace malformed run; `{{original}}` amplification) → main-seat
  fix wave **`fc3901d`** (pattern lookarounds + `_first_only` re-driven off the exported
  `TOKENS` pattern — one token definition everywhere; the ruling also caught and fixed the
  once-rule's literal-substring first-slot steal) → **confirm RESOLVED conf 0.99, zero new
  findings.** Gate green throughout. Full record = **plan §13-S0**.
- **S1 (greeting + example dialogue + voice) is ALSO BUILT + COUNCIL-CLOSED, same
  cadence, same session:** Opus build **`cdf2ccb`** (the shared seeder on exactly the
  two interactive seams — `POST /threads` agent pin + post-route chat seeding; `<START>`
  parsing to ST's named pseudo-messages; the one-line normalizer boundary rule;
  `POST /voice/tts` `agent` param) → audit (all 10 deviations ACCEPTED) → **the live
  probe on the real primary PASSED** (qwen/corsair: greeting seeded + an in-character,
  honest-under-no-tools reply — the conversational duties text behaving exactly as
  designed) → blind Emma **SHIP WITH FIXES: 3 MED** (name-in-frame on strict templates ·
  longest-prefix speaker matching · voice passed as-is) → fix wave **`b26657d`** (+ the
  httpx→WARNING journal rider) → **confirm: all RESOLVED, both trims accepted, zero
  new.** **BE 2,251** (counts in QUALITY.md). Full record = **plan §13-S1**.
  **⚠ S4 obligation recorded: the FE must send `message.agent` on TTS calls** — until
  then per-agent voice is wired but unexercised end-to-end. **Next slice = S2 (card
  import, §10-S2)**, one slice per session, the owner's word opens it. *(Ops note: the
  hermes emma lane's BACKGROUNDED runs died instantly-killed several times this session;
  foreground runs succeed — run her rounds foreground until diagnosed.)*
- **The 09-06 opening item CLOSED — the presence mystery was a LOGGING bug, not the
  phone:** the backend NEVER configured Python logging (no `basicConfig` anywhere), so
  every app-level INFO line — the whole D69 presence trail, the D2-A monitor lines — was
  dropped by the handler-less root logger since forever, dev AND prod. Fix **`c79d9f4`**:
  one `logging.basicConfig(level=logging.INFO)` at the `main.py` import chokepoint;
  proven live within one tick (`presence: phone/tailnet unseen -> online` ·
  `phone/lan unseen -> offline`). **The D69 2–3-night observation clock TRULY starts
  09-06 night; dev units stay RUNNING.** First data point: tailnet online / LAN offline
  at 10:51 while the owner was home — watch whether LAN pins offline (Android ICMP
  power-save class vs a reservation problem). ⚠ Prod (v1.7.7) still has the blindness —
  the fix rides v1.7.8.
- **Git: 38 commits unpushed over origin `04769d9`** (the 30 at session open + `c79d9f4`
  logging + `f328d9f` D70 + `786698c` S0 + `fc3901d` its fix + `e662da1` its record +
  `cdf2ccb` S1 + `b26657d` its fix + this docs commit); working tree clean; the PUSH
  ruling stays the owner's. **Prod untouched: v1.7.7 @ `578ffa7`.**
  The v1.7.8 pipeline is unchanged and still owed (Dependabot D1 bump → push → release E
  per the corrected 09-04 line: config migration 2→3 rides it, rollback = config backup
  FIRST then v1.7.7, pre-tag LOCAL e2e + the three-wave stale-pin sweep) — the roleplay
  phase does NOT block it; sequencing is the owner's.
- **Standing next-next (owner):** LIVE VOICE / CALL MODE after the roleplay phase — start
  at [`R51`](./research/R51-realtime-voice-chat.md), buy only the delta.

## Prior state (2026-09-06, FIRST session — THE CHARACTERS+LOREBOOKS DESIGN SESSION: ROLEPLAY_PLAN COUNCIL-CLOSED, awaiting ratification → D70 → S0; superseded above where it speaks)

- **THE INITIATIVE (the owner's new direction, 2026-09-05/06): SillyTavern-class conversational
  characters — characters ARE agents, one flat system — plus lorebooks as a first-class
  subsystem.** The whole design road ran in this session: 8 owner design rounds in conversation
  (all 21 rulings in the plan's §1) · **four dossiers bought + committed: R64** (roleplay
  prompting) · **R65** (lorebook semantics, deep) · **R66** (card import + editor UX) · **R67**
  (gallery/transcript/voice UX) · an evidence coverage map (§12) on the owner's audit ask · the
  full council cadence (§13): **blind Emma design round BUILD WITH CHANGES (15 findings, ALL
  accepted + folded — her citation check killed 4 plan overreaches) → confirm 13/15 → the 4
  residuals fixed → micro-confirm CONFIRMED.**
  **Spec of record = [`ROLEPLAY_PLAN.md`](./ROLEPLAY_PLAN.md), COUNCIL-CLOSED.**
- **▶▶ THE NEXT SESSION OPENS ON THE OWNER'S RATIFICATION** of that plan → then, in order:
  the **D70** DECISIONS entry + the CLAUDE.md doc-map row + the TODO phase wiring → **the S0
  build brief** (pinned Opus build; S0 = the assembly core — AgentDef fields · macro pass ·
  Voice/Duties split · post-history tail · golden-fixture assembly pins) → S0–S7 per plan §10,
  one slice per session under the standing cadence.
- **Also this session:** ① **a shipped 09-04 bug found in the opening review + FIXED
  (`a2b04fa`):** the ruamel(YAML 1.2) writer emitted Conf-saved `23:00` unquoted; the
  PyYAML(1.1) loader read it as int 1380 → config preflight refused every boot — **dev was
  DOWN 09-04 22:13 → 09-05 ~13:00** (the 09-04 handoff's "dev RUNNING" claim was stale).
  Fix = `_yaml11_safe` quoting at the write chokepoint + 3 tests; BE suite 2,192 green.
  ② **Read-along: the owner's device round PASSED → default flipped ON** (`bec878d`, D63
  amended; ships with v1.7.8). ③ Read-along + roleplay memory files updated.
- **⚠ D69 presence observation: NO transition lines logged yet** — the bricked night lost, and
  since the fix `grep presence:` returns ZERO while the backend served fine (wake_host POSTs
  visible). Either the phone genuinely never transitioned (stayed on WiFi) or the observation
  logging needs a look — **next session eyeballs this before trusting any gap picture**; the
  2–3-night clock effectively starts once lines are confirmed flowing. **Dev units stay
  RUNNING for the observation — do NOT stop them at session close/start.**
- **Git: 29 commits unpushed over origin `04769d9`** (the 09-04 ten + this session's fix +
  the read-along flip + R64–R67 + the plan's design/council commits + this docs commit);
  working tree clean; the PUSH ruling stays the owner's. **Prod untouched: v1.7.7 @
  `578ffa7`.** The v1.7.8 pipeline is unchanged and still owed: the Dependabot D1 lockfile
  bump → push → **release E per the corrected 09-04 line (config migration 2→3 rides it;
  rollback = config backup FIRST, then v1.7.7; pre-tag LOCAL e2e + the three-wave stale-pin
  sweep)** — the roleplay phase does NOT block the release; sequence at the owner's pleasure.
- **AFTER the roleplay phase (the owner's close-of-session ask, 2026-09-06): LIVE VOICE /
  CALL MODE** — "as real-time as we can" voice chat. **START AT [`R51`](./research/R51-realtime-voice-chat.md)
  — the deep dossier already exists** (2026-08-21: the owner's own RealtimeVoiceChat fork +
  Speaches `/v1/realtime` probed + a RANKED build menu; consumer line = ROADMAP §C4 stub; the
  owner's "interesting GitHub projects" are largely already read there). Buy only the delta
  (re-verify the Speaches pin — it moves) before any design talk.

## Prior state (2026-09-04 — THE TWO PRE-RELEASE FEATURES: C3-S2 read-along + the D2-C LAN wake trigger, BOTH BUILT + REVIEW-CLOSED; superseded above where it speaks)

- **The owner picked from the menu: two features ride before v1.7.8** — the C3 S2 read-along
  ("research it again, make sure the plan is solid") and their own new idea, the **LAN-arrival
  wake trigger + quiet hours** (reopening ROADMAP D2's rejected option C). Both went the whole
  road in one session: research (**R63** bought + committed; the read-along got a fit-verification
  pass against HEAD instead — R48/R50 stand) → plans of record → **blind Emma design rounds (both
  BUILD WITH CHANGES, every finding folded, confirm + micro-confirm to explicit closes)** → owner
  rulings taken in conversation → Opus builds → main-seat audits → **blind Emma CODE rounds (both
  SHIP WITH FIXES → fix waves → the LAN confirm round)**. Full records: **[`D69`](./DECISIONS.md)**
  (the LAN trigger) + **D63's 2026-09-04 amendment** (read-along as-built); plans + all review
  records archived at `~/.cache/ctrl-b-plans-20260904/`.
- **8 commits, LOCAL over origin `04769d9`, NOTHING PUSHED:** `968d18d` R63 docs · `5277da2` S2a ·
  `e0dcaed` the S1-shipped strikethrough-`$2` fix (builder-found) · `7de0e98` S2b · `53bc104` the
  read-along fix wave · `165fe63` L1 · `318d4d6` L2 · `996b872` the LAN fix wave (+ this docs
  commit). **Gate at tip: 6/6 green — BE 2,189 · FE 2,906/168** (independently re-run by the main
  seat after a two-builder git-index collision, recovered + verified intact).
- **⚠ v1.7.8 NOW CARRIES A CONFIG MIGRATION (step 3, config_version 2→3** — `presence_device_ips`
  → `presence_devices` objects): menu item E's "NO config/DB migration" line is STALE — **rollback
  off v1.7.8 = restore the config backup FIRST, then v1.7.7** (the proven §Rollback order). No DB
  migration.
- **Dev units RUNNING on tip; the dev config MIGRATED to shape 3** (backup
  `~/.ctrl-b-dev/backups/config.yaml.20260904T200408Z`; **prod untouched: v1.7.7 @ `578ffa7`**,
  still config_version 2) and pre-loaded for the owner: device `phone`
  (tailnet 100.64.151.87 · **LAN 192.168.1.143**) · `lan_health_ip: 192.168.1.1` (the router,
  read from emma's routing table) · quiet hours 23:00–08:00 · **no host has `wake_on_presence`,
  so nothing can fire — observation only**; `chunk_read_along` is OFF (the owner flips it in Conf
  to hear read-along).
- **Owed the owner (their word, no build) — session-close update 2026-09-04:** ① the read-along
  feel round on dev :5173 — **the owner tests TOMORROW MORNING (2026-09-05)**; flip the Conf
  toggle, long replies show the win · ② ~~set the DHCP reservation~~ → **DONE — the owner
  confirmed .143 is already reserved on the router** · ③ after 2–3 nights, read the presence
  journal's gap picture (`journalctl --user -u ctrl-b-dashboard-dev | grep presence:` — the
  INFO transition lines), then flip `wake_on_presence` on the chosen hosts (and tune
  `lan_offline_after_s` from evidence) · ④ the Dependabot D1 lockfile bump (5 HIGH, all
  transitive dev-toolchain — fast-uri via stylelint, browserslist via babel/vite; one
  `npm audit fix`-class commit, triaged 2026-09-04) is the one hygiene item still owed before E.
- **The next session opens on the owner's round results** (read-along feel · anything the LAN
  observation logged overnight): findings → fix waves per the standing cadence; then the
  Dependabot bump · the PUSH ruling (now 10 commits) · **E, the v1.7.8 release** per the
  corrected line below. Dev units stay RUNNING for the owner's round — do not stop them at
  session start.
- **Then the menu's E — the v1.7.8 release** (runbook §Release, Opus-operated · **the 2→3 config
  migration rides it** · rollback = config backup then v1.7.7 · pre-tag LOCAL e2e MANDATORY + the
  stale-pin sweep now covering THREE waves' strings: the fleet wave's labels, the
  attachments/expand strings, AND this session's Conf wake-group renames) → stop the dev units.
- Residuals recorded in D69/D63 (none owed): the fleet sweep's plain-gather exposure → Phase 19 ·
  no automated stale-reservation warning · the read-along device-round pair (autoplay grants ·
  TTS-vs-dictation on speakerphone).

## Prior state (2026-09-03, FINAL — PUSHED: origin = local `main` = `a478bb6` (+ the menu commit); THE RELEASE IS HELD; supersedes below where it speaks)

- **The batch is on origin** (43 commits over `a558d43`, pre-push full gate green; the fleet-wave
  polish + the whole Phase 22 ladder + the S6 fix wave + re-rounds №1–№4b). **The v1.7.8 candidate
  is DELIBERATELY HELD** — the owner: more items go in first. Prod untouched: **v1.7.7 @
  `578ffa7`**. Dev units RUNNING. ⚠ GitHub flagged **2 HIGH Dependabot alerts** at push — untriaged.
- **The next session OPENS ON THE MENU BELOW (owner ask: "the whole menu of things to do… so we
  can decide") — present it, take the pick(s), then work the slice.**

## ▶▶ THE PRE-RELEASE MENU (2026-09-03 — ALL the recorded options; the owner picks, nothing owed)

> **⚠ PARTLY DISCHARGED — read against the Current state block, which rules.** A1 (Phase 22's close)
> is done; Phases 23 and 24 have run since, and v1.7.8 now carries **config migration 2 → 3**
> (rollback = restore the config backup FIRST, then v1.7.7). What is still live here is the *menu of
> owner-owed rounds* (A2's prod device pair, edit-a-prompt, A13), not its release plan or sequencing.

**A · Owed owner rounds (no build):**
 A1. Phase 22 CLOSE — the owner's word (all S6 re-rounds live on dev :5173; the stopped Emma
     closing-probe round re-runs on ask — every earlier finding RESOLVED).
 A2. The prod device pair, standing since v1.7.6: F1 notifications test (master ON → background →
     host transition → tap lands on Fleet) · icon-backdrop fresh install.
 A3. Edit a prompt FOR REAL (Phase 18's first owner-driving; easier post-release, allowed anytime).
 A4. Phase 21 live-use deferrals (ride daily prod use, no session needed): autoscroll on a long
     grid · a >15 MB 413 refusal · the multi-window cast walk.

**B · Build candidates (small/medium, greenlit or recorded):**
 B1. C3 S2 read-along (greenlit 2026-08-20, build on ask).
 B2. D2-A wake-on-presence PROD enable — live-proven 2026-08-30; one machine-editor toggle.
 B3. ISS-10 ② composer glyph cross-fades (owner-parked; one-word revival, recipe in R52 §8.2).
 B4. Phase 22 feel residuals (plan §11): the stack-release direction unanimated · the sheet
     no-rail corner geometry (a talk, not a bug) · keyboard-focus hand-off at the clip's swap.
 B5. W10 residuals (MEDIA_MANAGER_PLAN §12): re-crop generation loss · the 412-on-lost-response
     class · bundled re-art inherits a stored point · delivery-never-throws.

**C · Design talks (no code):**
 C1. A13 — the OpenAI-OAuth/Codex provider talk (owner: "maybe later", standing).
 C2. The parked ledger sweep (§P discipline — only on explicit ask; §P items never re-proposed).

**D · Hygiene:**
 D1. **The 2 HIGH Dependabot alerts (NEW at this push)** — triage first: real dep or archive-class?
 D2. F13 eslint backlog (73 warnings, trigger-gated; counts live in QUALITY.md).
 D3. Re-run the stopped Emma closing-probe round on the height-transition retarget (optional).

**E · THE CLOSER — the v1.7.8 release candidate** (when the owner says the menu is done):
 runbook `deploy/linux/README.md` §Release, Opus-operated · NO config/DB migration · rollback
 v1.7.7 · **pre-tag LOCAL e2e MANDATORY** + the stale-pin sweep over the fleet wave's labels AND
 the attachments/expand strings (three tags have burned on this class) · then stop the dev units.

**LAST, never leading a menu: Phase 19 (D58)** — owner ruling 2026-08-29: it rides the 1.8
endgame (Emma's lane-stall MED, CM-1, H-E2E's flake register all fold in); 1.8 stays RESERVED
for the final ROADMAP/ISSUES cleanup wave.

## Prior state (2026-09-03, cont. — THE S6 RE-ROUNDS №1–№3: the owner's live feel findings, built same-day; superseded above where it speaks)

- **After the fix wave closed, the owner drove THREE more live rounds in conversation, all built +
  reviewed same-day** (full record = [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11's
  S6-RE-ROUNDS block): **№1** the line pill's CONTROL STACK (mic over send once the column FITS —
  painted-height currency, controls-aware needs, the one-flip-per-input LATCH; 4 review rounds to
  converge) · **№2** the FEEL round (the 150ms height transition — an owner-ruled scoped §14.11
  exception — the mic's stack-hop, the toggle on the lane centreline, the 20px glyph) · **№3** the
  112px resting ceiling (= the control column exactly, so the trio stacks at rest from 5 lines)
  **+ the live-height RETARGET** (mid-flight re-measures now retarget the transition instead of
  snapping it — MutationObserver-diagnosed, Chromium-probed green in both geometries).
- **THE PUSH RULING LANDED (owner, 2026-09-03): the whole batch goes to origin; THE RELEASE IS
  HELD** — the owner wants more items in before the v1.7.8 candidate ("we had some other things we
  could do before that"). Re-rounds №4/№4b rode the tail (`9fd66ea`+`2d8f349`: the line field's
  side paddings, closed on the owner's measured symmetry rule — text↔glyph = glyph↔pill-edge =
  18/18/18, screenshot-proven). When the release DOES go: runbook §Release, Opus-operated · NO
  migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over the fleet wave's
  labels AND the attachments/expand strings.
- **⚠ THE FINAL Emma closing-probe round was STOPPED before a verdict** — every earlier finding is
  explicitly RESOLVED, but MED-1's closure rests on the main-seat's own probes; re-run her round on
  the owner's word if wanted. **The owner's word still closes Phase 22.**
- **Gate at tip: FE check-all exit 0 — 2,849/167** (BE untouched since 2,145). Local `main` =
  origin `a558d43` + **43 commits** (incl. re-round №4: the line field's side paddings 4/2 — the
  text hugs the menu lane and the clip, `9fd66ea`), NOTHING PUSHED. Prod untouched: **v1.7.7 @ `578ffa7`**. Dev
  units RUNNING; :5173 serves everything (the owner's dev config runs the LINE composer — that fact
  explained a whole review-round divergence).

## Prior state (2026-09-03 — THE S6 FIX WAVE: the owner's device-round findings built + council-CLOSED; superseded above where it speaks)

- **The S6 owner round LANDED (3 findings) and its fix wave ran the whole cadence in one session:**
  design → blind Emma design round (BUILD WITH CHANGES, 6 MED · 1 LOW, sweep "none") → all seven
  main-seat-ruled → Opus build **`8dce2ca`** → main-seat audit (+ rider `4eb92e4`) → confirm round
  (6/7 RESOLVED; MED-6 survived TWO more rounds: `9a8b6d9` the projection's own 1M-char thumb
  budget, `ee2bf55` the prefix rule) → **final micro-confirm: RESOLVED, zero new findings.** Full
  record = [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11's S6-fix-wave block (+ the §7 rider).
- **What changed for the owner:** with files staged, the clip and the expand toggle live in the
  rail's control TAIL at the composer's top-right (clip right above the send; Telegram corner for
  the chevrons) and the field row gets its width back; staged attachments now SURVIVE the Android
  tab discard (persisted rows + JPEG thumbs, restored on load; a >24h-stale chip refuses at send
  with the server's own sentence). No-rail placements and the expand BEHAVIOR are unchanged
  (owner-accepted).
- **Gate at tip: 6/6 green — BE 2,145 · FE 2,841/167 · attachments e2e 10/10 both projects**
  (incl. the new stage→reload→send scenario). Local `main` = origin `a558d43` + **32 commits**
  (this docs commit included), **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**.
- **Dev units RUNNING** (:5434 + :5173); the wave is frontend-only, so :5173 serves it live.

## ▶▶ NEXT (2026-09-03) — ✅ ALL DISCHARGED

The re-rounds ran (№1–№3, council-closed same day) and the push landed. ⚠ **The release plan this
block carried is SUPERSEDED**: v1.7.8 now carries **config migration 2 → 3**, so rollback is
*restore the config backup FIRST, then v1.7.7* — see the 2026-09-04 block above.

## Prior state (2026-09-02, cont. — S4 + S5 CLOSED: THE PHASE 22 BUILD LADDER IS COMPLETE; superseded above where it speaks)

- **S0–S5 are ALL council-closed** (every slice: pinned Opus build → main-seat audit → blind
  Emma round → fix wave on main-seat rulings → her explicit RESOLVED close; full records = the
  per-slice blocks in [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11). This session closed:
  **S4** (`e65f02a`+`6c31c1f` — pypdf extraction, both-names-free claim walk + exclusive sidecar
  publish, surrogate-safe; 2 MED reviewer-REPRODUCED) and **S5** (`115178e`+`dbc63ad` — the
  expand affordance as a taller ceiling on the shared chrome seam; the `.line-row` wrapper that
  retired S3's `order:-1` trick; viewport-reactive measurement).
- **Gate at tip: 6/6 green — BE 2,145 · FE 2,799 · the attachments e2e spec green both
  projects.** Local `main` = origin `a558d43` + **27 commits** (this docs commit included),
  **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**.
- **Dev units RUNNING and the dev backend was RESTARTED onto the ladder tip** — :5173 serves the
  whole attachments feature for the owner's round.

## ▶▶ NEXT (2026-09-02, post-ladder) — ✅ ALL DISCHARGED

S6 ran and Phase 22 closed 2026-09-03. ⚠ Its "NO config/DB migration · rollback v1.7.7" release
plan is **SUPERSEDED** (v1.7.8 carries config migration 2 → 3 — the 2026-09-04 block rules).

## Prior state (2026-09-02 — S3 BUILT + REVIEWED + CLOSED; superseded above where it speaks)

- **S3 (the FE slice) is CLOSED:** build `bb290ca` → blind Emma round SHIP WITH FIXES (6 MED,
  incl. her Q6 ruling: fix the optimistic-bubble gap in-wave) → fix wave `eb964d2` (the status
  LADDER `uploading→staged→sending→consumed|released`; seam-owned gates; sync admission;
  image-guard scoped; ready-only sendability; the presentational snapshot) → confirm: 1..5
  RESOLVED, MED-6 chained one MED → main-seat tail fix `9d151ab` (the bubble sheds its snapshot at
  release) → **micro-confirm RESOLVED, "none"**. Gate 6/6; BE **2,126** · FE **2,771**; the
  attachments e2e spec green both projects (+ a held-POST accept-window test). Full record =
  ATTACHMENTS_PLAN §11's S3 blocks. The rail/clip geometry is built AS RULED (grammar ②; sheet =
  embedded-field clip left of the mic) — **the owner has NOT yet eyeballed it; S6 carries that.**
- **Local `main` = origin `a558d43` + 21 commits** (16 prior + `bb290ca` + `eb964d2` + `9d151ab` +
  the S2-docs + this docs commit), **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**.
  Dev units RUNNING (⚠ the dev backend predates S1–S3 — restart `ctrl-b-dashboard-dev` before any
  owner poke at attachments).

## ▶▶ NEXT (2026-09-02, post-S4) — ✅ ALL DISCHARGED

S5 and S6 both ran and closed. **The one durable thing here is the S5 design ruling** (main seat, on
R62 §5's landed evidence): ≥3-line trigger · top-right · quiet per §7 · expansion = **a TALLER
AUTO-GROW CEILING on the shared `useComposerChrome` seam** (Signal's outcome — no modal, no second
editor) · mic untouched, because peers hide it only when their expanded state is a *mode* and ours is
a *ceiling*. Full record: plan §11-S5. ⚠ Its "rollback v1.7.7" line is **SUPERSEDED** (see above).

## Prior state (2026-09-01, THIRD session, cont. — S2 BUILT + REVIEWED + CLOSED; superseded above where it speaks)

- **The owner ruled (this session): the WHOLE ladder S2→S6 proceeds slice-by-slice under the full
  council cadence** (pinned Opus build → main-seat audit → blind Emma round → fix wave → her
  confirm), S6 staying the owner device round. No per-slice owner gate is owed until S6.
- **S2 (the model feed) is CLOSED:** build `5c827b8` → fix wave `7ea2970` (2 MED · 1 LOW from the
  blind Emma round, main-seat ruled — headline: the D64 whole-line rule BENDS for foreign files,
  CUT at `max_inline_chars` over her price-the-facts fix) → confirm RESOLVED WITH NEW FINDINGS →
  the 1 new LOW folded `b5974f5` (main-seat, `_marker_cost` longest form) → **micro-confirm
  RESOLVED, "none"**. Gate 6/6, BE **2,114**. Full record = ATTACHMENTS_PLAN §11's S2 blocks —
  incl. the **dimensions-notice amendment** (Emma-accepted) and the **⚠ S4 sweep/sidecar
  obligation** (the referenced set must learn sidecars or extraction self-deletes).
- **Local `main` = origin `a558d43` + 16 commits** (12 prior + `5c827b8` + `7ea2970` + `b5974f5` +
  this docs commit), **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**. Dev units RUNNING.

## ▶▶ NEXT (2026-09-01, post-S2) — ✅ ALL DISCHARGED

S3–S6 all ran and closed (the S2 sidecar sweep-arm obligation was MET at S4). ⚠ Its "NO migration ·
rollback v1.7.7" release plan is **SUPERSEDED** (see above).

## Prior state (2026-09-01, THIRD session — THE S1 FIX WAVE: built + Emma-confirm RESOLVED; S1 IS CLOSED; superseded above where it speaks)

- **The S1 fix wave RAN the full cadence and CLOSED:** main-seat rulings on all five recorded
  findings (each re-derived to the leanest fix) → ONE Opus build from a pinned brief
  (**`eff4bfd`**: MED-1 `_real_root()` fail-closed housekeeping via `require_real_dir` reuse ·
  MED-2 the pre-txn re-peek in `_drain_steers` · LOW-3 the recursive live-route walker + non-empty
  harvest in BOTH no-POST pins · LOW-4 the four-seam only-writer grep · Q10 `created_here` +
  `threads.delete()` before the 409) → main-seat audit (both declared deviations ACCEPTED: the two
  old Q10 pins rewritten in place; the drain-helper duplication recorded) → **Emma confirm round
  (resumed session): RESOLVED, all five with line proof, zero new findings, open sweep "none"** —
  she explicitly accepted the MED-1 root-only and LOW-4 named-seam scope rulings. Gate 6/6 green,
  BE 2,068→**2,075**. Full record = [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11's S1-FIX-WAVE
  block. **S1 is DONE; the owner's word gates S2.**
- **Local `main` = origin `a558d43` + 12 commits** (the 10 prior + `eff4bfd` + this docs commit),
  **NOTHING PUSHED**. Prod untouched: **v1.7.7 @ `578ffa7`**. Dev units RUNNING (unchanged).

## ▶▶ NEXT (2026-09-01, post-fix-wave — in order; supersedes the lists below)

1. **The owner's word on S2** (the per-slice gate is satisfied: build + audit + Emma RESOLVED).
   Then **S2 → S6 per plan §9**, one slice per session under the budget directive: S2 model feed →
   S3 FE → S4 PDF → S5 expand → S6 owner device round.
2. **The v1.7.8 pipeline still stands (the fleet wave, unchanged):** the owner tests on dev
   (:5173) — the retimed morph · the pick-grow · a REAL reboot (⚠ dev drives the real fleet) →
   the PUSH ruling (now 12 commits) → release v1.7.8 (runbook §Release, Opus-operated · NO
   migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over both waves' labels)
   → stop the dev units.
3. **The standing menu unchanged:** owner device pair on prod + edit-a-prompt (easier
   post-release) · A13 design talk · parked ledger · **Phase 19 goes LAST** (1.8 RESERVED).

## Prior state (2026-09-01, SECOND session — THE S1 EMMA ROUND: review RAN + RECORDED, NO fix wave; superseded above where it speaks)

- **The owed S1 Emma-lane round RAN and is RECORDED — NOTHING fixed, nothing built** (owner
  directive at ~98% weekly usage: no fix wave, hand off; the fix wave opens the next session).
  Blind sol high (`--ignore-rules`, the Hermes emma lane) over `fce822e` + `adfddf6` against plan
  §2/§3/§8/§9-S1, R46 brief (known-findings exclusion list · the recorded LOW as an explicit
  question-10 ruling ask · bounded open sweep). **VERDICT: SHIP WITH FIXES — 2 MED · 2 LOW ·
  Q10 = FIX · open sweep "none"; she ran the focused suites herself (127 green).**
- **The findings live verbatim in [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) §11's
  S1-Emma-round block** (the scratchpad copy was tmpfs — the plan block IS the record).
  Headlines: **MED-1** (conf 0.99, reviewer-REPRODUCED) — the boot sweeps + thread-delete
  cleanup follow a SYMLINKED attachments root and delete outside `$CTRLB_HOME`; fix = fail-closed
  root/ancestor check. **MED-2** (0.94) — a steer deleted/harvested DURING its multi-file claim
  still persists its message; fix = ownership re-check immediately before the transaction.
  **LOW-3/LOW-4** — both new architecture pins are weaker than their names (schema-hidden
  POST/multipart escapes the OpenAPI pin · the claim-only-writer pin greps a literal).
  **Q10** — she rules FIX: `created_here` → the existing `ThreadRepo.delete()` in the
  `StoreWriteError` branch before the 409. Sound-checks explicitly cleared the load-bearing
  areas (claim exclusivity both orderings · the admission ladder · part-union additivity ·
  steer coalescing · the media refactor behavior-preserving).
- **Local `main` = origin `a558d43` + 9 commits + this docs commit, NOTHING PUSHED.** Prod
  untouched: **v1.7.7 @ `578ffa7`**. Dev units RUNNING (unchanged this session).

## ▶▶ NEXT (2026-09-01, post-review — in order; supersedes the lists below)

1. **The S1 fix wave (the next session's FIRST move):** main-seat rulings on the recorded round
   (plan §11 — findings are advisory; re-derive the leanest fix per finding: MED-1/MED-2 look
   fix-worthy, LOW-3/LOW-4 are pin strengthenings, Q10's FIX is small and she named the seam) →
   ONE Opus fix wave from a pinned brief → main-seat audit → the Emma confirm round (try
   `--resume latest --in /home/emma/github/ctrl-b` first — context-intact beats a fresh agent;
   re-state `--ignore-rules`) → gate green → **the owner's word before S2.**
2. **S2 → S6 per plan §9**, one slice per session under the budget directive (unchanged): S2
   model feed → S3 FE → S4 PDF → S5 expand → S6 owner device round.
3. **The v1.7.8 pipeline still stands (the fleet wave, unchanged):** the owner tests on dev
   (:5173) — the retimed morph · the pick-grow · a REAL reboot (⚠ dev drives the real fleet) →
   the PUSH ruling (now 10 commits) → release v1.7.8 (runbook §Release, Opus-operated · NO
   migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over both waves' labels)
   → stop the dev units.
4. **The standing menu unchanged:** owner device pair on prod + edit-a-prompt (easier
   post-release) · A13 design talk · parked ledger · **Phase 19 goes LAST** (1.8 RESERVED).

## Prior state (2026-09-01 — THE A8 SESSION: composer attachments designed → council-closed → S0+S1 BUILT; superseded above where it speaks)

- **Local `main` = origin `a558d43` + 8 commits, NOTHING PUSHED**: the 3 fleet-wave polish commits
  (`eed7045`/`b7033c3`/`223bc5c` — the v1.7.8 material; **the owner's test round on those is
  STILL OWED**, item 3 below) + **5 A8 commits** (`f2e3b98` design docs · `756996b` S0 ·
  `fce822e` **S1 build** · `0aa7f22` R62+v2.3 · `adfddf6` S1 audit record). Prod untouched:
  **v1.7.7 @ `578ffa7`**. Dev units RUNNING (the owner used them for the HEIC check).
- **Phase 22 (ROADMAP A8, composer attachments) OPENED — D68 RATIFIED.** Spec of record =
  [`ATTACHMENTS_PLAN.md`](./ATTACHMENTS_PLAN.md) **v2.3**: full council trail in its §11 (Emma
  blind + adversarial Opus, both to explicit closes; transport B unanimous; the UX amendment
  round Emma-CLOSED). Evidence = **R61** (chat-attachments field) + **R62** (attach-composer
  grammar), both indexed. Owner rulings locked: images+text+PDF, NO RAG · durable per-thread
  files + the `read_attachment` re-read tool · **the in-composer h-scroll thumbnail RAIL** (NO
  Telegram caption modal — Telegram gives only the quiet clip style + the expand button) · mic
  never blocked by staged files · the expand affordance = slice S5 (≥3 lines, top-right,
  fullscreen; rides `useComposerChrome`, line composer renders the trigger) · **bubble image
  display IS v1** (owner overrule of the no-GET-route call) · minimal no-vision floor (per-hop
  strip, `input_modalities`).
- **S0 ✅** (`756996b`; the HEIC device check RAN — the Honor 20's camera photos arrive as
  JPEG). **S1 ✅ BUILT** (`fce822e`, Opus from the pinned brief; **gate 6/6 green, BE
  2,002→2,068, 66 new tests**) **+ main-seat audit DONE** (`adfddf6`): all 11 declared
  deviations ACCEPTED — headline: the claim lands by `os.link`+`os.unlink` exclusive-claim (the
  plan §3's `os.replace` would have clobbered the collision suffix; §11 records the correction) —
  and the builder's discovery that the D65 no-POST pin's route-table loop matched NOTHING under
  this FastAPI was main-seat-confirmed and FIXED in place (OpenAPI-paths assertion).
- **⚠ BUDGET (owner, 2026-09-01): ~91% of the weekly usage limit.** STANDING until reset:
  **pause between each slice**, no back-to-back council marathons. The S1 Emma round was
  deliberately NOT launched under this directive — it is the next session's first move.

## ▶▶ PRIOR (2026-09-01 — the A8 session's list): ✅ item 1 RAN in the second session (the block above is the record; superseded)

1. **The S1 Emma-lane review round (OWED — the per-slice gate):** blind sol round over
   `fce822e` + `adfddf6` against plan §2/§3/§9-S1 — include the recorded LOW (a first-send whose
   claim refuses leaves its freshly created thread empty; rule fix-or-accept). Fix wave on
   findings, then the owner's word before S2.
2. **S2 → S6 per plan §9**, one slice per session under the budget directive: S2 model feed
   (assembly branch · estimator arm · the per-hop strip named `drop_unsupported_modalities` ·
   `read_attachment` + `InvocationContext.thread_id` · compaction manifest) → S3 FE (the RAIL +
   quiet clip + ruled docked-sheet placement + the mic-auto-send-with-staged-files test + the GET
   route/bubble images) → S4 PDF → S5 expand → S6 owner device round.
3. **The v1.7.8 pipeline still stands (the fleet wave, unchanged):** the owner tests on dev
   (:5173) — the retimed morph · the pick-grow · a REAL reboot (⚠ dev drives the real fleet) →
   the PUSH ruling (now 8 commits) → release v1.7.8 (runbook §Release, Opus-operated · NO
   migration · rollback v1.7.7 · pre-tag LOCAL e2e + the stale-pin sweep over both waves' labels)
   → stop the dev units.
4. **The standing menu unchanged:** owner device pair on prod + edit-a-prompt (easier
   post-release) · A13 design talk · parked ledger · **Phase 19 goes LAST** (1.8 RESERVED).

## Prior state (2026-08-31 — THE PRE-RELEASE POLISH SESSION: the feel pair + REBOOT as the third pending kind, built + review-CLOSED + committed; superseded above where it speaks)

- **Local `main` = origin `a558d43` + 3 commits** (`eed7045` the feel pair · `b7033c3` the reboot
  kind · the docs commit carrying this block). **NOTHING PUSHED this session — the push ruling is
  the owner's.** Prod untouched: **v1.7.7 @ `578ffa7`**. **Dev units deliberately LEFT RUNNING**
  (:5434 + :5173) — the owner said they'll test the new things; do not stop them at session start.
- **The session ran the 2026-08-30 pre-release menu's quick items, owner-ruled in prose:**
  - **`eed7045` — the gacha feel pair.** ① The dossier-open morph retimed (the owner: "the first
    half is just too quick"): flight 560→**500ms**, portrait cross-fade 280→**340ms** — the fade
    now rides 68% of the arc so the poster's sheared crop un-crops across most of the glide
    instead of snapping into the full frame early; the rarity-badge hold-back legs rescaled
    560→500ms so the badge still lands with the frame. ② The pick swap got a subtle **160ms
    one-way grow** on the newly picked band — an ANIMATION on `.picked`, deliberately not a
    transition on the base slice: the outgoing band still snaps down, which is what keeps the
    V-POSTER trial's collide/zoomed-out beat dead. Reduced-motion gated. (Menu item ② — the
    dossier-open outgoing-leg knob — was CLOSED without build: the owner ruled the dossier fine.)
  - **`b7033c3` — REBOOT joins the pending power transitions (D67 amendment, in DECISIONS).**
    The only TWO-PHASE kind: online at dispatch, so agreement = observed DOWN (recorded as
    `sawDown` on the entry, copy-on-write) then observed UP; ceiling **5 minutes** (owner-ruled,
    `REBOOT_WINDOW_MS`; the windows are a `Record<PendingKind, number>` table now).
    `overlayPending` presents the COMMANDED END STATE per kind — shutdown→offline,
    reboot→**ONLINE** (the restart's dip never reads as a lost member); never fabricates a
    status. Chips + all three gacha label helpers say **REBOOTING** via one `livenessWord`
    precedence (rebooting > online > waking > sleeping — reboot outranks online because the
    overlay presents it AS online); the cover's develop ceremony gates on the WAKE kind
    specifically. **The gacha seam MIGRATED rather than grew a sibling set**:
    `GachaTrackProps.waking: ReadonlySet` → `pending: ReadonlyMap<string,{kind}>` (the store map
    handed down whole; the extend-not-migrate rule decided it). +16 tests → FE **2,672/160**.
- **The council trail (the standing cadence, whole):** Emma-lane blind design round (sol high,
  `--ignore-rules`) **BUILD WITH CHANGES** — 2 LOW, both test obligations, both folded (the
  reboot-overlay store pin · rebooting-outranks-online label asserts); open sweep "none"; the CSS
  feel pair reviewed in the same round, declared sound → Opus 5 build from a pinned brief →
  main-seat audit accepted its two deviations (the module-private `livenessWord` dedup · the
  shared agreement expression flipped to `kind === "shutdown" ? !online : online` so
  post-`sawDown` reboot rides the wake line) → Emma confirm round **RESOLVED, zero new findings**
  (she re-ran the full gate herself). Gate green per commit.
- **Residual recorded, not fixed (builder-found, out of scope):** `REBOOTING` is one character
  wider than `SLEEPING`, and `layout.spec.ts`'s 5★ pair-card collision breakpoint was measured
  against `SLEEPING` in the 366–380px band — transient (bounded by the 5-min window), unpinned by
  any assertion; one owner eyeball if a rebooting card is ever caught at that width.

## ▶▶ PRIOR (2026-08-31 — the owner tests, then the release): items 1–3 = today’s NEXT item 3; superseded above

1. **Collect the owner's round on dev (:5173)** — they said they'll test the new things: the
   retimed open morph (the 340ms fade is the knob if it still reads abrupt — feel, not
   mechanism) · the pick-grow's subtlety (160ms is tunable) · a REAL reboot on a machine they can
   afford to restart (expect: tile holds steady + REBOOTING chip through the whole restart,
   actions disabled, clears on the polls seeing it back — or at 5 min if it never returns).
   ⚠ Dev drives the real fleet — a reboot from :5173 actually reboots the machine.
2. **The PUSH ruling** (owner's word) — 3 commits, origin `a558d43`.
3. **THE RELEASE — v1.7.8** (on the owner's word): runbook §Release, Opus-operated · NO config or
   DB migration (D67 + this session are config-free) · **rollback = v1.7.7** (one step) · the
   pre-tag LOCAL e2e is MANDATORY and the stale-pin sweep now covers BOTH waves' strings (the
   fleet wave renamed aria-labels/chips; this session's REBOOTING strings are new and unpinned —
   verified: no e2e pins `waking`/`WAKING`, and the `sleeping`/`SLEEPING` pins are all
   unchanged-state strings). Then stop the dev units (on-demand policy).
4. **The rest of the 2026-08-30 menu stands** (none owed): the owner device pair on prod + edit a
   prompt for real (easier AFTER the release) · Phase 21 live-use deferrals riding daily use ·
   A13 design talk · parked ledger. **Phase 19 (D58) goes LAST** (owner ruling 2026-08-29 — it
   rides the 1.8 endgame; 1.8 stays RESERVED for the final ROADMAP/ISSUES cleanup wave).

## Prior state (2026-08-30 — THE FLEET WAVE: D67 pending power transitions + the gacha transition redesign, PUSHED; superseded above where it speaks)

- **Origin = local `main` = `7096522`** (+ this docs commit): two commits on top of v1.7.7 —
  `210c20b` (chore: env-gated Vite HMR `clientPort` for the phone rig) and `7096522` (**D67** +
  the transition redesign). Full pre-push gate green (BE 2,002 · FE **2,656/160** · tsc/eslint/
  prettier). **Prod untouched: v1.7.7 @ `578ffa7`. NOTHING RELEASED from this wave yet.**
- **D67 (DECISIONS, + same-day rider): app-wide pending power transitions.** The owner's live
  finding — WAKING blinked ~100ms then SLEEPING for the whole boot; shutdowns bounced
  offline→online→offline — was the assumed-state-vs-poll-truth class (HA core#86735). Now:
  `store/fleetPending` holds a per-host `{kind, token}` from DISPATCH until poll agreement, the
  per-direction ceiling (wake 180s · shutdown 90s), or request failure; `useFleet` presents hosts
  through the overlay and folds pending into `busy`; the optimistic cache flip is DELETED;
  frontier's brand count reads through the overlay; gacha chips/ceremony/labels carry WAKING
  truthfully on all three layouts; **the grace window holds ACTIONS never SELECTION** (cover
  disables only the hero, poster only the picked slice). Council: 4 blind sol rounds (design →
  diff-confirm → 2 MEDs → final RESOLVED) + an Opus test-rework subagent; every finding folded.
- **The gacha fleet-tab transitions, owner-ratified:** cover promote = ONE simultaneous hero
  cross-fade (target-bound inert ghost; the lab's page fold / hero zoom / masthead pulse DELETED) ·
  poster pick swaps SNAP (wake ceremony keeps its glide under `.staging`) · **the dossier-open
  96%/104% page zoom is DEAD** — the long-banked E1 "screenshot flicker" item, finally reproduced
  by the owner; the `detail` page pair is a duration-only fade and only the portrait/cutout flies.
- **Wake-on-presence (D2-A): LIVE-PROVEN and returned to OFF.** The dev rig test fired for real
  (2026-08-30 06:49Z, `wake_host → vault`, actor system, on the phone's tailnet arrival). The dev
  config's vault flag is reverted; prod keeps per-host switches OFF. Enabling for real = one
  machine-editor toggle, whenever wanted.
- **The rig is torn down** (`:8443` off, dev units stopped, the HMR drop-in removed). The
  2026-08-29 owner rounds also drove the whole design live on the phone via that rig — the
  standing move for feel sessions (the vite seam is now committed).

## ▶▶ PRIOR (2026-08-30 — the PRE-RELEASE menu): ✅ the quick items RAN 2026-08-31 (① built as the feel pair, ② closed without build, ⑤ built as the reboot kind — the block above is the record; superseded where it speaks)

**The release itself (v1.7.8, on the owner's word):** runbook §Release, Opus-operated · NO config
or DB migration rides this wave (D67 is config-free) · **rollback = v1.7.7** (one step — both
sides are config_version 2) · the pre-tag LOCAL e2e is MANDATORY, and this wave is exactly the
stale-pin trigger class (renamed aria-labels + chips + deleted keyframes — sweep non-exact e2e
`name:` pins against the new label forms first).

**Polish candidates before (or with) the release — none owed, all recorded:**
1. **Poster pick-snap feel** (owner: "a little harsh… review later") — likely shape: a quick fade
   on just the two affected bands, not the old glide.
2. **The dossier-open page fade's outgoing leg** went 200→300ms — the ONE knob if the owner's
   "slight sluggishness in the shrink" feeling persists (the 560ms portrait spring is ruled look;
   the Emma round found no jank mechanism).
3. **Owed owner device pair on prod, standing since v1.7.6:** ① F1 notifications device test
   (master ON → background → host transition → tap lands on Fleet) · ② icon-backdrop fresh
   install. ③ **Edit a prompt for real** (Phase 18's first owner-driving, still owed).
4. **Phase 21 live-use deferrals** riding daily prod use: autoscroll on a long grid · a >15 MB
   413 refusal · the multi-window cast walk. Plus W10 residuals (plan §12).
5. **Reboot as the pending model's third `kind`** (D67 boundary — additive when wanted).
6. **A13 design talk** (OpenAI-OAuth/Codex provider; owner: "maybe later").
7. Parked/standing: ISS-10 ② glyph cross-fades (owner-parked) · C3 S2 read-along (build on ask) ·
   Emma's lane-stall MED → Phase 19 · §P discipline.

**Phase 19 (D58) goes LAST (owner ruling 2026-08-29): it rides the 1.8 endgame — polish first,
never lead a session menu with the hardening court.** 1.8 stays RESERVED for the final
ROADMAP/ISSUES cleanup wave; this wave's e2e observations keep feeding H-E2E's register.

## Prior state (2026-08-27, SECOND block — 🏁 **RELEASED + LIVE v1.7.7; PHASE 21 IS DONE**; superseded above where it speaks)

- **PROD = v1.7.7 @ `578ffa7`, RELEASED + LIVE 2026-08-27** (Opus-operated runbook run, main-seat
  spot-verified): push → CI green (run 33068811160) → **the mandatory pre-tag LOCAL e2e** (first
  run 306/1 — the ONE fail was the KNOWN `layout.spec.ts` scroll-restoration contention flake
  (~1-in-5, already → Phase 19 H-E2E; dev units were running alongside), characterized before
  proceeding: spec-alone pass + a clean FULL re-run **307/0**; NOT the stale-pin class — the
  renamed labels passed both runs) → tag → release gate green (run 33069680443, 7m55s, e2e ✓) →
  `update.sh v1.7.6→v1.7.7` → all four verifications green (describe = v1.7.7 · health version
  1.7.7 · icon-192 content-type png · unit active).
- **The config_version 1→2 fold LANDED at cutover** (main-seat verified on disk: `config_version:
  2`). **⚠ ROLLBACK OFF v1.7.7 IS TWO STEPS:** restore
  `~/.ctrl-b/backups/config.yaml.20260827T120614Z` FIRST, then re-deploy **v1.7.6** (which cannot
  read shape 2; §Rollback order is the safety property). DB snapshot
  `ctrlb-20260827-140614.db.gz` (schema 6 untouched). ⚠ v1.7.5/v1.7.3/v1.7.0 stay tagged-never-
  deployed — not rollback targets.
- **The rig is torn down**: `:8443` serve removed (443 → prod :5433 alone), dev units STOPPED
  (on-demand policy). Origin = local `main` = release sha + this docs commit; nothing else open.
- **Owed to the owner (no session needed):** the first prod ride on the phone — ordinary daily
  use now carries the deferred live-use probes (autoscroll on a long grid · a >15 MB refusal
  whenever one occurs · the multi-window walk as they browse). Findings → fix waves as ever.

## ▶▶ NEXT (2026-08-27, post-release — a clean session; supersedes the lists below)

1. **Nothing is owed on Phase 21.** Live-use findings from the owner's daily prod rides get
   triaged as they land (bug → fix wave · feel → prose first). W10/S6 residuals stay recorded in
   the plan (§12) — none owed now.
2. **The 2026-08-22 menu governs again** (the standing order): **Phase 19 (D58) owner court**
   (spec-complete; at wake the delta council check first, then the §10 rulings — the phase's
   †-items and Emma's lane-stall MED fold in; the e2e flake register candidate from this
   release's pre-tag run joins H-E2E's evidence) · the **A13 design talk** · the parked ledger
   (§P discipline).
3. **1.8 stays RESERVED** for the final ROADMAP/ISSUES cleanup wave.

## Prior state (2026-08-27, FIRST block — S6 ran and closed; superseded above where it speaks)

- **The owner drove the round on the Honor 20 over real HTTPS** — rig: a second Tailscale Serve
  port (`:8443 → :5434`, the dev backend serving a fresh PRODUCTION build of tip; prod untouched
  on 443; separate origin keeps the prod PWA's service worker out of the way). **Two catches, both
  fixed + committed in-round** (main-seat, trivial-leaf fast-path; 360px+390px visual proof, full
  FE gate + 38 media e2e per commit): ① the six-button pill clipped Delete at the phone's REAL
  360px viewport (desktop rounds all ran ≥390) — now the pill **wraps between its clusters**
  (`3d65a69`: width:max-content under the clamp · divider → gap · verbs Top/Bottom); ② **"Framing"
  → "Focus"** everywhere visible (`9329d7a`, owner-ruled; sheet = "Set focus"; code keeps the
  mechanism word) — the shorter word lands all six on ONE line at 360px, the wrap stays as the
  font-scale safety net.
- **Every probe closed:** reticle · previews (**preview-honesty CLOSED AS-IS** — the viewport-true
  refinement candidate is NOT bought) · corner toggle · drag-vs-scroll · upload/q0.85 · PWA picker
  survival · Back-gesture · Fennec · the W10 thumb surfaces. **Closed by SOURCE RULING** (the
  owner: fleet pictures come from downloads/drawn art, not the camera): HEIC N/A · no 48 MP timing
  datapoint · EXIF phone-half (desktop half + e2e = the proof of record). **Deferred to ordinary
  live use** (owner ruling): autoscroll on a long grid · the >15 MB 413 refusal · the explicit
  multi-window cast walk. Full record = MEDIA_MANAGER_PLAN §12's S6 block; §16 stamped.
- **Local `main` = origin `2473e09` + 3 commits** (the two fixes + the docs commit carrying this
  block). Prod untouched (v1.7.6 @ `6a2ccaa`). Dev units RUNNING; the `:8443` serve is live —
  **teardown owed post-release** (`tailscale serve --https=8443 off` + stop the dev units).

## ▶▶ NEXT (2026-08-27, post-S6 — supersedes the list below)

1. **THE RELEASE** (the owner's word starts it): push the 3 commits → runbook
   `deploy/linux/README.md` §Release, **Opus-operated** — version **1.7.x** (1.8 stays RESERVED) ·
   the batch carries **config_version 1→2** (config-pure, proven on dev; NO DB migration) · **the
   LOCAL e2e run before the tag is MANDATORY** (the stale-pin class burned three tags — and this
   session renamed pill/sheet labels, exactly that class's trigger) · **rollback = v1.7.6**. Then
   the rig teardown (above) and the owner's first prod ride.
2. **Recorded follow-ups (not owed now):** the live-use deferrals above · W10's residuals
   (re-crop generation loss · the 412-on-lost-response class · bundled re-art inherits a stored
   point · delivery-never-throws) · Emma's lane-stall MED → Phase 19 · after the phase, the
   2026-08-22 menu (Phase 19 court · A13 talk · parked ledger).

## Prior state (2026-08-26, THIRD session — the owner's post-sign-off round → **W10, review-CLOSED**; superseded above where it speaks)

- **The owner signed off W7–W9 ("the fixes are fine") and asked for a SECOND PASS in the same
  breath:** the modal ✕ rides low in its circle · no way to re-crop/re-frame AFTER upload (and no
  Framing button anywhere in Characters/Banner slides — their folders are empty, so the bundled
  exclusion bit at 100%) · the gallery body stacks redundant text · make the gallery image-forward
  like the W6 detail panel. Mid-design the owner added a directive: **edit is a standalone
  capability, not an upload appendage** — plus the standing least-future-debt bar ("research the
  approaches").
- **The design was researched, written and committed first** (`a5cb47e`, the plan's §12 **W10
  block**): the standalone `useImageJob` machine (admit→guard→crop→export, delivery INJECTED; upload
  = one tail, edit = the other) · the backend replace arm on **`X-Expected-Revision`** (NOT
  `If-Match` — the mount's GET already serves Starlette's ETag, a different validator; 412 never 409,
  which is the create path's suffix-walk trigger) · **framing on bundled entries** via the item-mode
  seam (an owner point wins CENTRED; absent one the shipped proportional string passes through
  byte-identical) · dims as ASSET-RECORD data on the roster (R57's unanimous field convention),
  pinned by an honesty test over the real files · the ruled layout (grid leads · one header status
  line · Add/folder/Restore at the bottom · redundancies deleted).
- **Opus-built as `b2d40a5`…`d6a08fc`** + main-seat audit riders `b951827`. Two REAL catches en
  route: the Restore-defaults e2e was still pinned to the pre-W8 mechanism (a fourth stale-pin burn
  waiting for the next release tag), and the art.ts recipe's recorded dims were WRONG for two files
  (lyra 535×740 · rook 640×740 — the new honesty test caught it on day one). A live 390px screenshot
  round on dev went to the owner: ✕ dead-centred (all five `.pm` modals — it was a text glyph
  centring its line box, now a drawn SVG in the new shared `components/icons.tsx`) · the layout as
  ruled · Framing offered on a bundled default · the Edit pencil floating top-right on owner files.
- **Emma-lane blind round: SHIP WITH FIXES — 4 MED, zero HIGH**, load-bearing areas explicitly
  cleared (replace arm · bundled framing incl. the seat path · the edit byte chain; open sweep
  "none"). All four accepted + fixed (`dcec78c`): the `JobFailure.abandon` hook (a dismissed-or-
  replaced failure releases the upload's pending Blob; its own retry never does) · the edit's own
  `replace` phase + copy · rotation scope drops the folder line, empty non-upload sections stop
  promising an absent Add row · the failure row is `role=alert`. **Confirm round: all four RESOLVED
  with line-proof, new defects "none".** Full record = plan §12's W10 as-built block.
- **Gate green at tip (BE 2,002 · FE 2,619/157 · e2e media specs green). PUSHED on the owner's word
  2026-08-26 — origin = local `main` (the whole Phase 21 build, W1–W10, in one push).** Prod
  untouched (v1.7.6 @ `6a2ccaa`). Dev units RUNNING — the dev backend was restarted onto the replace
  arm; :5173 serves everything.
- **The owner's W10 eyeball RAN (desktop, same day): framing works as intended, the ✕ and the
  image-forward UI look good, "everything works as intended".** One nuance, recorded not built: the
  framing sheet's banner preview reads slightly taller than the real slide — the recorded at-390px
  approximation (previews are EXAMPLES by council M4/R57 §4③ and captioned so; `.gc-banner` is a
  fixed 232px, so a wider viewport makes the real slide shorter than 390/232). Owner weighed it
  minor at preview size; the datapoint + the viewport-true refinement candidate are attached to
  §16's preview-honesty probe — **rule it on the phone in S6, not before**.
- **The owner's PHONE follow-up landed the framing-sheet polish (`f3ef4a8`, main-seat built +
  visually verified at 390px AND 1280px):** the action row was the app's one stretched full-width
  trio — now the `pm-actions` house shape (compact, trailing, primary last) with the short verbs
  **Cancel · Clear · Save**; the preview row spreads across the full width (even flex split capped
  at 120px, `space-evenly` once the cap binds) instead of three 76px boxes snapped left in the
  640px modal. Unit + e2e framing pins renamed with `exact: true`.

## ▶▶ NEXT (2026-08-26, post-W10-close — a NEW session; supersedes the list below)

1. **S6 proper — THE one slice left** (plan §16 + the W6 note): the phone-in-hand device round over
   Tailscale HTTPS, now also covering the W10 surfaces on a real thumb (the 36px Edit/back pills
   one-handed · the bottom Add row's reach · framing a default on the phone · §16's preview-honesty
   probe now carrying the owner's first datapoint); then **release** (1.7.x · runbook §Release
   Opus-operated · config_version 1→2 rides it · LOCAL e2e before the tag · rollback v1.7.6).
2. **Recorded follow-ups (not owed now):** everything the previous block lists, plus W10's own
   residuals (re-crop generation loss · the 412-on-lost-response class · bundled re-art inherits a
   stored point · the delivery-never-throws contract).

## Prior state (2026-08-26, SECOND session — the owner re-poke → W7–W9 + the WHOLE-FEATURE COUNCIL; superseded above where it speaks)

- **The owner's re-poke found three gallery bugs with ONE root:** `toggleHidden` on a bundled row
  LISTED it to carry `hidden` — a listed entry collates first (untick jumped the image to the top)
  and survived re-tick as a bare `{bundled}` sole own-tier member (the whole deal collapsed to one
  picture on every host). Owner rulings in prose (D66 amended): **untick switches an image off IN
  PLACE — membership never moves a picture** (an order intent stating the order unchanged, sweep, in
  `caps.reorder` sections; minimal write + the bare-entry guard elsewhere) · **one accent ring =
  ACTIVE only** (the inset+halo stack deleted) · **24px tick** (~34px target). **W7 built**
  (`65c715b`/`bfeb710`/`48ec972`), visually verified (390px screenshot rounds delivered) plus a
  **claim-vs-paint LIVE PROOF**: the fleet's painted set tracked the gallery's ringed set through an
  untick, and every §2.4 resolver PAIR was statically verified to share one ladder.
- **R60 bought + committed** (`30ae379`, main-seat-verified against Picard upstream): order-as-
  priority is the config-first MAINSTREAM (R59's "no precedent" was scoped to wallpaper pickers;
  Picard ships our exact ordered-list-with-in-place-enabled storage); our order+membership
  composition OVER IMAGES is novel; both order-over-images products (Shopify/Etsy) bought back a
  phone "choose" verb; marking the live winner in the ranking list = ahead of the field (0/4).
- **THE WHOLE-FEATURE COUNCIL RAN (owner ask: "audit the whole feature… maybe we don't have the
  best approach")** — Emma blind lane (4 MED · open sweep "none" · backend/write core + W7 tier work
  declared sound) + an adversarial design lens (F1–F7, SHIP WITH CHANGES; the MODEL itself endorsed:
  a flat list would LOSE upload-replaces-defaults, the seams are in the right places). **W8 = the 8
  accepted fixes** (7 commits `8a8567e`…`2fcd9e4`): missing-role refusal guard (was a `files: []`
  config-wipe hole) · the app-wide media write LANE (out-of-order echo adoption) · drag admission
  `&& !busy` · unusable rows out of DEALT active ids · gacha pools → `usableLadderRows` (blank-vs-
  fallback drift) · family cards + key galleries resolve through `activeForKey` (+ key galleries
  now RING the bound file — builder-found hole, main-seat accepted) · the modal's derived
  mode sentence · the dead `seat` flag deleted. **Rejected + recorded:** the `promote`
  discriminator (a key-scope untick would sweep the named role) · frontier fallback-id exposure.
- **Owner rulings (live, prose):** ① **Restore defaults = "the defaults are the selection"** —
  bundled entries to the TOP in registry order, in use; the owner's files stay, switched OFF in
  place (`79fc184`, scope-corrected in the tail; supersedes the S6 drop-to-fallback mechanism) ·
  ② **TYPED PINS adopted** ("make sure it's the least-debt option") · ③ the dealt-section ring
  means **"in the deal"** — CLOSED as-is · ④ a STANDING DIRECTIVE minted: the least-future-debt
  check on every design choice (memory `least-future-debt-check`).
- **W9 = typed pins** (7 commits `7c712d4`…`898ad73`): a `slots` pin persists the config's own
  **`{name}|{bundled}` identity union** (union-object over a prefixed string — the extend-not-
  migrate directive decided it); backend `MediaPin` + the registry's `slots` upgraded to
  `dict[str, MediaSlot(source=…)]`; the UNRELEASED fold step **types-or-drops** legacy bare-name
  pins (the purity contract forced DROP for file-named ones, surfaced via `consumes`/
  `legacy_keys`); seats resolve by IDENTITY everywhere (`RosterEntry.id`); **the whole name-
  collision apparatus DELETED** (the ambiguity is unrepresentable now, not detected); the
  `duplicate` badge scoped to roles that BIND BY NAME; QUALITY's eslint accounting re-measured
  honestly (78; growth predates W9).
- **CONFIRM ROUNDS closed:** Emma **"RESOLVED WITH NEW FINDINGS"** — all closed in the tail
  (`898ad73`: scoped restore keeps its scope — BOTH lenses converged on it verbatim — + the
  restore gate asks the SCOPE + the F5 husk) **except her MED lane-stall** (a hung settings PUT
  holds the app-wide lane; pre-W8 it held one namespace's queue) — RULED RECORDED-NOT-FIXED →
  **Phase 19's reliability packet** owns it via the kit-wide request-timeout gap `useSettings.ts`
  already records twice (one idiom, one home). Design lens: **F1–F7 all CONFIRMED-RESOLVED, the
  F6 overrule CONCEDED** (the minimal write lists the disk tier ahead of a touched bundled row —
  no key-grid jump exists), "SHIP once NC1/NC2 land" — they landed.
- **Gate green per commit; tip BE 1,996 · FE 2,584; e2e media specs re-run green.** **79 commits
  UNPUSHED** (origin `fef36aa`). Prod untouched (v1.7.6 @ `6a2ccaa`). Dev units RUNNING — :5173
  serves everything through the tail. Full records: MEDIA_MANAGER_PLAN §12 W7/W8/W9 blocks.

## ▶▶ NEXT (2026-08-26, post-council — a clean session; supersedes the list below)

1. **Owner eyeball on dev (:5173)** — the W7–W9 surfaces: untick dims IN PLACE (no jump, deal
   re-forms correctly) · the single active ring + 24px tick · **Restore defaults on a section
   holding their own uploads** (the NEW verb: defaults take over on top, uploads stay switched
   off) · per-key galleries now ring the bound file · the modal's one-line mode sentences ·
   **re-pin any seat**: a pre-W9 pin naming a FILE was dropped by the typed migration (one
   "Use here" re-tap rebinds; bundled-named pins were typed automatically). Their dev config's
   collapsed state from the original bug self-heals with one untick+re-tick of that image (or
   Restore defaults).
2. **The PUSH ruling** (owner's word) — **79 commits with the handoff commit carrying this block**, origin `fef36aa`.
3. **S6 proper** — unchanged, THE one slice left (plan §16 probe list + the W6 note); then
   **release** (1.7.x · runbook §Release Opus-operated · config_version 1→2 rides it, now incl.
   typed pins · LOCAL e2e before the tag · rollback v1.7.6).
4. **Recorded follow-ups (not owed now):** Emma's lane-stall → Phase 19 · `classifyNamed`/
   `NamedBinding` freshly orphaned (test-only consumers) — lean-pass candidate, ruled kept at
   session close · the design lens's declared-tier/mode shared-resolver idea (plan §12 W8) ·
   QUALITY §warning-accounting refreshed, F13 still trigger-gated.

## Prior state (2026-08-26, FIRST session — THE S6 OWNER-ROUND FIX WAVE: W1–W4 BUILT + review-CLOSED; superseded above where it speaks)

- **The owner's round landed and drove the wave.** Their three findings — drag doesn't reorder ·
  gacha's first banner + oracle missing from the library · cosmos service banners missing — were
  triaged to TWO causes and ONE omission: the §2.3 ③ tier rule made all-defaults sections
  non-arrangeable (down-drags clamped to a no-op, up-drags mis-landed) AND silently shrank the deal
  on any partial listing; and three classes of shipped default art had no library identity. The
  owner ruled in prose (recorded in MEDIA_MANAGER_PLAN §2.3/§6.6/§12): reorders sweep the whole
  section's order · every shipped picture is a first-class entry, "none left behind" · the hero and
  fleet-backdrop defaults show in BOTH seats, independently overridable · cosmos's 12 banners = a
  dealt "Built-in rotation" · a per-section Restore defaults.
- **The wave: 5 commits, `bee042e`…`533de17`** (Opus-built W1–W4 from a pinned brief + the
  main-seat audit fix). W1 sweep-on-order (+ `lastExpressible` and the drag clamp DELETED) · W2
  bundled ids for gacha `oracle`, frontier `hero`, and `rook` (a found orphan; cast tail, deal
  unchanged ≤5 hosts) — both ladders' hard-coded last rungs now honor the In-use switch · W3
  `MediaSlotDef.builtin` (display-only) + `MediaRotationDef` + CosmosHostDetail dealing from the
  library + a latent click-guard unmount crash fixed · W4 `restoreDefaults`/`defaultsRestorable`.
  **Review-CLOSED:** main-seat audit → Emma-lane blind round **"RESOLVED — READY", zero new
  findings** → `533de17` (refusal arms don't sweep) → confirm RESOLVED. Full gate green per commit;
  full e2e 305 green; FE units 2,518 → **2,544+1**. The plan's §12 wave block = the whole record,
  incl. the recorded-not-fixed 50 ms click-guard race and the flagged sweep consequence (first
  reorder in a MIXED section promotes defaults into the deal — the owner should eyeball that once).
- **W5 RODE THE SAME DAY (owner prose ruling in-session, 2026-08-26): the gacha HERO SEAT IS
  DEAD.** The owner ruled the hero slide was never a separate thing from the banner — so the
  carousel's first slide now DEALS the banner pool's first member (frozen PICKUP copy kept),
  `banner.webp` is that pool's FIRST bundled entry (banner · b2 · b3 — orderable, retirable; the
  owner clarified "differ" meant the MECHANISM, so the shipped look keeps one picture on both
  surfaces and the fence is byte-identical to pre-W5), an
  empty pool falls back to the backdrop image ("slide one stays the backdrop image"), and the
  backdrop is DECOUPLED (a kit background no longer moves the carousel; §5.3's coupling reversed —
  D54 amended). One build commit `15b769f` (Opus from a pinned brief) + the docs commit. FIXED IN
  PASSING: scene slides dropped their focal points entirely. Review: main-seat audit clean →
  Emma-lane blind round **SHIP, ZERO findings**. Gate green (BE 1,991 · FE 2,552). Full record =
  MEDIA_MANAGER_PLAN §12 W5. Dev backend restarted onto the new registry; :5173 serves it.
- **W6 FOLLOWED THE SAME AFTERNOON (owner feel-talk rulings, prose; D66 = the D-entry): ORDER IS
  THE ONLY PRIORITY SYSTEM, APP-WIDE + the gallery redesign.** The owner: "we don't need two
  systems to do one thing" · one-tap activation on the tile · the ◆ marker → "Default" · "icons
  on top of the image" for the detail · the section CARDS' titles/hints confusing. Built as two
  Opus commits from a pinned brief (`bf0dc41` the sweep · `a5b7816` the redesign + BOTH copy
  passes): every POOL pin deleted (gacha `reel_figure` · frontier `hero` · kit
  `background`/`brand`; no config ever held one — verified), `MediaCaps.activate` → `promote`
  (move-to-top for scoped key/family sections), the two gacha character SEATS = the sole
  survivors ("Use here"; the oracle seat relabelled **"Operator character"**); the tile corner ✓
  = a real In-use toggle (sibling button, aria-pressed, drag-proof), ◆ → a **"Default"** chip,
  winner keeps the accent outline; ItemDetail rebuilt IMAGE-FORWARD with the floating action pill
  ([To top · Up · Down · To bottom | Framing | Delete] — To top IS activation); **every section
  card got an owner-facing label** (`MediaRoleDef.label`: Characters · Banner slides · Transition
  figure · Operator backdrop · Rig cards · Map cover · Comms stack · Service icons · Machine
  pictures · Background · **Logo**, was "App icon") with the role folder as a mono subtitle; the
  one-word-one-meaning copy system (In use = membership · Active = painted · Default = ships;
  `used for "X"`; consequences on advisories). Main-seat audit ACCEPTED the builder's two
  judgment calls (promote; seats refuse-not-repair) + a live 390px screenshot round on dev
  verified the two unverified layout spots. **Review: three rounds to an explicit RESOLVED** —
  blind SHIP WITH FIXES (2 MED: pin resolution vs presence · captured-state double-tap) → fixed
  `4eaaea4` (send-time name resolution; `toggleHidden` composes) → confirm chained 1 MED and the
  main seat OVERRULED her prescription with the PAINT rule (`activeSeat` was the liar; aligned
  `74872ed`) → her check CONFIRMED the overrule + chained `activeOraclePool` (override honoured
  on pin PRESENCE) → closed `b241d33` (override = a CLAIM the wiring honours only when the seat
  resolves) → **final RESOLVED, zero new**. Gate green per commit (tip BE 1,990 · FE 2,559; the
  whole e2e 305 re-run green at the build). Doc truth riders: lucide-react is NOT a dep
  (CLAUDE/AGENTS corrected) · the prototypes are TRACKED (`ac0a07d`, owner reversal) · Phase 19
  §7b now carries the owner-requested WHOLE-SYSTEM design verdict on the media manager
  (`6f5fe52`). Full record = MEDIA_MANAGER_PLAN §12 W6.
- **Origin unchanged (`fef36aa`) — 60 commits unpushed with the docs commit carrying this block**
  (the 53 through the W5 close + W6's `bf0dc41`/`a5b7816` + `6f5fe52` + the three review-fix
  commits + this one). Prod untouched (v1.7.6 @ `6a2ccaa`).
  Dev units RUNNING; the dev backend was restarted onto the W6 registry (FE rides Vite HMR); the
  owner's dev config/media untouched by the waves.

## ▶▶ PRIOR (2026-08-26, post-W6): the owner re-poke — ✅ RAN same day (the SECOND-session block above is the record; superseded)

1. **Owner re-poke on dev (:5173)** — everything below is live there now:
   - **The W1–W4 wave**: drag lands where dropped (all-defaults sections, both directions) · gacha
     library shows oracle + rook · cosmos "Built-in rotation" · Restore defaults · the flagged
     consequence: first reorder in a MIXED section promotes defaults into the deal.
   - **W5**: the carousel opens on the banner pool's FIRST image wearing the PICKUP copy
     (`banner.webp` on defaults — the shipped look unchanged); `banner.webp` is an ordinary Pickup
     banner entry; hiding all banner images leaves slide 1 on the backdrop image; a kit background
     moves ONLY the backdrop.
   - **W6 (the owner's own feel-talk, built)**: section cards wear the new names + folder
     subtitles ("Operator character" vs "Operator backdrop"; "Logo") · the tile corner ✓ is the
     one-tap In-use toggle, the "Default" chip marks shipped art, the accent outline marks the
     ACTIVE winner · tapping an image opens the image-forward detail with the floating pill —
     "To top" is how you make something the active one, there is NO "Set as active" anywhere ·
     the kit Background/Logo and gacha Transition-figure galleries have no pin: top image wins.
     (The set-active-feels-confusing note of 2026-08-25 is thereby CLOSED — W6 was that talk.)
2. **The PUSH ruling** (owner's word) — 60 commits, origin `fef36aa`.
3. **S6 proper — THE ONE REMAINING SLICE of Phase 21** (plan **§16** = the probe list; the owner's
   words 2026-08-26: "we still have one slice left to do, the eyeball and everything"): the
   phone-in-hand device round over Tailscale HTTPS — EXIF portrait on the phone's own photo · the
   48 MP double-decode timing · HEIC refusal copy · 413-mid-body · PWA-standalone picker survival ·
   q0.85 eyeball · crop/framing/drag FEEL (long-press · drag-vs-scroll · one-handed autoscroll ·
   reticle · preview honesty · per-window framing on the real cast) · Fennec expected-partials ·
   Back-gesture close — PLUS the W6 surfaces on a real thumb (the corner toggle's 28px target
   beside the long-press drag · the pill's reach one-handed · the new section names reading right).
   Tick off whatever the owner's ad-hoc rounds already proved.
4. **Release** once S6 satisfies — 1.7.x (1.8 stays RESERVED) · runbook §Release, Opus-operated ·
   the batch carries config_version 1→2 (config-pure, proven on dev), NO DB migration · rollback =
   v1.7.6 · the LOCAL e2e run before the tag is MANDATORY (the stale-pin class burned three tags).
5. **After the phase**: the 2026-08-22 menu below still governs (Phase 19 court — §7b now carries
   the owner-requested whole-system media-manager design verdict — · the A13 talk · the parked
   ledger).

## Prior state (2026-08-25 — THE MEDIA-MANAGER BUILD SESSION: S0→S5 ALL BUILT + REVIEW-CLOSED; superseded above where it speaks)

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

## ▶▶ PRIOR (session-close 2026-08-25): the owner round — ✅ RAN, triaged + fix-waved (the 2026-08-26 block above is the record; superseded)

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

## ▶▶ NEXT: START THE BUILD — MEDIA_MANAGER_PLAN §12, S0 first (a clean session; owner-ruled) — ✅ DISCHARGED: the ladder ran and **Phase 21 shipped as v1.7.7** (2026-08-27). Kept as the build's launch record.

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
they'll ask) · color-theory palette session · ~~gacha originals stay untracked~~ **REVERSED
2026-08-26: the four alt-fleet prototype folders are TRACKED now** (owner: "track the prototypes
too so we don't have to handle that anymore") · ISS-10 ② glyph
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

## ▶▶ NEXT (2026-08-21, third session, FINAL — the release-decision handoff; supersedes both lists below where struck)

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
  - **W3** — media `revision` → `mtime:size:ino:ctime` (the `_stamp` recipe; closes R21 ①). *(⚠ In
    this block and the ones below it, **`R19`/`R20`/`R21` are owner/Codex REVIEW-ROUND finding ids,
    not `docs/research/` dossiers** — the two numbering spaces collide; dossier ids are always a
    link into `docs/research/`. Convention: `docs/research/README.md`.)* Also in W3:
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

## Prior ▶▶ (2026-08-20) — ~~the RELEASE DECISION~~ ✅ RELEASED v1.7.4 2026-08-20; superseded where the 2026-08-21 blocks above say so (F1 ✅ built · C3 ✅ designed+S1 · A13 unblocked)

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
