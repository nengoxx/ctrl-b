# R82 — The single dial: how shipped voice products expose speech-detection sensitivity

**Date:** 2026-09-24
**Status:** Draft dossier — complete for the bounded question. Nothing is built; not a decision.
**What drove it:** the owner's S4 round №1 (2026-09-24) in the **car** (Honor 20 → car Bluetooth, the
EC-on/HFP route): ordinary speech fell under the client's 0.06 linear-RMS floor and finals were dropped
"too quiet" — the owner had to shout. At home the same floor lets short speech-like interferers through.
The owner asked for **one in-call knob** ("like the 0.9 one") to lower in the car and raise at home —
clarified mid-pass to **"as few dials as possible, only ones that matter for the use case."**
**Drove:** (open) — the dial design for the S4 close-out.
**Builds on, does not re-report:** [R76](./R76-noise-hallucination-gating.md) §4 (pipecat/livekit/
RealtimeSTT/open-webui defaults), §6 (energy corroboration = a *proximity* policy), §2 probe (**Silero is
near level-invariant**: speech at RMS 0.003 still scores 0.954). Sibling passes today: R83 (portable
floor), R84 (Silero calibration), R85 (Hermes + open-webui at source) — not re-trodden here.

**Reference class.** For end-user controls: consumer voice apps — **Discord · Mumble · TeamSpeak · Zoom ·
Google Meet · WhatsApp/Telegram/Signal · ChatGPT voice**. For one-knob-over-many-internals: the voice-agent
frameworks/platforms — **OpenAI Realtime · livekit/agents · pipecat · ElevenLabs Agents · Vapi · Retell ·
Deepgram Flux** — plus the WebRTC VAD mode table as the classic preset precedent.

**Confidence markers:** **[V]** read at source (pinned) or in an official doc fetched today · **[R]**
secondary source / search summary of an official page I could not fetch · **[U]** expected, not checked.

---

> ### Headline — five findings
>
> **① Every shipped level dial is in dB. None exposes linear RMS.** [V] Discord −100…0 dB (default −60);
> TeamSpeak SDK −50…+50 dB (default 0); Mumble 0–1 = `1 + dBFS/96`; pipecat 0–1 = −110…−10 LUFS. The
> scale is always *linear in dB*. For comparison, our floor 0.06 is **−24.4 dBFS**, and our dial moves a
> model probability, not a level.
>
> **② Our floor is 10–35 dB stricter than every shipped default I could get a number for.** [V numbers;
> the comparison is approximate because the measures differ — see §7] open-webui −55 dBFS · pipecat
> −50 LUFS · Discord −60 dB · Vapi's static fallback −35 dB · **ctrl-b −24.4 dBFS**. The car symptom is
> what that predicts.
>
> **③ Consumer products converged on "one level dial + an Auto toggle", with a live meter drawn on the
> dial's own scale.** [V] Discord (auto checkbox / manual slider over the live level bar), TeamSpeak
> (Automatic / Volume Gate / **Hybrid = level AND voice-classifier**), Mumble (Amplitude vs
> Signal-to-Noise mode; the wizard is **one slider that derives the two hysteresis thresholds**,
> `min = 0.9 × max`). Hold time is never on the one dial; it is a fixed default or an advanced control.
> Mass-market calling apps (Zoom, Meet, WhatsApp, Telegram, Signal, ChatGPT voice) expose **no speech
> threshold at all** — only noise-suppression modes.
>
> **④ Where agent platforms offer ONE enum, it controls *patience* (endpointing), not *sensitivity*.**
> [V] OpenAI `eagerness` low/medium/high → max timeout 8/4/2 s; ElevenLabs `turn_eagerness`
> eager/normal/patient; Retell `responsiveness` 0–1; Deepgram `eot_threshold`. Noise is handled by a
> **separate pre-VAD denoise stage** (OpenAI `near_field|far_field`, Retell `denoising_mode`, LiveKit/
> pipecat Krisp/ai-coustics). pipecat's docs call threshold knobs *"blunt instruments for noisy audio"*.
> So the field splits the problem into **two axes: level/sensitivity and patience.**
>
> **⑤ The only portable-by-construction mapping in the field is *relative*: an offset from a measured
> reference.** [V] Vapi gates at **the speaker's own level − 15 dB** (85th percentile of a 3 s rolling
> window), with a −35 dB static fallback until that level is known. Mumble SNR mode and WebRTC VAD are
> relative to a tracked noise floor. The absolute dB dials (Discord, TeamSpeak) need re-tuning per mic,
> which is exactly what the owner is doing by hand in the car.

