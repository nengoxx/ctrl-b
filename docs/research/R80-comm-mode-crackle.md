# R80 — the comm-mode crackle: why our TTS breaks up while the platform AEC holds the device

**Date: 2026-09-22 · Confidence: the Chromium half is VERIFIED at the pin below (files read raw, not
searched); the Android-HAL half is REPORTED or reasoned and is marked per claim; the cause on the
owner's actual phone is UNVERIFIED — no phone in this session, and §8 says exactly what a ten-minute
device round would settle.**

**Question (one):** on Chrome for Android, with a `getUserMedia` capture holding the device in
`MODE_IN_COMMUNICATION` (the R74 trap), why does *our* TTS playback crackle intermittently — and does
the **page's playback pipeline** change that exposure at all, or is the capture side the only lever?

**Occasion:** the owner's D74 deck round (2026-09-22, Honor 20 / Android 10 / current Chrome over the
Tailscale-Serve HTTPS chain). With EC engaged (comm mode) in-call TTS **crackles intermittently**;
with `echoCancellation:false` (the headphones route) it is **clean**. Flipping the in-call route or
the input-device control — both of which stop the capture and open a fresh `getUserMedia` —
**sometimes** clears the crackle mid-call. Playback keeps playing across the flip. Open WebUI's call
mode reportedly does **not** crackle on the same phone (secondhand, unverified). Logged as ISS-16.

**Relates to:** [`R74`](R74-android-call-audio-routing.md) §1 (the comm-mode trap) · §7-S2 (the
output-usage latch) · [`R77`](R77-android10-pres-route-residual.md) §1.6 · §2.1 (the restore lives
inside the mode exit) · §3 (a MEDIA stream is re-routed anyway) · [`R78`](R78-barge-arm-readback.md)
§1.3 (the readback table) · §2.3 (the EC-mode pin) · [`R75`](R75-background-call-survival.md) §3.4 ·
§13 (the keepalive) · [`R50`](R50-c3-playback-probes.md) (the chunk seam) · `LIVE_VOICE_PLAN.md`
§4.1/§5.1/§7-S4 · `frontend/src/lib/audioController.ts` · `frontend/src/lib/pcmCapture.ts` ·
`frontend/src/hooks/useLiveCall.ts`. **Drove:** nothing yet — evidence for ISS-16 and the S4 phase
gate. **Corrects:** nothing in R74/R77/R78; every claim of theirs I re-read at today's pin still holds.

**Source pins (all read 2026-09-22).**

| Repo / source | Pin | How read |
|---|---|---|
| `chromium/chromium` | **`86298bb90e31129a07178dc11be85675585e9ca2`** (main, 2026-09-22T06:23Z) | raw files over https (`raw.githubusercontent.com`), whole files |
| `open-webui/open-webui` | `main` @ 2026-09-22 | raw `CallOverlay.svelte` (1146 lines), read in full at the audio sites |
| `issues.chromium.org` | 364501613 · 463721088 · 336592434 · 41491737 | `/action/issues/<id>` JSON (description + metadata; **comment threads are not served** — `/comments` 404s) |
| `open-webui` issue 29969 | fetched 2026-09-22 | WebFetch |
| ctrl-b working tree | `80bd388` | local read |

---

## 0. The verdict in nine lines

1. **Our playback pipe is one detached `HTMLAudioElement`, blob-URL `src`-swapped per chunk. No
   MediaSource, no Web Audio, no rate decision of our own** (§1, VERIFIED in our source). Chromium
   decides every rate and buffer size; the page's only inputs are the *container* (Ogg Opus, 48 kHz)
   and *how often the element is re-`src`'d* (one swap per sentence).
2. **R74's "don't fix this in `audioController`" still stands for the ROUTE, and it is now precise:**
   nothing a page does to its playback can change the output *usage tag* or the *device*, because
   `MakeLowLatencyOutputStream` reads `communication_mode_is_on_` and Android re-routes every open
   output on the mode change anyway (R77 §3, re-verified at this pin). **But the pipe does decide
   three other things** — how many physical output streams exist, how often they are started/stopped,
   and at which latency class (§3). Those are real crackle surfaces, and they are ours.
3. **I found NO Chromium or WebRTC bug whose signature is "media playback glitches while a comm-mode
   capture is open, cleared by restarting the capture."** (§2.) The nearest public neighbours are
   about mic distortion, route selection, or desktop WebAudio. This is an honest negative, not a
   thorough-search guarantee: the tracker's comment threads are unreadable without JS, so only issue
   *descriptions* were searchable.
4. **Chromium never adapts an AAudio buffer to observed glitches.** It sets the buffer to `burst × 2`
   (`× 3` if `burst < 128`) once, at open, and thereafter only *reports* XRuns to UMA
   (`Media.Audio.Android.AAudioXRunCount.*`). A stream that opens onto a bad configuration stays bad
   for its whole life — and lives for the whole reply plus **5 seconds** of idleness (§3.3). That is
   the shape of "intermittent, and sometimes a restart clears it". VERIFIED.
5. **An Android phone may hold only TEN concurrent output streams** (`kMaxOutputStreams = 10`,
   VERIFIED). Open WebUI has a shipped bug where TTS dies at exactly that cap (issue 29969). We are
   not obviously near it, but `probeDuration` mints a `new Audio()` **per chunk** (§7-S1).
6. **`echoCancellation: true` and `{ideal:"all"}` are the same audio path on Android, re-verified at
   today's HEAD** — same `kPlatformProvided` canceller, same `ECHO_CANCELLER` mask, same mode flip,
   same `AAUDIO_INPUT_PRESET_VOICE_COMMUNICATION`. The only difference is the **readback** (`true` vs
   `"all"`) and what a *failed* grant degrades to. `kAll` engages **no** loopback or system capture on
   Android: that arm is compiled out (§4). So the secondhand "Open WebUI doesn't crackle" cannot be
   explained by its `true` vs our `"all"`.
