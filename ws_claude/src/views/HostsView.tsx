import { useState } from "react";
import { Power, PlayCircle } from "lucide-react";
import { useHosts, useHostAction } from "../api/queries";
import { StatusDot, StateLabel, ConfirmModal } from "../components/common";
import type { Host } from "../types";

function Meter({ label, value }: { label: string; value?: number }) {
  if (value == null) return null;
  return (
    <div className="meter">
      <span className="lbl">{label}</span>
      <div className="track">
        <div className={`fill ${value >= 85 ? "hot" : ""}`} style={{ width: `${value}%` }} />
      </div>
      <span className="val">{value}%</span>
    </div>
  );
}

function HostCard({ host, onWake, onShutdown }: { host: Host; onWake: () => void; onShutdown: () => void }) {
  const asleep = host.status === "sleeping" || host.status === "unreachable";
  return (
    <div className="host-card">
      <div className="head">
        <StatusDot state={host.status} />
        <div>
          <div className="name">{host.name}</div>
          <div className="role">{host.role}</div>
        </div>
        <span className="os-tag">{host.os}</span>
      </div>

      <div className="addr">
        <span>
          <b>lan</b> {host.lanIp}
        </span>
        {host.tailscaleIp && (
          <span>
            <b>ts</b> {host.tailscaleIp}
          </span>
        )}
      </div>

      {asleep ? (
        <div className="muted" style={{ fontSize: 12, margin: "12px 0" }}>
          <StateLabel state={host.status} /> · last seen {new Date(host.lastSeen).toLocaleString()}
        </div>
      ) : (
        <div className="meters">
          <Meter label="cpu" value={host.metrics.cpu} />
          <Meter label="mem" value={host.metrics.memory} />
          <Meter label="gpu" value={host.metrics.gpu} />
        </div>
      )}

      <div className="tags">
        {host.tags.map((t) => (
          <span className="tag" key={t}>
            {t}
          </span>
        ))}
      </div>

      <div className="host-actions">
        {asleep ? (
          <button className="btn sm primary" onClick={onWake}>
            <PlayCircle size={15} /> Wake
          </button>
        ) : (
          <button className="btn sm danger" onClick={onShutdown}>
            <Power size={15} /> Shutdown
          </button>
        )}
      </div>
    </div>
  );
}

export function HostsView({ filter }: { filter: string }) {
  const { data: hosts, isLoading } = useHosts();
  const action = useHostAction();
  const [confirm, setConfirm] = useState<Host | null>(null);

  if (isLoading) return <div className="empty">Loading hosts…</div>;
  const list = (hosts ?? []).filter(
    (h) =>
      !filter ||
      h.name.includes(filter) ||
      h.role.toLowerCase().includes(filter) ||
      h.tags.some((t) => t.includes(filter)),
  );

  return (
    <>
      <p className="section-title">Hosts · {list.length}</p>
      <div className="host-grid">
        {list.map((h) => (
          <HostCard
            key={h.id}
            host={h}
            onWake={() => action.mutate({ hostId: h.id, action: "wake_host" })}
            onShutdown={() => setConfirm(h)}
          />
        ))}
      </div>
      {list.length === 0 && <div className="empty">No hosts match “{filter}”.</div>}

      {confirm && (
        <ConfirmModal
          title="Confirm shutdown"
          body={
            <>
              Shut down <b>{confirm.name}</b> ({confirm.lanIp})? It will need a wake packet to return.
            </>
          }
          confirmLabel="Shutdown"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            action.mutate({ hostId: confirm.id, action: "shutdown_host" });
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}