---

## 0. Sources, pinned

| Source | Ref | Read |
|---|---|---|
| **mumble-voip/mumble** | `ee0546c974d5` (HEAD, 2026-09-24) — `src/mumble/AudioInput.cpp`, `AudioInput.h`, `AudioInput.ui`, `AudioConfigDialog.cpp`, `AudioWizard.cpp`, `AudioWizard.ui`, `Settings.h`, `AudioStats.cpp` | 2026-09-24 |
| **livekit/agents** | `98ed3e85011661e0` (HEAD, 2026-09-24) — `voice/turn.py`, `voice/endpointing.py`, `livekit-plugins-silero/.../vad.py` | 2026-09-24 |
| **pipecat-ai/pipecat** | `4471fe83b337` (HEAD, 2026-09-24) — `audio/vad/vad_analyzer.py`, `audio/utils.py`, `audio/vad/aic_quail_vad.py`, `frames/frames.py`, `services/assemblyai/models.py` | 2026-09-24 |
| **WebRTC VAD** (vendored in wiseman/py-webrtcvad) | `e283ca41df3a` (2021-02-15) — `cbits/webrtc/common_audio/vad/vad_core.c` | 2026-09-24 |
| Discord help center (Zendesk API JSON) | "Voice Input Modes 101" art. 211376518 and "Krisp FAQ" art. 360040843952, both `updated_at` 2026-09-24 | 2026-09-24 |
| Discord Social SDK docs | `discordpp::VADThresholdSettings`, `discordpp::Call`, `discordpp::Client`, "Managing Voice Chat" guide | 2026-09-24 |
| TeamSpeak | Client SDK "Preprocessor options" (teamspeakdocs.github.io/ClientSDK ar01s16); 3.5.0 changelog (community.teamspeak.com, 2020-03-19) | 2026-09-24 |
| OpenAI | `developers.openai.com/api/docs/guides/realtime-vad.md` + `…/reference/resources/realtime/client-events.md` | 2026-09-24 |
| LiveKit docs | `docs.livekit.io/agents/logic/turns/vad.md`, `…/turns/tuning.md`, `…/turns.md`, `…/transport/media/noise-cancellation.md` (rendered 2026-09-24) | 2026-09-24 |
| pipecat docs | `docs.pipecat.ai/server/utilities/audio/silero-vad-analyzer.md`, `…/guides/learn/speech-input.md` | 2026-09-24 |
| Vapi | docs "Background speech denoising", "Speech configuration"; blog "How We Built Adaptive Background Speech Filtering" (2025-07-24) | 2026-09-24 |
| Retell / ElevenLabs / Deepgram | Retell create-agent API ref; ElevenLabs "Conversation flow"; Deepgram Flux configuration | 2026-09-24 |
| Zoom | support KB0060612 (Audio settings) | 2026-09-24 |
| ctrl-b | `63da966` — `frontend/src/theme-engine/kit/CallOverlay.tsx:396-420` (Speech slider 0.05–0.95 step 0.05, release = leg redial), `backend/app/config.py:683-726` | 2026-09-24 |

Clones were under `~/.cache/tmp/research/` and deleted after the pass.

---

## 1. Discord — auto checkbox, or one dB slider over a live meter

- **Two modes.** [V, help art. 211376518] *"There are 2 options for input sensitivity, automatic and
  manual."* Auto: *"Discord automatically adjusts your microphone level based on the input it
  receives. While this feature generally works well, it may not perform as expected if there is
  significant background noise or large variations in your speaking volume."* Discord's own advice:
  *"if parts of your voice are getting cut off at the end of sentences, we recommend disabling this
  setting."*
- **The manual dial is a dB threshold.** [V, Social SDK `Call::SetVADThreshold(bool automatic, float
  threshold)`] *"Threshold has a range of -100, 0, and defaults to -60."* The same struct has
  `Automatic()`: *"Whether or not Discord is currently automatically setting and detecting the
  appropriate threshold to use."* So auto is a **threshold-setting** mode, not a different detector.
