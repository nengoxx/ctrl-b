import { useEffect, useMemo, useState } from "react";
import {
  Search, RefreshCw, Bot, Command, Moon, Sun, Layers,
  Power, PlayCircle, RotateCw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useHosts, useServices, useProjects, useHostAction, useServiceAction } from "./api/queries";
import { useTheme } from "./lib/theme";
import { NAV, MOBILE_NAV, type NavView } from "./nav";
import { BodyPortal } from "./components/primitives";
import { AgentDock } from "./components/AgentDock";
import { CommandPalette, type Command as Cmd } from "./components/CommandPalette";
import { OverviewView } from "./views/OverviewView";
import { HostsView } from "./views/HostsView";
import { ServicesView } from "./views/ServicesView";
import { SettingsView } from "./views/SettingsView";

// Optional deep-link: ?view=services opens a tab directly, ?agent=1 opens the
// dock. Lets a view be bookmarked; the default (no params) is overview + closed.
const params = new URLSearchParams(window.location.search);
const initialView = (["overview", "hosts", "services", "settings"] as const).find((v) => v === params.get("view")) ?? "overview";

export default function App() {
  const [view, setView] = useState<NavView>(initialView);
  const [project, setProject] = useState<string>("all");
  const [filter, setFilter] = useState("");
  // Agent dock starts closed everywhere — it opens only when the user toggles it
  // (top-bar button, ⌘K, or the mobile Agent tab), never on navigation.
  const [dockOpen, setDockOpen] = useState(params.get("agent") === "1");
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const qc = useQueryClient();

  const { data: hosts } = useHosts();
  const { data: services } = useServices();
  const { data: projects } = useProjects();
  const hostAction = useHostAction();
  const serviceAction = useServiceAction();

  const online = hosts?.filter((h) => h.status === "online").length ?? 0;
  const running = services?.filter((s) => s.state === "running").length ?? 0;
  const f = filter.trim().toLowerCase();

  // Floating dock when the viewport can't spare a third column.
  const [floating, setFloating] = useState(() => window.innerWidth <= 1100);
  useEffect(() => {
    const onResize = () => setFloating(window.innerWidth <= 1100);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function refresh() {
    setRefreshing(true);
    qc.invalidateQueries().finally(() => setTimeout(() => setRefreshing(false), 500));
  }

  // ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands: Cmd[] = useMemo(() => {
    const cmds: Cmd[] = NAV.map((n) => ({
      id: `nav-${n.id}`, label: `Go to ${n.label}`, hint: "view",
      icon: <n.icon size={16} />, run: () => setView(n.id),
    }));
    cmds.push({ id: "toggle-agent", label: dockOpen ? "Hide agent" : "Open agent", hint: "panel", icon: <Bot size={16} />, run: () => setDockOpen((o) => !o) });
    cmds.push({ id: "toggle-theme", label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`, icon: theme === "dark" ? <Sun size={16} /> : <Moon size={16} />, run: toggleTheme });
    (hosts ?? []).forEach((h) => {
      const asleep = h.status === "sleeping" || h.status === "unreachable";
      cmds.push({
        id: `host-${h.id}`,
        label: asleep ? `Wake ${h.name}` : `Shutdown ${h.name}`,
        hint: h.role,
        icon: asleep ? <PlayCircle size={16} /> : <Power size={16} />,
        run: () => hostAction.mutate({ hostId: h.id, action: asleep ? "wake_host" : "shutdown_host" }),
      });
    });
    (services ?? []).forEach((s) => {
      const a = s.actions.find((x) => x.type === "restart_service") ?? s.actions[0];
      if (a) cmds.push({
        id: `svc-${s.id}`, label: `${a.label} ${s.name}`, hint: "service",
        icon: <RotateCw size={16} />, run: () => serviceAction.mutate({ serviceId: s.id, action: a.type }),
      });
    });
    return cmds;
  }, [hosts, services, dockOpen, theme, toggleTheme, hostAction, serviceAction]);

  return (
    <div className={`app ${dockOpen && !floating ? "dock-open" : ""}`}>
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
              {n.id === "hosts" && hosts && <span className="count">{hosts.length}</span>}
              {n.id === "services" && services && <span className="count">{services.length}</span>}
            </button>
          ))}

          <div className="nav-group-label">Projects</div>
          <button className={`nav-item ${project === "all" ? "active" : ""}`} onClick={() => setProject("all")}>
            <Layers size={16} /> All projects
          </button>
          {(projects ?? []).map((p) => (
            <button key={p.id} className={`nav-item ${project === p.id ? "active" : ""}`} onClick={() => setProject(p.id)} title={p.description}>
              <span className="dot" style={{ background: p.accent }} />
              {p.name}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="dot online" /> tailscale-only · no open ports
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{NAV.find((n) => n.id === view)?.label}</h1>
          <div className="counts">
            <span className="count"><span className="dot online" /> {online} online</span>
            <span className="count"><span className="dot running" /> {running} running</span>
          </div>
          <span className="spacer" />
          {(view === "hosts" || view === "services") && (
            <div className="search">
              <Search size={15} />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" />
            </div>
          )}
          <button className="icon-btn" onClick={() => setCmdkOpen(true)} title="Command palette (Ctrl/⌘ K)">
            <Command size={16} />
          </button>
          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className={`icon-btn ${refreshing ? "spin" : ""}`} onClick={refresh} title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button className={`icon-btn ${dockOpen ? "" : "ghost"}`} onClick={() => setDockOpen((o) => !o)} title="Toggle agent"
            style={dockOpen ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}>
            <Bot size={16} />
          </button>
        </header>

        <main className={`content ${floating ? "pad-bottom" : ""}`}>
          {view === "overview" && <OverviewView onJump={setView} />}
          {view === "hosts" && <HostsView filter={f} projectId={project} />}
          {view === "services" && <ServicesView filter={f} projectId={project} />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>

      {dockOpen && <AgentDock floating={floating} onClose={() => setDockOpen(false)} />}

      <BodyPortal>
        <nav className="bottomnav">
          {MOBILE_NAV.map((id) => {
            const n = NAV.find((x) => x.id === id)!;
            return (
              <button key={id} className={view === id && !dockOpen ? "active" : ""} onClick={() => { setView(id); setDockOpen(false); }}>
                <n.icon size={20} />
                {n.label}
              </button>
            );
          })}
          <button className={dockOpen ? "active" : ""} onClick={() => setDockOpen((o) => !o)}>
            <Bot size={20} />
            Agent
          </button>
        </nav>
      </BodyPortal>

      {cmdkOpen && <CommandPalette commands={commands} onClose={() => setCmdkOpen(false)} />}
    </div>
  );
}
