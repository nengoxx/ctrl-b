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
//
// Phase 18 / D56 adds a SECOND entry point on the same one-at-a-time store: `requestPromptPair`
// resolves an `{override, append}` PAIR for the prompt-registry editor (§6 C-18 — the two fields are
// one prompt and must be edited, cancelled and staged together). `Active` is the discriminated union
// of the two request kinds; the text-mode API above is unchanged for every existing caller.

import { createStore } from "./createStore";
import type { PromptPair } from "../types";

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

/** A registry prompt opened as ONE editor over both its fields (Phase 18). `defaultText` is shown
 *  read-only beside the editor and is what [Load default] copies into the override (§6 C-18);
 *  `placeholders` and `description` are display-only context the row already has. */
export interface PromptPairRequest {
  title: string;
  override: string;
  append: string;
  defaultText: string;
  description?: string | null;
  placeholders?: string[];
  saveLabel?: string;
}

type Active =
  | ({ kind: "text"; resolve: (next: string | null) => void } & PromptRequest)
  | ({ kind: "pair"; resolve: (next: PromptPair | null) => void } & PromptPairRequest);

const { emit, useStore } = createStore();
let active: Active | null = null;

export function requestPrompt(req: PromptRequest): Promise<string | null> {
  // If one is already open, cancel it before replacing (shouldn't happen in single-user flow).
  active?.resolve(null);
  return new Promise<string | null>((resolve) => {
    active = { ...req, kind: "text", resolve };
    emit();
  });
}

export function requestPromptPair(req: PromptPairRequest): Promise<PromptPair | null> {
  active?.resolve(null);
  return new Promise<PromptPair | null>((resolve) => {
    active = { ...req, kind: "pair", resolve };
    emit();
  });
}

/** Detach the active request — the ONE clear path both resolvers share, so neither can leave the
 *  store holding a settled request. */
function take(): Active | null {
  const a = active;
  active = null;
  emit();
  return a;
}

export function resolvePrompt(next: string | null): void {
  const a = take();
  // A pair request can only be CANCELLED through this door: it is the shared Escape/backdrop/✕ path
  // (and every test's `beforeEach` reset), so a stray string must never settle a pair as edited text.
  if (a?.kind === "pair") a.resolve(null);
  else a?.resolve(next);
}

export function resolvePromptPair(next: PromptPair | null): void {
  const a = take();
  if (a?.kind === "pair") a.resolve(next);
  else a?.resolve(null);
}

export function usePrompt(): Active | null {
  return useStore(() => active);
}
