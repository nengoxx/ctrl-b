import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useServices, useHosts, useServiceAction } from "../api/queries";
import { StatusDot, StateLabel, KindIcon, ConfirmModal } from "../components/common";
import type { Service, ServiceAction } from "../types";

export function ServicesView({ filter }: { filter: string }) {
  const { data: services, isLoading } = useServices();
  const { data: hosts } = useHosts();
  const action = useServiceAction();
  const [confirm, setConfirm] = useState<{ service: Service; act: ServiceAction } | null>(null);

  if (isLoading) return <div className="empty">Loading services…</div>;

  const hostOf = (id: string) => hosts?.find((h) => h.id === id);
  const list = (services ?? []).filter(
    (s) => !filter || s.name.toLowerCase().includes(filter) || (hostOf(s.hostId)?.name ?? "").includes(filter),
  );

  // group by host so services read in their real infrastructure context
  const byHost = new Map<string, Service[]>();
  for (const s of list) {
    if (!byHost.has(s.hostId)) byHost.set(s.hostId, []);
    byHost.get(s.hostId)!.push(s);
  }

  const run = (service: Service, act: ServiceAction) => {
    if (act.risk === "high" || act.risk === "medium") setConfirm({ service, act });
    else action.mutate({ serviceId: service.id, action: act.type });
  };

  if (list.length === 0) return <div className="empty">No services match “{filter}”.</div>;

  return (
    <>
      <p className="section-title">Services · {list.length}</p>
      {[...byHost.entries()].map(([hostId, svcs]) => {
        const host = hostOf(hostId);
        return (
          <div className="svc-group" key={hostId}>
            <div className="svc-group-head">
              <StatusDot state={host?.status ?? "unknown"} />
              <span className="hn">{host?.name ?? hostId}</span>
              <span className="hr">{host?.role}</span>
              <span className="hc">{svcs.length} svc</span>
            </div>
            <div className="panel">
              {svcs.map((s) => (
                <ServiceRow key={s.id} service={s} onRun={run} />
              ))}
            </div>
          </div>
        );
      })}

      {confirm && (
        <ConfirmModal
          title={`${confirm.act.label} service`}
          body={
            <>
              {confirm.act.label} <b>{confirm.service.name}</b>?
            </>
          }
          confirmLabel={confirm.act.label}
          danger={confirm.act.risk === "high"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            action.mutate({ serviceId: confirm.service.id, action: confirm.act.type });
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}

function ServiceRow({ service: s, onRun }: { service: Service; onRun: (s: Service, a: ServiceAction) => void }) {
  return (
    <div className="svc-row">
      <div className={`isq k-${s.kind}`}>
        <KindIcon kind={s.kind} />
      </div>
      <div className="svc-main">
        <div className="nm">
          {s.name}
          <StatusDot state={s.state} />
          <StateLabel state={s.state} />
        </div>
        <div className="meta">
          <span>{s.kind}</span>
          {s.port != null && (
            <>
              <span className="sep">·</span>
              <span>:{s.port}</span>
            </>
          )}
          {s.endpoint && (
            <>
              <span className="sep">·</span>
              <a href={s.endpoint} target="_blank" rel="noreferrer">
                open <ExternalLink size={10} style={{ verticalAlign: "-1px" }} />
              </a>
            </>
          )}
        </div>
      </div>
      <div className="svc-actions">
        {s.actions.map((a) => (
          <button key={a.id} className={`btn sm ${a.risk === "high" ? "danger" : ""}`} onClick={() => onRun(s, a)}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
