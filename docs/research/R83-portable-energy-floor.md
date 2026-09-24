# R83 — A portable floor: making one energy gate hold across mics, routes and gain paths

**Date: 2026-09-24 · Confidence: the algorithms, defaults and time constants below are VERIFIED at
pinned source (WebRTC, Chromium, Mumble, speexdsp, pipecat, SpeechRecognition, AOSP Bluetooth) or the
official spec/doc named. Measured levels of real devices are mostly UNVERIFIED — nobody publishes
a per-route dBFS table, so the telecom standards' nominal levels are the best numbers available. No
phone was probed in this pass.**

**Question (one):** our quiet-final gate (D74, from R76 §8 ①) compares a linear 40 ms frame RMS against
an **absolute** floor (`barge_threshold` 0.06, set by the owner on the phone mic). In the car (BT HFP,
comm mode) ordinary speech falls under it. How do shipped stacks make a level gate portable across
mics and routes, or calibrate it automatically, so that one in-call dial (or none) can sit on top?
*Owner clarification mid-run:* "as few dials as possible — only ones that matter for car vs home."

**Builds on:** R76 §4 (pipecat `min_volume`, open-webui −55 dB band, RealtimeSTT, livekit), §6 (energy
gating = a **proximity** policy) · R78 §3.4 (AGC follows the EC constraint; the floor is not portable
between routes) · R74 §1 (Android effects mask). **Drove:** (open).

