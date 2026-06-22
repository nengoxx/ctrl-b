// Persistent draft for the shared composer textarea. Solves two problems at once:
//   1. The composer is conditionally rendered (`{showComposer && <Composer />}` in App.tsx) —
//      switching to Conf/Utils unmounts it, which discards whatever was in the textarea if
//      the value lived in component-local state or the DOM ref. Hoisting the draft into a
//      store keeps it alive across that unmount.
//   2. Refreshing the page (or closing/reopening the PWA) used to clear the draft too. By
//      persisting to localStorage we survive a full reload as well.
//
// Single global slot (no per-thread or per-mode split) — matches the user's mental model of
// "what's in the textarea right now." If per-thread drafts ever become a real need, add a
// `Record<threadId, string>` alongside `draft` and a thread-aware selector; the seam is the
// store shape, not the consuming component.
//
// Dependency-free external store via useSyncExternalStore. Shape mirrors store/ui.ts —
// same load/persist/emit pattern, same swallowed quota error for private-mode browsers,
// same useSyncExternalStore subscription. Adding another field later (e.g. cursor position)
// is a one-line widen of `ComposerState`.

import { useSyncExternalStore } from "react";

interface ComposerState {
  draft: string;
}

const DEFAULTS: ComposerState = { draft: "" };
const KEY = "ctrlb.composer";

function load(): ComposerState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let state: ComposerState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — non-fatal, state still lives in memory */
  }
}

export function setDraft(draft: string): void {
  // No-op guard: skip the localStorage round-trip + emit when nothing changed.
  // Belt-and-braces — onChange normally only fires on real change anyway.
  if (state.draft === draft) return;
  state = { draft };
  persist();
  emit();
}

export function clearDraft(): void {
  setDraft("");
}

/** Append text to the current draft (Phase 6b dictation hand-off) — separated by a space when the
 *  draft already has content, so a transcript lands after whatever the user already typed rather than
 *  clobbering it. Reads state imperatively (no stale closure), then routes through `setDraft`. */
export function appendDraft(text: string): void {
  const add = text.trim();
  if (!add) return;
  const cur = state.draft.trimEnd();
  setDraft(cur ? `${cur} ${add}` : add);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): string {
  return state.draft;
}

/** Read the current composer draft. Survives tab-switch unmount + full page reload. */
export function useDraft(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
