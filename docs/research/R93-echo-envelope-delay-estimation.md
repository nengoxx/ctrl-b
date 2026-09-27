# R93 — envelope cross-correlation as browser-side output-lag + leak estimator

Date: 2026-09-27
Status: research dossier; ctrl-b source unchanged
Scope: judge G1(f) from `/home/emma/.cache/tmp/ctrlb-session48/DEBUG_PLAN.md` against WebRTC precedent, the measured car trail, a synthetic experiment, and browser cost.
Confidence vocabulary: VERIFIED = source/code/experiment checked here; REPORTED = credible secondary or product documentation, not independently source-verified; UNVERIFIED = plausible but not bought.

## Executive verdict

VERIFIED: the proposed statistic is cheap and physically meaningful, but it is not sound enough to become the ear-hold clock for this car path. The measured echo is only +1…+9 dB over a −20 dBFS floor, the observable is a 25 Hz amplitude envelope rather than the waveform, and syllabic repetition creates nearly equal false maxima. In the experiment below, a 4 s window was still wrong by more than 40 ms in 18.3% of trials at +5 dB and 44.3% at +1 dB; an 8 s window reduced those to 1.0% and 15.0%, but the +1 dB median peak/second-peak ratio was only 1.33. That is too much evidence and too little separation for a per-chunk safety decision. ⟦V: the +1…+9 dB premise is wrong — the −20 dBFS "floor" is the owner's Sensitivity PIN (`floorPinned:true`, EVIDENCE Fact 5), not the cabin. The trail's noise tracker reads −41…−44 dBFS and the single-frame level median in `thinking` is −36.6 dBFS, so the echo peaks (−11…−19) stand ≈ +17…+25 dB over the cabin. Re-run on real PocketTTS speech at that SNR, the envelope NCC is WRONG BY >40 ms IN 0 % OF TRIALS AT 2 s OVERLAP (7 % at 1 s). The verdict "not the clock in wave 1" survives, but for other reasons: chance peaks of a level-blind NCC, alignment complexity, and a known-signal chirp gets the same number more cheaply. See §V.⟧

REPORTED: WebRTC's delay estimators are precedent for correlating a known far-end reference with capture, but not for trusting one raw peak. They transform/condition the signal, search a bounded filter bank, aggregate candidates over time, and only expose a delay after reliability evidence. A 25 Hz envelope estimator can be a useful diagnostic/research seam and perhaps a conservative leak hint; it should not replace release-on-quiet plus the text self-echo backstop in the next ship.

Recommendation: ship release-on-quiet with a cap and the text backstop first. Keep envelope correlation behind instrumentation or an explicitly non-authoritative experiment. ⟦V: agreed. Add a one-per-call "connected" CHIRP matched filter as measure-only in wave 1, promoted to set the tail minimum after one car round (§V d).⟧ Do not let “no peak” release the ear until the fallback has independently decided that the tail is quiet.

## 1. Situation and premises

VERIFIED from the supplied evidence pack (`EVIDENCE.md`, lines 30–46): the car path is Bluetooth A2DP; the mic continues producing 40 ms frames while held; the loud reply arrives after the element has drained; observed echo peaks are −11…−19 dBFS, owner speech −14…−18 dBFS, and the car floor is about −20 dBFS ⟦V: wrong — −20 dBFS is the Sensitivity pin (`max_dbfs −20`, `floorPinned:true` at rel 37). The cabin noise is −41…−44 dBFS (the noise tracker, a minimum) and −36.6 dBFS (the single-frame median, `thinking` samples, n = 93). Recomputed from `prod-trail-raw.jsonl`⟧. The supplied trail gives an output-to-mic delay roughly 1.5–3.5 s from 1 Hz samples; the brief's per-call measurement is 3.2–4.0 s ⟦V: that span is drain → VAD stop, which includes Speaches' 700 ms `silence_ms`. The Opus audit timed the drop cue's own echo at +2.52…+2.71 s, giving an output lag of ≈ 2.25–2.45 s. The reply's echo ends 2.34–2.66 s after drain in 7 of 8 replies, one at 3.26 s (DEBUG_PLAN I1; R91 §1.6 has 2.54–3.46 s by its coarser rule)⟧. A level gate cannot distinguish the two speakers.

VERIFIED from `DEBUG_PLAN.md` §G1(f): the proposal is decoded played PCM → 25 Hz envelope, rings of played/mic envelopes, normalized correlation over 0–6 s in 40 ms steps, then a leak decision and shifted mouth timeline. The plan itself already names drift, adjacent chunks, below-floor echo, and fallback-to-quiet as debt.

Important distinction: correlation can estimate that some capture resembles a recent playback signature. It does not prove that the current capture is only echo, nor that the lag is stable for the next chunk.

## 2. Precedent: WebRTC AEC delay estimation

### 2.1 Legacy WebRTC binary delay estimator

VERIFIED at WebRTC source commit `7946b546db74d0af2badd1002eaab01ed837b194`, files `webrtc/modules/audio_processing/utility/delay_estimator.h`, `delay_estimator.cc`, `delay_estimator_wrapper.cc` (Gitiles mirror):

