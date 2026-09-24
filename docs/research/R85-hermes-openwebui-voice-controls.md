# R85 — Hermes agent + open-webui at source: speech detection, calibration, and what the user controls mid-call

**Date:** 2026-09-24
**Status:** Dossier, complete for the bounded question. Evidence only, not a decision.
**What drove it:** the S4 car round (Phase 24, D71/D74). On the car's Bluetooth HFP mic, ordinary
speech falls under the absolute `barge_threshold = 0.06` linear-RMS floor and the quiet-final gate
drops it ("had to shout"). At home, noise that clears Silero 0.9 plus 200 ms above 0.06 still makes
short false turns. The owner wants **as few in-call dials as possible**, meaning only the ones that
matter for phone-in-the-car vs phone-at-home. They also say Hermes agent "has a good live call
interaction". This pass reads Hermes (every voice surface) and open-webui's call mode at source.
**Drove:** (open). This is input to the S4 dial design, alongside R82 (the single dial), R83 (a
portable floor) and R84 (Silero calibration).

**Reference class.** Hermes agent and open-webui, both in the README reference class. Discord's
client appears only as the thing Hermes delegates to. R76 §4.4 already dissected open-webui's call
VAD and is **cited, not re-derived**. This pass goes deeper only on user controls, calibration and
presentation.

**Markers:** **[V]** = read at the pinned source or official doc. **[R]** = a secondary source or a
tracker report. **[U]** = expected, not checked.

---

