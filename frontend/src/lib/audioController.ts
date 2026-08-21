// Phase 6b-2 — shared TTS playback controller (singleton). Exactly one <audio> element and one
// active message at a time: this is the genuinely-shared piece of voice (per-bubble play buttons, the
// chat reducer's auto-TTS, and the docked MiniPlayer all coordinate one player), so unlike recording
// (a local hook) it lives as a module singleton on the shared `createStore` binding (D23).
//
// The <audio> element is the source of truth for time/duration/paused — we mirror its native events
// into a small reactive snapshot rather than tracking playback by hand.
//
// D63 — CHUNKED SYNTHESIS. A message is normally split by `lib/ttsChunks` into an ordered chunk list
// that synthesizes and plays SEQUENTIALLY on that same one element: `src`-swap on `ended`, synth-ahead
// `lookahead` deep with a waiting latch, so the first sentence is audible in ~0.7 s instead of ~13.6 s
// (R50 P2; the swap seam measured 4–6 ms, which is why there is no Web Audio and no MSE here). The
// server owns the policy — it rides `GET /voice/status` — and until it has answered this module does
// exactly what it did before D63 (`mode: "off"`, one blob per message). Everything chunk-specific hangs
// off `session`; the `off` path below is the pre-D63 code, unchanged, cache and all.
//
// D63 AMENDMENT — SCRUBBER v2. The player's bar and its seek span the WHOLE reply while the audio
// mechanics stay exactly that per-chunk src-swap queue: only the BOOKKEEPING goes global. Each chunk
// gets a slot on a virtual timeline (exact once its blob's metadata is probed, chars/sec-estimated
// before that), position = the playing chunk's slot + the element's `currentTime`, and a seek maps a
// global fraction back to (chunk, offset). No blob concatenation, no reload at the seams.
//
// The reactive snapshot (`pb`) mirrors the <audio> element's native events; components subscribe via
// `usePlayback`. The listener/notify/React-binding plumbing is the shared `createStore` binding (D23) —
// this singleton is one of its ten consumers; only the snapshot + the DOM logic below are local to it.

import { pushToast } from "../store/toast";
import { createStore } from "../store/createStore";
import { toSpeech } from "./toSpeech";
import { chunkPlan, type ChunkCfg } from "./ttsChunks";

export type PlayStatus = "idle" | "loading" | "playing" | "paused";

/** One chunk's slot on the whole-message timeline (D63 amendment, scrubber v2). `dur` is the chunk's
 *  EXACT duration once its blob has been probed and a chars/sec estimate before that; `ok` is whether
 *  the audio exists yet, which is what hollows the waveform's not-yet-synthesized bars. */
export interface ChunkSpan {
  start: number; // seconds from the start of the MESSAGE
  dur: number;
  ok: boolean;
}

export interface Playback {
  id: string | null; // message id currently loaded (null = nothing docked)
  status: PlayStatus;
  current: number; // seconds elapsed — of the whole MESSAGE under chunking, of the clip under `off`
  duration: number; // seconds total (0 until known)
  /** At least one chunk's duration is still a chars/sec estimate — the player tildes the time label. */
  estimated: boolean;
  /** The chunk map behind the waveform's third bar state; null under `off` (no chunks to map).
   *  REFERENCE-STABLE: rebuilt only when a duration or a chunk state changes, never per `timeupdate`. */
  chunks: ChunkSpan[] | null;
}

/** The D63 chunk policy, in client spelling. `lookahead`/`format` are the queue's half of it; the rest
 *  is the chunker's. Delivered by `GET /voice/status` (see hooks/useVoiceStatus). */
export interface ChunkPolicy extends ChunkCfg {
  /** Synth-ahead depth: 1 = synthesize chunk N+1 while chunk N plays. */
  lookahead: number;
  /** The per-chunk container asked for on the wire (request > model > service, D63/MED-4). */
  format: string;
}

