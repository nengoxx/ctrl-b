# Voice and calls

ctrl-b can listen and talk. The **mic** in the composer turns speech into text: hold it to record a
clip, or let phrases appear as you speak with live dictation. A **call** is a hands-free conversation
with the active agent. You talk, it answers out loud, and the call keeps running with the screen off.
**Read-aloud** speaks replies through the app's text-to-speech chain, either automatically or when you
tap ▶ on a message. All of it runs over your own speech servers, and the browser only gives you the
microphone on a secure (HTTPS) page.

## How to use it

### Before you start: HTTPS gives you the mic

Browsers only open the microphone on a secure page. Open ctrl-b through its Tailscale Serve address
(`https://<host>.<tailnet>.ts.net`), not `http://<host>:5433`. On a plain-HTTP page the mic is greyed
out and tapping it says *"Mic needs a secure connection — use HTTPS via Tailscale Serve…"*. Live
dictation and calls also need HTTPS, because the browser only allows their audio pipeline on a secure
page. Setting up HTTPS is covered in [Getting started](getting-started.md).

The mic only appears when speech-to-text is configured (**Conf → Voice · STT**). The call button is the
same mic in call mode, so with no speech-to-text there is no call button either.

### Record a clip (push-to-talk)

1. **Hold** the mic button. Recording starts after a short press (about 0.15 s), and the screen stays on
   while you record.
2. **Release** to stop. The clip uploads and the transcript lands in the composer for you to review.
   With **Auto-send** on, the transcript is sent at once instead.
3. While you hold:
   - **Slide up** (about 56 px) to **lock** hands-free recording. Tap the mic to stop. While a recording is
     locked, the button at the other end of the controls row becomes a **Cancel** button. A "slide up to
     lock" hint shows the first few times (at most 3 per device).
   - **Slide left** to **cancel**. Nothing is uploaded. Releasing more than about halfway along the
     *slide to cancel* track also cancels.
4. A recording shorter than 1 second is thrown away, and you see *"Too short — hold to record"*.

On desktop the mic also works from the keyboard: Enter or Space starts and stops a recording, and
Escape cancels it.

### Live dictation (phrases as you speak)

Live dictation is **off by default**. Turn it on in **Conf → Voice · STT → Live dictation**. It uses the
same live speech server ("ear") as calls, but it does not need **Live call** to be on.

With it on, each phrase appears in the composer as soon as you pause. Nothing already written is taken
back. When you release, the app waits a moment for your last phrase (**Phrase tail wait**, 2 s), then
stops. Once at least one phrase has landed, the whole-clip upload is skipped.

- If the live connection can't be opened, the recording carries on as an ordinary clip and you see
  *"Live dictation unavailable — using standard transcription."*. On plain HTTP the message is *"Live
  dictation needs HTTPS — using standard transcription."*.
- A locked live dictation stops itself after **Dictation idle stop** (300 s) of silence, and in any case
  after **Dictation time limit** (1790 s).

### When a clip doesn't send

Clip uploads retry by themselves:

- One attempt may take the longer of **Upload timeout** (30 s) and twice the clip's own length. Up to
  **Upload attempts** (3) are made, with a short, growing pause between them.
- While the phone knows it is offline, the app waits for the link instead of using up attempts.
- While a clip is sending, the mic shows a spinner. Pressing it again (in any composer) says *"Still
  sending the last clip"*.
- If every attempt fails, or the server answers with an error, a sticky ***Clip didn't send*** notice
  appears with **Retry** and **Discard**. Retry sends the same clip again.
- If the server heard no speech, you see *"Didn't catch that — try again"*. Any other refusal shows
  *"Transcription failed (code)"* and the clip is dropped.
- If the whole speech-to-text chain is down (every server failed), the mic greys out as unavailable. It
  comes back on the next status check, for example when you return to the app or save Conf.

A clip that is still in trouble lives only in memory. If you reload or close the app before it lands,
it is lost, and the next start tells you so once: *"1 clip from the last session was lost"*.

### Start a call

Calls are **on by default** (**Conf → Live call → Enabled**) once a live speech server, speech-to-text
and text-to-speech are all configured.

