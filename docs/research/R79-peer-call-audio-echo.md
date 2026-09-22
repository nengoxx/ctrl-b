# R79 — How peers play TTS and stop the agent hearing itself, in a browser call, on Android

**Date:** 2026-09-22 · **Status:** evidence, no decision · **Feeds:** `LIVE_VOICE_PLAN.md` S4 (the phase
gate) + ISS-16 (the in-call TTS crackle). Confidence markers per claim: **[V]** verified (I read the
source / ran the probe), **[R]** reported (secondary source, named), **[U]** unverified.

**Builds on, does not repeat:** [`R51`](R51-realtime-voice-chat.md) §2.6/§6.1/§8 (RealtimeVoiceChat),
[`R74`](R74-android-call-audio-routing.md) §1.4/§2.1/§4/§5 (the Chromium constraint→comm-mode chain;
no page-reachable output selection on Android), [`R48`](R48-chunked-tts-synthesis.md) §2.2
(open-webui's chunking loop). Findings already bought there are cited, not re-derived.

**The question.** The owner reports (2026-09-22, Honor 20 / Android 10 / current Chrome): ctrl-b's
in-call TTS **crackles** with EC engaged (comm mode) and is **clean** with EC off — while Open WebUI's
call mode on the same phone does not crackle. If peers ride the same comm-mode trap without crackle,
the differentiator is not the trap. So: what exactly do peers *play through*, what do they *ask for*,
and how do they keep the mic from hearing the mouth?

---

## 0. Sources, pinned

| Repo | SHA / version | Cloned |
|---|---|---|
| `open-webui/open-webui` | `8bd8b4fac5e0` · `package.json` version **0.11.4** · 2026-09-21 | 2026-09-22 |
| `KoljaB/RealtimeVoiceChat` | `9de323f1` · **2025-07-11** (last commit touching `code/` is the same SHA) | 2026-09-22 |
| `HumeAI/empathic-voice-api-js` (`@humeai/voice-react`) | `2014c5a9` · 2026-08-18 | 2026-09-22 |
| `pipecat-ai/pipecat-client-web-transports` | `91476a36` · `@pipecat-ai/websocket-transport` **1.7.2** · 2026-09-21 | 2026-09-22 |
| `Chainlit/chainlit` | HEAD 2026-09-22 (`libs/react-client/src/wavtools/*`) | 2026-09-22 |
| `enricoros/big-AGI` | HEAD 2026-09-22 (sparse: `src/apps/call`, `src/common/util/audio`) | 2026-09-22 |
| Chromium `main` | fetched raw 2026-09-22 via `chromium.googlesource.com/…?format=TEXT` | 2026-09-22 |
| MDN BCD `main` | fetched raw 2026-09-22 | 2026-09-22 |

ctrl-b's own numbers are read at the session's HEAD (`80bd388`).

---

## 1. Open WebUI's call mode, source-verified

All line numbers in `src/lib/components/chat/MessageInput/CallOverlay.svelte` (**1146 lines**) unless
noted.

### 1.1 (a) The gUM constraints [V]

`startRecording()`, lines 236-242 — **one** `getUserMedia`, reused for the whole call (`if
(!audioStream)`), never re-acquired per turn:

```js
audioStream = await navigator.mediaDevices.getUserMedia({
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
});
```

No `channelCount`, no `sampleRate`, no `deviceId`, **no mobile branch anywhere in the file** (`grep -i
"android|isMobile|ontouchstart|sinkId|audiooutput"` → 0 hits). Per R74 §1.4 this resolves to
`kBrowserDecides` → `kPlatformProvided` → **`MODE_IN_COMMUNICATION`**. Open WebUI is squarely inside
the same trap we are, and it holds the trap open for the entire call. *(This half was already in
R74 §5; it is repeated here only because the rest of §1 is meaningless without it.)*

### 1.2 (b) The playback pipeline — one bare `<audio>` element, whole files, and 300 ms of deliberate gap [V]

**There is no Web Audio in the playback path at all.** `grep -rln "audioWorklet|AudioWorkletNode"
src/` over the whole repo → **0 files**. No `MediaSource`, no `decodeAudioData`, no
`createBufferSource`.

The sink is a single hidden element that lives in the chat shell, not the overlay —
`src/lib/components/chat/Chat.svelte:4172`, verbatim:

```svelte
<audio id="audioElement" style="display: none;"></audio>
```

`fetchAudio()` (504-556) synthesises **whole sentences ahead** into an `audioCache: Map<content,
HTMLAudioElement>`: `synthesizeOpenAISpeech(...)` → `res.blob()` → `URL.createObjectURL(blob)` → `new
Audio(blobUrl)`. Format/sample rate are whatever the TTS endpoint returns (for the OpenAI-compatible
path, MP3) — **decoded by the media pipeline, never by the page**.

`playAudio()` (429-471) then *borrows only the src*:

```js
audioElement.src = audio.src;
audioElement.muted = true;
audioElement.playbackRate = $settings.audio?.tts?.playbackRate ?? 1;
…
audioElement.play().then(() => { audioElement.muted = false; })
```

**Three things fall out of that, and they are the whole §5 answer:**

1. **One element for the whole call.** Chunk *n+1* reuses `#audioElement`; the cached `new
   Audio(blobUrl)` objects are never played, only mined for `.src`.
2. **Muted-play-then-unmute.** `play()` is issued muted and the element is unmuted only in the
   `.then()`. Whatever the media pipeline does while acquiring/reconfiguring an output stream is
   inaudible.
3. **≥300 ms of silence at every chunk boundary** — `finish()` awaits `setTimeout(…, 100)` before
   resolving (`:451`), and `monitorAndPlayAudio` awaits a further `setTimeout(…, 200)` after each
   `playAudio` (`:587`). R48 §2.2 already recorded this number as a synthesis-pacing artifact; **the
   new reading is that it is also a 300 ms window in which Android can tear down and re-acquire the
   output stream with nothing audible in it.**

`stopAllAudio()` (`:476-495`) is `muted = true; pause(); currentTime = 0` — a hard cut, no ramp.

### 1.3 (c) How it stops the agent hearing itself — half-duplex by default, at the *analyser*, for the whole turn [V]

Open WebUI does **not** rely on AEC alone. `analyseAudio()` (299-378) builds the VAD graph:

```js
const audioContext = new AudioContext();
const audioStreamSource = audioContext.createMediaStreamSource(stream);
const analyser = audioContext.createAnalyser();
analyser.minDecibels = MIN_DECIBELS;      // MIN_DECIBELS = -55  (line 154)
audioStreamSource.connect(analyser);
```

**Note what is absent: `connect(audioContext.destination)`.** The chain terminates at the analyser
(see §6.1 for why that still gets rendered). The detector is a `requestAnimationFrame` loop
(`processFrame`, 320-374), and the gate is:

```js
if (muted || (assistantSpeaking && !($settings?.voiceInterruption ?? false))) {
    // Suppress mic input when muted or when assistant is speaking without interruption enabled
    analyser.maxDecibels = 0;
    analyser.minDecibels = -1;
} else {
    analyser.minDecibels = MIN_DECIBELS;
    analyser.maxDecibels = -30;
}
…
if (muted || (assistantSpeaking && !($settings?.voiceInterruption ?? false))) rmsLevel = 0;
```

- `voiceInterruption` defaults **false** (`InterfaceSettings.svelte:104,331`; UI copy: *"Allow Voice
  Interruption in Call"* / *"Let speech interrupt the assistant during a voice call."*). **Out of the
  box Open WebUI has no barge-in at all.**
- Suppression is done by collapsing the analyser's dB window to `[-1, 0]` so `domainData.some(v > 0)`
  can never fire — the mic **track stays enabled and the stream stays open** (there is an explicit
  comment at 245-247: *"hardware track muting disabled to prevent backend translation errors with
  malformed WebM files"* — they tried track-level muting and backed it out).
- `assistantSpeaking = true` is set in `chatStartHandler` (**626**), i.e. at the start of *generation*,
  and cleared only when the audio queue drains (**602**). **The deaf window therefore spans the whole
  assistant turn — LLM latency + TTS synthesis + playback — not just playback.** That is
  categorically wider than RVC's 1–2 s (R51 §2.6) and wider than anything energy-gated.
- Endpointing: first bin > 0 starts `MediaRecorder` and calls `stopAllAudio()`; **2000 ms** without a
  bin > 0 ends the turn (352-368). Capture is `new MediaRecorder(audioStream)` with **no options** —
  default codec, whole container, uploaded as one blob.

### 1.4 (d) Android-specific handling [V]

**None.** No UA branch, no `setSinkId`, no `audiooutput` in the entire `src/` tree (`grep -rn
"setSinkId|selectAudioOutput|audiooutput" src/` → 0). The only device picker in the overlay is
`videoinput`. Confirms R74 §5 at a newer SHA.

---

## 2. Two more peers with real call modes

### 2.1 Pipecat's WebSocket transport (+ Chainlit) — the shared `wavtools` layer [V]

`@pipecat-ai/websocket-transport@1.7.2` drives audio through `lib/src/media-mgmt/mediaManager.ts`,
which is a thin wrapper over a **vendored copy of `wavtools`** (the OpenAI realtime-console audio
library). **Chainlit vendors the same library** at `libs/react-client/src/wavtools/` — same class
names, same defaults. So one audio layer covers two peers.

- **(a) Constraints — none.** `wav_recorder.js:347,351`: `const config = { audio: true };` (plus
  `{deviceId: {exact: …}}` when a device is chosen, which *replaces* the object and still carries no
  processing constraints). `kBrowserDecides` ⇒ platform AEC ⇒ comm mode on Android. The permission
  pre-flight at `:266-267` is also `{audio: true}`.
- **(b) Playback — an AudioWorklet ring at a forced 24 kHz.** `mediaManager.ts:88-89`:
  ```ts
  this._wavRecorder = new WavRecorder({ sampleRate: recorderSampleRate });   // default 24000 (:84)
  this._wavStreamPlayer = new WavStreamPlayer({ sampleRate: 24000 });
  ```
  `wav_stream_player.js:29` → `new AudioContext({ sampleRate: this.sampleRate })`, `addModule` the
  `stream_processor` worklet, and `_start()` does `streamNode.connect(this.context.destination)`.
  **Two separate AudioContexts, both pinned to 24 000 Hz** — a non-native rate on effectively every
  Android device (`kDefaultTargetSampleRate = 48000`, §6.2), so Chromium inserts a resampler on both
  the capture and the render side.
  The recorder chain (`wav_recorder.js:411-423`) is `source → processor(worklet) → analyser`, and
  `analyser.connect(context.destination)` **only if `outputToSpeakers`** — which defaults **false**
  (`:26`). Same shape as Open WebUI: the capture chain terminates at an analyser.
- **(c) Echo handling — nothing page-side.** `enableMic(enable)` is user-driven only; there is no
  `isBotSpeaking` gate on capture anywhere in `media-mgmt/`. Interruption is
  `_wavStreamPlayer.interrupt()` (`mediaManager.ts:127,132`) — flush the ring, no ramp. Chainlit's
  `useAudio.ts:29` is the same single call.
- **(d) Android:** `wav_stream_player.js:30` calls `this.context.setSinkId(this._speakerID)` when a
  speaker id is set, and `updateSpeaker()` try/catches it. On Android there are no ids to set
  (§4) — dead code on a phone.

### 2.2 Hume EVI (`@humeai/voice-react`) — one shared context, worklet ring, 30 ms fade [V]

- **(a) Constraints** — `useMicrophoneStream.ts:10-16`:
  ```ts
  navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: audioConstraints.echoCancellation ?? true,
      noiseSuppression: audioConstraints.noiseSuppression ?? true,
      autoGainControl:  audioConstraints.autoGainControl ?? true, … } })
  ```
  All three default **true**, all three caller-overridable (`models/connect-options.ts:6-8`) — the
  only peer in this pass that exposes the constraint set as public API.
- **(b) Playback — `enableAudioWorklet = true` by default** (`VoiceProvider.tsx:212`), worklet
  `packages/react/src/worklets/audio-worklet-20250702.js` (**201 lines**). Clips arrive base64 over
  the socket → `convertBase64ToBlob` → `blob.arrayBuffer()` → **`audioContext.decodeAudioData(…)`**
  (`useSoundPlayer.ts:303-306`), i.e. the *context* resamples to its own rate — no hand-rolled ratio.
  The legacy path (`enableAudioWorklet:false`) is `createBufferSource()` per clip, chained on
  `bufferSource.onended → playNextClip()` (`useSoundPlayer.ts:118-171`) — an event-loop hop of silence
  between every clip, which is presumably why the worklet became the default.
- **Crucially, ONE AudioContext for both ends** — `VoiceProvider.tsx:602-612`:
  ```ts
  const sharedCtx = new AudioContext();
  sharedAudioContextRef.current = sharedCtx;
  … await player.initPlayer(devices?.speakerDeviceId, sharedCtx);
  ```
  and `useMicrophone.ts:104` `const context = sharedAudioContext ?? new AudioContext()`. The mic side
  uses that context only for an analyser (`useMicrophone.ts:63-72`: `source.connect(analyser)`, **no
  destination**) and captures with `new MediaRecorder(stream, …)` (`:119`). **Only the playback
  worklet reaches `ctx.destination`.**
- **(c) Echo handling — platform AEC only.** `mute()/unmute()` flip `track.enabled`
  (`useMicrophone.ts:188-207`) and are user-driven; nothing ties them to `player.isPlaying`. Barge-in
  is server-announced (`user_interruption` message, `VoiceProvider.tsx:360`).
- **A number worth stealing:** the worklet applies a **30 ms linear fade-out** before clearing the
  ring on interrupt (`_fadeOutDurationMs = 30`, `_fadeOutSamplesCount = 30 * sampleRate / 1000`,
  gain `1 - min(counter/count, 1)`, then `_bq.clear()` + `ended`). Every other peer in this pass cuts
  the mouth dead. **A hard cut of a ring buffer is a step discontinuity — i.e. a click.**
- **(d) Android:** `initPlayer` guards with `if (speakerDeviceId && 'setSinkId' in initAudioContext)`
  — a feature probe, dead on Android.

### 2.3 The one-line peers

- **big-AGI** — has a real Call app, and it is the **only peer here that streams TTS via Media Source
  Extensions**: `src/common/util/audio/AudioLivePlayer.ts` — `MIME_TYPE = 'audio/mpeg'`, `new
  MediaSource()` + `addSourceBuffer` + `appendBuffer`, with an accumulated-blob fallback when
  `MediaSource.isTypeSupported` is false (Firefox); the element is routed through Web Audio
  (`createMediaElementSource(this.audioElement).connect(this.audioContext.destination)`, `:39-40`) and
  the context is `close()`d at the end (`:226-227`). Its **ear is the Web Speech API**, not
  `getUserMedia` — `Telephone.tsx:211` `useSpeechRecognition('webSpeechApi', …)` — so the page issues
  no audio constraints at all and the UA owns the mic. **[V]**
- **LibreChat / AnythingLLM / LobeChat** — no call mode; bought in R51 §5 and R74 §5. **[V, bought]**
- **LiveKit / Element Call / Jitsi** — WebRTC transports: the mouth is a remote `MediaStreamTrack`
  played via `srcObject`, so playback rides NetEq's jitter buffer and the audio *is* the `remote-only`
  AEC reference by construction. Constraints + absent Android output UI bought in R74 §5; nothing new
  found here. **[V, bought]**

---

## 3. RealtimeVoiceChat — delta only

**The delta is empty.** HEAD is `9de323f1`, **2025-07-11**, and `git log -1 -- code/` returns the same
SHA — *the code tree has not changed since before R51 was written (2026-08-21)*. Re-verified at HEAD:
`tts_client_playing` set from client `tts_start`/`tts_stop` (`server.py:300,304`); the
`AudioInputProcessor.interrupted` deaf window with its 1 s / 2 s resets (`server.py:355-371,400-401`;
`audio_in.py:56,200-201`); the bare playback worklet (`ttsPlaybackProcessor.js`, **68 lines**). All of
R51 §2.6/§6.1 stands. **No new echo handling since 2026-08.** [V]

**Two corrections/additions to R51's quotation of the constraints** (`app.js:94-102`), which R51 gave
as `echoCancellation: true, noiseSuppression: true, channelCount: 1`:

```js
audio: {
    sampleRate: { ideal: 24000 },
    channelCount: 1,
    echoCancellation: true,
    // autoGainControl: true,
    noiseSuppression: true
}
```

- It **also** asks `sampleRate: { ideal: 24000 }` — omitted in R51.
- `autoGainControl` is **commented out**, i.e. deliberately off. RVC is the only peer here that
  disables AGC; Open WebUI, Hume and (by default) wavtools all leave it on.

**One playback fact R51 did not record, and it is the one that matters for crackle:**
`ttsPlaybackProcessor.js` has **zero pre-roll**. `process()` emits `ttsPlaybackStarted` the instant one
sample exists and, the moment `samplesRemaining === 0`, does `outputChannel.fill(0)` and emits
`ttsPlaybackStopped` (lines 29-42). Any network hiccup mid-utterance is rendered as silence **and**
fires a spurious "stopped" — which, because `tts_client_playing` is derived from exactly those two
messages (R51 §2.6), momentarily re-arms acoustic barge-in in the middle of the reply. A jitter
buffer would have cost ~10 lines. [V]

---

## 4. Output-device selection on Android Chrome — re-verified 2026-09-22

**Nothing has changed since R74 (2026-08). Every flag, every BCD entry, every chromestatus row is in
the same state.** [V, all fetched today]

| Probe | Value today |
|---|---|
| `runtime_enabled_features.json5:754-759` `AudioOutputDevices` | `status: {"Android": "", "default": "stable"}` — comment still *"Android support for switching audio output devices is not stable"* |
| `runtime_enabled_features.json5:5592-5597` `SelectAudioOutput` | `status: {"Android": "", "default": "test"}` — **not even on by default on desktop** |
| `runtime_enabled_features.json5:5941-5942` `SpeakerSelection` | `status: "experimental"` |
| `AudioManagerAndroid::GetAudioOutputDeviceNames` (`audio_manager_android.cc:473-491`) | still `AddDefaultDevice(device_names)` only, unless `UseAAudioPerStreamDeviceSelection()` — and that requires `device_info::is_desktop()` (`:345-350`), i.e. **never on a phone** |
| BCD `HTMLMediaElement.setSinkId` / `.sinkId` | `chrome_android: {"version_added": false, notes: "Not available due to a limitation in Android, see bug 41276355"}`; `firefox_android: false` (bug 1473346) |
| BCD `AudioContext.setSinkId` | `chrome: 110`, `chrome_android: "mirror"` — **still BCD's automatic desktop mirroring, still contradicted by the flag above; still wrong until probed** (R74 §2.1 said the same) |
| BCD `MediaDevices.selectAudioOutput` | `chrome: {version_added: false, impl_url: crbug.com/372214870}`, `firefox: 116`, `firefox_android: false` |
| chromestatus **5164535504437248** (SelectAudioOutput API) | status **"In development"**, no milestones, **last updated 2024-10-11** |
| chromestatus **5585747985563648** (`echoCancellationMode`) | desktop/android/webview/ios **141**, updated 2025-09-08 — unchanged from R74 §1.5 |

Chrome for Developers' own position, unchanged and current: *"The Audio Output Devices API is not
supported on Android (including WebView) because the Android platform does not provide the ability to
programmatically switch individual audio streams to different audio devices."* [R,
developer.chrome.com/blog/audiocontext-setsinkid]

**Does ANY project ship a working in-page output selector on Android browser?** Still **no** — now
0/8 rather than R74's 0/5. Pipecat/Chainlit (`wavtools`) and Hume both *call* `AudioContext.setSinkId`
but only behind a presence probe; Open WebUI and big-AGI have no output UI at all; Jitsi hides the
control on mobile; Element Call delegates to a native host bridge; LiveKit's
`switchActiveDevice('audiooutput')` throws.

**The answer to the owner's challenge is not "no output control", it is "output control lives on the
input selector".** R74 §2.2 already established that Android Chrome's `audioinput` deviceId *is* the
communication-device selector and moves the output with it, and `audio_manager_android.cc:482-491`
still says so verbatim today. ctrl-b already ships that lever (the call deck's route row).

---

## 5. Synthesis — where each peer lands, and what actually differs from us

**Posture table.** (a) = accept comm mode + platform AEC; (b) = EC off + half-duplex gating;
(c) = EC off + nothing.

| Peer | Posture | Mouth | Ear during the mouth |
|---|---|---|---|
| **Open WebUI 0.11.4** | **(a) + half-duplex on top** | `<audio>` element, whole MP3 blobs, muted-play, **300 ms gap per chunk** | analyser dB window collapsed for the **whole assistant turn**; barge-in OFF by default |
| **Hume EVI** | (a), pure | worklet ring, `decodeAudioData`, **30 ms fade-out** on stop | nothing page-side; server sends `user_interruption` |
| **Pipecat WS / Chainlit** (`wavtools`) | (a), pure | worklet ring @ **24 kHz forced context** | nothing page-side |
| **RealtimeVoiceChat** | (a) + a **1–2 s blind deaf window** | worklet ring, **no pre-roll**, hand-rolled Int16→Float | `interrupted` drops audio outright (R51 §2.6) |
| **big-AGI** | n/a — UA owns the mic (Web Speech API) | **MSE `audio/mpeg`** into one element via Web Audio | UA's problem |
| **LiveKit / Element Call / Jitsi** | (a) | remote WebRTC track + NetEq | AEC reference is the remote track by construction |
| **ctrl-b today** | (a) with `{ideal:"all"}`, or (c) on the headphones route | `<audio>` element, **`src` swapped per chunk, chained tight for gaplessness**, plus a transient probe element per chunk | energy-gated barge-in |

**Nobody does anything smarter that is page-reachable on Android.** Every non-WebRTC peer takes the
comm-mode trap. The three postures in the brief are the whole space; the field's only refinement is
*how much* half-duplex you add on top, and Open WebUI adds the most of anyone.

### 5.1 The differentiators that are actually ours — **our reading, evidence in §1/§6**

Open WebUI and ctrl-b are the *same* posture, the *same* element-based mouth, and the *same*
constraint resolution. Four things differ, all on our side, ordered by how well they fit "crackles
only when EC is on":

1. **Our capture chain reaches `ctx.destination`; no peer's does.** `pcmCapture.ts:416-424` —
   `createMediaStreamSource(stream).connect(node)` → `node.connect(mute)` → `mute.connect(ctx.destination)`
   (the worklet must terminate at the destination to be pulled) — plus the R75 background keepalive,
   `pcmCapture.ts:478-483`, a DC source through a tiny gain into the **same** destination, held
   audible-by-energy for the whole call. Open WebUI (`CallOverlay.svelte:301-305`), Hume
   (`useMicrophone.ts:63-72`) and `wavtools` (`wav_recorder.js:411-423`, `outputToSpeakers=false`) all
   terminate their capture chain at an **AnalyserNode** and never open a render path. §6.1 is the
   mechanism that lets them: an analyser with an upstream and no downstream is an *automatic pull
   node*. **Consequence: during a ctrl-b call, Android is asked for a second, permanently-running,
   VOICE_COMMUNICATION-usage low-latency output stream (§6.2) that no peer asks for** — one whose
   render callback runs our JS resampler every 128 frames.
2. **We swap `<audio>.src` per chunk and chain the chunks tight; Open WebUI swaps `src` per chunk and
   leaves 300 ms of silence.** `audioController.ts:832,909,1196` (`a.src = s.urls[i]; a.currentTime =
   0; play()`) against `CallOverlay.svelte:451` + `:587` (100 ms + 200 ms). Every `src` swap is a
   full media-pipeline teardown/rebuild; in comm mode the stream being re-acquired is the voice path.
   We do that back-to-back with no audible-free window; they do it inside one.
3. **We load an extra element per chunk.** `audioController.ts:400-417` `probeDuration()` builds a
   throwaway `new Audio()` with `preload="metadata"` for each chunk, called at `:684` and `:776` —
   i.e. a second concurrent media load during playback, for the scrubber's timeline.
4. **We do not ramp.** Hume's 30 ms fade is the only anti-click ramp in the field, and Open WebUI's
   muted-play-then-unmute (`:456,465`) is a cheaper cousin of the same idea. We do neither.

Items 2–4 are stream churn and are mode-agnostic in principle; item 1 is the only one whose *cost*
changes when EC engages, which is what the owner's EC-on/EC-off split points at. **None of this is
proven on the device — §7 says what would prove it.**

---

## 6. Bounded open sweep — three findings nothing above asked for

**6.1 An AnalyserNode is an automatic pull node, so a capture worklet does NOT need
`connect(ctx.destination)` to be rendered. [V]** Blink,
`modules/webaudio/analyser_handler.cc:173-194`:

```cpp
// When an AnalyserHandler is connected to a downstream node, it will get
// pulled by the downstream node, thus remove it from the context's
// automatic pull list.
…
// When an AnalyserHandler is not connected to any downstream node while
// still connected from upstream node(s), add it to the context's automatic
// pull list.
if (number_of_input_connections && !need_automatic_pull_) {
  Context()->GetDeferredTaskHandler().AddAutomaticPullNode(this);
```

This is exactly how `wavtools` gets `source → worklet → analyser` rendered with `outputToSpeakers`
false. It is the sanctioned way to run a capture worklet without a render sink, and it is *not*
folklore — it is a named mechanism in `DeferredTaskHandler` (`:121-135`).

**6.2 The flip side, and it has teeth: an automatic pull node DISABLES Chromium's silent-sink
suspender. [V]** `modules/webaudio/realtime_audio_destination_handler.cc:314-340`:

```cpp
// For other latency profiles (interactive, balanced, exact), use the
// following heristics for the FakeAudioWorker activation after detecting
// 30-seconds of silence when there are no automatic pull nodes (APN) in the
// graph.
bool needs_silence_detection = !has_automatic_pull_nodes;
```

So a context whose graph holds a terminal analyser keeps a **real hardware sink** open forever;
without one, 30 s of silence swaps in a `FakeAudioWorker` and the platform stream is released. Both
arms end with the sink open for us (our DC keepalive is never silent) — but this is the mechanism to
reason with if the destination connection is ever reconsidered, and it means **the peers are not
avoiding an output stream either; they are only avoiding putting a JS worklet inside its render
callback.**

**6.3 The Android output stream's *usage* is frozen at creation time, from a global that the mic
flips. [V]** `media/audio/android/audio_manager_android.cc:806-810` (AAudio) and `:831-834`
(OpenSLES):

```cpp
const aaudio_usage_t usage = communication_mode_is_on_
                                 ? AAUDIO_USAGE_VOICE_COMMUNICATION
                                 : AAUDIO_USAGE_MEDIA;
…
const SLint32 stream_type = communication_mode_is_on_
                                ? SL_ANDROID_STREAM_VOICE
                                : SL_ANDROID_STREAM_MEDIA;
```

`communication_mode_is_on_` is set when an input stream with `params.effects() !=
AudioParameters::NO_EFFECTS` is created (`:730-743`, and note *"Avoid changing the communication mode
if there are existing input streams"*) and cleared when the last input stream is released
(`:761-764`). **A playback stream opened before the mic — and kept alive — stays on the MEDIA path for
its whole life, even while the device sits in `MODE_IN_COMMUNICATION`.** That is a page-reachable
lever nobody in the field appears to use deliberately, and it is testable from JS: open and hold the
sink before `getUserMedia`, versus after.

**Bonus (didn't earn a slot, worth one line):** Open WebUI constructs a **new `AudioContext` per
turn** (`analyseAudio()` at `:300`, called from `startRecording()` which `stopRecordingCallback()`
re-invokes at `:197`) and **never closes any of them**; the old ones keep a terminal analyser, so by
§6.1/§6.2 they keep rendering and keep their sinks. Blink's `hardware_context_count`
(`audio_context.cc:79,546,717`) is a devtools counter with no cap, so nothing stops it. The owner's
"Open WebUI doesn't crackle" datapoint is therefore worth re-taking on a **long** call, not a short
one. [V]

---

## 7. What I could not determine

1. **The actual cause of ctrl-b's crackle.** Everything in §5.1 is a differential diagnosis from
   source, not a measurement. Nothing here was run on the Honor 20. The four candidates are
   independently testable and three of them are one-line experiments (drop `probeDuration` during a
   call; insert 200–300 ms between chunks; disconnect the capture worklet's `mute → destination` leg
   and terminate on an analyser instead — §6.1 — leaving the keepalive as the only destination
   client). **[U]**
2. **Whether Android mixes the two output streams in a way that lets one underrun corrupt the
   other.** Chromium gives the WebAudio context its own `AudioDestination` sink and media elements
   their own renderer sink; whether an underrun in the low-latency voice stream is *audible in the
   other* is an AudioFlinger/HAL question I could not settle from source. This is the weakest link in
   §5.1 item 1. **[U]**
3. **The Honor 20's actual `PROPERTY_OUTPUT_FRAMES_PER_BUFFER` and whether
   `IsAudioLowLatencySupported()` is true there** — which decides whether our WebAudio callback budget
   is ~256 frames (§8) or ~2048. `chrome://media-internals` on the phone would answer it. **[U]**
4. **Whether Open WebUI's call mode is actually clean on a long call** — §6.3's bonus says its
   AudioContext leak should make it *worse* over time, which does not match the owner's report. Either
   the report was a short call, or leaked silent contexts cost less than I think. **[U]**
5. **big-AGI's MSE path on Android Chrome** — `MediaSource.isTypeSupported('audio/mpeg')` is true on
   Android, but I did not verify that appending MP3 frames mid-stream is glitch-free there, and big-AGI
   has no mic open concurrently, so it is not a like-for-like datapoint anyway. **[U]**
6. **Firefox/Fennec's half of all of this.** R74 §6 covered routing; this pass did not look at Gecko's
   playback or silence-suspender behaviour at all. **[U]**
7. **Whether any peer has *tried* and rejected `echoCancellation: false` + half-duplex on Android.** No
   repo in this pass contains a single mention of `MODE_IN_COMMUNICATION`, SCO, A2DP or a crackle
   workaround — consistent with R74 §5's finding, but absence of evidence. **[U]**

---

## 8. The numbers that decide the design

| Number | Value | Source |
|---|---|---|
| Open WebUI inter-chunk gap | **100 ms + 200 ms = 300 ms** | `CallOverlay.svelte:451,587` [V] |
| Open WebUI end-of-turn silence | **2000 ms** | `CallOverlay.svelte:361` [V] |
| Open WebUI VAD window | `minDecibels` **-55** / `maxDecibels` **-30**; suppressed = `[-1, 0]` | `:154,325-329` [V] |
| Open WebUI barge-in default | **OFF** (`voiceInterruption ?? false`) | `InterfaceSettings.svelte:104` [V] |
| Open WebUI deaf window | **the entire assistant turn** (generation + synthesis + playback) | `:626` → `:602` [V] |
| Hume fade-out on interrupt | **30 ms**, linear, `floor(30 * sampleRate / 1000)` samples | `audio-worklet-20250702.js:126-131,161-180` [V] |
| Hume playback default | AudioWorklet (`enableAudioWorklet = true`) | `VoiceProvider.tsx:212` [V] |
| `wavtools` context rates | **24 000 Hz** recorder **and** player, both forced | `mediaManager.ts:84-89` [V] |
| RVC playback pre-roll | **0 samples** | `ttsPlaybackProcessor.js:29-42` [V] |
| RVC constraints | `sampleRate {ideal:24000}`, `channelCount:1`, `echoCancellation:true`, `noiseSuppression:true`, **AGC commented out** | `app.js:94-102` [V] |
| AudioWorklet render quantum | **128 frames** (≈2.7 ms @48 k, ≈5.3 ms @24 k) | spec; `audio-worklet-20250702.js:34-35` [V] |
| Chromium Android low-latency output buffer | `kDefaultLowLatencyOutputBufferSize` = **256** frames | `audio_manager_android.cc:80` [V] |
| Chromium Android conservative output buffer | `kDefaultOutputBufferSize` = **2048** frames | `:76` [V] |
| Chromium Android default input buffer | `kDefaultInputBufferSize` = **1024** frames | `:75` [V] |
| Chromium Android target rate | `kDefaultTargetSampleRate` = **48000** | `:1208` [V] |
| Silent-sink suspender threshold | **30 s** of silence, **only when there are no automatic pull nodes** | `realtime_audio_destination_handler.cc:314-340` [V] |
| ctrl-b constraints | `echoCancellation: onHeadphones(route) ? false : {ideal:"all"}`, `noiseSuppression: true`, `channelCount: 1` | `pcmCapture.ts:76-78` [V] |
| ctrl-b capture graph tail | `worklet → mute(gain) → ctx.destination`, **plus** a DC keepalive → `ctx.destination` | `pcmCapture.ts:423-424, 482-483` [V] |
| Android output-selection APIs | **all still off on Android**, `SelectAudioOutput` last touched **2024-10-11** | §4 [V] |