const { emit, useStore } = createStore();
const IDLE: Playback = {
  id: null,
  status: "idle",
  current: 0,
  duration: 0,
  estimated: false,
  chunks: null,
};
let pb: Playback = IDLE;
const cache = new Map<string, string>(); // `off` path: messageId → object URL (synth once per message)
let el: HTMLAudioElement | null = null;
let reqSeq = 0; // guards against an out-of-order synth resolving after a newer toggle
// Generation of the last `play()` the QUEUE started. A `play()` interrupted by a newer `src` rejects
// with AbortError — often AFTER the newer clip's `play` event has already landed — and the generation
// alone can't see that (both belong to the same message). Publishing "paused" there would lie about
// live audio AND wedge the transport (a tap then calls `play()` on an already-playing element, which
// fires no `play` event to correct it). Only the play that is still the latest may settle the status.
let playOp = 0;

/** Pre-D63 behavior until the server tells us otherwise — the policy has exactly one source. */
let policy: ChunkPolicy = {
  mode: "off",
  minWords: 4,
  minChars: 50,
  maxChars: 400,
  maxTextChars: 4096,
  lookahead: 1,
  format: "opus",
};

/** Publish the server's chunk policy (called from the `/voice/status` query — no fetch of our own). */
export function setChunkPolicy(next: ChunkPolicy): void {
  policy = next;
}

// ── the chunk queue ──────────────────────────────────────────────────────────────────────────────

type ChunkState = "pending" | "ok" | "failed";

/** The ONE retained message's queue. Retention is single-message by design (D63): starting a different
 *  message revokes these URLs, `/clear` reaps everything, and an older message replays by re-synthesis
 *  (synth runs ~6× realtime, so that is cheaper than holding N blobs per reply). */
interface Session {
  id: string;
  seq: number; // the `reqSeq` generation that owns this queue
  texts: string[];
  urls: (string | null)[];
  states: ChunkState[];
  requested: boolean[];
  durations: (number | null)[]; // EXACT seconds once the chunk's blob has been probed; null before that
  tl: Timeline; // the derived whole-message timeline — rebuilt only when durations/states move
  playIdx: number; // chunk currently loaded in the element (-1 = none yet)
  waiting: boolean; // playback caught up to synthesis and is holding for the next chunk
  wantPlay: boolean; // the user's play/pause INTENT — a pause taken under the latch must survive it
  // A forward seek waiting for its chunk (one-shot). The position is a FRACTION of the target span, not
  // seconds: the span it was measured against is an ESTIMATE, so seconds would land past the end of a
  // shorter chunk (instant `ended` → an unwanted rewind) or far short of a longer one, and refinement
  // would never remap the stored intent. The fraction survives the estimate being wrong.
  seek: { idx: number; frac: number } | null;
  // Cancels the armed metadata payout (if any). Every newer navigation — a fresh seek, the end-of-queue
  // rewind, a replay re-arm — calls it, so a stale fraction can never override newer intent.
  metaSeek: (() => void) | null;
  pin: string | null; // `X-Voice-Target` of the serving endpoint, echoed as `prefer` on later chunks
  pinned: boolean; // chunk 1 answered: the pin is settled (or given up on) and the window may open
  errored: boolean; // a chunk failed and we already toasted (one toast per message)
  abort: AbortController;
}
let session: Session | null = null;

function revokeSession(s: Session): void {
  for (const url of s.urls) if (url) URL.revokeObjectURL(url);
}

function set(p: Partial<Playback>): void {
  pb = { ...pb, ...p };
  emit();
}

// ── the whole-message timeline (D63 amendment: scrubber v2) ──────────────────────────────────────
//
// The queue still plays ONE chunk at a time on the one element — only the BOOKKEEPING is whole-message.
// Every chunk gets a slot on a virtual timeline: its exact duration once its blob exists, a chars/sec
// estimate before that. Global duration = the sum; global position = the playing chunk's slot start +
// the element's own `currentTime`; a seek maps a global fraction back to (chunk, offset).

interface Timeline {
  spans: ChunkSpan[];
  total: number;
  estimated: boolean; // at least one span is still an estimate
}

/** The ONE instant before any chunk has a probed duration — the player is docked at `status: "loading"`,
 *  so the bar is inert and the seek disabled, and the only thing this rate feeds is a placeholder width.
 *  A constant is acceptable precisely because it cannot survive contact with real audio: chunk 0's blob
 *  is probed milliseconds later and every estimate after that is learned from real durations. No config
 *  key for the same reason — there is nothing here for an owner to tune. */
const FALLBACK_CHARS_PER_SEC = 15;