- **What auto actually does: unknown at source.** [R] Secondary sources say it calibrates to the
  ambient noise floor and sets the threshold just above it. I found no first-party description, no
  Krisp link (Krisp is a separate noise-suppression toggle, art. 360040843952), and no reverse
  engineering I trust. **Confidence: low.**
- **Meter UX.** [V, help] The slider sits on top of the live input bar. The live level shows **yellow
  below the marker and green above it**: *"Make sure the input activity is only in the yellow portion
  when you're not actively speaking … we want to put the sensitivity marker right between your softest
  speaking voice and any other noise coming through."*
- **Hold / latency.** [V, help] *"there is an inherent 200ms delay"* for Voice Activity. The hold is not
  a user control. The SDK's push-to-talk release delay is recommended at 20 ms.
- **Processing defaults.** [V, "Managing Voice Chat"] WebRTC noise suppression, echo cancellation and
  AGC are all on by default. Enabling Krisp disables the WebRTC suppressor. Also relevant:
  `SetNoAudioInputThreshold` (dBFS, −100…100) plus a callback *"useful for surfacing 'mic appears silent'
  UI hints"* (see §9).

## 2. Mumble — two detectors, one wizard slider, hysteresis derived [V, `ee0546c`]

- **The detector value** (`AudioInput.cpp:944-948`):
  ```cpp
  fSpeechProb = m_preprocessor.getSpeechProb() / 100.0f;
  dPeakCleanMic = qMax(dPeakSignal - gainValue, -96.0f);   // level after denoise, AGC gain removed
  float level = (vsVAD == SignalToNoise) ? fSpeechProb : (1.0f + dPeakCleanMic / 96.0f);
  ```
  `dPeakSignal` is the 10 ms frame RMS in dBFS (`:931-932`, 480 samples at 48 kHz, `AudioInput.h:222`).
  **Amplitude mode maps dBFS linearly onto 0–1 over a 96 dB span.** SNR mode uses the Speex
  preprocessor's speech probability, which is relative to Speex's own noise estimate [R on the Speex
  internals].
- **Two-threshold hysteresis plus hold** (`:952-966`): above `fVADmax` = speech; between `fVADmin` and
  `fVADmax` = speech only if already speaking; then `iVoiceHold` frames of hang. Tooltip
  (`AudioInput.ui:429/460`): *"Values in between will count as voice if you're already talking, but will
  not trigger a new detection."*
- **Defaults** (`Settings.h:265-282`): `vsVAD = Amplitude`, `fVADmin 0.80`, `fVADmax 0.98`,
  `iVoiceHold 20` (= 200 ms), `iMinLoudness 1000` (AGC max gain = 20·log10(30000/1000) ≈ 29 dB,
  `AudioInput.cpp:763-764`). The hold slider ranges 20–250, i.e. 0.2–2.5 s (`AudioInput.ui:336-350`,
  label `AudioConfigDialog.cpp:309-312`).
- **The single-dial precedent** (`AudioWizard.cpp:595-599`) — the wizard shows **one** slider and
  derives both thresholds from it:
  ```cpp
  Global::get().s.fVADmax = v / 32767.0f;
  Global::get().s.fVADmin = Global::get().s.fVADmax * 0.9f;
  ```
  In Amplitude mode that is a release point **9.6·max dB below** the trigger (e.g. max 0.6 → trigger
  −38.4 dB, release −44.2 dB). The mode choice (Amplitude / SNR) is a separate radio button. Hold is
  **not** on the wizard. The advanced dialog exposes min, max and hold separately
  (`AudioConfigDialog.cpp:123-125, 244-247`).
- **Meter UX** (`AudioWizard.cpp:141-143, 487-495`; `AudioConfigDialog.cpp:68-70, 593-599`): a bar on
  the dial's own scale with **three zones — red below min, yellow between, green above max** — and the
  live level drawn over it. Wizard copy (`AudioWizard.ui:556`): *"The first few utterances you say should
  end up in the green area (definitive speech). While talking, you should stay inside the yellow (might
  be speech) and when you're not talking, everything should be in the red."*
- **Audio cues** (`AudioInput.cpp:1018-1027`, `Settings.h:231-234`): an on/off click when transmission
  starts or stops. Default ON for push-to-talk, **OFF for VAD**.
