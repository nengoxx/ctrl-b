import { useEffect, useRef } from "react";

import type { ComposerSuggest } from "../../../hooks/useComposerSuggest";
import type { Completion, CompletionKind } from "../../../lib/composer";

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
  const { open, items, activeIndex } = suggest;

  // CONTENT RETENTION for the exit slide. Closing usually empties `items` in the SAME frame — the token was
  // accepted (`/clear ` completes nothing) or dismissed — so the .2s close would play on a bare shell. Keep
  // the last rendered non-empty row set and show it while closing. A plain ref written AFTER commit: it
  // feeds the NEXT render only, so there's no render-phase side effect (and no store/state for a purely
  // presentational carry-over). The retained rows are inert + pointer-events:none — nothing can act on them.
  const lastItems = useRef<Completion[]>([]);
  useEffect(() => {
    if (open && items.length) lastItems.current = items;
  });
  const rows = open ? items : lastItems.current;

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