/** Rebuild `s.tl` from the durations known right now. Learned rate = (Σ known seconds) over (Σ those
 *  chunks' characters), so a voice's real pace — Kokoro's constant trailing pad included — is folded in
 *  without modelling it. A FAILED chunk keeps its estimated slot: the audio is missing, and showing the
 *  hole (a hollow stretch the playhead jumps) beats silently shrinking the bar under the user's finger. */
function buildTimeline(s: Session): void {
  let chars = 0;
  let secs = 0;
  for (let i = 0; i < s.durations.length; i++) {
    const d = s.durations[i];
    if (d !== null) {
      secs += d;
      chars += s.texts[i].length;
    }
  }
  const rate = secs > 0 && chars > 0 ? chars / secs : FALLBACK_CHARS_PER_SEC;
  const spans: ChunkSpan[] = [];
  let at = 0;
  let estimated = false;
  for (let i = 0; i < s.texts.length; i++) {
    const exact = s.durations[i];
    if (exact === null) estimated = true;
    const dur = exact ?? s.texts[i].length / rate;
    spans.push({ start: at, dur, ok: s.states[i] === "ok" });
    at += dur;
  }
  s.tl = { spans, total: at, estimated };
}

/** Where the playhead is on the whole-message timeline. */
function globalCurrent(s: Session): number {
  const { spans } = s.tl;
  // A forward seek waiting for its chunk owns the playhead: the element is paused on the OLD chunk and
  // its `currentTime` would drag the bar backwards every time a lookahead chunk lands.
  if (s.seek) {
    const sp = spans[s.seek.idx];
    return (sp?.start ?? 0) + s.seek.frac * (sp?.dur ?? 0);
  }
  if (s.playIdx < 0 || !el) return 0;
  return (spans[s.playIdx]?.start ?? 0) + el.currentTime;
}

/** Republish the whole-message snapshot. Called ONLY when the timeline itself moved (a chunk landed,
 *  failed, or resolved to an exact duration) — never per `timeupdate`, so `chunks` stays a stable
 *  reference for the store's selector contract and the waveform's per-bar map is not rebuilt 4×/sec. */
function publishTimeline(s: Session): void {
  buildTimeline(s);
  set({
    duration: s.tl.total,
    estimated: s.tl.estimated,
    chunks: s.tl.spans,
    current: globalCurrent(s),
  });
}

/** Read a chunk's EXACT duration off its own blob URL — metadata only, local, effectively instant. Fire
 *  and forget: a probe that resolves into a cancelled or superseded queue is discarded silently (its URL
 *  may already be revoked), and unreadable metadata just leaves the chunk on its estimate. */
function probeDuration(s: Session, i: number): void {
  const url = s.urls[i];
  if (!url) return;
  const probe = new Audio();
  probe.preload = "metadata";
  const done = (): void => {
    probe.removeEventListener("loadedmetadata", done);
    probe.removeEventListener("error", done);
    if (s.seq !== reqSeq || session !== s) return; // MED-7's rule, applied to the probe
    const d = probe.duration;
    if (!Number.isFinite(d) || d <= 0 || s.durations[i] === d) return;
    s.durations[i] = d;
    publishTimeline(s); // an estimate resolving to exact shifts the totals — the bar refines
  };
  probe.addEventListener("loadedmetadata", done);
  probe.addEventListener("error", done);
  probe.src = url;
}

function ensureEl(): HTMLAudioElement {
  if (el) return el;
  const a = new Audio();
  a.preload = "auto";
  const syncDuration = () => {
    // Under chunking the published duration is the MESSAGE's, not this chunk's — the element's own
    // duration is one span of the timeline and would clobber the sum.
    if (liveSession()) return;
    if (Number.isFinite(a.duration)) set({ duration: a.duration });
  };
  a.addEventListener("timeupdate", () => {
    const s = liveSession();
    set({ current: s ? globalCurrent(s) : a.currentTime });
  });
  a.addEventListener("durationchange", syncDuration);
  a.addEventListener("loadedmetadata", syncDuration);
  a.addEventListener("play", () => set({ status: "playing" }));
  a.addEventListener("pause", () => {
    // A clip reaching its end fires `pause` BEFORE `ended` (HTML spec). Mid-queue that is not a user
    // pause, it's the seam — reporting "paused" there would flicker the transport on every chunk
    // boundary (the `if (el.ended) return` guard AnythingLLM's player needs for the same reason).
    // The same holds for the latch generally: a forward seek into a not-yet-synthesized chunk pauses
    // the element deliberately, and in a real browser that `pause` event lands AFTER we have published
    // the latched "playing" — `waiting` is what tells the two apart (today it only ever goes up with
    // `ended` already true, so this widens the guard without changing any shipped path).
    const held = liveSession();
    if (held && (a.ended || held.waiting)) return;
    // Only a real playing→paused transition. Guard against the async pause event landing after we've
    // already moved to "loading" (switching messages) or "idle" (dismiss) and clobbering it.
    if (pb.status === "playing") set({ status: "paused" });
  });
  a.addEventListener("ended", () => {
    const s = liveSession();
    if (s) {
      playNext(s); // advance the queue: next chunk's src, or rewind if this was the last
      return;
    }
    a.currentTime = 0;
    set({ current: 0, status: "paused" }); // reset to start, ready to replay
  });
  a.addEventListener("error", () => {
    if (pb.id) {
      pushToast("Playback failed", "err");
      reset();
    }
  });
  el = a;
  return a;
}