- The API explicitly says it estimates delay between “binary far-end and binary near-end spectra”; the far-end binary spectrum is added to history before the near-end spectrum is processed (`delay_estimator.h`, lines 195–213).
- The wrapper thresholds each spectrum bin against a recursively estimated mean, then packs bins 12 through 43 into a 32-bit binary word (`delay_estimator_wrapper.cc`, lines 20–23 and 81–89). This is not an RMS-envelope correlation.
- The comparison is Hamming/bit-count based: the implementation compares a near-end binary word to every row of the far-end history and counts matching bits (`delay_estimator.cc`, lines 51–73).
- Reliability is layered. The legacy source requires more than 10 consecutive candidate hits and a histogram value above `1.5`; robust validation combines instantaneous and histogram validation, with an exception only when the histogram is significantly stronger (`delay_estimator.cc`, lines 150–214 and 217–257). The header exposes a quality value in [0,1], not a single universal “correlation > X” rule (`delay_estimator.h`, lines 227–234).

REPORTED/UNVERIFIED on the exact historical framing: the old AEC source's block constants are commonly described as 64 ms binary-spectrum updates in the WebRTC literature and the brief's source target names that scale. The checked wrapper proves the spectral binary comparison and history search, but this checkout did not include the old AEC build's `PART_LEN` definition at the same path, so I do not claim a newly source-verified 64 ms number here. ⟦V: the number is 64 SAMPLES, not 64 ms. `#define PART_LEN 64 // Length of partition` (`aec_core.h:35` at `7946b54`) is 4 ms at 16 kHz, and `kHistorySizeBlocks = 125` is commented "500 ms for 16 kHz" (`:73-77`). The legacy estimator's whole search span was 0.5 s⟧ The important contrast survives: spectral binary features, not envelope samples; temporal aggregation, not one peak.

### 2.2 AEC1 normal and extended/delay-agnostic ranges

VERIFIED from the WebRTC Gitiles source search result and the AEC source mirror at commit `f832a6d0903179914c1dbda2a43172206d9e1daa` / historical AEC files:

- `kNormalNumPartitions = 12`.
- `kExtendedNumPartitions = 32`.
- `kMaxDelayBlocks = 60` and `kLookaheadBlocks = 15`.
- The history size is normally max delay plus lookahead; the Android branch is documented as 125 blocks, corresponding to the 500 ms limit for 16 kHz ⟦V: at `f832a6d` it is `#ifdef WEBRTC_ANDROID` (`aec_core_internal.h:35-40`). At `7946b54` 125 is unconditional (`aec_core.h:73-77`). The blocks are 4 ms, so 60 blocks = 240 ms⟧.
- The old AEC has a `delay_agnostic` mode and uses the extended filter when the system delay is not trusted. The extended filter is therefore a longer adaptive search/filter budget, not a claim that a single correlation maximum is reliable.

Sources:
- https://webrtc.googlesource.com/src/+/f832a6d0903179914c1dbda2a43172206d9e1daa/webrtc/modules/audio_processing/aec/aec_core_internal.h
- https://chromium.googlesource.com/external/webrtc/+/6c9b65ab3854a41ee67b9f9f76c0dc70f42b72df/webrtc/modules/audio_processing/aec/aec_core.cc

The old AEC's 60-block maximum is not a reason to copy 0–6 s into ctrl-b: it is a filter/history design tied to its block size and adaptation loop. The car's measured multi-second delay is outside that legacy range, which is precisely why a browser-side diagnostic would be novel for this use case.

### 2.3 AEC3 MatchedFilter and EchoPathDelayEstimator

VERIFIED at current WebRTC source commit `6cf6bcb585b31414aac02377df2bc8fec770d0e8`, files:
- `modules/audio_processing/aec3/echo_path_delay_estimator.{h,cc}`
- `modules/audio_processing/aec3/matched_filter.{h,cc}`
- `modules/audio_processing/aec3/matched_filter_lag_aggregator.{h,cc}`
- `modules/audio_processing/aec3/aec3_common.h`
- `api/audio/echo_canceller3_config.h`

Signal and resolution:

- AEC3 receives a downsampled render reference and a capture block. `EchoPathDelayEstimator::EstimateDelay()` mixes/decimates capture, then calls `MatchedFilter::Update(render_buffer, downsampled_capture, ...)` (`echo_path_delay_estimator.cc`, lines 66–80).
- AEC3's base block is 64 samples at 16 kHz = 4 ms (`aec3_common.h`, lines 35–49). Default `down_sampling_factor = 4`, so the matched filter operates on 16-sample/1 ms sub-blocks ⟦V: 16 samples at the DECIMATED 4 kHz = 4 ms sub-blocks (`kBlockSize` 64 at 16 kHz, `kNumBlocksPerSecond = 250`, `aec3_common.h:27,47-49`). The lag grid is one 4 kHz sample = 0.25 ms⟧ (`echo_canceller3_config.h`, lines 38–54; constructor lines 31–46 in `echo_path_delay_estimator.cc`). This is waveform-domain adaptive matched filtering, not an envelope-only correlation.
- The default matched-filter layout is 5 filters, each 32 sub-blocks, with a 24-sub-block alignment shift (`aec3_common.h`, lines 51–54; default config lines 42–54). `MatchedFilter::GetMaxFilterLag()` is `5*24*16 + 32*16 = 2432` downsampled samples, 608 ms at 4 kHz. This is the default AEC3 matched-filter search headroom, not a 6 s search.
- Default `delay_headroom_samples = 32`, i.e. 2 ms at 16 kHz; the aggregator subtracts the downsampled headroom before histogramming (`echo_canceller3_config.h`, line 45; `matched_filter_lag_aggregator.cc`, lines 44–52 and 81–90).
- AEC3's `delay_candidate_detection_threshold` defaults to 0.2. That threshold gates matched-filter candidate detection; it is not the final reliability declaration ⟦V: its meaning is an explained-energy test. A filter's lag counts only when `error_sum < matching_filter_threshold_ * error_sum_anchor` (`matched_filter.cc:724-726`), i.e. the delayed render predicts ≥ 80 % of the capture block's energy. It is also excitation-gated (`x2_sum > x2_sum_threshold`). That is the principled "leak" test the proposal lacks⟧ (`echo_canceller3_config.h`, lines 48–54).

