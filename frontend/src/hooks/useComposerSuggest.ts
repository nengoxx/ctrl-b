import { useEffect, useState, type KeyboardEvent } from "react";

import { getCompletions, useVerbsVersion, type Completion } from "../lib/composer";
import {
  releaseComposerOverlay,
  setComposerOverlay,
  useComposerOverlayOpen,
} from "../store/composerOverlay";

// Composer autocomplete (A2) — the BEHAVIOUR half, headless like `useComposer`: open/close policy, the
// keyboard grammar, and accepting a suggestion. The GRAMMAR is `lib/composer.getCompletions` (one source,
// shared with `routeSlash`); the markup is `kit/composer/SuggestPopover`. Every Kit composer variant wires
// the same object, so the three layouts can't drift.
//
// Two rules worth stating because they're invisible in the code:
//   • NEVER opens on mount — a `/…` draft restored from localStorage (store/composer persists it) must not
//     pop a menu over a page the user just reloaded. It arms on the first focus/keystroke instead.
//   • The popover intercepts Enter BEFORE the send handler, so it must fall through cleanly: closed → send,
//     IME-composing → neither (the keystroke belongs to the input method).

/** The listbox element id — one composer is mounted at a time, like `#cmd-input`/`#composer`. */
const LISTBOX_ID = "composer-suggest";

export interface ComposerSuggest {
  open: boolean;
  items: Completion[];
  activeIndex: number;
  listboxId: string;
  /** Stable per-row option id for `aria-activedescendant`. */
  optionId: (i: number) => string;
  /** APG editable-combobox-with-list wiring — spread onto the textarea. DOM focus never leaves the field;
   *  the active option is announced through `aria-activedescendant`. */
  aria: {
    role: "combobox";
    "aria-autocomplete": "list";
    "aria-expanded": boolean;
    "aria-controls": string | undefined;
    "aria-activedescendant": string | undefined;
  };
  /** Composed keydown: the popover's keys first, everything else to the variant's send handler. */
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Draft writes go through here so typing arms (and un-dismisses) the popover. */
  onDraftChange: (v: string) => void;
  onFocus: () => void;
  /** Leaving the field disarms it — a row TAP can't blur us away (it accepts on pointerdown, prevented). */
  onBlur: () => void;
  accept: (item: Completion) => void;
  setActiveIndex: (i: number) => void;
}

export interface ComposerSuggestInput {
  draft: string;
  setDraft: (v: string) => void;
  /** The variant's existing textarea keydown (Enter-to-send, from `useComposerChrome`). */
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Replace the token under the caret — the trailing run of non-space text, empty right after a space —
 *  and leave a trailing space so the next token (an agent name, a level, the message) starts clean. */
function replaceToken(draft: string, insert: string): string {
  return draft.replace(/\S*$/, "") + insert + " ";
}

export function useComposerSuggest({
  draft,
  setDraft,
  onKeyDown: baseKeyDown,
}: ComposerSuggestInput): ComposerSuggest {
  const [armed, setArmed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // Subscribe to the verb sets so a loader installing a fresh one re-renders us; the store publishes a
  // VERSION rather than the sets because `getCompletions` builds a new array per call and a `getSnapshot`
  // returning a fresh array loops forever (createStore's snapshot contract). Derived per render — the list
  // is tiny and the composer already re-renders on every keystroke.
  useVerbsVersion();
  const items = getCompletions(draft);

  // Overlay coexistence (A6): the popover, the plan sheet and the tools menu all hover over the composer's
  // top edge, so exactly one may be open — `store/composerOverlay` holds that single owner slot. The
  // popover's own policy decides when it WANTS to be open; the slot decides whether it gets to be. Claiming
  // on the want-transition (not on every render) is what lets a menu/plan tap displace it: the popover stays
  // down until the next keystroke re-arms it, instead of fighting back on the very next render.
  const wantOpen = armed && !dismissed && items.length > 0;
  const hasSlot = useComposerOverlayOpen("suggest");
  const open = wantOpen && hasSlot;
  const active = items.length ? Math.min(activeIndex, items.length - 1) : 0;

  useEffect(() => {
    if (wantOpen) setComposerOverlay("suggest");
    else releaseComposerOverlay("suggest");
  }, [wantOpen]);

  function accept(item: Completion): void {
    setDraft(replaceToken(draft, item.insert));
    setActiveIndex(0);
    setDismissed(false);
    setArmed(true);
  }

  function onDraftChange(v: string): void {
    setDraft(v);
    setActiveIndex(0);
    setDismissed(false);
    setArmed(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    // IME: Enter while composing COMMITS the candidate — it must neither accept a suggestion nor send the
    // message. Fall through to the browser, not to `baseKeyDown`. (229 is the pre-`isComposing` fallback.)
    if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) return;
    if (open) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((active + 1) % items.length);
          return;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((active - 1 + items.length) % items.length);
          return;
        case "Escape":
          // `preventDefault` is the cooperative-dismiss contract (BottomSheet's document listener skips an
          // already-defaultPrevented Escape); `stopPropagation` keeps ancestor handlers out of it too.
          e.preventDefault();
          e.stopPropagation();
          setDismissed(true);
          return;
        case "Enter":
        case "Tab":
          if (e.shiftKey) break; // Shift+Enter = newline · Shift+Tab = move focus out
          e.preventDefault();
          accept(items[active]);
          return;
      }
    }
    baseKeyDown(e);
  }

  return {
    open,
    items,
    activeIndex: active,
    listboxId: LISTBOX_ID,
    optionId: (i) => `${LISTBOX_ID}-opt-${i}`,
    aria: {
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": open,
      "aria-controls": open ? LISTBOX_ID : undefined,
      "aria-activedescendant": open ? `${LISTBOX_ID}-opt-${active}` : undefined,
    },
    onKeyDown,
    onDraftChange,
    onFocus: () => setArmed(true),
    onBlur: () => setArmed(false),
    accept,
    setActiveIndex,
  };
}
