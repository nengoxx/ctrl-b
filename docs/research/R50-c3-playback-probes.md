# R50 — C3 playback probes: the five things R48 §8 could not determine, measured

**Date:** 2026-08-21
**Status:** Evidence dossier — probe pass, complete for the bounded question. Not a decision.
**What drove it:** the C3 design session (owner, 2026-08-21): "research and double check the right
approach for the most reliability and TTS compatibility" — settles R48 §8 items 1 (desktop half),
2, 3, and the cross-backend format question. Owner concern on record: no mechanism that is
Speaches-coupled or ages badly across TTS backends.
**Drove:** the C3 design ruling (chunked element-queue only, opus, no single-stream mode — D-entry
pends the design confirm).


**Run:** emma (Linux, 16 cores), 2026-08-21. Read-only on the repo; all work in
`/home/emma/.cache/tmp/c3-probes/` (cleaned up after).
**Toolchain:** ffmpeg 8.0.1 · Python 3.14.4 (backend venv `httpx`) · Playwright 1.61.1 →
**Chromium 149.0.7827.55** / **Firefox 151.0** (the repo's own e2e browsers).
**Prior evidence assumed, not re-derived:** R48 §3/§4/§5/§7/§8 — mp3-from-a-pipe carries ~46 ms of
prepended dead air, Speaches muxes every non-pcm format through one long-lived ffmpeg pipe, autoplay
is sticky on both engines after one gesture.

**Marker key:** VERIFIED = I ran it here and read the number. REPORTED = docs/READMEs only.

---

## PROBE 1 — Does the owner's Speaches serve `opus` (and `aac`)?  **VERIFIED**

Endpoint resolved from `~/.ctrl-b-dev/config.yaml`: `voice.tts.provider = emma-speaches` →
**`http://127.0.0.1:9000/v1`** (it is a **local** service on emma, not on a sleeping fleet host —
nothing was woken). Model `speaches-ai/Kokoro-82M-v1.0-ONNX`, voice `bf_isabella` (the configured
one). Shipped `voice.tts.format` today = `mp3`. *(No other config value was read out; the provider's
1-char api_key was written to a 0600 scratch file and referenced only via `$K`.)*

Fixed 2-sentence input (98 chars): *"The fleet is online and every host reports healthy. Wake corsair
when you are ready to continue."*

```bash
K=$(cat .k)
for f in wav pcm mp3 opus aac flac; do
  curl -s -m 60 -o p1.$f -D p1.$f.hdr -w "%{http_code}" \
    -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
    -d "{\"model\":\"speaches-ai/Kokoro-82M-v1.0-ONNX\",\"voice\":\"bf_isabella\",\"input\":\"$IN\",\"response_format\":\"$f\"}" \
    http://127.0.0.1:9000/v1/audio/speech
done
# round-trip:
ffprobe -v error -show_entries format=format_name,duration -show_entries stream=codec_name,sample_rate,channels p1.$f
ffmpeg  -v error -i p1.$f -f s16le -ar 24000 -ac 1 p1.$f.raw -y   # then bytes/2 = samples
```

| `response_format` | HTTP | bytes | `Content-Type` | container / codec | decoded samples @24 k | vs wav | KB per audio-second |
|---|---|---|---|---|---|---|---|
| `pcm`  | 200 | 258 048 | — | raw s16le | 129 024 | **exact** | 48.0 |
| `wav`  | 200 | 258 126 | `audio/wav`  | wav / pcm_s16le | 129 024 | **exact** | 48.0 |
| `flac` | 200 | 167 708 | `audio/flac` | flac | 129 024 | **exact** | 31.2 |
| **`opus`** | **200** | **49 356** | **`audio/opus`** | **ogg / opus (48 kHz)** | **129 024** | **exact** | **9.2** |
| `aac`  | 200 | 50 609 | `audio/aac` | adts / aac | 130 048 | **+1 024 (+42.7 ms)** | 9.4 |
| `mp3`  | 200 | 21 740 | `audio/mpeg` | mp3 | 130 176 | **+1 152 (+48 ms)** | 4.0 |

Audio length 5.376 s. Every response was `Transfer-Encoding: chunked` with **no `Content-Length`**.

Two independent confirmations of R48 §4 against the *real* server rather than a replica: the mp3
delay is there (+48 ms/chunk, matching the ~46 ms figure), and the piped wav header really is
`RIFF ffffffff … data ffffffff` (`xxd -l 8 stream.wav` → `5249 4646 ffff ffff`; offset 0x46 →
`6461 7461 ffff ffff`).

> **VERDICT (gates the format choice):** **`opus` IS served, correctly, and is sample-exact** — the
> published Speaches docs saying "opus and aac are not supported" are **wrong at HEAD**, exactly as
> R48 suspected. `aac` is served too but carries its own 42.7 ms encoder delay, so it buys nothing
> over `opus`. Format for the chunked path = **`opus`** (5.2× smaller than wav, sample-exact,
> boundary-clean); `wav` is the fallback for a non-Speaches server. **`mp3` is disqualified.**
> One rider: Speaches labels Ogg Opus **`audio/opus`**, which is not a registered MIME type — probe 3
> shows both engines accept it anyway, but any code that sniffs the `Content-Type` (blob typing,
> `MediaSource.isTypeSupported`) must not assume `audio/ogg`.

---

## PROBE 2 — Does the endpoint actually stream?  **VERIFIED**

`curl`'s `time_starttransfer` is **useless here**: it reported 2–3 ms for every format, because
FastAPI's `StreamingResponse` flushes headers before generating a single audio byte. I re-measured
with a byte-arrival timeline (`httpx` `iter_raw`, `perf_counter` per raw chunk). Input = 1 498 chars,
9 sentences → **83.2 s of audio**.

```python
with c.stream("POST", ".../v1/audio/speech", json=body, headers={"Authorization": f"Bearer {key}"}) as r:
    for chunk in r.iter_raw():
        events.append((time.perf_counter() - t0, total_bytes))
```

| format | headers at | **first audio byte** | 25 % of bytes by | 50 % | **total** | audio produced |
|---|---|---|---|---|---|---|
| `wav`  | 80 ms | **3 996 ms** | 4.02 s | 8.12 s | **13.64 s** | 83.2 s |
| `opus` | 29 ms | **4 369 ms** | 4.43 s | 8.66 s | **14.11 s** | 83.2 s |
| `mp3`  | 30 ms | **3 851 ms** | 3.90 s | 9.16 s | **16.40 s** | 83.3 s |
| `pcm`  | — | **4 430 ms** | — | — | 16.11 s | 83.2 s |

Every response: `content-length=None`, `transfer-encoding='chunked'`. **Yes, it streams.**

But the *granularity* is the finding. Grouping arrivals by >250 ms idle gaps (`p2_steps.py`) shows
**four discrete bursts, not a smooth trickle** — and the identical structure appears in `pcm`, which
never touches ffmpeg, so this is **Kokoro's internal ≤510-phoneme batching**, not pipe buffering:

| burst | wav arrives | bytes | ≈ audio in it |
|---|---|---|---|
| 1 | 3.92 → 3.96 s | 1 130 496 | **23.6 s** |
| 2 | 8.09 → 8.12 s | 1 224 704 | 25.5 s |
| 3 | 11.76 → 11.78 s | 1 101 824 | 23.0 s |
| 4 | 13.47 → 13.49 s | 536 654 | 11.2 s |

Baseline for comparison — **one sentence** (61 chars, 3.71 s of audio), whole request:
`ttfb-to-last-byte = 0.692 s`.

> **VERDICT (gates approach A, R48 §7.1):** TTFB *is* first-batch synth time and total *is* many
> seconds more — but the batch is **~23 s of audio**, not a sentence. Quantified for the design:
> **today 13.6 s → un-buffering our proxy alone gets 3.9 s → client-side sentence chunking gets
> ~0.7 s.** R48 §7.1's claim that "either one alone gets the 24 s down to first-batch latency" is
> true but understates the residual: **streaming-only leaves a ~4 s wait; only chunking reaches
> sub-second.** The two are not interchangeable for the latency goal. Synth throughput ≈ **6.1×
> realtime**, so a chunk is always produced faster than it is consumed — depth-1 synth-ahead is
> sufficient and will never starve at this ratio.

---

## PROBE 3 — The `<audio>` `src`-swap gap (desktop Chromium + Firefox)  **VERIFIED**

8 clips of **real Kokoro speech** (one sentence each, 1.56–3.16 s, 19.16 s total) pulled from the
server in both `wav` and `opus`. Served by a trivial `http.server` on 127.0.0.1:8731. The page runs
**open-webui's exact pattern** — ONE `Audio` element, `.src` assigned inside the `ended` handler:

```js
a.addEventListener('ended', () => {
  tEnded = performance.now();
  i++; if (i >= n) return resolve(log);
  a.src = `clips/c${i+1}.${fmt}`;      // src swap in ended
  a.play().catch(...);
});
a.addEventListener('playing', () => { log.boundaries.push(performance.now() - tEnded); });
```

Launch: chromium `--autoplay-policy=no-user-gesture-required`; firefox
`media.autoplay.default=0`, `media.autoplay.blocking_policy=0`. Each case = 1 discarded warm-up run +
2 measured runs (14 boundaries). One real `#go` click first, for sticky activation.

| engine | format | MIME served | n | **median gap** | p90 | **max** |
|---|---|---|---|---|---|---|
| Chromium 149 | wav  | `audio/wav`  | 14 | **6.4 ms** | 9.9 ms | 10.2 ms |
| Chromium 149 | opus | `audio/ogg`  | 14 | **5.8 ms** | 8.8 ms | 9.1 ms |
| Chromium 149 | opus | `audio/opus` | 14 | **4.2 ms** | 8.3 ms | 8.4 ms |
| Firefox 151  | wav  | `audio/wav`  | 14 | **4.5 ms** | 7.0 ms | 7.0 ms |
| Firefox 151  | opus | `audio/ogg`  | 14 | **5.5 ms** | 10 ms | **18 ms** |
| Firefox 151  | opus | `audio/opus` | 14 | **4.0 ms** | 8.0 ms | 8.0 ms |

Zero `error` events, zero `play()` rejections, in all 6 cases — **sticky activation survives every
`src` swap on both engines**, confirming R48 §5.1 behaviourally.

**A cold-start caveat worth carrying:** the *first* (un-warmed, high-load) pass showed Chromium/wav
boundaries of `[10.6, 174.7, 232.4, 73.7, 7.3, 7.9, 4.4]` and one Chromium/ogg run that stalled out
entirely. With a warm-up clip the same cases are uniformly single-digit. **The first two or three
boundaries of a reply are the risky ones**, which is an argument for prefetching chunk 2 (depth-1
synth-ahead already does this) rather than for a different mechanism.

**Headless honesty:** these browsers have no real audio sink. Wall-clock total was **20.4–21.1 s for
19.16 s of audio**, i.e. playback ran at true realtime, so the decode/scheduling path is genuinely
exercised; what is *not* exercised is a hardware output device's own buffer-restart latency, which on
a phone can add to these numbers. The comparable, mechanism-level number is the one above.

> **VERDICT (element-queue vs anything fancier):** **Element queue wins; build nothing fancier.**
> A desktop `src`-swap boundary costs **4–6 ms median, ≤18 ms worst**, against the **250 ms of
> trailing silence Kokoro already appends** to a sentence-final chunk (R48 §3). That is a ~15–60×
> margin — the seam is inaudible by construction, not by luck. **Do not build Web Audio scheduling;
> do not build MSE.** Both `audio/ogg` and Speaches' odd `audio/opus` label play fine in both
> engines.

---

## PROBE 4 — Progressive playback of ONE chunked, `Content-Length`-less stream  **VERIFIED**

`stream_srv.py` (≈30 lines) replays a **real Speaches response** (17.92 s of speech, the same 8
sentences as one input) with `Transfer-Encoding: chunked`, **no `Content-Length`, no
`Accept-Ranges`**, paced at **1.5× realtime** in 50 ms slices → the full body takes **11.95 s** of
wall clock to deliver. A bare `<audio src=…>` + immediate `.play()`; every media event logged with
`performance.now()`, `currentTime`, `duration`, `buffered.end`.

| engine | MIME | (a) `play()`→`playing` | (b) `duration` **in flight** | (b) `duration` **after EOS** | (c) timeupdates | (c) stalls | (d) **seek back after EOS** |
|---|---|---|---|---|---|---|---|
| Chromium | `audio/wav` | **3 227 ms** | `Infinity` | 17.835 (at t=18.1 s) | ok, ≤268 ms gaps, ≤0.28 s jumps | one `waiting` at t=16 ms only | **FAILS** — `seekable=[0,0]`, seek→**0** |
| Chromium | `audio/ogg` | **2 423 ms** | `Infinity` | 17.9135 | ok | same | **FAILS** — `seekable=[0,0]` |
| Chromium | `audio/opus` | **2 414 ms** | `Infinity` | 17.9135 | ok | same | **FAILS** |
| Chromium | `audio/mpeg` | **5 464 ms** | `Infinity` | 17.952 | ok | same | **FAILS** |
| Firefox | `audio/wav` | **471 ms** | **`89478.485292`** ⚠ | **`89478.485292`** (never corrected) ⚠ | ct advances 0→17.1 then **snaps to 89478.485** | one `waiting` at t=1 ms | "works" but into a garbage timeline |
| Firefox | `audio/ogg` | **2 410 ms** | **grows**: `Infinity`→3.99→6.99→…→15.99 | **17.92** exact | ok, ≤384 ms gaps, ≤0.30 s jumps | one `waiting` at t=0 | **WORKS** — `seekable=[0,17.92]`, seek→**2.000** |
| Firefox | `audio/opus` | **2 405 ms** | grows, as above | **17.92** | ok | same | **WORKS** |
| Firefox | `audio/mpeg` | **5 456 ms** | grows: 8.90→…→17.16 | 17.976 | ok | same | **WORKS** — `seekable=[0,17.98]` |

Confirmed with a settle delay (`p4b.mjs`, 1.5 s after `ended`, then read state and seek to 3.0):

```
chromium-ogg: before={dur:"17.9135", seekable:[0,0],     buffered:[0,17.92]}  afterSeek: currentTime=0
firefox-ogg : before={dur:"17.92",   seekable:[0,17.92], buffered:[0,17.92]}  afterSeek: currentTime=3
```

**Chromium declares the resource unseekable even when the entire 17.92 s is in `buffered`, and even
after `duration` has become a correct finite number.** Requesting `currentTime = 3` rewinds to 0.

The `89478.485292` on Firefox/wav is **`0xFFFFFFFF ÷ 48000 B/s`** — R48 §4.2's prediction landing
exactly: `WaveDemuxer`'s clamp needs `StreamLength() != -1`, a live chunked stream has no length, so
ffmpeg's bogus `data ffffffff` size is believed verbatim. It never self-corrects at EOS, and `ended`
fires with `currentTime = 89478.485`.

> **VERDICT (gates approach A, single-stream):** **Progressive playback works on both engines and it
> is genuinely fast** — Chromium `playing` at 2.4 s, Firefox at 0.47–2.4 s, against 11.95 s of
> delivery and 17.92 s of audio, with no mid-stream stalls at 1.5× pacing. **But the scrubber story
> is bad and asymmetric:** Firefox gets a *growing* duration and full seeking (good); **Chromium gets
> `duration === Infinity` for the whole stream and NEVER becomes seekable at all** — that is the hard
> stop, and it is the mirror image of the risk R48 expected (it predicted Gecko would be the weak
> one). **`wav` is additionally disqualified for this path on Gecko** by the 89 478 s duration.
> If approach A is built: format must be **Ogg Opus**, and the mini-player must either hide the
> scrubber or do LobeChat's trick — swap `src` to a cached blob at EOS to recover duration+seeking.
> `mp3` is disqualified a third time here: **~5.46 s to first audio on both engines vs ~2.41 s for
> opus**, more than double.
> **Composite reading:** approach A is a real ~3.5× TTFA win with a broken Chromium scrubber;
> approach B (chunked synth + element queue) is a ~19× TTFA win with a 4–6 ms seam and per-chunk
> `duration`. B dominates on latency; A's only unique prize is zero seams, which probe 3 shows we
> do not need.

---

## PROBE 5 — `response_format` across OpenAI-compatible TTS servers  **REPORTED** (docs only, 12 min)

| Server | `mp3` | `opus` | `aac` | `flac` | `wav` | `pcm` | Default | Note |
|---|---|---|---|---|---|---|---|---|
| **OpenAI** official `/v1/audio/speech` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `mp3` | `stream_format: audio\|sse`; *"sse is not supported for `tts-1` or `tts-1-hd`"*. Guide recommends `wav`/`pcm` for fastest response; streams via chunked transfer encoding. |
| **openedai-speech** (matatonic) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `mp3` | README: *"response_format: `mp3`, `opus`, `aac`, `flac`, `wav` and `pcm`"* — no caveats listed. Requires system `ffmpeg`. |
| **Kokoro-FastAPI** (remsky) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `mp3` | README advertises "Multiple Output Audio Formats" (mp3/wav/opus/flac/aac/pcm) **and** "Streaming Support" as core features. |
| **Speaches** (ours) — *docs* | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | `mp3` | Published docs: *"response_format: opus and aac are not supported"*. |
| **Speaches** (ours) — *measured* | ✅ | **✅** | **✅** | ✅ | ✅ | ✅ | `mp3` | **Probe 1, VERIFIED** — the docs are stale; all six work. |

> **VERDICT (guards the "another server would differ" concern):** **`opus` and `wav` are universal**
> across all four OpenAI-compatible servers checked — choosing `opus` for the chunked path does not
> tie ctrl-b to Speaches. The genuine portability hazards are elsewhere, and R48 already named them:
> (i) Speaches strips emoji + markdown emphasis server-side and **peers do not**, so `toSpeech` must
> do it client-side; (ii) Speaches' non-standard **`audio/opus`** Content-Type — peers will likely
> send `audio/ogg`, so never key logic on the exact string. Also note **`stream_format: sse` is not
> a portable assumption** (OpenAI restricts it by model; the peers do not advertise it at all) —
> byte-level chunked `audio` is the portable streaming form.

Sources: [OpenAI create-speech reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create) ·
[openedai-speech README](https://raw.githubusercontent.com/matatonic/openedai-speech/main/README.md) ·
[Kokoro-FastAPI README](https://raw.githubusercontent.com/remsky/Kokoro-FastAPI/master/README.md) ·
[Speaches TTS usage docs](https://speaches.ai/usage/text-to-speech/)

---

## Design consequences, in one place

1. **Mechanism: sequential `<audio>` `src` swap.** 4–6 ms median seam vs Kokoro's own 250 ms of
   trailing silence. No Web Audio, no MSE. (Probe 3)
2. **Format: `opus`.** Sample-exact, 9.2 KB/s, served by every peer, and the only format that behaves
   on *both* engines in the single-stream case too. `wav` = the non-Speaches fallback. **`mp3` loses
   three ways**: +48 ms dead air per chunk, 2.3× slower to first audio when streamed, and no upside
   left once `opus` is confirmed. (Probes 1, 4)
3. **Chunking beats un-buffering, and by a lot.** 13.6 s → 3.9 s (stream only) → ~0.7 s (sentence
   chunks). R48 §7.1's sequencing advice ("prove §7.1 first") is sound as a *cheap* first step but it
   is not a substitute: the Kokoro batch is ~23 s of audio. (Probe 2)
4. **If §7.1 ships anyway, budget for Chromium's scrubber.** `duration === Infinity` throughout and
   `seekable === [0,0]` **forever**. Hide the scrubber, or blob-swap at EOS.  (Probe 4)
5. **Never `Content-Type`-sniff for `audio/ogg`.** Speaches sends `audio/opus`. (Probe 1)
6. **Warm the first boundary.** Cold-start `src` swaps on Chromium hit 175–232 ms; warmed ones hit
   6 ms. Depth-1 synth-ahead already covers this — do not skip it as an optimization. (Probe 3)

---

## What I could not determine

1. **The `src`-swap gap on Android Chrome and Fennec, on real hardware.** *Excluded by design from
   this pass* — it remains R48 §8.1, still open. The desktop numbers here (4–6 ms median, ≤18 ms max,
   against 250 ms of Kokoro silence) make it very likely fine, but a phone's audio-output path has
   its own restart latency that no headless run touches.
2. **Progressive-playback behaviour on Android Chrome / Fennec.** Same exclusion. Chromium-desktop's
   `seekable=[0,0]` almost certainly carries to Android Chrome (same Blink media stack), but that is
   inference, not measurement.
3. **Whether adding `Content-Length` (without `Accept-Ranges`) would restore Chromium seeking.** Not
   tested — out of the probe's scope, and our backend cannot know the byte length ahead of synth
   anyway. The known-good workaround (blob-swap at EOS) is peer-proven and needs no probe.
4. **Whether the 1.5× pacing hid real-world stalls.** At 1.5× nothing starved. A phone on cellular
   receiving 9.2 KB/s of opus has huge headroom, but a *slower-than-realtime* link would produce
   `waiting`/`stalled` events I did not exercise.
5. **Perceptual A/B of sentence vs paragraph granularity.** Still R48 §8.5 — no listening test was
   run; nothing here changes that.
6. **Chrome's `decodeAudioData` mp3 delay-trim parity with Gecko.** Still R48 §8.4, and now moot —
   `mp3` is out on three independent measured grounds.
7. **Headless caveat, stated plainly.** Both engines ran without an audio sink. Playback advanced at
   true wall-clock realtime (20.4–21.1 s for 19.16 s of audio), so decode + event scheduling are
   genuinely measured; hardware sink restart cost is not.