7. **THE LATCH IS EXPLAINED, and it is an ordering race in OUR code** (§5). The mode is evaluated
   **only for the first input stream** (`has_input_streams` early-return) and restored **only when the
   last one is released** — and `ReleaseInputStream` happens in the audio service, asynchronously,
   after our renderer-side `track.stop()`. Our recapture calls `capture.current?.stop()` and then
   `getUserMedia` **with no barrier between them** (`useLiveCall.ts:1422–1430`). Win the race and the
   device leaves comm mode, everything is re-routed, and the crackle clears; lose it and the new
   capture inherits the live mode — *and*, by R78 §2.3, the old capture's echo-cancellation mode.
   **Sometimes.**
8. **Software AEC is unreachable as a fix.** `kChromeWide`, `kLoopbackBased` and
   `EnforceSystemEchoCancellation` are all `#if`-guarded off for Android at this pin, with no flag,
   param or origin trial to open them (§6). **Verdict: the desktop "loopback `RTCPeerConnection`
   reference" trick has zero Android value for us** — with `echoCancellation:false` there is no AEC
   instance to feed, and with it on we get the *platform* canceller, which takes no reference from us.
9. **Ranked fixes (§10): (1) EC-off + the ear-hold we already ship — it costs us nothing we still use,
   because `barge_in` ships OFF; (2) make the ear-hold RELEASE the capture so the device leaves comm
   mode while the mouth speaks — the mechanism the owner has now accidentally triggered twice; (3)
   playback-pipe changes, which are DIAGNOSTICS, not fixes.**

---

## 1. OUR playback pipe, exactly (VERIFIED — `frontend/src/lib/audioController.ts` @ `80bd388`)

**One element, module-global, detached from the DOM.** `ensureEl()` (`:419`) lazily constructs
`new Audio()` with `preload = "auto"` and caches it in `let el` (`:87`). There is exactly one, shared
by per-bubble play buttons, auto-TTS, the MiniPlayer and the call. It is never appended to the
document, so `playsinline`/`controls`/CSS have no bearing on it; `volume`, `setSinkId` and
`preservesPitch` are never touched. `playbackRate` is never set by the call path.

**No Web Audio and no MSE, deliberately.** The module header states the reason verbatim (`:9–15`):

> `src`-swap on `ended`, synth-ahead `lookahead` deep with a waiting latch, so the first sentence is
> audible in ~0.7 s instead of ~13.6 s (R50 P2; **the swap seam measured 4–6 ms, which is why there is
> no Web Audio and no MSE here**).

**One blob URL per chunk.** `requestTts` (`:503`) does `POST /api/voice/tts` and takes
`await res.blob()`; `synthChunk` (`:768`) wraps it in `URL.createObjectURL`. `playNext` (`:832–847`)
assigns `a.src = s.urls[i]`, sets `a.currentTime = 0`, and calls `startEl(a)` → `a.play()`. The next
chunk is swapped in on the element's `ended` event (`:454`). A whole reply is therefore **N `src`
assignments and N `play()` calls on one element**, back to back, where N = sentences.

**The wire format is Ogg Opus.** Client policy default `format: "opus"` (`:104`); the server publishes
it from `TtsServiceCfg.chunk_format = "opus"` with `chunking: "sentence"` (`backend/app/config.py:862–869`),
and `backend/app/adapters/voice.py:51` maps `"opus" → audio/ogg`. **Ogg Opus always decodes at
48 kHz** regardless of what Kokoro synthesized at. The pre-D63 whole-blob path (`policy.mode === "off"`,
`playWhole` `:576`) uses `TtsServiceCfg.format = "mp3"` and one cached object URL per message.

**A SECOND element per chunk, for metadata only.** `probeDuration` (`:400`) creates `new Audio()` with
`preload = "metadata"`, assigns the same blob URL, reads `duration` on `loadedmetadata`, and drops the
reference. One per chunk, never explicitly released. (Consequence: §7-S1.)

**The call's first `play()` happens BEFORE the mic opens.** `primeAudio` (`:142`) runs inside the
call's start gesture and plays `SILENT_WAV` — decoded: **RIFF/WAVE, PCM, mono, 44 100 Hz, 16-bit, one
sample** — muted, then `pause()`s, removes `src` and `load()`s. Only then does `useLiveCall` open the
capture. So the element's *first* output stream of a call is created while the device is still in
`MODE_NORMAL` (see §3.4 for whether that can survive).

**Nothing in this module chooses a sample rate, a buffer size or a device.** The only rate that
appears anywhere in the voice client is `PcmCapture.sampleRate` (`pcmCapture.ts:315`) — the *capture*
context's rate, read off `AudioContext` and declared to the relay. Playback rates are entirely
Chromium's (§3.1).

**What else is making sound during a call.** `startPcmCapture` (`pcmCapture.ts:501`) constructs
`new AudioContext()` **with no `latencyHint`** (⇒ `"interactive"`), resumes it, and builds
`MediaStreamSource → AudioWorkletNode → GainNode(0) → ctx.destination` (`:416–424`), plus — while the
page is hidden — a `ConstantSourceNode` at `1e-4` into the same destination (`:479–485`). **That
context is a second output client**, and §3.2 says what Chromium does with it.

---

## 2. Q1 — the public bug record: no match, and what is nearest

**What I searched.** `issues.chromium.org` (via site-scoped web search, then the JSON API per issue),
`discuss-webrtc`, `github.com/google/oboe`, `bugs.chromium.org` archives, and general web, with the
brief's terms plus `AAUDIO_USAGE_VOICE_COMMUNICATION`, `XRunCount`, `MODE_IN_COMMUNICATION`,
Kirin/EMUI/Honor. **The tracker's comment threads are not served without JS** (`/action/issues/<id>/comments`
returns 404), so diagnoses that live in comments are invisible to this pass — that is the single
biggest gap in §2 and I do not claim the negative is exhaustive.

**No report matches the signature** "*media element* playback crackles while a gUM capture holds
`MODE_IN_COMMUNICATION`, intermittently, cleared by restarting the capture". Nearest neighbours:

