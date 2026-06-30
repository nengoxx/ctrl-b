import { LayoutDashboard, Server, Boxes, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavView = "overview" | "hosts" | "services" | "settings";

export const NAV: { id: NavView; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "hosts", label: "Hosts", icon: Server },
  { id: "services", label: "Services", icon: Boxes },
  { id: "settings", label: "Settings", icon: Settings },
];

// Destinations in the Android bottom nav (Material guidance: 3–5 top-level
// destinations). "Agent" is added as the final slot, wired separately because it
// toggles the dock rather than swapping the main view.
export const MOBILE_NAV: NavView[] = ["overview", "hosts", "services"];
