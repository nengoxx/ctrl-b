import { setUI, useUISlice, type Tab } from "../store/ui";

// Bottom tab bar. The sliding neon indicator is pure CSS (.tabbar::before keyed off
// .tabbar[data-tab]); we just keep data-tab + .active in sync with the store.
//
// `onPrefetch` (Slice 6 / F6): an optional hook fired on pointer-enter / touch-start of each
// tab button. The shell uses it to warm a lazy-loaded tab's chunk before the actual click, so
// the navigation never shows a Suspense flash. Tabs without a lazy chunk simply ignore the call
// (the handler is a no-op for them). Generic by design — adding a new lazy tab is one line in
// the shell's `prefetch` map, no change to TabBar.

const TABS: { id: Tab; glyph: string; lbl: string }[] = [
  { id: "fleet", glyph: "◆", lbl: "fleet" },
  { id: "agent", glyph: "▲", lbl: "chat" },
  { id: "utils", glyph: "⌬", lbl: "utils" },
  { id: "conf", glyph: "●", lbl: "conf" },
];

interface Props {
  onPrefetch?: (tab: Tab) => void;
}

export function TabBar({ onPrefetch }: Props) {
  const tab = useUISlice((s) => s.tab);
  return (
    <nav className="tabbar" data-tab={tab}>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={"tabbtn" + (tab === t.id ? " active" : "")}
          data-tab={t.id}
          onClick={() => setUI({ tab: t.id })}
          // Pointer-enter covers desktop hover; touch-start fires the moment a finger lands —
          // typically 80-200ms before the click. Both are safe to fire repeatedly (the lazy
          // importer's promise is cached at the ES-module level after the first call).
          onPointerEnter={onPrefetch ? () => onPrefetch(t.id) : undefined}
          onTouchStart={onPrefetch ? () => onPrefetch(t.id) : undefined}
        >
          <span className="glyph">{t.glyph}</span>
          <span className="lbl">{t.lbl}</span>
        </button>
      ))}
    </nav>
  );
}
