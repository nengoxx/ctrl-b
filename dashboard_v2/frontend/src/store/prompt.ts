// Imperative full-page prompt editor (Phase 7e-b). A caller does
// `const next = await requestPrompt({ title, value }); if (next != null) setDraft(next)`;
// the <PromptModal/> host renders the active request and resolves the promise with the edited
// text on Save (or `null` on Cancel/Escape). Dependency-free external store, mirrors
// store/confirm.ts exactly — same one-at-a-time, single-user assumption.
//
// Save semantics are the *caller's* (D14 / 7e-b decisions): settings-backed fields take the
// resolved string into their group draft and persist on the group Save; file-backed editors
// (SOUL.md/MEMORY.md, 7e-c+) will resolve straight into their file-API mutation. The modal itself
// only edits text and hands it back — it never touches the backend.

import { useSyncExternalStore } from "react";

export interface PromptRequest {
  title: string;
  value: string;
  /** Monospace textarea (prompts/markdown) vs. the base font. Defaults to true. */
  mono?: boolean;
  /** When set, the footer shows [Load default] (fills the textarea with this) + [Restore default]
   *  (clears to ""). Only the *replace* fields pass it — append fields default to "" (7e-b Q3). */
  defaultText?: string;
  /** Optional character cap → the counter renders `NN% — used/cap` (Hermes-style). 7e-d memory
   *  panel reuses this against the configurable caps; 7e-b prompt fields pass nothing (count only). */
  cap?: number;
  placeholder?: string;
  saveLabel?: string;
}

interface Active extends PromptRequest {
  resolve: (next: string | null) => void;
}

let active: Active | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function requestPrompt(req: PromptRequest): Promise<string | null> {
  // If one is already open, cancel it before replacing (shouldn't happen in single-user flow).
  active?.resolve(null);
  return new Promise<string | null>((resolve) => {
    active = { ...req, resolve };
    emit();
  });
}

export function resolvePrompt(next: string | null): void {
  const a = active;
  active = null;
  emit();
  a?.resolve(next);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePrompt(): Active | null {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => active,
  );
}
