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
// The reactive snapshot (`pb`) mirrors the <audio> element's native events; components subscribe via
// `usePlayback`. The listener/notify/React-binding plumbing is the shared `createStore` binding (D23) —
// this singleton is one of its ten consumers; only the snapshot + the DOM logic below are local to it.

import { pushToast } from "../store/toast";
import { createStore } from "../store/createStore";
import { toSpeech } from "./toSpeech";
import { chunkPlan, type ChunkCfg } from "./ttsChunks";

export type PlayStatus = "idle" | "loading" | "playing" | "paused";

export interface Playback {
  id: string | null; // message id currently loaded (null = nothing docked)
  status: PlayStatus;
  current: number; // seconds elapsed — of the CURRENT CHUNK under chunking (scrubber v1 is per-chunk)
  duration: number; // seconds total (0 until known)
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
let pb: Playback = { id: null, status: "idle", current: 0, duration: 0 };
const cache = new Map<string, string>(); // `off` path: messageId → object URL (synth once per message)
let el: HTMLAudioElement | null = null;
let reqSeq = 0; // guards against an out-of-order synth resolving after a newer toggle

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
  playIdx: number; // chunk currently loaded in the element (-1 = none yet)
  waiting: boolean; // playback caught up to synthesis and is holding for the next chunk
  pin: string | null; // `X-Voice-Target` of the serving endpoint, echoed as `prefer` on later chunks
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

function ensureEl(): HTMLAudioElement {
  if (el) return el;
  const a = new Audio();
  a.preload = "auto";
  const syncDuration = () => {
    if (Number.isFinite(a.duration)) set({ duration: a.duration });
  };
  a.addEventListener("timeupdate", () => set({ current: a.currentTime }));
  a.addEventListener("durationchange", syncDuration);
  a.addEventListener("loadedmetadata", syncDuration);
  a.addEventListener("play", () => set({ status: "playing" }));
  a.addEventListener("pause", () => {
    // A clip reaching its end fires `pause` BEFORE `ended` (HTML spec). Mid-queue that is not a user
    // pause, it's the seam — reporting "paused" there would flicker the transport on every chunk
    // boundary (the `if (el.ended) return` guard AnythingLLM's player needs for the same reason).
    if (a.ended && liveSession()) return;
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
  pb = { id: null, status: "idle", current: 0, duration: 0 };
  emit();
}

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────

type TtsOutcome =
  | { ok: true; blob: Blob; target: string }
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
    return { ok: true, blob: await res.blob(), target: res.headers.get("X-Voice-Target") ?? "" };
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
      playIdx: -1,
      waiting: false,
      pin: null,
      errored: false,
      abort: new AbortController(),
    };
    session = s;
  }
  playNext(s); // latches on chunk 0 and pumps the synth window
}

/** Keep `lookahead` chunks past the one playing in flight — no more (a cancel then wastes at most that
 *  many synths) and no fewer (the seam is only inaudible if the next chunk is already a blob). A FAILED
 *  chunk doesn't occupy a slot: it will be skipped at playback, so the window has to reach past it or a
 *  failure mid-queue starves the very chunk that replaces it. */
function pump(s: Session): void {
  if (s.seq !== reqSeq || session !== s) return;
  let budget = policy.lookahead;
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
  // MED-7 — re-check the generation AFTER the response exists and BEFORE anything is retained, so a
  // synth that lands in a cancelled/superseded queue revokes its URL on the spot rather than leaving a
  // second message's blobs resident.
  const stale = s.seq !== reqSeq || session !== s;

  if (!out.ok) {
    if (out.aborted) {
      s.requested[i] = false; // cancelled, not failed — a resume re-requests it
      pump(s);
      return;
    }
    if (stale) return;
    s.states[i] = "failed";
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
  if (out.target && out.target !== s.pin) {
    // Once per message, then only when the chain actually moved to a different endpoint mid-reply.
    s.pin = out.target;
    pushToast(`Read aloud by ${out.target}`, "info");
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
  a.src = s.urls[i]!;
  a.currentTime = 0;
  pump(s); // window moved: start the next synth WHILE this chunk plays
  void a.play().catch(() => {
    if (s.seq === reqSeq) set({ status: "paused" });
  });
}

/** End of the queue: rewind to the first playable chunk so a re-tap replays the message from the top
 *  (the pre-D63 `ended` contract — "reset to start, ready to replay" — one message wide). */
function finish(s: Session, a: HTMLAudioElement): void {
  const first = s.states.indexOf("ok");
  if (first < 0) {
    reset(); // every chunk failed; the one error toast already went out
    return;
  }
  s.playIdx = first;
  s.waiting = false;
  a.src = s.urls[first]!;
  a.currentTime = 0;
  set({ current: 0, status: "paused" });
}

// ── the public surface ───────────────────────────────────────────────────────────────────────────

/**
 * Per-bubble button + auto-TTS entry point. Tapping a message's speaker:
 *   - if it's the active message → pause/resume in place,
 *   - otherwise → load it (synth-on-first-play, cached after), stopping any other, and play.
 */
export async function toggle(id: string, markdown: string): Promise<void> {
  const a = ensureEl();
  if (pb.id === id) {
    if (pb.status === "playing") a.pause();
    else if (pb.status === "paused") void a.play();
    return; // loading → ignore re-taps until it resolves
  }
  a.pause(); // stop whatever's playing now so it doesn't keep going during the new clip's synth
  const seq = ++reqSeq;
  set({ id, status: "loading", current: 0, duration: 0 });
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
  const a = ensureEl();
  if (pb.status === "playing") a.pause();
  else if (pb.status === "paused") void a.play();
}

/** Seek to a 0..1 fraction of the clip (the scrubber's drag/click). Under chunking the clip is the
 *  CURRENT CHUNK — position and duration are the element's own facts either way (D63: scrubber v1 is
 *  per-chunk; whole-message seeking would mean rebuilding one blob and is a recorded non-build). */
export function seekFraction(f: number): void {
  if (!el || pb.duration <= 0) return;
  const t = Math.max(0, Math.min(1, f)) * pb.duration;
  el.currentTime = t;
  set({ current: t });
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