Reliability:

- The lag aggregator keeps a histogram of candidates over a 250-entry history. Default selection thresholds are `initial = 5` and `converged = 20` (`echo_canceller3_config.h`, lines 50–54; `matched_filter_lag_aggregator.h`, lines 78–99).
- It reports a coarse estimate after the initial threshold and a refined estimate after the converged threshold. A candidate is marked significant once its histogram exceeds the converged threshold (`matched_filter_lag_aggregator.cc`, lines 81–97).
- The estimator also requires repeated consistency: `EchoPathDelayEstimator` resets its internal state after more than half a second of identical estimates (`kNumBlocksPerSecond / 2`, `echo_path_delay_estimator.cc`, lines 108–118). ⟦V: misread. The call is `Reset(false, false)` (`:116-117`), which re-arms only the adaptive matched filter. It keeps the lag aggregator's histogram AND the delay confidence. It is a re-adaptation mechanism, not a consistency requirement. Note the scale too: the aggregator's 250-entry history is 250 × 4 ms = 1 s, and `initial 5` / `converged 20` hits = 20 / 80 ms of reliable blocks. AEC3's reliability comes from WAVEFORM information (processing gain), not from seconds of integration⟧
- The matched filter gates on excitation energy and updates an adaptive filter rather than simply maximizing normalized covariance (`matched_filter.cc`, lines 144–165 and the corresponding SIMD cores). AEC3's “reliable” means repeated, histographically supported, excited adaptive-filter evidence.

VERIFIED implication: the proposal's `peak above threshold => LEAK` is materially weaker than both generations of WebRTC precedent. It has no persistence requirement, excitation test, candidate histogram, drift model, or double-talk test. ⟦V: true, but the transferable lesson is the SIGNAL. AEC3 matches a known reference waveform, where a few ms of excitation carry the evidence. The closest cheap analogue for a browser is a known test signal (a chirp) matched-filtered against the mic PCM the main thread already receives. A 25 Hz envelope of arbitrary speech is not that analogue (§V b)⟧

## 3. Envelope-correlation math and experiment

### 3.1 Resolution and overlap

VERIFIED: a 25 Hz envelope can only select a lag on a 40 ms grid. Without interpolation, the quantization error alone is ±20 ms for a correctly selected isolated maximum. A parabolic interpolation around the peak could produce a finer-looking number, but it cannot recover information removed by 40 ms RMS windows and should not be sold as ±40 ms physical accuracy.

Normalized correlation used in the experiment:

`r[k] = ((p - mean(p)) · (m[k:] - mean(m[k:]))) / (||p - mean(p)|| ||m[k:] - mean(m[k:])||)`

where `p` is the played envelope and `m` is the mic envelope at candidate lag `k`. Search was 0–6 s in 40 ms steps, true delay 3.50 s, and 300 trials per cell. The generator was an AM-noise/TTS-like envelope with 3.5–4.5 syllabic pulses per second, phrase-scale modulation, random fine variation, a −20 dBFS stationary floor, echo 1/5/9 dB above that floor, and 2:1 dynamics compression. No owner speech was mixed into this baseline; double-talk is assessed separately below.

The script and raw result are in the scratch folder used for this pass ⟦V: that folder was deleted at clean-up (`ctrlb-session48/` has no `r93/`), so these numbers cannot be reproduced. The definition of "echo X dB above floor" (peak or mean?) and the compression stage (waveform or envelope?) are not recoverable. §V re-derives them on real TTS speech⟧:
- `envelope_experiment.py`
- `experiment-results.csv`

VERIFIED experiment results (median absolute lag error; p90 error; median peak; median peak/second-peak ratio; percentage with error >40 ms). The second peak excludes the winning bin and its two neighboring bins, so the ratio is not just adjacent-bin interpolation noise.

| Echo above floor | overlap | median error | p90 error | median peak | peak/2nd peak | >40 ms |
|---:|---:|---:|---:|---:|---:|---:|
| +1 dB | 1 s | 1440 ms | 2604 ms | 0.575 | 1.147 | 89.7% |
| +1 dB | 2 s | 1520 ms | 2480 ms | 0.416 | 1.138 | 75.7% |
| +1 dB | 4 s | 40 ms | 2480 ms | 0.320 | 1.181 | 44.3% |
| +1 dB | 8 s | 0 ms | 1200 ms | 0.287 | 1.330 | 15.0% |
| +5 dB | 1 s | 1460 ms | 2524 ms | 0.630 | 1.143 | 81.7% |
| +5 dB | 2 s | 1240 ms | 2640 ms | 0.503 | 1.157 | 61.3% |
| +5 dB | 4 s | 0 ms | 1524 ms | 0.439 | 1.314 | 18.3% |
| +5 dB | 8 s | 0 ms | 40 ms | 0.421 | 1.634 | 1.0% |
| +9 dB | 1 s | 1340 ms | 2480 ms | 0.683 | 1.145 | 73.3% |
| +9 dB | 2 s | 0 ms | 2240 ms | 0.620 | 1.262 | 30.3% |
| +9 dB | 4 s | 0 ms | 0 ms | 0.594 | 1.576 | 3.0% |
| +9 dB | 8 s | 0 ms | 0 ms | 0.588 | 1.854 | 0.0% |

