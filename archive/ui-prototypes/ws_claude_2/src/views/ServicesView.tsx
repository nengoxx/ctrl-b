import { useState } from "react";
import { ExternalLink, Play, Square, RotateCw, Activity, Cpu } from "lucide-react";
import { useHosts, useServices, useServiceAction } from "../api/queries";
import { StatusDot, KindIcon, ConfirmDialog } from "../components/primitives";
import { ActivityFeed } from "../components/ActivityFeed";
import type { ActionType, Host, Service, ServiceAction } from "../types";

const ACTION_ICON: Partial<Record<ActionType, typeof Play>> = {
  start_service: Play,
  stop_service: Square,
  restart_service: RotateCw,
  run_health_check: Activity,
  switch_gpu_workload: Cpu,
};

function ServiceRow({
  svc, onAction,
}: {
  svc: Service;
  onAction: (a: ServiceAction) => void;
}) {
  return (
    <div className="svc-row">
      <span className="kind-ic"><KindIcon kind={svc.kind} /></span>
      <div>
        <div className="svc-name">{svc.name}</div>
        <div className="svc-sub">
          {svc.kind}{svc.port ? ` · :${svc.port}` : ""}
        </div>
      </div>
      <div className="svc-state">
        <StatusDot state={svc.state} />
        <span className="muted" style={{ fontSize: 12, textTransform: "capitalize" }}>{svc.state}</span>
      </div>
      <div className="svc-actions">
        {svc.endpoint && (
          <a className="btn sm ghost" href={svc.endpoint} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> Open
          </a>
        )}
        {svc.actions.map((a) => {
          const Icon = ACTION_ICON[a.type];
          return (
            <button
              key={a.id}
              className={`btn sm ${a.risk === "high" ? "danger" : ""}`}
              onClick={() => onAction(a)}
            >
              {Icon && <Icon size={13} />} {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ServicesView({ filter, projectId }: { filter: string; projectId: string }) {
  const { data: services, isLoading } = useServices();
  const { data: hosts } = useHosts();
  const action = useServiceAction();
  const [confirm, setConfirm] = useState<{ svc: Service; a: ServiceAction } | null>(null);

  if (isLoading) return <div className="empty">Loading services…</div>;

  const hostById = new Map<string, Host>((hosts ?? []).map((h) => [h.id, h]));
  const visibleHosts = (hosts ?? []).filter((h) => projectId === "all" || h.projectId === projectId);

  const matches = (s: Service) => {
    const h = hostById.get(s.hostId);
    if (projectId !== "all" && h?.projectId !== projectId) return false;
    return !filter || s.name.toLowerCase().includes(filter) || s.kind.includes(filter) || (h?.name.includes(filter) ?? false);
  };

  const groups = visibleHosts
    .map((h) => ({ host: h, svcs: (services ?? []).filter((s) => s.hostId === h.id && matches(s)) }))
    .filter((g) => g.svcs.length > 0);

  function run(svc: Service, a: ServiceAction) {
    if (a.risk === "high" || a.type === "stop_service") setConfirm({ svc, a });
    else action.mutate({ serviceId: svc.id, action: a.type });
  }

  return (
    <>
      <p className="section-title"><b>Services</b> · {groups.reduce((n, g) => n + g.svcs.length, 0)}</p>
      {groups.map(({ host, svcs }) => (
        <div className="group" key={host.id}>
          <div className="group-head">
            <StatusDot state={host.status} />
            <span className="gname">{host.name}</span>
            <span className="gmeta">{host.role}</span>
          </div>
          <div className="svc-table">
            {svcs.map((s) => <ServiceRow key={s.id} svc={s} onAction={(a) => run(s, a)} />)}
          </div>
        </div>
      ))}
      {groups.length === 0 && <div className="empty">No services match.</div>}

      <p className="section-title" style={{ marginTop: 22 }}><b>Activity</b></p>
      <div className="card panel feed">
        <ActivityFeed />
      </div>

      {confirm && (
        <ConfirmDialog
          title={`Confirm ${confirm.a.label.toLowerCase()}`}
          body={<>{confirm.a.label} <b>{confirm.svc.name}</b> on this host?</>}
          confirmLabel={confirm.a.label}
          danger={confirm.a.type === "stop_service" || confirm.a.risk === "high"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            action.mutate({ serviceId: confirm.svc.id, action: confirm.a.type });
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}