> ### Headline
>
> **① Nobody here gives the user a runtime sensitivity dial.** [V] Hermes has zero in-session
> sensitivity controls on any surface. Its knobs are YAML (`voice.silence_threshold`,
> `silence_duration`, `barge_in_threshold_multiplier`, `barge_in_grace_seconds`). open-webui has
> zero at all. Its in-call controls are **Mute (button + `M`)**, **tap to interrupt**, and **End
> call**. A sensitivity request (#14500, 2025-05-29) was closed the same day without one.
>
> **② Hermes' best-liked path (Discord voice) runs no VAD of its own.** [V] Speech detection there
> is *Discord's client*. Only transmitted packets arrive, and an utterance ends after **1.5 s with no
> packets**, once there is **≥ 0.5 s** of audio. So the one sensitivity dial the owner has used with
> Hermes is **Discord's Input Sensitivity slider**, which is drawn over a live level meter and has an
> "automatically determine" toggle [R].
>
> **③ Hermes' only calibration is floor-relative, and it only drives barge-in.** [V] Turn-taking uses
> an **absolute** int16 RMS of 200 (−44 dBFS). That value failed on a MacBook Air mic that reads
> ≈160 at normal speaking volume (#84046, still open at the pin). Barge-in **measures the quiet room
> first**: p90 of 450 ms of RMS × **3.0**, clamped to [400, 4000] int16, raised to ≥ 1500 while TTS
> plays. That is the portable idea.
>
> **④ ctrl-b's floor merges two jobs that Hermes keeps separate.** 0.06 linear (−24 dBFS) sits
> *above* Hermes' **playback-phase** minimum trigger (1500 int16 = 0.046, −27 dBFS) and **20 dB
> above** its turn-taking floor. ctrl-b now uses a bleed-proof barge number as its quiet-final floor.
>
> **⑤ Hermes feels good because of audio cues and interjection handling, not VAD accuracy.** [V]
> Record beeps (880 Hz / 2×660 Hz), a "thinking" blip loop, and on Discord a spoken ack before the
> first tool call ("One moment.") over a ducked ambient bed. Also: interject during generation or
> playback, a stop word, and the model is told it was cut off.

---

## 0. Sources, pinned

| Source | Ref | Read |
|---|---|---|
| Hermes agent (NousResearch/hermes-agent), local checkout, read-only | `cc23b725a3` (2026-09-15) | 2026-09-24 |
| open-webui/open-webui | `8bd8b4fac5e0`, `package.json` **0.11.4** (2026-09-21), the same SHA as R79 | 2026-09-24 |
| Discord developer docs, voice connections | docs.discord.com, live 2026-09-24 | 2026-09-24 |
| Trackers: hermes #75780, #84046, #93583; open-webui #2995, #3450, #7509, #14500, #28680, D#28391, D#9647 | GitHub API, 2026-09-24 | 2026-09-24 |

## 1. The numbers, on one scale

Conversions. Hermes int16 RMS ÷ 32768 gives linear RMS. The Hermes desktop "level" is
byte-domain RMS ÷ 42, so linear = level × 42/128. open-webui's `rmsLevel` is already (x−128)/128,
which is the same scale as ctrl-b's worklet RMS. dBFS = 20·log10(linear).

| Where | Quantity | Native value | Linear RMS | dBFS | Marker |
|---|---|---|---|---|---|
| Hermes CLI/TUI | speech vs silence (`voice.silence_threshold`) | 200 int16 | 0.0061 | −44.3 | [V] |
| Hermes CLI/TUI | "too quiet" discard in `stop()` (hard-coded constant, **ignores config**) | peak < 200 | 0.0061 | −44.3 | [V] |
| hermes #84046 | MacBook Air built-in mic, "normal speaking volume" | ≈160 (user set 80) | 0.0049 | −46.2 | [R] |
| Hermes barge | quiet-room floor, typical (code comment) | 50–300 | 0.0015–0.009 | −56…−41 | [V] |
| Hermes barge | trigger = max(floor×3.0, 400) while generating | ≥400 | ≥0.012 | ≥−38.3 | [V] |
| Hermes barge | minimum trigger while TTS plays | 1500 | 0.046 | −26.8 | [V] |
| Hermes barge | trigger ceiling, "speech always reachable" | 4000 | 0.122 | −18.3 | [V] |
| Hermes (comment) | speaker bleed / direct speech | ~1000–1400 / 3000–8000 | 0.03–0.04 / 0.09–0.24 | −30…−27 / −21…−12 | [V] |
| Hermes desktop (Electron) | `silenceLevel` (speech floor) | 0.075 | 0.0246 | −32.2 | [V] |
| Hermes desktop barge | min / playback-min / ceiling; mult 3.5 | 0.075 / 0.14 / 0.37 | 0.025 / 0.046 / 0.121 | −32 / −27 / −18 | [V] |
| open-webui call | "sound" = any FFT bin above `minDecibels` | −55 dB per bin | — | — | [V] (R76) |
| open-webui call | visualiser bands only (`rmsLevel*100 > 1/2/4`) | 0.01/0.02/0.04 | same | −40/−34/−28 | [V] |
| **ctrl-b** | `barge_threshold` = quiet-final floor | 0.06 | 0.06 | **−24.4** | context |

| Timing | Hermes CLI/TUI | Hermes desktop | Hermes Discord | open-webui call |
|---|---|---|---|---|
| speech confirm | 0.3 s above threshold, dips < 0.3 s tolerated | first frame ≥ level | ≥ 0.5 s buffered | first frame with any bin > −55 dB |
| end of utterance | **3.0 s** silence (`silence_duration`) | **1.25 s** | **1.5 s** with no packets | **2.0 s** |
| no-speech give-up | 15 s; 3 silent cycles end continuous mode | 12 s idle; 60 s turn cap | — | none |
| max recording | 120 s (`max_recording_seconds`) | 30 s (barge capture) | none | none (#18621: iOS cuts at 10–16 s) |
| barge sustain | ≥ 80 % of the last 300 ms, grace 0.5 s after TTS onset | same | none | none (first sound) |

## 2. Hermes, per surface

### 2.1 CLI + TUI recorder (`tools/voice_mode.py` `AudioRecorder`) [V]

- **Detection:** energy only. `_rms` = `sqrt(mean(x²))` over int16 blocks, compared against
  `SILENCE_RMS_THRESHOLD = 200  # RMS below this = silence (int16 range 0-32767)`. There is no Silero
  in capture. Silero appears only *inside* local faster-whisper at transcription time
  (`stt.local.vad: True`, `vad_min_silence_ms: 500`).
- **Endpointing:** a two-stage state machine. Speech is "confirmed" after
  `_min_speech_duration = 0.3` s above threshold, with `_max_dip_tolerance = 0.3` s. After that,
  *"only SUSTAINED resumed speech resets the silence timer"*, so a cough in a pause does not extend
  the turn. Stop after `silence_duration` (3.0 s), or `_max_wait = 15.0` s with no speech, or the
  hard cap.
- **"Still thinking":** handled only by the long 3 s silence. The guide says: *"If you pause a lot
  between sentences, increase: `silence_duration: 4.0`"*.
- **Noise rejection:** `stop()` discards recordings shorter than 0.3 s and those whose **peak** RMS
  is below the hard-coded 200: *"Peak RMS, not the average (which trailing silence dilutes)."* The
  transcript then passes a Whisper phrase denylist plus a repeat-regex (`is_whisper_hallucination`),
  exempting configured stop phrases.
- **Config reach:** `silence_threshold` and `silence_duration` are re-read from YAML at *every*
  recording start (`_voice_start_recording`, TUI `voice.record`). Editing the file mid-session
  therefore takes effect on the next utterance. No UI does this.
- **Hermes' own portability bug:** `stop()` still compares against the constant, not the configured
  value. #84046 (2026-08-11, open) shows the result: a user lowered the threshold to 80 because
  *"the built-in mic reports RMS ~160 at normal speaking volume, below the default threshold of
  200"*, and every later turn was still discarded as "No speech detected". This is **the same
  failure class as the ctrl-b car symptom**: an absolute floor tuned on one mic.

### 2.2 The full-duplex barge detector: Hermes' only calibration [V]

`full_duplex_listen` / `_BargeDetector` (CLI, TUI; mirrored in the desktop's
`lib/voice-barge-in.ts`) arms at utterance submit and runs until the reply has finished playing:

> *"calibrates against the QUIET room at turn start, holds that baseline through playback (never
> speaker bleed), trips on a windowed majority of blocks"*

- The floor is the p90 of the first `calibration_ms = 450` of RMS (30 ms blocks), floored at 200.
  It keeps tracking drift **only while nothing plays and the block is below trigger**, over a
  ≈ 3 s window (`deque(maxlen=100)`).
- The trigger is `max(floor × mult, 1500 if playing else 400)`, then `min(…, 4000)`. The code's
  reason for the ceiling: *"a noisy room must never push the trigger past normal speech"*.
- A trip needs ≥ 80 % of the last 300 ms above trigger. Grace is 0.5 s after playback onset, and
  only if playback resumed after a real gap of ≥ 1 s. Pre-roll is 1.2 s, endpoint is 1.25 s of RMS
  < 200, and the cap is 30 s.
- The tuning history is in the comments. An earlier rolling-floor-during-playback design was
  replaced because a floor calibrated on bleed made the trigger unreachable. #75780 (2026-08-01)
  showed a TTS→mic→STT loop on MacBook speakers. The fix added a **text** echo guard: a
  playback-phase transcript whose `SequenceMatcher` ratio against the last spoken text is ≥ 0.6 is
  dropped as *"Ignored likely TTS echo (not queued)"*. It is fail-closed, and skipped for fragments
  shorter than 10 characters so a genuine "yes" survives.
- User reach: YAML only (`barge_in`, `barge_in_threshold_multiplier`, `barge_in_grace_seconds`),
  plus `HERMES_VOICE_DEBUG=1` to stream per-block floor/RMS/trigger to stderr *"for live tuning"*.

### 2.3 Desktop (Electron, a browser mic, the closest analogue to a PWA) [V]

`getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}})` is called with AGC left
at the browser default. An `AnalyserNode` with fftSize 256 runs at rAF cadence. The constants are
hard-coded (`silenceLevel: 0.075, silenceMs: 1_250, idleSilenceMs: 12_000`), under the comment
*"VAD tuning mirrors `tools.voice_mode` defaults so the browser loop matches the CLI"*. **That
comment is wrong:** 0.075 is −32 dBFS against the CLI's −44 dBFS, and 1.25 s against 3.0 s. The
project re-tuned by hand per capture chain. A turn is discarded unless `heardSpeech` (a single frame
at or above the level) was set. The Settings page exposes only `voice.record_key`,
`voice.max_recording_seconds` and `voice.client_direct`. No threshold is exposed; desktop ignores
`silence_threshold` entirely.

### 2.4 Discord voice (`plugins/platforms/discord/adapter.py` `VoiceReceiver`) [V]

```
SILENCE_THRESHOLD = 1.5    # seconds of silence → end of utterance
MIN_SPEECH_DURATION = 0.5  # minimum seconds to process (skip noise)
```

"Silence" is **a gap in RTP packets**: `silence_duration = now - last_packet_time`, polled every
200 ms. No energy or probability is computed. Speaking/not-speaking is decided upstream by the
user's Discord client (voice activity or push-to-talk). The Discord docs require clients to *"send
five frames of silence (`0xF8, 0xFF, 0xFE`) before stopping"* [V, docs]. Detection, noise
suppression, AGC and echo cancellation are therefore **all the Discord client's, on the user's
device**.

- **Echo:** the bot's own SSRC is dropped (`if ssrc == bot_ssrc: return`). On the legacy playback
  path the receiver is **paused** during TTS (*"pause receiver while playing (echo prevention)"*),
  and packets arriving while paused are **discarded, not buffered**. That is half-duplex, with no
  barge-in. With `discord.voice_fx.enabled` (off by default) playback goes through a continuous
  mixer and the receiver is **not** paused. The docs' blanket claim that *"The bot automatically
  pauses its audio listener while playing TTS replies"* is therefore true only on the default path.
- **Post-STT guards:** the Whisper denylist, plus duplicate suppression, which drops a
  normalized transcript equal to (or ≥ 0.95-similar to, if ≥ 16 characters) one from the same user
  in the last 12 s.
- The docs' troubleshooting advice *"Adjust `silence_threshold` in config (higher = less
  sensitive)"* sits under the Discord section, but `silence_threshold` **is not read on the Discord
  path**.

## 3. open-webui call mode, beyond R76 §4.4 [V]

- **Capture:** `getUserMedia({audio: {echoCancellation: true, noiseSuppression: true,
  autoGainControl: true}})`. **AGC is forced on**, which R76 did not record.
- **Detection:** unchanged since R76. `domainData.some(v => v > 0)` at `MIN_DECIBELS = -55`, the
  first "sound" starts `MediaRecorder` and calls `stopAllAudio()`, and a 2000 ms quiet run ends the
  utterance. There is no sustain, no floor and no calibration. [U] A steady noise bed with any bin
  above −55 dB (for example road noise that NS does not remove) would never endpoint.
- **Deafening as the half-duplex mechanism:** when `muted`, or when `assistantSpeaking` and
  `voiceInterruption` is off, the analyser is set to `minDecibels = -1, maxDecibels = 0` and
  `rmsLevel = 0`. `assistantSpeaking` is set at **chat start**, so the mic is deaf through
  generation *and* playback. It reopens about 100 ms after the last clip.
- **Feedback:** the only level display is the emoji/orb size, stepping at `rmsLevel` 0.01/0.02/0.04.
  There is no numeric meter and no threshold marker. The status line reads **"Listening..." /
  "Thinking..." / "Tap to interrupt" / "Muted"**.
- **In-call controls:** a Mute toggle (tooltip *"Mute (M)"* / *"Unmute (M)"*). Muting mid-utterance
  aborts it (*"so it doesn't accidentally send a partial sentence"*), and mute **auto-releases**
  when the assistant finishes speaking (*"Auto unmute when AI finishes speaking"*). Tapping the orb
  or the status line while it speaks means `stopAllAudio()`. There is also Camera and End call.
- **Settings** (not in-call): Interface → *"Allow Voice Interruption in Call"*, described as *"Let
  speech interrupt the assistant during a voice call."* Default off. Audio → STT engine, language,
  *"Instant Auto-Send After Voice Transcription"*. Server: `WHISPER_VAD_FILTER` is env-only and
  defaults to `False`. Call mode uses the same `transcribeAudio` endpoint as dictation.

## 4. What the user controls at runtime: the inventory

| Product / surface | Mid-session controls | Sensitivity control | Feedback |
|---|---|---|---|
| Hermes CLI | record key (default `ctrl+b`): start, or stop and leave continuous mode · `/voice on\|off\|tts\|status` · say or type the bare stop word | **none** in-session; YAML re-read per recording | `● Recording... (auto-stops on silence \| Ctrl+B to stop & exit continuous)`, a one-character level glyph `" ▁▂▃▄▅▆▇"[min(rms,8000)*7//8000]`, "Silence detected, auto-stopping...", "No speech detected.", beeps |
| Hermes TUI | same keys and commands | none | `voice.status` = listening / transcribing / idle only, **no level** |
| Hermes desktop | Start / End voice conversation · Mute / Unmute microphone · "Stop listening and send" · playback **Stop** | none | "Listening" / "Transcribing" / "Thinking" / "Speaking", 5-bar mic level, playback waveform |
| Hermes Discord | `/voice join\|leave\|on\|off\|tts\|status` | **delegated to the Discord client**: Input Sensitivity slider + "Automatically determine input sensitivity" [R] | transcript echoed as `**[Voice]** <@user>: …`, spoken ack, ambient bed |
| open-webui call | Mute (+ `M`, auto-unmutes after the reply) · tap to interrupt · End call · camera | **none** (#14500 closed without one) | orb size in 3 steps, 4 status strings |

**The only thing any user is ever given for sensitivity is Discord's slider.** Per Discord's support
text [R]: *"If you want your sensitivity to be determined automatically, you can enable Automatically
determine input sensitivity"*. It may misbehave *"if there is significant background noise"*. When
tuning by hand, keep *"the sensitivity marker high enough that nothing is transmitted when you're not
speaking"*. The marker sits on a live level bar. It is one dial with an auto default.

## 5. Bluetooth, car and phone reality

- **Hermes:** the voice docs never mention Bluetooth, headsets or cars (grep, [V]). The only
  gain-difference evidence is #84046 (MacBook Air ≈ 160 RMS) [R].
- **open-webui trackers** [R]:
  - #2995 (2024-06-10, *"enh: call voice input sensitivity"*): *"Only happens when i'm using it like
    a speaker phone. If I have my headphones in it works great."* It was resolved by the
    interruption toggle, not by a sensitivity control.
  - #3450 (2024-06-26) and #7509 (2024-12-01): the TTS loops back into the next turn on speakers.
    One reporter fixed it with PipeWire's echo-cancel module.
  - #14500 (2025-05-29): *"overly sensitive—any movement, breath, or minor noise, such as a sneeze,
    causes it to stop responding"*. The user asked for a mute, *"Adjust Sensitivity"*, or a
    "wait for a second noise" delay. Closed the same day.
  - #28680 (2026-08-17, open): browser EC/NS/AGC *"removes quiet initial syllables or entire speech
    fragments"* (Brave/Windows). The proposal is **one** *"Browser microphone processing"* switch,
    explicitly *not* for call mode, *"because echo cancellation is useful while assistant audio is
    playing"*. It also notes that turning AGC off *"can make the displayed waveform noticeably
    smaller"*.
  - D#28391 (2026-08-10): after a Bluetooth/USB mic disconnects, the call still shows "Listening..."
    and nothing is heard. Neither project re-acquires the input.
- **No source in either project** discusses the HFP narrowband mic, car AGC, or per-device threshold
  memory. That absence is the finding.

## 6. Why Hermes' interaction feels good: mechanisms, and whether they port

1. **Dead air is filled with sound.** [V] CLI: 880 Hz start beep, 660 Hz ×2 stop beep, and a
   thinking-blip loop (`thinking_sound`, volume = `beep_volume` 0.3). Discord: a one-time ack
   phrase at the first tool call (`ack_phrases`: "One moment.", "On it.", …) and an ambient bed
   (gain 0.18) ducked to 0.06 under speech with a 400 ms release, plus 200 ms lead silence so the
   first word is not clipped. **Ports fully:** all of it is client-side playback.
2. **You can talk at any time and it is understood.** [V] One listener per turn covers generation and
   playback. A trip cuts TTS, interrupts the run, and submits the captured utterance with 1.2 s
   pre-roll. *"The next message carries a short note telling the model its spoken reply was cut
   off."* **Ports:** the floor-relative trip runs in ctrl-b's worklet, and the note is server-side.
3. **Silence is patient.** [V] 3.0 s (CLI) or 1.5 s (Discord) endpointing, a 0.3 s dip tolerance,
   and silent cycles while the agent is busy or TTS is playing are *"held"* and not counted toward
   the 3-strike auto-end. **Ports partly:** endpointing is our server's `silence_ms`. The hold logic
   is client-side.
4. **Exact-match stop word, spoken or typed.** [V] *"Say "stop" to end the voice chat."* Strict
   whole-utterance match. **Ports.**
5. **You see what it heard.** [V] Discord echoes every transcript into the text channel. ctrl-b
   already shows the heard line.

None of the five is VAD accuracy. On Discord, VAD accuracy is outsourced to a product with a
tuned, user-facing dial.

## 7. Open sweep

- **(a) Hermes' wake word already ships "one dial over heterogeneous internals".** [V]
  `wake_word.sensitivity: 0.6  # 0.0-1.0 threshold, consistent across engines (higher = stricter)`.
  It maps to raw 0..1 for openWakeWord, to `0.05 + 0.4·s` for sherpa (0.5 lands on sherpa's
  recommended 0.25), and to `1.0 − s` for Porcupine, *"so "higher = stricter" holds for every
  engine"*. A separate `confirmation_frames: 3` holds the "N consecutive frames" rule. Two lessons:
  the mapping per internal is hand-fitted and commented with measured outcomes, and the name
  "sensitivity" with *higher = stricter* is a readability trap.
- **(b) Absolute levels do not survive a change of capture chain, even inside one project.** [V]
  Hermes' CLI (−44 dBFS, raw PortAudio, no AGC) and its desktop (−32 dBFS, browser EC+NS, default
  AGC) differ by 12 dB and claim to "mirror" each other. open-webui forces AGC on. #28680 shows the
  opposite failure. **AGC state is part of the calibration**, and ctrl-b leaves it at the browser
  default.
- **(c) A dead-or-quiet-input health signal.** [V] Hermes' wake listener flags *"mic delivers only
  silence"* after 10 s at peak ≤ 10 int16, and the TUI shows `⚠ mic delivers only silence`.
  open-webui D#28391 shows the cost of not having one. A car-route "input is N dB quieter than your
  home baseline" hint is the constructive version [U].

## 8. Implications for ctrl-b, ranked

**Control count (owner clarification).** The field gives **0** sensitivity dials: Hermes has 0 on
every surface, open-webui has 0. What users actually use mid-call is **Mute**, **interrupt** and
**end**. The one sensitivity dial anyone was ever given, Discord's, is a **single slider with an auto
default, drawn on a live meter**. Nothing in either tracker shows users needing a separate
end-of-utterance or min-speech dial mid-call. Hermes' only such request (#84046) is about the
**energy floor**. The evidence supports **one** mid-call sensitivity control, with the rest as
config.

**Inherit**

1. **Split the floor by phase, as Hermes does.** Use one low turn-taking/quiet-final floor, and a
   raised minimum only while the reply is playing (Hermes: 400 → 1500 int16, a ×3.75 ratio). 0.06
   is a playback-phase number (above Hermes' 0.046). Using it for finals in silence is what makes
   the car mic fall below it.
2. **Make the floor relative to a measured quiet baseline.** Take p90 of ~450 ms of quiet RMS,
   re-tracked only while nothing plays, × a multiplier, clamped to [abs-min, ceiling]. The ceiling
   keeps speech reachable in a loud car. The **multiplier** (Hermes 3.0, desktop 3.5) is the natural
   single dial: route and mic changes move the floor, and the dial stays meaningful.
3. **Present the dial the way Discord does.** Put a threshold marker on the live level meter, with
   an auto default. ctrl-b's debug readout already has the meter.
4. **Fill dead air and keep "you can always interject".** Earcons, a thinking cue, a short spoken
   ack before long tool work, and the cut-off note to the model.

**Avoid**

5. Any **absolute** level default presented as universal. Hermes #84046 is our car bug on a laptop.
6. **First-sound triggering** (open-webui). Keep a sustain or majority window.
7. **Silent discard with no reason shown** (Hermes "No speech detected" for a quiet mic). ctrl-b's
   "too quiet" note is right. Make it say by how much.
8. **Deaf-during-generation half-duplex** (open-webui, Hermes Discord legacy path). It explains the
   "had to wait" feel neither project's users praise.

## 9. What I could not determine

- Discord client internals: its VAD algorithm, the scale of the Input Sensitivity slider (dB range),
  and what "automatic" computes. The Discord support article returned 403, so the quotes above are
  from search-result excerpts of it [R].
- Whether the Discord voice path in Hermes routes a mid-reply utterance through
  `busy_input_mode: interrupt` (the default [V]) end to end. It was not traced.
- How Hermes' floor-relative barge behaves on **HFP narrowband** or car AGC. Its comments quote
  only laptop mic and speaker numbers.
- open-webui behaviour under steady road noise (the §3 [U] "never endpoints"). It was not run, per
  the brief.
- Whether AGC on or off helps a Chrome-on-Android HFP mic. Neither project measures it (see R83).

---

## Primary sources

- Hermes, at `cc23b725a3`: `tools/voice_mode.py` (`AudioRecorder`, `listen_for_speech`,
  `_BargeDetector`, `full_duplex_listen`) · `tools/voice_mode_transcript.py` ·
  `hermes_cli/cli_voice_mixin.py` · `hermes_cli/cli_tui_mixin.py:_audio_level_bar` ·
  `hermes_cli/voice.py` · `tui_gateway/methods_voice.py` · `hermes_cli/config_defaults.py`
  (`voice`, `stt`, `wake_word`) · `tools/wake_word.py`, `tools/wake_word_engines.py` ·
  `tools/transcription_audio.py` · `gateway/run_voice.py` · `gateway/run_turn_runner.py`
  (`voice_ack_callback`) · `plugins/platforms/discord/adapter.py` (`VoiceReceiver`,
  `play_in_voice_channel`, `_voice_listen_loop`), `voice_mixer.py` ·
  `apps/desktop/src/app/chat/composer/hooks/use-mic-recorder.ts`, `use-voice-conversation.ts`,
  `voice-activity.tsx`, `lib/voice-barge-in.ts`, `app/settings/constants.ts`, `i18n/en.ts` ·
  `website/docs/user-guide/features/voice-mode.md`, `website/docs/guides/use-voice-mode-with-hermes.md`
- open-webui, at `8bd8b4fac5e0`: `src/lib/components/chat/MessageInput/CallOverlay.svelte` ·
  `src/lib/components/common/InterfaceSettings.svelte` · `src/lib/components/chat/Settings/Audio.svelte` ·
  `src/lib/i18n/locales/en-US/translation.json` · `backend/open_webui/config.py`
  (`WHISPER_VAD_FILTER`) · `backend/open_webui/routers/audio.py`
- https://docs.discord.com/developers/topics/voice-connections
- https://support.discord.com/hc/en-us/articles/211376518-Voice-Input-Modes-101-Push-to-Talk-Voice-Activated (403, quoted via search excerpt)
- https://github.com/NousResearch/hermes-agent/issues/84046 · /75780 · /93583
- https://github.com/open-webui/open-webui/issues/2995 · /3450 · /7509 · /14500 · /28680 · discussions/28391 · discussions/9647