Interpretation: 1–2 s is not enough. Four seconds is conditionally useful only when the echo is not near the floor; eight seconds is the first robust region at +5 dB, but +1 dB remains an unsafe tail. These are synthetic results, not a device acceptance claim. The model is optimistic in one respect (stationary additive noise is simple) and pessimistic in another (the deliberately self-similar syllabic envelope creates realistic false peaks). It does not model all Bluetooth buffering or room reverberation.

### 3.2 Published envelope precedent

REPORTED: a DAGA 2018 paper describes recursive cross-correlation and peak detection for propagation-delay estimation of speech/music, explicitly warning that periodic/tonal components create secondary peaks. It uses waveform/frequency-domain correlation, not specifically a 25 Hz RMS envelope.

Source: https://pub.dega-akustik.de/DAGA_2018/data/articles/000144.pdf

REPORTED: the published smart-home/device-directed-speech literature defines a known playback reference `r`, a captured mixture `y = Γ(r) + u`, and treats barge-in as the target signal in the presence of playback. This supports “known playback reference matters,” but the cited system is a classifier/AEC problem, not a browser envelope delay clock.

Source: https://arxiv.org/html/2111.10639v4

REPORTED: a voice-AI industry article recommends a known TTS reference plus AEC and says residual speech after cancellation can be classified as interruption; it also recommends ducking when barge-in is not required. This is secondary product guidance, not a primary implementation source.

Source: https://www.coval.ai/blog/voice-ai-echo-cancellation

UNVERIFIED/negative finding: I found no primary public Alexa, Sonos, or comparable voice-agent implementation that says it uses a normalized RMS-envelope correlation to time browser/client mic mute. Public smart-speaker material discusses AEC, reference signals, and barge-in, but not this proposed estimator. Do not present “Alexa does this” or “Sonos does this” as precedent.

## 4. Failure modes and policy

| Failure mode | Estimator report | Policy |
|---|---|---|
| A2DP re-buffering / lag drift | Peak moves between 40 ms bins, broadens, or splits; a stale ring can select the old lag. | Re-estimate continuously but never move the authoritative hold backwards on one sample. Require several consistent estimates; on disagreement use release-on-quiet. Log drift rather than chasing it. |
| Two chunks close together | A global ring can match the mic to chunk A while chunk B is the current mouth, or choose the stronger/repeated chunk. | Keep chunk IDs and element start/end times. Score only candidates whose played interval is causally compatible with the mic window; if two candidates are plausible, mark ambiguous and use fallback. Never let “some old chunk correlates” extend the current hold indefinitely. |
| Owner talks over echo | The mic envelope is a sum/max-like mixture. If owner speech is independent, it lowers correlation; if it has similar syllabic timing, it can create a false winner. | Correlation must not authorize release during a known reply tail. Treat double-talk as “inconclusive,” keep the hold, and let the text backstop/fallback decide. This is the barge-in case, not a leak proof. |
| Reply under 1 s | Too few envelope samples; periodic peaks and lag-edge effects dominate. | No estimator decision. Use release-on-quiet plus a cap, or the safe whole-reply hold. |
| Quiet reply / headphones | A weak or absent echo can produce a random peak that still exceeds a raw threshold because normalized correlation ignores absolute level. ⟦V: measured. With no echo at all, the best-of-151-lags NCC reaches p99 0.67 (2 s) / 0.56 (4 s) / 0.40 (8 s) on noise, and 0.77 / 0.60 / 0.42 with the owner talking⟧ | Require an independent absolute leak-energy test above the learned floor and a correlation-quality margin. If either is missing, “inconclusive,” not “nothing leaks”; fallback policy remains authoritative. |
| DC offset / fixed gain / AGC | A constant DC component is removed by mean subtraction but can contaminate RMS if the envelope is made before DC removal. Fixed gain changes level, not normalized shape; adaptive gain/compression changes shape and can reduce peak separation. | High-pass/DC-remove before RMS; use a level-independent correlation only as a secondary feature. The supplied R83/R84 premise is treated as VERIFIED context: Chrome Android has fixed +6 dB in this path and no adaptive AGC. ⟦V: not in THIS path. Chrome forces AGC OFF when EC is off (R83 §4, `media_stream_audio_processor_options.cc:639`). The car call ran `route: media`, `ec:false`, so there is no gain stage at all. The fixed +6 dB (AGC2, adaptive off) applies only on `call`. `noiseSuppression: true` IS on (`pcmCapture.ts:82`), which the dossier does not treat. WebRTC NS is non-linear and adapts to stationary components, so it reshapes the mic envelope (§V b)⟧ Do not tune a correlation threshold against that one gain. |
| Delay outside 0–6 s | No peak is found even if the car leaks. | Do not release on no peak. Fall back and log `lag_out_of_range`/`inconclusive`. |

The original proposal's rule “no peak ⇒ nothing leaks (do not hold)” is therefore unsafe. It turns the estimator's least-informed result into the most permissive action.

## 5. Browser cost and implementation hazards

VERIFIED arithmetic: 150 lags × 250 samples = 37,500 multiply/add pairs per evaluation, or about 75,000 scalar samples for two arrays. Even at every 500 ms this is small compared with audio decoding and ordinary mid-range Android work. A Worker is not needed for this arithmetic; a worklet is attractive only if the ring already lives there. Main-thread evaluation at chunk boundaries or 500 ms cadence is the least complex starting point, provided it does not copy large PCM buffers repeatedly.