/** The queue, iff it is the one the current generation owns (a cancelled/superseded queue is inert). */
function liveSession(): Session | null {
  return session && session.seq === reqSeq ? session : null;
}

function reset(): void {
  reqSeq++; // invalidate any in-flight synth so a dismissed clip never starts playing
  if (session) {
    session.abort.abort(); // ≤ `lookahead` wasted synths per cancel, by construction
    session.waiting = false;
  }
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  pb = IDLE;
  emit();
}

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────

type TtsOutcome =
  | { ok: true; blob: Blob; target: string; degraded: boolean }
  | { ok: false; aborted: boolean; message: string | null };

/** The single `POST /api/voice/tts` call site, shared by both paths. `format`/`prefer` are omitted
 *  entirely when unset, so the `off` path's request body is byte-identical to the pre-D63 one.
 *  Never throws: a failure comes back as the toast text the caller decides what to do with. */
async function requestTts(
  text: string,
  opts: { format?: string; prefer?: string | null; signal?: AbortSignal },
): Promise<TtsOutcome> {
  const body: Record<string, string> = { text };
  if (opts.format) body.format = opts.format;
  if (opts.prefer) body.prefer = opts.prefer;
  let res: Response;
  try {
    res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch {
    if (opts.signal?.aborted) return { ok: false, aborted: true, message: null };
    return { ok: false, aborted: false, message: "Voice servers unreachable" };
  }
  if (!res.ok) {
    return {
      ok: false,
      aborted: false,
      message:
        res.status === 502 ? "Voice servers unreachable" : `Read-aloud failed (${res.status})`,
    };
  }
  try {
    return {
      ok: true,
      blob: await res.blob(),
      target: res.headers.get("X-Voice-Target") ?? "",
      // Present ONLY when a hop failed before this one answered — the flash is exception-only.
      degraded: res.headers.get("X-Voice-Degraded") === "1",
    };
  } catch {
    return { ok: false, aborted: !!opts.signal?.aborted, message: "Read-aloud failed" };
  }
}

// ── `off`: the pre-D63 whole-message path (unchanged behavior, unchanged cache) ───────────────────

/** Synthesize (or reuse the cached clip for) a message. Returns the object URL, or null on failure
 *  (a toast is shown). 502 = the whole TTS failover chain is unreachable. */
async function synthWhole(id: string, markdown: string): Promise<string | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  const text = toSpeech(markdown);
  if (!text) return null;
  const out = await requestTts(text, {});
  if (!out.ok) {
    if (out.message) pushToast(out.message, "err");
    return null;
  }
  const url = URL.createObjectURL(out.blob);
  cache.set(id, url);
  return url;
}

async function playWhole(
  id: string,
  markdown: string,
  seq: number,
  a: HTMLAudioElement,
): Promise<void> {
  const url = await synthWhole(id, markdown);
  if (seq !== reqSeq) return; // superseded by a newer toggle while we awaited the synth
  if (!url) {
    reset();
    return;
  }
  a.src = url;
  a.currentTime = 0;
  try {
    await a.play();
  } catch {
    // play() rejects on the autoplay/interaction guard — OR because a newer toggle swapped the src and
    // aborted this play. Only the still-current toggle may settle the state (else we'd clobber the
    // newer clip's status with a stale "paused").
    if (seq === reqSeq) set({ status: "paused" });
  }
}