- Runtime-settable: the plugin API reads and writes `fVADmin`/`fVADmax` (`API_v_1_x_x.cpp:1189-1386`).

## 3. TeamSpeak, Zoom, Meet, messengers — brief

- **TeamSpeak.** [V, Client SDK] `"voiceactivation_level"` — *"Voice Activity Detection level in
  decibel … Reasonable values range from -50 to 50. Default is 0."* It runs after the preprocessor's AGC
  (`agc` on by default, `agc_level` 16000, `agc_max_gain` 30), so the dB is post-AGC.
  `"vad_extrabuffersize"` is 0–8, default 2 (the hangover; the doc gives no units). [V, 3.5.0 changelog
  2020-03-19] *"Added new voice activity detection modes (Automatic, Volume Gate, Hybrid)."* [R] Hybrid
  sends only when the level is above the threshold **and** a classifier says voice. Upgraded profiles
  kept Volume Gate; new profiles default to Automatic. [R] **Capture profiles** can be bound to a
  bookmark or switched with a hotkey — per-environment presets.
- **Zoom.** [V, KB0060612] Users get *"Automatically adjust microphone volume"* (AGC) and microphone
  modes: *Noise removal (default)* / *Original sound for musicians* / *Personalized audio isolation*
  (*"uses your voiceprint … recommended for use in crowded environments"*). **No VAD dial.**
- **Google Meet.** [R, official help via search] A noise-cancellation on/off toggle only. *"Meet cancels
  non-speech noises … voices from TV or people talking won't be canceled."* No VAD dial.
- **WhatsApp / Telegram / Signal.** [R] A noise-cancellation/suppression toggle at most. No sensitivity
  control found. **The mass-market calling apps are fully automatic.**
- **ChatGPT voice.** [R, help-center search summary; the page itself returned 403] No sensitivity
  control. OpenAI's help advice for noise is *"Try using headphones, moving to a quieter environment"*
  and iOS *Voice Isolation* mic mode.

## 4. OpenAI Realtime — one enum, but for patience [V, docs 2026-09-24]

- `semantic_vad.eagerness`: *"`low`, `medium`, and `high` have max timeouts of 8s, 4s, and 2s
  respectively … `auto` is the default and is equivalent to `medium`."* *"`low` will let the user take
  their time to speak. `high` will chunk the audio as soon as possible."* The **only** internal it
  documents is the max wait. It does not address noise admission.
