import type { KeyboardEvent } from "react";

import { useSections } from "../../hooks/useSections";
import type { TabId } from "../types";

// Kit bottom nav (D29 §14.4) — token-driven, `.kit-*` classes. Same capability + WAI-ARIA tabs pattern as
// vapor's TabBar (roving tabindex, arrow/Home/End activation, role=tab/tablist, aria-controls, prefetch on
// pointer/touch), via the SAME headless controller (useSections). The LOOK is vapor's bar assimilated
// Kit-wide (owner directive 2026-07-12): short bar, `TabDef.glyph` unicode marks (per-theme DATA — a theme
// can restyle its glyphs without code) + small uppercase labels — the old per-tab inline-SVG icon set is
// gone. Adding a section = a TabDef entry; nothing here changes.

interface Props {
  onPrefetch?: (tab: TabId) => void;
}

export function KitNavBar({ onPrefetch }: Props) {
  // The ON-BAR sections under the resolved layout (D35 §F0) — 4-tab renders all four (render-identical to
  // before), 3-/2-tab render fewer; off-bar sections reach the user via the floating `<NavMenu/>`.
  const { bar: sections, active, navigate } = useSections();

  // Roving tabindex needs exactly ONE tab stop (WAI-ARIA tabs). Pre-F0 the active section was always on the
  // bar; under a partial layout it may not be (2-tab + conf active, reached via the menu — audit F0#2), and
  // `selected ? 0 : -1` alone would leave ZERO tabbable buttons → the bar becomes keyboard-unreachable (a
  // navigation dead-end: fleet/agent are on-bar so the menu doesn't list them either). Fall back to making
  // the FIRST button the tab stop when the active section is off-bar.
  const activeIdx = sections.findIndex((t) => t.id === active);
  const activeInBar = activeIdx >= 0;

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
    // The sliding top indicator (the vapor-original mechanic, owner directive 2026-07-12) — data-driven for
    // the N-column bar (D35 partial layouts), where vapor's fixed `[data-tab]` selector table assumes 4
    // columns: the `.kit-tab-ind` TRACK is one column wide and slides on `--tab-i` (transform-only); its
    // inner `.bar` is the visible line, px-CAPPED + centered (Material's inset-indicator shape — a full
    // column read far too wide at 2-/3-tab, owner 2026-07-12). When the active section is off-bar
    // (`no-active`, e.g. 2-tab + conf via the menu) the line hides.
    <nav
      className={"kit-tabbar" + (activeInBar ? "" : " no-active")}
      data-tab={active}
      role="tablist"
      aria-label="primary navigation"
      style={{
        ["--tab-count" as string]: sections.length,
        ["--tab-i" as string]: Math.max(activeIdx, 0),
      }}
    >
      <span className="kit-tab-ind" aria-hidden>
        <span className="bar" />
      </span>
      {sections.map((t, idx) => {
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            id={`tabbtn-${t.id}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`tab-${t.id}`}
            tabIndex={selected || (!activeInBar && idx === 0) ? 0 : -1}
            className={"kit-tabbtn" + (selected ? " active" : "")}
            onClick={() => navigate(t.id)}
            onKeyDown={onKeyDown}
            onPointerEnter={onPrefetch ? () => onPrefetch(t.id) : undefined}
            onTouchStart={onPrefetch ? () => onPrefetch(t.id) : undefined}
          >
            <span className="glyph" aria-hidden>
              {t.glyph}
            </span>
            <span className="lbl">{t.lbl}</span>
            {/* Optional per-theme SECOND label line (D52 — gacha's JP sub-labels). Emitted only when the
                theme's TabDef declares one, so every other theme's bar DOM is unchanged. Not aria-hidden:
                it is real label text, and the button's accessible name is its concatenated content. */}
            {t.subLabel !== undefined && <span className="sub">{t.subLabel}</span>}
          </button>
        );
      })}
    </nav>
  );
}
