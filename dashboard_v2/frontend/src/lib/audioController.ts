// Phase 6b-2 — shared TTS playback controller (singleton). Exactly one <audio> element and one
// active message at a time: this is the genuinely-shared piece of voice (per-bubble play buttons, the
// chat reducer's auto-TTS, and the docked MiniPlayer all coordinate one player), so unlike recording
// (a local hook) it lives as a module singleton subscribed via useSyncExternalStore.
//
// The <audio> element is the source of truth for time/duration/paused — we mirror its native events
// into a small reactive snapshot rather than tracking playback by hand. A per-message blob cache means
// each reply is synthesized at most once (replays are instant + seekable from the cached clip).
//
// NOTE: the listeners-Set/emit plumbing below is the same shape ui.ts/chat.ts/composer.ts hand-roll —
// the known backlog dedup is a shared `createStore<T>()` factory (see HANDOFF 2026-06-22). Kept inline
// here so this feature slice doesn't smuggle in that refactor; it'll migrate with the others.

import { useSyncExternalStore } from "react";

import { pushToast } from "../store/toast";
import { toSpeech } from "./toSpeech";

export type PlayStatus = "idle" | "loading" | "playing" | "paused";

export interface Playback {
  id: string | null; // message id currently loaded (null = nothing docked)
  status: PlayStatus;
  current: number; // seconds elapsed
  duration: number; // seconds total (0 until known)
}

let pb: Playback = { id: null, status: "idle", current: 0, duration: 0 };
const listeners = new Set<() => void>();
const cache = new Map<string, string>(); // messageId → object URL (synth once per message)
let el: HTMLAudioElement | null = null;
let reqSeq = 0; // guards against an out-of-order synth resolving after a newer toggle

function emit(): void {
  for (const l of listeners) l();
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
    // Only a real playing→paused transition. Guard against the async pause event landing after we've
    // already moved to "loading" (switching messages) or "idle" (dismiss) and clobbering it.
    if (pb.status === "playing") set({ status: "paused" });
  });
  a.addEventListener("ended", () => {
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

function reset(): void {
  reqSeq++; // invalidate any in-flight synth so a dismissed clip never starts playing
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  pb = { id: null, status: "idle", current: 0, duration: 0 };
  emit();
}

/** Synthesize (or reuse the cached clip for) a message. Returns the object URL, or null on failure
 *  (a toast is shown). 502 = the whole TTS failover chain is unreachable. */
async function synth(id: string, markdown: string): Promise<string | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  const text = toSpeech(markdown);
  if (!text) return null;
  let res: Response;
  try {
    res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    pushToast("Voice servers unreachable", "err");
    return null;
  }
  if (!res.ok) {
    pushToast(res.status === 502 ? "Voice servers unreachable" : `Read-aloud failed (${res.status})`, "err");
    return null;
  }
  const url = URL.createObjectURL(await res.blob());
  cache.set(id, url);
  return url;
}

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
  const url = await synth(id, markdown);
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
    set({ status: "paused" }); // autoplay/interaction guard — leave it docked + tappable
  }
}

/** The docked player's play/pause (acts on whatever's active). */
export function togglePlay(): void {
  const a = ensureEl();
  if (pb.status === "playing") a.pause();
  else if (pb.status === "paused") void a.play();
}

/** Seek to a 0..1 fraction of the clip (the scrubber's drag/click). */
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
  if (pb.id) reset();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Selector subscription (mirrors store/ui.ts `useUISlice`): a component re-renders only when its
 * selected slice changes. Per-bubble buttons select just their own status, so they don't re-render on
 * the MiniPlayer's ~4×/sec `timeupdate`; the MiniPlayer selects time/duration and does.
 * Contract: return a primitive or stable reference (a fresh object each call loops forever).
 */
export function usePlayback<T>(selector: (p: Playback) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(pb),
    () => selector(pb),
  );
}