1. **Tap** the mic once. It switches to call mode and shows *"Hold to call"* (tap again to switch back).
   The mic always starts in record mode when the app loads.
2. **Hold** the button. A *slide up to call* pill appears.
3. **Slide up and release** to start the call. If you release without sliding, a **Start call** chip
   stays up for 2 seconds. Tap it to start.

The call runs as the active agent, the same one your next chat message would go to. Its picture fills
the call screen.

### On the call screen

- **The phase line** shows the call's state: *Connecting…* · *Listening — go ahead* · *Thinking — tap
  to stop* · *Speaking — tap to interrupt* · *Muted* · *Call ended*.
- **The heard line** shows what the call heard you say, as the message the agent will get. A mishearing
  is visible straight away.
- **Captions** (on by default) show the reply's text above your words.
- **The ring** around the art shows the call's state (**Face ring**, on by default). With it off, the
  state rides a dot on the heard line.
- **Tap anywhere** outside the buttons to stop the agent. While it speaks, the tap interrupts it. While
  it thinks, the tap cancels that turn.
- **Mute / Unmute** and **Hang up** sit at the bottom. When a call has ended, **Call again** redials and
  **Close** leaves.
- If a tool needs your approval, an **Allow / Deny** row appears on the call screen.
- **Back** (the Android gesture) or **Escape** hangs up.

### The in-call deck: Sound, Mic, Sensitivity

Three pills above the art change **this call only**. Nothing is saved, and the Conf settings stay the
defaults for the next call.

- **Sound** picks the route. **media** (the default) leaves echo cancellation off, so the reply plays
  like music (through Bluetooth when connected, the loudspeaker otherwise). **call** uses phone-call
  mode: echo-cancelled, with the hands-free device's own mic.
- **Mic** picks the input device. On Android this list is also how you choose between the phone and a
  headset.
- **Sensitivity** shows your live level against the floor. Leave it on **Auto** or pin your own floor.
  A pin lasts only for this call. The level the call learns for your own voice is remembered on this
  device.

### Taking turns

- **Thinking pause.** After you stop talking, the call waits **Thinking pause** (2500 ms) before sending
  what you said. If you start again inside that pause, it joins the same message. Every reply starts
  this much later, so lower it if replies feel slow, or set 0 to send at once.
- **Interrupting.** By default you interrupt by tapping the screen. **Hands-free interruption**
  (off by default) lets you talk over the reply instead. It only works while the mic is open during the
  reply: always on the *call* route, and on *media* only when **Mic off while it speaks** leaves it open.
- **The mic during a reply.** **Mic off while it speaks** (*auto*) closes the ear while the reply plays,
  unless the browser's echo cancellation is on. This stops the call from hearing its own voice.

### Read-aloud

- Tap **▶** on any reply to hear it, and **⏸** to pause.
- The **speaker** in the app bar turns **auto read-aloud** on or off. It is the same switch as **Conf →
  Voice · TTS → Auto read-aloud**. It is **on by default**, it is kept **per device**, and it only shows
  when text-to-speech is configured.
- With auto read-aloud on, **only the device that sent a message speaks its reply**. Your other devices
  show the reply silently, and you can play it there with ▶.
- **Read along** (on by default) starts speaking while the reply is still being written, sentence by
  sentence. Turned off, or with **Chunking** off, a reply is spoken once it finishes.
- **Speak actions** (off by default) controls whether `*actions between asterisks*` are read aloud.

### Text-to-speech voices

Speech comes from a primary text-to-speech provider plus ordered fallbacks, set in **Conf → Voice ·
TTS**. If one fails, the next is tried. A typical setup is PocketTTS first, then Kokoro (served by
Speaches), then AllTalk. The voice id and the playback speed are set per model, on the provider's model
row.

An agent can have its own voice: the **Voice** field in its editor takes a voice id from your
text-to-speech server. The field shows while roleplay is on, or whenever it already has a value. Blank
means the global voice. A wrong id shows up as an error on the first read-aloud, never as a silent
switch to another voice. Out of the box no agent sets one.

## Settings that affect it