- `server_vad`: `threshold` 0.5 (*"A higher threshold will require louder audio to activate the model,
  and thus might perform better in noisy environments"*), `prefix_padding_ms` 300,
  `silence_duration_ms` 500. These are raw fields, not a preset. Noise goes to a separate
  `noise_reduction: near_field | far_field` enum applied *"before it is sent to VAD and the model"*
  (already in R76 §4.5).

## 5. livekit/agents and pipecat — no sensitivity preset; tune by field, denoise first

- **livekit** [V, `98ed3e8`]: no single-preset abstraction over sensitivity. `TurnHandlingOptions`
  groups the knobs by stage. Endpointing is `mode "fixed"|"dynamic"`, `min_delay 0.5`, `max_delay 3.0`,
  `alpha 0.9` (`turn.py:113-140`; streaming-STT variant 0.3/2.5). **`dynamic` is an auto mode for
  patience**: *"`min_delay` is learned from the user's pausing behavior"* as an EMA clamped to
  [min, max] (`endpointing.py:49-72`). Interruption defaults are `min_duration 0.5`, `min_words 0`,
  `false_interruption_timeout 2.0`, `mode adaptive|vad` (`turn.py:150-198`). Silero:
  `activation_threshold 0.5`, deactivation = `max(activation − 0.15, 0.01)` — **derived hysteresis**
  (`vad.py:110,138`) — and runtime `update_options(...)` (`vad.py:179`).
- **LiveKit's guidance for noise** [V, `turns/tuning.md`] does not touch thresholds. The troubleshooting
  row *"turn detection still misfires in noisy rooms"* says *"Add voice isolation … or background noise
  suppression … Both run before VAD and STT."* The one threshold example is realtime `server_vad`
  `threshold=0.7  # less sensitive (better for noisy phone audio)` with `silence_duration_ms=400`
  (`turns.md:105-120`). Krisp VIVA's `noise_suppression_level` is 0–100, default 75, **adjustable at
  runtime** (*"raising it when background noise increases"*).
- **pipecat** [V, `4471fe8`]: `VADParams(confidence 0.7, start_secs 0.2, stop_secs 0.2, min_volume
  0.6)` with no preset. `min_volume` is normalised **linearly in LUFS over −110…−10**
  (`audio/utils.py:183-186`), so **0.6 = −50 LUFS**. Runtime change goes through `VADParamsUpdateFrame`
  (`frames.py:2461`) → `set_params` (`vad_analyzer.py:151`). One telling move: the ai-coustics VAD's own
  SDK-level `sensitivity`, `speech_hold_duration` and `minimum_speech_duration` were **deprecated in
  1.5.0** in favour of the one `VADParams` gate (`aic_quail_vad.py:~100-125`), which consolidates on one
  threshold owner. Docs [V, `speech-input.md`]: *"`confidence` and `min_volume` only raise the bar for
  what counts as speech — blunt instruments for noisy audio … it's usually better to remove the noise
  upstream with an input audio filter."* The AssemblyAI service doc says *"Increase [vad_threshold] for
  noisy environments."*

## 6. Builder-facing platforms — brief [V fields; internals undocumented unless stated]

| Platform | One-dial control | Values | What it drives |
|---|---|---|---|
| ElevenLabs Agents | `turn.turn_eagerness` | eager / **normal** / patient | patience (internals undocumented); `turn_timeout` 1–30 s separate. VAD config holds one bool, `background_voice_detection` (default false) [R, changelog] |
| Retell | `responsiveness` · `interruption_sensitivity` | 0–1, both default **1** | patience · barge difficulty (*"Lower value means it will take longer / more words for user to interrupt"*); noise = `denoising_mode` no-denoise / **noise-cancellation** / noise-and-background-speech-cancellation |
| Vapi | none for sensitivity. `stopSpeakingPlan` numWords / voiceSeconds **0.2** / backoffSeconds 1; `startSpeakingPlan.waitSeconds` **0.4** | — | LiveKit smart-endpointing wait = **`200 + 8000·x` ms** (x = the end-of-turn model's output) — a formula mapping |
| Vapi Fourier denoise | `baselineOffsetDb` | **−15** (−30…−5) | gate = rolling speaker baseline + offset; `staticThreshold` **−35 dB** (−80…0) fallback; `windowSizeMs` 3000; `baselinePercentile` 85; media detected → −20 / −30 |
| Deepgram Flux | `eot_threshold` | 0.5–1.0, **0.7** | end-of-turn confidence; `eot_timeout_ms` 500–60000, **5000** |

**Vapi's mechanism** [V, blog 2025-07-24]: *"a 3-second rolling window of audio levels … finds the 85th
percentile of speech volume to identify the primary speaker's level"*, updated every 20 ms, and
*"filters audio that falls a specific amount (e.g., 15dB) below this moving baseline."* Its docs pair it
with Krisp and do not recommend it alone ("experimental"). Recommended presets: call centre −10 dB /
2000 ms / p90; home with TV −15 dB / 4000 ms / p80.

## 7. The mapping question — dial → internals, per product

| Product | Dial | Derivation | Shape |
|---|---|---|---|
| Discord | threshold dB, −100…0 (−60) | gate = dial; auto = system sets the dial | absolute dB, plus auto |
| TeamSpeak | `voiceactivation_level` dB (0, post-AGC) | gate = dial; Hybrid = dial AND classifier | absolute dB, plus classifier AND |
| Mumble wizard | v ∈ 0–1 | trigger = v; release = 0.9·v; in Amplitude mode, dB = 96·(level−1); hold fixed (200 ms) | dB-linear, **hysteresis derived by ratio** |
| Mumble SNR | same | the same, but on Speex speech probability (noise-relative) | relative to noise floor |
| pipecat | `min_volume` 0–1 | LUFS = −110 + 100·v, ANDed with `confidence` | dB-linear, AND-gate |
| livekit Silero | `activation_threshold` | deactivation = act − 0.15 | derived hysteresis by offset |
| WebRTC VAD | mode 0–3 | **preset table**, per 10/20/30 ms frame (`vad_core.c:72-91`): local threshold 24→37→82→94, global 57→100→285→1100, hangover₁ 8→8→6→6, hangover₂ 14→14→9→9 | one enum moves thresholds **up** and hold **down** together, on a noise-adaptive GMM |
| RealtimeSTT | `silero_sensitivity` s | threshold = 1 − s (R76 §4.3) | inverted linear |
| OpenAI | `eagerness` | max timeout 8 / 4 / 2 s | preset table (patience) |
| Vapi | `baselineOffsetDb` | gate = p85(speaker dB, 3 s) + offset; −35 dB until a baseline exists | **speaker-relative dB offset** |
| Vapi endpointing | model x | wait = 200 + 8000·x ms | formula |

**What the field converged on:**
- **(a)** User-facing *level* dials are **dB-linear**. Discord and TeamSpeak show dB; Mumble and pipecat
  show 0–1 over a dB span.
- **(b)** The second threshold (release/hysteresis) is **derived, never a second consumer dial**
  (Mumble ×0.9, livekit −0.15).
- **(c)** Hold is a **fixed default of about 200 ms** (Discord's "inherent 200ms", Mumble's 20 frames,
  pipecat's `stop_secs 0.2`) and is only exposed in advanced UIs. Only the WebRTC preset table moves it
  together with the threshold.
- **(d)** Enum presets exist for **patience**, not for noise.
- **(e)** Portability comes from a **reference-relative** offset (noise floor: Mumble SNR, WebRTC,
  Speex; speaker level: Vapi) or from **Auto** (Discord, TeamSpeak, Zoom AGC).

*Comparability caveat:* Mumble measures dBFS RMS on 10 ms frames after AGC removal; pipecat measures
K-weighted LUFS over 400 ms; our worklet measures linear RMS on 40 ms frames with AGC at the browser
default. The dB comparisons in the headline hold to within several dB, not exactly.

## 8. The minimum useful live feedback

The shared pattern [V: Discord help, Mumble wizard/dialog, Zoom *Input Level*] is **one horizontal
level bar with the threshold marker drawn on the same scale as the live level**. The colour changes
across the marker: Discord yellow→green, Mumble red/yellow/green, the Mumble amplification page
blue/green/red. Every product that has a dial puts it *on* the meter. None shows raw numbers to the
consumer; Mumble's numbers live in a separate "Audio Statistics" window, which is the equivalent of our
debug readout. The minimum in-call feedback is therefore **(1) level bar + marker in dB, (2) a visible
"heard / not heard" state change**, and — our addition, since ctrl-b drops finals after the fact —
**(3) the existing "too quiet — didn't take that" notice**, which is the case the meter explains.

## 9. Bounded open sweep — three things that change the car design

1. **Per-environment memory.** [R] TeamSpeak binds capture profiles to bookmarks/hotkeys because the
   right threshold is per environment. ctrl-b already *knows* the environment proxy: the route
   (EC-on/HFP vs clean, R74). A dial remembered **per route** means the car value comes back when the
   car connects, and the home value does not leak into it. [U] I have not checked whether Discord or
   Mumble store per device.
2. **Eyes-free feedback while driving.** [V] Mumble ships start/stop audio cues, default off for VAD.
   Discord's SDK has a "mic appears silent" threshold callback (dBFS). In a car the owner cannot read a
   meter. An **earcon when a final is dropped** (and optionally a "mic seems silent" hint when the level
   never crosses the floor for N seconds) is the driving-safe version of §8.
3. **The field's answer to a *near* or speech-like interferer is not a threshold.** [V: pipecat tip,
   LiveKit troubleshooting row, Zoom voiceprint isolation; R: Meet's "voices from TV … won't be
   canceled"] A level dial cannot reject a loud nearby voice. Any dial design should be sold as
   **proximity**, as R76 §6 already says, and home false turns from a near voice stay R76 ③'s problem
   (lone-short-final policy), not the dial's.

---

## What I could not determine

1. **What Discord's automatic mode computes.** There is no first-party description beyond "adjusts
   based on the input it receives". The noise-floor story is secondary-source only.
2. **TeamSpeak Automatic/Hybrid internals** (which classifier; whether Automatic has any threshold) and
   the unit of `vad_extrabuffersize`.
3. **ElevenLabs / Retell / OpenAI eagerness internals** beyond OpenAI's 8/4/2 s. They are documented as
   behaviour, not as parameter tables.
4. **Mumble's shipped default `fVADmax 0.98` in Amplitude mode** implies a trigger near −1.9 dB pre-AGC,
   which looks unusable without the wizard. I did not confirm whether the first-run wizard always
   overwrites it.
5. **ChatGPT voice settings** — the help page returned 403 to both fetchers. The claim rests on a
   search summary.
6. Whether any product stores the dial **per input device/route** (item 9.1 is TeamSpeak-only, [R]).
7. **Our own numbers on the car route** — the owner's speech and noise-floor dB on HFP vs the phone mic.
   This is S4 data, not field data. Every design below is calibrated by it.

---

## Implications for ctrl-b — ranked

*Evidence ages slowly; this section fast. Nothing is decided. Per the owner's clarification: fewest
controls that each earn their place.* Two facts shape everything. **R76 showed Silero is
level-invariant**, so moving 0.9 cannot fix a quiet car mic: the drop happens at the *energy* gate.
And **the Speech slider costs a leg redial** (`CallOverlay.tsx:407-411`), while client-side values
change instantly.

### ① One level dial in dB that replaces the Speech slider's role; everything else derived or fixed **[recommended first]**

- **Dial:** "Sensitivity", the energy floor in **dBFS**, drawn on a live level bar with the marker
  (§8). Range about **−60…−20 dB**, step 1–2 dB. Today's 0.06 = −24.4 dB; the field's defaults sit at
  −35…−60 dB. Client-only, so it applies **instantly, with no redial**, and is remembered **per route**
  (§9.1).
- **Derived:**
  - The barge floor = the dial, as today.
  - A release/hysteresis point, *only if* the accrual ever becomes open/close: dial − 6 dB (Mumble's
    ratio ≈ 6 dB at mid-scale).
- **Fixed constants with a Conf fallback:**
  - `min_final_ms` 200 (the field's ~200 ms hold class).
  - `min_speech_ms`.
  - `silence_ms`.
  - **Silero `vad_threshold`**, which leaves the deck. R84 owns its value.
- **Trade:** exactly what the owner asked for ("lower it in the car"), and the most common consumer
  shape (Discord/TeamSpeak/Mumble wizard). But it is **absolute**, so it still needs a hand-move per
  mic. Honest cost: it hands the portability problem to the owner's thumb.

### ② The same one dial, made relative to a measured reference — the dial sets *margin*, not level

- **Dial:** the offset in dB, drawn on the same meter.
- **Speaker-relative variant (Vapi):** floor = p85 of the owner's *accepted-utterance* frame dB over a
  rolling window, **− offset** (default about 15 dB, range 6–30 dB). Before a baseline exists, fall
  back to the ① absolute value.
- **Noise-relative variant (Mumble SNR / WebRTC):** floor = p10–p20 of non-speech frame dB **+ margin**.
- **Trade:** portable by construction. The car's quieter HFP mic lowers the owner's baseline and the gate
  follows, while a distant TV stays 15–35 dB below. Costs:
  - cold start;
  - baseline poisoning if an interferer's frames are accepted (hence "accepted utterances only");
  - new client state to review.
- The speaker-relative variant fits our failure better: the car's issue is a quiet *speaker*, not loud
  noise, and a noise-relative gate would get *stricter* in road noise. Could ship as ①'s "Auto" toggle
  (Discord's shape: auto on by default, manual dial when off).

### ③ A patience dial — only if S4 shows the car cut-offs are endpointing

The field's other axis (§4, §6). If the car "cut-offs" prove to be `silence_ms` ending turns on HFP
dropouts rather than the energy gate, a 3-step **low/medium/high** enum → `silence_ms` (for example
1200/700/450 ms, OpenAI-style table) earns a second control. Trade: it is server-side, so it costs a
redial like today's slider. Until the S4 log says so, it stays a Conf constant.

### Recorded and NOT recommended

- **A master 0–1 preset table that also moves Silero** (WebRTC-mode shape). It couples a
  level-invariant knob with ~0.05 headroom and a redial to a client value that works live. That is the
  most coupling for the least effect.
- **A second consumer dial for hold or hysteresis.** Nobody ships one outside advanced settings.