| Source | Pin | How read |
|---|---|---|
| WebRTC `src` | `4da20ad2280d` (main, 2026-09-24) | googlesource `?format=TEXT`, whole files |
| `chromium/chromium` | `e5554c0b194d` (main, 2026-09-21 — R78's pin) | raw GitHub mirror |
| `mumble-voip/mumble` | `ee0546c974d5` (2026-09-24) | shallow clone |
| `xiph/speexdsp` | `7a158783df74` (2025-07-05) | raw |
| `pipecat-ai/pipecat` | `4471fe83b337` (2026-09-24) | shallow clone |
| `Uberi/speech_recognition` | `8075e8f76acd` (2026-09-02) | raw |
| AOSP `system/bt` · `packages/apps/Bluetooth` | `android10-release` @ `ae35d7765dc6` · `be6ecb1844a4` | googlesource |
| ITU-T P.1100 (03/2017) · Android 10 CDD · W3C mediacapture-main ED · Discord Social SDK ref | fetched 2026-09-24 | official PDFs / pages |

**Markers:** **[V]** read at the pin / official doc · **[R]** secondary source · **[U]** expected, unchecked.

---

> ### Headline
>
> **① Chrome-on-Android has no adaptive AGC.** [V] `media/webrtc/helpers.cc` `ConfigAutomaticGainControl`:
> on `IS_ANDROID` the "AGC" is **AGC2 with a *fixed* +6 dB digital gain, adaptive digital OFF, input
> volume controller OFF**. Adaptive AGC2 (the level-normalising one) runs only on desktop. Combined with
> R78 §3.4 (AGC defaults ON with EC, OFF without), our two routes differ by a **constant 6 dB step** and
> *nothing* normalises the car mic. Turning `autoGainControl` on cannot fix the car.
>
> **② The car hands-free is quieter *by specification* and forbidden to normalise.** [V] ITU-T P.1100
> §11.3.1: speakerphone hands-free **SLR = 13 ± 4 dB** vs headset **8 ± 4 dB** (handset class ≈ 8 dB) —
> the car uplink is nominally **~5 dB quieter** than a close mic for the same talker, spread ±4 dB
> across cars. §11.3.4.1 requires SLR to stay within 0.5 dB across −3…+6 dB of talker level, i.e.
> **send-side AGC is disallowed** by default. And Android 10 **ignores** the car's `+VGM` mic-gain
> report (`HeadsetStateMachine.java:1601`, "Not used currently").
>
> **③ Our floor sits above the telephony nominal speech level.** 0.06 linear RMS = **−24.4 dBFS**
> (dB re full-scale RMS). The nominal active speech level of a telephone channel is **−26 dBov** [R]
> (≈ 0.050 RMS under the G.191/sv56 convention). So a standards-shaped uplink carries its *average*
> active speech 1.6 dB **under** our floor; a car at SLR 13 lands ~5 dB lower still, partly bought back
> by Chrome's +6 dB. Only syllable peaks clear 0.06 → "had to shout". The phone-mic path clears it
> because the owner speaks into it at close range (R78 S0: −13.8 dBFS raw, −18 dBFS under EC).
>
> **④ Every shipped *adaptive* gate is a minimum-statistics noise-floor tracker plus a dB margin,**
> and they avoid learning speech by tracking a **minimum** (speech has gaps), not a mean. WebRTC AGC2's
> estimator is the simplest robust one: min over 5 s windows, instant down, half-way up per window.
> The one that uses a **mean** (SpeechRecognition's `dynamic_energy_threshold`) learns speech into its
> threshold — the recorded failure mode.
>
> **⑤ A floor-relative (SNR) gate fixes the car but is the wrong discriminator for the home interferer.**
> A distant TV in a quiet room has *good* SNR against a quiet floor. The shipped precedent for "near
> talker vs background talker" is **relative to the user's own learned speech level**: WebRTC AGC2's
> experimental estimator classifies speech **> 10 dB below** the learned level as a *background
> speaker* and refuses to learn it. That, not SNR, is the portable form of the proximity policy.

---

## 1. Scale — dBFS vs linear, and what each stack thresholds on

**Conversion** (our worklet: `rms = sqrt(mean(x²))`, x ∈ [−1, 1]): `dBFS = 20·log10(rms)`.
0.003 → −50.5 · 0.01 → −40.0 · 0.035 → −29.1 · 0.05 → −26.0 · **0.06 → −24.4** · 0.1 → −20.0 ·
0.126 → −18.0 · 0.2 → −14.0. (Under AES17 a full-scale *sine* is 0 dBFS, which shifts every figure
+3.01 dB; the code bases below all use the RMS-re-full-scale form, as we do.) [V arithmetic]

| Stack | What it thresholds | Scale | Default | Ref |
|---|---|---|---|---|
| WebRTC AGC2 | frame RMS | **dBFS** (`10·log10(rms²)` − 90.31 on s16) | noise floor ≥ −84 dBFS | `noise_level_estimator.cc` [V] |
| webrtcvad | log energy in 6 bands vs adaptive GMM | log | only absolute gate `kMinEnergy = 10` | `vad_core.h:35`, `vad_core.c:178` [V] |
| Mumble "Amplitude" | post-NS RMS **minus the AGC gain** | `1 + dBFS/96` on 0…1 | `fVADmax 0.98`, `fVADmin 0.80`; wizard sets min = 0.9·max | `AudioInput.cpp:932,947-958`, `Settings.h:280-282`, `AudioWizard.cpp:597-598` [V] |
| Mumble "Signal to Noise" | speex speech probability (SNR-derived) | 0…1 | same slider | `AudioInput.cpp:944,948` [V] |
| pipecat `min_volume` | BS.1770 loudness, rolling 400 ms, EMA α 0.2 | LUFS mapped −110…−10 → 0…1 | **0.6 ≡ −50 LUFS** | `audio/utils.py:164-189`, `vad_analyzer.py:28,211` [V] |
| open-webui call mode | AnalyserNode bins in −55…−30 dB | dB | −55 dB | R76 §4.4 [V] |
| Discord Social SDK | `Call::SetVADThreshold(bool automatic, float threshold)` | "range of −100, 0, and defaults to −60" (dB) | automatic = true in the client | SDK reference [V doc; algorithm U] |
| SpeechRecognition | int16 RMS | linear | 300 (≈ −40.8 dBFS), dynamic | `__init__.py:325-328` [V] |
| RealtimeSTT | no energy gate (WebRTC VAD → Silero) | — | — | R76 §4.3 [V] |

**Reading:** everyone who exposes a level to a person does it **in dB** (Discord, Mumble's meter,
open-webui); the only linear one (SpeechRecognition) is the one whose users re-tune it constantly [R].
dB matters for portability because a route change is a **multiplicative** gain — an additive offset in
dB — so a dB margin moves with it and a linear threshold does not. pipecat's −50 LUFS is a
permissive "is there sound at all" floor, 26 dB below ours: nobody in the reference class ships an
absolute floor as high as −24 dBFS.

**Typical levels.** Measured dBFS per device class is **not published** by any project read. The
standards give the shape [V unless marked]:
- Nominal active speech (telephony) **−26 dBov** [R, ITU-T P.56/G.191 practice].
- Test talker level at the mouth reference point: **−4.7 dBPa** (89.3 dB SPL) "typical average speech"
  for headsets; **−1.7 dBPa** for car speakerphones (people talk louder in cars) — P.1100 §8 test
  signals.
- Android 10 CDD §5.4.2 (VOICE_RECOGNITION only): 90 dB SPL at 1 kHz → RMS 2500/32768 =
  **−22.35 dBFS**, linear over −18…+12 dB. At that calibration, a talker at arm's length (~60–65 dB SPL
  [R, textbook conversational level]) lands near **−47…−52 dBFS**; at 5–10 cm, near −30 dBFS. Our
  capture is VOICE_COMMUNICATION/GENERIC, which the CDD does not calibrate — OEM gain applies.
- Our own phone: **−13.8 dBFS raw / −18 dBFS under EC** (R78 S0, owner talking into the handset).
- Car HFP, headset boom, laptop: **[U]** — derive from SLR only (§5).

## 2. Noise-floor trackers — algorithms and constants

| Estimator | Window / memory | Down (floor falls) | Up (floor rises) | How it avoids learning speech | Gate |
|---|---|---|---|---|---|
| **WebRTC AGC2 `NoiseFloorEstimator`** [V] | min of frame energy over **500 × 10 ms = 5 s** periods | instant, within the period | at period end: `0.5·new + 0.5·old` (energy) | minimum, not mean; first period monotonic-min; frames < −84 dBFS ignored | feeds `max_output_noise_level_dbfs = −50` (caps gain so noise stays ≤ −50) |
| **webrtcvad** [V] | per band, 16 smallest of last **100 frames** (1–3 s), median of 5 smallest | smoothed α 0.2 (fast) | α 0.99 per frame (slow) | noise GMM updated only on frames the VAD called noise + long-term pull to the minimum | GMM likelihood ratio (mode 0–3) |
| **speexdsp MCRA** (Mumble SNR mode) [V] | `Smin` over a window growing **15 → 50 → 150 → 300** frames as it adapts | min | window restart | speech-present where smoothed power > **2.5 × min (≈ 4 dB)**; noise updated only elsewhere, β = max(0.03, 1/n) | speech prob start **0.35** / continue **0.20** |
| **SpeechRecognition** [V] | EMA, damping 0.15^s (**τ ≈ 0.53 s**) | same | same (symmetric despite the "asymmetric" comment) | **doesn't** — updates inside the phrase loop too (`_listen`, :547-550) | threshold = **1.5 × RMS ≈ +3.5 dB** |
| Discord automatic | — | — | — | — | proprietary; "sets it just above your silence level" [R, third-party] |

Speex's preprocess is the classic citation (`preprocess.c:660-706, 740`); Mumble's SNR mode surfaces it
as a 0–1 probability behind the same hysteresis slider as Amplitude mode [V].

**Simplest one that survives both car and quiet room: AGC2's.** Twenty lines, three constants, a
minimum (so continuous talking cannot raise it — only a louder *minimum* over a whole 5 s window can),
instant fall when the car stops, and a bounded 5–10 s climb when the engine starts. webrtcvad's
α 0.2/0.99 asymmetry is the equivalent in EMA form. On our 40 ms frames: 5 s = 125 frames.

**Two facts about *our* floor that the trackers don't know** [V from Chromium; effect U]:
Chrome's software NS runs at **`kHigh` = 18 dB** suppression (`helpers.cc` → `audio_processing_impl.cc:1997`)
before the worklet sees a sample, so stationary engine hum is largely removed — the in-car floor we
would measure is post-suppression and probably *low* [U]. The HFP codec caps bandwidth at 4 kHz (CVSD,
8 kHz) or 8 kHz (mSBC); it does not by itself remove low-frequency rumble.

## 3. Calibration at capture start

- **SpeechRecognition** `adjust_for_ambient_noise(duration=1)`: docstring says *"at least 0.5"* s and
  *"will stop early if any speech is detected"* — **the code does not stop early**; it EMA's whatever it
  hears (`:368-393`) [V]. The field's most-copied calibration is mean-based and speech-contaminable.
- **Mumble Audio Wizard**: no automatic ambient measurement; the user drags the VAD slider over a live
  meter coloured below/inside/above (`AudioWizard.cpp:142-145, 487-491`) [V].
- **Discord**: automatic sensitivity (SDK `automatic=true`); mechanism undocumented [U].
- **WebRTC AGC2**: no separate calibration phase — the **first 5 s period is monotonic-min**, so the
  floor is usable after the first quiet 10 ms and only ever falls during that period [V]. A user who
  talks immediately still has inter-word gaps; the minimum finds them.

**Answer:** the robust products don't calibrate-then-freeze; they run a min-tracker from frame 1. A
fixed "listen for N ms" window only works if it is min-based — mean-based windows learn the first word.

## 4. AGC — what `autoGainControl` actually does here

- **Spec:** mediacapture-main defines `autoGainControl` as a boolean the app may turn off; **no default
  is specified** (UA-defined) [V].
- **Chrome default:** ON, but forced OFF when the ideal EC mode is disabled (R78 §3.4,
  `media_stream_audio_processor_options.cc:639`) [V]. ⇒ EC-on route (incl. car HFP): AGC on; clean route:
  off.
- **What "on" means on Android** [V, `helpers.cc` `ConfigAutomaticGainControl`]:
  ```cpp
  #elif BUILDFLAG(IS_ANDROID) || BUILDFLAG(IS_IOS) || ...
    // Configure AGC for mobile.
    apm_config.gain_controller1.enabled = false;
    apm_config.gain_controller2.enabled = true;
    apm_config.gain_controller2.fixed_digital.gain_db = 6.0f;
    apm_config.gain_controller2.adaptive_digital.enabled = false;
    apm_config.gain_controller2.input_volume_controller.enabled = false;
  ```
  A fixed +6 dB ahead of AGC2's limiter (which only acts near 0 dBFS). **No pumping, no noise boost
  between words — and no normalisation.**
- **What adaptive AGC2 would do** (desktop only; reference numbers) [V, `audio_processing.h:358-362`,
  `agc2_common.h`]: target speech level **−5 dBFS** (`headroom_db 5`), `max_gain_db 50`,
  `initial_gain_db 15`, slew **6 dB/s**, gain capped so noise ≤ **−50 dBFS**; gain may rise only after
  **12 adjacent frames (120 ms) at VAD ≥ 0.95**; speech level = probability-weighted leaky average, leak
  1 − 1/400 per 10 ms (≈ **4 s of speech**). This is what "AGC normalises the car mic" would require, and
  Chrome does not ship it on Android. Its costs, were it available: 6 dB/s means ~3 s to recover a 20 dB
  route change; background is lifted up to the −50 dBFS cap.
- **Android HAL AGC on VOICE_COMMUNICATION:** the CDD mandates AGC/NR **off** only for
  VOICE_RECOGNITION (§5.4.2 C-1-2/C-1-3) and says nothing for VOICE_COMMUNICATION [V]. Chrome never
  requests Android's `AutomaticGainControl` effect (R74 §1) [V]. Whether the Kirin/Magic UI DSP chain
  applies its own AGC on the comm preset or the SCO input is **[U]**, and in-car it is moot: the SCO
  audio is whatever the car sent.

## 5. Bluetooth HFP

- **Codec:** Android 10 AOSP advertises codec negotiation (`BTA_AG_FEAT_CODEC` in `BTIF_HF_FEATURES`,
  `btif_hf.cc:76-82`) and **prefers mSBC whenever the car's `AT+BAC` lists it** (`:500-512`); otherwise
  CVSD 8 kHz [V AOSP]. Whether Honor's stack/HAL enables WBS, and whether the owner's car offers mSBC, is
  **[U]** (a `bt_wbs=on` audio parameter is set on mSBC — `HeadsetStateMachine.java:80`).
- **Gain:** HFP carries `+VGM` (mic gain 0–15, HF → AG). Android 10 **stores and ignores** it
  (`:1601-1603`) [V]. There is no phone-side level alignment for the car mic.
- **Car-side processing:** HFP lets the HF declare its own EC/NR; `AT+NREC=0` asks the phone to turn
  its own off. Android resets NREC **on** at connect and forwards the car's request to the HAL as
  `bt_headset_nrec` (`:1030, 1610-1615`) [V]. The car therefore typically runs its own ECNR [R]; P.1100
  requires its send level to be **linear (no AGC)** within 0.5 dB over −3…+6 dB (§11.3.4.1, with a
  NOTE allowing AGC "under certain network conditions") [V].
- **Level:** SLR 13 ± 4 dB (speakerphone) vs 8 ± 4 (headset) [V] ⇒ **nominal ~5 dB quieter, ±4 dB car
  to car.** After Chrome's +6 dB (EC route), the car lands roughly at the telephony nominal — i.e. right
  on our −24.4 dBFS floor, which a 200 ms-above-floor accrual rule then fails on ordinary speech.

## 6. The two-signal alternative — SNR, and own-voice-relative

**Floor-relative (SNR) gating** — precedent: speex/Mumble SNR mode (presence at ≈ 4 dB over the
minimum), SpeechRecognition (+3.5 dB), webrtcvad (GMM vs adaptive noise model). All are **onset/
presence** detectors with small margins; **no project in the reference class gates a *final* on SNR**
(livekit, pipecat, RealtimeSTT, open-webui — R76 §4 and this pass) [V negative].
- *Fixes the car:* speech and floor are both route-scaled, so a dB margin is route-invariant; and the
  post-NS, band-limited car floor is likely low [mechanism V; car U].
- *Does not reliably fix home:* a TV/other-room voice at −50 dBFS against a −65 dBFS quiet-room floor
  is **15 dB SNR** — it passes any margin ≤ 15 dB, while the same TV in a noisier room fails. SNR
  measures audibility, not proximity.
- *Failure modes:* stationary loud noise is fine (tracked); **non-stationary** noise (wind buffeting,
  indicator clicks, road joints, passengers, the car radio) sits above the floor and passes; a floor
  that fell to −84 dBFS in digital silence makes the margin meaningless (clamp it); echo residue during
  our own playback can be learned as floor unless the tracker freezes while the mouth is live.

**Own-speech-relative gating** — precedent: WebRTC AGC2 `SpeechLevelEstimatorExperimentalImpl` [V]:
averages frame dBFS over **100 speech frames (1 s)** of runs ≥ 12 frames at VAD ≥ 0.95; once confident,
a block whose level is **< learned − 10 dB** (`kDefaultBackgroundSpeakerOffsetDbfs = 10.0f`) sets
`IsBackgroundSpeaker()` and is **not learned**. Field-trial-gated (not default) — an experiment, but it
is the only shipped code that names our home symptom. Because the reference is the owner's own level
*on the current route*, it is portable by construction and still a proximity rule.
- *Failure modes:* bootstrap (nothing learned at call start); poisoning if the first "speech" is the
  interferer (AGC2 guards with confidence + the offset test on every update); a route change mid-call
  invalidates the learned level (we know when it happens — the deck owns the route); a whispered turn
  > 10 dB under normal voice is rejected (same as today).

## 7. The numbers (with provenance)

| Knob | Value | From |
|---|---|---|
| Frame level | `20·log10(rms)`, clamp ≥ −90 dBFS | AGC2 `kMinLevelDbfs −90.31` [V] |
| Floor tracker period | 5 s (125 × 40 ms) | AGC2 `kUpdatePeriodNumFrames 500` (static_assert 2–15 s) [V] |
| Floor rise per period | energy `0.5·new + 0.5·old` | AGC2 `kAttack 0.5` [V] |
| Floor fall | instant | AGC2 [V] |
| Floor lower clamp | −84 dBFS ignored (AGC2); we'd clamp higher, ~−70 | AGC2 [V]; −70 is my judgement [U] |
| SNR margin (presence) | 3.5–4 dB | SpeechRecognition 1.5×, speex 2.5× power [V] |
| SNR margin (final corroboration) | **no shipped value**; 15–20 dB is my estimate from R76 §6's 15–60× near/far separation | [U — S4 must measure] |
| Own-speech learning | ≥ 12 × 10 ms at VAD ≥ 0.95; 1 s blocks; or leak τ ≈ 4 s speech | AGC2 [V] |
| Background-speaker offset | **10 dB** below learned speech | AGC2 experimental default [V] |
| Absolute sanity floor | −50 LUFS (pipecat) · −55 dB (open-webui) · −60 dB (Discord manual) | [V] |
| Car vs close-mic level | −5 dB nominal, ±4 dB | P.1100 SLR [V] |
| Chrome route step | +6 dB on the EC route | `helpers.cc` + R78 §3.4 [V] |

## 8. Open sweep (things not asked)

1. **Freeze the tracker while we are talking.** Echo residue and the ear-hold window are exactly
   when a naive min/EMA tracker learns wrong; AGC2 is fed post-AEC audio for the same reason. We already
   know `mouthLive`/`earHeld` — skip those frames. [V mechanism, U magnitude]
2. **Chrome NS converges over the first ~1–2 s** [U]; a floor sampled in the first second reads the
   *unsuppressed* noise and is too high. AGC2's first-period monotonic-min handles this for free (the
   floor keeps falling as NS converges).