Most settings live in **Conf → Voice · STT**, **Voice · TTS** and **Live call**. Call settings are read
when a call starts, so a change applies to the next call. Every key is described in the
[configuration reference](configuration-reference.md#voice).

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`voice.enabled`](configuration-reference.md#voice) | Master switch for every voice feature. | on | live |
| [`voice.stt.provider` / `fallbacks`](configuration-reference.md#voicestt) | Which speech-to-text servers transcribe clips, in order. | none (mic hidden) | live |
| [`voice.stt.auto_send`](configuration-reference.md#voicestt) | Send the transcript at once instead of filling the composer. | off | live |
| [`voice.stt.auto_stop`](configuration-reference.md#voicestt) (+ `auto_stop_silence_s`, `auto_stop_threshold`) | End a clip after a run of silence. | off (3 s, 0.01) | live |
| [`voice.stt.upload_timeout_s`](configuration-reference.md#voicestt) | Floor for one upload attempt; a long clip gets twice its own length. | 30 s | live |
| [`voice.stt.upload_attempts`](configuration-reference.md#voicestt) | Tries before a clip waits in the Retry / Discard notice. | 3 | live |
| [`voice.stt.language`](configuration-reference.md#voicestt) | Forces a transcription language on a Whisper server. Parakeet ignores it. | `en` | live |
| [`voice.stt.vad_filter` / `hotwords`](configuration-reference.md#voicestt) | Whisper-only extras; no effect on Parakeet or the realtime ear. | on / blank | live |
| [`voice.live.dictation`](configuration-reference.md#voicelive) | Live dictation (phrases as you speak). | off | live |
| [`voice.live.tail_wait_ms`](configuration-reference.md#voicelive) | How long a live dictation waits for your last phrase. | 2000 ms | live |
| [`voice.live.dictation_idle_s` / `dictation_max_s`](configuration-reference.md#voicelive) | Idle stop and time limit for a live dictation. | 300 s / 1790 s | live |
| [`voice.live.release_tail_ms`](configuration-reference.md#voicelive) | Keeps recording briefly after you let go, so the last word isn't clipped. | 400 ms | live |
| [`voice.live.enabled`](configuration-reference.md#voicelive) | Calls on or off. | on | next call |
| [`voice.live.provider`](configuration-reference.md#voicelive) | The live speech server ("ear"). Blank means the same as `voice.stt`. | blank | next call |
| [`voice.live.turn_hold_ms`](configuration-reference.md#voicelive) | The **Thinking pause**. | 2500 ms | next call |
| [`voice.live.barge_in`](configuration-reference.md#voicelive) | **Hands-free interruption**. | off | next call |
| [`voice.live.mic_hold`](configuration-reference.md#voicelive) | **Mic off while it speaks** (auto · on · off). | auto | next call |
| [`voice.live.route` / `input_device`](configuration-reference.md#voicelive) | The default **Sound** route and **Mic** for a call. | media / system default | next call |
| [`voice.live.ring` / `captions`](configuration-reference.md#voicelive) | The ring and the reply captions on the call screen. | on / on | next call |
| [`voice.live.background`](configuration-reference.md#voicelive) | **Keep the call in the background** when you lock or switch apps. | on | next call |
| [`voice.live.background_keepalive`](configuration-reference.md#voicelive) | **Keep the ear awake**: an inaudible tone that stops the phone freezing a background call. | on | next call |
| [`voice.live.background_idle_s`](configuration-reference.md#voicelive) | A background call with no speech and no reply ends after this long (0 = never). | 600 s | next call |
| [`voice.live.max_session_s`](configuration-reference.md#voicelive) | The call time limit. | 1800 s | next call |
| [`voice.live.debug` / `trail_keep`](configuration-reference.md#voicelive) | Debug readout, call trails and audio captures; how many trails to keep. | off / 20 | next call |
| [`voice.tts.provider` / `fallbacks`](configuration-reference.md#voicetts) | Which text-to-speech servers speak, in order. | none (no read-aloud) | live |
| [`voice.tts.chunking` / `chunk_read_along`](configuration-reference.md#voicetts) | Speak sentence by sentence, and start while the reply streams. | sentence / on | live |
| [`voice.tts.speak_actions`](configuration-reference.md#voicetts) | Read `*actions*` aloud. | off | live |
| [`voice.tts.background_keepalive` / `background_idle_s`](configuration-reference.md#voicetts) | **Speak while in the background**: keeps the page awake while a reply or clip upload is pending; how long without progress before it lets go. | on / 600 s | live |
| **Auto read-aloud** (app-bar speaker) | Speak each reply you sent from this device. | on | live, this device only (stored in the browser, not in `config.yaml`) |

## Edge cases & limits

- **Locked phone or app switch.**
  - A **call** keeps running (**Keep the call in the background**). Closing the tab still ends it. If the
    ear stopped hearing while you were away, the call says *"the ear was asleep — nothing said while away
    was heard"* and reconnects. Locked-phone behaviour is still being checked on real devices; see
    [ISS-73](../ISSUES.md).
  - A **live dictation** (or a clip with **Auto-stop mic** on) **stops when the page is hidden**. This is
    by design. Phrases already in the composer stay. For hands-free use with the screen off, use a call.
  - A **reply** pending when you lock the phone can still be spoken, through **Speak while in the
    background**. This does not apply during a call, which handles its own audio.
- **One live session at a time.** Calls and live dictations share one live slot on the server. A second
  device gets *"another call is active"*. Starting a call stops any recording in progress on the same
  device.
- **Two devices, one conversation.** Only the device that sent a message auto-speaks the reply. The
  others stay silent unless you tap ▶.
- **Time limits.** A call ends at 30 minutes with *"call time limit reached"*, and **Call again** starts a
  new one. A background call with nothing happening ends after 10 minutes (*"the call sat idle in the
  background"*). A pending approval pauses that clock.
- **A dropped connection.** The call redials by itself for about 14 seconds before it gives up with *"lost
  the connection"*. A live dictation that loses its connection after at least one phrase keeps what
  landed, but the rest is lost: *"Voice connection lost — the rest of that wasn't captured"*.
- **If the speech servers are down.**
  - With the **live ear** down, a call can't connect and ends with **Call again**.
  - A **clip** walks its own fallback chain. If every server fails, the clip waits in **Clip didn't send**
    and the mic greys out as unavailable.
  - If **text-to-speech** fails during a call, the call says *"voice failed — the reply is text only"*.
- **No `voice` extra installed.** Without the backend's `[voice]` extra, speech-to-text reports itself
  unconfigured. You get no mic button, and so no call button.
- **The live ear needs a realtime server.** Calls and live dictation talk to a Speaches-style realtime
  endpoint (`<base_url>/realtime`). A blank `voice.live.provider` reuses `voice.stt`. If `voice.stt`
  points at a Parakeet server, which has no realtime endpoint, calls fail. In that case set
  `voice.live.provider` to your Speaches provider explicitly.
- **Phone call mode raises background voices.** On the **call** route, the phone's call processing
  (automatic gain) can lift a TV or other voices in the room to the level of your own, and the
  sensitivity gate cannot tell them apart. The **media** route is the default for this reason. See
  [ISS-63](../ISSUES.md), and [ISS-16](../ISSUES.md) for the call-route crackle on some phones.
- **Call trails (diagnostics).** With **Call debug readout** (`voice.live.debug`) on, every call writes a
  trail to `$CTRLB_HOME/calls/<call-id>.jsonl`, plus a 16 kHz recording of what the ear heard (about 2 MB
  a minute, including anyone audible) as `<call-id>-<leg>.wav` beside it. Live dictations write to
  `calls/dictation/`, push-to-talk clips to `calls/clip/`, and the background-playback check to
  `calls/mouth/`. The files are readable only by the server's user. Each folder keeps the newest
  **Trails kept** (20). The file name is the call id, so the newest file is your last call:
  `ls -t $CTRLB_HOME/calls/ | head`. Trails are off by default.
- **On v1.7.11** (the release before these changes): clip uploads are a single try with no Retry /
  Discard, the thinking pause defaults to 0, every device auto-speaks every reply, a pending reply does
  not keep a locked phone awake, and clip trails do not exist.

## Under the hood

Design: [`docs/LIVE_VOICE_PLAN.md`](../LIVE_VOICE_PLAN.md) (the call loop, the mouth) · [`docs/ASR_PLAN.md`](../ASR_PLAN.md) (the ear, transcription)