UNVERIFIED device performance: no mid-range Android benchmark was run in this pass. The acceptance test should measure decode latency and missed UI/audio deadlines on the actual phone, not infer it from operation count.

VERIFIED API constraint from MDN: `BaseAudioContext.decodeAudioData()` accepts complete file data, not arbitrary fragments, and resamples the decoded `AudioBuffer` to the context's rate.

Source: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData

For this app, the held WAV bytes are the good input. Use the held complete bytes (`blob.arrayBuffer()` or the original `ArrayBuffer`) once. Do not decode a chunk while it is still arriving, and do not assume an object URL itself is an `ArrayBuffer`; fetch the URL or use the already-held bytes. Treat the input buffer as transferable/consumable by the implementation: keep a copy if the playback path still needs the same buffer. Revoke object URLs only after the element is done with them. A second decode is unnecessary if playback is already being done from the same decoded PCM; with the current HTMLAudioElement path, the proposal's one extra decode per 3–10 s chunk is the expected cost.

The bigger cost is correctness complexity: joining decoded chunk envelopes to the element timeline, handling synthesis gaps, preserving chunk IDs, and deciding what a weak/ambiguous result means. The 37,500 operations are not the reason to reject it; the evidence and policy semantics are.

## 6. Ship numbers and trail evidence

### What I would ship now

- 25 Hz / 40 ms RMS frames, with DC removal before RMS.
- Release-on-quiet as the authoritative tail rule: quiet qualification around 700–1000 ms, with a cap at least 4.5 s for this car's observed 3.2–4.0 s path ⟦V: the lag is ≈ 2.3–2.45 s and the audible end ≤ 3.46 s after drain. R91's ruled rule stands: noise floor + 10 dB (NOT the effective floor, which sits at the pin) for 700 ms, cap 5 s (DEBUG_PLAN J3)⟧. The exact cap remains a device-round calibration knob.
- Text self-echo backstop in the post-drain window, around the existing planned fuzzy containment threshold (~0.6) ⟦V: R91 §3.4/§6 measured the gap on this call (genuine ≤ 0.538, echo ≥ 0.946) and ruled 0.75 with punctuation stripped and a < 10-char exemption⟧, as a belt rather than the clock.
- No “no correlation means release” branch.

These values are policy starting points, not field-verified new measurements.

### If the research seam is instrumented

- 25 Hz envelopes; search 0–6 s in 40 ms bins.
- Do not evaluate a 1 s reply as an estimator candidate; require at least 4 s of usable overlap to report anything, and label 4 s “weak.” Prefer 8 s accumulated evidence for a stable estimate.
- Candidate diagnostic threshold: normalized peak ≥0.50 ⟦V: too low. On NO-echo input (noise only, or the owner talking on headphones), the chance maximum of NCC over 151 lags has p95 0.50–0.54 and p99 0.56–0.60 at 4 s. At 2 s it is p99 0.67–0.77. The leak peak at the measured SNR is ≈ 0.90. Use ≥ 0.75 at ≥ 4 s of overlap (§V a)⟧, absolute mic energy above the learned floor, peak/second-peak ratio ≥1.5, and three consecutive compatible evaluations. These are deliberately conservative research gates, not a claim that they pass the +1 dB case; the experiment says that case still needs the fallback.
- Hangover after the last confidently matched playback: at least 800 ms, then release-on-quiet/cap remains in force.

### Trail events needed in the next car round

For every played chunk, record:

- `chunk_id`, byte length, decoded duration, element timeline start/end, and actual `playing`/`ended`/`drained` timestamps;
- envelope frame timestamps and peak/RMS statistics while held, with the effective floor and fixed-gain context;
- estimator evaluation: candidate window, lag, normalized peak, second peak, ratio, overlap seconds, absolute mic level, candidate chunk ID, and reason (`accepted`, `weak`, `ambiguous`, `out_of_range`, `no_energy`, `drift`);
- the chosen policy source (`mouth`, `estimator`, `quiet`, `cap`, `text_echo`) and every hold/release edge;
- speech segment ID, speech start/stop/final times, transcript, energy verdict, and whether it was dropped as post-drain text echo;
- a lag-drift series, not only the final lag, so A2DP re-buffering is visible;
- a privacy-safe hash or short ID for chunk association, not raw audio in the trail.

The decisive car-round result is not “the estimator found 3.5 s once.” It is: across several replies, no owner speech is sent during a still-audible echo tail, no genuine owner speech is suppressed after the tail, and every accepted estimate agrees with the independently visible acoustic arrival within the 40 ms grid plus the chosen hangover.

## 7. What I could not determine

- I could not verify a primary Alexa, Sonos, or equivalent product implementation using envelope correlation specifically to time mic mute.
- I could not buy a real freely usable speech clip in this pass; the experiment uses synthetic AM noise with syllabic structure instead.
- I did not run the estimator on an actual recorded car WAV or measure the browser decode/correlation wall time on the target Android phone.
- I did not verify the old AEC source's 64 ms binary-spectrum block size from the same historical checkout; I verified its binary spectral representation, history comparison, and reliability logic, and recorded the 64 ms framing as REPORTED rather than VERIFIED here.
- I could not determine how often the car head unit re-buffers or drifts during one reply from the existing 1 Hz trail; the next round's lag series must answer that.
- I could not establish a universal normalized-correlation threshold. The synthetic +1 dB case remains unsafe even with 8 s, and codec/DSP/reverberation can change envelope shape in ways this experiment does not cover.