// ── chunked: split → synth-ahead → src-swap on `ended` ───────────────────────────────────────────

/** Start (or replay) the chunk queue for a message. Returns immediately — the first chunk's synth
 *  releases the latch and starts playback. */
function startChunked(id: string, markdown: string, seq: number): void {
  let s = session;
  if (s && s.id === id) {
    // A replay / resume of the retained message: keep every blob already synthesized, re-arm the rest.
    s.seq = seq;
    s.abort = new AbortController();
    s.playIdx = -1;
    s.waiting = false;
    s.wantPlay = true;
    s.seek = null;
    s.metaSeek?.(); // a replay must not inherit a stale armed payout (chunk 0 could re-match it)
    // Re-probe anything that has a blob but no exact duration — a probe launched by the previous play
    // is discarded if it resolves after that generation ended, so a replay is where it gets picked up.
    for (let i = 0; i < s.urls.length; i++)
      if (s.urls[i] && s.durations[i] === null) probeDuration(s, i);
  } else {
    const plan = chunkPlan(toSpeech(markdown), policy);
    if (!plan.chunks.length) {
      reset(); // nothing speakable (code-only reply) — same outcome as the `off` path's empty text
      return;
    }
    if (plan.dropped) {
      // D63 moved the per-MESSAGE bound here from the per-request 422: the tail is dropped, said once.
      pushToast("Reply too long to read in full — the tail was skipped", "info");
    }
    s = {
      id,
      seq,
      texts: plan.chunks,
      urls: plan.chunks.map(() => null),
      states: plan.chunks.map((): ChunkState => "pending"),
      requested: plan.chunks.map(() => false),
      durations: plan.chunks.map((): number | null => null),
      tl: { spans: [], total: 0, estimated: false },
      playIdx: -1,
      waiting: false,
      wantPlay: true,
      seek: null,
      metaSeek: null,
      pin: null,
      pinned: false,
      errored: false,
      abort: new AbortController(),
    };
    session = s;
  }
  publishTimeline(s); // the bar spans the whole reply from the first frame (estimated until it isn't)
  playNext(s); // latches on chunk 0 and pumps the synth window
}

/** Keep `lookahead` chunks past the one playing in flight — no more (a cancel then wastes at most that
 *  many synths) and no fewer (the seam is only inaudible if the next chunk is already a blob). A FAILED
 *  chunk doesn't occupy a slot: it will be skipped at playback, so the window has to reach past it or a
 *  failure mid-queue starves the very chunk that replaces it. */
function pump(s: Session): void {
  if (s.seq !== reqSeq || session !== s) return;
  // BOOTSTRAP: until chunk 1 has answered, the window is exactly one chunk wide. Opening it sooner puts
  // chunk 2 on the wire with no `prefer` to carry — free to re-pay the dead primary the pin exists to
  // avoid, to land on a different voice mid-reply, and to race chunk 1 for `s.pin`.
  let budget = s.pinned ? policy.lookahead : 1;
  for (let i = s.playIdx + 1; i < s.texts.length && budget > 0; i++) {
    if (s.states[i] === "failed") continue;
    budget--;
    if (s.requested[i] || s.states[i] !== "pending") continue;
    s.requested[i] = true;
    void synthChunk(s, i);
  }
}