3. **Frames-above-floor is a percentile test.** "≥ 200 ms of 40 ms frames above X" in an utterance of
   length L is "the (1 − 0.2/L) quantile of frame dB ≥ X". Stating the rule in dB relative to a
   reference (floor or own speech) is what makes it portable; the accrual length need not change.

---

## Implications for ctrl-b — ranked

*Evidence ages slowly, this section fast. Nothing decided. All three move the gate to dBFS first
(one `Math.log10` per frame in `useLiveCall`'s `onFrame`; the worklet is unchanged).*

**Not recommended, recorded:** setting `autoGainControl: true` on the clean route (it only adds the
same +6 dB, [V]); expecting AGC to normalise the car (Android has none, [V]); a bare "Speech" (Silero)
slider as the car dial — Silero is level-blind (R76 ④), it cannot hear the car any better.

### ① Own-voice-relative gate with a floor-relative lower bound — **needs no dial; optional 1 dial**
Track a noise floor (AGC2 min-tracker, 5 s, frozen while `mouthLive`/`earHeld`, reset on route
change). Learn the owner's speech level from the frames of **accepted** finals (1 s blocks or 4 s leak,
AGC2). Gate each final on frames ≥ `max(floor + 10 dB, speech − offset)` with **offset = 10 dB**
(AGC2). Seed the speech level per route from the last call on that route (a per-route value in the
existing settings seam), else start permissive at `floor + 10 dB`.
**Fixes:** car (learns the car's level after one turn; floor term admits the first), home interferer
(TV is > 10 dB under the owner's near voice). **Breaks:** whisper turns; a first turn that *is* the
interferer can poison the seed (guard: learn only from finals that also clear the floor term by
≥ offset). **Cost:** ~80–120 lines + tests in `useLiveCall`; one optional knob. **The one dial** =
`offset` in dB ("how far from my own voice counts"), default 10.

### ② SNR gate: dBFS + AGC2 floor tracker + margin — **needs one margin dial (probably)**
Gate on frames ≥ `clamp(floor + M, −60, −25) dBFS`, M default **15 dB** [U]. **Fixes:** car
(route-invariant margin over a low post-NS floor). **Breaks/misses:** a distant TV in a *quiet* room
(its SNR can exceed M); wind/road transients. **Cost:** ~40–60 lines. **Dial** = M, which the owner
would lower in the car and raise at home — which is precisely the manual toggling he asked to avoid.

### ③ Per-route absolute floors in dB — **needs calibration per route + a dB dial**
Keep today's rule; express the floor in dBFS; key it by route (speaker / clean / BT-HFP) and let the
in-call dial offset it ±dB. Seed: phone −24 dBFS (today's 0.06), HFP ≈ −30 [U]. **Fixes:** car, if
calibrated. **Breaks:** every new car/headset needs a calibration. **Cost:** smallest (~20 lines + a
per-route map in `LiveCfg`). A fallback if ①'s bootstrap proves fragile.

**What each extra control would buy:** a second dial (e.g. floor margin under ①) buys control over
non-stationary noise in the car — worth adding only if S4 logs show road/wind transients passing.
**Before any of it:** the S4 log line R76 §8 asked for, now in dB — per final: floor dBFS, median and
90th-percentile frame dBFS, route — on the phone at home and in the car. That settles M and the offset.

---

## What I could not determine

1. **Real per-route levels** on the owner's phone: car HFP, BT headset, wired — not measured anywhere;
   only SLR-derived estimates. The car's actual SLR is anywhere in 9–17 dB.
2. **Whether the owner's car negotiates mSBC or CVSD**, and whether Honor's HAL enables WBS.
3. **Whether the Honor 20 VOICE_COMMUNICATION / SCO input chain applies its own AGC or gain.**
4. **Discord's automatic-sensitivity algorithm** (only the SDK signature and a third-party
   description exist).
5. **Chrome NS convergence time** and its exact effect on the post-NS floor in a moving car.
6. **The dBov reference convention** behind "−26 dBov" (I used the G.191/sv56 "0 dBov = full-scale
   RMS" reading; the sine convention shifts it 3 dB).
7. **A shipped SNR margin for gating *finals*** — none exists in the reference class; the 15 dB above
   is an estimate.

## Primary sources

- WebRTC `4da20ad2280d`: `modules/audio_processing/agc2/{noise_level_estimator.cc, speech_level_estimator*.cc/.h, adaptive_digital_gain_controller.cc, agc2_common.h, agc2_testing_common.h}`, `api/audio/audio_processing.h`, `modules/audio_processing/audio_processing_impl.cc`, `modules/audio_processing/ns/ns_config.h`, `common_audio/vad/{vad_core.c, vad_core.h, vad_sp.c}`
- Chromium `e5554c0b194d`: `media/webrtc/helpers.cc` (`ConfigAutomaticGainControl`); R78 §3.4 for `media_stream_audio_processor_options.cc`
- Mumble `ee0546c974d5`: `src/mumble/{AudioInput.cpp, Settings.h, AudioWizard.cpp, AudioConfigDialog.cpp}`
- speexdsp `7a158783df74`: `libspeexdsp/preprocess.c`
- pipecat `4471fe83b337`: `src/pipecat/audio/{utils.py, volume.py, vad/vad_analyzer.py}`
- SpeechRecognition `8075e8f76acd`: `speech_recognition/__init__.py`
- AOSP android10-release: `system/bt` `ae35d7765dc6` (`btif/src/btif_hf.cc`, `bta/ag/bta_ag_cmd.cc`, `bta/ag/bta_ag_sco.cc`); `packages/apps/Bluetooth` `be6ecb1844a4` (`hfp/HeadsetStateMachine.java`)
- ITU-T P.1100 (03/2017) §8, §11.3.1, §11.3.4 — https://www.itu.int/rec/T-REC-P.1100
- Android 10 CDD §5.4.2, §5.4.4 — https://source.android.com/docs/compatibility/10/android-10-cdd
- W3C mediacapture-main (Editor's Draft, fetched 2026-09-24) — https://w3c.github.io/mediacapture-main/
- Discord Social SDK `discordpp::Call::SetVADThreshold` — https://discord.com/developers/docs/social-sdk/classdiscordpp_1_1Call.html
- [R] −26 dBov nominal: ETSI TR 103 138; ITU-T P.56 / G.191 practice. Discord auto-sensitivity description: windowsreport.com (third-party).