what I could not determine
## V. Opus 5.5 verification pass (2026-09-27)

Method: I re-read the sources behind every VERIFIED claim that bears on a design decision:
- WebRTC `main` at `6cf6bcb` for AEC3; `7946b54` and `f832a6d` for the legacy AEC and delay estimator (googlesource `?format=TEXT`).
- Oboe `503147e` (OboeTester `LatencyAnalyzer.h`), Ardour `460ea8c` (`libs/ardour/mtdm.cc`), jack-example-tools `1f87b60` (`tools/iodelay.cpp`) and the W3C Web Audio `index.bs` at `cb8b688`.
- ctrl-b `main` @ `a517da9`: `pcmCapture.ts`, `pcmWorklet.ts`, `callCue.ts`, `audioController.ts` and `config.py`.
- The prod trail, recomputed.

I re-ran the experiment on **real speech**: 8 of the call's own Lynette replies, synthesized by the running PocketTTS unit (voice `nova`, 24 kHz float32, ≈ 130 s), chunked with 0.25–0.6 s gaps. The car path was modelled as follows:
- band-pass 150 Hz–6.5 kHz;
- a cabin reverb with RT60 0.12 s;
- a **waveform** 2:1 compressor (5 ms attack, 100 ms release);
- a delay of 2.35 s plus a random sub-frame offset;
- echo scaled to a 40 ms-frame p95 of −13 dBFS;
- car noise: brown plus pink, ±3 dB slow drift.

For double-talk, the owner was modelled with human voice-reference clips. Chrome NS is not modelled. Script: `r93v/exp.py`, `chirp.py`, `onset.py` (deleted at clean-up with the lane; the numbers are quoted here).

### V.a Claims re-verified

| Claim | Maya | Finding | Source |
|---|---|---|---|
| Car floor ≈ −20 dBFS; echo +1…+9 dB over it | VERIFIED (from the brief) | **WRONG.** −20 is the Sensitivity pin. Cabin noise: −41…−44 (tracker) and −36.6 (frame median). The echo is ≈ +17…+25 dB over the cabin. Matches DEBUG_PLAN L2 (R92v: noise median −42) | trail `sample` rows (n = 296); EVIDENCE Fact 5 |
| Lag 3.2–4.0 s | VERIFIED | Superseded. Lag ≈ 2.25–2.45 s; echo end 2.34–2.66 s after drain (7/8) | DEBUG_PLAN I1 / R91 §1.6 |
| Envelope NCC error rates (her table) | VERIFIED (synthetic) | **Replicates at +1 dB only.** Real speech, same premise, 4 s / 8 s >40 ms: +1 dB 44.3 % / 20.7 % (hers 44.3 / 15.0); +5 dB **3.0 % / 0.3 %** (hers 18.3 / 1.0); +9 dB 2 s **2.7 %** (hers 30.3). Her AM-noise envelope is pessimistic. Unreproducible: script deleted | re-run, 300 trials/cell |
| **Same statistic at the MEASURED SNR** | — | noise −36.5 / echo −13, >40 ms: 1 s **7 %**, 2 s **0 %**, 4 s 0 %, 8 s 0 %; peak NCC ≈ 0.90; ratio (±5-bin exclusion) 1.7 / 2.4 / 3.1. Busy road (noise −31.6 / echo −19): 10.3 % / 0 / 0 / 0. Owner talking over the WHOLE window at −16: 51.7 / 14.7 / **1.3** / 0 %. A dB (log) envelope is uniformly worse than linear RMS (e.g. 21 % at 1 s) | re-run |
| "No peak / chance peak" risk | VERIFIED (qualitative) | **Quantified.** Chance max-NCC on no-echo input (noise-only, then noise + owner) at 2 / 4 / 8 s: p99 0.67 / 0.56 / 0.40 and 0.77 / 0.60 / 0.42. Her ≥ 0.50 gate would fire on ≈ 5 % of headphone windows at 4 s | re-run, 300 trials |
| Legacy estimator: binary spectra, bins 12–43, bit-count, 10 hits / 1.5 histogram | VERIFIED | Confirmed. One nuance: it XOR-counts **differences** (the minimum wins) | `delay_estimator_wrapper.cc:20-23`; `delay_estimator.cc:24-38, 51-73` |
| "64 ms blocks" | REPORTED | **Wrong in the brief.** 64 samples = 4 ms; history 125 blocks = 0.5 s | `aec_core.h:35, 73-77` |
| AEC3 max lag 608 ms; headroom 32; thresholds 0.2 / 5 / 20 | VERIFIED | Confirmed, but the sub-blocks are 4 ms (not 1 ms). The 0.2 threshold = the "render explains ≥ 80 % of capture energy" test | `aec3_common.h:27,47-54`; `echo_canceller3_config.h:42-54`; `matched_filter.cc:724-726` |
| AEC3 "requires repeated consistency" | VERIFIED | **Misread.** `Reset(false,false)` re-arms the filter and keeps the histogram and confidence. Converged = 20 × 4 ms blocks in a 1 s history | `echo_path_delay_estimator.cc:108-117`; `matched_filter_lag_aggregator.cc` Aggregate |
| Fixed +6 dB AGC "in this path" | VERIFIED (from R83) | **Wrong path.** On `media`/`ec:false` Chrome forces AGC off. NS is on | R83 §4; `pcmCapture.ts:81-82` |
| `decodeAudioData`: complete files only, resampled | VERIFIED | Confirmed. The spec also **detaches** the input `ArrayBuffer` | MDN; `index.bs:1243-1248` |
| Arxiv 2111.10639 | REPORTED | Confirmed as a neural implicit-AEC paper for KWS/device-directed speech with a playback reference. It is not a delay clock | arxiv abstract |

