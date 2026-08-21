import { useEffect, useRef, useState, type TransitionEvent } from "react";

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

/** The empty row set as ONE stable reference — returning it from the release updater lets React bail out
 *  of a re-render when there is nothing left to release (see `releaseRows`). */
const NO_ROWS: Completion[] = [];

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
  // motion back ON for a user whose OS asks for less). Under `reduced` the kit collapses the motion band to
  // 1ms (kit/axes.css) — the exit is imperceptible but its transition events still fire (see below).
  const reducedMotion = useUISlice((s) => s.motion === "reduced");

  // WHAT THE SHELL RENDERS — its own state, not `items` directly, because the shell OUTLIVES the list.
  // While open it mirrors the live completions; when it closes it KEEPS them for the .2s exit slide (the
  // list usually empties in the same frame — the token was accepted, `/clear ` completing nothing — so
  // rendering `items` would play the slide on a bare shell). Both edges are React's documented "adjust
  // state while rendering" pattern: the re-render happens before paint, so neither shows a stale or empty
  // frame, and no effect/ref is read during render.
  const [rows, setRows] = useState<Completion[]>(NO_ROWS);
  if (open && !sameRows(rows, items)) setRows(items);
  // The retained rows are RELEASED once the exit is over (Codex, LOW) — the composer re-renders on every
  // keystroke, so rows kept forever after a dismissal are a permanent per-keystroke reconcile cost, real on
  // Fennec with a large discovered skill/agent registry. Normally the shell's own transition event releases
  // them (`releaseRows` below); these two paths release synchronously at the close edge instead of leaning
  // on a timer. `displaced` is LOAD-BEARING: another overlay took the slot, kit.css's handoff snap set
  // `transition: none` so we can't ghost over it, and no transition event will ever fire. `reducedMotion` is
  // belt-and-braces since ISS-10 ① — the reduced collapse is 1ms rather than `none` precisely so the event
  // still fires (R52 §8.3) — kept because it releases on the close edge itself, and a double release is free
  // (the functional update returns the SAME `NO_ROWS` reference, which React bails out of).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open && (reducedMotion || displaced)) setRows(NO_ROWS);
  }
  // The exit is over → drop the rows. Wired to BOTH `transitionend` and `transitioncancel`: a LATE
  // displacement (another overlay opens INSIDE the 200ms exit) flips this shell to `transition: none` via
  // the kit.css handoff snap, which CANCELS the running fade — `end` never fires, and the close-edge
  // release above was already spent on a close that legitimately had a slide (Codex verify round, LOW).
  // `transitioncancel` is the platform's signal for exactly that, dispatched by both engines we ship on
  // (Blink + Gecko); flipping the motion switch mid-exit is the same kill and rides the same event.
  // Identical guards on both: this shell's OWN opacity leg — a bubbled row transition, or the transform
  // leg (which settles/cancels in the same batch), must not drop the rows mid-slide — and only while
  // closed. Idempotent by construction: the functional update returns the SAME `NO_ROWS` reference when
  // there is nothing to release, so a stray second event is a no-op React bails out of.
  //
  // `propertyName` comes off the NATIVE event, not the synthetic one: React maps only `transitionend` to
  // `SyntheticTransitionEvent` (react-dom's SimpleEventPlugin switch — `transitioncancel`/`run`/`start`
  // fall through to the BASE synthetic event, which carries no `propertyName`), so filtering on
  // `e.propertyName` would make the cancel branch a permanent no-op. The DOM event itself carries it for
  // all four per spec, so one uniform read keeps the two branches' guards genuinely identical.
  const releaseRows = (e: TransitionEvent<HTMLUListElement>) => {
    if (e.nativeEvent.propertyName !== "opacity" || e.target !== e.currentTarget || open) return;
    setRows((prev) => (prev.length ? NO_ROWS : prev));
  };

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
      onTransitionEnd={releaseRows}
      onTransitionCancel={releaseRows}
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
