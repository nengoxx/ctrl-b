import { ExternalLink, Server, Boxes, AlertTriangle, Activity as ActivityIcon } from "lucide-react";
import { useHosts, useServices, useEvents, useHostAction, useServiceAction } from "../api/queries";
import { StatusDot, KindIcon } from "../components/primitives";
import type { NavView } from "../nav";
import type { Host } from "../types";

function Kpi({ icon, value, label, sub }: { icon: React.ReactNode; value: string; label: string; sub?: string }) {
  return (
    <div className="card kpi">
      <div className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {icon}
        <span className="k-lbl">{label}</span>
      </div>
      <div className="k-val">{value}</div>
      {sub && <div className="k-sub">{sub}</div>}
    </div>
  );
}

export function OverviewView({ onJump }: { onJump: (v: NavView) => void }) {
  const { data: hosts } = useHosts();
  const { data: services } = useServices();
  const { data: events } = useEvents();
  const wake = useHostAction();
  const svcAction = useServiceAction();

  const online = hosts?.filter((h) => h.status === "online").length ?? 0;
  const total = hosts?.length ?? 0;
  const running = services?.filter((s) => s.state === "running").length ?? 0;
  const svcTotal = services?.length ?? 0;
  const attention = [
    ...(hosts ?? []).filter((h) => h.status === "warning" || h.status === "unreachable"),
    ...(services ?? []).filter((s) => s.state === "degraded"),
  ].length;

  const hostById = new Map<string, Host>((hosts ?? []).map((h) => [h.id, h]));

  return (
    <>
      <div className="kpi-row">
        <Kpi icon={<Server size={14} />} value={`${online}/${total}`} label="Hosts online" sub="polled every 15s" />
        <Kpi icon={<Boxes size={14} />} value={`${running}/${svcTotal}`} label="Services running" />
        <Kpi icon={<AlertTriangle size={14} />} value={String(attention)} label="Needs attention" sub={attention ? "see hosts & services" : "all clear"} />
        <Kpi icon={<ActivityIcon size={14} />} value={String(events?.length ?? 0)} label="Recent events" />
      </div>

      <div className="overview-cols">
        <div className="card panel">
          <div className="phead">
            <p className="section-title"><b>Hosts</b></p>
            <span className="spacer" />
            <button className="link-btn" onClick={() => onJump("hosts")}>All hosts →</button>
          </div>
          {(hosts ?? []).map((h) => {
            const asleep = h.status === "sleeping" || h.status === "unreachable";
            return (
              <div className="mini-host" key={h.id}>
                <StatusDot state={h.status} />
                <div>
                  <div className="mh-name">{h.name}</div>
                  <div className="mh-role">{h.role}</div>
                </div>
                <span className="spacer" />
                {asleep ? (
                  <button className="btn sm primary" onClick={() => wake.mutate({ hostId: h.id, action: "wake_host" })}>
                    Wake
                  </button>
                ) : (
                  <span className="mh-metric">
                    {h.metrics.gpu != null ? `gpu ${h.metrics.gpu}%` : h.metrics.cpu != null ? `cpu ${h.metrics.cpu}%` : "—"}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="card panel">
          <div className="phead">
            <p className="section-title"><b>Services</b></p>
            <span className="spacer" />
            <button className="link-btn" onClick={() => onJump("services")}>All services →</button>
          </div>
          {(services ?? []).map((s) => {
            const host = hostById.get(s.hostId);
            const stopped = s.state === "stopped";
            return (
              <div className="mini-host" key={s.id}>
                <span className="kind-ic" style={{ color: "var(--text-dim)", display: "flex" }}>
                  <KindIcon kind={s.kind} size={16} />
                </span>
                <div>
                  <div className="mh-name">{s.name}</div>
                  <div className="mh-role">{host?.name ?? "?"} · {s.kind}</div>
                </div>
                <span className="spacer" />
                <StatusDot state={s.state} />
                {stopped ? (
                  <button className="btn sm" onClick={() => svcAction.mutate({ serviceId: s.id, action: "start_service" })}>
                    Start
                  </button>
                ) : s.endpoint ? (
                  <a className="btn sm ghost" href={s.endpoint} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
