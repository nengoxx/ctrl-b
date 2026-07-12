import type { KeyboardEvent } from "react";

import { useSections } from "../hooks/useSections";
import type { TabId } from "../theme-engine/types";

// Bottom tab bar. The sliding neon indicator is pure CSS (.tabbar::before keyed off
// .tabbar[data-tab]); we just keep data-tab + .active in sync with the store.
//
// `onPrefetch` (Slice 6 / F6): an optional hook fired on pointer-enter / touch-start of each
// tab button. The shell uses it to warm a lazy-loaded tab's chunk before the actual click, so
// the navigation never shows a Suspense flash. Tabs without a lazy chunk simply ignore the call
// (the handler is a no-op for them). Generic by design — adding a new lazy tab is one line in
// the shell's `prefetch` map, no change to TabBar.
//
// F18 (UI_AUDIT.md §6c) — WAI-ARIA tabs pattern:
// - <nav> has role="tablist" + aria-label; each button has role="tab" + aria-selected +
//   aria-controls pointing at the matching tabpanel id (each top-level tab container
//   already carries `id="tab-{name}"`).
// - Roving tabindex: only the selected tab is in the natural tab order (tabIndex=0); the
//   others use -1. Tabbing into the bar lands on the active tab; Tab-out moves on.
// - Automatic activation on arrow keys (left/right wrap, Home/End jump to ends). WAI-ARIA
//   prefers automatic when panel content is instant — Fleet/Agent/Utils are always mounted
//   and Conf is prefetched on idle, so the switch is effectively free even from the keyboard.
// - Each button also has id="tabbtn-{name}" so the matching tabpanel can `aria-labelledby`
//   back to it; that's wired in the four tab containers + the ConfLoading/confErrorFallback
//   placeholders in App.tsx.

interface Props {
  onPrefetch?: (tab: TabId) => void;
}

export function TabBar({ onPrefetch }: Props) {
  // The ON-BAR sections + active section + navigation come from the headless controller (D29 §14.2 / D35);
  // `bar` is the layout-partitioned on-bar list (vapor is 4-tab by waiver, so it's render-identical to the
  // full list). The bottom-bar markup, the sliding indicator, and the WAI-ARIA tabs wiring stay vapor.
  const { bar: sections, active, navigate } = useSections();

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = sections.length;
    const i = sections.findIndex((t) => t.id === active);
    let target: TabId | null = null;
    if (e.key === "ArrowLeft") target = sections[(i - 1 + n) % n].id;
    else if (e.key === "ArrowRight") target = sections[(i + 1) % n].id;
    else if (e.key === "Home") target = sections[0].id;
    else if (e.key === "End") target = sections[n - 1].id;
    if (!target) return;
    e.preventDefault();
    navigate(target);
    // Move focus to the newly active tab so subsequent arrow keys continue the cycle.
    // Deferred a tick so React has re-rendered with the updated tabIndex values first.
    const targetId = `tabbtn-${target}`;
    queueMicrotask(() => document.getElementById(targetId)?.focus());
  };

  return (
    <nav className="tabbar" data-tab={active} role="tablist" aria-label="primary navigation">
      {sections.map((t) => {
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            id={`tabbtn-${t.id}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`tab-${t.id}`}
            tabIndex={selected ? 0 : -1}
            className={"tabbtn" + (selected ? " active" : "")}
            data-tab={t.id}
            onClick={() => navigate(t.id)}
            onKeyDown={onKeyDown}
            // Pointer-enter covers desktop hover; touch-start fires the moment a finger lands —
            // typically 80-200ms before the click. Both are safe to fire repeatedly (the lazy
            // importer's promise is cached at the ES-module level after the first call).
            onPointerEnter={onPrefetch ? () => onPrefetch(t.id) : undefined}
            onTouchStart={onPrefetch ? () => onPrefetch(t.id) : undefined}
          >
            <span className="glyph">{t.glyph}</span>
            <span className="lbl">{t.lbl}</span>
          </button>
        );
      })}
    </nav>
  );
}
