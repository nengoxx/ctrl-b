import { useEffect, useRef } from "react";

import type { ComposerSuggest } from "../../../hooks/useComposerSuggest";
import type { CompletionKind } from "../../../lib/composer";

// The composer autocomplete popover (A2) — the PRESENTATION half; state/keys live in the headless
// `useComposerSuggest`. Mounted by all three Kit layouts (stacked/sheet/line) as a positioned SIBLING of
// `.kit-composer`, exactly like the plan sheet's `overlay` — kit.css anchors it above the composer's top
// edge off `--composer-h` and stacks it over the plan sheet's peek. (vapor keeps its frozen composer, D7 —
// verb-only, no popover.)
//
// a11y: the listbox never takes DOM focus — the textarea stays focused and points at the active row via
// `aria-activedescendant` (APG editable-combobox-with-list). Touch-first: rows accept on POINTERDOWN with
// `preventDefault`, so a tap lands before the textarea can blur the popover away.

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

  // Keep the keyboard-active row visible in the scrolling list (jsdom has no scrollIntoView — guarded).
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[activeIndex];
    if (row instanceof HTMLElement && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  if (!open) return null;
  return (
    <ul
      ref={listRef}
      className="kit-suggest"
      id={suggest.listboxId}
      role="listbox"
      aria-label="command suggestions"
    >
      {items.map((item, i) => (
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