### V.b What was missed

1. **The brief's SNR premise is itself the defect.** EVIDENCE Fact 5 names the −20 as the pin, and R91 §1.6 already had the −40.9 noise estimate. The dossier inherited the brief's number instead of checking it, and every threshold and verdict sentence in §3 and the executive summary is built on it.
2. **The mic PCM is already on the main thread.** The worklet posts every 40 ms frame's pcm16 bytes alongside its RMS (`pcmWorklet.ts` `emit()`), and held frames still arrive (`pcmCapture.ts` header, D76 §B.1). The estimator is **not** limited to a 25 Hz envelope. Two things follow:
   - a waveform matched filter (AEC3's own domain) costs no new capture plumbing;
   - the WAV chunks (PocketTTS returns IEEE-float 24 kHz, confirmed by `file`) can be parsed without `decodeAudioData`, though other TTS services default to `chunk_format: opus` (`config.py:971`) and would need the decode.
3. **The known-test-signal alternative (a chirp).** She never weighed it, and the precedent is all of this kind:
   - WebRTC AEC3 matches the far-end **waveform** (`echo_path_delay_estimator.cc:66-80`) and reaches `converged` after 20 reliable 4 ms blocks.
   - OboeTester's round-trip latency test plays a 500 ms random Manchester-coded pulse (`kPulseLengthMillis = 500`, `kFramesPerEncodedBit = 8`). It finds the lag by normalised cross-correlation and rejects a result under confidence 0.2 (the pulse analyzer) / 0.5 (the default) (`LatencyAnalyzer.h:233-295, 720-722, 729, 795-797, 806`). Its search cap is `kMaxLatencyMillis = 1000 // arbitrary and generous` (`:58`), so it must be widened for a car.
   - jack_iodelay and Ardour's calibration use Adriaensen's MTDM: 13 continuous tones (4096 … 3841 Hz scaled), phase-resolved. It reports "Signal below threshold", flags `_err > 0.2` as "??", and retries inverted polarity at > 0.3 (`mtdm.cc:35-47`; `iodelay.cpp:248-263`).
   - BeepBeep (Peng et al., SenSys 2007) ranges between COTS phones with 1–6 kHz LFM chirps and **sample counting on its own recording**, which cancels the unknown playback/record pipeline latency. REPORTED from the paper's abstract.
   - All of these are dedicated test signals. None is an envelope of arbitrary programme material.
4. **Chirp numbers, measured in the same model.** The template was a 150 ms linear 1→3 kHz chirp, peak 0.15 (−19.9 dBFS RMS, the drop cue's level), arriving at −19 dBFS frame peak. Detection used a local normalised cross-correlation at 16 kHz.
   - Hit NCC median: 0.87 at the measured noise; 0.61 at the brief's −20; 0.40 at −15 dBFS rumble; 0.58 under **broadband white at −15 dBFS**; 0.71 with the owner talking over it.
   - Null (no-return) max: 0.07–0.13.
   - Detection 100 % in every condition. Lag error p99 ≤ 0.12 ms.
   - The existing 440 Hz sine cue is weaker under double-talk: null max 0.43 vs a 0.90 hit, and envelope-z detection 83 %. Voiced speech shares its harmonics, so a sweep, not a sine, is the right probe.
5. **A free passive estimator: the reply's onset edge.** The first mic frame 10 dB over the noise, held for 3 frames (120 ms), after `playbackStarted`, minus the chunk's own first active frame:
   - measured noise: median error 14 ms, p90 36 ms;
   - busy road: 6 % > 120 ms;
   - −20 dBFS noise: always misses, because the threshold then sits above the echo.

   This is R91 §6 ③'s `onsetLagMs`. It can re-verify the chirp's lag on every reply at no cost, as long as the owner is silent in the lead window.
6. **Cold-link and path-offset risks** (UNVERIFIED on device):
   - An A2DP stream that idles between replies may suspend. The head unit may then fade in or clip its first hundreds of ms, and the lag may re-settle.
   - The element's AAudio stream and the capture context's stream have different buffers. The Opus audit found the same lag on both at VAD resolution (±0.1 s) only.
7. **Drift evidence exists.** 4 of 6 observable cues returned within +2.52…+2.71 s across a 5-min call, and the replies' echo ends cluster at 2.34–2.66 s with one 3.26 s. The lag looks stable to ±0.2 s with one excursion, and that excursion is why the text backstop stays.
8. **Tap-interrupt (I7).** A known L also bounds the post-kill hold, since `pause()` cannot recall ~2.3 s already sent to the car.

### V.c What was misread
- The +1…+9 dB SNR (the pin taken for the noise floor), and the 3.2–4.0 s lag (drain → VAD stop).
- AEC3's half-second reset read as a consistency requirement.
- 1 ms sub-blocks (they are 4 ms).
- "64 ms blocks" left as REPORTED when the source says 64 samples.
- AGC +6 dB applied to the `media` path.
- The ≥ 0.50 diagnostic gate, which sits inside the chance-peak distribution.
- A 4.5 s cap and a 0.6 text threshold that contradict R91's measured and ruled 5 s and 0.75.

Her qualitative calls stand:
- "no peak ⇒ release" is unsafe;
- double-talk ⇒ inconclusive;
- short replies ⇒ no decision;
- the arithmetic cost is negligible.

### V.d Re-judged recommendation

The options, ranked on the corrected facts:

1. **Envelope estimator as the clock:** still NO for wave 1. Statistically it is now sound: 0 % gross error at ≥ 2 s on this car. But it costs:
   - per-chunk decode and element-timeline alignment;
   - chunk-ID bookkeeping across synthesis gaps;
   - a level-blind statistic whose chance peaks reach 0.6–0.77 at the window lengths a short reply offers.

   It gives the same number a chirp gives in one shot. Keep it as trail-only instrumentation, logging lag, peak and second peak per reply at ≥ 4 s overlap with a 0.75 gate. That makes it a drift monitor if ever needed.
2. **Chirp self-calibration:** SOUND as the setter of the tail's minimum, provided it follows the rules below.
   - **Monotone-safe.** It can only LENGTHEN the hold, never shorten it below R91's rule. No return (headphones, muted car, clipped cold link) ⇒ R91's default rule, never "no hold".
   - **Deterministic release when calibrated.** Release at drain + L + 300 ms (car cabin RT60 ~0.1 s plus the ear's onset slack). This is better than quiet-release because it cannot eat an owner who starts talking at the echo's end. That clipping is exactly the one weakness R91 §6 concedes.
   - **The cap and the text backstop remain.** The cap stays 5 s, or L + 2 s when calibrated.
   - **Numbers.** Two chirps as the call's "connected" earcon: a 150 ms 1→3 kHz up-sweep, then 400 ms later a 3→1 kHz down-sweep, 10 ms raised-cosine ramps, peak 0.15. Search 0–6 s (R91 §1.5 cars 1–3 s, some 6 s). Accept only when:
     - the local NCC is ≥ 0.35 for both chirps (null ≤ 0.13, hit ≥ 0.40 even at −15 dBFS);
     - the peak is ≥ 3× the second peak outside ±20 ms;
     - the two lags agree within ±10 ms.
   - **Timing.** Schedule on the capture `AudioContext` and stamp worklet frames with the context's own sample clock: `currentFrame` in the posted message, a one-field addition. That makes it one clock with no `performance.now` jitter.
   - **Cost.** Direct NCC at 8 kHz ≈ 6×10⁷ MACs once per call, or an `OfflineAudioContext` `ConvolverNode` with the reversed chirp (native FFT) [U: `normalize = false` needed].
   - **Failure modes** and what the policy does:

     | Failure | Policy |
     |---|---|
     | Headphones: no return | Correctly uncalibrated |
     | Masked by cabin noise | Survives −15 dBFS broadband in the model |
     | Owner talks over it | Local NCC 0.71 vs null ≤ 0.13 |
     | AGC | None on `media`; a fixed gain on `call`, NCC-invariant |
     | NS | A 150 ms sweep is non-stationary and passes [U on device] |
     | Cold link | The two-chirp agreement rejects a clipped first chirp. The first also warms the link |
     | Drift | Each reply's onset edge re-checks L; a disagreement > 150 ms twice ⇒ adopt the larger and trail it |
     | Annoyance | Once per call, earcon-shaped, ~8 dB under the reply; an owner call |
3. **Ship order.**
   - **Wave 1:** R91's tail hold (noise + 10 dB, 700 ms, cap 5 s, min 300–500 ms) plus the 0.75 text backstop. Plus the chirp **measure-only**: play it, trail `calib {lagMs, ncc1, ncc2, agreeMs}` beside `onsetLagMs` per reply.
   - **Wave 1.5**, once one car round shows chirp-L and onset-L agree within ±100 ms: the chirp's L becomes `hold_tail_min` (drain + L + 300 ms) and the deterministic release.

   This refines R91 ④'s "don't build per-call latency learning" (R91's revisit trigger is owner clipping, which the deterministic release is the fix for) and DEBUG_PLAN J3's "not in wave 1 unless cheap AND sound". It is cheap and sound in model; it is not yet proven on the car.

**Verdict on Maya's menu: AGREE WITH CHANGES.** Her ship order is right. Her reasons, her SNR, several WebRTC readings and her gates are corrected above. The chirp belongs on the menu as a measure-only wave-1 item, and the envelope estimator stays a drift-monitor seam.

### V.e What I could not determine
- Whether this head unit clips or fades the first sound after an idle gap, and whether its lag re-settles after an A2DP suspend. Only a car round with the measure-only chirp and `onsetLagMs` answers this.
- The element-path vs WebAudio-path lag difference at better than the VAD's ±0.1 s.
- Chrome Android's NS effect on a sweep and on the echo envelope. My model omits NS.
- Real head-unit DSP: dynamic EQ, speed-compensated volume. The model uses a static band-pass plus a 2:1 compressor.
- Mid-range Android wall time for the 8 kHz direct NCC or the `ConvolverNode` route. It was not benchmarked.
- Whether Chrome's `ended` already subtracts the ≈ 0.28 s Android reports (R91 §1.3 says yes). If it does, drain-relative L is ≈ 0.28 s smaller than the chirp's round trip. Using the full round trip over-holds by ≤ 0.3 s, which is safe.
- BeepBeep's exact chirp parameters beyond the abstract (1–6 kHz LFM). The paper body was not read.
