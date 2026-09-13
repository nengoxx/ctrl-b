# R70 — Phrase-by-phrase streaming dictation: our ear measured, and how the field fills a composer by voice

**Date:** 2026-09-13
**Status:** Draft dossier — complete for the bounded question. Nothing is built; not a decision.
**What drove it:** the owner's ask at the S0.5 handoff ("text fills the composer as I talk", the
Claude Code dictation experience named as the reference) and their 2026-09-13 ruling that
word-by-word is off the table for now while **phrase-by-phrase riding the S1 relay** is a ratified
planned feature ([`../LIVE_VOICE_PLAN.md`](../LIVE_VOICE_PLAN.md) §8 item 5 tier **(b)**).
**Drove:** (open) — the phrase-dictation slice's design, and **three corrections to the pinned
Speaches contract in LIVE_VOICE_PLAN §7-S0 / §4.1 that also bind the CALL loop** (§1 below).

**Reference class.** Agent-chat/LLM apps first (Claude Code, ChatGPT, open-webui, LibreChat,
AnythingLLM), plus the dictation-first product class the owner's ask points at (Wispr Flow,
superwhisper, Gboard) and the streaming-STT API class that sets the vocabulary (OpenAI Realtime,
Deepgram). Open-source peers read at source; closed ones are secondary and marked.

**Confidence markers:** **[V] VERIFIED** = source read at a pinned ref, or an endpoint probed by me
today on emma. **[R] REPORTED** = secondary source. **[U] UNVERIFIED** = expected, not checked.

---

> ### Headline — four premise corrections, all measured on OUR server today
>
> **① "One final per pause" is FALSE for our ear. The endpoint rule is a 3-SECOND BUFFER rule, not
> a silence rule.** [V, source + probe] `input_audio_buffer_event_router.vad_detection_flow` runs
> Silero over **only the last 3 s of the current buffer** and can emit `speech_stopped` only when
> the buffer is **already longer than 3000 ms**. A 900 ms conversational pause after a 1.7 s phrase
> produces **no final at all** — probed: three phrases with 900 ms gaps streamed at realtime pace
> yielded **ONE** transcript covering two of them. `silence_duration_ms` (the §4.1 `silence_ms`
> knob, default 700) is only Silero's `min_silence_duration_ms` *inside* that window; it cannot
> make an endpoint happen before the buffer passes 3 s. Effective latency from end-of-phrase to
> text ≈ **max(silence_ms, 3000 − phrase_ms) + ~0.5 s**, so short phrases are the slow ones.
>
> **② A forced `input_audio_buffer.commit` while speech is open KILLS THE SESSION and loses the
> words.** [V, source + probed twice] `InputAudioBuffer.data_w_vad_applied` asserts
> `audio_end_ms is not None`; after `speech_started` with no `speech_stopped` that assert fires
> inside the transcriber task, `commit_and_transcribe` catches only `openai.APIStatusError`, and
> the TaskGroup tears the session down — **bare 1006, no transcript**. S0's "forced commit → `''`"
> proof was on SILENCE only (`audio_start_ms is None` → the early return), so the plan's pinned
> contract generalises a safe case into an unsafe one. **Commit is safe only when no
> `speech_started` has been seen since the last `committed`.** This binds the call loop too.
>
> **③ The working flush is a SILENCE BURST, and it is fast.** [V, probed] Instead of committing,
> stream zero-frames as fast as the socket takes them: the buffer crosses 3 s instantly, Silero
> sees a closed segment, the server commits itself. Measured **release → text in 530–830 ms**
> (three arms), versus 1.5 s+ and a merged transcript for the natural cadence. This is the release
> semantic, and it should live in the **relay**, not the phone (§4).
>
> **④ The dictation-first products the owner is implicitly comparing against are NOT streaming.**
> [R] Wispr Flow and superwhisper are hold → release → *whole formatted text pasted at the cursor
> in under two seconds*. The one peer that genuinely streams into the prompt is **Claude Code**,
> and it does so with **word-level partials rendered dimmed until finalised** — a capability our
> ear does not have (R51 §6.4 gap 1, R68 §1.1, re-verified). Phrase-level appends are a third
> thing; §2.6 states honestly what they will and will not feel like.

---

## 0. Sources, pinned