| Issue | What it actually is | Match |
|---|---|---|
| [364501613](https://issues.chromium.org/issues/364501613) "Audio crackling using an audio worklet" (Blink>WebAudio, Chrome 128, **Linux**) | Repro is one `AudioContext` with a **capture worklet and a renderer worklet** — mic in, PCM back out through the same context. Still open, 19 comments (unreadable). | **Structural cousin**: capture + render in one realtime context. Not Android, not a media element. |
| [463721088](https://issues.chromium.org/issues/463721088) "Pixel 10 Pro Speaker Popping" (Internals>Media>Audio, **Android**, opened 2025-11) | "the speakers on my phone make a loud popping sound for a split second… **Force stopping the app or restarting my phone seems to make it stop for a little while, but it comes back**". No capture in the repro. | **Symptom cousin**: Android, transient, cured by a restart, recurs. Cause unknown. |
| [41491737](https://issues.chromium.org/issues/41491737) "microphone input is affected by other tabs playing audio" (Mac) | The *input* degrades when output is active. | Inverse direction; wrong platform. |
| [41276355](https://issues.chromium.org/issues/41276355) / [40222537](https://issues.chromium.org/issues/40222537) | The earpiece/BT routing bugs R74 §2.1 and R77 already own. | Route, not quality. |
| [open-webui#29969](https://github.com/open-webui/open-webui/issues/29969) | **Peer, same class of app, Android Chromium**: TTS dies after ~10 replies — *"Number of opened output audio streams 10 exceed the max allowed number 10"*, `AUDIO_RENDERER_ERROR`; one leaked stream per audio request; a reload buys another ten. Also: "In voice call mode, the UI additionally stays stuck in the listening state." | **Not crackle** — but it proves the 10-stream cap bites peers in exactly our shape, and it is a REPORTED datapoint that Open WebUI's call mode on Android is not trouble-free. |
| [XDA thread 4314647](https://xdaforums.com/t/several-huawei-phones-crackling-mic-audio-seeking-advice-help-some-samsung-too-huawei-streamlabs-app-or-youtube-fault-update-some-samsung-s-too.4314647/) | Crackling **mic** audio across several Huawei/Honor phones, surviving EMUI rollback and factory reset. | REPORTED, device-family HAL smell on the owner's exact vendor. Wrong direction (capture, not playback). |
| [google/oboe#564](https://github.com/google/oboe/issues/564), [#2193](https://github.com/google/oboe/issues/2193), [#1110](https://github.com/google/oboe/issues/1110) | AAudio glitches/crackles on specific Samsungs; AAudio silently accepting a rate it then resamples; AAudio input silent for every preset *except* `VoiceCommunication` on S9+. | REPORTED. Establishes the *class*: AAudio configuration mismatches are device-specific and produce crackle, and `VOICE_COMMUNICATION` is where the vendor quirks live. |

**Nothing Android-10- or Kirin-980-specific surfaced at all.** The Honor 20 runs Magic UI 3.x
(an EMUI derivative) on a HiSilicon HAL; there is no public Chromium record for it.

**One inference the owner's own observation licenses (VERIFIED chain, from R74 §1.3):** a phone whose
`AcousticEchoCanceler.isAvailable()` were **false** would produce a `NO_EFFECTS` mask on *both* routes,
never flip the mode, and route both routes identically. The owner sees a **playback-quality difference
between the two routes**, which only the mode flip can produce. ⇒ **the platform AEC bit is present on
the Honor 20**, and the speaker route's `getSettings().echoCancellation` should read the string
`"all"`, not `true`. That is a free, one-line check on the existing debug block (§9).

---

## 3. Q2 — does the PAGE's playback pipeline change the exposure? (VERIFIED in Chromium source)

Short answer: **it cannot change the route or the usage tag; it does change the number, lifetime and
latency class of the physical streams.** Everything below is from the pin.

### 3.1 Where the rates are decided — and it is never in the page (VERIFIED)

`media/renderers/audio_renderer_impl.cc`, `ComputeHardwareOutputConfig`:

```cpp
  // To allow for seamless sample rate adaptations (i.e. changes from say
  // 16kHz to 48kHz), always resample to the hardware rate.
  int sample_rate = hw_params.sample_rate();

  // If supported by the OS and the initial sample rate is not too low, let
  // the OS level resampler handle resampling for power efficiency.
  if (AudioLatency::IsResamplingPassthroughSupported(
          AudioLatency::Type::kPlayback) &&
      stream_config.samples_per_second() >= 44100) {
    sample_rate = stream_config.samples_per_second();
  }
…
  result.params = AudioParameters(hw_params.format(), renderer_channel_layout_config, sample_rate,
                                  AudioLatency::GetHighLatencyBufferSize(sample_rate, preferred_buffer_size));
```

and `media/base/audio_latency.cc`:

```cpp
#elif BUILDFLAG(IS_ANDROID)
  // Only N MR1+ has support for OpenSLES performance modes which allow for
  // power efficient playback…
  return type == Type::kPlayback && …SDK_VERSION_NOUGAT_MR1;
```

⇒ **for our Ogg Opus (48 000 ≥ 44 100), the element's sink opens at 48 kHz and the renderer does no
resampling at all — the OS resamples.** For the `off` path's mp3 at 24 kHz the renderer resamples up to
the hardware rate first. The hardware rate itself is `AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE`
(`AudioManagerAndroid.java:446`, `getNativeOutputSampleRate`) — **the MEDIA path's native rate, queried
without reference to the audio mode**. Nothing asks the device what the *voice* path wants. If the
Honor 20's comm-mode output runs at 16 kHz, the 48 kHz→16 kHz conversion happens inside AudioFlinger
or the HAL, out of Chromium's sight and out of ours. *(That this is where a vendor resampler could
misbehave is REASONED, not verified — see §8.)*

**Buffer size**, same file: `GetHighLatencyBufferSize(48000, preferred)` = `max(preferred, 1024)`
(nearest power of two above 20 ms). `preferred` comes from `AudioManagerAndroid::GetOptimalOutputFramesPerBuffer`
— `PROPERTY_OUTPUT_FRAMES_PER_BUFFER` on a `FEATURE_AUDIO_LOW_LATENCY` device (else `256`), otherwise
`max(2048, AudioTrack.getMinBufferSize/2/ch)`. And `GetPreferredOutputStreamParameters` keeps the
renderer's number for us verbatim:

```cpp
    // For high latency playback on supported platforms, pass through the
    // requested buffer size; this provides significant power savings (~25%) and
    // reduces the potential for glitches under load.
    if (input_params.latency_tag() == AudioLatency::Type::kPlayback) {
      frames_per_buffer = input_params.frames_per_buffer();
```

**⇒ the media element gets the glitch-RESISTANT configuration by construction: ≥1024 frames (~21 ms)
and `AAUDIO_PERFORMANCE_MODE_POWER_SAVING`.** (a) of the brief — element vs MSE vs blob — does not
move any of this: an MSE-fed element and a blob-fed element produce the same `AudioRendererImpl` and
the same sink params. **There is no playback-pipe variant that gets us a *better* output configuration
than the one we already have.**

### 3.2 The latency class is the one thing the page picks — and WebAudio picks the risky one (VERIFIED)

`third_party/blink/renderer/modules/media/audio/audio_device_factory.cc`:

```cpp
    case blink::WebAudioDeviceSourceType::kWebAudioInteractive:
      return media::AudioLatency::Type::kInteractive;
    case blink::WebAudioDeviceSourceType::kMediaElement:
    case blink::WebAudioDeviceSourceType::kWebAudioPlayback:
      return media::AudioLatency::Type::kPlayback;
```

and `media/audio/android/aaudio_stream_wrapper.cc`:

```cpp
    case AudioLatency::Type::kExactMS:
    case AudioLatency::Type::kInteractive:
    case AudioLatency::Type::kRtc:
      performance_mode_ = AAUDIO_PERFORMANCE_MODE_LOW_LATENCY;
      break;
    case AudioLatency::Type::kPlayback:
      … performance_mode_ = AAUDIO_PERFORMANCE_MODE_POWER_SAVING;
```

with the interactive buffer being `GetInteractiveBufferSize(hardware_buffer_size)` = the hardware FPB
itself on Android (typically 192–256 frames ⇒ **4–5 ms**).

**⇒ our `pcmCapture` `AudioContext` — `new AudioContext()`, no `latencyHint` — asks Android for a
LOW_LATENCY output stream with a ~4 ms callback, for the duration of a call, tagged
`AAUDIO_USAGE_VOICE_COMMUNICATION` (it is created after the mic).** It renders silence; its own
underruns would be inaudible. Whether a starving low-latency client can disturb *other* tracks on the
same output is a property of the device's mixer, **not verified here** (§8) — but it is the only place
in our design where the page asks the phone for something hard, and it is free to test (§10).

There is a mitigation in-tree that nobody has to build: `RealtimeAudioDestinationHandler::SetDetectSilenceIfNecessary`
(`realtime_audio_destination_handler.cc:314`):

```cpp
  // For other latency profiles (interactive, balanced, exact), use the
  // following heristics for the FakeAudioWorker activation after detecting
  // 30-seconds of silence when there are no automatic pull nodes (APN) in the
  // graph.
  bool needs_silence_detection = !has_automatic_pull_nodes;
```

Our graph has **no** automatic pull nodes (everything is connected through to the destination), so
silence detection is ON and after **30 s** of exact silence `SilentSinkSuspender` swaps the real device
for a `FakeAudioWorker` — i.e. *our* second output stream disappears mid-call, and comes back the
moment something non-zero is rendered (the `setKeepalive` DC when the page hides). **Open WebUI's
analyser context has an `AnalyserNode` that is never connected to the destination** (`CallOverlay.svelte:300–305`)
— the textbook automatic pull node — **so silence detection is OFF there and its context holds a real
output stream for the whole call.** *(The `SetDetectSilenceIfNecessary` rule is VERIFIED at the pin;
that an output-less `AnalyserNode` is what registers as an APN is Blink behaviour I did **not** re-read
here — REPORTED.)* Which of the two is better is unknown, but they are *different*, and it is one of
only three material differences between the two apps (§3.5).

### 3.3 The physical stream is POOLED, its tag is latched, and it outlives our chunk seams (VERIFIED)

`media/audio/audio_manager_base.cc`: dispatchers are reused when `params.Equals(...) &&
output_params.Equals(...) && output_device_id ==`, each constructed with
`kCloseDelay = base::Seconds(kStreamCloseDelaySeconds)` where `const int kStreamCloseDelaySeconds = 5;`.
`audio_output_dispatcher_impl.cc`:

```cpp
  // Leave at least a single stream running until the close timer fires to help
  // cycle time when streams are opened and closed repeatedly.
  CloseIdleStreams(std::max(idle_proxies_, static_cast<size_t>(1)));
```

**⇒ our N `src` swaps per reply do NOT open N physical AAudio streams.** They `Start()`/`Stop()` one
pooled physical stream, which is only closed after **5 s** with no client. And per R77 §3 (re-verified:
`MakeLowLatencyOutputStream` still reads `communication_mode_is_on_` exactly once, at creation) that
stream's `AAUDIO_USAGE_*` tag was decided when it was created and nothing re-tags it.

Two consequences worth holding:
- **A crackly stream is sticky for a whole reply** (chunks share it) and usually for the whole call
  (gaps between replies are frequently < 5 s while read-along is on). A *good* stream is equally
  sticky. **That is the shape of "intermittent between calls / between replies, constant within one".**
- **`primeAudio`'s 44.1 kHz mono WAV cannot poison the TTS stream**: different `AudioParameters` ⇒
  different dispatcher ⇒ different physical stream. (The 48 kHz Opus chunks share one dispatcher with
  each other; the prime does not join it.) R74 §7-S2's "open the mouth first" idea stays dead —
  R77 §3 killed it for the route, and this kills the params half too.

### 3.4 The cap that bit our peer (VERIFIED)

`media/audio/audio_manager_android.cc:72`: `constexpr int kMaxOutputStreams = 10;` — applied in the
constructor as `SetMaxOutputStreamsAllowed(is_desktop() ? kDesktopMaxOutputStreams : kMaxOutputStreams)`.
(`audio_manager_base.cc`'s cross-platform default is 16; **Android phones get 10**.) Exceeding it is
`AUDIO_RENDERER_ERROR`, which is open-webui#29969 verbatim. Our own budget during a call: 1 element
stream + 1 WebAudio stream (suspended after 30 s of silence) + whatever `probeDuration` costs (§7-S1).

### 3.5 So why doesn't Open WebUI crackle? (the secondhand claim, examined)

Read at the pin, `CallOverlay.svelte` is **structurally our twin**: one `<audio id="audioElement">`,
`audioElement.src = audio.src` per sentence (`:455`), whole-sentence blobs, one long-lived
`getUserMedia` for the call, and the capture is **not** stopped while the assistant speaks (the mic is
suppressed by moving `analyser.minDecibels/maxDecibels`, `:318–322`; `stopAudioStream` is only called
on teardown, `:749/772/1121`). Its constraints are `{echoCancellation: true, noiseSuppression: true,
autoGainControl: true}` (`:236–241`) — which §4 shows is **the same platform-AEC path and the same
comm-mode flip as ours**.

Material differences, all three of them:

| | ctrl-b | Open WebUI |
|---|---|---|
| Capture-side work | `AudioWorklet` minting pcm16 frames + a **continuous WebSocket uplink** | `MediaRecorder` + an `AnalyserNode` polled per rAF |
| WebAudio output stream | silence-detected ⇒ **suspends to a fake sink after 30 s** | has an APN ⇒ **never suspends**; and a *new* `AudioContext` per `startRecording`, never closed (their leak) |
| Chunk cadence | sentence chunks with `lookahead`-deep synth-ahead, seams back-to-back | sentence blobs, cached, played from a queue — same order of magnitude |

**⇒ "Open WebUI doesn't crackle" is NOT explained by a playback-pipe difference, because there barely
is one.** If the report is true, the difference is more likely on the capture/realtime side (our
worklet + uplink) or is simply not comparable (different session, different BT state, different
volume). Treat the secondhand claim as **unverified and low-information** until it is A/B'd in one
sitting on one phone.

---

## 4. Q3 — `true` vs `{ideal:"all"}` at today's HEAD (VERIFIED)

Re-read at `86298bb9`; R74 §1.4/§1.5 and R78 §1.2/§1.3 are **unchanged**.

- `EchoCanceller::From` still maps `kBrowserDecides → GetPreferredAec()` and `kAll → GetSystemWideAec()`
  (`media_stream_audio_processor_options.cc:84–102`), and both return `Type::kPlatformProvided` when
  `IsPlatformAecAvailable(effects)`.
- `GetSystemWideAec` is:
  ```cpp
  EchoCanceller::Type EchoCanceller::GetSystemWideAec(int available_platform_effects) {
    if (media::IsSystemLoopbackAsAecReferenceEnabled()) { return Type::kLoopbackBased; }
    // See IsSystemWideAecAvailable().
    CHECK(IsPlatformAecAvailable(available_platform_effects));
    return Type::kPlatformProvided;
  }
  ```
  and `IsSystemLoopbackAsAecReferenceEnabled()` is `#if BUILDFLAG(SYSTEM_LOOPBACK_AS_AEC_REFERENCE)` …
  `#else return false;`, with `media/media_options.gni` still
  `system_loopback_as_aec_reference_supported = (is_win || is_mac) && chrome_wide_echo_cancellation_supported`.
  **⇒ `"all"` on Android engages NO loopback and NO system capture. It is the platform canceller and
  nothing else.** VERIFIED.
- The readback mapper (the function R74 §8 could not find; R78 §1.1 read it) at
  `media_stream_constraints_util_audio.cc:1657`:
  ```cpp
  V8UnionBooleanOrString* EchoCancellationModeToBooleanOrString(EchoCancellationMode mode) {
    switch (mode) {
      case EchoCancellationMode::kDisabled:       return …(false);
      case EchoCancellationMode::kBrowserDecides: return …(true);
      case EchoCancellationMode::kAll:            return …(String(kEchoCancellationModeAll));
      case EchoCancellationMode::kRemoteOnly:     return …(String(kEchoCancellationModeRemoteOnly));
  ```
  and `kAll` is only a *candidate* when `EchoCanceller::IsSystemWideAecAvailable(platform_effects)`
  (`:1673`), with `kRemoteOnly` still `#if !BUILDFLAG(IS_ANDROID) && !BUILDFLAG(IS_IOS)`.

**Is requesting `true` materially different for the AUDIO PATH? No.** Same canceller type, same pushed
effects mask, therefore the same `MODE_IN_COMMUNICATION` flip (R74 §1.1) and the same
`AAUDIO_INPUT_PRESET_VOICE_COMMUNICATION` (R77 §1.6, re-verified at `aaudio_stream_wrapper.cc:531`).
The differences are exactly two, and both are about *information*, not sound:

| | `echoCancellation: true` | `echoCancellation: {ideal:"all"}` (ours) |
|---|---|---|
| Resolved mode, platform bit **present** | `kBrowserDecides` → `kPlatformProvided` | `kAll` → `kPlatformProvided` |
| Readback | `true` | `"all"` |
| Resolved mode, platform bit **absent** | `kBrowserDecides` → `kPeerConnection` (AEC3) | `kAll` not a candidate ⇒ falls to `kBrowserDecides` → AEC3 |
| Readback in that case | `true` (**ambiguous**) | `true` (**diagnostic**: under our request shape it *means* the bit was absent — R78 §1.3) |

**⇒ keep `{ideal:"all"}`. Switching to `true` would buy nothing and would blind the one readback we
have.**

---

## 5. Q4 — THE LATCH: who restores the mode, when, and why order matters (VERIFIED)

### 5.1 The two gates, re-read at this pin

`audio_manager_android.cc:713–743` (`MakeAudioInputStream`):

```cpp
  bool has_input_streams = !HasNoAudioInputStreams();
  AudioInputStream* stream = AudioManagerBase::MakeAudioInputStream(…);
  …
  // Avoid changing the communication mode if there are existing input streams.
  if (!stream || has_input_streams || UseAAudioPerStreamDeviceSelection()) {
    return stream;
  }
  …
  if (params.effects() != AudioParameters::NO_EFFECTS) {
    communication_mode_is_on_ = true;
    GetJniDelegate().SetCommunicationAudioModeOn(true);
  }
```

`:755–765` (`ReleaseInputStream`):

```cpp
  AudioManagerBase::ReleaseInputStream(stream);
  // Restore the audio mode which was used before the first communication-
  // mode stream was created.
  if (HasNoAudioInputStreams() && communication_mode_is_on_) {
    communication_mode_is_on_ = false;
    GetJniDelegate().SetCommunicationAudioModeOn(false);
  }
```

`SetCommunicationAudioModeOn(false)` is the **whole** restore — stop SCO, clear the requested device,
put speakerphone + mic-mute back, `setMode(MODE_NORMAL)` (R77 §2.1, unchanged) — and
`setPhoneState(MODE_NORMAL)` makes AOSP **re-evaluate routing on every open output** (R77 §3). So a
successful mode exit re-routes the *live* TTS stream without touching it. **That is precisely "playback
keeps playing across the flip, and sometimes it comes back clean."**

### 5.2 The race, in our code (VERIFIED code path; the race itself is REASONED)

`useLiveCall.ts:1422–1430`, the `recapture` effect:

```ts
            capture.current?.stop();
            capture.current = null;
            …
            acquireRef.current({ route: eff.route, deviceId: eff.deviceId }, () => ref.current.gen === gen);
```

`PcmCapture.stop()` (`pcmCapture.ts:487`) does `track.stop()` for every track and `ctx.close()`. Both
are **renderer-side**; the input stream's actual `ReleaseInputStream` happens in the audio service,
after the mojo round trip. `acquireRef` immediately calls `openMicStream` → `getUserMedia`, which is
itself several IPC hops, so the ordering is *usually* favourable — but there is **no barrier**, and
nothing in the API surfaces "the old input stream is gone".

Lose the race and two things happen at once, both VERIFIED mechanisms:
1. `has_input_streams` is true for the new stream ⇒ **the mode is not re-evaluated**. The device stays
   in `MODE_IN_COMMUNICATION` even though the new capture's mask is empty; nothing re-routes; the
   crackle survives the flip.
2. R78 §2.3's **pin**: `EchoCancellationContainer` collapses `ec_allowed_values_` to the mode of the
   first live source on the same device when that source is platform-provided. Our `echoCancellation:
   false` is a *naked* value in the basic constraint set (i.e. ideal, not exact — `pcmCapture.ts:76`),
   so it does not throw; it **silently resolves to the pinned mode**. The "EC-off" route can therefore
   come up with EC still on.

**⇒ order matters, and we can detect the failure for free.** We already read `getSettings().echoCancellation`
back per track into `MicReadback` (`pcmCapture.ts:533–546`). **A route flip whose readback does not
match what the route asked for is a flip that did not take.** Today nothing compares them.

### 5.3 Is a comm-mode RESIDUE expected after a clean EC-off flip?

**Not of the mode** — if the old stream is genuinely released first, `MODE_NORMAL` is restored and
every output is re-routed (R77 §3). **But of the ROUTE, yes, and R77 already owns it:** the restore
lives *inside* the mode exit, so when the **new** (EC-off) capture is later released, nothing is
restored at all — `SetCommunicationDevice()` still ran unconditionally for it (R77 §1.1), and on the
BT arm its SCO link and forced speakerphone leak for the life of the audio service (R77 §2.1). So the
EC-off route is clean *for this call* and leaves the device dirtier afterwards. Unchanged by this pass.

---

## 6. Q5 — software AEC on Android, and the loopback-reference trick (VERIFIED)

At `86298bb9`, `media/base/media_switches.cc`:

```cpp
bool IsChromeWideEchoCancellationEnabled() {
#if BUILDFLAG(CHROME_WIDE_ECHO_CANCELLATION)
  …
#else
  return false;
#endif
}
bool IsSystemEchoCancellationEnforced() {
#if (BUILDFLAG(IS_MAC) || BUILDFLAG(IS_WIN))
  …
#else
  return false;
#endif
}
bool IsSystemLoopbackAsAecReferenceEnabled() {
#if BUILDFLAG(SYSTEM_LOOPBACK_AS_AEC_REFERENCE)
  …
#else
  return false;
#endif
}
```

with `media/media_options.gni` unchanged (`chrome_wide_echo_cancellation_supported = is_win || is_mac
|| is_linux`; loopback additionally `(is_win || is_mac)`). The features themselves are
`ENABLED_BY_DEFAULT` (`kChromeWideEchoCancellation`, `kSystemLoopbackAsAecReference`) and
`kEnforceSystemEchoCancellation` is `DISABLED_BY_DEFAULT` — **but all three are behind build flags
that are off for Android, so no `--enable-features`, no field-trial param and no origin trial can turn
them on in a shipped Android Chrome.** I found no chromestatus entry or intent-to-ship proposing
otherwise. (`kAAudioPerStreamDeviceSelection` remains `ENABLED_BY_DEFAULT` but gated on
`device_info::is_desktop()` — R74 §7-S3's clock is still ticking, still not for phones.)

**The one software AEC that IS reachable on Android** is `Type::kPeerConnection` (WebRTC AEC3 in the
renderer's APM), reached automatically when `AcousticEchoCanceler.isAvailable()` is false. R78 §3.1
established that in our configuration it hears nothing of ours: its render reference is
`WebRtcAudioDeviceImpl::RenderData`, the PeerConnection playout path, and an `<audio>` element is not
in it.

**VERDICT, stated as the brief asks.** *With `echoCancellation:false` there is no browser echo
cancellation at all — there is no AEC instance anywhere in the pipeline. The desktop trick of routing
page audio through a loopback `RTCPeerConnection` so the APM sees it as playout therefore has **zero**
value for us on Android: it feeds a reference to an AEC that must be enabled, and (a) when we disable
AEC there is none, (b) when we enable it we get the **platform** canceller, which takes its reference
from the device's own output path and cannot be fed by a page. Do not build it, on either route.*

---

## 7. Bounded open sweep (3 findings nothing above asked for)

**S1 — `probeDuration` mints an `<audio>` per chunk, and the Android cap is 10 (VERIFIED cap; the cost
UNVERIFIED).** `audioController.ts:400` creates `new Audio()` with `preload="metadata"` for every
chunk of every reply, never explicitly torn down (no `pause()`, no `removeAttribute("src")`, no
`load()`), relying on GC. A metadata-only load should never start an `AudioRendererSink`, so it
*should* cost no output stream — but that is precisely the assumption open-webui#29969 violated, the
cap is **10 on phones**, a long read-along reply is 20+ chunks, and the failure mode is a hard
`AUDIO_RENDERER_ERROR` rather than a degrade. Cheap insurance: after the probe resolves,
`probe.removeAttribute("src"); probe.load();`. Worth doing regardless of the crackle.

**S2 — a `ConstantSourceNode` keepalive is exactly the thing that un-suspends the WebAudio sink
(VERIFIED).** `SilentSinkSuspender` transitions on `!dest->AreFramesZero()`. Our `setKeepalive(true)`
(page hidden) makes the bus non-zero ⇒ **the real device stream is (re)opened mid-call, while the page
is hidden**, at `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY`, tagged `VOICE_COMMUNICATION`. R75 justified the
keepalive on Blink's `energy > 0` audibility test — which is computed in `HandleAudibility` *before*
the sink, i.e. **the fake sink would have kept the page audible anyway**. So the keepalive may be
buying page-audibility we already had while paying for a real low-latency output stream. Not urgent,
but it is a free stream to delete if §10-③ ever matters.

**S3 — Chromium measures this exact failure and never acts on it (VERIFIED).**
`aaudio_stream_wrapper.cc` ships an `AAudioGlitchReporter` that polls `AAudioStream_getXRunCount()` and
logs `Media.Audio.Android.AAudioXRunCount.{Input,Output}.*`, plus `…AAudioFramesPerBurst.*` and
`…AAudioFramesPerBurstChanged.*` (the burst can change under a live stream — which is itself a route
change happening beneath us). The buffer is set **once**:

```cpp
  // After opening the stream, sets the effective buffer size to 3X the burst
  // size to prevent glitching if the burst is small (e.g. < 128). On some
  // devices you can get by with 1X or 2X, but 3X is safer.
  int32_t size_requested = frames_per_burst * (frames_per_burst < 128 ? 3 : 2);
```

There is no XRun-driven growth (the standard Oboe remedy). **A page cannot influence any of it** — but
it means "the stream opened onto a bad burst" is a permanent condition of that stream, which is the
mechanism behind the 5-second stickiness in §3.3.

---

## 8. What I could not determine

- **Whether the crackle is in the HAL's 48 kHz→voice-path conversion, in an underrunning low-latency
  WebAudio stream, at our chunk seams, or none of those.** No phone in this session. §10's probe
  ladder is ordered to separate them in one sitting.
- **Whether a starving `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY` client can make *other* tracks on the same
  Android output audibly glitch.** This is the load-bearing unknown behind §3.2. It is a property of
  the device's mixer (AudioFlinger fast-mixer topology + the HiSilicon HAL), not of Chromium, and I
  found no authoritative statement either way. **Do not act on it without the A/B in §10-③.**
- **What the Honor 20's comm-mode output actually runs at** (16 kHz voip output vs 48 kHz primary),
  and whether AAudio grants `LOW_LATENCY` at all while the mode is on. `chrome://media-internals`
  over `chrome://inspect` from emma would print the opened output params directly.
- **Whether `preload="metadata"` on a detached element allocates an output stream** (S1). One
  `chrome://media-internals` look during a long reply answers it.
- **The diagnosis inside Chromium issue 364501613** (capture+render worklet crackling, 19 comments)
  and 336592434 — the tracker will not serve comment threads without JS, and `/comments` 404s. If
  someone can open those two in a browser, 364501613 is the single most likely place a matching
  diagnosis already exists.
- **Whether Open WebUI genuinely does not crackle on this phone.** Secondhand, single observation, no
  controlled comparison; §3.5 shows the two apps' playback pipes are near-identical, so the claim is
  either about the capture side or about the sitting.
- **Anything Kirin-980/Magic-UI-specific.** No public record found at all.

---

## 9. The numbers that decide the design

| Fact | Value | Confidence |
|---|---|---|
| Max concurrent output streams, Android **phone** | **10** (`kMaxOutputStreams`; desktop uses `kDesktopMaxOutputStreams`) | VERIFIED |
| Idle physical-stream close delay | **5 s** (`kStreamCloseDelaySeconds`), and at least one idle stream is always kept until it fires | VERIFIED |
| WebAudio silent-sink suspend threshold | **30 s** of exactly-zero frames, only when the graph has **no automatic pull nodes** | VERIFIED |
| Media-element sink: performance mode / buffer | `AAUDIO_PERFORMANCE_MODE_POWER_SAVING`, `max(1024, hw FPB)` frames ⇒ **≥21 ms @48 kHz** | VERIFIED |
| WebAudio (`interactive`) sink: performance mode / buffer | `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY`, **hardware FPB** (typically 192–256 ⇒ 4–5 ms) | VERIFIED |
| AAudio buffer set at open | `burst × 2` (`× 3` if `burst < 128`), **never adapted afterwards** | VERIFIED |
| Renderer-side resampling skipped (OS resamples) iff | `latency == kPlayback` **and** content rate **≥ 44 100** | VERIFIED |
| Our chunk container / decode rate | Ogg Opus ⇒ **48 000 Hz** (`chunk_format: "opus"` → `audio/ogg`) | VERIFIED |
| Our whole-blob container (`chunking: off`) | **mp3** (`TtsServiceCfg.format`) | VERIFIED |
| `primeAudio`'s unlock clip | PCM WAV, **mono, 44 100 Hz**, 1 sample ⇒ its own dispatcher, not the TTS one | VERIFIED |
| Hardware output rate Chromium asks Android for | `AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE`, **queried without regard to the audio mode** | VERIFIED |
| Mode flip evaluated for | **the FIRST input stream only** (`has_input_streams` early-return) | VERIFIED |
| Mode restored when | **the LAST input stream is released**, and only if the flag was set | VERIFIED |
| `{ideal:"all"}` vs `true` on Android | identical canceller, mask, preset and route; **readback differs** (`"all"` vs `true`) | VERIFIED |
| `"all"` engaging loopback/system capture on Android | **never** — `SYSTEM_LOOPBACK_AS_AEC_REFERENCE` is off by build flag | VERIFIED |
| Software AEC (AEC3) reachable on Android | only as the **fallback** when the platform bit is absent — and it hears no `<audio>` element | VERIFIED (R78 §3.1) |
| Chromium bugs matching the exact signature | **0 found** (comment threads unreadable) | VERIFIED-as-searched |

---

## 10. Implications for ctrl-b

*(Short and separate, per the folder's convention. Evidence above ages slowly; this reading ages fast.)*

**The frame.** "Clean speakerphone audio without self-hearing" has exactly two shapes on this
platform: **(A) stay out of comm mode and close the ear while the mouth speaks**, or **(B) enter comm
mode only while listening**. Everything else is decoration. R74 §9's "never fix this in the playback
path" survives this pass intact — with the one refinement that the playback path *does* own stream
count, stream lifetime and latency class (§3), which is where the *diagnostics* live.

**① Ship EC-off on the speaker route too, with the ear-hold — ranked first because it is the only
option with device evidence.** The owner has already proven it clean on their phone, we already own
both halves of the mechanism (`micConstraints` + `setHeld`, one normalize), and **the cost is a
capability we are not using**: `barge_in` ships OFF as of the D74 round, and on the speaker route the
barge arm was dead anyway (R78 §0). The honest loss is the *transcript* during a reply — the ear is
shut while the mouth speaks — which is exactly the bargain the headphones route already makes. The
honest cost is R77 §2.1's leak (no restore on the AEC-off path) and R77's SCO trap where a BT row
stands, and `candidateConstraints`'s steer already handles the latter. **If the owner accepts
tap-to-interrupt as the only interrupt, this is the whole fix and it is one config default.**

**② If we want the AEC back for the listening half: make the ear-hold RELEASE the capture, not just
disable the track.** This is the mechanism the owner has now stumbled into twice — half-leaving the app
(R77 §2.2) and flipping the route (§5) — and §5.1 is the source proof that releasing the last input
stream restores `MODE_NORMAL` *and* re-routes the live playback stream. Full platform AEC while
listening, media-path audio while speaking. Three things it costs, all designable:
   - the relay's endpointing needs frames through the hold (that is *why* the hold is `track.enabled`
     today, `pcmCapture.ts:328–337`) ⇒ the client must mint silent frames locally for the held stretch;
   - a `getUserMedia` per turn (no prompt — permission is granted — but ~100–300 ms and a fresh
     `SetCommunicationDevice()` per open, R77 §1.1, plus SCO cycling on the BT arm);
   - **the §5.2 ordering race becomes per-turn**, so it needs the barrier and the readback check below.
   Expensive, correct, and strictly better audio than ① if it works. **Prototype behind a config knob;
   do not make it the default without a device round.**

**③ The §5.2 hardening is owed either way, and it is small.** (a) Compare the new track's
`getSettings().echoCancellation` against what the route asked for; a mismatch means the flip did not
take (R78 §2.3's pin, or the mode race) — surface it the way `fellBack` is surfaced, and consider one
re-open. (b) Put a real barrier between `capture.current?.stop()` and the next `getUserMedia` rather
than relying on IPC luck. Neither needs new architecture; both use mechanisms that already exist.

**④ Playback-pipe changes are DIAGNOSTICS, not fixes.** Run them in this order, one sitting, speaker
route, EC on, same reply:
   1. **`chunking: "off"`** — one blob, one `Start()`/`Stop()` on the pooled stream instead of N. If
      the crackle vanishes, it is at our **seams** and the fix is seam-shaped (bigger chunks, or a
      gapless path). If it survives, the seams are innocent and chunking stays exactly as it is.
   2. **Kill the capture `AudioContext`'s output stream** — temporarily pass `{latencyHint: "playback"}`
      to `new AudioContext()` (⇒ `kPlayback` ⇒ POWER_SAVING + a big buffer instead of a 4–5 ms
      low-latency client). If the crackle vanishes, §3.2's unknown is answered and the permanent fix is
      a latency hint plus an acceptance that uplink frames arrive in bigger bursts (worse barge/endpoint
      granularity — measure before shipping).
   3. **`chrome://media-internals`** over `chrome://inspect` from emma, during a crackling reply: it
      prints the opened output params, the path, and the errors. That single look would replace most of
      §8.
   Everything else the brief listed — `playsinline`, category hints, `MediaStreamAudioDestinationNode`,
   one shared `AudioContext` for both directions, matching the context rate to the capture rate — is
   **inapplicable or already refuted**: our element is detached (no `playsinline` semantics), Chromium
   has no output category hint on Android, routing TTS through WebAudio would *downgrade* the sink from
   POWER_SAVING/21 ms to LOW_LATENCY/4 ms (§3.2), and no rate we choose reaches the device (§3.1).

**Do not build.** The loopback-`RTCPeerConnection` AEC reference (§6 verdict). An output picker (R74
§9, unchanged). "Open the mouth before the ear" (R77 §3, and now §3.3's params argument too). Any
UA-sniffed branch — every decision above is readable from the track or from config.
