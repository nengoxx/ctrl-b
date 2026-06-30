import type { KeyboardEvent, ReactNode } from "react";

import { useSections } from "../../hooks/useSections";
import type { TabId } from "../types";

// Kit bottom nav (D29 §14.4) — token-driven, `.kit-*` classes. Same capability + WAI-ARIA tabs pattern as
// vapor's TabBar (roving tabindex, arrow/Home/End activation, role=tab/tablist, aria-controls, prefetch on
// pointer/touch), via the SAME headless controller (useSections). Differences from vapor: an icon pill per
// tab (not a sliding neon indicator), and inline SVG icons keyed by section id (the TabDef.glyph unicode is
// vapor's choice; the Kit renders its own glyphs). Adding a section = one icon here.

const ICONS: Record<TabId, ReactNode> = {
  fleet: <path d="M3 12l9-8 9 8M5 10v10h14V10" />,
  agent: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.7A8.4 8.4 0 1 1 21 11.5z" />,
  utils: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />,
  conf: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
};

interface Props {
  onPrefetch?: (tab: TabId) => void;
}

export function KitNavBar({ onPrefetch }: Props) {
  const { sections, active, navigate } = useSections();

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
    const targetId = `tabbtn-${target}`;
    queueMicrotask(() => document.getElementById(targetId)?.focus());
  };

  return (
    <nav className="kit-tabbar" data-tab={active} role="tablist" aria-label="primary navigation">
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
            className={"kit-tabbtn" + (selected ? " active" : "")}
            onClick={() => navigate(t.id)}
            onKeyDown={onKeyDown}
            onPointerEnter={onPrefetch ? () => onPrefetch(t.id) : undefined}
            onTouchStart={onPrefetch ? () => onPrefetch(t.id) : undefined}
          >
            <span className="ic">
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {ICONS[t.id]}
              </svg>
            </span>
            <span className="lbl">{t.lbl}</span>
          </button>
        );
      })}
    </nav>
  );
}
