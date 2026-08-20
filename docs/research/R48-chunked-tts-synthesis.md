# R48 — Chunked TTS synthesis: how the field ships it, and what the platform actually allows

**Date:** 2026-08-20
**Status:** Evidence dossier — complete for the bounded question; build is a later session. Not a decision.
**What drove it:** [`ROADMAP.md`](../ROADMAP.md) §C3 *"Chunked TTS synthesis (split the reply, play it
progressively)"* (noted 2026-06-26 by the owner), owner go 2026-08-20. Today's TTS is
whole-reply buffered; measured time-to-first-audio on a long reply ≈ 24 s, plus a known
idle-connection reset on very long synth requests.
**Drove:** (open) — no D-entry yet.

**Confidence markers used on every finding:** **VERIFIED** = source read at a pinned SHA, or probed
first-hand on emma. **REPORTED** = secondary source (docs, bug tracker, search result). **UNVERIFIED**
= expected but not checked.

---

## 0. Sources, pinned

| Project | Ref | SHA | Read |
|---|---|---|---|
| open-webui/open-webui | HEAD | `01f4282f1ffe0d6212f58d3afbeae21fffd0c4be` | 2026-08-20 |
| danny-avila/LibreChat | HEAD | `16e4d1419107a31c00fa23442ef07688e64d6366` | 2026-08-20 |
| Mintplex-Labs/anything-llm | HEAD | `b1b165e0740ca22728845717c4192ac3549d31c3` | 2026-08-20 |
| lobehub/lobe-chat | HEAD | `e52dc85cfd29e67779a6aaf5f4c9a109ec667458` | 2026-08-20 |
| lobehub/lobe-tts (the TTS engine LobeChat consumes) | master | `d61d820d04ca6ea3d9bdea190f9666736ac87e98` | 2026-08-20 |
| speaches-ai/speaches (**the owner's TTS server**) | HEAD | `993994f7984bf3fe9655b267448328cf66fccb42` | 2026-08-20 |
| thewh1teagle/kokoro-onnx (**what Speaches runs for Kokoro**) | main | fetched 2026-08-20 | 2026-08-20 |
| mozilla-firefox/firefox | main | fetched 2026-08-20 | 2026-08-20 |
| mdn/browser-compat-data | main | fetched 2026-08-20 | 2026-08-20 |

**Reference-class negative (VERIFIED, GitHub code search 2026-08-20):** the CLI peers ship **no TTS at
all** — `anomalyco/opencode` 0 hits for `audio/speech` *and* `text-to-speech`; `openai/codex` 0/0;
`aaif-goose/goose` 0 for `audio/speech`, its 7 `text-to-speech` hits are all blog/docs references to a
third-party `speech-mcp` server, not product code; `Aider-AI/aider`'s single `audio/speech` hit is
`scripts/recording_audio.py`, a maintainer script for making demo recordings. **The entire in-class
evidence base for this question is the four chat-UI peers above.**

---

## 1. ctrl-b's seams as they stand (VERIFIED — read at `23be931`)

Read before researching, so the findings land on real code.

| Seam | File:line | Shape today |
|---|---|---|
| Playback singleton | `frontend/src/lib/audioController.ts:27-31` | One `HTMLAudioElement`, one `Playback {id,status,current,duration}` snapshot on the D23 `createStore`, `cache: Map<messageId, objectURL>`, `reqSeq` staleness guard |
| Synth | `audioController.ts:81-107` | `POST /api/voice/tts {text}` → `URL.createObjectURL(await res.blob())`, cached per message id |
| Entry point | `audioController.ts:114-140` | `toggle(id, markdown)` — pause others, `set({status:"loading"})`, await synth, assign `a.src`, `a.play()` |
| Markdown → prose | `frontend/src/lib/toSpeech.ts:6-23` | 14 regex passes; drops fenced code, images, HTML tags, rules; unwraps inline code/links/emphasis; collapses whitespace |
| Auto-TTS trigger | `frontend/src/hooks/useAutoTts.ts:40-51` | Fires on the `streaming → idle` status edge only; `finalReply()` scans back to the user boundary |
| Streaming text arrival | `frontend/src/store/chat.ts:1044-1049` | SSE `text.delta` → `appendDelta(id,"text",delta)` (`chat.ts:713-726`) |
| Backend route | `backend/app/api/voice.py:81-108` | `POST /voice/tts`; 422 if empty or `len(text) > max_text_chars`; returns a **buffered** `Response` with `Content-Length` + `X-Voice-Served-By` |
| Adapter | `backend/app/adapters/voice.py:198-236` | `synthesize()` — *"synthesize the **whole clip** (buffered, for a seekable blob)"*; `resp.aread()` at :226, failover chain via `failover_collect` |
| Config | `backend/app/config.py:562-570` | `TtsServiceCfg{format="mp3", max_text_chars=4096}` + inherited `connect_timeout_s=3.0`, `timeout_s=30.0`, `extra_body` |

**Correction to the ROADMAP sketch, item 1 (VERIFIED).** §C3 says the v1 seams include *"the
hand-rolled block parser in `lib/markdown.tsx` (reuse its element list to chunk markdown-correctly)"*.
There is **no element list to reuse**: `blocks(src)` (`frontend/src/lib/markdown.tsx:129-210`) pushes
`ReactNode`s directly (`out.push(<CodeBlock …/>)`, `out.push(<p …>)`) and returns `ReactNode[]`. There
is no intermediate AST. Reusing it means first refactoring `blocks()` into a
`parse(src) → Block[]` + `render(Block[]) → ReactNode[]` pair — a real (if small) change to the
renderer that memoizes the whole chat log, not a free borrow.

---

## 2. What the four peers actually ship

### 2.1 Scoreboard

| Peer | Chunks client-side? | Splitter | Default granularity | Synth-ahead depth | Playback mechanism | Auto-play during stream? |
|---|---|---|---|---|---|---|
| **open-webui** (play button) | **Yes** | regex + merge rule | **sentence** (`punctuation`) | **1** (sequential `await` in a `for` loop) | `<audio>` **`src` swap on `ended`** | No |
| **open-webui** (call overlay) | **Yes** | same | same | **unbounded** (fire-and-forget) | `<audio>` src swap + explicit ≥300 ms inter-chunk sleeps | Yes, but only inside voice-call mode |
| **LibreChat** | **No — server-side** | `lastIndexOf` over a separator list | 1000-char chunks, **only if input ≥ 4096 chars** | 1 (sequential pipe) | **MSE `appendBuffer`** of one continuous `audio/mpeg` response, with a full-buffer fallback | Yes (server polls the message cache) |
| **AnythingLLM** (local piper) | **Yes** | regex + greedy accumulate | 400-char chunks | unbounded (worker pushes) | `<audio>` **`src` swap on `ended`** + a "waiting" latch | No |
| **AnythingLLM** (openai/kokoro/elevenlabs) | **No — whole message** | — | — | — | one `<audio src=blobUrl>` | No |
| **LobeChat / lobe-tts** | **Yes** | `markdown-to-txt` + regex | **100-char** chunks | 1 (SWR index advances on success) | `<audio>`, **blob rebuilt from all buffers so far + re-seek** on `ended` | No |

**The single most load-bearing platform fact (VERIFIED): 4/4 peers play through an
`HTMLAudioElement`. Zero use Web Audio `AudioBufferSourceNode` scheduling.** The "classic gapless
approach" has no adopter in this reference class.

### 2.2 open-webui — the closest thing to a reference implementation

The mode is a first-class config value (VERIFIED, `src/lib/types/index.ts:11-15`):

```ts
export enum TTS_RESPONSE_SPLIT {
	PUNCTUATION = 'punctuation',
	PARAGRAPHS = 'paragraphs',
	NONE = 'none'
}
```

**Default = `punctuation`, i.e. SENTENCE, not paragraph** (VERIFIED, two independent sites):
`backend/open_webui/config.py:1601` — `AUDIO_TTS_SPLIT_ON = os.getenv('AUDIO_TTS_SPLIT_ON', 'punctuation')`
— and the client falls back to the same literal at `ResponseMessage.svelte:290` and `Chat.svelte:1613`
(`$config?.audio?.tts?.split_on ?? 'punctuation'`).

**Correction to the ROADMAP sketch, item 2:** §C3 specifies *"a chunk mode (`off | paragraph |
sentence`) … default `paragraph`"*. The only peer that ships the three-way mode ships the same three
values with the **sentence** default. (Nothing here says paragraph is wrong for us — see §7 — but the
sketch's default is not the field's.)

**The splitter (VERIFIED, `src/lib/utils/index.ts:1096-1119`).** Code blocks are pulled out to `\x00N\x00`
placeholders *before* splitting and restored after, so a fence can never be cut mid-block:

```js
const codeBlockRegex = /```[\s\S]*?```/g;
…
	let sentences = text.split(/(?<=[.!?])\s+|\n+/);
```

**The merge rule — the numbers (VERIFIED, `src/lib/utils/index.ts:1144-1160`):**

```js
export const extractSentencesForAudio = (text: string) => {
	return extractSentences(text).reduce((mergedTexts, currentText) => {
		const lastIndex = mergedTexts.length - 1;
		if (lastIndex >= 0) {
			const previousText = mergedTexts[lastIndex];
			const wordCount = previousText.split(/\s+/).length;
			const charCount = previousText.length;
			if (wordCount < 4 || charCount < 50) {
				mergedTexts[lastIndex] = previousText + ' ' + currentText;
```

**`< 4 words OR < 50 characters` → merge forward.** There is **no max**: `punctuation` mode never
splits a long sentence, and `paragraphs` mode never splits a long paragraph.

**Text cleanup is more aggressive than ours (VERIFIED, `src/lib/utils/index.ts:991-1034`).**
`cleanText = removeFormattings(removeEmojis(content.trim()))`. `removeEmojis` uses
`/\p{RGI_Emoji}/gv` (ES2024 `v` flag, with an in-source note that the previous surrogate-pair regex
*"missed the entire BMP emoji category"*). `removeFormattings` **deletes whole table rows**
(`.replace(/^\|.*\|$/gm, '')`) and reference-link definitions, and — separately, at
`getMessageContentParts`, `index.ts:1163-1172` — strips `<details>` blocks on the **full string before**
code-block-aware processing, with a comment naming the bug that forced it (#22197: a `<details>`
containing code fences leaked reasoning content into TTS). ctrl-b's `toSpeech` strips **neither emoji
nor tables**.

**Playback = 88 lines, `src` swap on `ended`** (VERIFIED, `src/lib/utils/audio.ts`):

```ts
	private readonly _onEnded = () => this.next();
	…
	enqueue(url: string) {
		this.queue.push(url);
		// Auto-play if nothing is currently playing or loaded
		if (this.audio.paused && !this.current) {
			this.next();
		}
	}
	…
	next() {
		this.current = this.queue.shift() ?? null;
		if (this.current) {
			this.audio.src = this.current;
			this.audio.play();
```

Cancellation is `#halt()`: `pause()` + `currentTime = 0` + `removeAttribute('src')` + `load()` +
`queue = []` (`audio.ts:80-87`). Identity change calls the same thing (`setId`, `audio.ts:24-30`) —
i.e. **a new reply wins by clearing the queue**, exactly like ctrl-b's `reqSeq` guard.

**Producer = strictly sequential, depth 1** (VERIFIED, `ResponseMessage.svelte:334-352`): a
`for (const [, sentence] of messageContentParts.entries())` loop that **awaits** each
`synthesizeOpenAISpeech` before starting the next, guarded by `if (signal.aborted) return;` on both
sides of the await. Error mid-queue: the `.catch` toasts, sets `speaking = false`, and the loop
**continues to the next sentence** (the `if (res && speaking)` guard just skips the enqueue) — a failed
chunk is silently dropped, not a queue abort.

**Auto-playback fires only at turn end (VERIFIED, `Chat.svelte:2446-2449`):**

```js
			if ($settings.responseAutoPlayback && !$showCallOverlay) {
				await tick();
				document.getElementById(`speak-button-${message.id}`)?.click();
			}
```

`responseAutoPlayback` defaults **false** (`Settings/Audio.svelte:24`). Same posture as ctrl-b's
`useAutoTts`.

**During-stream TTS is call-overlay-only** (VERIFIED, `Chat.svelte:1606-1633`, called from the delta
handler at `:2384/:2399/:2411/:2423`):

```js
	const dispatchCallOverlayAudio = (message, final = false) => {
		if (!$showCallOverlay) {
			return;
		}
		const messageContentParts = getMessageContentParts(…);
		if (!final) {
			messageContentParts.pop();
		}
		const nextContentPart = messageContentParts.at(-1) ?? '';
		if (!nextContentPart || (!final && nextContentPart === message.lastSentence)) {
			return;
		}
```

The boundary algorithm: **re-split the entire growing buffer on every delta, `pop()` the last
(still-incomplete) part, take `.at(-1)` as the newest complete sentence, dedupe against
`message.lastSentence`.** No debounce, no timer, no incremental scanner.

Inside the overlay the queue *is* synth-ahead and unbounded (VERIFIED, `CallOverlay.svelte:610-630`
producer calls `fetchAudio(content)` **without awaiting**; consumer `monitorAndPlayAudio`,
`:538-586`, polls every 200 ms and re-queues if the content isn't in `audioCache` yet). It also
deliberately **inserts gaps**: `onended` waits 100 ms before resolving (`:449-451`) and the loop sleeps
another 200 ms after each clip (`:565`) — ≥300 ms of enforced silence per chunk boundary in the one
peer path that is explicitly conversational.

### 2.3 LibreChat — the MSE peer, and the one that chunks on the server

**Client-side chunking: none.** One `fetch` whose *response body* is a byte stream, read with
`getReader()` and fed to MSE (VERIFIED, `client/src/components/Chat/Input/StreamAudio.tsx:110-138`):

```ts
        const type = 'audio/mpeg';
        const browserSupportsType =
          typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type);
        let mediaSource: MediaSourceAppender | undefined;
        if (browserSupportsType) {
          mediaSource = new MediaSourceAppender(type);
          setGlobalAudioURL(mediaSource.mediaSourceUrl);
        }
```

`MediaSourceAppender` is 43 lines: one `SourceBuffer`, a pending-chunk array, and an `updateend`
listener that drains it (`client/src/hooks/Audio/MediaSourceAppender.ts:17-32`).

**The fallback is not progressive** (VERIFIED, `StreamAudio.tsx:153-161`): when
`!browserSupportsType`, chunks are accumulated in an array, written to the Cache API after the stream
ends, then read back as a blob URL. **Zero latency benefit.** There is also a 15 s per-read timeout
(`maxPromiseTime = 15000`, `:21`).

**This matters for us because Gecko will always take the fallback.** `MediaSource` itself is
supported on Firefox Android since 41 (VERIFIED, BCD `api/MediaSource.json`:
`firefox_android: {version_added: "41"}`, `chrome_android: "mirror"`), but **`audio/mpeg` is not a
Gecko MSE byte-stream format** — Bugzilla 1367333 (*"[MSE] `_mediaSource.addSourceBuffer('audio/mpeg')`
cannot decode format audio/mpeg"*) is **RESOLVED DUPLICATE** of 1169485 with Jean-Yves Avenard's
comment *"We have no intention of supporting containers other than MP4 and webm with MSE"*
(REPORTED — bug page fetched 2026-08-20, comment not independently diffed against the DB).

**Server-side chunking, with numbers** (VERIFIED, `api/server/services/Files/Audio/TTSService.js:314-345`):

```js
      if (input.length < 4096) {
        const response = await this.ttsRequest(provider, ttsSchema, { input, voice }, allowedAddresses);
        response.data.pipe(res);
        return;
      }

      const textChunks = splitTextIntoChunks(input, 1000);
```

— i.e. **no chunking below 4096 chars**, then 1000-char chunks whose audio streams are `pipe`d
back-to-back into **one** `Content-Type: audio/mpeg` response (`res.setHeader` at `:308`,
`pipe(res, { end: chunk.isFinished })` at `:342`).

**The separator list (VERIFIED, `packages/data-provider/src/parsers.ts:417`):**

```ts
export const SEPARATORS = ['.', '?', '!', '۔', '。', '‥', ';', '¡', '¿', '\n', '```'];
```

Note `';'` counts as a break and `'```'` is treated as a separator rather than a skip-region — the
opposite of open-webui's placeholder approach.

**The streaming trigger is a server-side poll, not an LLM-stream hook** (VERIFIED,
`streamAudio.js:54-133` + `TTSService.js:404-412`): `createChunkProcessor` re-reads the message from
the cache/DB, slices off `processedText`, and emits a chunk only when
`!complete && remainingText.length >= 20` (`streamAudio.js:117`) cut at
`findLastSeparatorIndex`. The consumer sleeps **1250 ms** between empty polls (`TTSService.js:411`).
Give-up counters: `MAX_NOT_FOUND_COUNT = 6`, `MAX_NO_CHANGE_COUNT = 10` (`streamAudio.js:54-55`).
Cancellation is `req.on('close', …) → shouldContinue = false` (`TTSService.js:396-398`).

### 2.4 AnythingLLM — the cleanest single-element queue in the field

Chunking exists **only** on the local-piper path; every server-TTS provider (`openai`,
`generic-openai`, `elevenlabs`, **`kokoro`**) routes to `AsyncTTSMessage`, a plain
`<audio src={audioSrc}>` over a whole-message blob (VERIFIED, `TTSButton/index.jsx:14-30`,
`asyncTts.jsx:85`). Its Kokoro provider is a bare buffered call —
`Buffer.from(await result.arrayBuffer())`, no `response_format`, no stream
(`server/utils/TextToSpeech/kokoro/index.js:33-44`).

**The splitter — 400 chars, sentence-aligned, with a word-boundary escape hatch** (VERIFIED,
`frontend/src/utils/piperTTS/worker.js:170-214`):

```js
/**
 * Splits text into sentence-aligned chunks (mirrors the chunking inside
 * @mintplex-labs/piper-tts-web) so each streamed predict() call stays small
 * enough for a single OrtRun and audio starts after the first sentence group.
 */
function splitIntoChunks(text, maxLength = 400) {
	…
  const sentences = trimmed.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [trimmed];
	…
    if (sentence.length > maxLength) {
      // A single run-on sentence longer than the limit: split on word boundaries.
```

**The queue — this is the shape ctrl-b should copy** (VERIFIED,
`…/Actions/TTSButton/piperTTS.jsx:24-47`), notable for the explicit *waiting latch* that ctrl-b's
current single-clip controller has no analogue for:

```jsx
  function playNext() {
    const player = playerRef.current;
    if (!player) return;
    if (nextIdxRef.current < queueRef.current.length) {
      waitingRef.current = false;
      player.src = queueRef.current[nextIdxRef.current];
      nextIdxRef.current += 1;
      player.play().catch(() => setSpeaking(false));
      return;
    }
    if (!streamDoneRef.current) {
      // Playback caught up to generation - hold here and resume automatically
      // when the next streamed chunk arrives (see onChunk below).
      waitingRef.current = true;
      return;
    }
    setSpeaking(false);
  }
```

with `onChunk: (blobUrl) => { queueRef.current.push(blobUrl); if (nextIdxRef.current === 0 ||
waitingRef.current) playNext(); }` (`:92-98`), **error mid-queue = release the latch, don't abort**
(`onError`, `:105-113`), replay from the cached URL array (`:78-82`), and a `pause` handler that
distinguishes end-of-clip from a user pause via `if (el.ended) return;` (`:135-144`) — the exact hazard
ctrl-b's `audioController.ts:49-53` already guards differently.

`stopAndReset` (`:49-68`) revokes **every** cached blob URL, and it runs on `[chatId]` change with an
in-source note that React reuses index-keyed component instances across threads.

### 2.5 LobeChat / lobe-tts — the only peer that solves the scrubber

Splitter: **100-char** default with a real markdown dependency (VERIFIED,
`lobe-tts src/core/utils/splitTextIntoSegments.ts`): `markdownToTxt(str)` from the `markdown-to-txt`
package, full-width→half-width normalisation, `'\n' → '. '`, then paragraph-first packing with a
`/[^!.?]+[!.?]+/g` sentence fallback for over-long paragraphs.

Fetching is sequential-by-index via SWR (`src/react/useTTS/index.ts:52-70`): `onSuccess → load(data);
setIndex(index + 1)`. Depth 1.

Playback rebuilds a **cumulative** blob and re-seeks (VERIFIED,
`src/react/hooks/useStreamAudioPlayer.ts:50-68`):

```ts
      if (maxLength < arrayBuffers.length) {
        const cacheTime = audioRef.current.currentTime;
        const newBlob = new Blob(arrayBuffers, { type: 'audio/mp3' });
        if (audioRef.current.src) URL.revokeObjectURL(audioRef.current.src);
        const newUrl = URL.createObjectURL(newBlob);
        audioRef.current.src = newUrl;
        audioRef.current.load();
        audioRef.current.currentTime = cacheTime;
        audioRef.current.play();
```

**This is the field's answer to §C3's open UX question** ("scrubber over the whole message vs
per-chunk"): whole-message, bought by re-materialising the concatenation at each boundary. The cost
is a `load()` + seek at every chunk end — strictly a *larger* gap than a plain `src` swap — and it
assumes raw-frame-concatenable audio (`type: 'audio/mp3'`).

LobeChat also documents the Web Audio memory cost in its own source (VERIFIED,
`lobe-chat src/features/AudioPlayer/useWaveform.ts:5-7`): *"Skip decoding files larger than this.
`decodeAudioData` holds the full decoded PCM in memory, so big recordings would spike memory for what
is only a decorative waveform"* — `MAX_DECODE_BYTES = 20 * 1024 * 1024`.

---

## 3. The Speaches / Kokoro half — the server already does most of this

This is the finding that most changes the design, and none of it is in the §C3 sketch.

**Speaches' `/v1/audio/speech` is already a streaming endpoint** (VERIFIED,
`src/speaches/routers/speech.py:85-119`): it returns `StreamingResponse` over
`stream_audio_as_formatted_bytes(audio_generator, …)`, and it accepts OpenAI's newer
`stream_format: Literal["audio","sse"] = "audio"` (`:62-63`).

**Speaches already strips emoji and markdown emphasis, server-side, unconditionally** (VERIFIED,
`speech.py:93-94`):

```python
    body.input = strip_emojis(body.input)
    body.input = strip_markdown_emphasis(body.input)
```

(`strip_emojis` = a hand-listed Unicode-block regex, `text_utils.py:137-156` — narrower than
open-webui's `\p{RGI_Emoji}`, e.g. it does not cover BMP symbols like ✅/☀️. `strip_markdown_emphasis`
= four regexes, `:158-177`.) **A different OpenAI-compatible server would not do this** — the design
must not silently depend on it.

**Formats (VERIFIED, `api_types.py:14,21` + `speech.py:29-36`):**
`pcm | mp3 | wav | flac | opus | aac`, default `mp3`. For `pcm` the generator's raw `s16le` bytes are
yielded directly (`audio.py:150-155`); every other format is piped through **one long-lived `ffmpeg`
process** (`audio.py:164-196`), so the response is one continuous, valid container — not concatenated
files. *(The published usage docs say "`response_format`: `opus` and `aac` are not supported"
(REPORTED, speaches.ai/usage/text-to-speech/, fetched 2026-08-20) — this **contradicts the source at
HEAD**, which wires both through `libopus`/`aac`. Unresolved; probe before relying on opus.)*

**Kokoro is already chunked internally, and it cannot not be** (VERIFIED, `executors/kokoro.py:33,201-232`
→ `kokoro-onnx`). `MAX_PHONEME_LENGTH = 510` is the model's fixed context (`kokoro_onnx/config.py`), and
`chunker.py`'s module docstring states the mechanism:

> *"The model context is fixed at MAX_PHONEME_LENGTH phonemes, so long inputs are cut at the least
> disruptive boundary available: sentence, clause, word, and only as a last resort mid-word."*

**The prosody law, from the model wrapper's own author** (VERIFIED, `kokoro_onnx/chunker.py`,
`split_phonemes` docstring) — this is the best evidence in the dossier for question 4:

> *"Filling each batch to the limit would leave a short remainder, and a short batch is spoken at a
> different rate and loudness than its neighbours. The batches are therefore balanced: the smallest
> limit that still needs no extra pass over the text."*

Two consequences:
1. **Per-sentence client chunking does not destroy prosody Kokoro was preserving** — Kokoro resets at
   its own ≤510-phoneme boundaries regardless. What it *does* risk is the *short-batch* artefact named
   above: a 3-word chunk is **spoken at a different rate and loudness**. That is the mechanism behind
   open-webui's `< 4 words || < 50 chars` merge, arrived at independently.
2. Chunk sizes should be **balanced**, not greedily filled — kokoro-onnx binary-searches the smallest
   limit that yields the same batch count (`chunker.py:_pack` + the loop at the end of `split_phonemes`).

**Synth-ahead depth, from the same source (VERIFIED, `kokoro_onnx/__init__.py:369-373`):**

```python
        # One slot for the batch being played, one for the batch synthesized
        # ahead of it, so the producer cannot run away with the whole text
        queue: asyncio.Queue[tuple[NDArray[np.float32], int] | Exception | None] = (
            asyncio.Queue(maxsize=1)
        )
```

**Depth 1 ahead** — the same number all four peers reached from the other direction.

**Silence handling per batch (VERIFIED, `kokoro_onnx/__init__.py:220,231-241` + `chunker.py:89-96`):**

```python
        """Synthesize one batch, trimming silence and pausing after when trimming."""
        …
        if trim:
            # Trim leading and trailing silence for a more natural sound concatenation
            # (initial ~2s, subsequent ~0.02s)
            trimmed, (head, _) = trim_audio(audio)
            …
            if pause:
                silence = np.zeros(int(pause * SAMPLE_RATE), dtype=audio.dtype)
                audio = np.concatenate([audio, silence])
```

with `pause_after(...) → sentence 0.25 s / clause 0.1 s`. **So a chunk that ends in `.!?…` comes back
with 0.25 s of trailing silence already appended, and its ~2 s of model lead-in already trimmed.** A
client-side chunk boundary therefore lands inside a quarter-second of intentional silence — which is
what makes a ~tens-of-ms element `src` swap inaudible in practice. `pauses.py`'s header adds the
reason the pause exists at all: *"The model leaves its own gap after a full stop, but not always a long
one: around 0.1s between the lines of a dialogue, which runs them together."*

---

## 4. Audio format — measured, and it overturns the shipped default

**All of §4 is VERIFIED by first-hand probe on emma, 2026-08-20**, replicating Speaches'
exact ffmpeg invocation (`audio.py:164-189`: `-f s16le -ar 24000 -ac 1 -i pipe:0 … pipe:1`) on
1.000 s (24 000 samples) of 24 kHz mono sine. `ffmpeg` = Lavf 62.3.100 / Lavc 62.11.

### 4.1 Speaches writes to a **pipe**, and that breaks mp3 gapless metadata

| Path | Bytes for 1.000 s | Round-trip decoded samples | Verdict |
|---|---|---|---|
| `pcm` (raw s16le, no header) | 48 000 | 24 000 | exact |
| `wav` → **pipe** | 48 078 | **24 000** | **exact** |
| `opus` → **pipe** | 9 462 | **24 000** | **exact** |
| `mp3` → **pipe** | 4 268 | **25 344** | **+1 344 samples = +56 ms** |
| `mp3` → **file** (seekable) | 4 460 | 24 000 | exact |

The mechanism: an MP3 gapless trim needs the Xing/`Info` frame, which the muxer can only backfill by
seeking. Probed directly —

```
pipe.mp3: has Info tag: False | has Xing: False | LAME: False
seg.mp3 (file):  Info: True
```

Locating the damage inside the decoded segment: *first sample above |1000| at index **1108**, last at
25102* — i.e. **≈46 ms of dead air is prepended to every chunk**, with ~10 ms trailing. With 20
chunks that is **~0.9 s of stutter added to a reply**, on top of any element-swap gap, and it is
audible as a hitch at every sentence start.

This is not a decode-implementation question — **both engines would trim it if the tag were there.**
Gecko's MP3 demuxer reads and applies it (VERIFIED, `dom/media/mp3/MP3Demuxer.cpp:672-684`:
`mEncoderDelay = mParser.VBRInfo().EncoderDelay(); mEncoderPadding = mParser.VBRInfo().EncoderPadding();`
with a `mSamplesPerFrame + 529` fallback when the tag reports 0, and `mRemainingEncoderPadding`
consumed at `:719-733`). The tag simply is not in Speaches' output.

**Correction to the shipped default:** `TtsServiceCfg.format` is `"mp3"` (`config.py:567`) with the
comment *"mp3 is the universally `<audio>`-seekable choice the mini-player needs."* That reasoning is
sound for **one** blob; it is the **wrong** default the moment segments are concatenated or
sequenced.

### 4.2 `wav` from a pipe has bogus sizes — and it does not matter

ffmpeg to a non-seekable sink writes `RIFF ffffffff … data ffffffff` (probed; header is 78 bytes:
`RIFF/WAVE/fmt /LIST-INFO/data`). Gecko clamps it (VERIFIED,
`dom/media/wave/WaveDemuxer.cpp:132-142`):

```cpp
  int64_t streamLength = StreamLength();
  // If the chunk length and the resource length are not equal, use the
  // resource length as the "real" data chunk length, if it's longer than the
  // chunk size.
  if (streamLength != -1) {
    …
      mDataLength = streamLengthPositive - mFirstChunkOffset;
```

For a **fully-received** segment (blob URL or `ArrayBuffer` → `decodeAudioData`) `StreamLength()` is
known, so the clamp fires and the bogus header is harmless — consistent with the sample-exact
round-trip above. *(For a **live progressive** stream `StreamLength()` is `-1`, the clamp does not
fire, and duration is garbage — see §7.1.)*

### 4.3 OpenAI's own guidance agrees, for a different reason

REPORTED (developers.openai.com TTS guide, fetched 2026-08-20): the Speech API implements streaming via
*"chunk transfer encoding"*, and *"For the fastest response times, we recommend using `wav` or `pcm` as
the response format."* `response_format` = `mp3, opus, aac, flac, wav, pcm`; `stream_format` = `audio |
sse`, with *"`sse` is not supported for `tts-1` or `tts-1-hd`"* (REPORTED, developers.openai.com API
reference). So `sse` is a newer-model feature, while byte-level chunked streaming of the default
`audio` form is the baseline behaviour — which is exactly what LibreChat's `responseType: 'stream'` +
`pipe` relies on (`TTSService.js:273`), and what Speaches implements.

### 4.4 Size cost over Tailscale

Per second of 24 kHz mono speech: **pcm/wav ≈ 48 KB · opus ≈ 9.5 KB · mp3 ≈ 4.3 KB**. A 24 s reply:
**wav ≈ 1.15 MB · opus ≈ 227 KB · mp3 ≈ 102 KB**. On a home tailnet this is noise; on cellular the
wav figure is real. **`opus` is the only format measured here that is both sample-exact from a pipe
and within 2.2× of mp3.** Ogg Opus carries `pre_skip` in the ID header, which is written *first*, so a
non-seekable sink costs it nothing.

---

## 5. Playback mechanism — what the platform allows

### 5.1 Autoplay: segments 2..N are fine, on both engines

**Firefox (VERIFIED, source + prefs).** `media.autoplay.blocking_policy` defaults to **`0`**
(`modules/libpref/init/StaticPrefList.yaml:12142-12145`), and `AutoplayPolicy.cpp` names `0` =
`sPOLICY_STICKY_ACTIVATION`, checking `IsWindowAllowedToPlayOverall()` — a top-level user-gesture
activation that persists for the document's life, not the 5 s transient window used by policy `1`.
The same file carries a per-element `IsBlessed()` flag consulted independently of activation, which
survives `src` changes. (`media.autoplay.default` = `1` = block-audible, `:12155-12158`.) Sticky
semantics corroborated REPORTED by MozillaWiki *Media/block-autoplay*: *"Once the page has been
activated by user gestures, then autoplay is not blocked anymore … it would keep until a user
refreshes the page or leaves the page."*

**Chrome (REPORTED, developer.chrome.com/blog/autoplay, fetched 2026-08-20):** *"Autoplay with sound is
allowed if: The user has interacted with the domain (click, tap, etc.) … The user has added the site
to their home screen on mobile or installed the PWA on desktop."* MEI is **desktop only**. Note the
second clause: **ctrl-b's installed Android WebAPK (R28) satisfies it unconditionally**, so even the
turn-end auto-TTS case — where no gesture precedes segment 1 — is permitted in the installed PWA.
Web Audio has its own gate: an `AudioContext` created before interaction starts `suspended` and needs
`resume()` after a gesture (same source).

**Net: the play button gives sticky activation on both engines; every subsequent `.play()` in that
document is allowed.** Corroborated behaviourally by 4/4 peers shipping unguarded `.play()` in an
`ended` handler.

### 5.2 The three mechanisms, judged

| | Sequential `<audio>` `src` swap | Web Audio `AudioBufferSourceNode` scheduling | MSE `appendBuffer` |
|---|---|---|---|
| Field adoption | **4/4 peers** (VERIFIED) | **0/4** (VERIFIED) | 1/4, LibreChat, for stream-of-one-request |
| Android Chrome | yes | yes | yes, incl. `audio/mpeg` |
| Gecko / Fennec | yes | yes | **`audio/mpeg` refused** — MP4/WebM only (REPORTED, bug 1367333 / 1169485) |
| Gap at a boundary | one `load()`+decode; **UNVERIFIED magnitude on Android** | sample-exact by construction | none within one buffer |
| Autoplay | inherits sticky activation | needs one `resume()` after a gesture, then free | inherits |
| Memory | one decoded clip at a time; **N blob URLs must be revoked** | **full decoded PCM resident** — LobeChat caps at 20 MB for this reason (VERIFIED) | UA-managed buffer |
| Our scrubber (`duration`/`currentTime`/`timeupdate`) | per-chunk unless concatenated (LobeChat's fix) | must be reimplemented by hand | works, whole-message |

**Correction to the ROADMAP sketch, item 3.** §C3 positions MSE as *"the deeper per-chunk
optimization"* under D19 streaming TTS. The evidence says **MSE is not a chunked-synth tool at all** —
it is the transport for *stream-of-one-request*, and on our required Gecko target it does not accept
the mp3 byte-stream format that the only peer using it hard-codes. If MSE is ever wanted here it
would have to be MP4/AAC or WebM/Opus, and the peer precedent (`audio/mpeg`) does not carry over.

### 5.3 What I did not measure

The actual inter-chunk gap of an `<audio>` `src` swap on Android Chrome and Fennec. It is the one
number that decides whether the element approach is good enough, and it cannot be obtained from source.
Mitigating evidence: Kokoro appends 0.25 s of silence after sentence-final chunks (§3), and the one peer
that runs a conversational loop *adds* ≥300 ms deliberately rather than fighting for gaplessness
(§2.2). **A 20-minute device probe should settle it before any Web Audio work is contemplated.**

---

## 6. Segmentation quality — the splitter is not where the quality is

**No peer uses a sentence-segmentation library or `Intl.Segmenter` for TTS** (VERIFIED — grepped all
four repos for `Intl.Segmenter|sbd|sentence-splitter|compromise|nlp.js`; the only hit is LibreChat's
`client/src/components/Chat/Messages/Content/animate.tsx:66`, a **word** segmenter for a text-fade
animation). Every splitter in the field is a regex.

**And `Intl.Segmenter` would not fix the classic failure anyway** (VERIFIED — probed on emma's node,
2026-08-20):

```
Intl.Segmenter('en',{granularity:'sentence'}) on
"Dr. Smith went to Washington. He said e.g. this is fine! Is it? Yes."
→ "Dr. " | "Smith went to Washington. " | "He said e.g. this is fine! " | "Is it? " | "Yes."
```

It splits `Dr. ` and keeps `e.g. ` — mixed, and no better than open-webui's regex on the abbreviation
case. (Availability, VERIFIED BCD `javascript/builtins/Intl/Segmenter.json`: Chrome 87 / Firefox 125,
both Android via `mirror` — so it *is* available; it just does not earn its place.)

**What actually protects quality is the min-length merge.** Feed that `Dr. ` fragment to open-webui's
rule (`< 4 words || < 50 chars`) and it is re-absorbed into the next chunk before it ever reaches the
synth. This is the same defect class kokoro-onnx's balanced batching guards against (*"a short batch
is spoken at a different rate and loudness"*). **Splitter precision is a second-order concern; the
merge floor is first-order.**

**The field's chunk-size numbers, all in one place (all VERIFIED):**

| Source | Unit | Min | Max | Note |
|---|---|---|---|---|
| open-webui `punctuation` | sentence | **4 words / 50 chars** (merge forward) | none | the shipped default |
| open-webui `paragraphs` | paragraph | none | none | |
| open-webui streaming | sentence | as above | none | + dedupe on `lastSentence` |
| LibreChat, complete text | chars | — | **1000** | only when input ≥ **4096** |
| LibreChat, streaming | chars | **20** remaining | — | cut at `findLastSeparatorIndex` |
| AnythingLLM (piper) | chars | — | **400** | sentence-aligned, word-boundary fallback |
| lobe-tts | chars | — | **100** | paragraph-first, sentence fallback |
| kokoro-onnx (inside the server) | phonemes | balanced | **510** | hard model context |

Spread of maxima: **100 → 1000 chars.** There is no field consensus on a max; there *is* consensus on
having a min (the two systems without an explicit min — LibreChat's 4096-char bypass and lobe-tts's
paragraph-first packing — both structurally avoid tiny chunks instead).

**Markdown handling, compared (VERIFIED):**

| | Fenced code | Inline code | Tables | Emoji | Lists |
|---|---|---|---|---|---|
| **ctrl-b `toSpeech`** | dropped | unwrapped | **kept as `\| a \| b \|`** | **kept** | markers stripped, items joined |
| open-webui | placeholder-protected, then dropped by `removeFormattings` | unwrapped | **whole rows deleted** | **`\p{RGI_Emoji}` deleted** | markers stripped |
| AnythingLLM | dropped (``` and ~~~) | unwrapped | not handled | not handled | markers stripped |
| lobe-tts | `markdown-to-txt` | ditto | ditto | not handled | ditto |
| Speaches (server) | — | — | — | **block-regex deleted** | — |

Two gaps in ours that chunking makes worse: a table read aloud becomes pipe-noise **and**, under
`sentence` mode, each row is likely its own chunk; and emoji currently survive to the wire, where
today only Speaches' own strip saves us.

**Nobody splits list items individually.** §C3 asks for *"list items individually (one chunk per
`- `/`1.` item)"*. open-webui strips the markers and lets sentence/paragraph splitting decide;
`\n+` in its sentence regex means one-line items *do* end up separate, but that is a side effect, not
a rule. No peer has a list-aware chunk rule. (Not evidence against it — just no precedent to copy.)

---

## 7. Three findings the questions did not ask for

### 7.1 The cheapest large win is not chunking — it is un-buffering our own proxy

**VERIFIED.** Speaches already streams (`speech.py:112-119` `StreamingResponse`); Kokoro already emits
sentence-grained batches with synth-ahead depth 1 (§3); our adapter throws that away at
`backend/app/adapters/voice.py:226` — `data = await resp.aread()` — and `api/voice.py:100-107` returns
a fully-buffered `Response` with an explicit `Content-Length`. **Time-to-first-audio today is the
whole-reply synth time not because the pipeline can't stream, but because we buffer twice.**

The obstacle is not streaming; it is that **`/api/voice/tts` is a `POST`** (`api/voice.py:81`), and an
`<audio>` element can only fetch with `GET`. That single fact is what pushed LibreChat into MSE — and
into a Gecko fallback with zero latency benefit. A `GET /api/voice/tts?…` returning a
`StreamingResponse` would let the media element do progressive playback **natively on both engines,
with no chunker, no queue, no boundaries, and no gaps at all**.

Known costs, honestly: (a) `duration` is unknown while a chunked, non-`Content-Length` stream is in
flight — Gecko's WAV clamp explicitly requires `StreamLength() != -1` (§4.2) — so the mini-player
scrubber degrades until the stream ends, which is precisely why LibreChat hides its `<audio>` element
(`StreamAudio.tsx:222-228` `display:none`) and why LobeChat rebuilds a blob to recover a real
duration; (b) seeking needs Range support; (c) a GET with the reply text in the query string is a
different shape from today's POST body (a message-id addressed GET is the natural form, and ctrl-b
already owns message ids). **Chunked synth and stream-of-one-request are alternatives for the
*latency* goal and complements only for the *cancellation granularity* goal** — §C3 calls them
complementary, which is true of the mechanisms but understates that either one alone gets the 24 s
down to first-batch latency.

### 7.2 `max_text_chars` and the failover chain both change meaning under chunking

**VERIFIED.** `backend/app/api/voice.py:90-95` rejects a request whose text exceeds
`TtsServiceCfg.max_text_chars` (default 4096, `config.py:568-570`, added as SYS-17a). Under
client-side chunking every request is small, so **the cap silently stops applying to the reply** — a
30 000-char reply that 422s today would sail through as 40 chunks. The cap has to be re-expressed
(per-message pre-chunk check, or a max-chunks bound), or the hardening finding it encodes is lost.

Second: `synthesize()` runs `failover_collect` over the **whole chain per call**
(`adapters/voice.py:230`). With N calls per message, a flapping primary can serve chunk 1 from
provider A and chunk 2 from provider B — **a mid-sentence voice change**, since `voice` resolves per
target (`:221` `voice or target.voice or "alloy"`). And `X-Voice-Served-By` (`api/voice.py:104`) becomes
N possibly-different values for one message, which lands directly on the **D62 serve-attribution chip
shipped in v1.7.4**. Both want a ruling: pin the winning target for the rest of the message, or accept
and attribute per chunk.

### 7.3 The blob cache becomes an N-per-message leak, and `/clear` is the only reaper

**VERIFIED.** `audioController.ts:29` caches one object URL per message and only
`clearAudioCache()` (`:163-167`, wired to `/clear` at `store/chat.ts:9`) ever revokes. Under
`sentence` mode a single long reply produces tens of object URLs and a long session produces hundreds,
each pinning a decoded-audio blob. AnythingLLM revokes the whole queue on every reset
(`piperTTS.jsx:60`); LobeChat revokes the superseded cumulative URL at each rebuild
(`useStreamAudioPlayer.ts:57`). Ours needs an eviction rule (per-message revoke on cache replacement,
or an LRU bound) that today's one-URL-per-message shape did not.

---

## 8. What I could not determine

1. **The actual `src`-swap gap in milliseconds on Android Chrome and Fennec.** Not derivable from
   source; it is the number that decides element-swap vs Web Audio. Needs a device probe.
2. **Whether Speaches actually serves `opus`/`aac`.** Source at HEAD wires both (`audio.py:169-170`);
   the published usage docs say they are unsupported. Unresolved — a one-command probe against the
   owner's instance settles it, and `opus` is the format §4 recommends.
3. **Whether an in-flight, `Content-Length`-less chunked audio response yields a usable `duration` /
   scrubber in either engine.** Reasoned from Gecko's `StreamLength() != -1` guard and from
   LibreChat/LobeChat both routing *around* the problem, but not probed. Gates §7.1.
4. **Whether `decodeAudioData` in Chrome applies mp3 encoder-delay trimming identically to Gecko.**
   Gecko's path is source-verified; Chrome's was inferred from its ffmpeg-based decoder. Moot if we
   move off mp3.
5. **Perceptual A/B of sentence vs paragraph granularity on Kokoro specifically.** §3 establishes the
   *mechanism* (short batches shift rate and loudness; Kokoro re-batches internally at ≤510 phonemes
   anyway) but no peer publishes a listening comparison, and I ran none.
6. **Whether ctrl-b's `timeout_s=30.0` / `connect_timeout_s=3.0` are right per-chunk.** The idle-reset
   §C3 wants to sidestep is plausibly fixed by short requests, but the reset itself was never traced to
   a specific layer in this pass.

---

## 9. Implications — **our reading, not evidence**

Short and separate, per the folder conventions. Everything below is a proposal for the design session.

**Mechanism.** Sequential `HTMLAudioElement` `src` swap, advancing on `ended`, with AnythingLLM's
*waiting latch* (`piperTTS.jsx:24-47`) as the shape. 4/4 peers, ~90 lines, keeps the existing
`timeupdate`/`durationchange` mirroring in `audioController` intact, and inherits sticky activation on
both engines. **Do not build Web Audio scheduling** — zero adopters, full-PCM residency, and it costs
us a hand-rolled scrubber. **Do not build MSE** — Gecko refuses `audio/mpeg`, which is the only form
the field ships.

**Format.** Change `TtsServiceCfg.format` away from `mp3` for the chunked path. `opus` if the §8.2
probe confirms Speaches serves it (sample-exact, 9.5 KB/s); `wav` as the certain fallback
(sample-exact, 48 KB/s, and Gecko's clamp makes ffmpeg's `ffffffff` header harmless). Keeping `mp3`
under chunking buys a measured **+46 ms of dead air at every chunk start**. If a single knob must
serve both paths, make the chunked path's format its own field rather than degrading the buffered
one.

**Granularity + thresholds.** `paragraph` default (the sketch's call, and it minimises boundaries) with
`sentence` available — but the merge floor is what matters: adopt open-webui's **`< 4 words || < 50
chars` → merge forward**, and add a **max** (the field's range is 100–1000; ~400, AnythingLLM's number,
sits mid-range and is comfortably under Kokoro's 510-phoneme batch). Both as config, not constants.
Skip `Intl.Segmenter` — probed, no better on abbreviations, and the merge rule absorbs the misses.

**Synth-ahead depth: 1.** Both the peers and Kokoro's own wrapper converge on it, with an explicit
reason (*"so the producer cannot run away with the whole text"*). Depth 1 also bounds the blob leak of
§7.3 and makes cancellation cheap.

**Chunker inputs.** Extend `toSpeech` first — strip tables and emoji (open-webui's two extra passes)
— rather than leaning on Speaches' server-side strip, which a different OpenAI-compatible server will
not do. Then chunk the *cleaned* text. Refactoring `markdown.tsx` into `parse` + `render` to reuse
block boundaries is a genuine but non-trivial option (§1); a placeholder-protected regex over the
already-stripped prose (open-webui's approach) is the cheap correct alternative and never sees a fence,
because `toSpeech` already dropped it.

**Config shape.** Per the repo's extend-don't-migrate rule, these are additive fields on the existing
`TtsServiceCfg` object, not a sibling map: `chunking: off|paragraph|sentence` (default per above),
`chunk_min_chars`, `chunk_min_words`, `chunk_max_chars`, `chunk_lookahead` (default 1). `off` = today's
path, unchanged.

**Sequencing.** Consider proving §7.1 (`GET` + `StreamingResponse`, one request, native progressive
playback) *before* building the chunker — it is a smaller change that attacks the same 24 s, and its
one real risk (a degraded scrubber while streaming) is a 20-minute probe away from being settled. If
that probe fails, chunking is the answer and nothing is lost; if it succeeds, chunking's remaining
value is per-chunk cancellation and read-along-while-streaming, which reprices the slice.

**Also needs a ruling before build:** the `max_text_chars` re-expression and the per-chunk
failover/`X-Voice-Served-By` interaction with D62 (§7.2), and a blob-eviction rule (§7.3).
