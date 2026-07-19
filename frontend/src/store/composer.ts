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
// Dependency-free external store on the shared `createStore` binding + `persist` helpers (D23),
// same shape as store/ui.ts. Adding another field later (e.g. cursor position) is a one-line widen
// of `ComposerState`.

import { createStore } from "./createStore";
import { loadPersisted, savePersisted } from "./persist";

interface ComposerState {
  draft: string;
}

const DEFAULTS: ComposerState = { draft: "" };
const KEY = "ctrlb.composer";

const { emit, useStore } = createStore();
let state: ComposerState = loadPersisted(KEY, DEFAULTS);

export function setDraft(draft: string): void {
  // No-op guard: skip the localStorage round-trip + emit when nothing changed.
  // Belt-and-braces — onChange normally only fires on real change anyway.
  if (state.draft === draft) return;
  state = { draft };
  savePersisted(KEY, state);
  emit();
}

export function clearDraft(): void {
  setDraft("");
}

/** Append text to the current draft, separated from existing content by `separator` (Phase 6b dictation
 *  hand-off; the D41 Stop-harvest passes `"\n"` to newline-join restored steer lines). Defaults to a
 *  space so a dictated transcript lands after whatever the user already typed rather than clobbering it.
 *  Reads state imperatively (no stale closure), then routes through `setDraft`. Empty input → no-op. */
export function appendDraft(text: string, separator = " "): void {
  const add = text.trim();
  if (!add) return;
  const cur = state.draft.trimEnd();
  setDraft(cur ? `${cur}${separator}${add}` : add);
}

/** Read the current draft imperatively (non-reactive) — for callers outside render that need the live
 *  value without a stale closure (e.g. the mic auto-send path reading what it just appended). */
export function getDraft(): string {
  return state.draft;
}

/** Read the current composer draft. Survives tab-switch unmount + full page reload. */
export function useDraft(): string {
  return useStore(() => state.draft);
}
