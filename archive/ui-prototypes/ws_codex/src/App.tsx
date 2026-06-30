import { useMemo, useState } from "react";
import { ActivityLog } from "./components/ActivityLog";
import { AgentPanel } from "./components/AgentPanel";
import { BottomNav } from "./components/BottomNav";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { HostList } from "./components/HostList";
import { ServiceTable } from "./components/ServiceTable";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { initialEvents, initialHosts, initialMessages, initialServices } from "./data/mockData";
import type { ActionEvent, ChatMessage, Host, MobileTab, Service } from "./types/models";

type Confirmation =
  | { type: "shutdown"; hostId: string; title: string; detail: string; label: string }
  | { type: "stop-service"; serviceId: string; title: string; detail: string; label: string };

const currentTime = () =>
  new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;

function App() {
  const [hosts, setHosts] = useState<Host[]>(initialHosts);
  const [services, setServices] = useState<Service[]>(initialServices);
  const [events, setEvents] = useState<ActionEvent[]>(initialEvents);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [selectedHostId, setSelectedHostId] = useState("all");
  const [selectedProject, setSelectedProject] = useState("All");
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<MobileTab>("hosts");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [responding, setResponding] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);

  const addEvent = (title: string, detail: string, level: ActionEvent["level"] = "info") => {
    setEvents((current) => [
      {
        id: makeId("event"),
        time: currentTime(),
        title,
        detail,
        level,
      },
      ...current,
    ]);
  };

  const filteredHosts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return hosts;

    return hosts.filter((host) =>
      [host.name, host.os, host.lanAddress, host.tailnetName, ...host.tags]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [hosts, query]);

  const filteredServices = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return services.filter((service) => {
      const host = hosts.find((candidate) => candidate.id === service.hostId);
      const matchesHost = selectedHostId === "all" || service.hostId === selectedHostId;
      const matchesProject = selectedProject === "All" || service.project === selectedProject;
      const matchesQuery =
        !normalized ||
        [service.name, service.project, service.kind, service.description, host?.name ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalized);

      return matchesHost && matchesProject && matchesQuery;
    });
  }, [hosts, query, selectedHostId, selectedProject, services]);

  const selectedHost = hosts.find((host) => host.id === selectedHostId);
  const onlineCount = hosts.filter((host) => host.status === "online").length;

  const handleRefresh = () => {
    setHosts((current) =>
      current.map((host) =>
        host.status === "online"
          ? { ...host, lastSeen: "now", load: Math.min(92, Math.max(9, host.load + (host.id === "corsair" ? 3 : -2))) }
          : host,
      ),
    );
    addEvent("Status refresh", "Mock ping updated reachable hosts", "success");
  };

  const handleWake = (hostId: string) => {
    const host = hosts.find((candidate) => candidate.id === hostId);
    if (!host) return;

    setHosts((current) =>
      current.map((candidate) =>
        candidate.id === hostId ? { ...candidate, status: "starting", lastSeen: "wake sent" } : candidate,
      ),
    );
    addEvent("Wake requested", `${host.name} wake packet queued`, "info");

    window.setTimeout(() => {
      setHosts((current) =>
        current.map((candidate) =>
          candidate.id === hostId ? { ...candidate, status: "online", lastSeen: "now", uptime: "1m", load: 12 } : candidate,
        ),
      );
      addEvent("Host online", `${host.name} is reachable in mock state`, "success");
    }, 900);
  };

  const handleShutdownRequest = (hostId: string) => {
    const host = hosts.find((candidate) => candidate.id === hostId);
    if (!host) return;

    setConfirmation({
      type: "shutdown",
      hostId,
      title: `Shutdown ${host.name}?`,
      detail: "This is a prototype confirmation. No real SSH command will run.",
      label: "Shutdown mock host",
    });
  };

  const handlePing = (hostId: string) => {
    const host = hosts.find((candidate) => candidate.id === hostId);
    if (!host) return;

    setHosts((current) =>
      current.map((candidate) =>
        candidate.id === hostId ? { ...candidate, lastSeen: candidate.status === "offline" ? "no reply" : "now" } : candidate,
      ),
    );
    addEvent("Ping", `${host.name} ${host.status === "offline" ? "did not reply" : "responded"}`, host.status === "offline" ? "warning" : "success");
  };

  const handleRestartService = (serviceId: string) => {
    const service = services.find((candidate) => candidate.id === serviceId);
    if (!service) return;

    setServices((current) =>
      current.map((candidate) => (candidate.id === serviceId ? { ...candidate, status: "starting", updatedAt: "now" } : candidate)),
    );
    addEvent("Service restart", `${service.name} restart queued`, "info");

    window.setTimeout(() => {
      setServices((current) =>
        current.map((candidate) =>
          candidate.id === serviceId
            ? { ...candidate, status: "running", updatedAt: "now", cpu: Math.max(4, candidate.cpu), memory: Math.max(8, candidate.memory) }
            : candidate,
        ),
      );
      addEvent("Service running", `${service.name} returned to running`, "success");
    }, 850);
  };

  const handleStopServiceRequest = (serviceId: string) => {
    const service = services.find((candidate) => candidate.id === serviceId);
    if (!service) return;

    setConfirmation({
      type: "stop-service",
      serviceId,
      title: `Stop ${service.name}?`,
      detail: "This only changes mock state, but the real app should confirm before stopping services.",
      label: "Stop mock service",
    });
  };

  const handleOpenService = (serviceId: string) => {
    const service = services.find((candidate) => candidate.id === serviceId);
    if (!service) return;

    addEvent("Open service", `Would open ${service.url}`, "info");
  };

  const handleConfirm = () => {
    if (!confirmation) return;

    if (confirmation.type === "shutdown") {
      const host = hosts.find((candidate) => candidate.id === confirmation.hostId);
      setHosts((current) =>
        current.map((candidate) =>
          candidate.id === confirmation.hostId ? { ...candidate, status: "stopping", lastSeen: "shutdown sent" } : candidate,
        ),
      );
      addEvent("Shutdown requested", `${host?.name ?? confirmation.hostId} shutdown confirmed`, "warning");

      window.setTimeout(() => {
        setHosts((current) =>
          current.map((candidate) =>
            candidate.id === confirmation.hostId ? { ...candidate, status: "sleeping", uptime: "-", load: 0, lastSeen: "just now" } : candidate,
          ),
        );
      }, 750);
    }

    if (confirmation.type === "stop-service") {
      const service = services.find((candidate) => candidate.id === confirmation.serviceId);
      setServices((current) =>
        current.map((candidate) =>
          candidate.id === confirmation.serviceId
            ? { ...candidate, status: "stopped", updatedAt: "now", cpu: 0, memory: 0 }
            : candidate,
        ),
      );
      addEvent("Service stopped", `${service?.name ?? confirmation.serviceId} stopped in mock state`, "warning");
    }

    setConfirmation(null);
  };

  const sendAgentMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || responding) return;

    setMessages((current) => [
      ...current,
      { id: makeId("chat"), speaker: "user", text: trimmed, time: currentTime() },
    ]);
    setDraft("");
    setResponding(true);

    window.setTimeout(() => {
      setResponding(false);
      setMessages((current) => [
        ...current,
        {
          id: makeId("chat"),
          speaker: "agent",
          text: `Mock summary: ${onlineCount}/${hosts.length} hosts online, ${services.filter((service) => service.status === "degraded").length} service needs attention.`,
          time: currentTime(),
        },
      ]);
      addEvent("Agent response", "Generated mocked service summary", "info");
    }, 900);
  };

  const handleToggleListening = () => {
    if (!listening) {
      setListening(true);
      addEvent("Voice mock", "Push-to-talk state started without microphone access", "info");
      return;
    }

    setListening(false);
    const spokenText = "Check vault backups and wake g5 if needed";
    setDraft(spokenText);
    sendAgentMessage(spokenText);
  };

  const handleToggleTts = () => {
    setTtsEnabled((current) => !current);
    addEvent("TTS preference", `TTS ${ttsEnabled ? "muted" : "enabled"}`, "info");
  };

  return (
    <div className="app-shell">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="workspace">
        <TopBar
          query={query}
          onQueryChange={setQuery}
          onlineCount={onlineCount}
          totalCount={hosts.length}
          onRefresh={handleRefresh}
        />

        <div className="workspace-grid">
          <div className="primary-stack">
            <div className={activeTab === "hosts" ? "mobile-section active" : "mobile-section"}>
              <HostList
                hosts={filteredHosts}
                services={services}
                selectedHostId={selectedHostId}
                onSelectHost={setSelectedHostId}
                onWake={handleWake}
                onShutdown={handleShutdownRequest}
                onPing={handlePing}
              />
            </div>

            <div className={activeTab === "services" ? "mobile-section active" : "mobile-section"}>
              <ServiceTable
                hosts={hosts}
                services={filteredServices}
                selectedHostId={selectedHost?.id ?? "all"}
                selectedProject={selectedProject}
                onProjectChange={setSelectedProject}
                onRestart={handleRestartService}
                onStop={handleStopServiceRequest}
                onOpen={handleOpenService}
              />
            </div>

            <div className={activeTab === "log" ? "mobile-section active" : "mobile-section log-mobile"}>
              <ActivityLog events={events} />
            </div>
          </div>

          <div className={activeTab === "agent" ? "mobile-section active rail-stack" : "mobile-section rail-stack"}>
            <AgentPanel
              messages={messages}
              draft={draft}
              listening={listening}
              responding={responding}
              ttsEnabled={ttsEnabled}
              onDraftChange={setDraft}
              onSend={() => sendAgentMessage(draft)}
              onToggleListening={handleToggleListening}
              onToggleTts={handleToggleTts}
            />
          </div>
        </div>
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.title ?? ""}
        detail={confirmation?.detail ?? ""}
        confirmLabel={confirmation?.label ?? "Confirm"}
        onCancel={() => setConfirmation(null)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

export default App;
