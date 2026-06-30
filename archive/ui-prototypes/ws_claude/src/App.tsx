import { useState } from "react";
import { LayoutDashboard, Server, Boxes, Bot, ScrollText, Search, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useHosts, useServices } from "./api/queries";
import { BodyPortal } from "./components/common";
import { OverviewView } from "./views/OverviewView";
import { HostsView } from "./views/HostsView";
import { ServicesView } from "./views/ServicesView";
import { ActivityView } from "./views/ActivityView";
import { AgentView } from "./views/AgentView";

type View = "overview" | "hosts" | "services" | "agent" | "activity";

const NAV: { id: View; label: string; icon: typeof Server }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "hosts", label: "Hosts", icon: Server },
  { id: "services", label: "Services", icon: Boxes },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "activity", label: "Activity", icon: ScrollText },
];

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState("");
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: hosts } = useHosts();
  const { data: services } = useServices();
  const online = hosts?.filter((h) => h.status === "online").length ?? 0;
  const running = services?.filter((s) => s.state === "running").length ?? 0;

  const f = filter.trim().toLowerCase();

  function refresh() {
    setRefreshing(true);
    qc.invalidateQueries().finally(() => setTimeout(() => setRefreshing(false), 500));
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="" />
          <div>
            <b>ctrl-b</b>
            <div className="sub">fleet console</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${view === n.id ? "active" : ""}`} onClick={() => setView(n.id)}>
              <n.icon size={17} />
              {n.label}
              {n.id === "hosts" && hosts && <span className="badge">{hosts.length}</span>}
              {n.id === "services" && services && <span className="badge">{services.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">tailscale-only · no open ports</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{NAV.find((n) => n.id === view)?.label}</h1>
          <div className="counts">
            <span className="count">
              <span className="dot online" /> {online} online
            </span>
            <span className="count">
              <span className="dot running" /> {running} running
            </span>
          </div>
          <span className="spacer" />
          {view !== "agent" && (
            <div className="search">
              <Search size={15} />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" />
            </div>
          )}
          <button className={`icon-btn ${refreshing ? "spin" : ""}`} onClick={refresh} title="Refresh">
            <RefreshCw size={16} />
          </button>
        </header>

        <main className="content">
          {view === "overview" && <OverviewView onJump={setView} />}
          {view === "hosts" && <HostsView filter={f} />}
          {view === "services" && <ServicesView filter={f} />}
          {view === "agent" && <AgentView />}
          {view === "activity" && <ActivityView />}
        </main>
      </div>

      <BodyPortal>
        <nav className="bottomnav">
          {NAV.map((n) => (
            <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => setView(n.id)}>
              <span className="pill">
                <n.icon size={19} />
              </span>
              {n.label}
            </button>
          ))}
        </nav>
      </BodyPortal>
    </div>
  );
}