| Source | Ref / version | Read |
|---|---|---|
| **speaches (the owner's local fork)** `~/github/speaches` | `e093d8b` (HEAD; upstream `993994f`) — `realtime/input_audio_buffer.py`, `realtime/input_audio_buffer_event_router.py` | 2026-09-13 |
| **Live probe — emma Speaches `:9000`** | resident `istupakov/parakeet-tdt-0.6b-v3-onnx`; Kokoro-82M-v1.0-ONNX used to synthesise the clips | 2026-09-13 |
| **Claude Code voice dictation** (official docs) | `code.claude.com/docs/en/voice-dictation`, incl. version notes up to v2.1.231 | 2026-09-13 |
| **open-webui** | `main` — `chat/MessageInput/VoiceRecording.svelte`, `chat/MessageInput.svelte` | 2026-09-13 |
| **LibreChat** | `main` — `client/src/hooks/Input/useSpeechToText{,Browser,External}.ts` | 2026-09-13 |
| **OpenAI Realtime transcription guide** | `developers.openai.com/api/docs/guides/realtime-transcription` | 2026-09-13 |
| **Deepgram** Finalize / UtteranceEnd / Endpointing docs | `developers.deepgram.com/docs/{finalize,utterance-end,endpointing}` | 2026-09-13 |
| **Gboard advanced voice typing** | `support.google.com/gboard/answer/11197787` | 2026-09-13 |
| ctrl-b | working tree at `79e8bad` — `hooks/useDictation.ts`, `kit/composer/useMicGesture.ts`, `store/composer.ts`, `hooks/useComposer.ts` | 2026-09-13 |
| Already-bought, not re-read here | [R51](./R51-realtime-voice-chat.md) §2/§5/§6, [R68](./R68-live-voice-deltas.md) §1, [R69](./R69-hold-to-record-gesture.md) §1/§9 | — |

Probe scripts were throwaway (scratchpad `~/.cache/tmp/r70/`): a multi-phrase realtime streamer and
a four-arm release-semantics probe, both read-only against the already-running server and the
already-resident model. No secret was printed or written.

---

## 1. OUR ear, measured — the numbers that decide this design

### 1.1 The endpoint mechanism, read at source [V]

`realtime/input_audio_buffer.py`:

```python
SAMPLE_RATE = 16000
MS_SAMPLE_RATE = 16
MAX_VAD_WINDOW_SIZE_SAMPLES = 3000 * MS_SAMPLE_RATE      # == 3 s at 16 kHz
```

`realtime/input_audio_buffer_event_router.py`:

```python
MIN_AUDIO_BUFFER_DURATION_MS = 100  # based on the OpenAI's API response
...
audio_window = input_audio_buffer.data[-MAX_VAD_WINDOW_SIZE_SAMPLES:]
speech_timestamps = to_ms_speech_timestamps(get_speech_timestamps(audio_window, ...,
    VadOptions(threshold=..., min_silence_duration_ms=turn_detection.silence_duration_ms,
               speech_pad_ms=turn_detection.prefix_padding_ms)))
speech_timestamp = speech_timestamps[-1] if len(speech_timestamps) > 0 else None
...
else:  # a speech_started has already fired for this buffer
    if speech_timestamp is None:                       # (a) nothing at all in the last 3 s
        ... return InputAudioBufferSpeechStoppedEvent(...)
    elif speech_timestamp.end < 3000 and input_audio_buffer.duration_ms > 3000:  # FIX: magic number
        ... return InputAudioBufferSpeechStoppedEvent(...)
```

Reading, stated plainly: once `speech_started` has fired for the current buffer, a stop needs
**either** no speech at all in the trailing 3 s **or** (the last speech segment already closed by
Silero **and** the whole buffer longer than 3 s). Every `speech_stopped` rotates the buffer
(`ctx.audio_buffers.rotate()`), so the 3 s clock **restarts for every utterance**, and ingest
resamples 24 kHz → 16 kHz per append (our relay's 24 kHz target is unaffected).

**Derived latency law** (matches every probe below):

> `t_final ≈ max(speech_end + silence_ms, buffer_start + 3000) + t_transcribe`
> with `t_transcribe` measured at **0.45–0.70 s** through the realtime loopback door.

| Phrase length | Earliest text after you stop that phrase |
|---|---|
| 1.0 s | ~2.0 s + 0.5 s = **~2.5 s** |
| 2.0 s | ~1.0 s + 0.5 s = **~1.5 s** |
| ≥ 2.5 s | `silence_ms` (0.7 s) + 0.5 s = **~1.2 s** |
| any, with the §4 relay flush | **~0.5–0.8 s** |

### 1.2 The probes [V — run 2026-09-13 on emma]

**Natural cadence, three phrases, 900 ms gaps, streamed at realtime pace (40 ms frames):**

```
[  443.7 ms] input_audio_buffer.speech_started          (speech begins at 300 ms ⇒ ~144 ms detect lag)
[ 5733.7 ms] input_audio_buffer.speech_stopped          (phrase 2 ended at 4699 ms ⇒ 1.03 s late)
[ 6216.2 ms] ...transcription.completed
             "Okay so I need you to wake up. Course air and then check it's uptime."
```
→ **ONE final for two phrases; the 900 ms gap between them produced nothing.** Phrase 1 ended at
1964 ms with the buffer at 2.66 s (< 3 s) so no stop could fire; by the time the buffer crossed 3 s
phrase 2 was already open. Exactly the §1.1 law.

**Release semantics, four arms** (`frag2` = a 2.79 s phrase; "burst" = zero-frames sent with no
pacing):

| Arm | Move at release | Result |
|---|---|---|
| **A** | `input_audio_buffer.commit` **mid-speech** | `committed` → `conversation.item.done` → **socket dead 1.5 ms later (1006). NO transcript.** Reproduced 2/2. |
| **B** | burst 3.5 s of silence (buffer only 1.46 s of real audio) | `speech_stopped` +157 ms, final at **+625 ms after release**: `'I want the text to appear in the'` |
| **C** | burst 1.5 s of silence (buffer ~3.0 s) | `speech_stopped` +53 ms, final at **+530 ms**: `'I want the text to appear in the composer while I talk.'` |
| **D** | two phrases + 900 ms gap, then burst 3.5 s | ONE final at **+829 ms**: `'Okay so I need you to wake up. Course air and then check its uptime.'` |

Arm A's mechanism is source-visible: `data_w_vad_applied` does
`assert self.vad_state.audio_end_ms is not None` and `_handler` has no guard, so the
AssertionError escapes `commit_and_transcribe`'s `except openai.APIStatusError` and kills the
event TaskGroup. **This is the same failure class as the S0 `LOOPBACK_HOST_URL` defect, and it is
reachable by the design as currently written.**

Other pins confirmed in passing: sending the full five-field `turn_detection` still produces the
spurious `prefix_padding_ms` "not supported" error while `session.updated` lands (S0's pin holds);
manual commit under `MIN_AUDIO_BUFFER_DURATION_MS = 100` returns an `invalid_request_error` rather
than dying; detection lag `speech_started` − real speech onset measured **96 / 143 / 184 ms**.

### 1.3 What the finals actually look like — Parakeet's casing and punctuation [V, 11 clips]

Transcribed through the same server, warm:

| Spoken | Returned |
|---|---|
| "so the thing is" | `So the thing is` |
| "I want the text to appear in the composer while I talk" | `I want the text to appear in the composer while I talk.` |
| "yes" | `Yes.` |
| "can you check whether the server is online" | `Can you check whether the server is online?` |
| "and then, um, maybe restart it" | `And then um, maybe restart it.` |
| "okay so I need you to wake up" | `Okay, so I need you to wake up.` |
| "corsair and then check its uptime" | `Course air and then check its uptime.` |
| "and tell me if" | `And tell me if` |
| "set the timeout to thirty seconds" | `Set the timeout to 30 seconds.` |

**Every final is sentence-cased at the first word. Most — but not all — carry terminal punctuation;
the exceptions were the two clips that end mid-clause.** Numbers are normalised to digits, fillers
are partly cleaned, internal commas appear. No leading or trailing whitespace on any final.

Round-trip time, warm, direct HTTP door: **0.31 s (0.73 s clip) · 0.32 s (1.05 s) · 0.36 s
(2.79 s) · 0.42 s (2.45 s)** — a near-constant ~0.3 s floor, RTF ≪ 1. Through the realtime path
(which goes out through the loopback HTTP door) the same work measured 0.47–0.69 s.

**"corsair" → "Course air"** is the one quality miss. The HTTP STT adapter already passes
`hotwords` via `extra_body` (R51 §1); the realtime session honours `instructions` but there is no
evidence it reaches Parakeet. Fleet host names are exactly the vocabulary this app dictates — see
§10 gap 4.

---

## 2. The peer dissection — who streams text into an editable composer, and how

### 2.1 Claude Code `/voice` — the owner's named reference [V, official docs]

The only peer in the class that genuinely fills the prompt while you speak, and it is **word-level
partials over a WebSocket**, not phrase appends:

- "Your speech appears in the prompt **as you speak, dimmed until the transcript is finalized**."
- Two modes, both bound to one key (`voice:pushToTalk`, default `Space`): **hold** (default;
  push-to-talk, release finalises) and **tap** (tap to start, tap to send).
- Hold detection watches for terminal key-repeat, so there is a **warmup** with a `keep holding…`
  footer, then `listening…`. The first couple of repeat characters typed during warmup are
  **removed automatically** when recording activates.
- "The transcript is **inserted at your cursor position** and the cursor stays at the end of the
  inserted text, so you can **mix typing and dictation in any order**. Hold `Space` again to
  **append another recording**, or move the cursor first to insert speech elsewhere."
- Auto-send: hold mode inserts and waits for Enter by default; `"autoSubmit": true` sends on
  release **only when the transcript is at least three words long**. Tap mode auto-submits on the
  same **three-word** floor — "Shorter transcripts are inserted but not submitted, so an accidental
  tap does not send a stray word." (Word counting is special-cased for ja/zh/th.)
- Tap mode stops recording automatically after **15 s of silence or 2 minutes total**.
- While recording, "the prompt cursor becomes **a bar that rises and falls with your microphone
  level**", suppressed under `prefersReducedMotion`.
- Teaching budget: the `hold space to speak` hint shows "for the first three sessions" and only
  when the prompt is empty.
- Recognition hints: "your current project name and git branch name are added as recognition hints
  automatically"; the model is tuned for `regex`, `OAuth`, `JSON`, `localhost`.
- Failure handling worth stealing: **three capture failures within 10 s pauses dictation** until
  10 s after the first; a WebSocket upgrade rejection is **retried once for a non-4xx status and
  never for a 4xx**, with a distinct message per class; "No speech detected" and "No audio detected
  from microphone" are deliberately different errors from "Voice connection failed".

### 2.2 open-webui [V, source]

`VoiceRecording.svelte`: the browser engine runs `SpeechRecognition` with `continuous = true` and
accumulates **`transcription = `${transcription}${transcript}`` — concatenation with no separator
at all**, relying on Chrome's leading-space convention. Recognition is stopped by an inactivity
timer: `const inactivityTimeout = 2000; // 3 seconds` (the comment is stale; the value is 2 s).
Nothing reaches the composer during recording — only `onend` dispatches
`onConfirm({ text: transcription })`.

The composer form is rendered `class="... {recording ? 'hidden' : ''}"` — **the input is hidden
while recording**, so edit-concurrency is solved by removing the field. `onConfirm` then calls
`insertTextAtCursor(text)` (a real cursor insert, no spacing normalisation) and sends the whole
prompt if `settings.speechAutoSend`. Cancel detaches `onend` "so cancelling does not confirm the
transcription" — the same discard-flag shape as our `discardRef`. It also takes a **Wake Lock for
the duration of the recording**.

### 2.3 LibreChat [V, source] — the negative lesson

`useSpeechToTextBrowser.ts` does, on every interim tick, `setText(interimTranscript)` and on final
`setText(finalTranscript)`. **Whole-field replacement.** `interimTranscript` is only the current
unstable fragment, so an interim tick clobbers both previously-finalised speech and anything the
user typed; there is no cursor preservation and no append. Auto-send is a delay, not a gesture:
`setTimeout(() => onTranscriptionComplete(finalTranscript), autoSendText * 1000)`, `-1` = off.
The external (upload) hook auto-stops on `timeSinceLastSound > 3000` against a user-set
`minDecibels` (R51 §5 already recorded this). AnythingLLM's constant is
`SILENCE_INTERVAL = 3_200` (R51 §5).

### 2.4 ChatGPT [R]

Composer dictation ("live dictation", all plans): tap the mic, "the transcript appears in the chat
as you go"; the models behind it moved from Whisper to `gpt-4o-transcribe`/`-mini`. No primary
source read; treat the "as you go" granularity as unverified. Advanced Voice is a separate mode and
is not composer dictation.

### 2.5 The dictation-first products [R]

Wispr Flow and superwhisper both ship **hold-to-dictate / release-to-process**: "text appearing at
the cursor position in under two seconds from release", with an LLM cleanup pass (filler removal,
punctuation, per-app formatting) between the audio and the paste. Neither streams partials into the
target field. This is the single most important field fact for expectation-setting: the products
people call "the best dictation" are **tier (a) done fast and clean**, not tier (b) or (c).

Gboard [V, Google support]: automatic punctuation as you speak (toggleable), "**Type even if the
mic is still on**", and voice-command editing ("Insert X before Y", "Delete X") gated to Pixel 8+
en-US. No stated session timeout; you stop by tapping the mic, closing the keyboard, or saying
"Stop".

### 2.6 The streaming-STT API class — the vocabulary and the two contracts [V/R]

- **OpenAI Realtime transcription** [V, docs]: partials are
  `conversation.item.input_audio_transcription.delta`, finals are
  `...transcription.completed` — the exact event our fork emits, minus the delta. Their production
  checklist asks you to "**Decide how your UI should revise partial text when later deltas correct
  earlier text**" and to reconcile by `item_id` because ordering between completions is not
  guaranteed. Their own guide disables automatic turn detection and **explicitly commits each
  turn**. Five delay levels (`minimal`…`xhigh`) with **no published millisecond values** —
  "benchmark with representative audio instead of assuming a fixed timing per level".
- **Deepgram** [R, docs]: `Finalize` is the documented *mid-stream* flush ("forces the server to
  immediately process any unprocessed audio"; results carry `from_finalize: true`), while
  `CloseStream` is the end-of-stream flush — "CloseStream should be used instead of Finalize to
  close your audio stream". `utterance_end_ms` must be **≥ 1000** because interim results are
  emitted about once per second.

**The field norm for release is therefore: flush and take the tail, never discard it.** Our ear has
no `Finalize`; §4 says what replaces it.

---

## 3. The join problem

**What peers do.** Claude Code inserts at the cursor and leaves the caret at the end of the
insertion, with no described normalisation (its partials stream into one continuous stream, so the
join is inside the model, not the client). open-webui concatenates recognition results with **no
separator**. LibreChat replaces. Nobody in the class does casing or punctuation surgery on an
appended chunk. There is no field precedent for de-capitalising a chunk.

**What our finals give us** (§1.3, measured): every chunk arrives sentence-cased, most carry
terminal punctuation, none carry surrounding whitespace. The naive join is therefore already
correct in the common case, because **the pause that produced the endpoint usually IS a sentence
boundary** — and with the §1.1 law the pause is *at least* 0.7 s and often longer, which makes it
even more likely to be a real boundary:

```
"Okay, so I need you to wake up." + " " + "Course air and then check its uptime."
```

The bad case is a mid-clause pause: `"And tell me if"` + `"Anything looks wrong."`. This is exactly
what a *smart* join would try to fix — and a smart join is the wrong trade:

- Lower-casing chunk N+1 when chunk N has no terminal punctuation would produce
  `"And tell me if anything looks wrong."` ✔ but would also produce
  `"So the thing is corsair is offline"` when the user genuinely started a new sentence after a
  fragmentary one ✘, and it would corrupt proper nouns, acronyms and `JSON`/`OAuth`-shaped words at
  the chunk head.
- Every such rule is language-specific, and Parakeet v3 is multilingual.
- The consumer is an LLM. `"And tell me if Anything looks wrong."` costs nothing downstream; the
  owner reading their own draft costs one tap to fix.

**Recommended join rule: `appendDraft(text)` unchanged — trim the chunk, single ASCII space
separator, never modify the chunk's casing or punctuation, never touch the text already in the
draft.** `store/composer.ts:48` already implements exactly this
(`const cur = state.draft.trimEnd(); setDraft(cur ? `${cur}${separator}${add}` : add)`), including
the correct empty-draft case. This is the "don't duplicate an existing pattern" answer: there is
nothing to build.

One optional refinement, cheap and safe, if the owner dislikes the mid-clause seam: **suppress the
space when the previous character is an opening bracket or the chunk begins with a closing
punctuation mark**. Not recommended for v1 — it is unreachable in practice with sentence-cased
finals.

---

## 4. Release semantics — the last utterance

**The question:** the user releases mid-phrase. Force-commit and wait for the tail, or discard it?

**The field's answer is unanimous: never discard.** Claude Code finalises on release (the held
audio is one stream, nothing is lost). Deepgram's `CloseStream` returns the final for the remaining
buffered audio. Wispr/superwhisper *are* nothing but the tail. open-webui's `stopRecording` still
lets `onend` confirm; only an explicit cancel detaches it.

**Our mechanism, decided by the probes:**

1. **`input_audio_buffer.commit` is forbidden whenever the current buffer has an open speech
   segment** — it is not "the forced-commit semantic", it is a session kill (§1.2 arm A). Safe
   only when no `speech_started` has arrived since the last `committed`, which the relay can track
   exactly from the event stream it already relays.
2. **The flush is a silence burst.** On release the client stops sending microphone audio; the
   **relay** appends `max(3000 − fed_ms_since_last_commit, silence_ms) + 200 ms` of zero-frames as
   fast as the loopback takes them. Measured tail: **530–830 ms from release to the final**, across
   a 1.26 s buffer, a 2.79 s buffer and a 4.57 s two-phrase buffer.
3. **The burst must live in the relay, not the phone.** Our own §3.1 wire rules enforce a
   message-rate ceiling of "sustained excess over ~2× the nominal `1000/frame_ms` per second is a
   protocol-error close" — an 88-frame burst in 3 ms is a flagrant violation of our own protocol.
   Putting the flush behind a typed `{"type":"flush"}` control message keeps the burst off the
   metered leg, keeps every Speaches quirk on the side of the wire that owns the ear's contract,
   and gives the client one thing to await.
4. **Bound the wait.** `tail_wait_ms`, config, **default 2000** — ~2.4× the worst measured tail,
   comfortably inside a human's patience for a "finishing…" state, and short enough that a dead
   ear does not hang the gesture. On expiry: keep everything already appended, surface the loss,
   fall back per §8.
5. **The floor still applies.** `MIN_CLIP_MS = 1000` stays the pre-flight on the hold itself (a
   sub-second hold never opens a socket and teaches instead, R69 §2 / the OF-4 bubble). But a
   phrase final that has already been appended is never retracted by a short release.

---

## 5. Edit concurrency — the composer stays editable

**Three field postures:** open-webui **hides the field** while recording. Claude Code lets you
"mix typing and dictation in any order", inserting at the caret and leaving the caret after the
insertion. Gboard: "Type even if the mic is still on". LibreChat clobbers everything (the negative
case).

**Our two stages differ and should be treated differently:**

- **`hold`** — the finger is on the mic. Typing is physically impossible, so there is no
  concurrency problem to solve; appending at the end of the draft is unambiguous.
- **`locked`** — hands-free, the field is reachable. This is the real case.

**The hazard, named:** the composer textarea is **controlled** (`value={draft}` in
`kit/composer/Composer.tsx:95`, fed by `useComposer`'s `useDraft()`), so an `appendDraft` landing
while the textarea is focused re-assigns `.value` and — in every engine I am aware of — collapses
the selection to the end of the field. A user editing a word in the middle of the draft would have
their caret yanked away mid-edit, ~once per phrase. **[U] Not measured in Chrome/Fennec on this
codebase — this must be probed in the build before a mitigation is chosen.**

**Recommendation:**
- **Append at the END, never at the caret.** Claude Code's caret insert is right for a single
  finalised insertion driven by a key release; ours arrive unbidden every couple of seconds, and
  "speech lands wherever the caret happens to be" is worse than "speech lands at the end". This
  also keeps `appendDraft` as the one seam, unchanged.
- **Preserve the selection across an append when the field is focused and the caret is not already
  at the end** — save `selectionStart/End` before the store write, restore in a layout effect. One
  small, testable addition local to the composer variant(s), gated on "a streaming dictation is
  live" so nothing else in the app changes behaviour.
- **Do not lock or hide the field.** open-webui's posture is cheaper but it contradicts the whole
  point of the feature (watch the text arrive, fix a word, keep talking) and contradicts the S0.5
  round-3 ruling that a written draft must stay visible (the lifted slide-to-cancel track).
- **Keep the field scrolled to the bottom on append** and **never steal focus** — open-webui calls
  `focus()` on every result; we should not, because a locked-mode user may deliberately be
  elsewhere (or have the keyboard closed).

---

## 6. Auto-send semantics with a live-filling draft

**The composition question:** `stt_auto_send` today reads the whole draft after the append and
routes it (`useDictation.ts:269-277` — `getDraft().trim()` → `runComposer(full)` → `clearDraft()`
only if it routed). With phrases landing continuously, "auto-send" must mean something.

**The field:** Claude Code sends **once, on release**, gated on a **three-word** floor (both modes).
open-webui sends **once**, after `insertTextAtCursor`, if `speechAutoSend`. LibreChat sends once,
`autoSendText` seconds after the final. **Nobody sends per phrase** — and it is obvious why: a
per-phrase send turns one thought into three messages and three turns.

**Recommendation: auto-send fires exactly once, when the dictation session ENDS** — i.e. after the
§4 flush resolves (or `tail_wait_ms` expires) — and sends the whole draft exactly as today. The
existing composition survives untouched: the gesture is capture ergonomics, the send policy is
`stt_auto_send`, and §7-S0.5's coherence-sweep rule ⑩ ("release composes with `stt_auto_send`;
gesture ≠ send policy") holds verbatim. In `locked` mode the session ends on the tap-to-stop, which
is the same event.

**Optional, and I would take it:** adopt Claude Code's **three-word floor** for auto-send only —
it is the cheapest guard against a mishear ("Yes.") becoming a turn, it is field-proven, and it
composes with, rather than replaces, our 1000 ms clip floor. Config, not a constant.

---

## 7. Visual affordances — "still listening / phrase pending"

We already own most of this from S0.5, and the field's vocabulary maps onto it one-for-one:

| Need | Field | Ours, already shipped |
|---|---|---|
| "the mic is open" | Claude Code `listening…` footer; open-webui's visualiser | the 1.65× record circle + `data-stage` |
| "it hears you" | Claude Code's **level bar cursor**, suppressed under `prefersReducedMotion` | the real voice-level halo (`--mg-level` at 10 Hz, bulge `--mg-bulge` 0.35, `METER_FULL_RMS = 0.12`), reduced-motion gated |
| "hands-free" | Telegram's lock | the compressing stadium pill + the ✕-morphed tools trigger |
| teaching budget | Claude Code's "first three sessions" hint | `LOCK_HINT_MAX = 3` + `LOCK_HINT_COUNT_MS = 350` |
| draft stays readable | — | the round-3 lifted cancel track + the yielding placeholder |

**What is genuinely new: "a phrase is pending".** Claude Code's answer — dimmed text that firms up
— is unavailable to us: we have no partial to dim. The honest analogues, in order of cost:

1. **A pending state on the mic chrome** (v1, recommended): while the client is between "I heard
   you stop talking" (it already has a 10 Hz RMS meter) and "a final landed", the record circle
   carries a distinct low-key pulse. Costs one CSS state and one boolean; it is in the one place
   the user is already looking, and it never touches the text layer.
2. **A ghost ellipsis at the draft tail** — a dim `…` after the last appended chunk while pending.
   Truthful and very legible, but it means rendering decoration over a controlled textarea's
   content, which the composer has no seam for today. Defer.
3. **Nothing.** Viable, because at 0.5–1.2 s the gap is short. But the owner's ask is specifically
   about *feeling live*, and silence during the gap is exactly what feels dead.

Also worth adopting from Claude Code: **distinct, specific failure copy** — "No speech detected"
(the empty final), "No audio detected from microphone" (a dead input device) and "Voice connection
failed" (the socket) are three different sentences, deliberately.

---

## 8. Failure handling — what a dropped socket costs

**The rule, from §4.5's reconnect contract, applied to dictation:** already-appended text **stays
in the draft** — it is the user's text, and the draft is the app's never-lose-speech surface
(coherence-sweep rule ⑤, and D68 MED-2's "the draft is cleared only if the seam actually routed").
**The in-flight utterance is lost and is said to be lost.** No silent retry.

**The degrade ladder this feature can offer that the call cannot:**

> Our capture already holds ONE `MediaStream` with two consumers — the `MediaRecorder` and the
> `AudioContext` analyser armed by `armDetector` for every recording (OF-3). A streaming leg is a
> **third consumer of the same stream**, so the whole-clip recorder can keep running underneath at
> negligible cost.

That buys total failure honesty: **if the socket dies (or never opens), the release falls back to
exactly today's shipped behaviour** — `onstop → upload → POST /api/voice/stt` with its
multi-target failover — and the user loses nothing but the liveness. The rule must be a strict
either/or evaluated at release:

- ≥ 1 phrase final was appended → **discard the recorded clip** (`discardRef` already does exactly
  this, `useDictation.ts:516`); the flush's tail final is the last append.
- 0 finals appended → **upload the clip** as today.
- Never both. (Appending a phrase stream *and* the whole-clip transcript is the one way this
  feature can duplicate the user's words.)

Two more, taken from Claude Code: a **repeat-failure circuit breaker** (three failures in 10 s →
pause and say so) and **class-aware retry** — our relay already has a two-class taxonomy from S0
(**HTTP 403 at handshake** = refusal, never retry; **bare 1006** = session death, retry once), which
is the same rule Claude Code ships ("retries a status outside the 400 range once; doesn't retry a
status in the 400 range").

---

## 9. RECOMMENDATION — mapped onto ctrl-b's named seams

*Our reading, not evidence. The owner rules.*

### 9.1 Placement

**A named slice after S2a**, exactly as §8 item 5 (b) proposes — not before. It needs the capture
worklet, the WS client, the `bufferedAmount` ceiling and the reconnect loop, all of which S2a
builds and proves on the call. After S2a the ear's client is a solved problem and this slice is a
branch in one hook plus a relay control message. Pulling it earlier means building the worklet
twice or building it in the wrong slice.

### 9.2 What the slice touches

| Seam | Change |
|---|---|
| **relay session** (§3.3) | Two additions and nothing else: a **flush** control message (`{"type":"flush"}` → inject `max(3000 − fed_ms, silence_ms) + 200` ms of zero-frames, then await the final) and a **commit-safety invariant** — track `speech_started`/`committed` per buffer and **refuse to emit `input_audio_buffer.commit` while a speech segment is open** (§1.2 arm A). Both are needed by the CALL too; both belong here, not in the phone. |
| **the downlink** (§3.1) | The existing `transcript` frame gains `final: true`. Naming the field now costs nothing and is the seam a partial-capable ear (arch ②, or a fork patch) drops into additively — the upstream event pair is already `...transcription.delta` / `...completed` (§2.6). |
| **`useDictation`** | One new branch, behind the `live` capability bit + a `voice.live.dictation` toggle: when streaming is on, `start()` also opens the relay session on the SAME `MediaStream` (the `armDetector` precedent — never a second `getUserMedia`); each `transcript` frame calls the existing `appendDraft(text)`; `stop()` sends `flush`, enters a `flushing` phase, and resolves on the final or `tail_wait_ms`. `upload()` is reached only when zero finals landed (§8). `cancel()`/`discardRef` semantics are unchanged and additionally close the socket without appending — open-webui's "detach `onend`" rule, which we already own. |
| **`appendDraft`** (`store/composer.ts:48`) | **Unchanged.** It is already the correct join rule (§3). |
| **auto-send** (`useDictation.ts:269`) | **Unchanged in shape**, moved to fire once at session end instead of once per upload (§6); optional three-word floor as config. |
| **`useMicGesture`** | **No machine change.** `hold` and `locked` already mean "capturing"; `micReduce`'s `start`/`stop`/`cancel` outputs already drive the three verbs. The pending indicator is a new `MicChrome` field consumed by `MicGestureChrome` (§7), not a new stage. |
| **composer variants** | The focused-caret preservation (§5) + keep-scrolled-to-bottom. Nothing else. |
| **`voice.live`** (§5.1) | Additive fields: `dictation: false` (the whole-feature toggle, standing requirement), `tail_wait_ms: 2000`, `pause_flush_ms: 0` (0 = off; see 9.4), `dictation_idle_s: 15`, `dictation_max_s: 120`. |

### 9.3 The silence auto-stop interplay — two rules, both load-bearing

1. **Tier 0's stop decision must be SUSPENDED during a streaming hold.** Its whole job is to end a
   push-to-talk clip at the first pause; under phrase dictation a pause is the point. The split the
   feel round already built makes this a one-line change: `armDetector`'s poll keeps metering (the
   halo needs it) and the `if (!autoStopOn) return;` policy gate gains the streaming condition.
2. **The hidden-page stop must be armed unconditionally while streaming.** Today the
   `visibilitychange` listener is armed *only when the auto-stop policy is on* (F1 of the feel
   round). A live WebSocket plus an open mic behind a locked phone is strictly worse than the
   recorder that rule was written for. ⚠ This is the exact trap the S0.5 record flagged as durable
   ("a split must enumerate EVERY decision the old arming carried") — reading in the other
   direction this time.
3. **Replace Tier 0's short window with a session idle timeout** at Claude Code's numbers:
   **15 s of silence** ends a locked streaming session, **120 s** is the hard cap. `hold` needs
   neither (the finger is the timeout). This is what makes hands-free dictation safe to leave on.

### 9.4 What the slice does NOT do

- **No partials, no revise-and-repaint.** Appends only. (Tier (c) stays §2.1's shelved-with-trigger
  item and the S4 decision point; §9.2's `final` flag is the only concession to it.)
- **No change to the send path, the turn machinery, `runComposer`, the attachment hold, or the
  confirm gate.** Text enters through the same door.
- **No change to the Speaches server** (§5.2 posture holds — the flush is a client-side move that
  uses only documented events).
- **No second recorder, no second `getUserMedia`, no new route.**
- **Client-forced flush at mid-hold pauses is deliberately NOT in v1.** The client has the RMS
  meter to detect a pause and could fire `flush` at every one, collapsing §1.1's law to a tunable
  `pause_flush_ms`. It is the natural v1.1 lever if the owner finds the natural cadence sluggish —
  the config key should exist from day one, defaulted to 0 — but it carries a real race (speech
  resuming between the flush and the `committed` lands in a buffer that is about to be sliced by
  `data_w_vad_applied`) that deserves its own probe and its own review round, not a free ride.

---

## 10. Risks, and what I could not determine

1. **[U] Does `silence_duration_ms: 700` actually reach Silero?** The `session.update` is acked and
   the spurious `prefix_padding_ms` error fires either way; none of my arms can distinguish 550
   from 700. It matters less than it did — §1.1 shows the 3 s buffer rule usually dominates — but
   the S1 relay should assert it by probing two values against a fixed clip.
2. **[U] The controlled-textarea caret collapse (§5)** is reasoned, not measured on our composer in
   Chrome/Fennec. Probe before building the mitigation; the mitigation may be unnecessary.
3. **[U] Whether a mid-hold client-forced flush is safe** (§9.4) — the resume-during-flush race is
   derived from the source, not exercised.
4. **[U] Whether the realtime session can carry hotwords.** `instructions` is an honored session
   field (S0 pin) but there is no evidence it reaches Parakeet; the HTTP door's `hotwords`
   `extra_body` is not on this path. "corsair" → "Course air" (§1.3) is a real cost for a fleet
   control panel, and Claude Code's project/branch-name hints are the field precedent for fixing
   it. Worth a bounded probe of its own.
5. **[U] Multi-utterance sessions beyond ~8 s.** My longest arm was 7.5 s of audio. The 30-minute
   hard expiry is pinned (S0) but the buffer's unbounded `np.append` growth per utterance and the
   per-append Silero cost over long locked sessions were not measured. `dictation_max_s: 120`
   (§9.3) makes this moot for dictation; it does **not** for the call.
6. **[R only] ChatGPT's composer dictation granularity** — secondary sources say "as you go" and
   nothing more; no primary source was read.
7. **The probes used synthesised (Kokoro) speech**, which is cleaner and more regularly paced than
   the owner on a phone in a room. The endpoint law is structural and will hold; the *numbers*
   (detection lag, transcription time, and especially where real pauses fall) are optimistic. The
   S4 calibration sitting is where they get re-measured — and this slice's knobs should be on that
   sitting's list.
8. **The big one: these corrections bind the CALL, not just dictation.** §1.1 means the call's
   turn latency is `max(silence_ms, 3000 − utterance_ms) + ~0.5 s + TTFT`, not `silence_ms + …` —
   for a short reply like "yes, do it" that is **~2.5 s before the agent even starts thinking**.
   §1.2 arm A means any commit the call's relay might send mid-speech is a session kill. Both
   belong in LIVE_VOICE_PLAN §4.1/§7-S0 regardless of what happens to this slice, and both are
   arguments the §2.1 shelved architecture ② (own the ear) will have to be re-weighed against at
   the S4 decision point.

---

## Primary sources

- `~/github/speaches` @ `e093d8b` — `src/speaches/realtime/input_audio_buffer.py`,
  `src/speaches/realtime/input_audio_buffer_event_router.py`
- Live probes against emma Speaches `:9000` (Parakeet TDT 0.6b v3 ONNX, Kokoro-82M-v1.0-ONNX),
  2026-09-13 — 11 transcription round-trips + 6 realtime sessions
- https://code.claude.com/docs/en/voice-dictation
- https://raw.githubusercontent.com/open-webui/open-webui/main/src/lib/components/chat/MessageInput/VoiceRecording.svelte
- https://raw.githubusercontent.com/open-webui/open-webui/main/src/lib/components/chat/MessageInput.svelte
- https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/src/hooks/Input/useSpeechToTextBrowser.ts
- https://raw.githubusercontent.com/danny-avila/LibreChat/main/client/src/hooks/Input/useSpeechToTextExternal.ts
- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://developers.deepgram.com/docs/finalize · https://developers.deepgram.com/docs/utterance-end
- https://support.google.com/gboard/answer/11197787
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API
- ctrl-b @ `79e8bad` — `frontend/src/hooks/useDictation.ts`, `frontend/src/hooks/useComposer.ts`,
  `frontend/src/store/composer.ts`, `frontend/src/theme-engine/kit/composer/useMicGesture.ts`,
  `frontend/src/theme-engine/kit/composer/Composer.tsx`