async function synthChunk(s: Session, i: number): Promise<void> {
  const out = await requestTts(s.texts[i], {
    format: policy.format,
    // The failover pin: chunk 1 discovers who served, the rest ask for that target FIRST. A vanished
    // pin is a silent miss server-side, so a mid-reply death still falls over instead of erroring.
    prefer: i > 0 ? s.pin : null,
    signal: s.abort.signal,
  });
  if (!out.ok && out.aborted) {
    s.requested[i] = false; // cancelled, not failed — a resume re-requests it
    pump(s);
    return;
  }
  // Chunk 1's answer settles the pin either way — a hit sets it, a failure gives up on pinning — and
  // that is what ends bootstrap and opens the full window (see `pump`).
  if (i === 0) s.pinned = true;
  // MED-7 — re-check the generation AFTER the response exists and BEFORE anything is retained, so a
  // synth that lands in a cancelled/superseded queue revokes its URL on the spot rather than leaving a
  // second message's blobs resident.
  const stale = s.seq !== reqSeq || session !== s;

  if (!out.ok) {
    if (stale) return;
    s.states[i] = "failed";
    publishTimeline(s);
    if (!s.errored) {
      s.errored = true;
      pushToast(out.message ?? "Read-aloud failed", "err");
    }
    pump(s); // the failed slot frees the window — pull the chunk that replaces it forward
    if (s.waiting || s.playIdx < 0) playNext(s); // release the latch: skip this chunk, keep reading
    return;
  }

  const url = URL.createObjectURL(out.blob);
  if (stale) {
    URL.revokeObjectURL(url);
    return;
  }
  s.urls[i] = url;
  s.states[i] = "ok";
  publishTimeline(s); // this span is synthesized now — the bar fills it and the seek can land on it
  probeDuration(s, i); // ...and its exact duration replaces the estimate the moment metadata reads
  if (out.target && out.target !== s.pin) {
    const moved = s.pin !== null; // a real mid-reply failover, vs. the first chunk naming its target
    s.pin = out.target;
    // EXCEPTION-ONLY (owner ruling): the happy path says nothing. The first target is announced only
    // when the chain was degraded to reach it; a mid-reply move is by definition worth saying.
    if (moved || out.degraded) pushToast(`Read aloud by ${out.target}`, "info");
  }
  if (s.waiting || s.playIdx < 0) playNext(s);
}

/** Load + play the next ready chunk; hold the latch if synthesis hasn't caught up; rewind at the end. */
function playNext(s: Session): void {
  if (s.seq !== reqSeq || session !== s) return;
  const a = ensureEl();
  let i = s.playIdx + 1;
  while (i < s.texts.length && s.states[i] === "failed") i++; // a failed chunk is skipped, never fatal
  if (i >= s.texts.length) {
    finish(s, a);
    return;
  }
  if (s.states[i] !== "ok") {
    s.waiting = true; // caught up — `synthChunk` calls back here the moment this chunk lands
    pump(s);
    return;
  }
  s.waiting = false;
  s.playIdx = i;
  // A forward seek that latched on a not-yet-synthesized chunk pays out HERE, exactly once: it belongs
  // to the chunk it targeted, so it is consumed whether or not this is that chunk (a target that failed
  // in the meantime hands off to the next playable one, from its start).
  let frac = 0;
  if (s.seek) {
    if (s.seek.idx === i) frac = s.seek.frac;
    s.seek = null;
  }
  const span = s.tl.spans[i];
  a.src = s.urls[i]!;
  a.currentTime = 0;
  // The fraction can only become seconds once the element knows how long this chunk REALLY is; until
  // then the chunk starts at 0 and the published position rides the estimate.
  if (frac > 0) applySeekOnMetadata(s, i, a, frac);
  pump(s); // window moved: start the next synth WHILE this chunk plays
  const at = (span?.start ?? 0) + frac * (span?.dur ?? 0);
  if (!s.wantPlay) {
    // Paused while the latch was holding: load this chunk and HOLD it. Playing here would undo a pause
    // the element itself never saw (it had already ended when the tap landed).
    set({ current: at, status: "paused" });
    return;
  }
  set({ current: at }); // publish the seam immediately — `timeupdate` only arrives ~4×/sec
  const op = ++playOp;
  void a.play().catch(() => {
    if (s.seq === reqSeq && op === playOp) set({ status: "paused" });
  });
}

/** Convert a pending seek's within-chunk FRACTION into `currentTime` the moment the element reports the
 *  chunk's real length, then republish the refined position. One-shot and self-removing, and inert if
 *  the queue moved on while the metadata loaded (the duration probe's discipline). Unreadable metadata
 *  is not worth recovering from: the chunk simply plays from its start.
 *  The generation/index guards can't see a NEWER seek into the SAME chunk (same playIdx, same message
 *  — the confirm round's catch): any later navigation must cancel the armed payout via `s.metaSeek`,
 *  or the stale fraction would snap playback back over the user's newer drag. */
