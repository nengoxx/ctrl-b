import { Bot, Clock3, HardDrive, LayoutDashboard, Server } from "lucide-react";
import type { MobileTab } from "../types/models";

type Props = {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
};

const items: Array<{ id: MobileTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "hosts", label: "Hosts", icon: LayoutDashboard },
  { id: "services", label: "Services", icon: Server },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "log", label: "Log", icon: Clock3 },
];

export function Sidebar({ activeTab, onTabChange }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/assets/logo.png" alt="" />
        <div>
          <strong>ctrl-b</strong>
          <span>workspace</span>
        </div>
      </div>

      <nav className="nav-list" aria-label="Workspace">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={activeTab === item.id ? "nav-item active" : "nav-item"}
              onClick={() => onTabChange(item.id)}
              type="button"
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-note">
        <HardDrive size={17} />
        <span>Prototype data only. No live host actions.</span>
      </div>
    </aside>
  );
}
