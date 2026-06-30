import { Bot, Clock3, LayoutDashboard, Server } from "lucide-react";
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

export function BottomNav({ activeTab, onTabChange }: Props) {
  return (
    <nav className="bottom-nav" aria-label="Mobile workspace">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={activeTab === item.id ? "bottom-item active" : "bottom-item"}
            onClick={() => onTabChange(item.id)}
            type="button"
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