function applySeekOnMetadata(s: Session, i: number, a: HTMLAudioElement, frac: number): void {
  s.metaSeek?.(); // supersede: at most one armed payout per session
  const apply = (): void => {
    a.removeEventListener("loadedmetadata", apply);
    if (s.metaSeek) s.metaSeek = null;
    if (s.seq !== reqSeq || session !== s || s.playIdx !== i) return;
    const d = a.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    // The end-guard keeps a fraction of ~1 off the very end, where `currentTime` would fire `ended`
    // immediately and cascade into the end-of-queue rewind instead of playing the tail the user asked for.
    a.currentTime = Math.min(frac * d, Math.max(0, d - 0.05));
    set({ current: (s.tl.spans[i]?.start ?? 0) + a.currentTime });
  };
  s.metaSeek = () => {
    a.removeEventListener("loadedmetadata", apply);
    s.metaSeek = null;
  };
  a.addEventListener("loadedmetadata", apply);
}

/** End of the queue: rewind to the first playable chunk so a re-tap replays the message from the top
 *  (the pre-D63 `ended` contract — "reset to start, ready to replay" — one message wide). */
function finish(s: Session, a: HTMLAudioElement): void {
  const first = s.states.indexOf("ok");
  if (first < 0) {
    // EVERY chunk failed (reaching here at all means nothing playable is left). Drop the QUEUE, not just
    // the player: a retained all-failed session would make the next tap replay it — finishing instantly,
    // never re-requesting — long after the TTS server came back. The one error toast already went out.
    reset(); // bumps the generation + aborts any straggler synth while `session` is still this one
    revokeSession(s);
    if (session === s) session = null;
    return;
  }
  s.playIdx = first;
  s.waiting = false;
  s.seek = null;
  s.metaSeek?.(); // the rewind is a navigation too — a stale payout must not snap it forward
  a.src = s.urls[first]!;
  a.currentTime = 0;
  // `first` is 0 for any message that played through, so this normally IS the top of the bar. After a
  // forward seek left unsynthesized holes behind the playhead it can be mid-message (accepted residual,
  // D63 amendment §8): the playhead reports where the rewind actually landed rather than lying about 0.
  set({ current: s.tl.spans[first]?.start ?? 0, status: "paused" });
}

// ── the public surface ───────────────────────────────────────────────────────────────────────────

/** The one play/pause action, behind both the per-bubble button and the docked player. Under chunking
 *  it also carries the queue's play INTENT: at a chunk seam the element is already ended/paused while
 *  the status deliberately still reads "playing" (the latch), so `a.pause()` alone is a no-op there and
 *  the late chunk would play right over the user's tap. The intent flag is what `playNext` obeys. */
function transport(): void {
  const a = ensureEl();
  const s = liveSession();
  if (pb.status === "playing") {
    if (s) s.wantPlay = false;
    a.pause();
    if (pb.status === "playing") set({ status: "paused" }); // latched: no `pause` event will do it
    return;
  }
  if (pb.status !== "paused") return; // loading → ignore taps until it resolves
  if (s) s.wantPlay = true;
  if (s?.waiting) {
    set({ status: "playing" }); // nothing loaded to resume — the chunk in flight starts on arrival
    return;
  }
  void a.play();
}

/**
 * Per-bubble button + auto-TTS entry point. Tapping a message's speaker:
 *   - if it's the active message → pause/resume in place,
 *   - otherwise → load it (synth-on-first-play, cached after), stopping any other, and play.
 */
export async function toggle(id: string, markdown: string): Promise<void> {
  const a = ensureEl();
  if (pb.id === id) {
    transport(); // pause/resume in place (a re-tap while loading is ignored)
    return;
  }
  a.pause(); // stop whatever's playing now so it doesn't keep going during the new clip's synth
  const seq = ++reqSeq;
  set({ id, status: "loading", current: 0, duration: 0, estimated: false, chunks: null });
  // Single-message retention (D63): a different message starting is what reaps the previous queue.
  if (session && session.id !== id) {
    session.abort.abort();
    revokeSession(session);
    session = null;
  }
  if (policy.mode === "off") {
    await playWhole(id, markdown, seq, a);
    return;
  }
  startChunked(id, markdown, seq);
}

/** The docked player's play/pause (acts on whatever's active). */
export function togglePlay(): void {
  transport();
}

/** Seek to a 0..1 fraction (the scrubber's drag/click, and the ±5% keyboard steps for free). Under
 *  `off` the fraction is of the one clip and the element owns the answer, as it always did. Under
 *  chunking it is of the WHOLE MESSAGE (D63 amendment) — see `seekChunked`. */
