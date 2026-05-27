import { setUI, useUI, type Tab } from "../store/ui";

// Bottom tab bar. The sliding neon indicator is pure CSS (.tabbar::before keyed off
// .tabbar[data-tab]); we just keep data-tab + .active in sync with the store.

const TABS: { id: Tab; glyph: string; lbl: string }[] = [
  { id: "fleet", glyph: "◆", lbl: "fleet" },
  { id: "agent", glyph: "▲", lbl: "chat" },
  { id: "utils", glyph: "⌬", lbl: "utils" },
  { id: "conf", glyph: "●", lbl: "conf" },
];

export function TabBar() {
  const { tab } = useUI();
  return (
    <nav className="tabbar" data-tab={tab}>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={"tabbtn" + (tab === t.id ? " active" : "")}
          data-tab={t.id}
          onClick={() => setUI({ tab: t.id })}
        >
          <span className="glyph">{t.glyph}</span>
          <span className="lbl">{t.lbl}</span>
        </button>
      ))}
    </nav>
  );
}
