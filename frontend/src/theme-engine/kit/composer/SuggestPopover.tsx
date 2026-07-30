import { useEffect, useRef, useState } from "react";

import type { ComposerSuggest } from "../../../hooks/useComposerSuggest";
import type { Completion, CompletionKind } from "../../../lib/composer";
import { useUISlice } from "../../../store/ui";

// The composer autocomplete popover (A2) — the PRESENTATION half; state/keys live in the headless
// `useComposerSuggest`. Mounted by all three Kit layouts (stacked/sheet/line) as a positioned SIBLING of
// `.kit-composer`, exactly like the plan sheet's `overlay` — kit.css anchors it above the composer's top
// edge off `--composer-h` and stacks it over the plan sheet's peek. (vapor keeps its frozen composer, D7 —
// verb-only, no popover.)
//
// a11y: the listbox never takes DOM focus — the textarea stays focused and points at the active row via
// `aria-activedescendant` (APG editable-combobox-with-list). Touch-first: rows accept on POINTERDOWN with
// `preventDefault`, so a tap lands before the textarea can blur the popover away.
//
// MOUNTING: it stays MOUNTED and toggles `.open` (kit.css) — a popover that unmounts on close can only ever
// animate its ENTER, and the owner wants the plan sheet's full open/close slide here. The closed shell is
// `inert`, NOT `aria-hidden`: inert takes it out of tab order AND the a11y tree, where `aria-hidden` over
// focusable rows is precisely the `aria-hidden-focus` violation. (React 19 exposes `inert` as a real boolean
// prop; BottomSheet sets the same thing imperatively on its below-the-fold content.)

/** Row-set equality by VALUE — `getCompletions` builds a fresh array per call, so a reference check would
 *  re-set state on every keystroke. Tiny lists (a handful of rows); cheaper than reconciling the DOM. */
function sameRows(a: Completion[], b: Completion[]): boolean {
  return a.length === b.length && a.every((x, i) => x.kind === b[i].kind && x.value === b[i].value);
}

/** Short badge per completion kind — the row says WHAT it is without a description column (v1). */
const KIND_BADGE: Record<CompletionKind, string> = {
  builtin: "cmd",
  skill: "skill",
  provider: "provider",
  agent: "agent",
  privilege: "level",
};

export function SuggestPopover({ suggest }: { suggest: ComposerSuggest }) {
  const listRef = useRef<HTMLUListElement>(null);
  const { open, items, activeIndex, displaced } = suggest;
  // The app's OWN motion lever (never `matchMedia`/`prefers-reduced-motion` — §14.11: the switch may turn
  // motion back ON for a user whose OS asks for less). Under `reduced` kit.css sets `transition: none`.
  const reducedMotion = useUISlice((s) => s.motion === "reduced");

  // WHAT THE SHELL RENDERS — its own state, not `items` directly, because the shell OUTLIVES the list.
  // While open it mirrors the live completions; when it closes it KEEPS them for the .2s exit slide (the
  // list usually empties in the same frame — the token was accepted, `/clear ` completing nothing — so
  // rendering `items` would play the slide on a bare shell). Both edges are React's documented "adjust
  // state while rendering" pattern: the re-render happens before paint, so neither shows a stale or empty
  // frame, and no effect/ref is read during render.
  const [rows, setRows] = useState<Completion[]>([]);
  if (open && !sameRows(rows, items)) setRows(items);
  // The retained rows are RELEASED once the exit is over (Codex, LOW) — the composer re-renders on every
  // keystroke, so rows kept forever after a dismissal are a permanent per-keystroke reconcile cost, real on
  // Fennec with a large discovered skill/agent registry. Normally `transitionend` (below) releases them.
  // But when there is no slide to wait for — reduced motion, or another overlay displaced us and kit.css
  // snapped us out so we can't ghost over it — the transition is `none` and `transitionend` NEVER fires, so
  // those two paths release synchronously at the close edge instead of leaning on a timer.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open && (reducedMotion || displaced)) setRows([]);
  }

  // Keep the keyboard-active row visible in the scrolling list (jsdom has no scrollIntoView — guarded).
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[activeIndex];
    if (row instanceof HTMLElement && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  return (
    <ul
      ref={listRef}
      className={"kit-suggest" + (open ? " open" : "")}
      id={suggest.listboxId}
      role="listbox"
      aria-label="command suggestions"
      inert={!open}
      onTransitionEnd={(e) => {
        // the SHELL's own opacity leg only: a bubbled row transition — or the transform leg, which can
        // settle first — would drop the retained rows mid-slide.
        if (e.propertyName === "opacity" && e.target === e.currentTarget && !open) setRows([]);
      }}
    >
      {rows.map((item, i) => (
        <li
          key={`${item.kind}:${item.value}`}
          id={suggest.optionId(i)}
          role="option"
          aria-selected={i === activeIndex}
          className={i === activeIndex ? "active" : ""}
          onPointerDown={(e) => {
            e.preventDefault(); // keep focus (and the caret) in the textarea — a blur would close us first
            suggest.accept(item);
          }}
        >
          <span className="sg-val">{item.value}</span>
          <span className="sg-kind">{KIND_BADGE[item.kind]}</span>
        </li>
      ))}
    </ul>
  );
}