export function seekFraction(f: number): void {
  const s = liveSession();
  if (s) {
    seekChunked(s, f);
    return;
  }
  if (!el || pb.duration <= 0) return;
  const t = Math.max(0, Math.min(1, f)) * pb.duration;
  el.currentTime = t;
  set({ current: t });
}

/** Whole-message seek: a global fraction → (chunk, offset), then one of three landings.
 *   · synthesized → load that chunk at the offset (or just move `currentTime`, if it is already the one
 *     on the element — re-assigning the same `src` would restart the decode for nothing).
 *   · not yet synthesized → arrange for the queue to land THERE: park the cursor one before it, hold the
 *     latch, and bank the within-chunk FRACTION for `playNext` to apply once the chunk's real length is
 *     known. `pump` is playIdx-windowed, so moving the cursor is also what puts the target on the wire.
 *   · failed → hand off forward to the next playable chunk, the same skip rule `playNext` uses.
 *  Play/pause INTENT is preserved: whatever the transport reads right now is what the landing does.
 *  Backward seeks hit retained blobs and are instant. Seeks before the first audio never get here — the
 *  scrubber is inert while `status === "loading"` (`seekDisabled`), exactly as before. */
function seekChunked(s: Session, f: number): void {
  const { spans, total } = s.tl;
  if (total <= 0) return;
  const t = Math.max(0, Math.min(1, f)) * total;
  let i = spans.length - 1;
  while (i > 0 && spans[i].start > t) i--;
  const target = i;
  while (i < spans.length && s.states[i] === "failed") i++;
  if (i >= spans.length) return; // nothing playable from here to the end — leave the playhead alone
  const offset = i === target ? Math.max(0, Math.min(t - spans[i].start, spans[i].dur)) : 0;

  const a = ensureEl();
  // This seek IS the newest intent: disarm any metadata payout a prior pending seek left waiting — the
  // same-chunk fast path below would otherwise let the stale fraction snap back over it (confirm-round
  // catch). Only past the early returns: a no-op seek must not cancel anything.
  s.metaSeek?.();
  const play = pb.status === "playing"; // the latch already encodes intent in the published status
  s.wantPlay = play;

  if (s.states[i] === "ok") {
    s.seek = null;
    if (s.playIdx === i && !s.waiting && a.src === s.urls[i]) {
      a.currentTime = offset;
      set({ current: spans[i].start + offset });
      return;
    }
    s.waiting = false;
    s.playIdx = i;
    a.src = s.urls[i]!;
    a.currentTime = offset;
    pump(s); // the window moved with the cursor
    const at = spans[i].start + offset;
    if (!play) {
      set({ current: at, status: "paused" });
      return;
    }
    set({ current: at });
    const op = ++playOp;
    void a.play().catch(() => {
      if (s.seq === reqSeq && op === playOp) set({ status: "paused" });
    });
    return;
  }

  s.waiting = true; // set BEFORE the pause, so the pause event reads as the latch and not as a user tap
  // Banked as a FRACTION of the (estimated) span — `offset` is already clamped into it, so a target that
  // was handed off from a failed chunk banks 0, and a degenerate span can't divide by zero.
  s.seek = { idx: i, frac: spans[i].dur > 0 ? offset / spans[i].dur : 0 };
  s.playIdx = i - 1;
  a.pause();
  pump(s);
  set({ current: globalCurrent(s), status: play ? "playing" : "paused" });
}

/** Dismiss the player (the ✕): stop + unload, but keep the blob cache so a replay is instant. */
export function dismiss(): void {
  reset();
}

/** Revoke cached object URLs (e.g. on `/clear`). Cheap; keeps a long session from leaking blobs. */
export function clearAudioCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
  if (session) {
    session.abort.abort();
    revokeSession(session);
    session = null;
  }
  if (pb.id) reset();
}

/**
 * Selector subscription (mirrors store/ui.ts `useUISlice`): a component re-renders only when its
 * selected slice changes. Per-bubble buttons select just their own status, so they don't re-render on
 * the MiniPlayer's ~4×/sec `timeupdate`; the MiniPlayer selects time/duration and does.
 * Contract: return a primitive or stable reference (a fresh object each call loops forever).
 */
export function usePlayback<T>(selector: (p: Playback) => T): T {
  return useStore(() => selector(pb));
}
